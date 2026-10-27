#!/usr/bin/env node
/**
 * What recording the game would cost — `npm run voice:cost`.
 *
 * Counts every line the game would record (inventory.ts), then prices it with
 * each model in pricing.json, per campaign and in total, against a budget.
 * Run it before choosing a provider; it calls no API and spends nothing.
 *
 *   npm run voice:cost                       # the whole game, every model
 *   npm run voice:cost -- --campaign gemfall # one campaign, chapter by chapter
 *   npm run voice:cost -- --with-choices     # also voice choice labels
 *   npm run voice:cost -- --budget 75 --retakes 1.3 --batch --on 2027-01-15
 *   npm run voice:cost -- --json             # for a spreadsheet
 *
 * Identical words are one clip (one narrator voice reads them all), so the
 * bill counts each distinct text once; `--retakes` adds the share of lines
 * expected to be rendered again after review.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { billedChars, inventory, quotedChars, type VoiceLine } from "./inventory";
import { dollars, hours, quote, type Pricing, type Quote, type Workload } from "./cost-model";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CONTENT = path.join(ROOT, "content");

const { values } = parseArgs({
  options: {
    budget: { type: "string", default: "75" },
    retakes: { type: "string", default: "1.25" },
    campaign: { type: "string" },
    "with-choices": { type: "boolean", default: false },
    "facets-max": { type: "string", default: "6" },
    batch: { type: "boolean", default: false },
    on: { type: "string", default: new Date().toISOString().slice(0, 10) },
    json: { type: "boolean", default: false },
  },
});

const budget = Number(values.budget);
const retakes = Number(values.retakes);
const facetsMax = Number(values["facets-max"]);
if (!Number.isFinite(budget) || !Number.isFinite(retakes) || retakes < 1 || !Number.isInteger(facetsMax) || facetsMax < 0) {
  console.error("--budget and --retakes take numbers (--retakes at least 1), --facets-max a whole number.");
  process.exit(2);
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function readDir(dir: string): Record<string, unknown>[] {
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => readJson(path.join(dir, name)));
}

const pricing = readJson(path.join(import.meta.dirname, "pricing.json")) as unknown as Pricing;
const all = inventory(
  {
    chapters: readDir(path.join(CONTENT, "chapters")),
    campaigns: readDir(path.join(CONTENT, "campaigns")),
    help: readJson(path.join(CONTENT, "help.json")),
  },
  { facetsMax },
);

const lines = all.filter((line) => (values["with-choices"] || line.kind !== "choice") && (values.campaign === undefined || line.campaign === values.campaign));
if (lines.length === 0) {
  console.error(values.campaign === undefined ? "No lines found under content/." : `No lines for campaign "${values.campaign}".`);
  process.exit(2);
}

/** Distinct texts once each, rendered once per token value, padded for retakes. */
function workload(group: readonly VoiceLine[]): Workload & { lines: number; distinct: number; quoted: number } {
  const seen = new Map<string, VoiceLine>();
  for (const line of group) if (!seen.has(line.text)) seen.set(line.text, line);
  let chars = 0;
  let requests = 0;
  let quoted = 0;
  for (const line of seen.values()) {
    chars += billedChars(line);
    // A multi-voice line is sent in pieces: one per quote, one per narrator run around them.
    const quotes = [...line.text.matchAll(/["“][^"”]*["”]/g)].length;
    requests += line.renders * (quotes === 0 ? 1 : quotes * 2);
    quoted += quotedChars(line.text) * line.renders;
  }
  return { chars: Math.round(chars * retakes), requests: Math.round(requests * retakes), lines: group.length, distinct: seen.size, quoted };
}

function quotes(work: Workload): Quote[] {
  return pricing.models
    .map((model) => quote(model, work, pricing.speech, values.on, values.batch))
    .filter((q): q is Quote => q !== null);
}

function groupBy(key: (line: VoiceLine) => string): Map<string, VoiceLine[]> {
  const groups = new Map<string, VoiceLine[]>();
  for (const line of lines) groups.set(key(line), [...(groups.get(key(line)) ?? []), line]);
  return groups;
}

const total = workload(lines);
const totalQuotes = quotes(total);
const byKind = [...groupBy((line) => line.kind)].map(([kind, group]) => ({ kind, ...workload(group) }));
const rows = [...groupBy((line) => (values.campaign === undefined ? line.campaign : line.chapter))].map(([name, group]) => {
  const work = workload(group);
  return { name, ...work, quotes: quotes(work) };
});
const raw = lines.reduce((sum, line) => sum + line.text.length, 0);

if (values.json) {
  console.log(JSON.stringify({ on: values.on, budget, retakes, batch: values.batch, facetsMax, checked: pricing.checked, total: { ...total, quotes: totalQuotes }, byKind, rows }, null, 2));
  process.exit(0);
}

const scope = values.campaign === undefined ? "the whole game" : `campaign "${values.campaign}"`;
const pad = (text: string, width: number): string => text.padEnd(width);
const lpad = (text: string, width: number): string => text.padStart(width);
const num = (n: number): string => n.toLocaleString("en-US");

console.log(`Voice cost for ${scope}, priced for ${values.on}${values.batch ? " (batch rates)" : ""}.`);
console.log(`Prices from tools/voice/pricing.json, checked ${pricing.checked}. Unconfirmed rates are marked *; confirm them on the provider's page.\n`);

console.log(`Lines            ${num(total.lines)} (${num(total.distinct)} distinct texts)`);
console.log(`Characters       ${num(raw)} as written, ${num(total.chars)} billed`);
console.log(`                 (distinct texts, {party}/{facets} expanded with {facets} 0-${String(facetsMax)}, ×${String(retakes)} for retakes)`);
console.log(`Spoken by cast   ${num(total.quoted)} characters inside quotes (${((100 * total.quoted) / Math.max(1, total.chars / retakes)).toFixed(0)}%)`);
console.log(`Audio            about ${hours(totalQuotes[0]?.audioSeconds ?? 0)} at ${String(pricing.speech.charsPerSecond)} characters a second`);
console.log(`Choice labels    ${values["with-choices"] ? "included" : "not included (phones read their own; add --with-choices)"}\n`);

console.log("By kind of line (billed characters):");
for (const row of byKind.sort((a, b) => b.chars - a.chars)) console.log(`  ${pad(row.kind, 12)} ${lpad(num(row.chars), 11)}`);

const models = totalQuotes.map((q) => q.label);
const width = Math.max(10, ...models.map((label) => label.length + 2));
console.log(`\nTotal, budget ${dollars(budget)}:`);
for (const q of totalQuotes) {
  const verdict = q.dollars <= budget ? "fits" : `over by ${dollars(q.dollars - budget)}`;
  console.log(`  ${pad(q.label + (q.confirmed ? "" : " *"), width)} ${lpad(dollars(q.dollars), 11)}   ${verdict}`);
}

const nameWidth = Math.max(18, ...rows.map((row) => row.name.length + 2));
console.log(`\nBy ${values.campaign === undefined ? "campaign" : "chapter"}:`);
// Column heads are the model ids, which are short and unambiguous.
const columns = totalQuotes.map((q) => Math.max(q.model.length, 10) + 2);
console.log(`  ${pad("", nameWidth)}${lpad("chars", 11)}${totalQuotes.map((q, i) => lpad(q.model, columns[i] ?? 0)).join("")}`);
for (const row of rows) {
  console.log(`  ${pad(row.name, nameWidth)}${lpad(num(row.chars), 11)}${row.quotes.map((q, i) => lpad(dollars(q.dollars), columns[i] ?? 0)).join("")}`);
}

const cheapest = [...totalQuotes].sort((a, b) => a.dollars - b.dollars)[0];
if (cheapest !== undefined && cheapest.dollars > budget) {
  const fits = rows.filter((row) => (row.quotes.find((q) => q.model === cheapest.model)?.dollars ?? Infinity) <= budget).map((row) => row.name);
  console.log(`\nThe whole of ${scope} is over budget on every model. Within ${dollars(budget)} on ${cheapest.label}: ${fits.length > 0 ? fits.join(", ") : "nothing on its own"}.`);
}
