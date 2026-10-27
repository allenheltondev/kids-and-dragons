#!/usr/bin/env node
/**
 * Builds the cast voice sheet — `npm run voice:cast` (docs/voice-cast.md).
 *
 * Reads every chapter, the canon individuals and the narration, and writes
 * content/voice/cast.json: the whole cast, each with a Gemini voice and real
 * lines to audition it on. Run it again after writing a chapter: new people
 * are added, everyone's chapters and lines are refreshed, and a voice anybody
 * chose on the cast page (or by hand) is kept.
 *
 *   npm run voice:cast              # build or refresh the sheet
 *   npm run voice:cast -- --check   # report only; exit 1 on a voice clash
 *
 * Then `npm run voice:bakeoff -- --serve` and open /cast to listen.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as yaml from "js-yaml";
import { inventory } from "../inventory.ts";
import { buildSheet, voiceClashes, type CastSheet, type ChapterLike, type IndividualLike } from "./sheet.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
export const SHEET = path.join(ROOT, "content", "voice", "cast.json");

const { values } = parseArgs({ options: { check: { type: "boolean", default: false } } });

const readDir = (dir: string): Record<string, unknown>[] =>
  fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as Record<string, unknown>);

const chapters = readDir(path.join(ROOT, "content", "chapters"));
const campaigns = readDir(path.join(ROOT, "content", "campaigns"));
const canon = yaml.load(fs.readFileSync(path.join(ROOT, "canon", "individuals.yaml"), "utf8")) as { individuals?: IndividualLike[] };
const narration = inventory({ chapters, campaigns }, { facetsMax: 6 })
  .filter((line) => line.kind === "narration" || line.kind === "cue" || line.kind === "prompt")
  .map((line) => ({ address: line.address, chapter: line.chapter, text: line.text }));

const previous = fs.existsSync(SHEET) ? (JSON.parse(fs.readFileSync(SHEET, "utf8")) as CastSheet) : null;
const sheet = buildSheet({ chapters: chapters as unknown as ChapterLike[], individuals: canon.individuals ?? [], narration }, previous);
const out: CastSheet = {
  $comment:
    "The cast voice sheet (docs/voice-cast.md). Built by `npm run voice:cast` from the chapters' voiceGuide.npcVoices, their scene casts and canon/individuals.yaml; edit voices on the cast page (`npm run voice:bakeoff -- --serve`, then /cast) or here. An entry with status \"approved\" is never changed by a rebuild, and a provisional one keeps its voice. `lines` are real quotes from the narration, for auditions.",
  accent: sheet.accent,
  speakers: sheet.speakers,
};

const entries = Object.values(out.speakers);
const clashes = voiceClashes(out);
const silent = entries.filter((e) => e.kind !== "narrator" && e.kind !== "party" && e.speaks && e.lines.length === 0);
console.log(`${String(entries.length)} speakers: ${String(entries.filter((e) => e.status === "approved").length)} approved, ${String(entries.filter((e) => e.status === "provisional").length)} provisional.`);
console.log(`${String(entries.filter((e) => e.lines.length > 0).length)} have lines from the game to audition; ${String(silent.length)} speak but have none found yet.`);
const used = new Map<string, number>();
for (const e of entries) used.set(e.gemini.voice, (used.get(e.gemini.voice) ?? 0) + 1);
console.log(`Voices: ${[...used].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} ${String(n)}`).join(", ")}`);
if (clashes.length > 0) {
  console.log(`\n${String(clashes.length)} chapters have two speakers on one voice:`);
  for (const clash of clashes.slice(0, 20)) console.log(`  ${clash.chapter}: ${clash.voice} — ${clash.speakers.join(", ")}`);
} else {
  console.log("No chapter has two speakers on one voice.");
}

if (values.check) {
  process.exit(clashes.length > 0 ? 1 : 0);
}
fs.mkdirSync(path.dirname(SHEET), { recursive: true });
fs.writeFileSync(SHEET, `${JSON.stringify(out, null, 2)}\n`);
console.log(`\nWrote ${path.relative(ROOT, SHEET)}.`);
