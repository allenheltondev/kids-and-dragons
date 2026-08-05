/**
 * The half of D9 that needs both corpora — extracted from `check.ts` so it can
 * be tested.
 *
 * Canon says a creature is a `skirmisher`; `content/rules.json` says what a
 * skirmisher is worth. Neither file can check the other alone, which is why
 * this rule cannot live in the creature schema and why it is the one piece of
 * `canon:check` that is not simply `@kad/canon` reporting on itself.
 *
 * It lives in its own module rather than in `check.ts` for a plain reason:
 * `check.ts` is a script that loads canon, prints a report and calls
 * `process.exit` at module scope, so importing it to test anything inside it
 * runs the whole gate and can take the test process down with it. A rule worth
 * having is a rule worth calling directly.
 *
 * Takes what it reads rather than reaching for it — the creatures and the
 * parsed rules — so a test can pose a question ("what if a creature claims a
 * band nobody defined?") without a fixture canon tree on disk.
 */

import { bandTable, resolveStats, ENCOUNTER_HP_WINDOW } from "@kad/canon";
import type { CanonIssue, Creature } from "@kad/canon";

export function checkBands(creatures: readonly Creature[], rules: unknown): CanonIssue[] {
  const issues: CanonIssue[] = [];
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

  for (const creature of creatures) {
    const encounter = creature.encounter;
    if (!encounter) continue;
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
