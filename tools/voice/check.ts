/**
 * The checks behind `npm run voice:verify` (docs/voice-narration-plan.md §4).
 *
 * Like `audio:verify`, **absence is reported and never fatal**: a line with no
 * clips yet is read by the device voice, which is the state every line starts
 * in, and a gate that failed on it would be red from day one. What fails is a
 * manifest that would make the table hear something wrong:
 *
 *  - an entry whose clips are not the ones the line's words ask for today: the
 *    text, a voice or a delivery changed since it was rendered, and playing it
 *    would say the old words. `voice:verify -- --fix` drops those entries (free,
 *    no network), and the line falls back to the device voice until re-rendered;
 *  - an entry for a line the device voice must read (its script is broken or
 *    names someone who is not cast), or a script that is broken or uncast;
 *  - a malformed entry: not a clip key, no clips, a length that is not a
 *    length, or a length no voice could say those words in;
 *  - a clip the manifest names that the site does not have (`checkSources`,
 *    sources.ts): the browser would fetch a 404 mid-sentence.
 *
 * Pure: the destinations are asked in sources.ts.
 */

import { isClipKey } from "../../packages/shared/src/voice-clips";
import type { Desired } from "./desired";
import { mergeManifest, type Lock, type Manifest } from "./manifest";
import type { Finding } from "./sources.ts";

export { checkSources, type Finding } from "./sources.ts";

export interface VoiceVerdict {
  failures: Finding[];
  notes: Finding[];
  /** Clip keys every manifest names, for the destination check. */
  clips: Map<string, number>;
}

/** Shorter than a breath: a clip this short was cut off or is empty. */
export const MIN_CLIP_MS = 200;
/** Longer than any line the game has: a clip this long is mostly something other than the words. */
export const MAX_CLIP_MS = 120_000;
/**
 * How fast a voice can say a line, in characters a second. Speech is about 14;
 * these are wide enough for a whisper and an excited rush, and narrow enough to
 * catch a clip that is mostly silence or one that was cut short. Checked only on
 * lines long enough for a rate to mean something.
 */
export const RATE_CHARS_PER_SECOND = { min: 3, max: 40 } as const;
const RATE_MIN_CHARS = 24;

export interface ManifestInput {
  /** Manifest name (a chapter, `_<campaign>`, `_help`) to its contents. */
  manifests: ReadonlyMap<string, Manifest>;
  /** What each manifest's lines want today, by the same name. */
  desired: ReadonlyMap<string, Desired>;
  lock: Lock;
}

/** Everything that can be checked from git alone. */
export function checkManifests(input: ManifestInput): VoiceVerdict {
  const failures: Finding[] = [];
  const notes: Finding[] = [];
  const clips = new Map<string, number>();

  for (const [name, desired] of input.desired) {
    for (const d of desired.deviceVoice) {
      if (d.reason === "broken-script") failures.push({ at: `${name} ${d.address}`, message: "its script does not rebuild the line's words (npm run content:validate says why)" });
      else if (d.reason === "uncast-speaker") failures.push({ at: `${name} ${d.address}`, message: "its script names a speaker who is not on the cast sheet (content/voice/cast.json)" });
      else notes.push({ at: `${name} ${d.address}`, message: "its script is stale; the device voice reads it until it is re-cut" });
    }
  }

  for (const [name, manifest] of input.manifests) {
    const file = `content/voice/manifest/${name}.json`;
    const desired = input.desired.get(name);
    if (desired === undefined) {
      notes.push({ at: file, message: "names no chapter, campaign or help sheet the game has; nothing will load it" });
    }
    const wanted = new Map((desired?.lines ?? []).map((line) => [`${line.address}\u0000${line.variant}`, line]));
    const deviceVoice = new Set((desired?.deviceVoice ?? []).map((d) => d.address));
    for (const [address, variants] of Object.entries(manifest)) {
      for (const [variant, entry] of Object.entries(variants)) {
        const at = `${file} ${address}${variant === "" ? "" : ` [${variant}]`}`;
        if (!Array.isArray(entry) || entry.length === 0) {
          failures.push({ at, message: "has no clips; leave a line out of the manifest rather than give it none" });
          continue;
        }
        const line = wanted.get(`${address}\u0000${variant}`);
        let wellFormed = true;
        entry.forEach((clip, i) => {
          if (typeof clip?.clip !== "string" || !isClipKey(clip.clip)) {
            failures.push({ at, message: `clip ${String(i + 1)} is not a clip key: ${JSON.stringify(clip?.clip)}` });
            wellFormed = false;
            return;
          }
          if (!Number.isInteger(clip.ms) || clip.ms < MIN_CLIP_MS || clip.ms > MAX_CLIP_MS) {
            failures.push({ at, message: `clip ${clip.clip.slice(0, 12)} is ${String(clip.ms)} ms long; a clip is ${String(MIN_CLIP_MS)} to ${String(MAX_CLIP_MS)} ms` });
            wellFormed = false;
          }
          clips.set(clip.clip, clip.ms);
          const text = line?.segments[i]?.text;
          if (text !== undefined && text.length >= RATE_MIN_CHARS && Number.isInteger(clip.ms) && clip.ms > 0) {
            const rate = text.length / (clip.ms / 1000);
            if (rate < RATE_CHARS_PER_SECOND.min || rate > RATE_CHARS_PER_SECOND.max) {
              failures.push({ at, message: `clip ${clip.clip.slice(0, 12)} says ${String(text.length)} characters in ${String(clip.ms)} ms (${rate.toFixed(1)} a second); speech is ${String(RATE_CHARS_PER_SECOND.min)} to ${String(RATE_CHARS_PER_SECOND.max)}, so it is cut short or mostly silence` });
            }
          }
        });
        if (!wellFormed) continue;
        if (deviceVoice.has(address)) {
          failures.push({ at, message: "is a line the device voice must read now (its script is stale or broken); the clips would say the old cut. Run `npm run voice:verify -- --fix`" });
        } else if (line === undefined) {
          notes.push({ at, message: "is not a line the game says any more; nothing will play it (`voice:generate -- --prune` drops it)" });
        } else if (entry.length !== line.segments.length || entry.some((clip, i) => clip.clip !== line.segments[i]?.key)) {
          failures.push({ at, message: "plays clips for words, a voice or a delivery that have since changed, so the table would hear the old line. Run `npm run voice:verify -- --fix` to drop the entry, and `voice:generate` to render the new one" });
        }
      }
    }
  }

  for (const key of Object.keys(input.lock.approved)) {
    if (!isClipKey(key)) failures.push({ at: "content/voice/voice.lock.json", message: `approves "${key}", which is not a clip key` });
    else if (!clips.has(key)) notes.push({ at: "content/voice/voice.lock.json", message: `approves ${key.slice(0, 12)}, which no manifest plays` });
  }

  return { failures, notes, clips };
}

/**
 * The manifests with every entry that would play the wrong words taken out, and
 * nothing else changed: no clip is added (that is `voice:generate`), and an
 * entry for a line the game no longer says stays until `--prune`.
 */
export function fixManifest(existing: Manifest, desired: Desired): Manifest {
  return mergeManifest(existing, desired, new Map());
}
