/**
 * Numbing stings (#227) — a hit that leaves a hero Numbed: fewer steps for a
 * couple of their turns, then fine. Pinned here against the fight itself
 * (encounter.ts) and the arithmetic (buffs.ts): the sting, its duration in the
 * target's own turns, the refresh that never stacks, the defensive form, and
 * the promise that an enemy without one fights exactly as before.
 */

import { describe, expect, it } from "vitest";
import { NUMBED_BUFF_ID, applyNumbed, buffBonus, slowBlockProblems } from "./buffs.js";
import { beginEncounter, combatantById, currentActorId, endTurn, performAction } from "./encounter.js";
import type { AbilityCatalog, EncounterEvent, EncounterSetup, EncounterState } from "./encounter.js";
import { parseBoard } from "./grid.js";
import type { Rng } from "./dice.js";
import { resolveCharacter } from "./character.js";
import { makeCharacter, makeItems, makeRules } from "./test-fixtures.js";
import type { CombatBuff, SlowEffect } from "./types/buffs.js";
import type { EnemySpec } from "./types/chapter.js";

const RULES = makeRules();
const ITEMS = makeItems();

/** `rollD20` is `floor(next() * 20) + 1`: this always throws `n`. */
const ALWAYS = (n: number): Rng => ({ next: () => (n - 0.5) / 20 });
const HIT = ALWAYS(20);
const MISS = ALWAYS(1);

const STING: SlowEffect = { steps: 2, turns: 2 };

function skupper(overrides: Partial<EnemySpec> = {}): EnemySpec {
  return { id: "skupper", count: 1, hp: 30, guard: 12, quick: 0, steps: 4, attack: 2, ...overrides };
}

/** The hero leads (Quick 3 against 0, same die), the Skupper stands next to them. */
function setup(enemy: Partial<EnemySpec> = {}, hero: { hp?: number; steps?: number } = {}): EncounterSetup {
  const character = resolveCharacter(
    makeCharacter({ id: "c_a", name: "c_a", species: "unicorn", class: "thornguard", stats: { might: 3, quick: 3, clever: 0, heart: 0 } }),
    RULES,
    ITEMS,
  );
  return {
    board: parseBoard(Array.from({ length: 5 }, () => ".".repeat(8))),
    party: [
      {
        character: { ...character, steps: hero.steps ?? character.steps },
        at: { x: 0, y: 2 },
        ...(hero.hp === undefined ? {} : { hp: hero.hp }),
      },
    ],
    enemies: [{ spec: skupper(enemy), at: { x: 1, y: 2 } }],
  };
}

const ctx = (rng: Rng) => ({ rules: RULES, abilities: {} as AbilityCatalog, rng });

function act(state: EncounterState, rng: Rng, targetId: string): { state: EncounterState; events: readonly EncounterEvent[] } {
  const result = performAction(state, ctx(rng), { abilityId: "attack", targetId });
  if (!result.ok) throw new Error(result.reason);
  return result;
}

/** The turns pass until the Skupper's, and it swings at the hero (`rng`). */
function stung(state: EncounterState, rng: Rng) {
  let s = state;
  while (currentActorId(s) !== "skupper#1") s = endTurn(s);
  return act(s, rng, "c_a");
}

/** This turn ends and the turns pass until it is the hero's again. */
function toHero(state: EncounterState): EncounterState {
  let s = endTurn(state);
  while (currentActorId(s) !== "c_a") s = endTurn(s);
  return s;
}

const numbed = (state: EncounterState): CombatBuff[] => (state.buffs ?? []).filter((b) => b.id === NUMBED_BUFF_ID);

