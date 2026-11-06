/**
 * Text in, speech out: the one place `voice:generate` calls a provider.
 *
 * It reuses the bake-off's request builder and sender (bakeoff/providers.ts),
 * which already turn a line, a speaker and a delivery into the exact request a
 * model wants (ElevenLabs v3 and later: the character's accent and direction
 * and the line's delivery go in front as audio tags, beats in brackets; Gemini
 * 3.8: they ride in `speechMetadata.style`). So the clip that ships is made
 * the way the clip that was auditioned was.
 *
 * One request per clip (`mode: "lines"`): a clip is one speaker, one voice.
 */

import { engineOf, plan, send, type CastFile, type Fetch, type Job, type Keys, type Provider } from "./bakeoff/providers";
import type { Sample } from "./bakeoff/samples";
import type { CastSheet, DesiredSegment, Provider as ProviderChoice } from "./desired";

/** Bake-off cast.json: the delivery vocabulary and beat spellings, shared by every provider. */
export interface DeliveryTables {
  delivery: CastFile["delivery"];
  beats: CastFile["beats"];
}

/** What a provider sent back: the audio (ElevenLabs sends MP3, Gemini and the fake tones WAV), and the audio tokens it billed when it says (Gemini does). */
export interface Synthesized {
  audio: Buffer;
  ext: "wav" | "mp3";
  audioTokens?: number;
}

export type Synthesizer = (segment: DesiredSegment) => Promise<Synthesized>;

export interface SynthOptions {
  provider: ProviderChoice | { provider: "fake"; model: string };
  cast: CastSheet;
  tables: DeliveryTables;
  keys: Keys;
  fetch: Fetch;
}

function baseSpeaker(by: string): string {
  return by.split("#")[0] ?? by;
}

/** The one request a clip is: what is sent, and so what is billed. */
function jobFor(options: SynthOptions, segment: DesiredSegment): Job {
  const engine = engineOf({ provider: options.provider.provider as Provider, model: options.provider.model, mode: "lines", delivery: "tag" });
  const by = baseSpeaker(segment.by);
  const entry = options.cast.speakers[by];
  if (entry === undefined) throw new Error(`"${segment.by}" is not in the cast`);
  const voice = (entry.gemini as { voice?: string } | undefined)?.voice;
  const voiceId = entry.elevenlabs?.voiceId;
  const cast: CastFile = {
    ...(options.cast.accent === undefined ? {} : { accent: options.cast.accent }),
    speakers: {
      [by]: {
        describe: entry.who ?? "",
        ...(entry.accent === undefined ? {} : { accent: entry.accent }),
        ...(entry.direction === undefined ? {} : { direction: entry.direction }),
        ...(voice === undefined ? {} : { gemini: { voice } }),
        ...(voiceId === undefined ? {} : { elevenlabs: { voiceId } }),
      },
    },
    delivery: options.tables.delivery,
    beats: options.tables.beats,
  };
  const sample: Sample = {
    id: segment.key.slice(0, 12),
    tier: "game",
    title: segment.key,
    tests: "",
    address: segment.key,
    source: segment.text,
    lines: [{ by, text: segment.text, ...(segment.delivery ? { delivery: segment.delivery } : {}) }],
    speakers: [by],
  };
  const jobs = plan(engine, cast, sample, 1);
  if (!Array.isArray(jobs)) throw new Error(jobs.reason);
  const job = jobs[0];
  if (job === undefined) throw new Error("no request was planned");
  return job;
}

/** Characters the provider bills for a clip: the words plus the accent, direction and delivery tags sent in front of them. */
export function makeBilledChars(options: SynthOptions): (segment: DesiredSegment) => number {
  return (segment) => jobFor(options, segment).chars;
}

export function makeSynthesizer(options: SynthOptions): Synthesizer {
  return async (segment) => {
    // The last door before a provider (#552): a token left unfilled is a run-time value, perhaps a hero's name.
    if (/\{\w+\}/.test(segment.text)) throw new Error(`refusing to send an unfilled token to a provider: ${segment.key}`);
    const rendered = await send(jobFor(options, segment), options.keys, options.fetch);
    return { audio: rendered.bytes, ext: rendered.ext, ...(rendered.audioTokens === undefined ? {} : { audioTokens: rendered.audioTokens }) };
  };
}
