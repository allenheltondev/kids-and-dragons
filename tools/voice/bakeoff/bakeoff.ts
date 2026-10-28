/**
 * The bake-off's moving parts, shared by the command line and the live page's
 * server (docs/voice-bakeoff.md): price a column, render one cell, and build
 * what the page shows from what is already on disk.
 *
 * Clips are cached by request (providers.ts): `clips/<key>.<ext>` plus a small
 * `<key>.json` with how it went. A request that has been rendered is never
 * sent again, so adding one sample, one column or one take costs exactly that
 * sample, column or take. The last failure of each request is kept in
 * `errors.json`, so a cell can say why it is empty; a success clears it.
 */

import fs from "node:fs";
import path from "node:path";
import { quote, type Pricing } from "../cost-model.ts";
import { CLEANER_VERSION, cleanPcm16, readWav16 } from "./clean.ts";
import { renderPage, type Cell, type ClipRef, type Results } from "./page.ts";
import { jobEndsOnSound, pcmToWav, plan, send, type CastFile, type Engine, type Fetch, type Job, type Keys, type Unsupported } from "./providers.ts";
import type { Sample } from "./samples.ts";

export interface Workspace {
  outDir: string;
  cast: CastFile;
  pricing: Pricing;
  /** YYYY-MM-DD, for dated prices. */
  today: string;
}

export interface Estimate {
  engine: string;
  /** Requests still to send. */
  requests: number;
  chars: number;
  /** Requests already on disk: free. */
  cached: number;
  /** Null when pricing.json has no price for this model. */
  dollars: number | null;
}

interface ClipMeta {
  ext: "mp3" | "wav";
  chars: number;
  renderMs: number;
  bytes: number;
  at: string;
  /** Gemini clips: the cleaner version that cleaned them (true is version 1), with the raw audio kept at `<key>.raw.wav`. */
  cleaned?: boolean | number;
  removedMs?: number;
  /** The line ends on a sound the cleaner kept (a laugh, a sigh): what `npm run voice:clean` must assume too. */
  endsOnSound?: boolean;
}

/**
 * A Gemini clip rendered before this cleaner: clean it now, from its raw copy
 * when it has one (a clip cleaned by an older cleaner), or from itself (a clip
 * rendered before cleaning existed, which becomes the raw copy). Costs
 * nothing, sends nothing.
 */
function ensureCleaned(ws: Workspace, job: Job, meta: ClipMeta): ClipMeta {
  if (job.provider !== "gemini" || meta.ext !== "wav" || meta.cleaned === CLEANER_VERSION) return meta;
  const file = path.join(clipsOf(ws), `${job.key}.wav`);
  const rawFile = path.join(clipsOf(ws), `${job.key}.raw.wav`);
  const source = meta.cleaned && fs.existsSync(rawFile) ? rawFile : meta.cleaned ? null : file;
  if (source === null) return meta;
  const wav = readWav16(fs.readFileSync(source));
  if (wav === null) return meta;
  const ending = jobEndsOnSound(job);
  const cleaned = cleanPcm16(wav.pcm, wav.rate, { endsOnSound: ending });
  if (source === file) fs.writeFileSync(rawFile, pcmToWav(wav.pcm, wav.rate));
  fs.writeFileSync(file, pcmToWav(cleaned.pcm, wav.rate));
  const next: ClipMeta = { ...meta, cleaned: CLEANER_VERSION, removedMs: cleaned.removed.reduce((sum, r) => sum + r.endMs - r.startMs, 0), ...(ending ? { endsOnSound: true } : {}) };
  fs.writeFileSync(path.join(clipsOf(ws), `${job.key}.json`), JSON.stringify(next));
  return next;
}

const clipsOf = (ws: Workspace): string => path.join(ws.outDir, "clips");

function isUnsupported(value: Job[] | Unsupported): value is Unsupported {
  return !Array.isArray(value);
}

function clipMeta(ws: Workspace, key: string): ClipMeta | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(clipsOf(ws), `${key}.json`), "utf8")) as ClipMeta;
  } catch {
    return null;
  }
}

