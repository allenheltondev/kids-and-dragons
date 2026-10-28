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
 * same price model as `voice:cost`; a request in flight is reserved against it,
 * so concurrency cannot overshoot.
 */

import type { DesiredSegment } from "./desired";
import type { Encoded } from "./encode";
import type { ClipStore } from "./store";

export interface RenderDeps {
  synth: (segment: DesiredSegment) => Promise<Buffer>;
  encode: (wav: Buffer) => Encoded;
  store: ClipStore;
  /** Dollars one request for this many characters costs. */
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
  dollars: number;
  chars: number;
  /** Every clip now known to exist, with its length: what the manifest is built from. */
  lengths: Map<string, number>;
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
  };
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const attempts = options.attempts ?? 4;
  const backoff = options.backoffMs ?? 2000;
  const queue = [...new Map(owed.map((segment) => [segment.key, segment])).values()];

  const one = async (segment: DesiredSegment): Promise<void> => {
    const there = await deps.store.head(segment.key);
    if (there !== null) {
      report.cached.push(segment.key);
      report.lengths.set(segment.key, there.ms);
      return;
    }
    // Reserve against the caps before the request, synchronously, so workers cannot all pass the check.
    const cost = deps.price(segment.text.length);
    if (options.maxChars !== undefined && report.chars + segment.text.length > options.maxChars) {
      report.stoppedBy ??= "chars";
      report.deferred.push(segment.key);
      return;
    }
    if (report.dollars + cost > options.maxDollars) {
      report.stoppedBy ??= "dollars";
      report.deferred.push(segment.key);
      return;
    }
    report.dollars += cost;
    report.chars += segment.text.length;
    if (!options.render) {
      report.planned.push(segment.key);
      return;
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        const encoded = deps.encode(await deps.synth(segment));
        await deps.store.put(segment.key, encoded.bytes, { ms: encoded.ms });
        report.rendered.push(segment.key);
        report.lengths.set(segment.key, encoded.ms);
        deps.log?.(`rendered ${segment.key.slice(0, 10)} (${segment.by}, ${String(segment.text.length)} chars, ${String(encoded.ms)} ms)`);
        return;
      } catch (error) {
        if (attempt >= attempts) {
          // Not rendered, so not spent: give the reservation back.
          report.dollars -= cost;
          report.chars -= segment.text.length;
          report.failed.push({ key: segment.key, error: (error as Error).message });
          return;
        }
        await sleep(backoff * 2 ** (attempt - 1));
      }
    }
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
