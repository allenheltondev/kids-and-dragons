/**
 * The encounter balance model.
 *
 * The thing under test is a *judgement aid*, so most of these are about whether
 * it tells the truth about its own assumptions rather than whether it produces
 * a particular number. The exception is the last block, which points the model
 * at the shipped bands — because `content/rules.json`'s `encounterBands.$comment`
 * makes a balance claim in prose, and nothing has ever checked it.
 *
 * Note which rules each block uses. `makeRules()` is deliberately *not* the
 * shipped curve — it has `baseGuard: 8` where content ships 11 — so a claim
 * about the shipped game has to be measured against the shipped file, and a
 * claim about the model reading its inputs has to be measured against a fixture
 * that differs.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ASSUMED_PARTY_SIZE,
  TARGET_ROUNDS,
  defaultParty,
  estimateEncounter,
  hitChance,
} from "./balance.js";
import type { EnemySpec } from "./types/chapter.js";
import type { RulesContent } from "./types/domain.js";
import { makeRules } from "./test-fixtures.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/** The band table, which `RulesContent` types loosely because content owns it. */
interface Band {
  stats: { hp: number; guard: number; quick: number; steps: number; attack: number } | null;
  usualCount: number;
}

const SHIPPED = JSON.parse(
  fs.readFileSync(path.join(ROOT, "content", "rules.json"), "utf8"),
) as RulesContent & { encounterBands: Record<string, Band | string> };

/** The bands, minus `$comment` — the file documents itself in band position. */
const BANDS: [string, Band][] = Object.entries(SHIPPED.encounterBands).filter(
  (entry): entry is [string, Band] => typeof entry[1] === "object" && entry[1] !== null,
);

const PARTY = defaultParty(SHIPPED);

function enemy(overrides: Partial<EnemySpec> = {}): EnemySpec {
  return {
    id: "wisp",
    name: "Bramblewisp",
    count: 3,
    hp: 6,
    guard: 11,
    quick: 3,
    steps: 5,
    attack: 3,
    ...overrides,
  };
}

describe("hit chance", () => {
  it("counts the faces that clear the number", () => {
    // d20+3 vs Guard 11 needs an 8: thirteen faces out of twenty.
    expect(hitChance(3, 11)).toBeCloseTo(0.65, 5);
    expect(hitChance(3, 14)).toBeCloseTo(0.5, 5);
  });

  it("has no crit and no automatic miss, because `resolveAttack` has neither", () => {
    /*
     * dice.ts resolves an attack as a plain `total >= tn`. A natural 20 is only
     * special when it clears the number anyway, and a natural 1 lands when the
     * modifier is big enough — so the odds run flat to both ends rather than
     * being pinned at 5% and 95% the way a d20 game usually pins them.
     */
    expect(hitChance(20, 11)).toBe(1);
    expect(hitChance(0, 25)).toBe(0);
  });

  it("never reports more than certainty or less than never", () => {
    expect(hitChance(100, 11)).toBe(1);
    expect(hitChance(-100, 11)).toBe(0);
  });
});

describe("the assumed party", () => {
  it("is three, because §7.1 seats three", () => {
    expect(defaultParty(SHIPPED).size).toBe(ASSUMED_PARTY_SIZE);
    expect(ASSUMED_PARTY_SIZE).toBe(3);
  });

  it("reads its numbers out of the rules rather than repeating them", () => {
    /*
     * The whole point of the module: retuning `baseGuard` retunes the checker.
     * Measured against the fixture precisely *because* it disagrees with the
     * shipped file — a `defaultParty` that had the shipped numbers baked in
     * would pass every other test in here and fail this one.
     */
    const fixture = makeRules({ baseMaxHp: 20, baseGuard: 15 });
    const party = defaultParty(fixture);
    expect(party.hp).toBe(20);
    expect(party.guard).toBe(15 + fixture.baseStats.quick);
    expect(party.guard).not.toBe(PARTY.guard);
  });

  it("leaves Quick at its base, which is the cautious assumption", () => {
    /*
     * A level-1 character spreads `creationPoints` over four stats, and one who
     * spent them on the stat they swing with has Quick where it started. Guard
     * is `baseGuard + quick`, so this is the *low* end — it overstates what the
     * party takes rather than understating it, which is the right direction for
     * a checker whose only job is to warn.
     */
    expect(PARTY.guard).toBe(SHIPPED.baseGuard + SHIPPED.baseStats.quick);
  });
});

