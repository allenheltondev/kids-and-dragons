/**
 * Text in, speech out: the one place `voice:generate` calls a provider.
 *
 * It reuses the bake-off's request builder and sender (bakeoff/providers.ts),
 * which already turn a line, a speaker and a delivery into the exact request a
 * model wants (Gemini 3.8: the character and delivery ride in
 * `speechMetadata.style`, beats in angle brackets) and clean the noise Gemini
 * leaves where a turn ends. So the clip that ships is made the way the clip
 * that was auditioned was.
 *
 * One request per clip (`mode: "lines"`): a clip is one speaker, one voice.
 */

import { engineOf, plan, send, type CastFile, type Fetch, type Keys, type Provider } from "./bakeoff/providers";
import type { Sample } from "./bakeoff/samples";
import type { CastSheet, DesiredSegment, Provider as ProviderChoice } from "./desired";

/** Bake-off cast.json: the delivery vocabulary and beat spellings, shared by every provider. */
export interface DeliveryTables {
  delivery: CastFile["delivery"];
  beats: CastFile["beats"];
}

/** What a provider sent back: the audio, and the audio tokens it billed when it says (Gemini does). */
export interface Synthesized {
  wav: Buffer;
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

export function makeSynthesizer(options: SynthOptions): Synthesizer {
  const engine = engineOf({ provider: options.provider.provider as Provider, model: options.provider.model, mode: "lines", delivery: "tag" });
  return async (segment) => {
    // The last door before a provider (#552): a token left unfilled is a run-time value, perhaps a hero's name.
    if (/\{\w+\}/.test(segment.text)) throw new Error(`refusing to send an unfilled token to a provider: ${segment.key}`);
    const by = baseSpeaker(segment.by);
    const entry = options.cast.speakers[by];
    if (entry === undefined) throw new Error(`"${segment.by}" is not in the cast`);
    const voice = (entry.gemini as { voice?: string } | undefined)?.voice;
    const cast: CastFile = {
      ...(options.cast.accent === undefined ? {} : { accent: options.cast.accent }),
      speakers: { [by]: { describe: entry.who ?? "", ...(voice === undefined ? {} : { gemini: { voice } }) } },
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
    const rendered = await send(job, options.keys, options.fetch);
    if (rendered.ext !== "wav") throw new Error(`expected WAV audio, got ${rendered.ext}`);
    return { wav: rendered.bytes, ...(rendered.audioTokens === undefined ? {} : { audioTokens: rendered.audioTokens }) };
  };
}
