/**
 * Which clips the game wants (docs/voice-narration-plan.md §4, `voice:status`).
 *
 * Reads the line inventory, the cast sheet and the script sidecars and says,
 * for every spoken line and every token variant, the clips that would be
 * rendered and their keys. Pure: nothing is rendered, read from the bucket or
 * priced here.
 *
 * Who reads a line:
 *  - no script entry: the narrator reads all of it, one clip;
 *  - a fresh script: one clip per script line, each in its speaker's voice;
 *  - a stale or broken script: the device voice, no clips. Half a recording of
 *    changed words is worse than none.
 */

import type { ClassifiedLine } from "./lines";
import { clipKey, spokenForm, stableStringify, type Lexicon } from "./clip-key";
import { scriptReport, type ScriptEntry, type ScriptFile } from "./script";

export interface CastSpeaker {
  who?: string;
  gemini?: Record<string, unknown>;
  elevenlabs?: { voiceId?: string; name?: string; approved?: boolean };
  accent?: string;
  direction?: string;
  [field: string]: unknown;
}

export interface CastSheet {
  accent?: string;
  speakers: Record<string, CastSpeaker>;
}

export interface Provider {
  provider: string;
  model: string;
}

/** Gemini 3.8 Flash TTS, decided 2026-10-28 (docs/voice-narration-plan.md) and dropped for ElevenLabs on 2026-11-05. Still what the bake-off can audition. */
export const GEMINI: Provider = { provider: "gemini", model: "gemini-3.8-flash-tts" };

/** What the game's narration is rendered with (docs/voice-narration-plan.md, "Provider"). Its price is the `apiModel` row in pricing.json. */
export const ELEVENLABS: Provider = { provider: "elevenlabs", model: "eleven_v4" };

export interface DesiredSegment {
  key: string;
  by: string;
  /** What is sent to the provider. */
  text: string;
  delivery?: string;
}

export interface DesiredLine {
  address: string;
  chapter: string;
  campaign: string;
  /** `""`, or e.g. `party=2,facets=0`. */
  variant: string;
  segments: DesiredSegment[];
}

export type DeviceVoiceReason = "stale-script" | "broken-script" | "uncast-speaker";

export interface Desired {
  lines: DesiredLine[];
  /** Lines the device voice reads, and why. */
  deviceVoice: { address: string; chapter: string; reason: DeviceVoiceReason }[];
}

export interface DesireOptions {
  cast: CastSheet;
  /** Script sidecars by chapter id. */
  scripts: ReadonlyMap<string, ScriptFile>;
  provider?: Provider;
  lexicon?: Lexicon;
  /**
   * What each delivery name means (bakeoff cast.json `delivery`): the style
   * words a provider is given. They are in the key, so rewording "whisper"
   * re-renders the lines that whisper and nobody else's.
   */
  deliveries?: Readonly<Record<string, unknown>>;
}

/**
 * What reaches the provider about a voice. Changing any of it re-renders that
 * speaker's lines and nobody else's.
 *
 *  - ElevenLabs: the voice's id and the accent and direction that go in front of each line as tags. The speaker's
 *    description never reaches ElevenLabs, so rewording it moves nothing. `undefined` while nobody has picked a
 *    voice for them: their lines go to the device voice, not to somebody else's.
 *  - Anything else (Gemini, the fake tones): the pinned voice config, the cast's accent and the description.
 */
export function voiceOf(cast: CastSheet, speaker: string, provider: Provider = ELEVENLABS): unknown {
  const entry = cast.speakers[speaker];
  if (entry === undefined) return undefined;
  if (provider.provider === "elevenlabs") {
    const voiceId = entry.elevenlabs?.voiceId;
    if (voiceId === undefined || voiceId === "") return undefined;
    return { voiceId, accent: entry.accent, direction: entry.direction, defaultAccent: cast.accent };
  }
  return { ...entry.gemini, accent: cast.accent, who: entry.who };
}

function baseSpeaker(by: string): string {
  return by.split("#")[0] ?? by;
}

export function desiredClips(lines: readonly ClassifiedLine[], options: DesireOptions): Desired {
  const provider = options.provider ?? ELEVENLABS;
  const out: Desired = { lines: [], deviceVoice: [] };
  const speakers = new Set(Object.keys(options.cast.speakers));
  const voiced = (by: string): boolean => voiceOf(options.cast, baseSpeaker(by), provider) !== undefined;
  const segment = (by: string, text: string, variant: string, delivery?: string): DesiredSegment | null => {
    const voice = voiceOf(options.cast, baseSpeaker(by), provider);
    if (voice === undefined) return null;
    const spoken = spokenForm(text, variant, options.lexicon);
    if (spoken === "") return null;
    const meaning = delivery === undefined ? undefined : options.deliveries?.[delivery] ?? delivery;
    const key = clipKey({ ...provider, voice, ...(meaning !== undefined ? { delivery: stableStringify(meaning) } : {}), text: spoken });
    return { key, by, text: spoken, ...(delivery ? { delivery } : {}) };
  };

  for (const line of lines) {
    const entry = options.scripts.get(line.chapter)?.[line.address] as ScriptEntry | string | undefined;
    let cut: ScriptEntry | null = null;
    if (typeof entry === "object") {
      const report = scriptReport({ [line.address]: entry }, { chapter: line.chapter, lines: new Map([[line.address, line.text]]), speakers });
      const state = report.state[line.address];
      if (state === "stale") {
        out.deviceVoice.push({ address: line.address, chapter: line.chapter, reason: "stale-script" });
        continue;
      }
      if (state === "broken") {
        const uncast = entry.lines.some((l) => !speakers.has(baseSpeaker(l.by)));
        out.deviceVoice.push({ address: line.address, chapter: line.chapter, reason: uncast ? "uncast-speaker" : "broken-script" });
        continue;
      }
      cut = entry;
    }

    // Anyone on the line with no voice yet (an ElevenLabs voice is picked by ear, never assigned) leaves the whole
    // line to the device voice: half a line in the right voice and half in none would read worse than either.
    if ((cut === null ? ["narrator"] : cut.lines.map((l) => l.by)).some((by) => !voiced(by))) {
      out.deviceVoice.push({ address: line.address, chapter: line.chapter, reason: "uncast-speaker" });
      continue;
    }

    for (const variant of line.variants) {
      const segments = (cut === null ? [{ by: "narrator", text: line.text } as { by: string; text: string; delivery?: string }] : cut.lines)
        // Beats (`<sigh>`, `[sighs]`) stay: an adapter turns them into sound, so they are part of the key.
        .map((part) => segment(part.by, part.text, variant, part.delivery))
        .filter((s): s is DesiredSegment => s !== null);
      if (segments.length === 0) continue;
      out.lines.push({ address: line.address, chapter: line.chapter, campaign: line.campaign, variant, segments });
    }
  }
  return out;
}
