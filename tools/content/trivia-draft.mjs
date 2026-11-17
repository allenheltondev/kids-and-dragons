#!/usr/bin/env node
/**
 * Draft Field Guide quiz questions for one page (docs/trivia.md §3.1).
 *
 *     npm run trivia:draft -- creature.bone_crawler
 *     npm run trivia:draft -- class.thornguard --seed 2
 *
 * Prints candidate questions as JSON, built from the page's own fields
 * (its hook, likes, pastimes, beliefs, neighbors, a class's gear, home and
 * moves), with wrong options drawn from pages of the same kind. They are
 * drafts for a writer to keep, rewrite or drop, never content: this tool
 * writes nothing. Each draft's `also` is filled from the pages its words
 * name (as content:validate reads them), and `_notes` says what to fix
 * before it can ship (long options, too few wrong options, a link to check).
 * Delete `_notes` when a draft goes into content/trivia/<group>.json.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeRng } from "../../packages/shared/src/dice.ts";
import { MAX_ASK_WORDS, MAX_OPTION_WORDS, pagesNamed } from "./trivia-bank.mjs";

const GUIDE = fileURLToPath(new URL("../../content/field-guide.json", import.meta.url));

const words = (text) => text.trim().split(/\s+/).filter(Boolean);
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "q";
const lower = (title) => title.replace(/^The\s+/, "").toLowerCase();

/** A sentence cut to its first clause, and to an option's length. */
export function optionOf(text) {
  const first = text.split(/(?<=[.!?:;])\s/)[0].replace(/[.!?:;,]+$/, "");
  const clause = first.split(/,\s/)[0];
  const cut = words(clause).slice(0, MAX_OPTION_WORDS).join(" ");
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

function pick(list, n, rng, avoid = new Set()) {
  const pool = [...new Set(list.filter((x) => x && !avoid.has(x.toLowerCase())))];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/**
 * The drafts for one page: `{ id, entry, ask, answer, wrong, also, link, _notes }[]`.
 * Pure for a guide, an entry id and a seed.
 */
export function draftQuestions(guide, entryId, seed = 1) {
  const entries = guide.entries;
  const entry = entries[entryId];
  if (!entry) throw new Error(`"${entryId}" is not a page of content/field-guide.json`);
  const rng = makeRng(`${entryId}:${seed}`);
  const kin = Object.values(entries).filter((e) => e.id !== entryId && e.kind === entry.kind);
  const name = lower(entry.title);
  const drafts = [];
  const add = (key, ask, answer, wrongPool, link = "entry") => {
    const wrong = pick(wrongPool, 6, rng, new Set([answer.toLowerCase()]));
    drafts.push({ id: `${entryId}.${slug(key)}`, entry: entryId, ask, answer, wrong, also: [], link });
  };

  const lore = entry.lore ?? {};
  if (lore.hook) {
    const ask = entry.kind === "creature" && /^an? /i.test(lore.hook)
      ? `Which creature is ${lore.hook.replace(/\.$/, "").replace(/^A/, "a")}?`
      : `Who is this? "${lore.hook.replace(/\.$/, "")}"`;
    add("hook", ask, entry.title, kin.map((e) => e.title), "shelf");
  }
  for (const like of (lore.likes ?? []).slice(0, 1)) {
    add("likes", `Who does a ${name} like best?`, like.title, kin.flatMap((e) => (e.lore?.likes ?? []).map((l) => l.title)));
  }
  if (lore.pastimes?.length) {
    add("pastime", `Which of these does a ${name} love to do?`, optionOf(lore.pastimes[0]), kin.flatMap((e) => (e.lore?.pastimes ?? []).map(optionOf)));
  }
  const place = entry.place ?? {};
  if (place.common_beliefs?.length) {
    add("belief", `What do folk in ${entry.title.replace(/^The /, "the ")} say?`, optionOf(place.common_beliefs[0]), kin.flatMap((e) => (e.place?.common_beliefs ?? []).map(optionOf)));
  }
  const neighbors = (place.regional_relationships ?? []).filter((r) => entries[r.place]);
  if (neighbors.length) {
    const near = new Set(neighbors.map((r) => r.title.toLowerCase()));
    add("neighbor", `Which place is a neighbor of ${entry.title.replace(/^The /, "the ")}?`, neighbors[0].title, Object.values(entries).filter((e) => e.category === "places" && e.id !== entryId && !near.has(e.title.toLowerCase())).map((e) => e.title));
  }
  const cls = entry.class;
  if (cls) {
    add("gear", `What does a ${entry.title} carry?`, cls.gear.charAt(0).toUpperCase() + cls.gear.slice(1), kin.map((e) => e.class?.gear).filter(Boolean).map((g) => g.charAt(0).toUpperCase() + g.slice(1)));
    if (cls.homeTitle) add("home", `Where do heroes learn to be a ${entry.title}?`, cls.homeTitle, kin.map((e) => e.class?.homeTitle).filter(Boolean));
    const ranks = ["apprentice", "expert", "master"];
    const moves = (c) => (c?.distinctions ?? []).map((d) => d.move);
    for (const [i, rank] of ranks.entries()) {
      const mine = cls.distinctions?.find((d) => d.rank === rank);
      if (!mine) continue;
      const which = ["first", "second", "last"][i];
      add(`move_${rank}`, `Which move does a ${entry.title} learn ${which}?`, mine.move, [...moves(cls).filter((m) => m !== mine.move), ...kin.flatMap((e) => moves(e.class))]);
    }
  }
  if (entry.short_description && drafts.length === 0) {
    add("what", `What is ${entry.title}?`, optionOf(entry.short_description), kin.map((e) => e.short_description).filter(Boolean).map(optionOf));
  }

  for (const d of drafts) {
    const named = new Set();
    for (const text of [d.ask, d.answer, ...d.wrong]) for (const p of pagesNamed(text, guide)) if (p.id !== entryId) named.add(p.id);
    d.also = [...named].sort();
    const notes = [];
    if (words(d.ask).length > MAX_ASK_WORDS) notes.push(`the ask is ${words(d.ask).length} words; keep it under 20`);
    for (const o of [d.answer, ...d.wrong]) if (words(o).length > MAX_OPTION_WORDS) notes.push(`"${o}" is too long`);
    if (d.wrong.length < 5) notes.push(`only ${d.wrong.length} wrong option(s): write ${5 - d.wrong.length} more`);
    if (d.also.length) notes.push(`asked only once ${d.also.join(", ")} ${d.also.length === 1 ? "is" : "are"} found too; reword a wrong option to drop one`);
    notes.push("cut options to a few plain words, and make every wrong option plausible");
    d._notes = notes;
  }
  return drafts;
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith("--"));
  const seedAt = argv.indexOf("--seed");
  const seed = seedAt >= 0 ? argv[seedAt + 1] : "1";
  const entryId = args.find((a) => a !== seed);
  if (!entryId) {
    console.error("usage: npm run trivia:draft -- <field guide entry id> [--seed N]");
    return 2;
  }
  const guide = JSON.parse(readFileSync(GUIDE, "utf8"));
  try {
    console.log(JSON.stringify(draftQuestions(guide, entryId, seed), null, 2));
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
