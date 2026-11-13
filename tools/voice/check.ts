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
 *  - an entry whose clips say someone else speaks them than the script and cast
 *    sheet do (`by`, `figure`, `name`): the stage would pulse the wrong figure. `--fix`
 *    writes them as they are today;
 *  - a malformed entry: not a clip key, no clips, a length that is not a
 *    length, or a length no voice could say those words in;
 *  - a clip the manifest names that the site does not have (`checkSources`,
 *    sources.ts): the browser would fetch a 404 mid-sentence.
 *
 * It also notes, for listening, a short line whose clip runs far longer than its
 * speaker takes for those words (`stretchedShortClips`): a take that says the line
 * twice in one clip.
 *
 * Pure: the destinations are asked in sources.ts.
 */

import { isClipKey } from "../../packages/shared/src/voice-clips";
import type { Desired } from "./desired";
import { mergeManifest, sameSpeakers, SHORT_KEY, SHORT_KEY_LENGTH, type Lock, type Manifest } from "./manifest";
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
/**
 * A short line (under RATE_MIN_CHARS, where a rate means nothing) whose clip runs this many times
 * as long as its own speaker takes for that many letters is noted for listening. A one-word line
 * sent alone with its speaker's tags ("Right.", "Hm,") can come back said twice, or said and then
 * mumbled again, in one clip: the table hears the line duplicated in two inflections (Old Ossley in
 * riftlight-ashspan-bridge). The speaker's own pace is the yardstick, so a slow speaker is not
 * flagged for being slow. A note, never a failure: only listening can say the take is wrong.
 */
export const SHORT_CLIP_STRETCH = 3;
const STRETCH_SLACK_MS = 350;
/** A speaker's pace is read from their lines of at least this many letters, and only when they have a few. */
const PACE_MIN_LETTERS = 40;
const PACE_MIN_LINES = 3;

/** About how many sounds the words are: letters, and a digit as a short word. */
function soundedLetters(text: string): number {
  return text.replace(/[^\p{L}]/gu, "").length + text.replace(/\D/g, "").length * 4;
}

const speakerOf = (by: string): string => by.split("#")[0] ?? by;

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
      else if (d.reason === "voice-not-selected") notes.push({ at: `${name} ${d.address}`, message: "someone on this line has no ElevenLabs voice picked yet; the device voice reads it" });
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
        } else if (!sameSpeakers(entry, line)) {
          failures.push({ at, message: "names the wrong speaker for a clip (its `by`, `figure` or `name` is not what the script and cast sheet say), so the stage would pulse the wrong figure. Run `npm run voice:verify -- --fix`" });
        }
      }
    }
  }

  // A short approval stands for every clip whose key begins with it, so two different clips (played
  // today or wanted today) sharing a prefix the lock files an approval under would both be approved
  // by one entry: the lock cannot say which was heard. 64 bits makes that vanishingly unlikely; this
  // is what makes it impossible to miss.
  const byShort = new Map<string, string>();
  const shared = new Set<string>();
  const wantedKeys = [...input.desired.values()].flatMap((desired) => desired.lines.flatMap((line) => line.segments.map((segment) => segment.key)));
  for (const key of [...clips.keys(), ...wantedKeys]) {
    const short = key.slice(0, SHORT_KEY_LENGTH);
    const other = byShort.get(short);
    if (other === undefined) byShort.set(short, key);
    else if (other !== key && input.lock.approved[short] !== undefined && !shared.has(short)) {
      shared.add(short);
      failures.push({ at: "content/voice/voice.lock.json", message: `files an approval under ${short}, which both ${other.slice(0, 24)}… and ${key.slice(0, 24)}… begin with; file each under its whole key` });
    }
  }
  const shortKeys = new Set([...clips.keys()].map((key) => key.slice(0, SHORT_KEY_LENGTH)));
  for (const key of Object.keys(input.lock.approved)) {
    const whole = isClipKey(key);
    if (!whole && !SHORT_KEY.test(key)) failures.push({ at: "content/voice/voice.lock.json", message: `approves "${key}", which is not a clip key` });
    else if (!(whole ? clips.has(key) : shortKeys.has(key))) notes.push({ at: "content/voice/voice.lock.json", message: `approves ${key.slice(0, 12)}, which no manifest plays` });
  }

  notes.push(...stretchedShortClips(input));
  return { failures, notes, clips };
}

/** Short lines whose clip runs far longer than their speaker takes for those words (SHORT_CLIP_STRETCH). */
export function stretchedShortClips(input: ManifestInput): Finding[] {
  interface Played { at: string; by: string; text: string; clip: string; ms: number }
  const played: Played[] = [];
  for (const [name, manifest] of input.manifests) {
    const desired = input.desired.get(name);
    if (desired === undefined) continue;
    for (const line of desired.lines) {
      const entry = manifest[line.address]?.[line.variant];
      if (!Array.isArray(entry)) continue;
      line.segments.forEach((segment, i) => {
        const clip = entry[i];
        // Only a clip that is this segment's take: a stale entry is failed above.
        if (clip?.clip !== segment.key || !Number.isInteger(clip.ms)) return;
        played.push({ at: `content/voice/manifest/${name}.json ${line.address}${line.variant === "" ? "" : ` [${line.variant}]`}`, by: speakerOf(segment.by), text: segment.text, clip: clip.clip, ms: clip.ms });
      });
    }
  }

  const perLetter = new Map<string, number[]>();
  for (const p of played) {
    const letters = soundedLetters(p.text);
    if (letters < PACE_MIN_LETTERS) continue;
    const rates = perLetter.get(p.by) ?? [];
    rates.push(p.ms / letters);
    perLetter.set(p.by, rates);
  }
  const pace = new Map<string, number>();
  for (const [by, rates] of perLetter) {
    if (rates.length < PACE_MIN_LINES) continue;
    const sorted = [...rates].sort((a, b) => a - b);
    pace.set(by, sorted[Math.floor(sorted.length / 2)]!);
  }

  const notes: Finding[] = [];
  const seen = new Set<string>();
  for (const p of played) {
    const msPerLetter = pace.get(p.by);
    if (msPerLetter === undefined || p.text.length >= RATE_MIN_CHARS || seen.has(`${p.at}\u0000${p.clip}`)) continue;
    const expected = soundedLetters(p.text) * msPerLetter + STRETCH_SLACK_MS;
    if (p.ms <= SHORT_CLIP_STRETCH * expected) continue;
    seen.add(`${p.at}\u0000${p.clip}`);
    notes.push({
      at: p.at,
      message: `clip ${p.clip.slice(0, 12)} (${p.by}: ${JSON.stringify(p.text)}) is ${String(p.ms)} ms, ${(p.ms / expected).toFixed(1)} times what ${p.by} takes for those words; listen for the line said twice, and re-take it by editing the line`,
    });
  }
  return notes;
}

/**
 * The manifests with every entry that would play the wrong words taken out, and
 * who speaks each clip written as the script and cast sheet say today. Nothing
 * else changes: no clip is added (that is `voice:generate`), and an entry for a
 * line the game no longer says stays until `--prune`.
 */
export function fixManifest(existing: Manifest, desired: Desired): Manifest {
  return mergeManifest(existing, desired, new Map());
}