describe("estimating a fight", () => {
  it("puts the reference chapter's own fight on target", () => {
    // Three Bramblewisps, which is what bramblewood-01 has shipped since before
    // any of this existed — and spec §7.1 asks for four rounds.
    const estimate = estimateEncounter([enemy()], PARTY);
    expect(estimate.rounds).toBe(4);
    expect(estimate.rounds).toBeGreaterThanOrEqual(TARGET_ROUNDS.min);
    expect(estimate.rounds).toBeLessThanOrEqual(TARGET_ROUNDS.max);
    expect(estimate.verdict).toBe("on_target");
    expect(estimate.enemyCount).toBe(3);
    expect(estimate.enemyHp).toBe(18);
    expect(estimate.partyHp).toBe(30);
  });

  it("counts bodies, not hit points, because bodies are what swing back", () => {
    /*
     * The reason `count` is expanded into individuals rather than summed. Three
     * 6 HP creatures and one 18 HP creature take the party the same number of
     * rounds to put down — but three of them are landing three attacks a round
     * while they last, and the single one never lands more than one. Same enemy
     * hit points, twice the damage; a checker that summed HP would call them
     * the same fight.
     */
    const three = estimateEncounter([enemy({ count: 3, hp: 6 })], PARTY);
    const one = estimateEncounter([enemy({ count: 1, hp: 18 })], PARTY);
    expect(three.enemyHp).toBe(one.enemyHp);
    expect(three.rounds).toBe(one.rounds);
    expect(three.damageTaken).toBeGreaterThan(one.damageTaken * 2);
  });

  it("calls a fight the party walks through short", () => {
    const estimate = estimateEncounter([enemy({ count: 1, hp: 2 })], PARTY);
    expect(estimate.rounds).toBeLessThan(TARGET_ROUNDS.min);
    expect(estimate.verdict).toBe("short");
    expect(estimate.heroesDown).toBe(0);
  });

  it("calls a fight that outstays the evening long", () => {
    // Winnable, and nobody is ever really in danger — it just goes on for
    // thirteen rounds, which is the other way a fight can be wrong.
    const estimate = estimateEncounter([enemy({ count: 1, hp: 40, guard: 14, attack: 2 })], PARTY);
    expect(estimate.rounds).toBeGreaterThan(TARGET_ROUNDS.max);
    expect(estimate.verdict).toBe("long");
    expect(estimate.partyWiped).toBe(false);
  });

  it("says nothing happens when there is nothing to fight", () => {
    const estimate = estimateEncounter([], PARTY);
    expect(estimate.rounds).toBe(0);
    expect(estimate.enemyCount).toBe(0);
    expect(estimate.notes).toEqual(["No enemies — nothing to estimate."]);
  });

  it("averages a mixed fight and says that it did", () => {
    const mixed = estimateEncounter(
      [
        enemy({ count: 1, guard: 11, attack: 3 }),
        enemy({ id: "brute", count: 1, guard: 13, attack: 5 }),
      ],
      PARTY,
    );
    expect(mixed.notes.join(" ")).toMatch(
      /Mixed enemies, averaged into one: Guard 12\.0, attack \+4\.0/,
    );
  });

  it("keeps the simplifications where an author will read them", () => {
    // An estimate whose assumptions are invisible is worse than no estimate,
    // because it gets quoted.
    const notes = estimateEncounter([enemy()], PARTY).notes.join(" ");
    expect(notes).toMatch(/Positioning is ignored/);
    expect(notes).toMatch(/no abilities, no items/);
    expect(notes).toMatch(/A party of 3 at 10 HP and Guard 12/);
  });
});

describe("who gets hurt", () => {
  it("counts heroes rather than pooling their hit points", () => {
    /*
     * The reason the sim tracks three heroes separately. This fight lands 11.5
     * damage on a party holding 30 — pooled, that is under four each and nobody
     * comes close to the floor. But `enemy-ai.ts` walks at the *nearest*
     * standing hero and never spreads, so all of it goes to one person, and one
     * person goes down. Pooling would have called this a safe fight.
     */
    const focused = estimateEncounter([enemy({ count: 1, hp: 24, attack: 8 })], PARTY);
    expect(focused.damageTaken).toBeLessThan(focused.partyHp / 2);
    expect(focused.heroesDown).toBe(1);
  });

  it("leaves nobody down in a fight that cannot reach anybody's hit points", () => {
    const gentle = estimateEncounter([enemy({ count: 1, hp: 4, attack: -20 })], PARTY);
    expect(gentle.heroesDown).toBe(0);
    expect(gentle.knockdowns).toBe(0);
    expect(gentle.damageTaken).toBe(0);
  });

  it("separates one hero going down four times from four heroes going down", () => {
    /*
     * Help Up gives back 1 HP (§7.3) and the AI keeps walking at the nearest
     * standing hero — who, the instant after a revive, is the one who was
     * already on the floor and is standing right next to it. So a `heroesDown`
     * of 1 beside a much larger `knockdowns` is a spiral rather than a beat:
     * one hero fighting, one on the floor, one spending every action picking
     * them up. The distinct-hero count alone would call that the §7.3 moment
     * the design wants.
     */
    const grinding = estimateEncounter([enemy({ count: 1, hp: 28, attack: 8 })], PARTY);
    expect(grinding.heroesDown).toBe(1);
    expect(grinding.knockdowns).toBeGreaterThan(3);
  });

  it("says so when the party goes over", () => {
    const hopeless = estimateEncounter([enemy({ count: 4, hp: 20, guard: 14, attack: 5 })], PARTY);
    expect(hopeless.partyWiped).toBe(true);
    expect(hopeless.heroesDown).toBe(ASSUMED_PARTY_SIZE);
    expect(hopeless.notes.join(" ")).toMatch(/nobody left to help them up/);
  });

  it("never calls a fight the party lost on target, however fast they lost it", () => {
    // Four rounds is the number §7.1 asks for, and this fight reaches it by
    // knocking everybody down. "On target" would be the worst sentence the
    // checker could print.
    const wipe = estimateEncounter([enemy({ count: 4, hp: 20, guard: 14, attack: 5 })], PARTY);
    expect(wipe.rounds).toBeLessThanOrEqual(TARGET_ROUNDS.max);
    expect(wipe.verdict).toBe("long");
  });

  it("reports a Guard the party cannot reach instead of looping forever", () => {
    // d20+3 tops out at 23, so Guard 30 is not a hard fight — it is a mistake,
    // and an author is better served by the sentence than by a round count.
    const impossible = estimateEncounter([enemy({ guard: 30 })], PARTY);
    expect(impossible.partyWiped).toBe(true);
    expect(impossible.notes.join(" ")).toMatch(/cannot hit this at all/);
    expect(Number.isFinite(impossible.rounds)).toBe(true);
  });

  it("terminates on a fight that never ends", () => {
    // The party can hit, barely, against far more hit points than an evening
    // holds. The cap is what makes this a report rather than a hang.
    const forever = estimateEncounter([enemy({ count: 4, hp: 500, attack: -20 })], PARTY);
    expect(forever.notes.join(" ")).toMatch(/Stopped at 50 rounds/);
    expect(forever.verdict).toBe("long");
  });
});

