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

/** Gemini 3.8 Flash TTS, decided 2026-10-28 (docs/voice-narration-plan.md). */
export const GEMINI: Provider = { provider: "gemini", model: "gemini-3.8-flash-tts" };

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
 * What reaches the provider about a voice: the pinned voice config, the cast's
 * accent and the speaker's description (Gemini is steered by it). Changing any
 * of them re-renders that speaker's lines and nobody else's.
 */
export function voiceOf(cast: CastSheet, speaker: string): unknown {
  const entry = cast.speakers[speaker];
  if (entry === undefined) return undefined;
  return { ...entry.gemini, accent: cast.accent, who: entry.who };
}

function baseSpeaker(by: string): string {
  return by.split("#")[0] ?? by;
}

export function desiredClips(lines: readonly ClassifiedLine[], options: DesireOptions): Desired {
  const provider = options.provider ?? GEMINI;
  const out: Desired = { lines: [], deviceVoice: [] };
  const speakers = new Set(Object.keys(options.cast.speakers));
  const segment = (by: string, text: string, variant: string, delivery?: string): DesiredSegment | null => {
    const voice = voiceOf(options.cast, baseSpeaker(by));
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
