#!/usr/bin/env node
/**
 * The canon gate — `npm run canon:check`.
 *
 * Until now nothing validated canon in CI. `tools/content/validate.mjs` checks
 * a chapter's biome against `assets/manifest.json` and has no concept of a
 * creature id; `validateCanon()` lives inside `wiki:generate`, which is manual.
 * So the corpus that `agent_instructions` calls authoritative was the one thing
 * no build step read.
 *
 * Exits non-zero on any error. Warnings print and pass — they mark things that
 * are *allowed* to be incomplete while the elaboration pass is underway.
 */

import path from "node:path";
import process from "node:process";
import { loadCanon, errors, warnings, formatIssue, TAXONOMIES } from "@kad/canon";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const tty = process.stdout.isTTY;
const RED = tty ? "[31m" : "";
const GREEN = tty ? "[32m" : "";
const YELLOW = tty ? "[33m" : "";
const DIM = tty ? "[2m" : "";
const BOLD = tty ? "[1m" : "";
const OFF = tty ? "[0m" : "";

/**
 * Known gaps — references to places canon talks about but has never defined.
 *
 * These are D11 in docs/canon-contract.md, awaiting a ruling: promote them to
 * entities or drop the references. Inventing them here is not an option —
 * `locations.yaml` says "Do not invent new locations without explicit canon
 * approval," and a gate that silences a rule by breaking it is worse than no
 * gate.
 *
 * So they are demoted to warnings, listed on every run, and this list may only
 * ever shrink — `open_sea` and `the_whirlpool` came off it when Allen ruled
 * that a biome is an ecological region and a location is a place inside one.
 *
 * `bramblewood` is left because the ruling and the corpus disagree about where
 * it is: it was called a location of the plains, while canon files it under
 * `biome.enchanted_woods` and `content/chapters/bramblewood-01.json` renders it
 * with `biome: enchanted_woods`. Picking either silently would change which art
 * the only shipped chapter uses.
 */
const KNOWN_GAPS = new Set(["bramblewood"]);

const registry = loadCanon(path.join(ROOT, "canon"));
const isKnownGap = (message: string): boolean =>
  [...KNOWN_GAPS].some((gap) => message.includes(`"${gap}"`));

const fatal = errors(registry).filter((issue) => !isKnownGap(issue.message));
const soft = [
  ...warnings(registry),
  ...errors(registry)
    .filter((issue) => isKnownGap(issue.message))
    .map((issue) => ({ ...issue, level: "warning" as const, message: `${issue.message} — D11` })),
];

console.log(`${BOLD}Kids & Dragons — canon check${OFF}`);
console.log(`${DIM}canon/ · ${registry.byId.size} entities · ${registry.edges.length} edges${OFF}\n`);

for (const taxonomy of TAXONOMIES) {
  const count = registry.byTaxonomy.get(taxonomy)?.length ?? 0;
  const bad = fatal.filter((issue) => {
    const id = issue.id ?? "";
    return registry.taxonomyOf.get(id) === taxonomy;
  }).length;
  const mark = bad > 0 ? `${RED}FAIL${OFF}` : `${GREEN}pass${OFF}`;
  console.log(`  ${mark}  ${taxonomy.padEnd(10)} ${String(count).padStart(3)}`);
}

if (soft.length > 0) {
  console.log(`\n${YELLOW}${soft.length} warning(s)${OFF}`);
  for (const issue of soft) console.log(`  ${formatIssue(issue)}`);
}

if (fatal.length > 0) {
  console.log(`\n${RED}${BOLD}${fatal.length} error(s)${OFF}`);
  for (const issue of fatal) console.log(`  ${formatIssue(issue)}`);
  console.log(
    `\n${RED}${BOLD}FAILED${OFF} — canon is the source of truth (docs/canon-contract.md).`,
  );
  process.exit(1);
}

console.log(`\n${GREEN}${BOLD}PASS${OFF} — ${registry.byId.size} entities, ${registry.edges.length} edges.`);
