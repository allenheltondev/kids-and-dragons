import { describe, expect, it } from "vitest";

import {
  ATTACK_ID,
  HELP_UP_ID,
  READY_ID,
  beginEncounter,
  combatantById,
  currentActor,
  currentActorId,
  encounterOutcome,
  endTurn,
  isPartyWiped,
  legalActions,
  legalMoves,
  moveTo,
  performAction,
  positionOf,
  rollInitiative,
  turnOrder,
} from "./encounter.js";
import type {
  AbilityCatalog,
  CombatActionResult,
  EncounterContext,
  EncounterSetup,
  EncounterState,
} from "./encounter.js";
import { parseBoard } from "./grid.js";
import type { Board, Position } from "./grid.js";
import { makeRng } from "./dice.js";
import type { Rng } from "./dice.js";
import { resolveCharacter } from "./character.js";
import { APPEARANCE, makeCharacter, makeItems, makeRules } from "./test-fixtures.js";
import type { ResolvedCharacter } from "./types/domain.js";
import type { EnemySpec } from "./types/chapter.js";

const RULES = makeRules();

/**
 * The die is pinned in most tests so the assertion is about the *rule*, not the
 * roll. `rollD20` is `floor(next() * 20) + 1`, so 0.999 is always a 20 and 0 is
 * always a 1 — and because initiative uses the same die, every figure rolls the
 * same number and turn order comes out ordered purely by Quick. That is what
 * makes the round-loop tests below readable.
 */
const ALWAYS_HIT: Rng = { next: () => 0.999 };
const ALWAYS_MISS: Rng = { next: () => 0 };

/**
 * A catalog written from `content/rules.json` — the four class signatures and
 * the six species combat actions, transcribed from their kid-facing text into
 * target rules and effects. It is a fixture, but it is the load-bearing one:
 * if the data model could not express these ten, the model would be wrong.
 * Nothing in encounter.ts knows any of these names.
 */
const CATALOG: AbilityCatalog = {
  // Thornguard — "Take a hit that was meant for a friend standing next to you."
  brace: {
    id: "brace",
    name: "Brace",
    icon: "shield",
    timing: "action",
    target: { kind: "ally", range: "adjacent" },
    effects: [{ effect: { type: "protect" } }],
  },
  // Duskrunner — "Go before anybody else on the first round." Never a button.
  first_strike: {
    id: "first_strike",
    name: "First Strike",
    icon: "arrow",
    timing: "initiative",
    target: { kind: "self" },
    effects: [{ effect: { type: "goFirst" }, to: "self" }],
  },
  // Starweaver — "Hit every enemy inside a 2x2 square of tiles."
  burst: {
    id: "burst",
    name: "Burst",
    icon: "spark",
    timing: "action",
    target: { kind: "tile", range: 6, openTileOnly: false, affects: "enemy", area: 2 },
    effects: [{ effect: { type: "attack", damage: 3 }, to: "area" }],
  },
  // Songkeeper — "Heal a friend, or lift a knocked-down friend back up from
  // across the board." One ability, two readings, said with `when`.
  rally: {
    id: "rally",
    name: "Rally",
    icon: "hand",
    timing: "action",
    target: { kind: "ally", range: "board", state: "any" },
    effects: [
      { effect: { type: "revive" }, when: "down" },
      { effect: { type: "heal", amount: 3 }, when: "standing" },
    ],
  },
  // Unicorn — "Touch a friend standing next to you. They get 3 HP back."
  mending_light: {
    id: "mending_light",
    name: "Mending Light",
    icon: "hand",
    timing: "action",
    target: { kind: "ally", range: "adjacent" },
    effects: [{ effect: { type: "heal", amount: 3 } }],
    oncePerEncounter: true,
  },
  // Dragonling — "Sail over anything in your way and land on any open tile
  // within 6 steps."
  gliding_leap: {
    id: "gliding_leap",
    name: "Gliding Leap",
    icon: "wing",
    timing: "action",
    target: { kind: "tile", range: 6, openTileOnly: true },
    effects: [{ effect: { type: "moveSelf" } }],
    oncePerEncounter: true,
  },
  // Griffin — "Every friend gets +2 on their next roll."
  sky_watch: {
    id: "sky_watch",
    name: "Sky Watch",
    icon: "eye",
    timing: "action",
    target: { kind: "none" },
    effects: [{ effect: { type: "rollBonus", amount: 2 }, to: "allies" }],
    oncePerEncounter: true,
  },
  // Bigfoot — "Every enemy next to you is shoved back 2 steps."
  ground_smash: {
    id: "ground_smash",
    name: "Ground Smash",
    icon: "fist",
    timing: "action",
    target: { kind: "none", affects: "enemy" },
    effects: [{ effect: { type: "shove", steps: 2 }, to: "adjacent" }],
    oncePerEncounter: true,
  },
  // Kitsune — "It is so busy watching them that it skips its next turn."
  fox_fire: {
    id: "fox_fire",
    name: "Fox Fire",
    icon: "spark",
    timing: "action",
    target: { kind: "enemy", range: 4 },
    effects: [{ effect: { type: "skipTurn" } }],
    oncePerEncounter: true,
  },
  // Manticore — "Jump to any open tile within 6 steps and attack the moment you
  // land." Two effects in order; the attack collects from where the leap ended.
  pounce: {
    id: "pounce",
    name: "Pounce",
    icon: "arrow",
    timing: "action",
    target: { kind: "tile", range: 6, openTileOnly: true, affects: "enemy" },
    effects: [
      { effect: { type: "moveSelf" } },
      { effect: { type: "attack", damage: 3 }, to: "adjacent" },
    ],
    oncePerEncounter: true,
  },
};

function ctxWith(rng: Rng): EncounterContext {
  return { rules: RULES, abilities: CATALOG, rng };
}

/** Eight by five, all open. Walls are added per-test where they matter. */
function openBoard(): Board {
  return parseBoard([
    "........",
    "........",
    "........",
    "........",
    "........",
  ]);
}

interface HeroInput {
  id: string;
  quick?: number;
  might?: number;
  maxHp?: number;
  guard?: number;
  steps?: number;
  actions?: string[];
}

function hero(input: HeroInput): ResolvedCharacter {
  return {
    id: input.id,
    ownerPlayerId: "p_1",
    // Combat never reads this; it is here because `ResolvedCharacter` promises
    // it (spec §8.1 — the point a level owes, waiting to be spent at a Rest).
    unspentPoints: 0,
    name: input.id,
    species: "unicorn",
    class: "thornguard",
    appearance: APPEARANCE,
    level: 1,
    xp: 0,
    tier: "fledgling",
    stats: { might: input.might ?? 3, quick: input.quick ?? 2, clever: 1, heart: 1 },
    maxHp: input.maxHp ?? 10,
    steps: input.steps ?? 4,
    guard: input.guard ?? 10,
    attackStat: "might",
    actions: input.actions ?? [],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: false,
  };
}

