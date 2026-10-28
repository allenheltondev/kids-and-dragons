#!/usr/bin/env node
/**
 * Render the narration that is owed — `npm run voice:generate`.
 *
 * Works out which clips the game wants (the same list `voice:status` shows),
 * skips every one the destination already has (that check is the generation
 * cache), renders the rest with Gemini 3.8 Flash TTS, encodes them, uploads
 * them straight to the site bucket's `voice/` prefix, and writes the manifest
 * the client reads. Docs: docs/voice-narration-plan.md §4-§5.
 *
 * **Spends nothing unless you pass `--render`.** Without it this prints what
 * would be rendered and what it would cost, reading the destination (if one is
 * named) to see what is already there.
 *
 *   npm run voice:generate -- --chapter bramblewood-01                 # plan only
 *   npm run voice:generate -- --chapter bramblewood-01 --dir /tmp/clips --render
 *   GEMINI_API_KEY=… npm run voice:generate -- --chapter bramblewood-01 --stage staging --render
 *   … --stage staging,prod            # one render, uploaded to both buckets
 *   … --bucket kad-site-prod-123456   # a bucket by name
 *
 * Flags: --chapter ID (a chapter, `_<campaign>` or `_help`), --speaker ID,
 * --max-dollars N (default 75, stops before the request that would cross it),
 * --max-chars N, --concurrency N, --model ID, --prune (drop manifest entries
 * nothing asks for any more), --with-choices, --region R.
 *
 * AWS uploads use your own credentials (the CLI profile or environment), like
 * `timing:export`. Clips are written once and never replaced (S3 conditional
 * write), under `voice/` only; `deploy.sh` never syncs or deletes that prefix.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { S3Client } from "@aws-sdk/client-s3";
import { keysFromEnv } from "./bakeoff/providers";
import { dollars, quote, type PricedModel, type Pricing } from "./cost-model";
import { GEMINI, type DesiredSegment } from "./desired";
import { encodeVoice } from "./encode";
import { readJson } from "./load";
import { clipStatus, mergeManifest, toRender } from "./manifest";
import { renderOwed } from "./render";
import { DirClipStore, MemoryClipStore, S3ClipStore, StoreSet, type ClipStore } from "./store";
import { makeSynthesizer } from "./synth";
import { desire, loadWorld, MANIFEST_DIR } from "./world";

const { values } = parseArgs({
  options: {
    chapter: { type: "string" },
    speaker: { type: "string" },
    stage: { type: "string" },
    bucket: { type: "string" },
    dir: { type: "string" },
    region: { type: "string" },
    model: { type: "string", default: GEMINI.model },
    render: { type: "boolean", default: false },
    prune: { type: "boolean", default: false },
    "with-choices": { type: "boolean", default: false },
    "max-dollars": { type: "string", default: "75" },
    "max-chars": { type: "string" },
    concurrency: { type: "string", default: "4" },
    fake: { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const maxDollars = Number(values["max-dollars"]);
const maxChars = values["max-chars"] === undefined ? undefined : Number(values["max-chars"]);
const concurrency = Number(values.concurrency);
if (!Number.isFinite(maxDollars) || maxDollars < 0) fail("--max-dollars takes a number.");
if (maxChars !== undefined && !(maxChars >= 0)) fail("--max-chars takes a number.");
if (!Number.isInteger(concurrency) || concurrency < 1) fail("--concurrency takes a whole number.");

const pricing = readJson(path.join(import.meta.dirname, "pricing.json")) as unknown as Pricing;
const model: PricedModel | undefined = pricing.models.find((m) => m.id === values.model);
if (model === undefined) fail(`No model "${String(values.model)}" in pricing.json. Known: ${pricing.models.map((m) => m.id).join(", ")}.`);

const region = values.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

/** The destinations: buckets by stage or name, or a folder. None is fine for a plan. */
async function destinations(): Promise<ClipStore[]> {
  const stores: ClipStore[] = [];
  const buckets = (values.bucket?.split(",") ?? []).filter(Boolean);
  const stages = (values.stage?.split(",") ?? []).filter(Boolean);
  if (stages.length > 0) {
    const cloudformation = new CloudFormationClient({ region });
    for (const stage of stages) {
      const stack = await cloudformation.send(new DescribeStacksCommand({ StackName: `kad-${stage}` }));
      const name = stack.Stacks?.[0]?.Outputs?.find((o) => o.OutputKey === "SiteBucketName")?.OutputValue;
      if (name === undefined) fail(`Stack kad-${stage} has no SiteBucketName output.`);
      buckets.push(name);
    }
  }
  if (buckets.length > 0) {
    const s3 = new S3Client({ region });
    stores.push(...buckets.map((name) => new S3ClipStore(s3, name)));
  }
  if (values.dir !== undefined) stores.push(new DirClipStore(path.resolve(values.dir)));
  return stores;
}

const world = loadWorld({ withChoices: values["with-choices"] });
const names = values.chapter === undefined ? [...world.groups.keys()] : [values.chapter];
if (values.chapter !== undefined && !world.groups.has(values.chapter)) fail(`No lines for "${values.chapter}".`);

