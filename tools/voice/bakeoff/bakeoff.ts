/**
 * The bake-off run, as a function the CLI and the tests share
 * (docs/voice-bakeoff.md): plan every request, price the ones not already
 * cached, refuse to start over budget, render what is missing, then write
 * results.json and the listening page.
 *
 * Clips are cached by request (providers.ts): `clips/<key>.<ext>` plus a small
 * `<key>.json` with how it went. A request that has been rendered is never
 * sent again, so re-running after adding one sample, one engine or one take
 * costs exactly that sample, engine or take.
 */

import fs from "node:fs";
import path from "node:path";
import { quote, type Pricing } from "../cost-model.ts";
import { renderPage, type Cell, type ClipRef, type Results } from "./page.ts";
import { plan, send, type CastFile, type Engine, type Fetch, type Job, type Keys, type Unsupported } from "./providers.ts";
import type { Sample } from "./samples.ts";

export interface BakeoffOptions {
  outDir: string;
  /** Every engine in engines.json; the page shows any of them that has clips. */
  engines: Engine[];
  /** The engines to render now. */
  selected: string[];
  samples: Sample[];
  tiers: Record<string, string>;
  cast: CastFile;
  pricing: Pricing;
  takes: number;
  maxDollars: number;
  dryRun: boolean;
  concurrency: number;
  keys: Keys;
  fetch: Fetch;
  today: string;
  log: (line: string) => void;
}

export interface EstimateRow {
  engine: string;
  requests: number;
  chars: number;
  dollars: number | null;
}

export interface BakeoffOutcome {
  estimate: EstimateRow[];
  dollars: number;
  rendered: number;
  cached: number;
  failed: number;
  refused?: string;
  page?: string;
}

interface ClipMeta {
  ext: "mp3" | "wav";
  chars: number;
  renderMs: number;
  bytes: number;
  at: string;
}

function isUnsupported(value: Job[] | Unsupported): value is Unsupported {
  return !Array.isArray(value);
}

function clipMeta(dir: string, key: string): ClipMeta | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), "utf8")) as ClipMeta;
  } catch {
    return null;
  }
}

async function pool<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await work(item);
    }
  });
  await Promise.all(runners);
}

