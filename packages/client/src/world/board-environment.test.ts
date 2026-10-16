// @vitest-environment jsdom
/**
 * The TV board in a fight where the place fights back (#201 follow-up), and —
 * first, because it is the promise everything else rests on — the TV board in
 * a fight where it does not.
 *
 * Runs a real `BoardLayer` on the renderer-free stage, like board.test.ts.
 */

import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { Container, Graphics, Text } from "pixi.js";
import { beginEncounter, parseBoard, resolveEnemy } from "@kad/shared";
import type {
  AuthoredEnemySpec,
  Bestiary,
  EncounterEnvironment,
  EncounterScene,
  EncounterState,
  EnemyPlacement,
  PartyMember,
  ResolvedCharacter,
} from "@kad/shared";
import { makeRules } from "../../../shared/src/test-fixtures";
import { installFakeCanvas2D } from "../testing/fake-stage";
import { makeCharacter, makeMember } from "../testing/fixtures";
import { BOARD_TILE_PX, createBoardLayer, walkRoutes } from "./board";
import type { BoardLayer, BoardViewState } from "./board";
import gemfall02 from "../../../../content/chapters/gemfall-02.json";
import roadside from "../../../../content/maps/roadside.json";
import bestiary from "../../../../content/bestiary.json";

beforeAll(installFakeCanvas2D);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HEROES: ResolvedCharacter[] = [
  makeCharacter({ id: "c_1", name: "Sparklehoof", stats: { might: 2, quick: 9, clever: 3, heart: 5 } }),
  makeCharacter({ id: "c_2", name: "Thistle", stats: { might: 3, quick: 2, clever: 1, heart: 2 } }),
];

function members(chars: readonly ResolvedCharacter[]): PartyMember[] {
  return chars.map((character) => makeMember({ character, playerId: `p_${character.id}` }));
}

/**
 * Gemfall's second chapter's wolf fight, on its own map, exactly as authored:
 * the fixture for "a fight without an environment draws what it always drew".
 */
function gemfallFight(): EncounterState {
  const scene = (gemfall02 as unknown as { scenes: Record<string, EncounterScene> }).scenes["encounter_wolves"]!;
  expect(scene.environment).toBeUndefined();
  const enemies: EnemyPlacement[] = [];
  for (const authored of scene.enemies) {
    const { spec } = resolveEnemy(authored as AuthoredEnemySpec, bestiary as unknown as Bestiary);
    for (let n = 0; n < spec!.count; n++) enemies.push({ spec: spec!, at: roadside.enemySpawns[enemies.length]! });
  }
  return beginEncounter(
    {
      board: parseBoard(roadside.rows),
      party: HEROES.map((character, i) => ({ character, at: roadside.partySpawns[i]! })),
      enemies,
    },
    { rules: makeRules(), abilities: {}, rng: { next: () => 0.5 } },
  );
}

function viewOf(encounter: EncounterState): BoardViewState {
  return { encounter, biome: null, enemyArt: {}, party: members(HEROES) };
}

/**
 * Everything the board drew, as text: every node's kind, name, place,
 * visibility and — for a `Graphics` — every drawing instruction it holds.
 * Two boards with the same signature draw the same picture.
 */
function signature(layer: BoardLayer): string {
  const lines: string[] = [];
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const walk = (node: Container, depth: number): void => {
    if (node.destroyed) return;
    const pad = "  ".repeat(depth);
    let detail = "";
    if (node instanceof Text) detail = ` text=${JSON.stringify(node.text)}`;
    if (node instanceof Graphics) {
      const b = node.context.bounds;
      const styled = node.context.instructions.map((i) => {
        const style = (i.data as { style?: { color?: number; alpha?: number; width?: number } }).style;
        return [i.action, style?.color, round(style?.alpha ?? 1), style?.width ?? null];
      });
      detail = ` box=${[b.minX, b.minY, b.maxX, b.maxY].map(round).join(",")} draw=${JSON.stringify(styled)}`;
    }
    lines.push(
      `${pad}${node.constructor.name}${node.label ? `#${node.label}` : ""} @${round(node.x)},${round(node.y)} ` +
        `v=${node.visible} a=${round(node.alpha)} z=${round(node.zIndex)}${detail}`,
    );
    for (const child of node.children) walk(child as Container, depth + 1);
  };
  walk(layer.container, 0);
  return lines.join("\n");
}

