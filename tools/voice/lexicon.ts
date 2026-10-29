#!/usr/bin/env node
/**
 * Names the game says aloud — `npm run voice:lexicon [-- --all] [--json]`.
 *
 * Made-up words are where a voice model most often goes wrong (Pib, Gemfall,
 * Riftlight, place names). This lists every name in the spoken text, how often
 * it is heard, and whether `content/voice/lexicon.json` says how to say it, so
 * a person can listen to the frequent ones and add a respelling only where the
 * model gets it wrong (docs/voice-narration-plan.md §2). Writes nothing.
 *
 * A "name" is a capitalized word the content never writes in lowercase: "Pib"
 * and "Gemfall" are names, "The" and "Beyond" are not (they appear as "the",
 * "beyond"). Without `--all`, names already in the lexicon are left out.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { inventory } from "./inventory";
import { CONTENT, loadContent } from "./load";
import type { LexiconFile } from "./world";

export interface NameCount {
  word: string;
  count: number;
  /** One address that says it, to find it again. */
  example: string;
}

const WORD = /[A-Za-z][A-Za-z']*/g;

/** Names (capitalized, never written in lowercase) across these texts, most heard first. */
export function namesIn(lines: readonly { address: string; text: string }[]): NameCount[] {
  const lower = new Set<string>();
  const counts = new Map<string, NameCount>();
  for (const line of lines) {
    for (const match of line.text.matchAll(WORD)) {
      const word = match[0].replace(/'s$/, "");
      if (word.length < 2) continue;
      if (word[0] === word[0]!.toLowerCase()) {
        lower.add(word.toLowerCase());
        continue;
      }
      const seen = counts.get(word);
      if (seen) seen.count += 1;
      else counts.set(word, { word, count: 1, example: line.address });
    }
  }
  return [...counts.values()]
    .filter((n) => !lower.has(n.word.toLowerCase()) && n.word !== n.word.toUpperCase())
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

function main(): void {
  const { values } = parseArgs({ options: { all: { type: "boolean", default: false }, json: { type: "boolean", default: false } } });
  const lines = inventory(loadContent(), { facetsMax: 0 }).filter((l) => l.kind !== "choice");
  const file = path.join(CONTENT, "voice", "lexicon.json");
  const lexicon = (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { words: {} }) as LexiconFile;
  const names = namesIn(lines).map((n) => ({ ...n, say: lexicon.words[n.word]?.say ?? null }));
  const shown = values.all ? names : names.filter((n) => n.say === null);
  if (values.json) {
    console.log(JSON.stringify(shown, null, 2));
    return;
  }
  console.log(`${String(names.length)} names are heard aloud; ${String(names.filter((n) => n.say !== null).length)} have a respelling in content/voice/lexicon.json.`);
  console.log("Listen to the frequent ones and add an entry only where the voice gets it wrong.\n");
  for (const n of shown) console.log(`${String(n.count).padStart(6)}  ${n.word.padEnd(22)}${n.say ? ` -> ${n.say}` : ""}  ${n.example}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
