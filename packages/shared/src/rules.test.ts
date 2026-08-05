import { describe, expect, it } from "vitest";

import {
  assertRulesContent,
  getClass,
  getSpecies,
  levelForXp,
  maxLevel,
  tierForLevel,
  tnFor,
  xpToNextLevel,
} from "./rules.js";
import { makeRules } from "./test-fixtures.js";

const rules = makeRules();

describe("lookups", () => {
  it("finds species and classes", () => {
    expect(getSpecies(rules, "bigfoot").passive.maxHp).toBe(2);
    expect(getClass(rules, "duskrunner").stat).toBe("quick");
  });

  it("throws with the id in the message when content is missing an entry", () => {
    const broken = makeRules();
    // @ts-expect-error — simulating a hand-edited rules.json with a gap
    delete broken.species.kitsune;
    expect(() => getSpecies(broken, "kitsune")).toThrow(/unknown species "kitsune"/);
  });

  it("maps difficulty to the three target numbers in spec §4.1", () => {
    expect(tnFor(rules, "easy")).toBe(8);
    expect(tnFor(rules, "normal")).toBe(12);
    expect(tnFor(rules, "hard")).toBe(16);
  });
});

describe("levels", () => {
  it("starts at 1 and steps at each threshold", () => {
    expect(levelForXp(rules, 0)).toBe(1);
    expect(levelForXp(rules, 299)).toBe(1);
    expect(levelForXp(rules, 300)).toBe(2);
    expect(levelForXp(rules, 699)).toBe(2);
    expect(levelForXp(rules, 700)).toBe(3);
  });

  it("caps at the top of the curve", () => {
    expect(maxLevel(rules)).toBe(10);
    expect(levelForXp(rules, 6300)).toBe(10);
    expect(levelForXp(rules, 999999)).toBe(10);
  });

  it("reports XP owed to the next level, clamps negative XP, and returns null at max", () => {
    expect(xpToNextLevel(rules, -50)).toBe(300);
    expect(xpToNextLevel(rules, 0)).toBe(300);
    expect(xpToNextLevel(rules, 250)).toBe(50);
    expect(xpToNextLevel(rules, 300)).toBe(400);
    expect(xpToNextLevel(rules, 6300)).toBeNull();
    expect(xpToNextLevel(rules, 999999)).toBeNull();
  });
});

describe("tiers", () => {
  it("maps the four appearance tiers from spec §8.1", () => {
    expect(tierForLevel(rules, 1)).toBe("fledgling");
    expect(tierForLevel(rules, 3)).toBe("fledgling");
    expect(tierForLevel(rules, 4)).toBe("sworn");
    expect(tierForLevel(rules, 6)).toBe("sworn");
    expect(tierForLevel(rules, 7)).toBe("radiant");
    expect(tierForLevel(rules, 10)).toBe("mythic");
    expect(tierForLevel(rules, 12)).toBe("mythic");
  });
});

describe("assertRulesContent", () => {
  it("accepts a well-formed rules file and returns it typed", () => {
    const json = JSON.parse(JSON.stringify(rules)) as unknown;
    const parsed = assertRulesContent(json);
    expect(parsed.creationPoints).toBe(3);
    expect(parsed.classes.songkeeper.unlocks["6"]?.id).toBe("chorus");
  });

  it("names the offending field", () => {
    const bad = JSON.parse(JSON.stringify(rules)) as Record<string, unknown>;
    delete bad["baseGuard"];
    expect(() => assertRulesContent(bad)).toThrow(/baseGuard must be a finite number/);
  });

  it("rejects a missing species rather than failing when someone picks it", () => {
    const bad = JSON.parse(JSON.stringify(rules)) as { species: Record<string, unknown> };
    delete bad.species["manticore"];
    expect(() => assertRulesContent(bad)).toThrow(/species\.manticore must be an object/);
  });

  it("rejects a stat that is not one of the four", () => {
    const bad = JSON.parse(JSON.stringify(rules)) as {
      classes: Record<string, Record<string, unknown>>;
    };
    bad.classes["thornguard"]!["stat"] = "charisma";
    expect(() => assertRulesContent(bad)).toThrow(/classes\.thornguard\.stat must be one of/);
  });

  it("rejects a species passive that grants nothing", () => {
    const bad = JSON.parse(JSON.stringify(rules)) as {
      species: Record<string, { passive: Record<string, unknown> }>;
    };
    delete bad.species["unicorn"]!.passive["stat"];
    expect(() => assertRulesContent(bad)).toThrow(/either a `stat` or a `maxHp` bonus/);
  });

  it("rejects an empty XP curve", () => {
    const bad = JSON.parse(JSON.stringify(rules)) as { levelXp: number[] };
    bad.levelXp = [];
    expect(() => assertRulesContent(bad)).toThrow(
      /levelXp must be a non-empty array of XP thresholds/,
    );
  });

  it("rejects a non-strictly-increasing XP curve and identifies the offending index", () => {
    const bad = JSON.parse(JSON.stringify(rules)) as { levelXp: number[] };
    bad.levelXp = [100, 200, 200, 300];
    expect(() => assertRulesContent(bad)).toThrow(
      /levelXp\[2\] must be greater than levelXp\[1\] \(200\)/,
    );
  });

  it("rejects rules where the base tier is not level 1", () => {
    const bad = JSON.parse(JSON.stringify(rules)) as { tierLevels: Record<string, number> };
    bad.tierLevels["fledgling"] = 2;
    expect(() => assertRulesContent(bad)).toThrow(/tierLevels\.fledgling/);
  });

  it("rejects non-objects outright", () => {
    expect(() => assertRulesContent(null)).toThrow(/root must be an object/);
    expect(() => assertRulesContent([])).toThrow(/root must be an object/);
  });
});