const provider = values.fake ? { provider: "fake", model: "fake-tone" } : { provider: GEMINI.provider, model: model.id };
const stores = await destinations();
if (values.render && stores.length === 0) fail("Nothing to upload to. Name a destination: --stage staging, --bucket NAME or --dir FOLDER.");
const store: ClipStore = stores.length === 0 ? new MemoryClipStore() : new StoreSet(stores);

// What is owed, across the chosen chapters, as distinct clips.
const owed = new Map<string, DesiredSegment>();
const perGroup = new Map<string, ReturnType<typeof desire>>();
let deviceVoice = 0;
for (const name of names) {
  const desired = desire(world, name, provider);
  perGroup.set(name, desired);
  deviceVoice += desired.deviceVoice.length;
  const status = clipStatus(desired, world.manifests.get(name) ?? {}, world.lock);
  const wantedNow = new Set(toRender(status).map((row) => row.key));
  for (const line of desired.lines) {
    for (const segment of line.segments) {
      if (wantedNow.has(segment.key) && (values.speaker === undefined || segment.by.split("#")[0] === values.speaker)) owed.set(segment.key, segment);
    }
  }
}

const today = new Date().toISOString().slice(0, 10);
const price = (chars: number): number => (values.fake ? 0 : (quote(model, { chars, requests: 1 }, pricing.speech, today)?.dollars ?? 0));

const keys = keysFromEnv();
if (values.render && !values.fake && keys.gemini === undefined) fail("No Gemini key. Set GEMINI_API_KEY (or GOOGLE_API_KEY).");
const synth = makeSynthesizer({
  provider: provider as never,
  cast: world.cast,
  tables: world.tables,
  keys,
  fetch: (url, init) => fetch(url, init) as never,
});

const startedAt = Date.now();
const report = await renderOwed(
  [...owed.values()],
  { synth, encode: encodeVoice, store, price, log: (message) => console.log(`  ${message}`) },
  { render: values.render, maxDollars, ...(maxChars === undefined ? {} : { maxChars }), concurrency },
);

// The manifest: every line whose clips all exist, with lengths from the store or an earlier manifest.
let written = 0;
// A dry run, or a trial with fake tones, writes no manifest: it would describe clips nobody can play.
if (values.render && !values.fake) {
  for (const [name, desired] of perGroup) {
    const existing = world.manifests.get(name) ?? {};
    const lengths = new Map(report.lengths);
    for (const variants of Object.values(existing)) for (const clips of Object.values(variants)) for (const c of clips) if (!lengths.has(c.clip)) lengths.set(c.clip, c.ms);
    // A clip kept by an earlier run is known to the store too.
    for (const line of desired.lines) {
      for (const segment of line.segments) {
        if (lengths.has(segment.key)) continue;
        const there = await store.head(segment.key);
        if (there !== null) lengths.set(segment.key, there.ms);
      }
    }
    const merged = mergeManifest(existing, desired.lines, lengths, values.prune);
    const text = `${JSON.stringify(merged, null, 2)}\n`;
    const file = path.join(MANIFEST_DIR, `${name}.json`);
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (before === text || (before === null && Object.keys(merged).length === 0)) continue;
    fs.mkdirSync(MANIFEST_DIR, { recursive: true });
    fs.writeFileSync(file, text);
    written += 1;
  }
}

const num = (n: number): string => n.toLocaleString("en-US");
const mode = values.render ? "Rendered" : "Dry run";
console.log(`${mode}: ${values.fake ? "fake tones" : model.label}${model.confirmed || values.fake ? "" : " *"} -> ${stores.length === 0 ? "no destination (plan only)" : store.name}`);
console.log(`  owed            ${num(owed.size)} distinct clips${values.speaker ? ` by ${values.speaker}` : ""}, ${num(deviceVoice)} lines left to the device voice`);
console.log(`  already there   ${num(report.cached.length)} (no provider call)`);
if (values.render) console.log(`  rendered        ${num(report.rendered.length)} clips, ${num(report.chars)} characters, ${dollars(report.dollars)} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
else console.log(`  would render    ${num(report.planned.length)} clips, ${num(report.chars)} characters, ${dollars(report.dollars)} (cap ${dollars(maxDollars)})`);
if (report.failed.length > 0) {
  console.log(`  FAILED          ${num(report.failed.length)}`);
  for (const f of report.failed.slice(0, 5)) console.log(`    ${f.key.slice(0, 10)}: ${f.error}`);
}
if (report.stoppedBy !== null) console.log(`  STOPPED         at the ${report.stoppedBy === "dollars" ? `${dollars(maxDollars)} spend` : `${num(maxChars ?? 0)}-character`} cap; ${num(report.deferred.length)} clips left for the next run`);
if (written > 0) console.log(`  manifests       ${num(written)} written under content/voice/manifest/ (commit them: they deploy with content/)`);
if (!values.render) console.log("\nNothing was rendered or uploaded. Add --render to do it.");
else if (report.failed.length > 0) process.exitCode = 1;
