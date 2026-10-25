import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { maxStatGainAt, MAX_STAT_GAIN, spendableStatsOf } from "./character.js";
import { levelBonuses, levelForXp, maxLevel, tierForLevel, xpToNextLevel } from "./rules.js";
import { assertRulesContent } from "./rules.js";
import { makeRules } from "./test-fixtures.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SHIPPED = assertRulesContent(
  JSON.parse(fs.readFileSync(path.join(ROOT, "content", "rules.json"), "utf8")),
);

// spec §8.1, "Beyond level 10": the shipped rules, not the round-number fixture.
describe("levels 11 to 30", () => {
  it("leaves the first ten thresholds exactly where they were", () => {
    expect(SHIPPED.levelXp.slice(0, 9)).toEqual([100, 300, 700, 1100, 1700, 2600, 3500, 4700, 6300]);
  });

  it("tops out at level 30, each step 200 dearer than the last", () => {
    expect(maxLevel(SHIPPED)).toBe(30);
    const totals = [0, ...SHIPPED.levelXp];
    const steps = totals.slice(1).map((t, i) => t - (totals[i] ?? 0));
    expect(steps[9]).toBe(1800); // level 10 -> 11
    for (let i = 10; i < steps.length; i++) expect(steps[i]).toBe((steps[i - 1] ?? 0) + 200);
    expect(levelForXp(SHIPPED, 6299)).toBe(9);
    expect(levelForXp(SHIPPED, 6300)).toBe(10);
    expect(levelForXp(SHIPPED, 8100)).toBe(11);
    expect(levelForXp(SHIPPED, SHIPPED.levelXp.at(-1) ?? 0)).toBe(30);
    expect(xpToNextLevel(SHIPPED, 999999)).toBeNull();
  });

  it("opens three tiers past Mythic, at 15, 20 and 30", () => {
    expect(tierForLevel(SHIPPED, 14)).toBe("mythic");
    expect(tierForLevel(SHIPPED, 15)).toBe("ascendant");
    expect(tierForLevel(SHIPPED, 19)).toBe("ascendant");
    expect(tierForLevel(SHIPPED, 20)).toBe("eternal");
    expect(tierForLevel(SHIPPED, 29)).toBe("eternal");
    expect(tierForLevel(SHIPPED, 30)).toBe("legendary");
  });

  it("grows HP every level and Guard at each tier", () => {
    const at10 = levelBonuses(SHIPPED, 10);
    expect(levelBonuses(SHIPPED, 11).maxHp).toBe(at10.maxHp + 1);
    expect(levelBonuses(SHIPPED, 14).guard).toBe(at10.guard);
    expect(levelBonuses(SHIPPED, 15).guard).toBe(at10.guard + 1);
    expect(levelBonuses(SHIPPED, 30).guard).toBe(at10.guard + 3);
    expect(levelBonuses(SHIPPED, 30).maxHp).toBe(at10.maxHp + 20 + 3);
  });
});

describe("the stat ceiling", () => {
  it("is nine through level 10 and rises one per five levels after", () => {
    expect(maxStatGainAt(1)).toBe(MAX_STAT_GAIN);
    expect(maxStatGainAt(10)).toBe(9);
    expect(maxStatGainAt(14)).toBe(9);
    expect(maxStatGainAt(15)).toBe(10);
    expect(maxStatGainAt(20)).toBe(11);
    expect(maxStatGainAt(30)).toBe(13);
  });

  it("lets a level 15 hero spend past nine and a level 10 hero not", () => {
    const rules = makeRules();
    const progress = (xp: number) => ({
      xp,
      stats: { ...rules.baseStats, might: rules.baseStats.might + 9 },
    });
    // The fixture curve reaches level 10 at 6300 XP.
    const atTen = progress(6300) as never;
    expect(spendableStatsOf(atTen, rules)).not.toContain("might");
    const rules30 = SHIPPED;
    const atFifteen = {
      xp: rules30.levelXp[13] ?? 0,
      stats: { ...rules30.baseStats, might: rules30.baseStats.might + 9 },
    } as never;
    expect(spendableStatsOf(atFifteen, rules30)).toContain("might");
  });
});
