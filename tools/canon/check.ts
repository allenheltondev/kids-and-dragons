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
  bandTable,
  resolveStats,
  ENCOUNTER_HP_WINDOW,
  TAXONOMIES,
} from "@kad/canon";
import type { CanonIssue, Creature } from "@kad/canon";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const tty = process.stdout.isTTY;
const RED = tty ? "[31m" : "";
const GREEN = tty ? "[32m" : "";
const YELLOW = tty ? "[33m" : "";
const DIM = tty ? "[2m" : "";
const BOLD = tty ? "[1m" : "";
const OFF = tty ? "[0m" : "";

const registry = loadCanon(path.join(ROOT, "canon"));
/**
 * The half of D9 that needs both corpora.
 *
 * Canon says a creature is a `skirmisher`; `content/rules.json` says what a
 * skirmisher is worth. Neither file can check the other alone, and this is the
 * one place that reads both — which is exactly why the band/danger_level gate
 * and the round-budget check live here rather than in the creature schema.
 */
function checkBands(): CanonIssue[] {
  const issues: CanonIssue[] = [];
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "rules.json"), "utf8"));
  const bands = bandTable(rules);

  // The band table itself: does a usual-count encounter last about four rounds?
  for (const [name, row] of Object.entries(bands)) {
    if (!row.stats) continue;
    const total = row.stats.hp * row.usualCount;
    if (total < ENCOUNTER_HP_WINDOW.min || total > ENCOUNTER_HP_WINDOW.max) {
      issues.push({
        level: "warning",
        file: "content/rules.json",
        id: `encounterBands.${name}`,
        message: `${row.usualCount} × ${row.stats.hp} HP = ${total}, outside the ${ENCOUNTER_HP_WINDOW.min}–${ENCOUNTER_HP_WINDOW.max} round budget (spec §7.1)`,
      });
    }
  }

  for (const entity of registry.byTaxonomy.get("creature") ?? []) {
    const creature = entity as Creature;
    const encounter = creature.encounter;
    if (!encounter) continue;
    // D18. No band, no fight, nothing here to check — the schema has already
    // held it to the rules that *do* apply (no stats, no xp, no behavior, and
    // at least one way past). A band table has nothing to say about weather.
    if (!encounter.band) continue;
    const row = bands[encounter.band];

    if (!row) {
      issues.push({
        level: "error",
        file: "creatures.yaml",
        id: creature.id,
        field: "encounter.band",
        message: `"${encounter.band}" is not in content/rules.json encounterBands (${Object.keys(bands).join(", ")})`,
      });
      continue;
    }
    if (!row.dangerLevels.includes(creature.danger_level)) {
      issues.push({
        level: "error",
        file: "creatures.yaml",
        id: creature.id,
        field: "encounter.band",
        message: `danger_level "${creature.danger_level}" may not be a ${encounter.band} (that band serves ${row.dangerLevels.join(", ")})`,
      });
    }
    if (!resolveStats(encounter, bands)) {
      issues.push({
        level: "error",
        file: "creatures.yaml",
        id: creature.id,
        field: "encounter.stats",
        message: `band "${encounter.band}" has no default stats — author a complete block`,
      });
    }
  }
  return issues;
}

/*
 * There is no known-gap allowlist any more, and that is the point. It held
 * `open_sea`, `the_whirlpool` and `bramblewood` — three places canon named and
 * never defined — until D11 was ruled and all three became entities. A dangling
 * reference is now simply an error.
 */
const bandIssues = checkBands();
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
