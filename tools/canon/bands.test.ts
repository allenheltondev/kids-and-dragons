/**
 * The band gate, from the other side.
 *
 * `canon.test.ts` already checks the shipped numbers: every band's
 * `usualCount × hp` lands inside the four-round window, and every creature
 * resolves stats. That is the positive half, and it proves the corpus is
 * currently fine — not that anything would object if it stopped being fine.
 *
 * These are the objections. Each one poses a corpus that is wrong in exactly
 * one way and requires the specific complaint, because `checkBands` is the one
 * rule in `canon:check` that is not `@kad/canon` reporting on itself: canon
 * says a creature is a `skirmisher`, `content/rules.json` says what a
 * skirmisher is worth, and neither file can check the other alone.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadCanon } from "@kad/canon";
import type { CanonIssue, Creature } from "@kad/canon";
import { checkBands } from "./bands.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));

/** The bands as shipped, so the fixtures below bend real numbers. */
const REAL_RULES: unknown = JSON.parse(
  readFileSync(new URL("../../content/rules.json", import.meta.url), "utf8"),
);

/**
 * A rules file with one band in it, spelled out rather than borrowed, so a
 * retune of `content/rules.json` cannot quietly change what these cases mean.
 * `skirmisher` here is the shipped row: 3 × 6 HP = 18, the bottom of the window.
 */
function rulesWith(bands: Record<string, unknown>): unknown {
  return { encounterBands: bands };
}

const SKIRMISHER = {
  stats: { hp: 6, guard: 11, quick: 3, steps: 5, attack: 3 },
  xp: 5,
  usualCount: 3,
  dangerLevels: ["moderate"],
};

function creature(overrides: Record<string, unknown> = {}): Creature {
  return {
    id: "bramblewisp",
    danger_level: "moderate",
    encounter: { band: "skirmisher" },
    ...overrides,
  } as unknown as Creature;
}

const errorsIn = (issues: readonly CanonIssue[]): CanonIssue[] =>
  issues.filter((i) => i.level === "error");
const warningsIn = (issues: readonly CanonIssue[]): CanonIssue[] =>
  issues.filter((i) => i.level === "warning");

// ---------------------------------------------------------------------------

describe("the shipped corpora", () => {
  it("agree with each other", () => {
    /*
     * The positive case, run the way `canon:check` runs it. It is also the
     * baseline every negative case below leans on: if the real pairing already
     * produced errors, "this broken one produces errors" would prove nothing.
     */
    const registry = loadCanon(`${REPO}canon`);
    const creatures = (registry.byTaxonomy.get("creature") ?? []) as Creature[];
    expect(creatures.length, "canon has no creatures to check").toBeGreaterThan(0);

    expect(errorsIn(checkBands(creatures, REAL_RULES))).toEqual([]);
  });
});

describe("a creature and the band table disagreeing", () => {
  it("rejects a band content/rules.json has never heard of", () => {
    /*
     * The drift this gate exists for. Canon is edited by hand and rules.json
     * by another hand; a creature filed under a band that was renamed or never
     * existed resolves to no stats at all, which is a monster the bestiary
     * generator cannot build and a fight that cannot start.
     */
    const issues = checkBands(
      [creature({ encounter: { band: "swarm" } })],
      rulesWith({ skirmisher: SKIRMISHER }),
    );

    const errors = errorsIn(issues);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('"swarm" is not in content/rules.json encounterBands');
    // And it names what *is* available, so the fix is in the error.
    expect(errors[0]!.message).toContain("skirmisher");
    expect(errors[0]!.id).toBe("bramblewisp");
  });

  it("rejects a danger level the band does not serve", () => {
    // A `legendary` creature filed as a skirmisher is a boss with 6 HP.
    const issues = checkBands(
      [creature({ danger_level: "legendary" })],
      rulesWith({ skirmisher: SKIRMISHER }),
    );

    const errors = errorsIn(issues);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('danger_level "legendary" may not be a skirmisher');
    expect(errors[0]!.message).toContain("moderate");
  });

  it("rejects a band with no default stats unless the creature authors its own", () => {
    /*
     * `legend` ships with `stats: null` on purpose — a legendary beast is a
     * designed encounter, not a rolled one. So the band alone is not enough,
     * and the creature has to bring a complete block.
     */
    const legendBand = { stats: null, xp: 50, usualCount: 1, dangerLevels: ["legendary"] };
    const bare = creature({
      danger_level: "legendary",
      encounter: { band: "legend" },
    });

    const issues = checkBands([bare], rulesWith({ legend: legendBand }));
    expect(errorsIn(issues)[0]?.message).toContain("has no default stats");

    // Authored in full, the same creature is fine.
    const authored = creature({
      danger_level: "legendary",
      encounter: {
        band: "legend",
        stats: { hp: 40, guard: 15, quick: 2, steps: 4, attack: 6 },
      },
    });
    expect(errorsIn(checkBands([authored], rulesWith({ legend: legendBand })))).toEqual([]);
  });

  it("passes over a creature that never fights", () => {
    // Most of canon is places, people and things. Only an entity with an
    // `encounter` block is making a claim this rule can judge.
    const issues = checkBands([creature({ encounter: undefined })], rulesWith({}));
    expect(issues).toEqual([]);
  });

  it("passes over a dangerous thing that is not a fight (D18)", () => {
    /*
     * A hazard — weather, a quicksand marsh — has an `encounter` block saying
     * how to get past it and no `band`, because there is nothing to trade
     * blows with. The band table has nothing to say about it.
     *
     * The corpus currently contains one, so `canon:check` would catch a
     * regression here too; this is the named version, so the rule survives the
     * day somebody removes that entity for unrelated reasons.
     */
    const hazard = creature({
      id: "the_loftmire",
      danger_level: "high",
      encounter: { alternatives: ["observation", "environmental problem-solving"] },
    });

    expect(checkBands([hazard], rulesWith({ skirmisher: SKIRMISHER }))).toEqual([]);
  });
});

describe("the round budget", () => {
  it("warns when a band's usual encounter would not last four rounds", () => {
    /*
     * Spec §7.1 tunes a fight to about four rounds, which puts
     * `usualCount × hp` in an 18–30 window. Outside it the fight is either
     * over before anybody has taken a turn or a slog — both real problems, and
     * neither one a reason to fail a build, so this is a warning.
     */
    const tooSoft = { ...SKIRMISHER, stats: { ...SKIRMISHER.stats, hp: 1 } };
    const issues = checkBands([], rulesWith({ skirmisher: tooSoft }));

    const warnings = warningsIn(issues);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("3 × 1 HP = 3");
    expect(warnings[0]!.id).toBe("encounterBands.skirmisher");
    // A warning prints and passes — it must not be reported as an error.
    expect(errorsIn(issues)).toEqual([]);
  });

  it("warns about a slog as readily as about a walkover", () => {
    const tooHard = { ...SKIRMISHER, stats: { ...SKIRMISHER.stats, hp: 40 } };
    expect(warningsIn(checkBands([], rulesWith({ skirmisher: tooHard })))).toHaveLength(1);
  });

  it("says nothing about a band that is inside the window", () => {
    expect(checkBands([], rulesWith({ skirmisher: SKIRMISHER }))).toEqual([]);
  });

  it("skips the budget for a band that authors no stats", () => {
    // `legend` again: there is no usual encounter to budget for.
    const issues = checkBands([], rulesWith({
      legend: { stats: null, xp: 50, usualCount: 1, dangerLevels: ["legendary"] },
    }));
    expect(issues).toEqual([]);
  });
});
