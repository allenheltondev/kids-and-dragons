import { describe, expect, it } from "vitest";

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  actorAt,
  actorsAdjacentTo,
  adjacentTiles,
  areAdjacent,
  createBoard,
  findPath,
  isOpen,
  moveActor,
  parseBoard,
  placeActor,
  reachableTiles,
  removeActor,
  setTerrain,
  stepsBetween,
  terrainAt,
  tilesWithinSteps,
} from "./grid.js";
import type { Actor, Board, Position } from "./grid.js";

/**
 * A U-shaped map: two dead-end columns joined only along the bottom row. Two
 * tiles that are visibly two steps apart are a four-step walk, which is what
 * separates range ("within N steps") from movement in every test below.
 *
 *   x  01234
 *   y0 #####
 *   y1 #.#.#
 *   y2 #.#.#
 *   y3 #...#
 *   y4 #####
 */
const U_MAP = ["#####", "#.#.#", "#.#.#", "#...#", "#####"] as const;

const TOP_LEFT: Position = { x: 1, y: 1 };
const TOP_RIGHT: Position = { x: 3, y: 1 };
/** The one tile on the left column that every route out of TOP_LEFT crosses. */
const CHOKE: Position = { x: 1, y: 2 };

function uBoard(...actors: readonly Actor[]): Board {
  return actors.reduce(placeActor, parseBoard([...U_MAP]));
}

function ally(at: Position): Actor {
  return { id: "c_ally", side: "party", x: at.x, y: at.y };
}

function enemy(at: Position): Actor {
  return { id: "e_1", side: "enemy", x: at.x, y: at.y };
}

function hero(at: Position): Actor {
  return { id: "c_hero", side: "party", x: at.x, y: at.y };
}

function has(tiles: readonly Position[], at: Position): boolean {
  return tiles.some((t) => t.x === at.x && t.y === at.y);
}

describe("the board", () => {
  it("is 10 x 8 — spec §7.1", () => {
    // Not a taste call: §2.2 auto-frames *this* board on a phone and the art
    // brief cuts tile sets to it. Changing it here silently changes both.
    expect([BOARD_WIDTH, BOARD_HEIGHT]).toEqual([10, 8]);
    const board = createBoard();
    expect(board.terrain).toHaveLength(80);
    expect(board.terrain.every((t) => t === "open")).toBe(true);
    expect(board.actors).toEqual([]);
  });

  it("treats everything off the edge as wall, so no loop needs its own bounds check", () => {
    const board = createBoard();
    expect(terrainAt(board, { x: -1, y: 0 })).toBe("blocked");
    expect(terrainAt(board, { x: 10, y: 0 })).toBe("blocked");
    expect(terrainAt(board, { x: 0, y: 8 })).toBe("blocked");
    expect(terrainAt(board, { x: 9, y: 7 })).toBe("open");
  });

  it("reads an ASCII sketch row by row, top row first", () => {
    const board = parseBoard(["..#", "#.."]);
    expect([board.width, board.height]).toEqual([3, 2]);
    expect(terrainAt(board, { x: 2, y: 0 })).toBe("blocked");
    expect(terrainAt(board, { x: 0, y: 1 })).toBe("blocked");
    expect(terrainAt(board, { x: 0, y: 0 })).toBe("open");
  });

  it("rejects a ragged or mistyped sketch instead of guessing at it", () => {
    // A map one character short would otherwise shear every row below it and
    // produce walls nobody authored.
    expect(() => parseBoard(["...", ".."])).toThrow(/row 1/);
    expect(() => parseBoard(["..x"])).toThrow(/unknown map character/);
  });
});