/*
 * -----------------------------------------------------------------------------
 * The shipped bands, measured.
 *
 * `encounterBands.$comment` derives every stat block from §7.1's four-round
 * target: "a level-1 hero swings d20+2..4 against Guard 11 for 3 damage, so
 * about 2 a round each and 6 for a party of three. Spec 7.1 tunes for four
 * rounds, so stats.hp x usualCount wants to land in 18-30."
 *
 * Every band satisfies that heuristic — 18, 18, 28 and 20 hit points — and one
 * of them still runs long, which is the finding. The note fixes the party's
 * damage at 6 a round using the *skirmisher's* Guard of 11, and then the bands
 * raise Guard alongside hit points. So the two move together: the brute has 56%
 * more hit points than the skirmisher band and the party hits it less often,
 * and the knock-on is the §7.3 revive spiral, which costs two actions a round
 * once it starts.
 *
 * These tests assert the measurements rather than a target, because the model
 * is not the authority on what a good fight is — Allen is. What it can do is
 * make the number visible, and fail loudly when the *number* changes.
 */
describe("the shipped encounter bands", () => {
  it("checks every band the file defines", () => {
    // Guards against the block below quietly measuring nothing if the table is
    // renamed or restructured.
    expect(BANDS.map(([name]) => name)).toEqual([
      "skirmisher",
      "lurker",
      "brute",
      "sentinel",
      "legend",
    ]);
  });

  it("leaves `legend` alone, because a designed encounter authors its own", () => {
    const legend = BANDS.find(([name]) => name === "legend")?.[1];
    expect(legend?.stats).toBeNull();
    expect(legend?.usualCount).toBe(1);
  });

  const fought = BANDS.filter(([, band]) => band.stats !== null).map(([name, band]) => {
    const stats = band.stats as NonNullable<Band["stats"]>;
    return {
      name,
      estimate: estimateEncounter([{ id: name, count: band.usualCount, ...stats }], PARTY),
    };
  });

  it("puts three of the four inside §7.1's target", () => {
    const verdicts = Object.fromEntries(fought.map((f) => [f.name, f.estimate.verdict]));
    expect(verdicts).toEqual({
      skirmisher: "on_target",
      lurker: "on_target",
      brute: "long",
      sentinel: "on_target",
    });
  });

  it("finds the brute band running about twice as long as the note assumes", () => {
    /*
     * Not a bug in the band and not a bug in the note — a gap between them, and
     * the reason a checker beats arithmetic in a comment. Two brutes are 28 hit
     * points behind Guard 12, and 28/6 is the note's own four-and-a-bit rounds.
     * It gets to ten because Guard 12 drops the party to 5.4 a round, and
     * because +4 against Guard 12 knocks a hero over often enough that the
     * revive spiral starts and the party spends most of the fight at one
     * attacker.
     */
    const brute = fought.find((f) => f.name === "brute")?.estimate;
    expect(brute?.rounds).toBe(10);
    expect(brute?.heroesDown).toBe(1);
    expect(brute?.knockdowns).toBeGreaterThan(5);
    // Still winnable — it is a slog, not a defeat.
    expect(brute?.partyWiped).toBe(false);
  });

  it("never wipes the party on an ordinary band at its usual count", () => {
    // The one thing that would be an outright content bug rather than a
    // judgement call: spec's first promise is that nobody dies.
    for (const { name, estimate } of fought) {
      expect(estimate.partyWiped, `${name} wipes the party`).toBe(false);
    }
  });
});