describe("a hit from a numbing enemy", () => {
  it("leaves the hero Numbed: the sting is in the beats and on the fight's buffs", () => {
    const start = beginEncounter(setup({ onHit: { slow: STING } }), ctx(HIT));
    const { state, events } = stung(start, HIT);
    expect(events).toContainEqual({ type: "numbed", actorId: "c_a", byId: "skupper#1", steps: 2, turns: 2 });
    expect(numbed(state)).toEqual([
      { id: "numbed", label: "Numbed", kind: "move", heroId: "c_a", amount: -2, turnsLeft: 2 },
    ]);
  });

  it("takes 2 steps off for exactly 2 of the hero's turns, then full steps", () => {
    const start = beginEncounter(setup({ onHit: { slow: STING } }), ctx(HIT));
    expect(start.stepsLeft).toBe(4);

    let state = toHero(stung(start, HIT).state); // turn 1
    expect(state.stepsLeft).toBe(2);
    state = toHero(state); // turn 2: the Skupper's turn between did not count
    expect(state.stepsLeft).toBe(2);
    expect(numbed(state)).toHaveLength(1);
    state = toHero(state); // turn 3
    expect(state.stepsLeft).toBe(4);
    expect(numbed(state)).toEqual([]);
  });

  it("floors the hero's steps at 1", () => {
    const two = beginEncounter(setup({ onHit: { slow: STING } }, { steps: 2 }), ctx(HIT));
    expect(toHero(stung(two, HIT).state).stepsLeft).toBe(1);
    const one = beginEncounter(setup({ onHit: { slow: STING } }, { steps: 1 }), ctx(HIT));
    expect(toHero(stung(one, HIT).state).stepsLeft).toBe(1);
  });

  it("a second sting refreshes the duration and never stacks", () => {
    const start = beginEncounter(setup({ onHit: { slow: STING } }), ctx(HIT));
    let state = toHero(stung(start, HIT).state); // numbed, turn 1 of 2
    state = endTurn(state); // that turn ends: 1 left, the Skupper's turn
    expect(currentActorId(state)).toBe("skupper#1");
    expect(numbed(state)[0]!.turnsLeft).toBe(1);
    state = act(state, HIT, "c_a").state; // the Skupper stings again
    expect(numbed(state)).toEqual([
      { id: "numbed", label: "Numbed", kind: "move", heroId: "c_a", amount: -2, turnsLeft: 2 },
    ]);
    // Still only 2 off, not 4.
    state = toHero(state);
    expect(state.stepsLeft).toBe(2);
    expect(buffBonus(state.buffs, "c_a", "move")).toBe(-2);
  });

  it("a miss leaves the hero alone", () => {
    const start = beginEncounter(setup({ onHit: { slow: STING } }), ctx(MISS));
    const { state, events } = stung(start, MISS);
    expect(events.some((e) => e.type === "numbed")).toBe(false);
    expect(state).not.toHaveProperty("buffs");
    expect(toHero(state).stepsLeft).toBe(4);
  });

  it("does not follow a hero who was knocked down by the hit", () => {
    const start = beginEncounter(setup({ onHit: { slow: STING } }, { hp: 1 }), ctx(HIT));
    const { state } = stung(start, HIT);
    expect(combatantById(state, "c_a")!.down).toBe(true);
    expect(numbed(state)).toEqual([]);
  });

  it("is a fight's own: it survives a save mid-fight and is gone from the next fight", () => {
    const start = beginEncounter(setup({ onHit: { slow: STING } }), ctx(HIT));
    const midway = stung(start, HIT).state;
    const resumed = JSON.parse(JSON.stringify(midway)) as EncounterState;
    expect(resumed).toEqual(midway);
    expect(toHero(resumed).stepsLeft).toBe(2);
    // The next fight starts from its setup alone: nothing carries out of this one.
    const next = beginEncounter(setup({ onHit: { slow: STING } }), ctx(HIT));
    expect(next).not.toHaveProperty("buffs");
    expect(next.stepsLeft).toBe(4);
  });

  it("adds up with a rift buff on the same number, inside the move limit", () => {
    const fleet: CombatBuff = { id: "fleet", label: "Fleet", kind: "move", heroId: "c_a", amount: 2 };
    const state = beginEncounter({ ...setup({ onHit: { slow: STING } }), buffs: [fleet] }, ctx(HIT));
    const after = stung(state, HIT).state;
    expect(buffBonus(after.buffs, "c_a", "move")).toBe(0);
    expect(toHero(after).stepsLeft).toBe(4);
    expect((after.buffs ?? []).map((b) => b.id)).toEqual(["fleet", "numbed"]);
  });
});

