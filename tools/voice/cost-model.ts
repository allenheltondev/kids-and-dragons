/**
 * The API math behind `voice:cost`: characters in, dollars out, for each model
 * in pricing.json. Pure, so the arithmetic is tested and the CLI only prints.
 *
 * Two billing shapes:
 *  - per character (ElevenLabs): the text is the bill;
 *  - per token (Gemini): a little for the text sent, mostly for the audio
 *    returned, so the bill follows how long the voice takes to read it.
 */

export interface SpeechAssumptions {
  charsPerSecond: number;
  charsPerTextToken: number;
  promptTokensPerRequest: number;
}

export interface CharacterRate {
  from?: string;
  until?: string;
  perThousandChars: number;
}

export interface TokenRate {
  from?: string;
  until?: string;
  inputPerMillion: number;
  outputPerMillion: number;
}

export type PricedModel =
  | { id: string; provider: string; label: string; billing: "characters"; rates: CharacterRate[]; confirmed: boolean; source: string }
  | { id: string; provider: string; label: string; billing: "tokens"; rates: TokenRate[]; batchDiscount?: number; confirmed: boolean; source: string };

export interface Pricing {
  checked: string;
  speech: SpeechAssumptions;
  models: PricedModel[];
}

/** What gets sent: characters billed, and how many requests carry them. */
export interface Workload {
  chars: number;
  requests: number;
}

export interface Quote {
  model: string;
  label: string;
  dollars: number;
  /** Seconds of audio the workload becomes, at the assumed reading speed. */
  audioSeconds: number;
  confirmed: boolean;
}

/** The rate in force on `day` (YYYY-MM-DD), or null when none covers it. */
export function rateOn<T extends { from?: string; until?: string }>(rates: readonly T[], day: string): T | null {
  return rates.find((rate) => (rate.from === undefined || rate.from <= day) && (rate.until === undefined || day <= rate.until)) ?? null;
}

export function audioSeconds(chars: number, speech: SpeechAssumptions): number {
  return chars / speech.charsPerSecond;
}

/** Gemini's audio tokens: 25 for each second it speaks. */
export const AUDIO_TOKENS_PER_SECOND = 25;

export function quote(model: PricedModel, work: Workload, speech: SpeechAssumptions, day: string, batch = false): Quote | null {
  const seconds = audioSeconds(work.chars, speech);
  if (model.billing === "characters") {
    const rate = rateOn(model.rates, day);
    if (rate === null) return null;
    return { model: model.id, label: model.label, dollars: (work.chars / 1000) * rate.perThousandChars, audioSeconds: seconds, confirmed: model.confirmed };
  }
  const rate = rateOn(model.rates, day);
  if (rate === null) return null;
  const input = work.chars / speech.charsPerTextToken + work.requests * speech.promptTokensPerRequest;
  const output = seconds * AUDIO_TOKENS_PER_SECOND;
  const full = (input * rate.inputPerMillion + output * rate.outputPerMillion) / 1_000_000;
  const discount = batch ? (model.batchDiscount ?? 1) : 1;
  return { model: model.id, label: model.label, dollars: full * discount, audioSeconds: seconds, confirmed: model.confirmed };
}

export function dollars(amount: number): string {
  if (amount < 0.01 && amount > 0) return "<$0.01";
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function hours(seconds: number): string {
  const h = seconds / 3600;
  return h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(seconds / 60)} min`;
}
