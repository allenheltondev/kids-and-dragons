#!/usr/bin/env node
/**
 * What the game has recorded and what it still owes — `npm run voice:status`.
 *
 * Compares the clips the game wants (cast sheet, scripts, authored lines;
 * desired.ts) with the clips rendered (content/voice/manifest/) and approved
 * (content/voice/voice.lock.json), per chapter, with what rendering the rest
 * would cost. Reads files and calls nothing. Absence is reported, never fatal:
 * a game with no clips yet is every clip `missing`, and exits 0.
 *
 *   npm run voice:status                       # every chapter, Gemini 3.8 Flash TTS
 *   npm run voice:status -- --chapter bramblewood-01
 *   npm run voice:status -- --model gemini-3.1-flash-tts --json
 *   npm run voice:status -- --with-choices     # also count choice labels
 */

import path from "node:path";
import { parseArgs } from "node:util";
import { GEMINI } from "./desired";
import { dollars, quote, type Pricing, type PricedModel } from "./cost-model";
import { readJson } from "./load";
import { clipStatus, countByState, toRender, type Status } from "./manifest";
import type { ScriptFile } from "./script";
import { desire, loadWorld } from "./world";

const { values } = parseArgs({
  options: {
    chapter: { type: "string" },
    model: { type: "string", default: GEMINI.model },
    "with-choices": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const pricing = readJson(path.join(import.meta.dirname, "pricing.json")) as unknown as Pricing;
const model: PricedModel | undefined = pricing.models.find((m) => m.id === values.model);
if (model === undefined) {
  console.error(`No model "${String(values.model)}" in pricing.json. Known: ${pricing.models.map((m) => m.id).join(", ")}.`);
  process.exit(2);
}

const world = loadWorld({ withChoices: values["with-choices"] });
const { groups, facetsMax } = world;

const wanted = values.chapter === undefined ? [...groups.keys()] : [values.chapter];
if (values.chapter !== undefined && !groups.has(values.chapter)) {
  console.error(`No lines for "${values.chapter}".`);
  process.exit(2);
}

const provider = { provider: GEMINI.provider, model: model.id };
const rows = wanted.map((name) => {
  const desired = desire(world, name, provider);
  const status: Status = clipStatus(desired, world.manifests.get(name) ?? {}, world.lock);
  const owed = toRender(status);
  const chars = owed.reduce((sum, row) => sum + row.chars, 0);
  const price = quote(model, { chars, requests: owed.length }, pricing.speech, new Date().toISOString().slice(0, 10));
  const unreviewed = Object.values(world.scripts.get(name) ?? ({} as ScriptFile)).filter((e) => typeof e === "object" && e.reviewed === false).length;
  return { name, lines: status.lines, counts: countByState(status), orphaned: status.orphaned.length, deviceVoice: status.deviceVoice.length, unreviewed, chars, dollars: price?.dollars ?? null };
});

if (values.json) {
  console.log(JSON.stringify({ model: model.id, facetsMax, rows }, null, 2));
  process.exit(0);
}

const num = (n: number): string => n.toLocaleString("en-US");
const w = Math.max(20, ...rows.map((r) => r.name.length + 2));
console.log(`Voice status for ${model.label}${model.confirmed ? "" : " *"}, {facets} 0-${String(facetsMax)}.`);
console.log(`Approved takes are pinned by clip key in content/voice/voice.lock.json; the rest is owed.\n`);
console.log(`${"".padEnd(w)}${"approved".padStart(10)}${"review".padStart(8)}${"stale".padStart(7)}${"missing".padStart(9)}${"orphan".padStart(8)}${"device".padStart(8)}${"to render".padStart(12)}${"cost".padStart(10)}`);
for (const r of rows) {
  const cost = r.dollars === null ? "n/a" : dollars(r.dollars);
  console.log(`${r.name.padEnd(w)}${num(r.counts.approved).padStart(10)}${num(r.counts["awaiting-review"]).padStart(8)}${num(r.counts.stale).padStart(7)}${num(r.counts.missing).padStart(9)}${num(r.orphaned).padStart(8)}${num(r.deviceVoice).padStart(8)}${num(r.chars).padStart(12)}${cost.padStart(10)}`);
}
const sum = (pick: (r: (typeof rows)[number]) => number): number => rows.reduce((total, r) => total + pick(r), 0);
console.log(`\n${"total".padEnd(w)}${num(sum((r) => r.counts.approved)).padStart(10)}${num(sum((r) => r.counts["awaiting-review"])).padStart(8)}${num(sum((r) => r.counts.stale)).padStart(7)}${num(sum((r) => r.counts.missing)).padStart(9)}${num(sum((r) => r.orphaned)).padStart(8)}${num(sum((r) => r.deviceVoice)).padStart(8)}${num(sum((r) => r.chars)).padStart(12)}${dollars(sum((r) => r.dollars ?? 0)).padStart(10)}`);
console.log(`\ncolumns: review = rendered, not yet approved; stale = changed since its last render; orphan = rendered, no longer wanted; device = read by the device voice (stale or broken script); to render = characters in stale + missing clips.`);
