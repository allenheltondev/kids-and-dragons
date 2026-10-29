/**
 * Render what is owed (docs/voice-narration-plan.md §4, `voice:generate`).
 *
 * For each distinct clip still to make: ask the store whether it already has
 * the key (that is the generation cache: a key that exists is never rendered
 * again), otherwise check the budget, synthesise, encode, and keep it. Every
 * collaborator is passed in, so the whole loop is tested with a fake voice and
 * an in-memory store, and so a dry run costs nothing.
 *
 * The spend cap is checked *before* the request that would cross it, with the
 * same price model as `voice:cost`. Every provider call counts, retries
 * included, and a failed one is not refunded: it may have been billed. A
 * request in flight is reserved against the cap, so concurrency cannot
 * overshoot. The total is an estimate of spend, not a billing ceiling.
 */

import type { Desired, DesiredSegment } from "./desired";
import type { Encoded } from "./encode";
import type { ClipStore } from "./store";

export interface RenderDeps {
  /** The provider call: WAV audio, and the audio tokens billed when the provider reports them. */
  synth: (segment: DesiredSegment) => Promise<Buffer | { wav: Buffer; audioTokens?: number }>;
  encode: (wav: Buffer) => Encoded;
  store: ClipStore;
  /** Dollars one request for this many characters costs (an estimate). */
  price: (chars: number) => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export interface RenderOptions {
  /** Actually call the provider. False reports what would happen and spends nothing. */
  render: boolean;
  maxDollars: number;
  maxChars?: number;
  concurrency?: number;
  /** Tries per clip, including the first. */
  attempts?: number;
  backoffMs?: number;
}

export interface RenderReport {
  /** Rendered and kept this run. */
  rendered: string[];
  /** Already in the store: no provider call. */
  cached: string[];
  /** Would be rendered, in a dry run. */
  planned: string[];
  failed: { key: string; error: string }[];
  /** Left undone because the next request would cross a cap. */
  deferred: string[];
  stoppedBy: "dollars" | "chars" | null;
  /** Estimated spend: every provider call made, retries and failures included. */
  dollars: number;
  /** Characters sent to the provider, every try counted. */
  chars: number;
  /** Every clip now known to exist, with its length: what the manifest is built from. */
  lengths: Map<string, number>;
  /**
   * What the provider billed, measured: audio tokens it reported and the seconds of audio
   * they were for (before trimming). `tokensPerSecond` is the rate to put in pricing.json
   * once enough clips are measured; null until a provider reports tokens.
   */
  measured: { audioTokens: number; seconds: number; clips: number; tokensPerSecond: number | null };
}

/** Seconds of audio in a 16-bit PCM WAV (what the providers here return), or null if it is not one. */
export function wavSeconds(wav: Buffer): number | null {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") return null;
  const byteRate = wav.readUInt32LE(28);
  const dataBytes = wav.readUInt32LE(40);
  return byteRate > 0 ? dataBytes / byteRate : null;
}

export async function renderOwed(owed: readonly DesiredSegment[], deps: RenderDeps, options: RenderOptions): Promise<RenderReport> {
  const report: RenderReport = {
    rendered: [],
    cached: [],
    planned: [],
    failed: [],
    deferred: [],
    stoppedBy: null,
    dollars: 0,
    chars: 0,
    lengths: new Map(),
    measured: { audioTokens: 0, seconds: 0, clips: 0, tokensPerSecond: null },
  };
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const attempts = options.attempts ?? 4;
  const backoff = options.backoffMs ?? 2000;
  const queue = [...new Map(owed.map((segment) => [segment.key, segment])).values()];

  /** Reserve one provider call against the caps, synchronously, so workers cannot all pass the check. */
  const reserve = (chars: number, cost: number): boolean => {
    if (options.maxChars !== undefined && report.chars + chars > options.maxChars) {
      report.stoppedBy ??= "chars";
      return false;
    }
    if (report.dollars + cost > options.maxDollars) {
      report.stoppedBy ??= "dollars";
      return false;
    }
    report.dollars += cost;
    report.chars += chars;
    return true;
  };

  const one = async (segment: DesiredSegment): Promise<void> => {
    const there = await deps.store.head(segment.key);
    if (there !== null) {
      report.cached.push(segment.key);
      report.lengths.set(segment.key, there.ms);
      return;
    }
    const chars = segment.text.length;
    const cost = deps.price(chars);
    if (!options.render) {
      if (reserve(chars, cost)) report.planned.push(segment.key);
      else report.deferred.push(segment.key);
      return;
    }
    let lastError = "";
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      // Every try is a request the provider may bill, so each one is reserved against the cap
      // and none is refunded when it fails: a retry that would cross the cap is not made.
      if (!reserve(chars, cost)) {
        if (attempt === 1) report.deferred.push(segment.key);
        else report.failed.push({ key: segment.key, error: `${lastError} (retry stopped by the ${report.stoppedBy === "chars" ? "character" : "spend"} cap)` });
        return;
      }
      try {
        const said = await deps.synth(segment);
        const wav = Buffer.isBuffer(said) ? said : said.wav;
        const tokens = Buffer.isBuffer(said) ? undefined : said.audioTokens;
        const seconds = wavSeconds(wav);
        if (tokens !== undefined && seconds !== null && seconds > 0) {
          report.measured.audioTokens += tokens;
          report.measured.seconds += seconds;
          report.measured.clips += 1;
          report.measured.tokensPerSecond = report.measured.audioTokens / report.measured.seconds;
        }
        const encoded = deps.encode(wav);
        await deps.store.put(segment.key, encoded.bytes, { ms: encoded.ms });
        report.rendered.push(segment.key);
        report.lengths.set(segment.key, encoded.ms);
        deps.log?.(`rendered ${segment.key.slice(0, 10)} (${segment.by}, ${String(chars)} chars, ${String(encoded.ms)} ms)`);
        return;
      } catch (error) {
        lastError = (error as Error).message;
        if (attempt < attempts) await sleep(backoff * 2 ** (attempt - 1));
      }
    }
    report.failed.push({ key: segment.key, error: lastError });
  };

  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const at = next;
      next += 1;
      const segment = queue[at];
      if (segment === undefined) return;
      // Once a cap has stopped the run, nothing later is attempted.
      if (report.stoppedBy !== null) {
        report.deferred.push(segment.key);
        continue;
      }
      await one(segment);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 4) }, worker));
  return report;
}

/**
 * The clips to put to the destination: *every* clip the game wants, not only
 * the ones the manifest does not list. The manifest records what was rendered
 * somewhere; it cannot say whether *this* bucket has it. A new production
 * bucket, a half-uploaded staging one or a deleted object is only repaired if
 * its HEAD is asked. `renderOwed` asks it for each and skips what is there.
 */
export function candidates(desired: readonly Pick<Desired, "lines">[], speaker?: string): DesiredSegment[] {
  const out = new Map<string, DesiredSegment>();
  for (const group of desired) {
    for (const line of group.lines) {
      for (const segment of line.segments) {
        if (speaker === undefined || segment.by.split("#")[0] === speaker) out.set(segment.key, segment);
      }
    }
  }
  return [...out.values()];
}
