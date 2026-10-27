#!/usr/bin/env node
/**
 * The voice bake-off — `npm run voice:bakeoff` (docs/voice-bakeoff.md).
 *
 * Renders real lines from the game with each engine and writes a page that
 * plays them side by side:
 *
 *   npm run voice:bakeoff -- --dry-run                 # what it would send, and the price
 *   npm run voice:bakeoff -- --engines fake            # try the page with no keys
 *   ELEVENLABS_API_KEY=… GEMINI_API_KEY=… npm run voice:bakeoff
 *   npm run voice:bakeoff -- --tier 4-ensemble --engines gemini-3.8-flash,elevenlabs-v3
 *   npm run voice:bakeoff -- --samples pib-intro,pib-gift,pib-hedge-mob --takes 3
 *
 * Then open art/review/voice-bakeoff/index.html. With no --engines it renders
 * every default engine whose key is set. Already-rendered requests are free.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Pricing } from "../cost-model.ts";
import { runBakeoff } from "./bakeoff.ts";
import { keysFromEnv, type CastFile, type Engine, type Fetch } from "./providers.ts";
import { contentLines, readSampleFile, resolveSamples } from "./samples.ts";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..", "..", "..");

const { values } = parseArgs({
  options: {
    engines: { type: "string" },
    samples: { type: "string" },
    tier: { type: "string" },
    takes: { type: "string", default: "1" },
    "max-dollars": { type: "string", default: "5" },
    concurrency: { type: "string", default: "3" },
    out: { type: "string", default: path.join(ROOT, "art", "review", "voice-bakeoff") },
    "dry-run": { type: "boolean", default: false },
  },
});

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(HERE, file), "utf8")) as T;
const list = (value: string | undefined): string[] | null => (value ? value.split(",").map((part) => part.trim()).filter(Boolean) : null);

const takes = Number(values.takes);
const maxDollars = Number(values["max-dollars"]);
const concurrency = Number(values.concurrency);
if (!Number.isInteger(takes) || takes < 1 || !Number.isFinite(maxDollars) || !Number.isInteger(concurrency) || concurrency < 1) {
  console.error("--takes and --concurrency take whole numbers of at least 1, --max-dollars a number.");
  process.exit(2);
}

const engines = readJson<{ engines: Engine[] }>("engines.json").engines;
const cast = readJson<CastFile>("cast.json");
const pricing = readJson<Pricing>(path.join("..", "pricing.json"));
const file = readSampleFile();
const { samples: all, problems } = resolveSamples(file, contentLines(ROOT));
if (problems.length > 0) {
  console.error(`samples.json no longer matches content/:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

const wantedSamples = list(values.samples);
const wantedTiers = list(values.tier);
for (const id of wantedSamples ?? []) if (!all.some((s) => s.id === id)) console.error(`No sample "${id}". Known: ${all.map((s) => s.id).join(", ")}`);
const samples = all.filter((s) => (wantedSamples === null || wantedSamples.includes(s.id)) && (wantedTiers === null || wantedTiers.includes(s.tier)));
if (samples.length === 0) {
  console.error("No samples selected.");
  process.exit(2);
}

const keys = keysFromEnv();
const hasKey = (engine: Engine): boolean => engine.provider === "fake" || (engine.provider === "elevenlabs" ? !!keys.elevenlabs : !!keys.gemini);
const named = list(values.engines);
for (const id of named ?? []) {
  if (!engines.some((e) => e.id === id)) {
    console.error(`No engine "${id}". Known: ${engines.map((e) => e.id).join(", ")}`);
    process.exit(2);
  }
}
const candidates = named === null ? engines.filter((e) => e.default !== false) : engines.filter((e) => named.includes(e.id));
const selected = candidates.filter(hasKey).map((e) => e.id);
for (const engine of candidates.filter((e) => !hasKey(e))) {
  console.log(`Skipping ${engine.id}: set ${engine.provider === "elevenlabs" ? "ELEVENLABS_API_KEY" : "GEMINI_API_KEY"} to render it.`);
}
if (selected.length === 0 && !values["dry-run"]) {
  console.error("No engine can run: set ELEVENLABS_API_KEY and/or GEMINI_API_KEY, or try the page with --engines fake.");
  process.exit(2);
}

console.log(`${String(samples.length)} samples × ${String(takes)} take${takes === 1 ? "" : "s"}. Not yet rendered, priced from pricing.json (checked ${pricing.checked}):`);
const outcome = await runBakeoff({
  outDir: values.out,
  engines,
  // A dry run prices every candidate, key or not, so the bill is known before keys are set.
  selected: values["dry-run"] ? candidates.map((e) => e.id) : selected,
  samples,
  tiers: file.tiers,
  cast,
  pricing,
  takes,
  maxDollars,
  dryRun: values["dry-run"],
  concurrency,
  keys,
  fetch: globalThis.fetch as unknown as Fetch,
  today: new Date().toISOString().slice(0, 10),
  log: (line) => console.log(line),
});

if (outcome.refused) {
  console.error(outcome.refused);
  process.exit(1);
}
if (values["dry-run"]) {
  console.log("Dry run: nothing sent.");
} else {
  console.log(`${String(outcome.rendered)} rendered, ${String(outcome.cached)} from cache, ${String(outcome.failed)} failed.`);
  if (outcome.failed > 0) console.log(`Failures are listed in ${path.join(values.out, "errors.json")} and shown in their cells.`);
  console.log(`Open ${outcome.page ?? ""}`);
}
