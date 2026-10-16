/**
 * Which square the TV board marks as what, round by round (#201 follow-up).
 *
 * The overlay is decided here and only stroked by board.ts, so these are the
 * promises: every part of the environment is on the board in the state the
 * rules say it is in this round — read through the shared `environmentView`,
 * never re-derived — and a fight without one has no overlay at all.
 */

import { describe, expect, it } from "vitest";
import type { EncounterContext, EncounterEnvironment, EncounterState, EnemySpec, RulesContent } from "@kad/shared";
import { beginEncounter, makeRng, parseBoard } from "@kad/shared";
import { makeCharacter } from "../testing/fixtures";
import { dashedSquare, environmentOverlay, type OverlayTile } from "./environment-overlay";

const WISP: EnemySpec = { id: "wisp", name: "Bramblewisp", count: 1, hp: 6, guard: 11, quick: 0, steps: 5, attack: 3 };

function fight(environment?: EncounterEnvironment): EncounterState {
  const character = makeCharacter({ id: "c_1", stats: { might: 2, quick: 25, clever: 3, heart: 5 } });
  const ctx: EncounterContext = { rules: { version: 1 } as unknown as RulesContent, abilities: {}, rng: makeRng("overlay") };
  return beginEncounter(
    {
      board: parseBoard(["......", "......", "......", "......", "......", "......"]),
      party: [{ character, at: { x: 0, y: 0 } }],
      enemies: [{ spec: WISP, at: { x: 5, y: 5 } }],
      ...(environment ? { environment } : {}),
    },
    ctx,
  );
}

/** The same fight in a later round — the overlay reads nothing but the state. */
const inRound = (state: EncounterState, round: number): EncounterState => ({ ...state, round });

const at = (tiles: readonly OverlayTile[], x: number, y: number) => tiles.find((t) => t.x === x && t.y === y);

const FERRY: EncounterEnvironment = {
  clock: { rounds: 4, label: "The rift closes", onExpire: "collapse" },
  hazards: [
    { id: "fire", kind: "fire", label: "Rift fire", tiles: [{ x: 2, y: 2 }, { x: 3, y: 2 }], damage: 2 },
    { id: "thorns", kind: "thorns", label: "Thornbank", tiles: [{ x: 1, y: 4 }], damage: 1, fromRound: 2 },
    { id: "spark", kind: "rift", label: "Loose spark", tiles: [{ x: 4, y: 4 }], damage: 1, untilRound: 2 },
  ],
  exits: [{ id: "tear", label: "The tear", tiles: [{ x: 4, y: 0 }, { x: 5, y: 0 }], opensRound: 2, closesRound: 3 }],
  rescue: { name: "Pip", at: { x: 0, y: 5 } },
};

describe("a fight without an environment", () => {
  it("has no overlay at all", () => {
    expect(environmentOverlay(fight())).toBeNull();
  });
});