export async function runBakeoff(options: BakeoffOptions): Promise<BakeoffOutcome> {
  const clips = path.join(options.outDir, "clips");
  fs.mkdirSync(clips, { recursive: true });

  // Every job for every engine, so the page can show what earlier runs rendered too.
  const plans = new Map<string, Map<string, (Job[] | Unsupported)[]>>();
  for (const engine of options.engines) {
    const bySample = new Map<string, (Job[] | Unsupported)[]>();
    for (const sample of options.samples) {
      bySample.set(sample.id, Array.from({ length: options.takes }, (_, i) => plan(engine, options.cast, sample, i + 1)));
    }
    plans.set(engine.id, bySample);
  }

  const todo: Job[] = [];
  let cached = 0;
  for (const id of options.selected) {
    const seen = new Set<string>();
    for (const takes of plans.get(id)?.values() ?? []) {
      for (const take of takes) {
        if (isUnsupported(take)) continue;
        for (const job of take) {
          if (seen.has(job.key)) continue;
          seen.add(job.key);
          if (clipMeta(clips, job.key) !== null) cached += 1;
          else todo.push(job);
        }
      }
    }
  }

  const estimate: EstimateRow[] = options.selected.map((id) => {
    const engine = options.engines.find((e) => e.id === id)!;
    const jobs = todo.filter((job) => job.engine === id);
    const chars = jobs.reduce((sum, job) => sum + job.chars, 0);
    const model = options.pricing.models.find((m) => m.id === engine.pricing);
    const priced = engine.provider === "fake" ? 0 : model ? (quote(model, { chars, requests: jobs.length }, options.pricing.speech, options.today)?.dollars ?? null) : null;
    return { engine: id, requests: jobs.length, chars, dollars: priced };
  });
  const dollars = estimate.reduce((sum, row) => sum + (row.dollars ?? 0), 0);
  for (const row of estimate) {
    const price = row.dollars === null ? "no price in pricing.json" : `about $${row.dollars.toFixed(2)}`;
    options.log(`  ${row.engine.padEnd(28)} ${String(row.requests).padStart(4)} requests ${String(row.chars).padStart(7)} chars  ${price}`);
  }
  options.log(`  ${"total".padEnd(28)} ${String(todo.length).padStart(4)} requests, about $${dollars.toFixed(2)} (${String(cached)} already cached, free)`);

  const outcome: BakeoffOutcome = { estimate, dollars, rendered: 0, cached, failed: 0 };
  if (dollars > options.maxDollars) {
    outcome.refused = `That is over the $${options.maxDollars.toFixed(2)} cap. Narrow it with --engines, --samples or --tier, or raise --max-dollars.`;
    return outcome;
  }
  if (options.dryRun) return outcome;

  const errors = new Map<string, string>();
  let done = 0;
  await pool(todo, options.concurrency, async (job) => {
    const started = Date.now();
    try {
      const audio = await send(job, options.keys, options.fetch);
      fs.writeFileSync(path.join(clips, `${job.key}.${audio.ext}`), audio.bytes);
      const meta: ClipMeta = { ext: audio.ext, chars: job.chars, renderMs: Date.now() - started, bytes: audio.bytes.length, at: new Date().toISOString() };
      fs.writeFileSync(path.join(clips, `${job.key}.json`), JSON.stringify(meta));
      outcome.rendered += 1;
    } catch (error) {
      errors.set(job.key, (error as Error).message);
      outcome.failed += 1;
    }
    done += 1;
    if (done === todo.length || done % Math.max(10, Math.ceil(todo.length / 4)) === 0) options.log(`  rendered ${String(done)}/${String(todo.length)}`);
  });

  // Last run's failures, kept so the page can say why a cell is empty; a success clears them.
  const errorFile = path.join(options.outDir, "errors.json");
  const lastErrors = fs.existsSync(errorFile) ? (JSON.parse(fs.readFileSync(errorFile, "utf8")) as Record<string, string>) : {};
  for (const [key, message] of errors) lastErrors[key] = message;
  for (const key of Object.keys(lastErrors)) if (clipMeta(clips, key) !== null) delete lastErrors[key];
  fs.writeFileSync(errorFile, JSON.stringify(lastErrors, null, 2));

  const cells: Results["cells"] = {};
  const shown: Results["engines"] = [];
  for (const engine of options.engines) {
    const bySample: Record<string, Cell> = {};
    let any = false;
    for (const sample of options.samples) {
      const takes = plans.get(engine.id)?.get(sample.id) ?? [];
      const first = takes[0];
      if (first !== undefined && isUnsupported(first)) {
        bySample[sample.id] = { unsupported: first.reason };
        continue;
      }
      const rendered = takes.map((take) => {
        const jobs = take as Job[];
        const refs: ClipRef[] = [];
        let error: string | undefined;
        for (const job of jobs) {
          const meta = clipMeta(clips, job.key);
          if (meta === null) {
            error ??= lastErrors[job.key] ?? undefined;
            continue;
          }
          refs.push({ file: `clips/${job.key}.${meta.ext}`, lines: job.lines, chars: meta.chars, renderMs: meta.renderMs });
        }
        const complete = refs.length === jobs.length;
        return { complete, clips: refs, ...(complete ? {} : { error: error ?? "Not rendered yet." }) };
      });
      if (rendered.some((take) => take.clips.length > 0 || take.error !== "Not rendered yet.")) any = true;
      bySample[sample.id] = { takes: rendered.map(({ complete: _complete, ...take }) => take) };
    }
    if (any || options.selected.includes(engine.id)) {
      cells[engine.id] = bySample;
      shown.push({ id: engine.id, label: engine.label, provider: engine.provider, model: engine.model, mode: engine.mode });
    }
  }

  const results: Results = { generated: new Date().toISOString(), tiers: options.tiers, samples: options.samples, engines: shown, cells };
  fs.writeFileSync(path.join(options.outDir, "results.json"), JSON.stringify(results, null, 2));
  const page = path.join(options.outDir, "index.html");
  fs.writeFileSync(page, renderPage(results));
  outcome.page = page;
  return outcome;
}
