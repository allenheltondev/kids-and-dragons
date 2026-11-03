#!/usr/bin/env node
/**
 * Quotes in the narration that nobody is tagged for, so a writer can add the tag — `npm run voice:untagged`
 * (docs/voice-cast.md, "Tagging lines"). Reports only; it never edits a chapter.
 *
 *   npm run voice:untagged                    # a count per chapter
 *   npm run voice:untagged -- --chapter gemfall-06
 *   npm run voice:untagged -- --who skupper_cousin   # quotes in scenes this character is cast in
 *   npm run voice:untagged -- --silent        # only scenes with a speaker who has no counted lines yet
 *   npm run voice:untagged -- --missing       # only quotes that are counted for nobody (not even as a guess)
 *
 * Only quotes that read as something said (looksSpoken) are listed: a sign, a fragment or the party's own "you say" is not.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildSheet, looksSpoken, type CastSheet, type UntaggedQuote } from "./sheet.ts";
import { loadSources } from "./sources.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const { values } = parseArgs({ options: { chapter: { type: "string" }, who: { type: "string" }, silent: { type: "boolean", default: false }, missing: { type: "boolean", default: false } } });

const previous = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "voice", "cast.json"), "utf8")) as CastSheet;
const loose: UntaggedQuote[] = [];
const sheet = buildSheet(loadSources(ROOT), previous, loose);
const silent = new Set(Object.entries(sheet.speakers).filter(([, e]) => e.speaks && e.kind !== "narrator" && e.kind !== "party" && (e.lineCount ?? 0) === 0).map(([id]) => id));
const name = (id: string): string => sheet.speakers[id]?.name ?? id;

const chapterOf = (quote: UntaggedQuote): string => quote.address.split("/")[0]!;
let shown = loose.filter((quote) => looksSpoken(quote));
if (values.chapter) shown = shown.filter((quote) => chapterOf(quote) === values.chapter);
if (values.who) shown = shown.filter((quote) => quote.scene.includes(values.who!));
if (values.missing) shown = shown.filter((quote) => !quote.guessed);
if (values.silent) shown = shown.filter((quote) => quote.scene.some((id) => silent.has(id)));

if (!values.chapter && !values.who && !values.silent) {
  console.log(`${String(shown.filter((quote) => !quote.guessed).length)} of them are counted for nobody, not even as a guess (--missing)`);
  const counts = new Map<string, number>();
  for (const quote of shown) counts.set(chapterOf(quote), (counts.get(chapterOf(quote)) ?? 0) + 1);
  for (const [chapter, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${String(count).padStart(4)}  ${chapter}`);
  console.log(`${String(shown.length).padStart(4)}  untagged quotes that read as spoken, of ${String(loose.length)} untagged`);
  process.exit(0);
}
for (const quote of shown) {
  const cast = quote.scene.map((id) => `${name(id)}${silent.has(id) ? " (no lines yet)" : ""}`).join(", ") || "nobody cast";
  console.log(`${quote.address}\n  in the scene: ${cast}\n  …${quote.before.replace(/\s+/g, " ")}[“${quote.words}”]${quote.after.replace(/\s+/g, " ")}…\n`);
}
