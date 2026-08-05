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
import fs from "node:fs";
import {
  loadCanon,
  errors,
  warnings,
  formatIssue,
  checkAssets,
  TAXONOMIES,
} from "@kad/canon";
import type { Creature } from "@kad/canon";
import { checkBands } from "./bands.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const tty = process.stdout.isTTY;
const RED = tty ? "[31m" : "";
const GREEN = tty ? "[32m" : "";
const YELLOW = tty ? "[33m" : "";
const DIM = tty ? "[2m" : "";
const BOLD = tty ? "[1m" : "";
const OFF = tty ? "[0m" : "";

const registry = loadCanon(path.join(ROOT, "canon"));

/*
 * There is no known-gap allowlist any more, and that is the point. It held
 * `open_sea`, `the_whirlpool` and `bramblewood` — three places canon named and
 * never defined — until D11 was ruled and all three became entities. A dangling
 * reference is now simply an error.
 */
const bandIssues = checkBands(
  (registry.byTaxonomy.get("creature") ?? []) as Creature[],
  JSON.parse(fs.readFileSync(path.join(ROOT, "content", "rules.json"), "utf8")),
);
const fatal = [...errors(registry), ...bandIssues.filter((i) => i.level === "error")];
const soft = [
  ...warnings(registry),
  ...bandIssues.filter((i) => i.level === "warning"),
  ...checkAssets(registry, path.join(ROOT, "assets"), (p) => fs.existsSync(p)),
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
