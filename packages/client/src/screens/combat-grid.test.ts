/**
 * The phone's grid model (screens/combat-grid.ts): what CombatPanel renders
 * is exactly what these cells say, so the promises live here — tappable means
 * "the server offered it", occupants carry shape-based identity (icon +
 * ordinal names), and the turn key changes whenever the question does.
 */

import { describe, expect, it } from "vitest";
import type { Chapter, EncounterContext, EnemySpec, RulesContent } from "@kad/shared";
import { beginEncounter, currentActorId, legalMoves, makeRng, moveTo, parseBoard } from "@kad/shared";
import { combatantLabel, enemyPortraitUrl, gridCells, turnKey } from "./combat-grid";
import { makeCharacter, makeMember } from "../testing/fixtures";

const WISP: EnemySpec = {
  id: "wisp",
  name: "Bramblewisp",
  count: 1,
  hp: 6,
  guard: 11,
  quick: 0,
  steps: 5,
  attack: 3,
};

function fight() {
  // Quick 25: the party member always acts first, whatever the seed rolls.
  const character = makeCharacter({ stats: { might: 2, quick: 25, clever: 3, heart: 5 } });
  const ctx: EncounterContext = {
    rules: { version: 1 } as unknown as RulesContent,
    abilities: {},
    rng: makeRng("grid-test"),
  };
  return beginEncounter(
    {
      board: parseBoard(["....", ".#..", "....", "...."]),
      party: [{ character, at: { x: 0, y: 0 } }],
      enemies: [{ spec: WISP, at: { x: 3, y: 3 } }],
    },
    ctx,
  );
}

describe("gridCells", () => {
  it("marks exactly the offered tiles tappable — nothing self-derived", () => {
    const encounter = fight();
    const moves = legalMoves(encounter);
    const cells = gridCells(encounter, [makeMember()], moves, []);

    expect(cells).toHaveLength(16);
    const tappable = cells.filter((c) => c.tappable).map((c) => `${c.x},${c.y}`);
    expect(tappable.sort()).toEqual(moves.map((m) => `${m.x},${m.y}`).sort());
    // The wall and the occupied tiles were never offered.
    expect(tappable).not.toContain("1,1");
    expect(tappable).not.toContain("0,0");
    expect(tappable).not.toContain("3,3");
  });

  it("carries occupants by shape: species icon, foe glyph, active ring, wall", () => {
    const encounter = fight();
    const cells = gridCells(encounter, [makeMember()], [], []);
    const at = (x: number, y: number) => cells.find((c) => c.x === x && c.y === y);

    expect(at(1, 1)?.blocked).toBe(true);
    expect(at(0, 0)?.occupant).toMatchObject({ side: "party", icon: "unicorn", active: true });
    expect(at(3, 3)?.occupant).toMatchObject({
      side: "enemy",
      icon: "swords",
      active: false,
      name: "Bramblewisp 1",
    });
    expect(at(0, 0)?.occupant?.id).toBe(currentActorId(encounter));
  });

  it("flags the selected tile", () => {
    const encounter = fight();
    const cells = gridCells(encounter, [makeMember()], [], [{ x: 2, y: 2 }]);
    expect(cells.find((c) => c.x === 2 && c.y === 2)?.selected).toBe(true);
    expect(cells.filter((c) => c.selected)).toHaveLength(1);
  });
});

describe("combatantLabel", () => {
  it("keeps party names and numbers the monsters", () => {
    const encounter = fight();
    const hero = encounter.combatants.find((c) => c.side === "party");
    const wisp = encounter.combatants.find((c) => c.side === "enemy");
    expect(combatantLabel(hero!)).toBe("Sparklehoof");
    // Three wisps are all "Bramblewisp"; the placement ordinal is what makes
    // "which one am I about to hit" answerable on a target button.
    expect(combatantLabel(wisp!)).toBe("Bramblewisp 1");
  });
});

describe("turnKey", () => {
  it("changes when the question changes — a move must clear a stale selection", () => {
    const encounter = fight();
    const before = turnKey(encounter);
    const moved = moveTo(encounter, { x: 1, y: 0 });
    expect(moved.ok).toBe(true);
    if (moved.ok) expect(turnKey(moved.state)).not.toBe(before);
    expect(turnKey(null)).toBe("none");
  });
});

describe("the environment's marks (#201)", () => {
  it("marks hazard, exit and captive squares — and nothing in an ordinary fight", () => {
    const character = makeCharacter({ stats: { might: 2, quick: 25, clever: 3, heart: 5 } });
    const ctx: EncounterContext = { rules: { version: 1 } as unknown as RulesContent, abilities: {}, rng: makeRng("grid-env") };
    const encounter = beginEncounter(
      {
        board: parseBoard(["....", "....", "....", "...."]),
        party: [{ character, at: { x: 0, y: 0 } }],
        enemies: [{ spec: WISP, at: { x: 3, y: 3 } }],
        environment: {
          hazards: [{ id: "fire", kind: "fire", label: "Rift fire", tiles: [{ x: 1, y: 1 }], damage: 1 }],
          exits: [{ id: "tear", label: "The tear", tiles: [{ x: 3, y: 0 }], opensRound: 2 }],
          rescue: { name: "Pip", at: { x: 0, y: 3 } },
        },
      },
      ctx,
    );
    const cells = gridCells(encounter, [makeMember()], legalMoves(encounter), []);
    const at = (x: number, y: number) => cells.find((c) => c.x === x && c.y === y)!;
    expect(at(1, 1).feature).toEqual({ kind: "hazard", label: "Rift fire", icon: "flame", active: true });
    expect(at(3, 0).feature).toMatchObject({ kind: "exit", active: false });
    expect(at(0, 3)).toMatchObject({ blocked: true, feature: { kind: "captive", label: "Pip" } });
    expect(cells.filter((c) => c.feature)).toHaveLength(3);
    expect(gridCells(fight(), [makeMember()], [], []).some((c) => "feature" in c)).toBe(false);
  });
});


it("resolves a cast opponent's shipped figure instead of an entities/cast placeholder", () => {
  const chapter = { scenes: { finale: { type: "encounter", enemies: [{ id: "corvane", art: "cast/deep-ice-figure" }] } } } as unknown as Chapter;
  expect(enemyPortraitUrl(chapter, "finale", "corvane#1")).toBe("/assets/cast/deep-ice-figure/assembled.png");
});