/** `guard - rules.baseGuard` is the Quick this monster rolls with (see the module). */
function wisp(overrides: Partial<EnemySpec> = {}): EnemySpec {
  return { id: "wisp", count: 1, hp: 6, guard: 11, steps: 5, attack: 3, ...overrides };
}

function setup(input: Partial<EncounterSetup> = {}): EncounterSetup {
  return {
    board: openBoard(),
    // Quick 9 against a Guard-11 wisp (Quick 3) so the hero reliably leads and
    // the tests below can talk about "the hero's turn" without pinning a die.
    party: [{ character: hero({ id: "c_hero", quick: 9 }), at: { x: 1, y: 2 } }],
    enemies: [{ spec: wisp(), at: { x: 2, y: 2 } }],
    ...input,
  };
}

function ok(result: CombatActionResult): Extract<CombatActionResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected the action to be legal, got: ${result.reason}`);
  return result;
}

function hpOf(state: EncounterState, id: string): number {
  const combatant = combatantById(state, id);
  if (!combatant) throw new Error(`no combatant "${id}"`);
  return combatant.hp;
}

// ---------------------------------------------------------------------------
// Setting up
// ---------------------------------------------------------------------------

describe("beginEncounter", () => {
  it("seats every figure on the board and gives each a combatant row", () => {
    // Catches a setup that builds combatants and actors from different lists —
    // the drift grid.ts's "positions live once" invariant exists to prevent.
    const state = beginEncounter(setup(), ctxWith(ALWAYS_HIT));

    expect(state.combatants.map((c) => c.id).sort()).toEqual(["c_hero", "wisp#1"]);
    expect(state.board.actors).toHaveLength(2);
    expect(positionOf(state, "c_hero")).toEqual({ x: 1, y: 2 });
    expect(positionOf(state, "wisp#1")).toEqual({ x: 2, y: 2 });
    expect(state.round).toBe(1);
  });

  it("numbers enemies of the same kind in placement order", () => {
    // Catches ids that depend on anything but the setup, which would make an
    // event log naming "wisp#2" mean a different wisp on replay.
    const state = beginEncounter(
      setup({
        enemies: [
          { spec: wisp(), at: { x: 4, y: 1 } },
          { spec: wisp(), at: { x: 5, y: 1 } },
          { spec: wisp({ id: "briar" }), at: { x: 6, y: 1 } },
        ],
      }),
      ctxWith(ALWAYS_HIT),
    );

    expect(state.combatants.map((c) => c.id)).toContain("wisp#1");
    expect(state.combatants.map((c) => c.id)).toContain("wisp#2");
    expect(state.combatants.map((c) => c.id)).toContain("briar#1");
  });

  it("gives everyone the three universal actions of §7.2 on top of their own", () => {
    // Catches Attack / Help Up / Ready going missing when a character's action
    // list from resolveCharacter is empty — they are rules, not content.
    const state = beginEncounter(
      setup({ party: [{ character: hero({ id: "c_hero", actions: ["brace"] }), at: { x: 1, y: 2 } }] }),
      ctxWith(ALWAYS_HIT),
    );

    const actions = combatantById(state, "c_hero")?.actions ?? [];
    expect(actions).toEqual(expect.arrayContaining([ATTACK_ID, HELP_UP_ID, READY_ID, "brace"]));
    // Monsters swing and nothing else.
    expect(combatantById(state, "wisp#1")?.actions).toEqual([ATTACK_ID]);
  });

  it("joins onto a real ResolvedCharacter", () => {
    // Catches the encounter drifting from character.ts: the signature and the
    // species combat action have to arrive as ability ids the catalog can key on.
    const character = resolveCharacter(
      makeCharacter({ id: "c_song", class: "songkeeper", species: "unicorn" }),
      RULES,
      makeItems(),
    );
    const state = beginEncounter(
      setup({ party: [{ character, at: { x: 1, y: 2 } }] }),
      ctxWith(ALWAYS_HIT),
    );
    const combatant = combatantById(state, "c_song");

    expect(combatant?.actions).toEqual(expect.arrayContaining(["rally", "mend_pulse"]));
    expect(combatant?.guard).toBe(character.guard);
    expect(combatant?.attackMod).toBe(character.stats[character.attackStat]);
  });

  it("keeps a character who walked in already knocked down on the floor", () => {
    // Catches an encounter that quietly heals the party on entry: §6.1 says a
    // Rest scene does that, and an ambush is not a rest.
    const state = beginEncounter(
      setup({
        party: [
          { character: hero({ id: "c_hero" }), at: { x: 1, y: 2 }, hp: 0, down: true },
          { character: hero({ id: "c_two" }), at: { x: 1, y: 1 } },
        ],
      }),
      ctxWith(ALWAYS_HIT),
    );

    expect(combatantById(state, "c_hero")?.down).toBe(true);
    // ...and still standing on the grid, waiting for a hand up (§7.3).
    expect(positionOf(state, "c_hero")).toEqual({ x: 1, y: 2 });
  });

  it("refuses a board that already has figures on it", () => {
    // Catches double placement, which grid.placeActor would only notice if the
    // two happened to land on the same tile.
    const state = beginEncounter(setup(), ctxWith(ALWAYS_HIT));
    expect(() => beginEncounter(setup({ board: state.board }), ctxWith(ALWAYS_HIT))).toThrow(
      /empty board/,
    );
  });

  it("does not mutate the setup it was handed", () => {
    // Catches in-place placement on the caller's board — the engine previews an
    // encounter with the same objects it later commits.
    const input = setup();
    const before = JSON.stringify(input);
    beginEncounter(input, ctxWith(ALWAYS_HIT));
    expect(JSON.stringify(input)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Turn order — spec §7.2
// ---------------------------------------------------------------------------

describe("turn order", () => {
  it("seats highest Quick first", () => {
    // Catches an inverted sort — the bug where the slowest hero always leads.
    const state = beginEncounter(
      setup({
        party: [
          { character: hero({ id: "c_slow", quick: 1 }), at: { x: 1, y: 1 } },
          { character: hero({ id: "c_fast", quick: 6 }), at: { x: 1, y: 3 } },
        ],
        enemies: [{ spec: wisp({ guard: 11 }), at: { x: 5, y: 2 } }],
      }),
      // Same die for everyone, so only Quick can decide.
      ctxWith(ALWAYS_MISS),
    );

    expect(state.order).toEqual(["c_fast", "wisp#1", "c_slow"]);
  });

  it("re-rolls identically from the same seed", () => {
    // architecture §4.1 — a replay that re-rolls differently is not a replay.
    const build = (): EncounterState =>
      beginEncounter(
        setup({
          party: [
            { character: hero({ id: "c_a", quick: 2 }), at: { x: 1, y: 1 } },
            { character: hero({ id: "c_b", quick: 2 }), at: { x: 1, y: 3 } },
          ],
          enemies: [
            { spec: wisp(), at: { x: 5, y: 1 } },
            { spec: wisp(), at: { x: 5, y: 3 } },
          ],
        }),
        ctxWith(makeRng("run_2026_07_29")),
      );

    expect(build().order).toEqual(build().order);
    expect(build().combatants.map((c) => c.initiative)).toEqual(
      build().combatants.map((c) => c.initiative),
    );
  });

  it("re-rolls per encounter rather than reusing one order", () => {
    // §7.2 — "rerolled each encounter so it isn't always the same person going
    // first". Catches an initiative baked into the character rather than rolled.
    const build = (seed: string): readonly string[] =>
      beginEncounter(
        setup({
          party: [
            { character: hero({ id: "c_a", quick: 2 }), at: { x: 1, y: 1 } },
            { character: hero({ id: "c_b", quick: 2 }), at: { x: 1, y: 3 } },
            { character: hero({ id: "c_c", quick: 2 }), at: { x: 2, y: 1 } },
          ],
          enemies: [{ spec: wisp(), at: { x: 5, y: 2 } }],
        }),
        ctxWith(makeRng(seed)),
      ).order;

    const orders = new Set(
      ["fight_1", "fight_2", "fight_3", "fight_4", "fight_5", "fight_6"].map((seed) =>
        build(seed).join(","),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it("breaks a tied total with the party, then with the id", () => {
    // Every d20 is identical here, so a hero on Quick 3 and a wisp whose Guard
    // says Quick 3 tie exactly. Catches a tiebreak that leans on array order,
    // which would silently flip the moment somebody rebuilds the party list.
    const state = beginEncounter(
      setup({
        party: [
          { character: hero({ id: "c_zed", quick: 3 }), at: { x: 1, y: 1 } },
          { character: hero({ id: "c_ada", quick: 3 }), at: { x: 1, y: 3 } },
        ],
        // baseGuard is 8 in the fixture rules, so Guard 11 is Quick 3.
        enemies: [{ spec: wisp({ guard: 11 }), at: { x: 5, y: 2 } }],
      }),
      ctxWith(ALWAYS_MISS),
    );

    const initiatives = state.combatants.map((c) => c.initiative);
    expect(new Set(initiatives).size).toBe(1);
    expect(state.order).toEqual(["c_ada", "c_zed", "wisp#1"]);
  });

  it("prefers the higher Quick when the totals tie but the rolls did not", () => {
    // Catches a tiebreak that skips straight to the id: a Quick 6 figure that
    // rolled low is not really tied with a Quick 1 figure that rolled high.
    const order = rollInitiative({ next: () => 0 }, [
      { id: "c_slow", side: "party", quick: 6 },
      { id: "c_fast", side: "party", quick: 6 },
    ]);
    expect(order.map((e) => e.id)).toEqual(["c_fast", "c_slow"]);

    const mixed = rollInitiative({ next: () => 0.999 }, [
      { id: "a_low", side: "party", quick: 1 },
      { id: "z_high", side: "party", quick: 1 },
    ]);
    expect(mixed.map((e) => e.id)).toEqual(["a_low", "z_high"]);
  });

  it("lets First Strike lead round one and only round one", () => {
    // Duskrunner's signature, §4.3. Catches it being offered as a tappable
    // action, and catches it leading every round instead of the first.
    const state = beginEncounter(
      setup({
        party: [
          { character: hero({ id: "c_dusk", quick: 1, actions: ["first_strike"] }), at: { x: 1, y: 1 } },
          { character: hero({ id: "c_fast", quick: 9 }), at: { x: 1, y: 3 } },
        ],
        enemies: [{ spec: wisp(), at: { x: 5, y: 2 } }],
      }),
      ctxWith(ALWAYS_MISS),
    );

    expect(turnOrder(state)).toEqual(["c_dusk", "c_fast", "wisp#1"]);
    expect(state.order).toEqual(["c_fast", "wisp#1", "c_dusk"]);

    const roundTwo = endTurn(endTurn(endTurn(state)));
    expect(roundTwo.round).toBe(2);
    expect(turnOrder(roundTwo)).toEqual(["c_fast", "wisp#1", "c_dusk"]);
    expect(currentActorId(roundTwo)).toBe("c_fast");
  });
});

// ---------------------------------------------------------------------------
// The round loop — spec §7.3
// ---------------------------------------------------------------------------

/** Healer first, the fallen second, the wisp last — order pinned by Quick. */
function reviveFixture(): EncounterState {
  return beginEncounter(
    setup({
      party: [
        { character: hero({ id: "c_healer", quick: 5, actions: ["rally"] }), at: { x: 1, y: 1 } },
        { character: hero({ id: "c_fallen", quick: 3 }), at: { x: 6, y: 4 }, hp: 0, down: true },
      ],
      enemies: [{ spec: wisp({ guard: 8 }), at: { x: 5, y: 2 } }],
    }),
    ctxWith(ALWAYS_MISS),
  );
}

describe("the round loop", () => {
  it("hands the turn on and rolls into the next round", () => {
    // Catches a round counter that never advances, which would break every
    // "until your next turn" rule and §7.1's four-round tuning.
    let state = beginEncounter(setup(), ctxWith(ALWAYS_MISS));
    const first = currentActorId(state);

    state = endTurn(state);
    expect(currentActorId(state)).not.toBe(first);
    expect(state.round).toBe(1);

    state = endTurn(state);
    expect(currentActorId(state)).toBe(first);
    expect(state.round).toBe(2);
  });

  it("gives the active figure fresh steps and a fresh action each turn", () => {
    // Catches steps that leak across turns — the bug where somebody who walked
    // four tiles on round one can never move again.
    let state = beginEncounter(setup(), ctxWith(ALWAYS_MISS));
    const actor = currentActor(state);
    expect(state.stepsLeft).toBe(actor?.steps);

    state = endTurn(endTurn(state));
    expect(state.stepsLeft).toBe(currentActor(state)?.steps);
    expect(state.actionTaken).toBe(false);
  });

  it("skips the knocked-down", () => {
    // §7.3 — "they lie on the grid, skip their turns, and can't act".
    const state = reviveFixture();
    expect(currentActorId(state)).toBe("c_healer");
    expect(currentActorId(endTurn(state))).toBe("wisp#1");
  });

  it("gives a friend their turn when they are lifted just before it", () => {
    // The beat roadmap chapter 4 is "done when": someone goes down, someone
    // else picks them up. Catches a skip list computed at the top of the round
    // instead of at the moment the marker arrives, which would silently steal
    // the revived hero's turn until the round after.
    const state = reviveFixture();
    const revived = ok(
      performAction(state, ctxWith(ALWAYS_MISS), { abilityId: "rally", targetId: "c_fallen" }),
    ).state;

    expect(combatantById(revived, "c_fallen")?.down).toBe(false);
    expect(hpOf(revived, "c_fallen")).toBe(1);
    expect(currentActorId(endTurn(revived))).toBe("c_fallen");
  });

  it("stands still rather than spinning when nobody can act", () => {
    // Catches the infinite loop: a cursor that searches for a figure who can
    // take a turn, in a state where there is none.
    const start = beginEncounter(setup(), ctxWith(ALWAYS_MISS));
    const allDown: EncounterState = {
      ...start,
      combatants: start.combatants.map((c) => ({ ...c, hp: 0, down: true })),
    };

    expect(endTurn(allDown)).toBe(allDown);
    expect(currentActor(allDown)).toBeNull();
    expect(legalActions(allDown, ctxWith(ALWAYS_MISS))).toEqual([]);
    expect(legalMoves(allDown)).toEqual([]);
  });

  it("costs a dazed figure exactly one turn", () => {
    // Fox Fire, §"it skips its next turn". Catches a daze that never clears and
    // takes the monster out of the fight permanently.
    const state = beginEncounter(
      setup({
        party: [
          { character: hero({ id: "c_fox", quick: 9, actions: ["fox_fire"] }), at: { x: 1, y: 2 } },
        ],
        enemies: [{ spec: wisp({ guard: 8 }), at: { x: 3, y: 2 } }],
      }),
      ctxWith(ALWAYS_MISS),
    );

    const dazed = ok(
      performAction(state, ctxWith(ALWAYS_MISS), { abilityId: "fox_fire", targetId: "wisp#1" }),
    ).state;

    // The wisp's turn is passed over, and the daze is spent doing it.
    const afterSkip = endTurn(dazed);
    expect(currentActorId(afterSkip)).toBe("c_fox");
    expect(combatantById(afterSkip, "wisp#1")?.skipNextTurn).toBe(false);
    expect(currentActorId(endTurn(afterSkip))).toBe("wisp#1");
  });
});

// ---------------------------------------------------------------------------
// Legality — the gate PlayerView renders from (spec §7.2)
// ---------------------------------------------------------------------------

describe("legalActions", () => {
  it("offers Attack only when something is standing next to you", () => {
    // §7.2 — "Illegal moves are not presented, so they can't be attempted."
    // Catches a greyed-out button, which is a question an 8-year-old has to ask.
    const adjacent = beginEncounter(setup(), ctxWith(ALWAYS_MISS));
    const far = beginEncounter(
      setup({ enemies: [{ spec: wisp({ guard: 8 }), at: { x: 6, y: 4 } }] }),
      ctxWith(ALWAYS_MISS),
    );

    const idsOf = (state: EncounterState): string[] =>
      legalActions(state, ctxWith(ALWAYS_MISS)).map((a) => a.abilityId);

    expect(currentActorId(adjacent)).toBe("c_hero");
    expect(idsOf(adjacent)).toContain(ATTACK_ID);
    expect(currentActorId(far)).toBe("c_hero");
    expect(idsOf(far)).not.toContain(ATTACK_ID);
    // Ready needs nothing at all, so it survives both.
    expect(idsOf(far)).toContain(READY_ID);
  });

  it("hides Help Up until somebody is on the floor beside you", () => {
    // §7.3's revive. Catches a target rule that ignores the `down` state and
    // offers to lift a friend who is standing up perfectly well.
    const standing = beginEncounter(
      setup({
        party: [
          { character: hero({ id: "c_hero", quick: 9 }), at: { x: 1, y: 2 } },
          { character: hero({ id: "c_pal", quick: 1 }), at: { x: 1, y: 1 } },
        ],
      }),
      ctxWith(ALWAYS_MISS),
    );
    expect(legalActions(standing, ctxWith(ALWAYS_MISS)).map((a) => a.abilityId)).not.toContain(
      HELP_UP_ID,
    );

    const fallen = beginEncounter(
      setup({
        party: [
          { character: hero({ id: "c_hero", quick: 9 }), at: { x: 1, y: 2 } },
          { character: hero({ id: "c_pal", quick: 1 }), at: { x: 1, y: 1 }, hp: 0, down: true },
        ],
      }),
      ctxWith(ALWAYS_MISS),
    );
    const helpUp = legalActions(fallen, ctxWith(ALWAYS_MISS)).find((a) => a.abilityId === HELP_UP_ID);
    expect(helpUp?.targets).toEqual(["c_pal"]);
  });

  it("hides an ability whose effects would find nobody", () => {
    // Ground Smash aims at nothing in particular — it shoves whoever is next to
    // you. Catches a legality check that only looks at the target rule and so
    // offers a button that provably does nothing.
    const alone = beginEncounter(
      setup({
        party: [{ character: hero({ id: "c_big", quick: 9, actions: ["ground_smash"] }), at: { x: 1, y: 2 } }],
        enemies: [{ spec: wisp({ guard: 8 }), at: { x: 6, y: 4 } }],
      }),
      ctxWith(ALWAYS_MISS),
    );
    expect(legalActions(alone, ctxWith(ALWAYS_MISS)).map((a) => a.abilityId)).not.toContain(
      "ground_smash",
    );

    const crowded = beginEncounter(
      setup({
        party: [{ character: hero({ id: "c_big", quick: 9, actions: ["ground_smash"] }), at: { x: 1, y: 2 } }],
        enemies: [{ spec: wisp({ guard: 8 }), at: { x: 2, y: 2 } }],
      }),
      ctxWith(ALWAYS_MISS),
    );
    expect(legalActions(crowded, ctxWith(ALWAYS_MISS)).map((a) => a.abilityId)).toContain(
      "ground_smash",
    );
  });

  it("never offers an initiative-timed signature as a button", () => {
    // Catches First Strike rendering as a dead button on the phone.
    const state = beginEncounter(
      setup({
        party: [{ character: hero({ id: "c_dusk", quick: 9, actions: ["first_strike"] }), at: { x: 1, y: 2 } }],
      }),
      ctxWith(ALWAYS_MISS),
    );
    expect(legalActions(state, ctxWith(ALWAYS_MISS)).map((a) => a.abilityId)).not.toContain(
      "first_strike",
    );
  });

  it("retires a species action after one use (§7.2)", () => {
    // Catches a once-per-encounter flag that is written but never read.
    const state = beginEncounter(
      setup({
        party: [
          { character: hero({ id: "c_uni", quick: 9, actions: ["mending_light"] }), at: { x: 1, y: 2 } },
          { character: hero({ id: "c_pal", quick: 1, maxHp: 10 }), at: { x: 1, y: 1 }, hp: 4 },
        ],
        enemies: [{ spec: wisp({ guard: 8 }), at: { x: 6, y: 4 } }],
      }),
      ctxWith(ALWAYS_MISS),
    );

    const used = ok(
      performAction(state, ctxWith(ALWAYS_MISS), {
        abilityId: "mending_light",
        targetId: "c_pal",
      }),
    ).state;
    expect(combatantById(used, "c_uni")?.spent).toEqual(["mending_light"]);

    // Come back round to their next turn: still spent.
    let later = used;
    for (let i = 0; i < 3; i++) later = endTurn(later);
    expect(currentActorId(later)).toBe("c_uni");
    expect(legalActions(later, ctxWith(ALWAYS_MISS)).map((a) => a.abilityId)).not.toContain(
      "mending_light",
    );
    expect(
      performAction(later, ctxWith(ALWAYS_MISS), { abilityId: "mending_light", targetId: "c_pal" }).ok,
    ).toBe(false);
  });

  it("offers nothing once the action is spent", () => {
    // §7.2 — "take one action". Catches two attacks in a turn.
    const state = beginEncounter(setup(), ctxWith(ALWAYS_HIT));
    const acted = ok(
      performAction(state, ctxWith(ALWAYS_HIT), { abilityId: ATTACK_ID, targetId: "wisp#1" }),
    ).state;

    expect(legalActions(acted, ctxWith(ALWAYS_HIT))).toEqual([]);
    expect(
      performAction(acted, ctxWith(ALWAYS_HIT), { abilityId: ATTACK_ID, targetId: "wisp#1" }).ok,
    ).toBe(false);
  });

  it("refuses a target it never offered", () => {
    // The security half of §7.2: a phone that fell behind the couch cannot buy
    // a free hit by naming a figure four tiles away.
    const state = beginEncounter(
      setup({
        enemies: [
          { spec: wisp({ guard: 8 }), at: { x: 2, y: 2 } },
          { spec: wisp({ guard: 8 }), at: { x: 6, y: 4 } },
        ],
      }),
      ctxWith(ALWAYS_HIT),
    );

    const attack = legalActions(state, ctxWith(ALWAYS_HIT)).find((a) => a.abilityId === ATTACK_ID);
    expect(attack?.targets).toEqual(["wisp#1"]);

    const refused = performAction(state, ctxWith(ALWAYS_HIT), {
      abilityId: ATTACK_ID,
      targetId: "wisp#2",
    });
    expect(refused.ok).toBe(false);
    // Refused, not thrown — the engine turns this into an error code and the
    // phone resyncs.
    expect(refused.ok === false && refused.reason).toMatch(/legal target/);
  });

  it("refuses an ability the actor does not have", () => {
    // Catches a client that invents an ability id.
    const state = beginEncounter(setup(), ctxWith(ALWAYS_HIT));
    expect(performAction(state, ctxWith(ALWAYS_HIT), { abilityId: "burst" }).ok).toBe(false);
  });

  it("skips an ability id the catalog has never heard of", () => {
    // Mirrors resolveCharacter's tolerance of a stale unlockedActions entry: a
    // save written against older content must not take the table down.
    const state = beginEncounter(
      setup({
        party: [{ character: hero({ id: "c_hero", actions: ["a_spell_from_2027"] }), at: { x: 1, y: 2 } }],
      }),
      ctxWith(ALWAYS_MISS),
    );
    expect(() => legalActions(state, ctxWith(ALWAYS_MISS))).not.toThrow();
    expect(legalActions(state, ctxWith(ALWAYS_MISS)).map((a) => a.abilityId)).not.toContain(
      "a_spell_from_2027",
    );
  });
});

// ---------------------------------------------------------------------------
// Movement — spec §7.1, §7.2
// ---------------------------------------------------------------------------

describe("movement", () => {
  it("spends steps and refuses a tile out of reach", () => {
    // Catches a move that costs nothing, and one the highlight never offered.
    const state = beginEncounter(
      setup({
        party: [{ character: hero({ id: "c_hero", quick: 9, steps: 4 }), at: { x: 1, y: 2 } }],
        enemies: [{ spec: wisp({ guard: 8 }), at: { x: 7, y: 0 } }],
      }),
      ctxWith(ALWAYS_MISS),
    );

    expect(state.stepsLeft).toBe(4);
    const moved = ok(moveTo(state, { x: 3, y: 2 }));
    expect(positionOf(moved.state, "c_hero")).toEqual({ x: 3, y: 2 });
    expect(moved.state.stepsLeft).toBe(2);
    // Diagonals cost 1 (§7.1), so this is one more step, not two.
    expect(ok(moveTo(moved.state, { x: 4, y: 3 })).state.stepsLeft).toBe(1);

    expect(moveTo(state, { x: 7, y: 4 }).ok).toBe(false);
  });

  it("stops offering movement once the action is spent", () => {
    // §7.2 — "move up to your steps, then take one action", in that order. It
    // is why Twin Step ("move, attack, and then move again") is worth a level-6
    // unlock at all.
    const state = beginEncounter(setup(), ctxWith(ALWAYS_HIT));
    expect(legalMoves(state).length).toBeGreaterThan(0);

    const acted = ok(
      performAction(state, ctxWith(ALWAYS_HIT), { abilityId: ATTACK_ID, targetId: "wisp#1" }),
    ).state;
    expect(legalMoves(acted)).toEqual([]);
    expect(moveTo(acted, { x: 1, y: 1 }).ok).toBe(false);
  });

  it("leaps over a wall that a walk would have to go around", () => {
    // Gliding Leap — "sail over anything in your way and land on any open tile
    // within 6 steps". Catches a tile range that pays for detours; grid.ts is
    // explicit that range and walking are different questions.
    const walled = parseBoard([
      "........",
      "...#....",
      "...#....",
      "...#....",
      "...#....",
    ]);
    const state = beginEncounter(
      setup({
        board: walled,
        party: [
          // Two steps on foot, so the far side of the wall is a four-step walk
          // and comfortably out of reach.
          {
            character: hero({ id: "c_drag", quick: 9, steps: 2, actions: ["gliding_leap"] }),
            at: { x: 2, y: 2 },
          },
        ],
        enemies: [{ spec: wisp({ guard: 8 }), at: { x: 6, y: 4 } }],
      }),
      ctxWith(ALWAYS_MISS),
    );

    // Straight through the wall is two steps; walking is far more.
    expect(legalMoves(state).some((t) => t.x === 4 && t.y === 2)).toBe(false);
    const leapt = ok(
      performAction(state, ctxWith(ALWAYS_MISS), {
        abilityId: "gliding_leap",
        targetTile: { x: 4, y: 2 },
      }),
    ).state;
    expect(positionOf(leapt, "c_drag")).toEqual({ x: 4, y: 2 });
    // Never into the wall itself.
    expect(
      performAction(state, ctxWith(ALWAYS_MISS), {
        abilityId: "gliding_leap",
        targetTile: { x: 3, y: 2 },
      }).ok,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Actions and effects
// ---------------------------------------------------------------------------

describe("actions", () => {
  it("rolls d20 + the class stat against Guard and takes HP off on a hit", () => {
    // §4.1 and §7.2, the one resolution mechanic. Catches a roll made against
    // the wrong number, or damage applied on a miss.
    const state = beginEncounter(setup(), ctxWith(ALWAYS_HIT));
    const hit = ok(
      performAction(state, ctxWith(ALWAYS_HIT), { abilityId: ATTACK_ID, targetId: "wisp#1" }),
    );

    const roll = hit.events.find((e) => e.type === "roll");
    expect(roll).toEqual({ type: "roll", roll: expect.objectContaining({ die: 20, tn: 11, result: "hit" }) });
    expect(hpOf(hit.state, "wisp#1")).toBe(3);

    const miss = ok(
      performAction(state, ctxWith(ALWAYS_MISS), { abilityId: ATTACK_ID, targetId: "wisp#1" }),
    );
    expect(hpOf(miss.state, "wisp#1")).toBe(6);
  });

  it("hits everything inside Burst's 2x2 and nothing outside it", () => {
    // §4.3 — "Hit every enemy inside a 2x2 square of tiles". Catches an area
    // that leaks a tile in any direction, which on a 10x8 board is the
    // difference between a spell and a board wipe.
    const state = beginEncounter(
      setup({
        party: [{ character: hero({ id: "c_star", quick: 9, actions: ["burst"] }), at: { x: 0, y: 0 } }],
        enemies: [
          { spec: wisp({ guard: 8 }), at: { x: 3, y: 2 } },
          { spec: wisp({ guard: 8 }), at: { x: 4, y: 3 } },
          { spec: wisp({ guard: 8 }), at: { x: 5, y: 2 } },
        ],
      }),
      ctxWith(ALWAYS_HIT),
    );

    const burst = ok(
      performAction(state, ctxWith(ALWAYS_HIT), { abilityId: "burst", targetTile: { x: 3, y: 2 } }),
    ).state;

    expect(hpOf(burst, "wisp#1")).toBe(3);
    expect(hpOf(burst, "wisp#2")).toBe(3);
    expect(hpOf(burst, "wisp#3")).toBe(6);
  });

  it("carries Ready's +2 into the next roll and then spends it", () => {
    // §7.2 — "Ready: skip and gain +2 to your next roll." Catches a bonus that
    // never applies, and one that never clears.
    const state = beginEncounter(
      setup({
        // Quick only pins the order here: a Guard-21 wisp reads as Quick 13.
        party: [{ character: hero({ id: "c_hero", quick: 20, might: 0 }), at: { x: 1, y: 2 } }],
        // Guard 21 needs a 20 plus the +2 to land, so the bonus is the whole
        // difference between a hit and a miss.
        enemies: [{ spec: wisp({ guard: 21 }), at: { x: 2, y: 2 } }],
      }),
      ctxWith(ALWAYS_HIT),
    );

    const bare = ok(
      performAction(state, ctxWith(ALWAYS_HIT), { abilityId: ATTACK_ID, targetId: "wisp#1" }),
    );
    expect(hpOf(bare.state, "wisp#1")).toBe(6);

    const readied = ok(performAction(state, ctxWith(ALWAYS_HIT), { abilityId: READY_ID })).state;
    expect(combatantById(readied, "c_hero")?.rollBonus).toBe(2);

    let next = readied;
    for (let i = 0; i < 2; i++) next = endTurn(next);
    expect(currentActorId(next)).toBe("c_hero");

    const boosted = ok(
      performAction(next, ctxWith(ALWAYS_HIT), { abilityId: ATTACK_ID, targetId: "wisp#1" }),
    );
    expect(hpOf(boosted.state, "wisp#1")).toBe(3);
    expect(combatantById(boosted.state, "c_hero")?.rollBonus).toBe(0);
  });

  it("takes the larger of two roll bonuses rather than adding them", () => {
    // §4.1 promises one die plus one number. Catches bonuses stacking into the
    // arithmetic the whole mechanic exists to avoid.
    const state = beginEncounter(
      setup({
        party: [
          { character: hero({ id: "c_grif", quick: 9, actions: ["sky_watch"] }), at: { x: 1, y: 2 } },
          { character: hero({ id: "c_pal", quick: 5 }), at: { x: 1, y: 1 } },
        ],
        enemies: [{ spec: wisp({ guard: 8 }), at: { x: 6, y: 4 } }],
      }),
      ctxWith(ALWAYS_MISS),
    );

    const watched = ok(
      performAction(state, ctxWith(ALWAYS_MISS), { abilityId: "sky_watch" }),
    ).state;
    expect(combatantById(watched, "c_pal")?.rollBonus).toBe(2);
    // "Every friend" includes the one doing the calling.
    expect(combatantById(watched, "c_grif")?.rollBonus).toBe(2);

    const readied = ok(
      performAction(endTurn(watched), ctxWith(ALWAYS_MISS), { abilityId: READY_ID }),
    ).state;
    expect(combatantById(readied, "c_pal")?.rollBonus).toBe(2);
  });

  it("shoves everyone adjacent away and pins them against a wall", () => {
    // Ground Smash. Catches a shove that throws when it runs out of room, and
    // one that pushes toward the shover.
    const state = beginEncounter(
      setup({
        party: [{ character: hero({ id: "c_big", quick: 9, actions: ["ground_smash"] }), at: { x: 3, y: 2 } }],
        enemies: [
          { spec: wisp({ guard: 8 }), at: { x: 4, y: 2 } },
          { spec: wisp({ guard: 8 }), at: { x: 2, y: 2 } },
        ],
      }),
      ctxWith(ALWAYS_MISS),
    );

    const smashed = ok(
      performAction(state, ctxWith(ALWAYS_MISS), { abilityId: "ground_smash" }),
    ).state;

    expect(positionOf(smashed, "wisp#1")).toEqual({ x: 6, y: 2 });
    // Two steps left would be x = 0; the board edge is a wall, so it stops there.
    expect(positionOf(smashed, "wisp#2")).toEqual({ x: 0, y: 2 });
  });

  it("lands a Pounce and swings from where it landed", () => {
    // Two effects in order, the second collecting from the actor's new tile.
    // Catches an audience computed once, up front, before the leap.
    const state = beginEncounter(
      setup({
        party: [{ character: hero({ id: "c_man", quick: 9, actions: ["pounce"] }), at: { x: 0, y: 0 } }],
        enemies: [{ spec: wisp({ guard: 8 }), at: { x: 5, y: 2 } }],
      }),
      ctxWith(ALWAYS_HIT),
    );

    const pounced = ok(
      performAction(state, ctxWith(ALWAYS_HIT), { abilityId: "pounce", targetTile: { x: 4, y: 2 } }),
    );

    expect(positionOf(pounced.state, "c_man")).toEqual({ x: 4, y: 2 });
    expect(hpOf(pounced.state, "wisp#1")).toBe(3);
  });

  it("puts a Thornguard in front of the friend they braced for", () => {
    // §4.3 — "Take a hit that was meant for a friend standing next to you."
    // Catches damage that ignores the redirect, and a shield that keeps
    // absorbing hits forever.
    const state = beginEncounter(
      setup({
        party: [
          { character: hero({ id: "c_thorn", quick: 9, actions: ["brace"] }), at: { x: 1, y: 2 } },
          { character: hero({ id: "c_pal", quick: 8 }), at: { x: 1, y: 1 } },
        ],
        enemies: [{ spec: wisp({ guard: 8, attack: 20 }), at: { x: 2, y: 1 } }],
      }),
      ctxWith(ALWAYS_HIT),
    );

    const braced = ok(
      performAction(state, ctxWith(ALWAYS_HIT), { abilityId: "brace", targetId: "c_pal" }),
    ).state;
    expect(combatantById(braced, "c_pal")?.protectedBy).toBe("c_thorn");

    // c_pal's turn, then the wisp's — which swings at the protected friend.
    let turn = endTurn(endTurn(braced));
    expect(currentActorId(turn)).toBe("wisp#1");
    const swing = ok(
      performAction(turn, ctxWith(ALWAYS_HIT), { abilityId: ATTACK_ID, targetId: "c_pal" }),
    );

    expect(hpOf(swing.state, "c_pal")).toBe(10);
    expect(hpOf(swing.state, "c_thorn")).toBe(7);
    // One hit, then it is gone.
    expect(combatantById(swing.state, "c_pal")?.protectedBy).toBeNull();

    turn = endTurn(swing.state);
    const second = ok(
      performAction(endTurn(endTurn(turn)), ctxWith(ALWAYS_HIT), {
        abilityId: ATTACK_ID,
        targetId: "c_pal",
      }),
    );
    expect(hpOf(second.state, "c_pal")).toBe(7);
  });

  it("does not mutate the state it was handed", () => {
    // Every function returns a new state — the client previews an action with
    // the same object it is still rendering from.
    const state = beginEncounter(setup(), ctxWith(ALWAYS_HIT));
    const before = JSON.stringify(state);
    performAction(state, ctxWith(ALWAYS_HIT), { abilityId: ATTACK_ID, targetId: "wisp#1" });
    moveTo(state, { x: 1, y: 1 });
    endTurn(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("survives a round trip through JSON", () => {
    // EncounterState rides inside RunState over JSON Patch (architecture §4.2).
    // Catches a Map, a Set or an undefined sneaking into the state.
    const state = beginEncounter(setup(), ctxWith(ALWAYS_HIT));
    const acted = ok(
      performAction(state, ctxWith(ALWAYS_HIT), { abilityId: ATTACK_ID, targetId: "wisp#1" }),
    ).state;
    const revived = JSON.parse(JSON.stringify(acted)) as EncounterState;

    expect(revived).toEqual(acted);
    expect(currentActorId(revived)).toBe(currentActorId(acted));
    expect(legalActions(revived, ctxWith(ALWAYS_HIT))).toEqual(
      legalActions(acted, ctxWith(ALWAYS_HIT)),
    );
  });
});

// ---------------------------------------------------------------------------
// Knocked down, not dead — spec §7.3
// ---------------------------------------------------------------------------

describe("knocked down, not dead", () => {
  it("leaves a fallen character on the grid at 0 HP and takes a beaten monster off it", () => {
    // §7.3 for the character. For the monster: grid.ts will not let anybody
    // cross an enemy and nobody can Help Up a wisp, so a beaten one left in a
    // doorway would be permanent terrain with no in-game way to shift it.
    const state = beginEncounter(
      setup({
        party: [{ character: hero({ id: "c_hero", quick: 9, might: 20 }), at: { x: 1, y: 2 } }],
        enemies: [
          { spec: wisp({ guard: 8, hp: 3 }), at: { x: 2, y: 2 } },
          { spec: wisp({ guard: 8 }), at: { x: 6, y: 4 } },
        ],
      }),
      ctxWith(ALWAYS_HIT),
    );

    const felled = ok(
      performAction(state, ctxWith(ALWAYS_HIT), { abilityId: ATTACK_ID, targetId: "wisp#1" }),
    );

    expect(combatantById(felled.state, "wisp#1")?.down).toBe(true);
    expect(hpOf(felled.state, "wisp#1")).toBe(0);
    expect(positionOf(felled.state, "wisp#1")).toBeNull();
    expect(felled.events.some((e) => e.type === "down")).toBe(true);
  });

  it("lifts a knocked-down ally to exactly 1 HP", () => {
    // §7.3 — "brings them back at 1 HP", not to full and not to half.
    const state = reviveFixture();
    const lifted = ok(
      performAction(state, ctxWith(ALWAYS_MISS), { abilityId: "rally", targetId: "c_fallen" }),
    );

    expect(hpOf(lifted.state, "c_fallen")).toBe(1);
    expect(combatantById(lifted.state, "c_fallen")?.down).toBe(false);
    expect(lifted.events).toContainEqual({ type: "revived", actorId: "c_fallen", hp: 1 });
  });

  it("heals a standing friend and never lifts a fallen one", () => {
    // Rally is one ability with two readings (§4.3), and healing is not one of
    // the ways back up (§7.3). Catches a heal that stacks on top of a revive,
    // which would put a lifted friend at 4 HP instead of 1.
    const state = reviveFixture();
    const lifted = ok(
      performAction(state, ctxWith(ALWAYS_MISS), { abilityId: "rally", targetId: "c_fallen" }),
    ).state;
    expect(hpOf(lifted, "c_fallen")).toBe(1);

    const hurt = beginEncounter(
      setup({
        party: [
          { character: hero({ id: "c_healer", quick: 9, actions: ["rally"] }), at: { x: 1, y: 1 } },
          { character: hero({ id: "c_pal", quick: 5 }), at: { x: 6, y: 4 }, hp: 4 },
        ],
        enemies: [{ spec: wisp({ guard: 8 }), at: { x: 5, y: 2 } }],
      }),
      ctxWith(ALWAYS_MISS),
    );
    const healed = ok(
      performAction(hurt, ctxWith(ALWAYS_MISS), { abilityId: "rally", targetId: "c_pal" }),
    ).state;
    expect(hpOf(healed, "c_pal")).toBe(7);
  });

  it("never heals past maximum", () => {
    // Catches an overheal that leaves somebody carrying spare HP into the next
    // scene, where §8 has opinions about what the party's health means.
    const state = beginEncounter(
      setup({
        party: [
          { character: hero({ id: "c_uni", quick: 9, actions: ["mending_light"] }), at: { x: 1, y: 2 } },
          { character: hero({ id: "c_pal", quick: 5, maxHp: 10 }), at: { x: 1, y: 1 }, hp: 9 },
        ],
        enemies: [{ spec: wisp({ guard: 8 }), at: { x: 6, y: 4 } }],
      }),
      ctxWith(ALWAYS_MISS),
    );
    const healed = ok(
      performAction(state, ctxWith(ALWAYS_MISS), {
        abilityId: "mending_light",
        targetId: "c_pal",
      }),
    ).state;
    expect(hpOf(healed, "c_pal")).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Outcomes — a result, never a phase (spec §7.3)
// ---------------------------------------------------------------------------

describe("encounterOutcome", () => {
  it("reports a party wipe as a result and keeps every character on the sheet", () => {
    // §7.3 — "lost, not fatal ... the story branches. There is no game over
    // screen and no character sheet is ever deleted." Catches a terminal state
    // creeping into the encounter instead of the engine branching.
    const state = beginEncounter(
      setup({
        party: [{ character: hero({ id: "c_hero", quick: 1, maxHp: 3, guard: 8 }), at: { x: 1, y: 2 } }],
        enemies: [{ spec: wisp({ guard: 20, attack: 20 }), at: { x: 2, y: 2 } }],
      }),
      ctxWith(ALWAYS_HIT),
    );
    expect(currentActorId(state)).toBe("wisp#1");
    expect(encounterOutcome(state)).toBe("ongoing");

    const wiped = ok(
      performAction(state, ctxWith(ALWAYS_HIT), { abilityId: ATTACK_ID, targetId: "c_hero" }),
    );

    expect(wiped.outcome).toBe("defeat");
    expect(isPartyWiped(wiped.state)).toBe(true);
    // Still on the board, still 0 HP, still a character (§7.3).
    expect(combatantById(wiped.state, "c_hero")?.down).toBe(true);
    expect(positionOf(wiped.state, "c_hero")).toEqual({ x: 1, y: 2 });
    // Nothing is stuck: the loop keeps running for whoever is still standing.
    expect(currentActorId(endTurn(wiped.state))).toBe("wisp#1");
  });

  it("reports victory when the last enemy goes down", () => {
    // Catches an outcome that counts figures on the board rather than beaten
    // ones — a beaten enemy leaves the board, so the two are not the same test.
    const state = beginEncounter(
      setup({
        party: [{ character: hero({ id: "c_hero", quick: 9, might: 20 }), at: { x: 1, y: 2 } }],
        enemies: [{ spec: wisp({ guard: 8, hp: 3 }), at: { x: 2, y: 2 } }],
      }),
      ctxWith(ALWAYS_HIT),
    );

    const won = ok(
      performAction(state, ctxWith(ALWAYS_HIT), { abilityId: ATTACK_ID, targetId: "wisp#1" }),
    );
    expect(won.outcome).toBe("victory");
  });

  it("calls it a victory when the last enemy and the last hero fall together", () => {
    // Both can land in the same instant. Catches an order of checks that hands
    // the party a defeat in a fight with nobody left to lose it, and does not
    // match what everybody at the table just watched happen.
    const state = beginEncounter(setup(), ctxWith(ALWAYS_HIT));
    const mutual: EncounterState = {
      ...state,
      combatants: state.combatants.map((c) => ({ ...c, hp: 0, down: true })),
    };
    expect(encounterOutcome(mutual)).toBe("victory");
  });
});

// ---------------------------------------------------------------------------
// Determinism — architecture §4.1
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("replays a scripted fight to the identical state", () => {
    // The whole reason randomness is injected. Catches a Math.random(), a
    // Date.now(), or an iteration order that depends on object identity.
    const play = (): EncounterState => {
      const rng = makeRng("run_replay");
      const ctx: EncounterContext = { rules: RULES, abilities: CATALOG, rng };
      let state = beginEncounter(
        setup({
          party: [
            { character: hero({ id: "c_a", quick: 3, actions: ["burst"] }), at: { x: 1, y: 1 } },
            { character: hero({ id: "c_b", quick: 3 }), at: { x: 1, y: 3 } },
          ],
          enemies: [
            { spec: wisp(), at: { x: 3, y: 1 } },
            { spec: wisp(), at: { x: 3, y: 3 } },
          ],
        }),
        ctx,
      );

      for (let turn = 0; turn < 8; turn++) {
        const actor = currentActor(state);
        if (!actor) break;
        const options = legalActions(state, ctx);
        const choice = options[0];
        if (choice) {
          const request =
            choice.targets[0] !== undefined
              ? { abilityId: choice.abilityId, targetId: choice.targets[0] }
              : choice.tiles[0] !== undefined
                ? { abilityId: choice.abilityId, targetTile: choice.tiles[0] as Position }
                : { abilityId: choice.abilityId };
          const result = performAction(state, ctx, request);
          if (result.ok) state = result.state;
        }
        state = endTurn(state);
      }
      return state;
    };

    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });
});
