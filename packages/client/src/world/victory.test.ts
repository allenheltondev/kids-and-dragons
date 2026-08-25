/**
 * "Did they just win?" — the transition rule behind the victory beat.
 *
 * Pure over a pair of states, so the rule is testable with no renderer, and
 * so the flourish and the cue cannot disagree about what a victory is. The
 * case that matters most is the one it must refuse: §7.3 makes a wipe a story
 * branch, and a screen that bloomed with light at a party being knocked down
 * would be telling an eight-year-old the opposite of what happened.
 */

import { describe, expect, it } from "vitest";
import { beginEncounter, parseBoard } from "@kad/shared";
import type { EncounterState, ResolvedCharacter, RunState } from "@kad/shared";
import { makeRules } from "../../../shared/src/test-fixtures";
import { justWonAFight } from "./victory";

function character(): ResolvedCharacter {
  return {
    id: "c_1",
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 1,
    xp: 0,
    tier: "fledgling",
    stats: { might: 2, quick: 9, clever: 3, heart: 5 },
    unspentPoints: 0,
    spendableStats: ["might", "quick", "clever", "heart"],
    committedLevel: 1,
    maxHp: 10,
    steps: 4,
    guard: 11,
    attackStat: "heart",
    actions: [],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: false,
  };
}

function fight(): EncounterState {
  return beginEncounter(
    {
      board: parseBoard(["....", "....", "....", "...."]),
      party: [{ character: character(), at: { x: 0, y: 0 } }],
      enemies: [
        {
          spec: { id: "wisp", name: "Bramblewisp", count: 1, hp: 6, guard: 11, quick: 3, steps: 5, attack: 3 },
          at: { x: 3, y: 3 },
        },
      ],
    },
    { rules: makeRules(), abilities: {}, rng: { next: () => 0.5 } },
  );
}

/** Every combatant of one side flattened — the two ways a fight can end. */
function withAllDown(encounter: EncounterState, side: "party" | "enemy"): EncounterState {
  return {
    ...encounter,
    combatants: encounter.combatants.map((combatant) =>
      combatant.side === side ? { ...combatant, hp: 0, down: true } : combatant,
    ),
  };
}

function runWith(encounter: EncounterState | null): RunState {
  return { runId: "r_1", encounter } as unknown as RunState;
}

describe("did they just win", () => {
  it("says yes when the fight that cleared had every enemy down", () => {
    const won = runWith(withAllDown(fight(), "enemy"));
    expect(justWonAFight(won, runWith(null))).toBe(true);
  });

  it("says no to a wipe, which is a branch and not a defeat screen", () => {
    // §7.3: knocked down, never dead — the story takes onDefeat and walks on.
    const wiped = runWith(withAllDown(fight(), "party"));
    expect(justWonAFight(wiped, runWith(null))).toBe(false);
  });

  it("says no while the fight is still going", () => {
    const ongoing = runWith(fight());
    expect(justWonAFight(ongoing, runWith(fight()))).toBe(false);
  });

  it("says no when there was never a fight", () => {
    // Every story patch is this case, so it is the one that must be cheap and
    // certain: a scene change is not a victory.
    expect(justWonAFight(runWith(null), runWith(null))).toBe(false);
    expect(justWonAFight(null, runWith(null))).toBe(false);
  });

  it("says no when a won fight has not cleared yet", () => {
    // The engine settles on the next intent; until then the board is still up
    // and the beat would play over it.
    const won = withAllDown(fight(), "enemy");
    expect(justWonAFight(runWith(won), runWith(won))).toBe(false);
  });
});
