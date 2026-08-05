import { describe, expect, it } from "vitest";

import {
  awardXp,
  CharacterRuleError,
  commitCampaign,
  effectiveProgress,
  failCampaign,
  newCharacter,
  resolveCharacter,
  spendStatPoint,
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

  it("starts at level 1 with nothing banked when no starting level is asked for", () => {
    expect(newCharacter(creation()).committed.unspentPoints).toBe(0);
  });
});

describe("joining a party already underway (spec §8.4)", () => {
  it("starts a tier-floor join at that level's XP threshold, not zero", () => {
    const joined = newCharacter({ ...creation(), startingLevel: 7 }).committed;
    expect(joined.level).toBe(7);
    // The fixture curve's total for level 7. Zero here is the bug this whole
    // test exists for — see the next test.
    expect(joined.xp).toBe(3300);
    expect(joined.tier).toBe("radiant");
  });

  it("does not collapse back to level 1 on the next chapter award", () => {
    // The subtle failure: level is derived from XP, so a level-7 character
    // carrying 0 XP is *re-derived* as level 1 the moment any XP lands.
    const joined = newCharacter({ ...creation(), startingLevel: 7 });
    const after = awardXp(startCampaign(joined, "r_1"), rules, 300);
    expect(effectiveProgress(after.character).level).toBe(7);
    expect(after.leveledTo).toBeUndefined();
  });

  it("owns every class action its level already unlocked", () => {
    const joined = newCharacter({ ...creation(), startingLevel: 7 }).committed;
    // songkeeper unlocks at 3 and 6; a level-7 join skipped both level-ups and
    // must still arrive holding them.
    expect(joined.unlockedActions).toEqual(["rally", "soothe", "chorus"]);
  });

  it("banks one point per skipped level, so a level-7 join has six to spend", () => {
    expect(newCharacter({ ...creation(), startingLevel: 7 }).committed.unspentPoints).toBe(6);
    expect(newCharacter({ ...creation(), startingLevel: 4 }).committed.unspentPoints).toBe(3);
    expect(newCharacter({ ...creation(), startingLevel: 10 }).committed.unspentPoints).toBe(9);
  });

  it("is arithmetically identical to a character that earned the level", () => {
    // The claim spec §8.4 makes, asserted whole: no shortcut and no handicap.
    // Any extra XP, point, or action given to a joiner shows up right here.
    const joined = newCharacter({ ...creation(), startingLevel: 4 });
    const earned = awardXp(newCharacter(creation()), rules, 1200).character;
    expect(joined.committed).toEqual(earned.committed);
  });

  it("rejects a level between the tier floors", () => {
    // A phone can send any number; 5 would mean a stat point and an action
    // nobody at the table agreed to.
    expect(() => newCharacter({ ...creation(), startingLevel: 5 })).toThrow(/tier floor/);
    expect(() => newCharacter({ ...creation(), startingLevel: 0 })).toThrow(/tier floor/);
    expect(() => newCharacter({ ...creation(), startingLevel: 11 })).toThrow(/tier floor/);
    expect(() => newCharacter({ ...creation(), startingLevel: 4.5 })).toThrow(/tier floor/);
  });

  it("reads the legal floors out of content instead of hardcoding 1/4/7/10", () => {
    // Retuning the tiers is a content change; it must not need a code deploy.
    const retuned = makeRules({ tierLevels: { fledgling: 1, sworn: 3, radiant: 6, mythic: 9 } });
    const atSix = newCharacter({ ...creation(), rules: retuned, startingLevel: 6 });
    expect(atSix.committed.level).toBe(6);
    expect(() => newCharacter({ ...creation(), rules: retuned, startingLevel: 4 })).toThrow(
      /tier floor/,
    );
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

  it("derives the level and tier from XP instead of trusting stored fields", () => {
    const character = makeCharacter({ level: 1, xp: 3300 });
    character.committed.tier = "fledgling"; // hand-edited lies
    const resolved = resolveCharacter(character, rules, items);

    expect(resolved.level).toBe(7);
    expect(resolved.tier).toBe("radiant");
  });

  it("unlocks the class signature, level unlocks, and the species combat action", () => {
    const atFive = resolveCharacter(makeCharacter({ level: 1, xp: 1800 }), rules, items);
    expect(atFive.actions).toContain("rally"); // signature, from level 1
    expect(atFive.actions).toContain("soothe"); // unlocked at 3
    expect(atFive.actions).not.toContain("chorus"); // not until 6
    expect(atFive.actions).toContain("mend_pulse"); // species combat action

    const atSix = resolveCharacter(makeCharacter({ level: 1, xp: 2500 }), rules, items);
    expect(atSix.actions).toContain("chorus");
  });

  it("has no duplicate actions and skips stored action IDs absent from current content", () => {
    const character = makeCharacter({ level: 1, xp: 2500 });
    character.committed.unlockedActions = ["rally", "chorus", "retired_action"];
    const resolved = resolveCharacter(character, rules, items);

    expect(new Set(resolved.actions).size).toBe(resolved.actions.length);
    expect(resolved.actions).not.toContain("retired_action");
  });

  it("attacks with its class stat and guards with Quick", () => {
    const resolved = resolveCharacter(makeCharacter(), rules, items);
    expect(resolved.attackStat).toBe("heart");
    expect(resolved.guard).toBe(rules.baseGuard + resolved.stats.quick);
  });

  it("surfaces the waiting stat point, so the badge needs no second source", () => {
    // spec §8.1 — a point is spent at a Rest scene, and the badge that reminds
    // an eight-year-old it is waiting has to come off the resolved view. If it
    // is missing here the client has to reach past resolveCharacter() into the
    // stored halves and re-derive `provisional ?? committed` itself.
    const banked = awardXp(makeCharacter(), rules, 300).character;
    expect(resolveCharacter(banked, rules, items).unspentPoints).toBe(1);
    expect(resolveCharacter(makeCharacter(), rules, items).unspentPoints).toBe(0);
  });

  it("reads the waiting point from the in-flight campaign, not the committed half", () => {
    const banked = awardXp(startCampaign(makeCharacter(), "r_1"), rules, 1200).character;
    expect(resolveCharacter(banked, rules, items).unspentPoints).toBe(3);
    expect(banked.committed.unspentPoints ?? 0).toBe(0);
  });

  it("resolves a character stored before points existed to 0, never undefined", () => {
    // The resolved view promises a number even though the stored one cannot.
    const legacy = makeCharacter();
    delete (legacy.committed as { unspentPoints?: number }).unspentPoints;
    expect(resolveCharacter(legacy, rules, items).unspentPoints).toBe(0);
  });

  it("reads provisional over committed and derives both effective and committed levels from XP", () => {
    const started = startCampaign(makeCharacter({ level: 10, xp: 700 }), "r_88c");
    const provisional = started.provisional!;
    provisional.level = 1;
    provisional.xp = 2500;

    const resolved = resolveCharacter(started, rules, items);
    expect(resolved.isProvisional).toBe(true);
    expect(resolved.level).toBe(6);
    expect(resolved.committedLevel).toBe(3);
  });

  it("gracefully skips missing species and class definitions", () => {
    const incompleteRules = makeRules();
    delete (incompleteRules.species as Partial<typeof incompleteRules.species>).unicorn;
    delete (incompleteRules.classes as Partial<typeof incompleteRules.classes>).songkeeper;
    const character = makeCharacter({ inventory: [{ itemId: "ghost_item", kind: "trinket" }] });
    character.committed.unlockedActions = ["retired_action"];

    const resolved = resolveCharacter(character, incompleteRules, items);

    expect(resolved.stats).toEqual(character.committed.stats);
    expect(resolved.maxHp).toBe(incompleteRules.baseMaxHp);
    expect(resolved.steps).toBe(incompleteRules.baseSteps);
    expect(resolved.actions).toEqual([]);
    expect(resolved.worldAbility).toBe("");
    expect(resolved.attackStat).toBe("might");
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

  it("failCampaign with nothing in flight still preserves committed, clears quest items, and appends a souvenir", () => {
    const character = makeCharacter({ level: 4, xp: 1200 });
    character.questItems = ["rusted_key"];
    const committedBytes = JSON.stringify(character.committed);

    const failed = failCampaign(character, "scrap_of_map", "2026-08-01T12:34:56.000Z");

    expect(failed.provisional).toBeNull();
    expect(JSON.stringify(failed.committed)).toBe(committedBytes);
    expect(failed.questItems).toEqual([]);
    expect(failed.souvenirs).toHaveLength(1);
    expect(failed.souvenirs[0]).toMatchObject({
      id: "scrap_of_map",
      earnedAt: "2026-08-01T12:34:56.000Z",
    });
  });
});

describe("awardXp (spec §8.1)", () => {
  it.each([0, -1, -500])("is a no-op for a non-positive award of %i XP", (amount) => {
    const character = startCampaign(makeCharacter(), "r_1");
    const snapshot = JSON.parse(JSON.stringify(character)) as Character;

    const result = awardXp(character, rules, amount);

    expect(result).toEqual({ character: snapshot });
    expect(result.character).toBe(character);
  });

  it("clamps cumulative XP to zero before deriving the level", () => {
    const character = makeCharacter();
    character.committed.xp = -500;
    character.committed.level = 10;
    character.committed.tier = "mythic";

    const result = awardXp(character, rules, 300);

    expect(result.character.committed.xp).toBe(0);
    expect(result.character.committed.level).toBe(1);
    expect(result.character.committed.tier).toBe("fledgling");
    expect(result.character.committed.unspentPoints).toBe(0);
    expect(result.leveledTo).toBeUndefined();
    expect(result.newTier).toBeUndefined();
  });

  it("derives the level delta and tier signal from XP rather than stored fields", () => {
    const character = makeCharacter();
    character.committed.xp = 700;
    character.committed.level = 1;
    character.committed.tier = "mythic";
    character.committed.unspentPoints = 2;

    const result = awardXp(character, rules, 500);

    expect(result.character.committed.level).toBe(4);
    expect(result.character.committed.unspentPoints).toBe(3);
    expect(result.leveledTo).toBe(4);
    expect(result.newTier).toBe("sworn");
  });

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

  it("unlocks every class action crossed by a multi-level award", () => {
    const result = awardXp(startCampaign(makeCharacter(), "r_1"), rules, 2500);

    expect(result.leveledTo).toBe(6);
    expect(result.character.provisional?.unlockedActions).toEqual(
      expect.arrayContaining(["soothe", "chorus"]),
    );
  });

  it("still awards XP when the stored class was removed from current content", () => {
    const staleRules = {
      ...rules,
      classes: { ...rules.classes, songkeeper: undefined },
    } as unknown as typeof rules;

    const result = awardXp(startCampaign(makeCharacter(), "r_1"), staleRules, 300);

    expect(result.character.provisional).toMatchObject({ xp: 300, level: 2 });
    expect(result.character.provisional?.unlockedActions).toEqual(["rally"]);
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

  it("banks a stat point for every level gained, not one per award", () => {
    // A generous chapter can cross several levels at once; each one owes a
    // point. Banking one per *call* would quietly rob a character of two.
    const start = startCampaign(makeCharacter(), "r_1");
    const threeLevels = awardXp(start, rules, 1200);
    expect(threeLevels.leveledTo).toBe(4);
    expect(threeLevels.character.provisional?.unspentPoints).toBe(3);
  });

  it("banks nothing for an award that does not reach the next level", () => {
    // Half XP from a setback (§8.2) routinely lands short of a level.
    const result = awardXp(startCampaign(makeCharacter(), "r_1"), rules, 100);
    expect(result.character.provisional?.unspentPoints).toBe(0);
  });

  it("banks onto whatever a joined character already had", () => {
    const joined = startCampaign(newCharacter({ ...creation(), startingLevel: 4 }), "r_1");
    const result = awardXp(joined, rules, 600); // 1200 → 1800, level 4 → 5
    expect(effectiveProgress(result.character).level).toBe(5);
    expect(effectiveProgress(result.character).unspentPoints).toBe(4);
  });
});

describe("spendStatPoint (spec §8.1)", () => {
  /** A character with one banked point and no campaign in flight. */
  function withAPoint(): Character {
    return awardXp(makeCharacter(), rules, 300).character;
  }

  it("moves a banked point onto the chosen stat", () => {
    const spent = spendStatPoint(withAPoint(), rules, "might");
    expect(spent.committed.stats.might).toBe(2); // 1 stored + the point
    expect(spent.committed.unspentPoints).toBe(0);
    // Only the chosen stat moves.
    expect(spent.committed.stats.heart).toBe(4);
  });

  it("refuses to spend a point that was never earned", () => {
    // Loudly, not silently: a no-op looks exactly like a successful tap on a
    // phone, and the player would spend the evening believing they got it.
    expect(() => spendStatPoint(makeCharacter(), rules, "might")).toThrow(/no unspent stat points/);
  });

  it("spends each point only once", () => {
    const once = spendStatPoint(withAPoint(), rules, "quick");
    expect(() => spendStatPoint(once, rules, "quick")).toThrow(/no unspent stat points/);
  });

  it("rejects a stat id the rules do not know with CharacterRuleError", () => {
    expect(() => spendStatPoint(withAPoint(), rules, "luck" as never)).toThrow(
      CharacterRuleError,
    );
    expect(() => spendStatPoint(withAPoint(), rules, "luck" as never)).toThrow(/unknown stat/);
  });

  it("rejects spending beyond nine bonus points in one stat", () => {
    const atCap = withAPoint();
    atCap.committed.stats.might = rules.baseStats.might + 9;

    expect(() => spendStatPoint(atCap, rules, "might")).toThrow(CharacterRuleError);
    expect(() => spendStatPoint(atCap, rules, "might")).toThrow(/9 bonus points/);
    expect(atCap.committed.unspentPoints).toBe(1);
    expect(atCap.committed.stats.might).toBe(rules.baseStats.might + 9);
  });

  it("writes to provisional while a campaign is in flight, leaving committed alone", () => {
    const banked = awardXp(startCampaign(makeCharacter(), "r_1"), rules, 300).character;
    const spent = spendStatPoint(banked, rules, "clever");
    expect(spent.provisional?.stats.clever).toBe(2);
    expect(spent.provisional?.unspentPoints).toBe(0);
    expect(spent.committed.stats.clever).toBe(1);
    expect(spent.committed.unspentPoints ?? 0).toBe(0);
  });

  it("reverts the earned point and the stat it bought together", () => {
    // The reason unspentPoints lives inside CharacterProgress. Anywhere else,
    // this character keeps the +1 Clever after the campaign that paid for it
    // failed — a permanent stat nobody earned.
    const banked = awardXp(startCampaign(makeCharacter(), "r_1"), rules, 300).character;
    const spent = spendStatPoint(banked, rules, "clever");
    const failed = failCampaign(spent, "cracked_pendant", "2026-08-01");
    expect(failed.committed.stats.clever).toBe(1);
    expect(failed.committed.unspentPoints ?? 0).toBe(0);
  });

  it("keeps the point when the campaign succeeds", () => {
    const banked = awardXp(startCampaign(makeCharacter(), "r_1"), rules, 300).character;
    const done = commitCampaign(spendStatPoint(banked, rules, "clever"));
    expect(done.committed.stats.clever).toBe(2);
    expect(done.committed.unspentPoints).toBe(0);
  });

  it("never mutates the character it was handed", () => {
    const before = withAPoint();
    const snapshot = JSON.parse(JSON.stringify(before)) as Character;
    spendStatPoint(before, rules, "might");
    expect(before).toEqual(snapshot);
  });

  it("tolerates a character stored before points existed", () => {
    // Records already in DynamoDB have no unspentPoints field; reading it as
    // NaN would corrupt the stat block on the first Rest scene.
    const legacy = makeCharacter();
    delete (legacy.committed as { unspentPoints?: number }).unspentPoints;
    expect(() => spendStatPoint(legacy, rules, "might")).toThrow(/no unspent stat points/);
    expect(awardXp(legacy, rules, 300).character.committed.unspentPoints).toBe(1);
  });
});
