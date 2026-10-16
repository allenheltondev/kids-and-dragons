/**
 * What the TV board draws for the place fighting back (#201): hazard ground,
 * rift exits and the captive, square by square.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN FILE
 *
 * The board-math.ts rule: the renderer's decisions are pure and testable
 * without pixi.js, and board.ts only turns them into strokes. Everything about
 * *which* square is marked *as what* in *which* round is decided here, from
 * `environmentView` — the one shared reading of `EncounterState.environment`
 * the phones' grid already draws from (screens/combat-grid.ts). So "is this
 * exit open in round 3" is answered once, in @kad/shared, and the TV and the
 * phone in a child's hand can never disagree about it.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE TV SHOWS THAT THE PHONE DOES NOT
 *
 * The phone marks only what can still matter to the tap it is about to make:
 * an exit that has shut for good and a captive who is free (or lost) drop off
 * its grid. The TV is the room's record of the fight, so it keeps them — an
 * exit that closed is drawn crossed out, a freed captive's square keeps an
 * uncaged heart, a lost one a broken outline — which is how a table that was
 * looking at each other learns what just happened. A hazard that has burnt out
 * for good is the exception: ground that no longer hurts is just ground.
 *
 * Every state differs in *shape* (spec §11): the hazard kinds are a flame, a
 * thorn and a spark, exits wear a doubled border and an arrow, the captive a
 * heart behind bars; "not yet" is drawn faint and dashed, "closed" crossed.
 * The numbers on a square count rounds — until an exit opens, until it shuts,
 * until the captive is lost — and say so in RiftStatus's words beside them.
 *
 * ---------------------------------------------------------------------------
 * ZERO CHANGE WITHOUT AN ENVIRONMENT
 *
 * `environmentOverlay` answers null for a fight with no `environment`, and the
 * board builds no layer at all for a null — so a Gemfall fight's scene graph
 * is the one it always was, node for node (board-environment.test.ts pins it
 * by digest).
 */

import type { EncounterState, MapTile } from "@kad/shared";
import { environmentView } from "@kad/shared";

/** The shape a square is marked with. One per kind of thing, never a colour. */
export type OverlayGlyph = "fire" | "thorns" | "rift" | "exit" | "captive";

/**
 * - `active`: a hazard burning this round, an exit open this round.
 * - `pending`: a hazard not yet burning, an exit not yet open — drawn faint.
 * - `gone`: an exit closed for good — drawn faint and crossed.
 * - `waiting` / `freed` / `lost`: the captive.
 */
export type OverlayState = "active" | "pending" | "gone" | "waiting" | "freed" | "lost";

export interface OverlayTile {
  readonly x: number;
  readonly y: number;
  readonly kind: "hazard" | "exit" | "captive";
  readonly glyph: OverlayGlyph;
  readonly state: OverlayState;
  /** The authored label, or the captive's name. */
  readonly label: string;
  /**
   * Rounds to count down on the square, counting this one: until a pending
   * exit opens, until an open one shuts, until a waiting captive is lost.
   * Absent when nothing is counting.
   */
  readonly count?: number;
}

export interface EnvironmentOverlay {
  /** Row-major, one per marked square. */
  readonly tiles: readonly OverlayTile[];
  /**
   * Changes exactly when the drawing would: the board redraws on a new key
   * and leaves the layer alone otherwise, the same "build only on change"
   * discipline the tiles and the reach follow.
   */
  readonly key: string;
}

/**
 * Every marked square of the fight's environment, or null without one.
 *
 * One mark per square — the authoring check never lets two parts share one;
 * should a hand-built fight do it anyway, the captive outranks an exit, which
 * outranks a hazard, the order the phone's grid resolves it in.
 */
export function environmentOverlay(encounter: EncounterState): EnvironmentOverlay | null {
  const view = environmentView(encounter);
  if (!view) return null;
  const marks = new Map<string, OverlayTile>();
  const mark = (at: MapTile, tile: Omit<OverlayTile, "x" | "y">): void => {
    marks.set(`${at.x},${at.y}`, { x: at.x, y: at.y, ...tile });
  };

  for (const hazard of view.hazards) {
    if (hazard.gone) continue;
    for (const at of hazard.tiles) {
      mark(at, {
        kind: "hazard",
        glyph: hazard.kind,
        state: hazard.active ? "active" : "pending",
        label: hazard.label,
      });
    }
  }

  for (const exit of view.exits) {
    const state: OverlayState = exit.open ? "active" : exit.gone ? "gone" : "pending";
    const count = exit.open ? exit.closesIn : exit.gone ? undefined : exit.opensIn;
    for (const at of exit.tiles) {
      mark(at, { kind: "exit", glyph: "exit", state, label: exit.label, ...(count !== undefined ? { count } : {}) });
    }
  }

  if (view.rescue) {
    const { at, name, status, roundsLeft } = view.rescue;
    mark(at, {
      kind: "captive",
      glyph: "captive",
      state: status,
      label: name,
      ...(status === "waiting" && roundsLeft !== undefined ? { count: roundsLeft } : {}),
    });
  }

  const tiles = [...marks.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  const key = tiles.map((t) => `${t.x},${t.y}:${t.glyph}:${t.state}:${t.count ?? ""}`).join("|");
  return { tiles, key };
}

/**
 * The dashes of a dashed square outline, as line segments — Pixi draws solid
 * strokes only. Each side is dashed on its own and centred, so the corners of
 * every hazard square read the same however the tile size divides.
 */
export function dashedSquare(
  x: number,
  y: number,
  size: number,
  dash: number,
  gap: number,
): { x1: number; y1: number; x2: number; y2: number }[] {
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const count = Math.max(1, Math.floor((size + gap) / (dash + gap)));
  const used = count * dash + (count - 1) * gap;
  const start = (size - used) / 2;
  const sides: [number, number, number, number][] = [
    [x, y, 1, 0],
    [x + size, y, 0, 1],
    [x + size, y + size, -1, 0],
    [x, y + size, 0, -1],
  ];
  for (const [sx, sy, dx, dy] of sides) {
    for (let i = 0; i < count; i++) {
      const a = start + i * (dash + gap);
      out.push({ x1: sx + dx * a, y1: sy + dy * a, x2: sx + dx * (a + dash), y2: sy + dy * (a + dash) });
    }
  }
  return out;
}
