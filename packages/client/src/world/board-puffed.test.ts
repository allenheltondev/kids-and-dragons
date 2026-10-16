// @vitest-environment jsdom
/**
 * A puffed-up enemy on the TV board (#227): the room reads PUFFED over its
 * head while it is puffed and not after, and the stung hero's Numbed has no
 * lasting mark on the board at all (that one lives on the player's phone).
 */

import { beforeAll, describe, expect, it } from "vitest";
import { Container, Text } from "pixi.js";
import { beginEncounter, parseBoard } from "@kad/shared";
import type { EncounterState, PartyMember, ResolvedCharacter } from "@kad/shared";
import { makeRules } from "../../../shared/src/test-fixtures";
import { installFakeCanvas2D } from "../testing/fake-stage";
import { makeCharacter, makeMember } from "../testing/fixtures";
import { createBoardLayer } from "./board";
import type { BoardViewState } from "./board";

beforeAll(installFakeCanvas2D);

const HEROES: ResolvedCharacter[] = [makeCharacter({ id: "c_1", name: "Sparklehoof", stats: { might: 2, quick: 9, clever: 3, heart: 5 } })];
const party = (): PartyMember[] => HEROES.map((character) => makeMember({ character, playerId: `p_${character.id}` }));

function fight(): EncounterState {
  return beginEncounter(
    {
      board: parseBoard(Array.from({ length: 5 }, () => ".".repeat(8))),
      party: [{ character: HEROES[0]!, at: { x: 1, y: 2 } }],
      enemies: [
        {
          spec: { id: "skupper", name: "Skupper", count: 1, hp: 6, guard: 11, quick: 0, steps: 4, attack: 3, retaliation: { slow: { steps: 2, turns: 2 } } },
          at: { x: 5, y: 2 },
        },
      ],
    },
    { rules: makeRules(), abilities: {}, rng: { next: () => 0.5 } },
  );
}

const withPuff = (state: EncounterState, puffed: number | undefined): EncounterState => ({
  ...state,
  combatants: state.combatants.map((c) => (c.id === "skupper#1" ? { ...c, ...(puffed === undefined ? {} : { puffed }) } : c)),
});

const view = (encounter: EncounterState): BoardViewState => ({ encounter, biome: null, enemyArt: {}, party: party() });

const texts = (root: Container): string[] => {
  const out: string[] = [];
  const walk = (node: Container): void => {
    if (node.destroyed) return;
    if (node instanceof Text) out.push(node.text);
    for (const child of node.children) walk(child as Container);
  };
  walk(root);
  return out;
};

describe("the board", () => {
  it("writes PUFFED over a puffed enemy, and takes it down when it deflates", () => {
    const layer = createBoardLayer();
    layer.update(view(fight()));
    expect(texts(layer.container)).not.toContain("PUFFED");
    layer.update(view(withPuff(fight(), 2)));
    expect(texts(layer.container).filter((t) => t === "PUFFED")).toHaveLength(1);
    // Patched again while still puffed: still one, not two.
    layer.update(view(withPuff(fight(), 1)));
    expect(texts(layer.container).filter((t) => t === "PUFFED")).toHaveLength(1);
    layer.update(view(withPuff(fight(), undefined)));
    expect(texts(layer.container)).not.toContain("PUFFED");
  });

  it("draws no lasting Numbed mark on a stung hero", () => {
    const layer = createBoardLayer();
    const stung: EncounterState = {
      ...fight(),
      buffs: [{ id: "numbed", label: "Numbed", kind: "move", heroId: "c_1", amount: -2, turnsLeft: 2 }],
    };
    layer.update(view(stung));
    for (let i = 0; i < 30; i++) layer.tick(1 / 60);
    expect(texts(layer.container).some((t) => /numbed/i.test(t))).toBe(false);
  });
});
