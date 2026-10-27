#!/usr/bin/env node
/**
 * The voice bake-off — `npm run voice:bakeoff` (docs/voice-bakeoff.md).
 *
 * The easy way: open the live page, paste keys, pick models, press Render.
 *
 *   npm run voice:bakeoff -- --serve           # then open the address it prints
 *
 * Or render from the command line and open the static page it writes:
 *
 *   npm run voice:bakeoff -- --dry-run         # what it would send, and the price
 *   npm run voice:bakeoff -- --engines fake    # try the page with no keys
 *   ELEVENLABS_API_KEY=… GEMINI_API_KEY=… npm run voice:bakeoff
 *   npm run voice:bakeoff -- --samples pib-intro,pib-gift,pib-hedge-mob --takes 3
 *
 * Columns default to engines.json's presets. Already-rendered requests are free.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Pricing } from "../cost-model.ts";
import { runBakeoff, type Workspace } from "./bakeoff.ts";
import { engineOf, keysFromEnv, type CastFile, type Engine, type EngineConfig, type Fetch, type ModelInfo } from "./providers.ts";
import { contentLines, readSampleFile, resolveSamples } from "./samples.ts";
import { createBakeoffServer } from "./server.ts";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..", "..", "..");

const { values } = parseArgs({
  options: {
    serve: { type: "boolean", default: false },
    port: { type: "string", default: "5199" },
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
const port = Number(values.port);
if (!Number.isInteger(takes) || takes < 1 || !Number.isFinite(maxDollars) || !Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(port)) {
  console.error("--takes, --concurrency and --port take whole numbers, --max-dollars a number.");
  process.exit(2);
}

const { models: catalog, presets } = readJson<{ models: ModelInfo[]; presets: EngineConfig[] }>("engines.json");
const cast = readJson<CastFile>("cast.json");
const pricing = readJson<Pricing>(path.join("..", "pricing.json"));
const file = readSampleFile();
const { samples: all, problems } = resolveSamples(file, contentLines(ROOT));
if (problems.length > 0) {
  console.error(`samples.json no longer matches content/:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

const ws: Workspace = { outDir: values.out, cast, pricing, today: new Date().toISOString().slice(0, 10) };
fs.mkdirSync(path.join(ws.outDir, "clips"), { recursive: true });
const keys = keysFromEnv();
const fetch = globalThis.fetch as unknown as Fetch;

if (values.serve) {
  // The cast page (/cast) reads and writes the sheet `npm run voice:cast` builds.
  const sheetPath = path.join(ROOT, "content", "voice", "cast.json");
  const chapterCampaigns = Object.fromEntries(
    fs.readdirSync(path.join(ROOT, "content", "chapters")).filter((name) => name.endsWith(".json")).map((name) => {
      const chapter = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "chapters", name), "utf8")) as { id: string; campaignId?: string };
      return [chapter.id, chapter.campaignId ?? "none"];
    }),
  );
  const cast = fs.existsSync(sheetPath) ? { sheetPath, chapterCampaigns } : undefined;
  if (!cast) console.log("No cast sheet yet: run `npm run voice:cast` to build one, then restart for the /cast page.");
  const { server } = createBakeoffServer({ ws, samples: all, tiers: file.tiers, catalog, presets, envKeys: keys, fetch, maxDollars, cast });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Voice bake-off: http://127.0.0.1:${String(port)}/`);
    if (cast) console.log(`Cast profiles, one at a time: http://127.0.0.1:${String(port)}/cast/profile\nCast voice sheet, every card: http://127.0.0.1:${String(port)}/cast`);
    console.log(`Paste keys on the page${keys.elevenlabs || keys.gemini ? " (keys from your shell are already in use)" : ""}. Spending cap $${maxDollars.toFixed(2)} this session; raise it on the page.`);
    console.log("Ctrl-C to stop. Clips stay cached in " + path.join(ws.outDir, "clips"));
  });
} else {
  const wantedSamples = list(values.samples);
  const wantedTiers = list(values.tier);
  for (const id of wantedSamples ?? []) if (!all.some((s) => s.id === id)) console.error(`No sample "${id}". Known: ${all.map((s) => s.id).join(", ")}`);
  const samples = all.filter((s) => (wantedSamples === null || wantedSamples.includes(s.id)) && (wantedTiers === null || wantedTiers.includes(s.tier)));
  if (samples.length === 0) {
    console.error("No samples selected.");
    process.exit(2);
  }

  // `--engines` takes column ids (`gemini:gemini-3.8-flash-tts:lines:tag`), or `fake`.
  const fake: EngineConfig = { provider: "fake", model: "tone", mode: "lines", delivery: "tag" };
  const known = [...presets, fake].map((config) => engineOf(config, catalog));
  const named = list(values.engines);
  const candidates: Engine[] = named === null ? known.filter((e) => e.provider !== "fake") : [];
  for (const id of named ?? []) {
    const found = id === "fake" ? known.find((e) => e.provider === "fake") : known.find((e) => e.id === id);
    if (found === undefined) {
      console.error(`No column "${id}". Known:\n  ${known.map((e) => e.id).join("\n  ")}`);
      process.exit(2);
    }
    candidates.push(found);
  }
  const hasKey = (engine: Engine): boolean => engine.provider === "fake" || (engine.provider === "elevenlabs" ? !!keys.elevenlabs : !!keys.gemini);
  for (const engine of candidates.filter((e) => !hasKey(e))) {
    if (!values["dry-run"]) console.log(`Skipping ${engine.id}: set ${engine.provider === "elevenlabs" ? "ELEVENLABS_API_KEY" : "GEMINI_API_KEY"} to render it.`);
  }
  // A dry run prices every column, key or not, so the bill is known before keys are set.
  const engines = values["dry-run"] ? candidates : candidates.filter(hasKey);
  if (engines.length === 0) {
    console.error("No column can run: set ELEVENLABS_API_KEY and/or GEMINI_API_KEY, use --serve and paste keys on the page, or try --engines fake.");
    process.exit(2);
  }

  console.log(`${String(samples.length)} samples × ${String(takes)} take${takes === 1 ? "" : "s"}. Not yet rendered, priced from pricing.json (checked ${pricing.checked}):`);
  const outcome = await runBakeoff({ ws, engines, samples, tiers: file.tiers, takes, maxDollars, dryRun: values["dry-run"], concurrency, keys, fetch, log: (line) => console.log(line) });
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
}
