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
  EncounterScene,
  EncounterState,
  EnemyPlacement,
  PartyMember,
  ResolvedCharacter,
} from "@kad/shared";
import { makeRules } from "../../../shared/src/test-fixtures";
import { installFakeCanvas2D } from "../testing/fake-stage";
import { makeCharacter, makeMember } from "../testing/fixtures";
import { createBoardLayer } from "./board";
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
  });
});