describe("the overlay, round by round", () => {
  it("marks every hazard square by kind, burning or not yet", () => {
    const { tiles } = environmentOverlay(fight(FERRY))!;
    expect(at(tiles, 2, 2)).toEqual({ x: 2, y: 2, kind: "hazard", glyph: "fire", state: "active", label: "Rift fire" });
    expect(at(tiles, 3, 2)).toMatchObject({ glyph: "fire", state: "active" });
    // Not before round 2: drawn, faint.
    expect(at(tiles, 1, 4)).toMatchObject({ kind: "hazard", glyph: "thorns", state: "pending" });
    expect(at(tiles, 4, 4)).toMatchObject({ glyph: "rift", state: "active" });

    const two = environmentOverlay(inRound(fight(FERRY), 2))!.tiles;
    expect(at(two, 1, 4)).toMatchObject({ state: "active" });
    expect(at(two, 4, 4)).toMatchObject({ state: "active" });

    // Burnt out after its last round: no longer a mark at all.
    const three = environmentOverlay(inRound(fight(FERRY), 3))!.tiles;
    expect(at(three, 4, 4)).toBeUndefined();
  });

  it("opens and shuts an exit on its rounds, counting down to each", () => {
    const exitIn = (round: number) => at(environmentOverlay(inRound(fight(FERRY), round))!.tiles, 4, 0);
    expect(exitIn(1)).toEqual({ x: 4, y: 0, kind: "exit", glyph: "exit", state: "pending", label: "The tear", count: 1 });
    // Open in rounds 2 and 3: the count is rounds left open, this one included.
    expect(exitIn(2)).toMatchObject({ state: "active", count: 2 });
    expect(exitIn(3)).toMatchObject({ state: "active", count: 1 });
    // Shut for good: still drawn (crossed out), counting nothing.
    expect(exitIn(4)).toMatchObject({ state: "gone" });
    expect(exitIn(4)).not.toHaveProperty("count");
    // Every tile of the exit says the same.
    expect(at(environmentOverlay(inRound(fight(FERRY), 2))!.tiles, 5, 0)).toMatchObject({ state: "active", count: 2 });
  });

  it("keeps an exit with no window open, and counts nothing on it", () => {
    const open = fight({ exits: [{ id: "door", label: "The door", tiles: [{ x: 5, y: 2 }] }] });
    expect(at(environmentOverlay(open)!.tiles, 5, 2)).toEqual({
      x: 5, y: 2, kind: "exit", glyph: "exit", state: "active", label: "The door",
    });
  });

  it("marks the captive waiting, freed or lost — and counts their rounds while waiting", () => {
    const waiting = fight(FERRY);
    // The captive's deadline is the clock's last round (4).
    expect(at(environmentOverlay(waiting)!.tiles, 0, 5)).toEqual({
      x: 0, y: 5, kind: "captive", glyph: "captive", state: "waiting", label: "Pip", count: 4,
    });
    expect(at(environmentOverlay(inRound(waiting, 4))!.tiles, 0, 5)).toMatchObject({ count: 1 });

    const freed: EncounterState = { ...waiting, environment: { ...waiting.environment!, rescue: "freed" } };
    expect(at(environmentOverlay(freed)!.tiles, 0, 5)).toEqual({
      x: 0, y: 5, kind: "captive", glyph: "captive", state: "freed", label: "Pip",
    });
    const lost: EncounterState = { ...waiting, environment: { ...waiting.environment!, rescue: "lost" } };
    expect(at(environmentOverlay(lost)!.tiles, 0, 5)).toMatchObject({ state: "lost" });
    expect(at(environmentOverlay(lost)!.tiles, 0, 5)).not.toHaveProperty("count");
  });

  it("counts nothing on a captive with no deadline", () => {
    const state = fight({ rescue: { name: "Pip", at: { x: 0, y: 5 } } });
    expect(at(environmentOverlay(state)!.tiles, 0, 5)).not.toHaveProperty("count");
  });

  it("lists squares in board order, one each, and keys exactly what is drawn", () => {
    const first = environmentOverlay(fight(FERRY))!;
    expect(first.tiles.map((t) => `${t.x},${t.y}`)).toEqual(["4,0", "5,0", "2,2", "3,2", "1,4", "4,4", "0,5"]);
    // Same round, same state: same key — the board does not redraw.
    expect(environmentOverlay(fight(FERRY))!.key).toBe(first.key);
    // A new round changes what is drawn, and the key with it.
    expect(environmentOverlay(inRound(fight(FERRY), 2))!.key).not.toBe(first.key);
  });

  it("gives the captive their square over anything a hand-built fight put there too", () => {
    const state = fight({
      hazards: [{ id: "fire", kind: "fire", label: "Fire", tiles: [{ x: 2, y: 2 }], damage: 1 }],
      exits: [{ id: "door", label: "Door", tiles: [{ x: 2, y: 2 }] }],
      rescue: { name: "Pip", at: { x: 2, y: 2 } },
    });
    const { tiles } = environmentOverlay(state)!;
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ kind: "captive" });
  });
});

describe("dashedSquare", () => {
  it("dashes all four sides evenly, inside the square", () => {
    const dashes = dashedSquare(0, 0, 100, 14, 8);
    // floor((100 + 8) / 22) = 4 per side.
    expect(dashes).toHaveLength(16);
    for (const d of dashes) {
      for (const v of [d.x1, d.y1, d.x2, d.y2]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
      expect(Math.hypot(d.x2 - d.x1, d.y2 - d.y1)).toBeCloseTo(14);
    }
    // Centred: the gap before the first dash equals the gap after the last.
    const top = dashes.slice(0, 4);
    expect(top[0]!.x1).toBeCloseTo(100 - top[3]!.x2);
  });
});