describe("placing and moving actors", () => {
  it("never mutates the board it was handed", () => {
    // The engine keeps prior states for replay (architecture §4.3); an
    // in-place edit here would rewrite history that has already been sent.
    const before = createBoard(4, 4);
    const snapshot = JSON.stringify(before);
    const placed = placeActor(before, hero({ x: 1, y: 1 }));
    const moved = moveActor(placed, "c_hero", { x: 2, y: 2 });
    const walled = setTerrain(moved, { x: 0, y: 0 }, "blocked");
    removeActor(walled, "c_hero");

    expect(JSON.stringify(before)).toBe(snapshot);
    expect(actorAt(placed, { x: 1, y: 1 })?.id).toBe("c_hero");
    expect(actorAt(moved, { x: 1, y: 1 })).toBeNull();
    expect(actorAt(moved, { x: 2, y: 2 })?.id).toBe("c_hero");
  });

  it("refuses to stack two actors on one tile", () => {
    const board = placeActor(createBoard(4, 4), hero({ x: 1, y: 1 }));
    expect(() => placeActor(board, ally({ x: 1, y: 1 }))).toThrow(/not open/);
    expect(() => placeActor(board, hero({ x: 2, y: 2 }))).toThrow(/already on the board/);
    expect(() => moveActor(placeActor(board, ally({ x: 3, y: 3 })), "c_ally", { x: 1, y: 1 })).toThrow(
      /not open/,
    );
  });

  it("refuses to grow a wall under somebody", () => {
    // Bramble Wall targets tiles; walling in the tile an actor stands on would
    // leave them on a square they can walk off but never walk back onto.
    const board = placeActor(createBoard(4, 4), hero({ x: 1, y: 1 }));
    expect(() => setTerrain(board, { x: 1, y: 1 }, "blocked")).toThrow(/standing on it/);
    expect(terrainAt(setTerrain(board, { x: 2, y: 2 }, "blocked"), { x: 2, y: 2 })).toBe("blocked");
  });
});