describe("striking a pufferfish-style enemy", () => {
  const defended = (puffTurns?: number) => setup({ retaliation: { slow: STING, ...(puffTurns === undefined ? {} : { puffTurns }) } });
  const puffedOf = (state: EncounterState) => combatantById(state, "skupper#1")!.puffed;

  it("starts the fight not puffed, so the first hit it takes does not sting", () => {
    const start = beginEncounter(defended(), ctx(HIT));
    expect(puffedOf(start)).toBeUndefined();
    const { state, events } = act(start, HIT, "skupper#1");
    expect(events).toContainEqual({ type: "puffed", actorId: "skupper#1", byId: "c_a" });
    expect(events.some((e) => e.type === "numbed")).toBe(false);
    expect(state).not.toHaveProperty("buffs");
    expect(puffedOf(state)).toBe(2);
  });

  it("once puffed, a hit on it Numbs the attacker for 2 of their following turns", () => {
    let state = act(beginEncounter(defended(), ctx(HIT)), HIT, "skupper#1").state; // puffs it
    state = toHero(state);
    const { state: after, events } = act(state, HIT, "skupper#1");
    expect(events).toContainEqual({ type: "numbed", actorId: "c_a", byId: "skupper#1", steps: 2, turns: 2 });
    // Already puffed: no second puffed beat, and the puff starts over.
    expect(events.some((e) => e.type === "puffed")).toBe(false);
    expect(puffedOf(after)).toBe(2);
    // Their own turn is still running, so the sting is given one to spare.
    expect(numbed(after)[0]!.turnsLeft).toBe(3);

    let next = toHero(after);
    expect(next.stepsLeft).toBe(2);
    next = toHero(next);
    expect(next.stepsLeft).toBe(2);
    next = toHero(next);
    expect(next.stepsLeft).toBe(4);
    expect(numbed(next)).toEqual([]);
  });

  it("a miss neither puffs it nor stings, puffed or not", () => {
    const miss = act(beginEncounter(defended(), ctx(MISS)), MISS, "skupper#1");
    expect(miss.events.some((e) => e.type === "puffed" || e.type === "numbed")).toBe(false);
    expect(puffedOf(miss.state)).toBeUndefined();

    const puffed = toHero(act(beginEncounter(defended(), ctx(HIT)), HIT, "skupper#1").state);
    const again = act(puffed, MISS, "skupper#1");
    expect(again.events.some((e) => e.type === "numbed")).toBe(false);
    expect(again.state).not.toHaveProperty("buffs");
    // A miss does not start the puff over either.
    expect(puffedOf(again.state)).toBe(1);
  });

  it("deflates after puffTurns of its own turns (default 2), and puffs again on the next hit", () => {
    let state = act(beginEncounter(defended(), ctx(HIT)), HIT, "skupper#1").state;
    expect(puffedOf(state)).toBe(2);
    state = toHero(state); // the Skupper's turn ended
    expect(puffedOf(state)).toBe(1);
    state = toHero(state); // the hero did nothing; its second turn ended
    expect(puffedOf(state)).toBeUndefined();
    const hit = act(state, HIT, "skupper#1");
    expect(hit.events.some((e) => e.type === "numbed")).toBe(false);
    expect(hit.events.some((e) => e.type === "puffed")).toBe(true);
  });

  it("puffTurns is how long it stays puffed", () => {
    let state = act(beginEncounter(defended(1), ctx(HIT)), HIT, "skupper#1").state;
    expect(puffedOf(state)).toBe(1);
    state = toHero(state);
    expect(puffedOf(state)).toBeUndefined();
    const long = act(beginEncounter(defended(4), ctx(HIT)), HIT, "skupper#1").state;
    expect(puffedOf(toHero(toHero(long)))).toBe(2);
  });

  it("the puffed state rides a JSON round trip, and is gone in the next fight", () => {
    const puffed = act(beginEncounter(defended(), ctx(HIT)), HIT, "skupper#1").state;
    const resumed = JSON.parse(JSON.stringify(puffed)) as EncounterState;
    expect(resumed).toEqual(puffed);
    expect(puffedOf(toHero(resumed))).toBe(1);
    expect(puffedOf(beginEncounter(defended(), ctx(HIT)))).toBeUndefined();
  });

  it("does not stack with the same enemy's other sting", () => {
    const both = setup({ onHit: { slow: STING }, retaliation: { slow: STING } });
    let state = act(beginEncounter(both, ctx(HIT)), HIT, "skupper#1").state; // puffs it
    state = toHero(state);
    state = act(state, HIT, "skupper#1").state; // stings
    state = stung(state, HIT).state; // stings again
    expect(numbed(state)).toHaveLength(1);
    expect(numbed(state)[0]!.amount).toBe(-2);
  });
});

describe("a sting a friend took for you", () => {
  it("lands on the protector who took the hit, not on the one it was aimed at", () => {
    const base = setup({ onHit: { slow: STING } });
    const brace: AbilityCatalog = {
      brace: {
        id: "brace",
        name: "Brace",
        icon: "shield",
        timing: "action",
        target: { kind: "ally", range: "adjacent" },
        effects: [{ effect: { type: "protect" } }],
      },
    };
    const guardian = resolveCharacter(
      makeCharacter({ id: "c_b", name: "c_b", species: "unicorn", class: "thornguard", stats: { might: 3, quick: 3, clever: 0, heart: 0 } }),
      RULES,
      ITEMS,
    );
    const two = {
      ...base,
      party: [...base.party, { character: { ...guardian, actions: ["brace"] }, at: { x: 0, y: 3 } }],
    };
    const bctx = { rules: RULES, abilities: brace, rng: HIT };
    let state = beginEncounter(two, bctx);
    // The guardian's turn: Brace for c_a, who stands beside the Skupper.
    while (currentActorId(state) !== "c_b") state = endTurn(state);
    const braced = performAction(state, bctx, { abilityId: "brace", targetId: "c_a" });
    if (!braced.ok) throw new Error(braced.reason);
    state = braced.state;
    const swing = stung(state, HIT);
    expect(swing.events.filter((e) => e.type === "numbed")).toEqual([
      { type: "numbed", actorId: "c_b", byId: "skupper#1", steps: 2, turns: 2 },
    ]);
    expect(numbed(swing.state).map((b) => b.heroId)).toEqual(["c_b"]);
  });
});

