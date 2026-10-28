#!/usr/bin/env node
/**
 * The dialogue report: `npm run content:dialogue [-- --campaign gemfall] [--chapter ID] [--json]`.
 *
 * Recorded narration has a voice for every cast member, and the voice is only
 * heard when a person speaks in a quoted line (docs/voice-narration-plan.md §3,
 * "Writing more dialogue"). This reads each chapter's spine (the scenes on
 * every path to a success ending) and reports:
 *
 *  - how many spine scenes that put somebody on stage (`cast`) have a quoted
 *    line in the words everyone entering hears (narration and prompt), against
 *    the plan's proposed target of half;
 *  - those spine scenes with a cast and no quote: the candidates for a narrow
 *    rewording ("She tells you the bridge is out" -> `"The bridge is out," she says`);
 *  - cast members who are never quoted anywhere in the chapter.
 *
 * Reports, never gates, like `content:pacing`. A person (or the
 * chapter-cohesion review) decides what to rewrite.
 *
 * "Quoted near them" is deliberately simple: a cast member speaks in a scene
 * when a quote and their name (or the name's last word: "builder" for "Yeti
 * builder") share a sentence. It errs towards "speaks", so the silent list is
 * worth reading and the rest is a hint.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { reachable, sceneTexts } from "./cohesion.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The plan's proposed share of spine scenes with a cast that include a quoted line. */
export const TARGET = 0.5;

const QUOTE = /["“][^"“”]{2,}["”]/;

/** Ending scenes a chapter can close well on: no way on, and not a setback. */
export function successEndings(chapter) {
  return Object.entries(chapter.scenes ?? {})
    .filter(([, s]) => Array.isArray(s.choices) && s.choices.length === 0 && s.outcome !== "setback")
    .map(([id]) => id);
}

/** Scenes on every path from the entry to a success ending: block one and no success ending is reachable. */
export function spine(chapter) {
  const endings = successEndings(chapter);
  const all = reachable(chapter);
  if (!endings.some((id) => all.has(id))) return [];
  return [...all].filter((id) => {
    const without = reachable(chapter, new Set([id]));
    return !endings.some((end) => without.has(end));
  });
}

/** The words everyone entering a scene hears. */
function heard(scene) {
  return [scene.narration, scene.prompt].filter(Boolean).join(" ");
}

function hasQuote(text) {
  return QUOTE.test(text);
}

/** Words that are part of a name but would match everyone: titles and plain adjectives. */
const NOT_A_NAME = new Set(["the", "old", "young", "little", "big", "madame", "master", "mister", "missus", "professor", "elder", "sir", "lady", "lord"]);

/** The names a cast member can be called by: the whole name and each distinctive word of it. */
export function namesFor(member) {
  const full = member.name.trim();
  const words = full.split(/[\s-]+/).filter((w) => w.length >= 3 && !NOT_A_NAME.has(w.toLowerCase()));
  return [...new Set([full, ...words])];
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether a quote has one of these names within about a sentence of it, either side. */
export function speaksIn(text, names, reach = 140) {
  const re = new RegExp(`\\b(?:${names.map(escapeRe).join("|")})\\b`, "i");
  for (const m of text.matchAll(new RegExp(QUOTE.source, "g"))) {
    const around = text.slice(Math.max(0, m.index - reach), m.index + m[0].length + reach);
    if (re.test(around)) return true;
  }
  return false;
}

export function dialogueReport(chapter, silentOk = new Set()) {
  const scenes = chapter.scenes ?? {};
  const onSpine = spine(chapter);
  const withCast = onSpine.filter((id) => (scenes[id]?.cast ?? []).length > 0);
  const spoken = withCast.filter((id) => hasQuote(heard(scenes[id])));
  const quiet = withCast.filter((id) => !hasQuote(heard(scenes[id])));

  const members = new Map();
  for (const scene of Object.values(scenes)) for (const m of scene.cast ?? []) if (m.name && !members.has(m.name)) members.set(m.name, m);
  const allText = Object.values(scenes).flatMap((s) => sceneTexts(s).map((t) => t.text));
  const silent = [...members.values()]
    .filter((m) => !silentOk.has(m.name.toLowerCase()))
    .filter((m) => !allText.some((text) => speaksIn(text, namesFor(m))))
    .map((m) => m.name);

  return {
    chapter: chapter.id,
    campaign: chapter.campaignId ?? null,
    spine: onSpine.length,
    spineWithCast: withCast.length,
    spokenOnSpine: spoken.length,
    share: withCast.length === 0 ? null : spoken.length / withCast.length,
    quietSpineScenes: quiet,
    silentCast: silent,
  };
}

/** Cast-sheet names marked as not speaking (creatures that only bleat), which are never "silent". */
function nonSpeakers() {
  try {
    const sheet = JSON.parse(readFileSync(join(root, "content", "voice", "cast.json"), "utf8"));
    const out = new Set();
    for (const entry of Object.values(sheet.speakers ?? {})) {
      if (entry.speaks === false) for (const n of [entry.name, ...(entry.aliases ?? [])]) if (n) out.add(String(n).toLowerCase());
    }
    return out;
  } catch {
    return new Set();
  }
}

function main() {
  const { values } = parseArgs({ options: { campaign: { type: "string" }, chapter: { type: "string" }, json: { type: "boolean", default: false } } });
  const dir = join(root, "content", "chapters");
  const chapters = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
    .filter((c) => (values.campaign === undefined || c.campaignId === values.campaign) && (values.chapter === undefined || c.id === values.chapter));
  if (chapters.length === 0) {
    console.error("No chapters matched.");
    process.exit(2);
  }
  const silentOk = nonSpeakers();
  const rows = chapters.map((c) => dialogueReport(c, silentOk));
  if (values.json) {
    console.log(JSON.stringify({ target: TARGET, rows }, null, 2));
    return;
  }
  const pct = (x) => (x === null ? "  n/a" : `${String(Math.round(x * 100)).padStart(4)}%`);
  console.log(`Dialogue on the spine: spine scenes with a cast that have a quoted line (target ${String(TARGET * 100)}%).\n`);
  console.log(`${"chapter".padEnd(34)}${"spine".padStart(6)}${"cast".padStart(6)}${"spoken".padStart(8)}${"share".padStart(7)}`);
  for (const r of rows) {
    const mark = r.share !== null && r.share < TARGET ? "  below" : "";
    console.log(`${r.chapter.padEnd(34)}${String(r.spine).padStart(6)}${String(r.spineWithCast).padStart(6)}${String(r.spokenOnSpine).padStart(8)}${pct(r.share)}${mark}`);
  }
  if (values.chapter !== undefined) {
    const r = rows[0];
    console.log(`\nSpine scenes with a cast and no quoted line (candidates for a narrow rewording):\n  ${r.quietSpineScenes.join("\n  ") || "none"}`);
    console.log(`\nCast never quoted in this chapter:\n  ${r.silentCast.join("\n  ") || "none"}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