describe("distance and adjacency", () => {
  it("counts a diagonal as one step — spec §7.1", () => {
    // A Manhattan distance would say 6 here and quietly double the cost of
    // every diagonal move on the board.
    expect(stepsBetween({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(3);
    expect(stepsBetween({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3);
    expect(stepsBetween({ x: 4, y: 4 }, { x: 4, y: 4 })).toBe(0);
  });

  it("counts a diagonal neighbour as 'standing next to you'", () => {
    // Help Up and Brace are worded that way (§7.2). With 4-way adjacency an
    // ally lying diagonally would be visibly touching you and un-helpable.
    expect(areAdjacent({ x: 2, y: 2 }, { x: 3, y: 3 })).toBe(true);
    expect(areAdjacent({ x: 2, y: 2 }, { x: 2, y: 3 })).toBe(true);
    expect(areAdjacent({ x: 2, y: 2 }, { x: 4, y: 2 })).toBe(false);
    expect(areAdjacent({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(false);
  });

  it("measures range straight across the board, ignoring walls", () => {
    // Glide "sails over anything in your way"; a child checks range by
    // counting tiles between two figures, not by tracing a route. The same two
    // tiles are a four-step *walk* — see the pathfinding tests.
    expect(stepsBetween(TOP_LEFT, TOP_RIGHT)).toBe(2);
  });

  it("clips the eight neighbours to the board at a corner", () => {
    const board = createBoard();
    expect(adjacentTiles(board, { x: 0, y: 0 })).toHaveLength(3);
    expect(adjacentTiles(board, { x: 4, y: 4 })).toHaveLength(8);
    expect(adjacentTiles(board, { x: 9, y: 7 })).toHaveLength(3);
  });

  it("lists everyone within 6 steps without filtering terrain", () => {
    // "Any open tile within 6 steps" (Leap, Glide) is two questions: what is in
    // range, and which of those is open. This helper answers only the first.
    const board = setTerrain(createBoard(), { x: 3, y: 3 }, "blocked");
    const tiles = tilesWithinSteps(board, { x: 0, y: 0 }, 6);
    expect(tiles).toHaveLength(48); // 7 x 7 square clipped to the board, less the origin
    expect(has(tiles, { x: 3, y: 3 })).toBe(true);
    expect(has(tiles, { x: 0, y: 0 })).toBe(false);
    expect(has(tiles, { x: 7, y: 0 })).toBe(false);
    expect(tilesWithinSteps(board, { x: 0, y: 0 }, 0)).toEqual([]);
  });

  it("finds the allies standing next to a fallen character", () => {
    const board = uBoard(hero(TOP_LEFT), ally(CHOKE));
    expect(actorsAdjacentTo(board, TOP_LEFT).map((a) => a.id)).toEqual(["c_ally"]);
    expect(actorsAdjacentTo(board, TOP_RIGHT)).toEqual([]);
  });
});

describe("reachableTiles", () => {
  it("highlights a square, not a diamond, because diagonals cost 1", () => {
    // 4-directional movement would reach 41 tiles and would never offer the
    // far corner at all.
    const tiles = reachableTiles(createBoard(), { x: 4, y: 3 }, 4);
    expect(tiles).toHaveLength(71); // x 0..8 by y 0..7, less the origin
    expect(tiles).toContainEqual({ x: 8, y: 7, cost: 4 });
    expect(tiles).toContainEqual({ x: 5, y: 3, cost: 1 });
  });

  it("never offers the tile you are standing on", () => {
    // Staying put is always legal; a "move here" highlight under her own feet
    // reads as a move that does nothing.
    const from = { x: 4, y: 3 };
    expect(has(reachableTiles(createBoard(), from, 4), from)).toBe(false);
  });

  it("offers nothing at zero steps, or at a nonsense allowance", () => {
    // A knocked-down actor and a rooted one both come through here as 0.
    const board = createBoard();
    expect(reachableTiles(board, { x: 4, y: 3 }, 0)).toEqual([]);
    expect(reachableTiles(board, { x: 4, y: 3 }, -2)).toEqual([]);
    expect(reachableTiles(board, { x: 4, y: 3 }, Number.NaN)).toEqual([]);
    expect(reachableTiles(board, { x: 99, y: 99 }, 4)).toEqual([]);
  });

  it("offers nothing to an actor walled in on all sides", () => {
    // The empty highlight is the whole UI here: §7.2 says illegal moves are
    // never presented, so "no move" has to be a legal answer, not a crash.
    const board = placeActor(parseBoard(["###", "#.#", "###"]), hero({ x: 1, y: 1 }));
    expect(reachableTiles(board, { x: 1, y: 1 }, 6)).toEqual([]);
  });

  it("only ever offers open tiles", () => {
    const board = uBoard(hero(TOP_LEFT), ally(CHOKE));
    for (const tile of reachableTiles(board, TOP_LEFT, 6)) {
      expect(isOpen(board, tile)).toBe(true);
    }
  });

  it("lets a character walk past an ally but never stop on them", () => {
    // The knocked-down rule (§7.3) makes this load-bearing: a fallen friend
    // skips their turns, so if allies were walls a body in this choke point
    // would seal the left column for the rest of the encounter with no move
    // anyone could make to clear it.
    const board = uBoard(hero(TOP_LEFT), ally(CHOKE));
    const tiles = reachableTiles(board, TOP_LEFT, 4);
    expect(has(tiles, CHOKE)).toBe(false);
    expect(tiles).toContainEqual({ x: 3, y: 1, cost: 4 });
  });

  it("stops dead at an enemy in the choke point", () => {
    // Squeezing past a monster is not intuitive, so enemies are walls. Here
    // that leaves the hero with nowhere at all to go.
    const board = uBoard(hero(TOP_LEFT), enemy(CHOKE));
    expect(reachableTiles(board, TOP_LEFT, 6)).toEqual([]);
  });

  it("treats everyone as a wall when nobody is standing on the origin", () => {
    // Previewing a landing tile has no mover and therefore no allies. The
    // cautious answer under-reports where a move could go; it never invents a
    // route the server would refuse.
    const board = uBoard(ally(CHOKE));
    expect(reachableTiles(board, TOP_LEFT, 6)).toEqual([]);
  });

  it("returns the same tiles in the same order every time", () => {
    // The highlight set ships to clients in a state patch (architecture §4.2);
    // an unstable order would rewrite the whole array on every recompute.
    const board = uBoard(hero(TOP_LEFT), ally(CHOKE));
    expect(reachableTiles(board, TOP_LEFT, 4)).toEqual(reachableTiles(board, TOP_LEFT, 4));
    const costs = reachableTiles(board, TOP_LEFT, 4).map((t) => t.cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });

  it("does not mutate the board", () => {
    const board = uBoard(hero(TOP_LEFT), ally(CHOKE));
    const snapshot = JSON.stringify(board);
    reachableTiles(board, TOP_LEFT, 6);
    expect(JSON.stringify(board)).toBe(snapshot);
  });
});

describe("findPath", () => {
  it("walks around the wall even though the target is two steps away", () => {
    // The pair that keeps range and movement from being confused for each
    // other: stepsBetween says 2, the walk costs 4.
    const board = uBoard(hero(TOP_LEFT));
    const path = findPath(board, TOP_LEFT, TOP_RIGHT);
    expect(path).toEqual([
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 2 },
      { x: 3, y: 1 },
    ]);
    expect((path ?? []).length - 1).toBe(4);
  });

  it("routes through an ally rather than failing", () => {
    // Whatever the crossing rule, an ally must never be able to make a tile
    // unreachable that would otherwise be reachable.
    const board = uBoard(hero(TOP_LEFT), ally(CHOKE));
    const path = findPath(board, TOP_LEFT, TOP_RIGHT);
    expect(path).toHaveLength(5);
    expect(has(path ?? [], CHOKE)).toBe(true);
  });

  it("detours around a body in the way when there is room to", () => {
    // Two-tile-wide corridor with an enemy in the near lane: the walk still
    // costs 3 because the sidestep is diagonal, but it must not cross the
    // enemy's tile.
    const board = parseBoard(["######", "#....#", "#....#", "######"]);
    const withActors = placeActor(placeActor(board, hero({ x: 1, y: 1 })), enemy({ x: 2, y: 1 }));
    const path = findPath(withActors, { x: 1, y: 1 }, { x: 4, y: 1 });
    expect(path).toHaveLength(4);
    expect(has(path ?? [], { x: 2, y: 1 })).toBe(false);
  });

  it("returns null when an enemy plugs the only way through", () => {
    const board = uBoard(hero(TOP_LEFT), enemy(CHOKE));
    expect(findPath(board, TOP_LEFT, TOP_RIGHT)).toBeNull();
  });

  it("returns null for a target nothing can reach", () => {
    // A sealed room is authored terrain, not a bug — the caller needs an
    // answer, not an exception, because this runs on a player's tap.
    const board = parseBoard(["#####", "#.#.#", "#####"]);
    expect(findPath(board, { x: 1, y: 1 }, { x: 3, y: 1 })).toBeNull();
  });

  it("returns null for a tile you cannot finish on", () => {
    const board = uBoard(hero(TOP_LEFT), ally(CHOKE));
    expect(findPath(board, TOP_LEFT, CHOKE)).toBeNull(); // occupied by a friend
    expect(findPath(board, TOP_LEFT, { x: 2, y: 1 })).toBeNull(); // a wall
    expect(findPath(board, TOP_LEFT, { x: 9, y: 9 })).toBeNull(); // off the board
  });

  it("returns the single tile when you are already there", () => {
    // Zero steps is a real answer; null would read as "unreachable".
    const board = uBoard(hero(TOP_LEFT));
    expect(findPath(board, TOP_LEFT, TOP_LEFT)).toEqual([TOP_LEFT]);
  });

  it("picks the same one of several equally short routes every time", () => {
    // The client previews with this function and the server decides with it.
    // Two equally short paths that differ between them would animate a walk
    // the server did not take.
    const board = placeActor(createBoard(), hero({ x: 0, y: 0 }));
    const first = findPath(board, { x: 0, y: 0 }, { x: 4, y: 2 });
    const second = findPath(board, { x: 0, y: 0 }, { x: 4, y: 2 });
    expect(first).toEqual(second);
    expect(first).toHaveLength(5);
  });

  it("agrees with reachableTiles about what a move costs", () => {
    // Two searches over one rule set. If they ever disagree, the highlight
    // offers a tile the walk cannot deliver.
    const board = uBoard(hero(TOP_LEFT), ally(CHOKE));
    for (const tile of reachableTiles(board, TOP_LEFT, 4)) {
      const path = findPath(board, TOP_LEFT, tile);
      expect(path).not.toBeNull();
      expect((path ?? []).length - 1).toBe(tile.cost);
    }
  });

  it("does not mutate the board", () => {
    const board = uBoard(hero(TOP_LEFT), ally(CHOKE));
    const snapshot = JSON.stringify(board);
    findPath(board, TOP_LEFT, TOP_RIGHT);
    expect(JSON.stringify(board)).toBe(snapshot);
  });
});
