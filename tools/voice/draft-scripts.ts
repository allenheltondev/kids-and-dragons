#!/usr/bin/env node
/**
 * Drafts or refreshes a chapter's script sidecar — `npm run voice:script`
 * (docs/voice-narration-plan.md §3, "Drafting scripts").
 *
 *   npm run voice:script -- --chapter bramblewood-01
 *   npm run voice:script -- --all
 *   npm run voice:script -- --chapter first-steps-01 --dry-run
 *
 * Writes `content/voice/scripts/<chapterId>.json`, never a chapter. Each
 * recorded line with a quote in it is cut into the narrator's words and the
 * quotes, each quote given to the speaker its speech tag names by the cast
 * sheet's attributor (tools/voice/cast/sheet.ts). A quote it cannot be sure of
 * stays with the narrator and is listed under "needs a person". Every draft is
 * `"reviewed": false`; re-running touches only missing and stale entries.
 * Reads files and calls nothing: no network, no model.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { attributeLines, callQuotes, type CastSheet, type LineQuote } from "./cast/sheet";
import { loadSources } from "./cast/sources";
import { inventory } from "./inventory";
import { refuseNameBearing } from "./lines";
import { CONTENT, loadContent, readJson, reachableFacets } from "./load";
import type { ScriptFile } from "./script";
import { changed, refreshScript, type NeedsPerson } from "./scriptdraft";

const { values } = parseArgs({
  options: {
    chapter: { type: "string", multiple: true },
    all: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

if (!values.all && (values.chapter ?? []).length === 0) {
  console.error("Name a chapter (--chapter ID, may repeat) or pass --all.");
  process.exit(2);
}

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPTS = path.join(CONTENT, "voice", "scripts");
const content = loadContent();
const facetsMax = reachableFacets(content);
const known = new Set(content.chapters.map((chapter) => String(chapter.id)));
const wanted = values.all ? [...known].sort() : (values.chapter ?? []);
const unknown = wanted.filter((id) => !known.has(id));
if (unknown.length > 0) {
  console.error(`No chapter ${unknown.map((id) => `"${id}"`).join(", ")}.`);
  process.exit(2);
}

const cast = readJson(path.join(CONTENT, "voice", "cast.json")) as unknown as CastSheet;
const speakers = new Set(Object.keys(cast.speakers));
const byAddress = new Map<string, readonly LineQuote[]>();
for (const line of attributeLines(loadSources(ROOT), cast)) byAddress.set(line.address, line.quotes);

const nameOf = (id: string): string => cast.speakers[id]?.name ?? id;
const why = (item: NeedsPerson): string => {
  if (item.reason === "guess") return `untagged; the only one in the scene is ${nameOf(item.guess!)} (a guess)`;
  if (item.reason === "uncast") return `tagged for "${item.named!}", who is not on the cast sheet (npm run voice:cast)`;
  return "untagged";
};

let total = { drafted: 0, attributed: 0, people: 0 };
for (const chapter of wanted) {
  const lines = new Map<string, string>();
  let refused = 0;
  for (const line of inventory({ chapters: content.chapters.filter((c) => c.id === chapter), campaigns: [] }, { facetsMax })) {
    // Choice labels are read by each phone's own voice; a line that could carry a hero's name is never recorded (#552).
    if (line.kind === "choice") continue;
    try {
      refuseNameBearing(line);
    } catch {
      refused += 1;
      continue;
    }
    lines.set(line.address, line.text);
  }
  // The attributor reads narration, cues and prompts. A quote anywhere else (a hint, the goal) is nobody's yet.
  const quotes = new Map<string, readonly LineQuote[]>();
  for (const [address, text] of lines) quotes.set(address, byAddress.get(address) ?? callQuotes(text, []).map((call) => (call.id === "party" ? call : { ...call, id: null })));

  const file = path.join(SCRIPTS, `${chapter}.json`);
  const previous = fs.existsSync(file) ? (readJson(file) as ScriptFile) : {};
  const refresh = refreshScript(previous, { chapter, lines, quotes, speakers });

  const voiced = new Set(Object.values(refresh.file).flatMap((entry) => (typeof entry === "object" ? entry.lines.map((line) => line.by) : [])));
  console.log(`${chapter}: ${String(refresh.drafted.length)} drafted, ${String(refresh.kept.length)} kept, ${String(refresh.recut.length)} stale re-cut${refresh.dropped.length ? ` (${String(refresh.dropped.length)} dropped: nobody but the narrator speaks now)` : ""}.`);
  console.log(`  ${String(refresh.attributed)} quote(s) given to a speaker, ${String(refresh.needsPerson.length)} left with the narrator for a person.`);
  console.log(`  voices: ${[...voiced].sort().map(nameOf).join(", ") || "narrator only"}`);
  if (refused) console.log(`  ${String(refused)} line(s) skipped: filled at run time, never recorded.`);
  if (refresh.reviewedLost.length) console.log(`  re-cut after review (the words changed; a person checks them again): ${refresh.reviewedLost.join(", ")}`);
  if (refresh.broken.length) console.log(`  left alone, broken (npm run content:validate says why): ${refresh.broken.join(", ")}`);
  if (refresh.orphaned.length) console.log(`  left alone, no such line any more: ${refresh.orphaned.join(", ")}`);
  if (refresh.needsPerson.length) {
    console.log(`  needs a person:`);
    for (const item of refresh.needsPerson) console.log(`    ${item.address}\n      "${item.words}"  (${why(item)})`);
  }

  total = { drafted: total.drafted + refresh.drafted.length, attributed: total.attributed + refresh.attributed, people: total.people + refresh.needsPerson.length };
  if (values["dry-run"] || !changed(refresh)) continue;
  fs.mkdirSync(SCRIPTS, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(refresh.file, null, 2)}\n`);
  console.log(`  wrote ${path.relative(ROOT, file)}`);
}
if (wanted.length > 1) console.log(`\n${String(total.drafted)} drafted, ${String(total.attributed)} quote(s) attributed, ${String(total.people)} for a person.`);
if (values["dry-run"]) console.log("\n--dry-run: nothing written.");
