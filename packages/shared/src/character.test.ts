import { describe, expect, it } from "vitest";

import {
  awardXp,
  commitCampaign,
  effectiveProgress,
  failCampaign,
  newCharacter,
  resolveCharacter,
  startCampaign,
} from "./character.js";
import type { Character, Stats } from "./types/domain.js";
import { APPEARANCE, makeCharacter, makeItems, makeRules } from "./test-fixtures.js";

const rules = makeRules();
const items = makeItems();

function creation(stats: Partial<Stats> = {}) {
  return {
    id: "c_9x1",
    householdId: "h_4k2",
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn" as const,
    class: "songkeeper" as const,
    stats: { might: 0, quick: 0, clever: 0, heart: 3, ...stats },
    appearance: APPEARANCE,
    rules,
    now: "2026-07-28T00:00:00.000Z",
  };
}

describe("newCharacter (spec §5)", () => {
  it("builds a level-1 character with base stats plus the assigned points", () => {
    const character = newCharacter(creation());
    expect(character.committed.level).toBe(1);
    expect(character.committed.xp).toBe(0);
    expect(character.committed.tier).toBe("fledgling");
    // baseStats are 1 each; three points went to Heart. The species bonus is
    // applied at resolve time, not stored.
    expect(character.committed.stats).toEqual({ might: 1, quick: 1, clever: 1, heart: 4 });
    expect(character.committed.unlockedActions).toEqual(["rally"]);
    expect(character.provisional).toBeNull();
    expect(character.questItems).toEqual([]);
    expect(character.souvenirs).toEqual([]);
  });

  it("requires exactly the creation budget", () => {
    expect(() => newCharacter(creation({ heart: 2 }))).toThrow(/exactly 3 creation points/);
    expect(() => newCharacter(creation({ heart: 4 }))).toThrow(/exactly 3 creation points/);
  });

  it("rejects negative assignments from a hand-rolled payload", () => {
    expect(() => newCharacter(creation({ might: -2, heart: 5 }))).toThrow(
      /negative points to might/,
    );
  });

  it("rejects fractional points", () => {
    expect(() => newCharacter(creation({ heart: 2.5, quick: 0.5 }))).toThrow(/whole number/);
  });

  it("rejects an empty name", () => {
    expect(() => newCharacter({ ...creation(), name: "   " })).toThrow(/name is required/);
  });
});