/** Draw the fight and play a second of frames. */
function drawn(encounter: EncounterState): BoardLayer {
  const layer = createBoardLayer();
  layer.update(viewOf(encounter));
  for (let i = 0; i < 60; i++) layer.tick(1 / 60);
  return layer;
}

// ---------------------------------------------------------------------------
// Zero change without an environment
// ---------------------------------------------------------------------------

describe("a fight without an environment", () => {
  /**
   * The digest of the Gemfall wolf fight's scene graph as the board drew it
   * before the environment overlay existed (taken on the #201 merge, before
   * any of this file's subject was written). A change here means an ordinary
   * fight now draws something it did not.
   */
  const GOLDEN = "ae0fe5a40d98238a0ddf3aac18dddc230835c3ca2a9a9252f379a73669dfff1d";

  it("draws exactly what it drew before the overlay existed (Gemfall's wolves)", () => {
    const layer = drawn(gemfallFight());
    const digest = createHash("sha256").update(signature(layer)).digest("hex");
    expect(digest).toBe(GOLDEN);
    expect(envLayerOf(layer)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A fight with one
// ---------------------------------------------------------------------------

const WISP = { id: "wisp", name: "Bramblewisp", count: 1, hp: 6, guard: 11, quick: 0, steps: 5, attack: 3 };

const FERRY: EncounterEnvironment = {
  clock: { rounds: 4, label: "The rift closes", onExpire: "collapse" },
  hazards: [{ id: "fire", kind: "fire", label: "Rift fire", tiles: [{ x: 3, y: 2 }, { x: 3, y: 3 }], damage: 2 }],
  exits: [{ id: "tear", label: "The tear", tiles: [{ x: 4, y: 0 }], opensRound: 2, closesRound: 3 }],
  rescue: { name: "Pip", at: { x: 1, y: 7 } },
};

/** One hero at (0,0), one wisp at (9,7), on an open 10 × 8 board. */
function riftFight(environment: EncounterEnvironment | null = FERRY): EncounterState {
  return beginEncounter(
    {
      board: parseBoard(Array.from({ length: 8 }, () => "..........")),
      party: [{ character: HEROES[0]!, at: { x: 0, y: 0 } }],
      enemies: [{ spec: WISP, at: { x: 9, y: 7 } }],
      ...(environment ? { environment } : {}),
    },
    { rules: makeRules(), abilities: {}, rng: { next: () => 0.5 } },
  );
}

/** Every node of the tree, flattened. */
function nodes(layer: BoardLayer): Container[] {
  const out: Container[] = [];
  const walk = (node: Container): void => {
    if (node.destroyed) return;
    out.push(node);
    for (const child of node.children) walk(child as Container);
  };
  walk(layer.container);
  return out;
}

function envLayerOf(layer: BoardLayer): Container | null {
  return nodes(layer).find((n) => n.label === "environment") ?? null;
}

const textsIn = (node: Container): string[] =>
  node.children.filter((c): c is Text => c instanceof Text).map((t) => t.text);

/** Where each figure's feet are drawn, in the actors layer's order. */
function figures(layer: BoardLayer): { x: number; y: number }[] {
  const actorsLayer = layer.container.children.find((c) => c.sortableChildren) as Container;
  return actorsLayer.children.filter((c) => !(c instanceof Graphics)).map((c) => ({ x: c.x, y: c.y }));
}

describe("a fight with an environment", () => {
  it("draws the overlay over the floor and under the reach, with its counts", () => {
    const layer = drawn(riftFight());
    const env = envLayerOf(layer);
    expect(env).not.toBeNull();
    // Straight after the floor: ground, not furniture.
    expect(layer.container.children.indexOf(env!)).toBe(1);
    expect(layer.container.children).toHaveLength(7);
    // The exit opens next round; Pip has four rounds.
    expect(textsIn(env!).sort()).toEqual(["1", "4"]);
    expect(env!.children[0]).toBeInstanceOf(Graphics);
  });

  it("redraws only when what it shows changes", () => {
    const encounter = riftFight();
    const layer = drawn(encounter);
    const before = envLayerOf(layer)!.children[0]!;
    layer.update(viewOf(encounter));
    expect(envLayerOf(layer)!.children[0]).toBe(before);

    // Next round: the exit opens (two rounds to go through it) and Pip's
    // count drops.
    layer.update(viewOf({ ...encounter, round: 2 }));
    const env = envLayerOf(layer)!;
    expect(env.children[0]).not.toBe(before);
    expect(before.destroyed).toBe(true);
    expect(textsIn(env).sort()).toEqual(["2", "3"]);
  });

  it("takes the overlay down when the next fight has none", () => {
    const layer = drawn(riftFight());
    expect(envLayerOf(layer)).not.toBeNull();
    layer.update(viewOf(gemfallFight()));
    expect(envLayerOf(layer)).toBeNull();
    expect(layer.container.children).toHaveLength(6);
  });

  it("builds no overlay for an ordinary fight, on any board", () => {
    const layer = drawn(riftFight(null));
    expect(envLayerOf(layer)).toBeNull();
    expect(layer.container.children).toHaveLength(6);
  });
});

describe("the place's beats on the board", () => {
  it("fades a hero who steps through an exit, then lets the patch take them off", () => {
    const encounter = { ...riftFight(), round: 2 };
    const layer = drawn(encounter);
    const name = () => nodes(layer).find((n): n is Text => n instanceof Text && n.text === "Sparklehoof");
    expect(name()!.alpha).toBe(1);

    layer.playEvents([{ type: "escaped", actorId: "c_1", exitId: "tear" }], 400);
    for (let i = 0; i < 60; i++) layer.tick(1 / 60);
    expect(name()!.alpha).toBeLessThan(0.05);

    // The patch: off the board, out of the turn order.
    const through: EncounterState = {
      ...encounter,
      board: { ...encounter.board, actors: encounter.board.actors.filter((a) => a.id !== "c_1") },
      combatants: encounter.combatants.map((c) => (c.id === "c_1" ? { ...c, escaped: true as const } : c)),
    };
    layer.update(viewOf(through));
    layer.tick(1 / 60);
    expect(name()).toBeUndefined();
    expect(layer.nameplateBoxes()).toHaveLength(0);
    expect(figures(layer)).toHaveLength(1);
  });

  it("slides a monster the rift throws to where it lands", () => {
    const layer = drawn(riftFight());
    expect(figures(layer)).toContainEqual({ x: 9.5 * BOARD_TILE_PX, y: (7 + 0.82) * BOARD_TILE_PX });
    layer.playEvents([{ type: "relocated", actorId: "wisp#1", to: { x: 5, y: 1 } }], 400);
    for (let i = 0; i < 240; i++) layer.tick(1 / 60);
    const wisp = figures(layer).find((f) => f.x > BOARD_TILE_PX * 2)!;
    expect(wisp.x).toBeCloseTo(5.5 * BOARD_TILE_PX, 0);
    expect(wisp.y).toBeCloseTo((1 + 0.82) * BOARD_TILE_PX, 0);
    // A throw is not a walk: no footprints.
    expect(layer.trailMarks()).toHaveLength(0);
  });

  it("says over the captive's square that they are free, or lost", () => {
    const layer = drawn(riftFight());
    layer.playEvents([{ type: "freed", byId: "c_1" }, { type: "captiveLost" }], 400);
    layer.tick(0.2);
    layer.tick(0.2);
    const floating = nodes(layer).filter((n): n is Text => n instanceof Text).map((t) => t.text);
    expect(floating).toContain("Free!");
    expect(floating).toContain("Lost");
  });

  it("routes walks after a throw and an escape from where those left the board", () => {
    const encounter = riftFight();
    const routes = walkRoutes(encounter.board, [
      { type: "escaped", actorId: "c_1", exitId: "tear" },
      { type: "relocated", actorId: "wisp#1", to: { x: 1, y: 1 } },
      // The wisp walks from where the rift put it, onto the square the hero left.
      { type: "moved", actorId: "wisp#1", to: { x: 0, y: 0 } },
    ]);
    expect(routes[0]).toBeUndefined();
    expect(routes[1]).toBeUndefined();
    expect(routes[2]).toEqual([{ x: 1, y: 1 }, { x: 0, y: 0 }]);
  });
});