describe("an enemy with no sting", () => {
  it("fights exactly as it always did: no buffs, no beats, no new fields", () => {
    const start = beginEncounter(setup(), ctx(HIT));
    expect(combatantById(start, "skupper#1")).not.toHaveProperty("sting");
    expect(combatantById(start, "skupper#1")).not.toHaveProperty("retaliation");
    const strike = act(start, HIT, "skupper#1");
    expect(strike.events.some((e) => e.type === "numbed")).toBe(false);
    expect(strike.state).not.toHaveProperty("buffs");
    const hurt = stung(start, HIT);
    expect(hurt.events.some((e) => e.type === "numbed")).toBe(false);
    expect(hurt.state).not.toHaveProperty("buffs");
    expect(toHero(hurt.state).stepsLeft).toBe(4);
  });
});

describe("applyNumbed", () => {
  it("adds one Numbed per hero and refreshes it in place", () => {
    const other: CombatBuff = { id: "shield", label: "Shield", kind: "guard", heroId: "c_a", amount: 1 };
    const once = applyNumbed([other], "c_a", { steps: 1, turns: 1 }, false);
    expect(once.map((b) => b.id)).toEqual(["shield", "numbed"]);
    const twice = applyNumbed(once, "c_a", STING, false);
    expect(twice.map((b) => [b.id, b.amount, b.turnsLeft])).toEqual([
      ["shield", 1, undefined],
      ["numbed", -2, 2],
    ]);
    // A weaker, shorter sting afterwards cannot make it lighter or shorter.
    const again = applyNumbed(twice, "c_a", { steps: 1, turns: 1 }, false);
    expect(again[1]).toMatchObject({ amount: -2, turnsLeft: 2 });
    // Another hero is a separate entry.
    expect(applyNumbed(twice, "c_b", STING, false)).toHaveLength(3);
  });
});

describe("slowBlockProblems", () => {
  it("accepts a sting inside the move limit and the duration limit", () => {
    expect(slowBlockProblems({ slow: { steps: 2, turns: 2 } })).toEqual([]);
    expect(slowBlockProblems({ slow: { steps: 1, turns: 5 } })).toEqual([]);
  });

  it.each([
    ["no slow", {}, "/slow"],
    ["too many steps", { slow: { steps: 3, turns: 2 } }, "/slow/steps"],
    ["no steps", { slow: { steps: 0, turns: 2 } }, "/slow/steps"],
    ["a fractional turn count", { slow: { steps: 2, turns: 1.5 } }, "/slow/turns"],
    ["a turn count over the limit", { slow: { steps: 2, turns: 6 } }, "/slow/turns"],
    ["a root dressed as a slow", { slow: { steps: 2, turns: 2 }, root: true }, "/root"],
    ["a field the sting does not have", { slow: { steps: 2, turns: 2, damage: 1 } }, "/slow/damage"],
    ["puffTurns on an onHit", { slow: { steps: 2, turns: 2 }, puffTurns: 2 }, "/puffTurns"],
  ])("refuses %s", (_name, block, path) => {
    expect(slowBlockProblems(block).map((p) => p.path)).toContain(path);
  });

  it("a retaliation may say how long it stays puffed, 1 to 5 of its turns", () => {
    const block = (puffTurns: unknown) => ({ slow: { steps: 2, turns: 2 }, puffTurns });
    expect(slowBlockProblems(block(1), true)).toEqual([]);
    expect(slowBlockProblems(block(5), true)).toEqual([]);
    expect(slowBlockProblems({ slow: { steps: 2, turns: 2 } }, true)).toEqual([]);
    for (const bad of [0, 6, 1.5, "2"]) expect(slowBlockProblems(block(bad), true).map((p) => p.path)).toContain("/puffTurns");
  });

  it("is total over things that are not objects", () => {
    for (const bad of [null, 3, "slow", [], undefined]) expect(slowBlockProblems(bad)).not.toEqual([]);
  });
});