describe("resolveCharacter — the one place the rules are applied", () => {
  it("folds in the species passive", () => {
    const unicorn = resolveCharacter(makeCharacter(), rules, items);
    expect(unicorn.stats.heart).toBe(5); // 4 stored + 1 Heart from unicorn
    expect(unicorn.worldAbility).toBe("mend");

    const bigfoot = resolveCharacter(
      makeCharacter({ species: "bigfoot", class: "thornguard" }),
      rules,
      items,
    );
    // Bigfoot's passive is max HP, not a stat (spec §4.2).
    expect(bigfoot.maxHp).toBe(12);
    expect(bigfoot.stats.heart).toBe(4);
  });

  it("folds in trinket passives, so nothing downstream knows where a bonus came from", () => {
    const resolved = resolveCharacter(
      makeCharacter({
        inventory: [
          { itemId: "river_charm", kind: "trinket" },
          { itemId: "emberglass_shard", kind: "trinket" },
          { itemId: "oak_token", kind: "trinket" },
        ],
      }),
      rules,
      items,
    );
    expect(resolved.steps).toBe(5); // songkeeper 4 + river charm
    expect(resolved.stats.might).toBe(2); // 1 + emberglass
    expect(resolved.maxHp).toBe(12); // 10 + oak token
  });

  it("ignores an item that has fallen out of the catalog rather than crashing the table", () => {
    const resolved = resolveCharacter(
      makeCharacter({ inventory: [{ itemId: "ghost_item", kind: "trinket" }] }),
      rules,
      items,
    );
    expect(resolved.maxHp).toBe(10);
  });

  it("derives the tier from the level instead of trusting the stored one", () => {
    const character = makeCharacter({ level: 7 });
    character.committed.tier = "fledgling"; // a hand-edited lie
    expect(resolveCharacter(character, rules, items).tier).toBe("radiant");
  });

  it("unlocks the class signature, level unlocks, and the species combat action", () => {
    const atFive = resolveCharacter(makeCharacter({ level: 5 }), rules, items);
    expect(atFive.actions).toContain("rally"); // signature, from level 1
    expect(atFive.actions).toContain("soothe"); // unlocked at 3
    expect(atFive.actions).not.toContain("chorus"); // not until 6
    expect(atFive.actions).toContain("mend_pulse"); // species combat action

    const atSix = resolveCharacter(makeCharacter({ level: 6 }), rules, items);
    expect(atSix.actions).toContain("chorus");
  });

  it("has no duplicate actions", () => {
    const resolved = resolveCharacter(makeCharacter({ level: 6 }), rules, items);
    expect(new Set(resolved.actions).size).toBe(resolved.actions.length);
  });

  it("attacks with its class stat and guards with Quick", () => {
    const resolved = resolveCharacter(makeCharacter(), rules, items);
    expect(resolved.attackStat).toBe("heart");
    expect(resolved.guard).toBe(rules.baseGuard + resolved.stats.quick);
  });

  it("reads provisional over committed and says so", () => {
    const started = startCampaign(makeCharacter({ level: 1 }), "r_88c");
    const bumped = awardXp(started, rules, 1200).character;
    const resolved = resolveCharacter(bumped, rules, items);
    expect(resolved.isProvisional).toBe(true);
    expect(resolved.level).toBe(4);
    expect(bumped.committed.level).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The commitment rule — spec §8.2 / architecture §3.1
// ---------------------------------------------------------------------------

/** A character mid-campaign: level 6 provisional over level 4 committed. */
function midCampaign(): Character {
  const base = makeCharacter({ level: 4, xp: 1200, inventory: [{ itemId: "river_charm", kind: "trinket" }] });
  base.committed.tier = "sworn";
  base.committed.unlockedActions = ["rally", "soothe"];
  const started = startCampaign(base, "r_88c");
  const provisional = started.provisional!;
  provisional.level = 6;
  provisional.xp = 2100;
  provisional.stats = { ...provisional.stats, heart: 8 };
  provisional.unlockedActions = ["rally", "soothe", "chorus"];
  provisional.inventory = [
    { itemId: "river_charm", kind: "trinket" },
    { itemId: "emberglass_shard", kind: "trinket" },
  ];
  started.questItems = ["rusted_key", "torn_map_east"];
  return started;
}

describe("the commitment rule", () => {
  it("effective progress is provisional ?? committed", () => {
    const plain = makeCharacter({ level: 4 });
    expect(effectiveProgress(plain)).toBe(plain.committed);
    expect(effectiveProgress(midCampaign()).level).toBe(6);
  });

  it("startCampaign seeds provisional from committed without touching committed", () => {
    const character = startCampaign(makeCharacter({ level: 4, xp: 1200 }), "r_88c");
    expect(character.provisional).toMatchObject({ runId: "r_88c", level: 4, xp: 1200 });
    expect(character.committed.level).toBe(4);
    // A deep copy, not an alias: writing to one must not write to the other.
    character.provisional!.stats.heart = 99;
    expect(character.committed.stats.heart).not.toBe(99);
  });

  it("startCampaign is idempotent for the same run, so a reconnect loses nothing", () => {
    const started = midCampaign();
    const again = startCampaign(started, "r_88c");
    expect(again.provisional?.level).toBe(6);
    expect(again).toBe(started);
  });

  it("startCampaign re-seeds for a *different* run", () => {
    const next = startCampaign(midCampaign(), "r_99z");
    expect(next.provisional?.runId).toBe("r_99z");
    expect(next.provisional?.level).toBe(4); // back to the committed snapshot
  });

  it("SUCCESS: provisional is committed, provisional and quest items are cleared", () => {
    const done = commitCampaign(midCampaign());
    expect(done.committed.level).toBe(6);
    expect(done.committed.xp).toBe(2100);
    expect(done.committed.stats.heart).toBe(8);
    expect(done.committed.unlockedActions).toEqual(["rally", "soothe", "chorus"]);
    // Inventory rides along with levels for free — same object (§9.5).
    expect(done.committed.inventory.map((e) => e.itemId)).toEqual([
      "river_charm",
      "emberglass_shard",
    ]);
    expect(done.provisional).toBeNull();
    expect(done.questItems).toEqual([]);
    expect(done.souvenirs).toEqual([]);
    // runId does not leak into the committed snapshot.
    expect("runId" in done.committed).toBe(false);
  });

  it("FAILURE: reverts to committed, keeps a souvenir, clears quest items", () => {
    const failed = failCampaign(midCampaign(), "cracked_pendant", "2026-07-14");
    expect(failed.committed.level).toBe(4);
    expect(failed.committed.xp).toBe(1200);
    expect(failed.committed.inventory.map((e) => e.itemId)).toEqual(["river_charm"]);
    expect(failed.provisional).toBeNull();
    expect(failed.questItems).toEqual([]);
    expect(failed.souvenirs).toEqual([
      { id: "cracked_pendant", fromRun: "r_88c", earnedAt: "2026-07-14" },
    ]);
  });

  it("FAILURE keeps every earlier souvenir — they are permanent", () => {
    const once = failCampaign(midCampaign(), "cracked_pendant", "2026-07-14");
    const twice = failCampaign(startCampaign(once, "r_90a"), "singed_feather", "2026-08-01");
    expect(twice.souvenirs.map((s) => s.id)).toEqual(["cracked_pendant", "singed_feather"]);
  });

  it("clears quest items on both outcomes — they are campaign-scoped either way", () => {
    expect(commitCampaign(midCampaign()).questItems).toEqual([]);
    expect(failCampaign(midCampaign(), "scrap_of_map", "2026-08-01").questItems).toEqual([]);
  });

  it("never mutates the character it was handed", () => {
    const before = midCampaign();
    const snapshot = JSON.parse(JSON.stringify(before)) as Character;
    commitCampaign(before);
    failCampaign(before, "cracked_pendant", "2026-07-14");
    startCampaign(before, "r_zzz");
    expect(before).toEqual(snapshot);
  });

  it("commitCampaign with nothing in flight still clears quest items", () => {
    const character = makeCharacter();
    character.questItems = ["rusted_key"];
    const done = commitCampaign(character);
    expect(done.questItems).toEqual([]);
    expect(done.committed.level).toBe(1);
  });
});

describe("awardXp (spec §8.1)", () => {
  it("writes to provisional while a campaign is in flight", () => {
    const { character, leveledTo } = awardXp(startCampaign(makeCharacter(), "r_1"), rules, 300);
    expect(leveledTo).toBe(2);
    expect(character.provisional?.xp).toBe(300);
    expect(character.provisional?.level).toBe(2);
    expect(character.committed.level).toBe(1);
    expect(character.committed.xp).toBe(0);
  });

  it("reports a tier crossing so the transformation cutscene can fire", () => {
    const start = startCampaign(makeCharacter(), "r_1");
    const toThree = awardXp(start, rules, 700);
    expect(toThree.leveledTo).toBe(3);
    expect(toThree.newTier).toBeUndefined();

    const toFour = awardXp(toThree.character, rules, 500);
    expect(toFour.leveledTo).toBe(4);
    expect(toFour.newTier).toBe("sworn");
  });

  it("reports nothing when the award doesn't cross a level", () => {
    const result = awardXp(startCampaign(makeCharacter(), "r_1"), rules, 100);
    expect(result.leveledTo).toBeUndefined();
    expect(result.newTier).toBeUndefined();
    expect(result.character.provisional?.xp).toBe(100);
  });

  it("appends the class actions the new level unlocks", () => {
    const result = awardXp(startCampaign(makeCharacter(), "r_1"), rules, 700);
    expect(result.character.provisional?.unlockedActions).toContain("soothe");
  });

  it("is reverted wholesale by a failed campaign", () => {
    const started = startCampaign(makeCharacter({ level: 1 }), "r_1");
    const gained = awardXp(awardXp(started, rules, 900).character, rules, 900).character;
    expect(effectiveProgress(gained).level).toBe(5);
    expect(effectiveProgress(gained).xp).toBe(1800);
    const failed = failCampaign(gained, "singed_feather", "2026-08-01");
    expect(failed.committed.level).toBe(1);
    expect(failed.committed.xp).toBe(0);
  });

  it("writes to committed when there is no campaign in flight", () => {
    const result = awardXp(makeCharacter(), rules, 300);
    expect(result.character.committed.xp).toBe(300);
    expect(result.character.provisional).toBeNull();
  });
});