function readErrors(ws: Workspace): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(path.join(ws.outDir, "errors.json"), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeErrors(ws: Workspace, errors: Record<string, string>): void {
  for (const key of Object.keys(errors)) if (clipMeta(ws, key) !== null) delete errors[key];
  fs.writeFileSync(path.join(ws.outDir, "errors.json"), JSON.stringify(errors, null, 2));
}

/** What a column would cost on this model, from pricing.json; 0 for the fake engine. */
export function priceOf(engine: Engine, chars: number, requests: number, ws: Workspace): number | null {
  if (engine.provider === "fake") return 0;
  const model = ws.pricing.models.find((m) => m.provider === engine.provider && m.apiModel === engine.model);
  if (model === undefined) return null;
  return quote(model, { chars, requests }, ws.pricing.speech, ws.today)?.dollars ?? null;
}

/** The distinct requests a column makes over these samples and takes. */
function jobsFor(engine: Engine, samples: readonly Sample[], takes: number, cast: CastFile): Job[] {
  const seen = new Map<string, Job>();
  for (const sample of samples) {
    for (let take = 1; take <= takes; take += 1) {
      const planned = plan(engine, cast, sample, take);
      if (isUnsupported(planned)) continue;
      for (const job of planned) if (!seen.has(job.key)) seen.set(job.key, job);
    }
  }
  return [...seen.values()];
}

export function estimate(engine: Engine, samples: readonly Sample[], takes: number, ws: Workspace): Estimate {
  const jobs = jobsFor(engine, samples, takes, ws.cast);
  const todo = jobs.filter((job) => clipMeta(ws, job.key) === null);
  const chars = todo.reduce((sum, job) => sum + job.chars, 0);
  return { engine: engine.id, requests: todo.length, chars, cached: jobs.length - todo.length, dollars: priceOf(engine, chars, todo.length, ws) };
}

/** A sample's cell for one column, from what is on disk. Renders nothing. */
export function cellOf(engine: Engine, sample: Sample, takes: number, ws: Workspace, errors = readErrors(ws)): Cell {
  const first = plan(engine, ws.cast, sample, 1);
  if (isUnsupported(first)) return { unsupported: first.reason };
  const all = Array.from({ length: takes }, (_, i) => (i === 0 ? first : (plan(engine, ws.cast, sample, i + 1) as Job[])));
  return {
    takes: all.map((jobs) => {
      const clips: ClipRef[] = [];
      let error: string | undefined;
      for (const job of jobs) {
        const found = clipMeta(ws, job.key);
        if (found === null) {
          error ??= errors[job.key];
          continue;
        }
        const meta = ensureCleaned(ws, job, found);
        clips.push({
          // A cleaned clip gets its own URL: the server tells browsers to keep clips for a year, and one
          // that played the uncleaned file under the same name would go on playing it.
          file: `clips/${job.key}.${meta.ext}${meta.cleaned ? `?cleaned=${String(meta.cleaned === true ? 1 : meta.cleaned)}` : ""}`,
          lines: job.lines,
          chars: meta.chars,
          renderMs: meta.renderMs,
          ...(meta.cleaned ? { raw: `clips/${job.key}.raw.wav`, removedMs: meta.removedMs ?? 0 } : {}),
        });
      }
      if (clips.length === jobs.length) return { clips };
      return { clips, ...(error !== undefined ? { error } : {}), pending: true };
    }),
  };
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

export interface RenderOutcome {
  rendered: number;
  failed: number;
  errors: string[];
}

/** Sends whichever of these jobs are not on disk yet. Failures are recorded, never thrown. */
export async function renderJobs(jobs: readonly Job[], ws: Workspace, keys: Keys, fetch: Fetch, concurrency: number, onDone?: (done: number, of: number) => void): Promise<RenderOutcome> {
  fs.mkdirSync(clipsOf(ws), { recursive: true });
  const todo = jobs.filter((job) => clipMeta(ws, job.key) === null);
  const errors = readErrors(ws);
  const outcome: RenderOutcome = { rendered: 0, failed: 0, errors: [] };
  let done = 0;
  await pool(todo, concurrency, async (job) => {
    const started = Date.now();
    try {
      const audio = await send(job, keys, fetch);
      fs.writeFileSync(path.join(clipsOf(ws), `${job.key}.${audio.ext}`), audio.bytes);
      if (audio.raw) fs.writeFileSync(path.join(clipsOf(ws), `${job.key}.raw.wav`), audio.raw);
      const meta: ClipMeta = {
        ext: audio.ext,
        chars: job.chars,
        renderMs: Date.now() - started,
        bytes: audio.bytes.length,
        at: new Date().toISOString(),
        ...(audio.raw ? { cleaned: CLEANER_VERSION, removedMs: audio.removedMs ?? 0, ...(jobEndsOnSound(job) ? { endsOnSound: true } : {}) } : {}),
      };
      fs.writeFileSync(path.join(clipsOf(ws), `${job.key}.json`), JSON.stringify(meta));
      outcome.rendered += 1;
    } catch (error) {
      const message = (error as Error).message;
      errors[job.key] = message;
      outcome.failed += 1;
      if (!outcome.errors.includes(message)) outcome.errors.push(message);
    }
    done += 1;
    onDone?.(done, todo.length);
  });
  writeErrors(ws, errors);
  return outcome;
}

/** Renders one sample's cell for one column (every take), and returns it. */
export async function renderCell(engine: Engine, sample: Sample, takes: number, ws: Workspace, keys: Keys, fetch: Fetch, concurrency = 3): Promise<Cell> {
  const jobs = jobsFor(engine, [sample], takes, ws.cast);
  await renderJobs(jobs, ws, keys, fetch, concurrency);
  return cellOf(engine, sample, takes, ws);
}

/**
 * One take of one sample, alone: what it would cost, and rendering it. A new
 * take is one more call, not every take before it that is not on disk (those
 * may be in words that have since changed).
 */
export function estimateTake(engine: Engine, sample: Sample, take: number, ws: Workspace): Estimate {
  const jobs = plan(engine, ws.cast, sample, take);
  const todo = isUnsupported(jobs) ? [] : jobs.filter((job) => clipMeta(ws, job.key) === null);
  const chars = todo.reduce((sum, job) => sum + job.chars, 0);
  return { engine: engine.id, requests: todo.length, chars, cached: (isUnsupported(jobs) ? 0 : jobs.length) - todo.length, dollars: priceOf(engine, chars, todo.length, ws) };
}

/** Renders one take of one sample, and returns the cell through that take. */
export async function renderTake(engine: Engine, sample: Sample, take: number, ws: Workspace, keys: Keys, fetch: Fetch): Promise<Cell> {
  const jobs = plan(engine, ws.cast, sample, take);
  if (!isUnsupported(jobs)) await renderJobs(jobs, ws, keys, fetch, 3);
  return cellOf(engine, sample, take, ws);
}

export function resultsOf(engines: readonly Engine[], samples: readonly Sample[], tiers: Record<string, string>, takes: number, ws: Workspace): Results {
  const errors = readErrors(ws);
  const cells: Results["cells"] = {};
  for (const engine of engines) {
    cells[engine.id] = Object.fromEntries(samples.map((sample) => [sample.id, cellOf(engine, sample, takes, ws, errors)]));
  }
  return {
    generated: new Date().toISOString(),
    tiers,
    samples: [...samples],
    engines: engines.map((e) => ({ id: e.id, label: e.label, provider: e.provider, model: e.model, mode: e.mode, delivery: e.delivery, context: e.context === true })),
    cells,
  };
}

export interface BatchOptions {
  ws: Workspace;
  engines: Engine[];
  samples: Sample[];
  tiers: Record<string, string>;
  takes: number;
  maxDollars: number;
  dryRun: boolean;
  concurrency: number;
  keys: Keys;
  fetch: Fetch;
  log: (line: string) => void;
}

export interface BatchOutcome {
  estimate: Estimate[];
  dollars: number;
  rendered: number;
  cached: number;
  failed: number;
  refused?: string;
  page?: string;
}

/** The command line's run: price every column, refuse over the cap, render, write the static page. */
export async function runBakeoff(options: BatchOptions): Promise<BatchOutcome> {
  const { ws } = options;
  fs.mkdirSync(clipsOf(ws), { recursive: true });
  const estimates = options.engines.map((engine) => estimate(engine, options.samples, options.takes, ws));
  const dollars = estimates.reduce((sum, row) => sum + (row.dollars ?? 0), 0);
  const cached = estimates.reduce((sum, row) => sum + row.cached, 0);
  for (const row of estimates) {
    const price = row.dollars === null ? "no price in pricing.json" : `about $${row.dollars.toFixed(2)}`;
    options.log(`  ${row.engine.padEnd(52)} ${String(row.requests).padStart(4)} requests ${String(row.chars).padStart(7)} chars  ${price}`);
  }
  options.log(`  ${"total".padEnd(52)} ${String(estimates.reduce((s, r) => s + r.requests, 0)).padStart(4)} requests, about $${dollars.toFixed(2)} (${String(cached)} already cached, free)`);

  const outcome: BatchOutcome = { estimate: estimates, dollars, rendered: 0, cached, failed: 0 };
  // An unpriced paid column would make the cap meaningless, so it stops the run rather than counting as free.
  const unpriced = estimates.filter((row) => row.dollars === null && row.requests > 0).map((row) => row.engine);
  if (unpriced.length > 0) {
    outcome.refused = `No price in tools/voice/pricing.json for ${unpriced.join(", ")}, so the cap cannot be kept. Add the model there (with its apiModel) and run again.`;
    return outcome;
  }
  if (dollars > options.maxDollars) {
    outcome.refused = `That is over the $${options.maxDollars.toFixed(2)} cap. Narrow it with --engines, --samples or --tier, or raise --max-dollars.`;
    return outcome;
  }
  if (options.dryRun) return outcome;

  const jobs = options.engines.flatMap((engine) => jobsFor(engine, options.samples, options.takes, ws.cast));
  const step = Math.max(10, Math.ceil(jobs.length / 4));
  const result = await renderJobs(jobs, ws, options.keys, options.fetch, options.concurrency, (done, of) => {
    if (done === of || done % step === 0) options.log(`  rendered ${String(done)}/${String(of)}`);
  });
  outcome.rendered = result.rendered;
  outcome.failed = result.failed;

  const results = resultsOf(options.engines, options.samples, options.tiers, options.takes, ws);
  fs.writeFileSync(path.join(ws.outDir, "results.json"), JSON.stringify(results, null, 2));
  const page = path.join(ws.outDir, "index.html");
  fs.writeFileSync(page, renderPage(results));
  outcome.page = page;
  return outcome;
}
