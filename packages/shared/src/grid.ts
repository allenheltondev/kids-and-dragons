/**
 * The tactical grid — spec §7.1, roadmap chapter 4.
 *
 * Combat is "tactical, but deliberately shallow" (§7). This module is the
 * shallow part made explicit: a board, tiles that are open or not, actors that
 * stand on them, and the two questions the client asks constantly — *where can
 * I go* and *how do I get there*. Turn order, actions, enemy AI and rendering
 * are all somewhere else.
 *
 * Four decisions are baked in here, and they are all forced by the spec:
 *
 * **Movement is 8-directional.** §7.1: "Diagonals cost 1, same as orthogonal —
 * no math." So a step is any of the eight surrounding tiles and distance is
 * Chebyshev — `max(|dx|, |dy|)`. Adjacency is the same rule at distance 1,
 * which is what makes `content/rules.json` legible: Brace and Help Up say
 * "standing next to you", and if adjacency were 4-directional an ally lying
 * diagonally would be un-helpable while visibly touching you. Movement cost and
 * adjacency are the same measure on purpose; there is exactly one notion of a
 * step in this game.
 *
 * **Range is measured straight across the board, walking is not.** Abilities are
 * worded "within N steps" (Soothe, Leap, Glide) and Glide's text is "sail over
 * anything in your way and land on any open tile within 6 steps" — so range
 * ignores walls. `stepsBetween` is that measure, and it is also how an
 * eight-year-old checks range: she counts tiles between the two figures on
 * screen, she does not trace a route. Walking pays for detours, and that is
 * `reachableTiles` / `findPath`. Two functions, never confuse them.
 *
 * **You may cross an ally, never an enemy, and never stop on either.** The
 * alternative — everyone is a wall — has a bug with no in-game fix: a
 * knocked-down character "lies on the grid" and skips their turns (§7.3), so a
 * fallen friend in a doorway becomes permanent terrain that nobody can ask to
 * move. Squeezing past a friend is intuitive and squeezing past a monster is
 * not, so crossing is decided by side. Ending your move on an occupied tile is
 * never legal, which is why an ally's tile is *not* in the reachable set even
 * though routes run through it — the highlight only ever offers tiles you can
 * actually stand on.
 *
 * **Cutting a corner is a step like any other.** The spec is silent on it, and
 * "you may not move diagonally past the corner of a wall" is a rule somebody
 * would have to teach her, which §7 does not allow. Diagonals cost 1 with no
 * exceptions, so a gap between two wall corners is a gap.
 *
 * **Everything here is pure.** No clock, no randomness, no mutation of a board
 * that was passed in. The engine replays runs from an event log (architecture
 * §4.3) and the client previews moves with the same code the server decides
 * with; a grid query that answered differently on the two would show a phone a
 * path the server then refuses to walk. Tie-breaking is fixed for the same
 * reason: `STEP_DIRECTIONS` is ordered, and results are sorted, so two equally
 * short paths resolve to the *same* one everywhere.
 */

/** spec §7.1 — "10 × 8 grid." Fits a TV, auto-framed on a phone (§2.2). */
export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 8;

/**
 * Terrain is deliberately two words. No elevation, no cover, no facing — §7
 * caps the depth at "she learns positioning matters without learning a
 * rulebook", and every extra word is a rule she would have to be told.
 * `blocked` is authored into a map *and* created mid-fight by Thornguard's
 * Bramble Wall ("Grow thorns on two tiles. Enemies have to go around."), which
 * is why terrain is per-tile board state rather than a property of the art.
 */
export type Terrain = "open" | "blocked";

/** spec §7.1 — "3 players vs 2–4 enemies." There is no third side. */
export type ActorSide = "party" | "enemy";

export type ActorId = string;

/** A tile coordinate. Matches `targetTile` on the wire (architecture §4.2). */
export interface Position {
  readonly x: number;
  readonly y: number;
}

/**
 * Anything standing on a tile. Extends `Position` so an actor can be handed
 * straight to `areAdjacent` / `stepsBetween` — the range helpers read the way
 * the ability text does: `areAdjacent(me, ally)`.
 *
 * HP, initiative and knocked-down state are combat state, not grid state, and
 * live with the encounter. All the grid needs to know is who is where and which
 * side they are on.
 */
export interface Actor extends Position {
  readonly id: ActorId;
  readonly side: ActorSide;
}

/**
 * Positions are held once, on the actors. A parallel occupant-per-tile index
 * would be faster and would eventually disagree with itself after a botched
 * move; with at most seven actors on eighty tiles (§7.1) the scan is free.
 */
export interface Board {
  readonly width: number;
  readonly height: number;
  /** Row-major, `width * height` entries. Row 0 is the top of the screen. */
  readonly terrain: readonly Terrain[];
  readonly actors: readonly Actor[];
}

/** A tile you could finish your move on, and what it costs to get there. */
export interface ReachableTile extends Position {
  /** Steps spent. Always ≥ 1 — the tile you are on is not a move. */
  readonly cost: number;
}

/**
 * The eight steps, clockwise from north. The *order* is part of the contract:
 * BFS breaks ties by the order it discovers neighbours, so freezing it here is
 * what makes the client's previewed path identical to the server's chosen one.
 * Reorder this and equally-short paths start disagreeing across devices.
 */
export const STEP_DIRECTIONS: readonly Position[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

// ---------------------------------------------------------------------------
// Building a board
// ---------------------------------------------------------------------------

function indexOf(board: Board, x: number, y: number): number {
  return y * board.width + x;
}

/** An empty board. Defaults to the 10 × 8 of spec §7.1. */
export function createBoard(width: number = BOARD_WIDTH, height: number = BOARD_HEIGHT): Board {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`grid: board must be a positive whole number of tiles, got ${width}×${height}`);
  }
  return {
    width,
    height,
    terrain: Array.from({ length: width * height }, (): Terrain => "open"),
    actors: [],
  };
}

/**
 * A board from an ASCII sketch — `.` open, `#` blocked, one string per row.
 * This is what tests and the authoring tool (roadmap chapter 6) draw with; the
 * biome tile set that dresses it is a rendering concern and never reaches here.
 */
export function parseBoard(rows: readonly string[]): Board {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  if (height < 1 || width < 1) throw new Error("grid: parseBoard needs at least one non-empty row");

  const terrain: Terrain[] = [];
  for (const [y, row] of rows.entries()) {
    if (row.length !== width) {
      throw new Error(`grid: row ${y} is ${row.length} tiles wide, expected ${width}`);
    }
    for (const [x, char] of [...row].entries()) {
      if (char === ".") terrain.push("open");
      else if (char === "#") terrain.push("blocked");
      else throw new Error(`grid: unknown map character "${char}" at (${x}, ${y}) — use "." or "#"`);
    }
  }
  return { width, height, terrain, actors: [] };
}

/**
 * Grows or clears terrain, returning a new board. Refuses to build a wall on an
 * occupied tile: Bramble Wall would otherwise leave whoever was standing there
 * inside the thorns, on a tile they can walk out of but never walk back onto.
 */
export function setTerrain(board: Board, at: Position, terrain: Terrain): Board {
  requireInBounds(board, at, "setTerrain");
  const standing = actorAt(board, at);
  if (standing && terrain === "blocked") {
    throw new Error(`grid: cannot block (${at.x}, ${at.y}) — "${standing.id}" is standing on it`);
  }
  const next = [...board.terrain];
  next[indexOf(board, at.x, at.y)] = terrain;
  return { ...board, terrain: next };
}

/** Puts an actor on the board. Never mutates `board`. */
export function placeActor(board: Board, actor: Actor): Board {
  requireInBounds(board, actor, "placeActor");
  if (actorById(board, actor.id)) {
    throw new Error(`grid: "${actor.id}" is already on the board — use moveActor`);
  }
  if (!isOpen(board, actor)) {
    throw new Error(`grid: (${actor.x}, ${actor.y}) is not open, so "${actor.id}" cannot stand there`);
  }
  return { ...board, actors: [...board.actors, actor] };
}

/**
 * Moves an actor, returning a new board. This *applies* a move, it does not
 * judge one — whether the actor had the steps for it is the engine's call, made
 * with `reachableTiles` before it gets here (architecture §4.1: validate, then
 * apply). What is checked is the thing no caller can recover from: two actors
 * on one tile.
 */
export function moveActor(board: Board, id: ActorId, to: Position): Board {
  const actor = actorById(board, id);
  if (!actor) throw new Error(`grid: no actor "${id}" on the board`);
  requireInBounds(board, to, "moveActor");
  if (!samePosition(actor, to) && !isOpen(board, to)) {
    throw new Error(`grid: (${to.x}, ${to.y}) is not open, so "${id}" cannot stand there`);
  }
  return {
    ...board,
    actors: board.actors.map((a) => (a.id === id ? { ...a, x: to.x, y: to.y } : a)),
  };
}

/** Takes an actor off the board. Unknown ids are a no-op, not an error. */
export function removeActor(board: Board, id: ActorId): Board {
  return { ...board, actors: board.actors.filter((a) => a.id !== id) };
}

function requireInBounds(board: Board, at: Position, who: string): void {
  if (!inBounds(board, at)) {
    throw new Error(`grid: ${who} — (${at.x}, ${at.y}) is off a ${board.width}×${board.height} board`);
  }
}

// ---------------------------------------------------------------------------
// Reading a board
// ---------------------------------------------------------------------------

export function inBounds(board: Board, at: Position): boolean {
  return (
    Number.isInteger(at.x) &&
    Number.isInteger(at.y) &&
    at.x >= 0 &&
    at.y >= 0 &&
    at.x < board.width &&
    at.y < board.height
  );
}

/**
 * Off the board reads as `blocked` rather than throwing or returning undefined.
 * The edge of the board is a wall, so every caller that already handles walls
 * handles the edge for free — one fewer bounds check to forget in a loop.
 */
export function terrainAt(board: Board, at: Position): Terrain {
  if (!inBounds(board, at)) return "blocked";
  return board.terrain[indexOf(board, at.x, at.y)] ?? "blocked";
}

export function isPassable(board: Board, at: Position): boolean {
  return terrainAt(board, at) === "open";
}

export function actorAt(board: Board, at: Position): Actor | null {
  return board.actors.find((a) => a.x === at.x && a.y === at.y) ?? null;
}

/**
 * `actorAt` as a one-shot index, for the flood fills below. A linear scan per
 * lookup is free at seven actors — but the floods ask for every neighbour of
 * every frontier tile, and the enemy planner runs floods per candidate tile,
 * so the scans multiply where nothing else does. Build once, look up O(1).
 */
function actorIndex(board: Board): Map<number, Actor> {
  const index = new Map<number, Actor>();
  for (const actor of board.actors) {
    index.set(indexOf(board, actor.x, actor.y), actor);
  }
  return index;
}

export function actorById(board: Board, id: ActorId): Actor | null {
  return board.actors.find((a) => a.id === id) ?? null;
}

/**
 * "Any open tile" — the wording Glide and Leap use in `content/rules.json`.
 * Passable and nobody standing on it. This is the test for somewhere you may
 * *finish*, whether you walked, jumped or were shoved there.
 */
export function isOpen(board: Board, at: Position): boolean {
  return isPassable(board, at) && actorAt(board, at) === null;
}

export function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

// ---------------------------------------------------------------------------
// Distance and adjacency — the vocabulary the ability text already uses
// ---------------------------------------------------------------------------

/**
 * "Within N steps." Chebyshev distance, because diagonals cost 1 (§7.1). Walls
 * are ignored on purpose — Glide "sails over anything in your way" and a child
 * checking range counts tiles between two figures rather than tracing a route.
 * For how far you can *walk*, use `reachableTiles`.
 */
export function stepsBetween(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * "Standing next to you" — Brace, Help Up (§7.2), Storm of Blades. All eight
 * surrounding tiles, so a friend touching you diagonally is next to you, which
 * is what the picture on screen says. A tile is not adjacent to itself.
 */
export function areAdjacent(a: Position, b: Position): boolean {
  return stepsBetween(a, b) === 1;
}

/**
 * Every in-bounds tile within `steps`, excluding the origin. Row-major order so
 * the list is stable across devices. Terrain and occupancy are *not* filtered —
 * this answers "what is in range", and each ability decides what it may target
 * (Burst hits a 2×2 of anything; Leap needs an open tile).
 */
export function tilesWithinSteps(board: Board, origin: Position, steps: number): readonly Position[] {
  const limit = Math.floor(steps);
  if (!Number.isFinite(limit) || limit < 1) return [];
  const out: Position[] = [];
  for (let y = Math.max(0, origin.y - limit); y <= Math.min(board.height - 1, origin.y + limit); y++) {
    for (let x = Math.max(0, origin.x - limit); x <= Math.min(board.width - 1, origin.x + limit); x++) {
      if (x !== origin.x || y !== origin.y) out.push({ x, y });
    }
  }
  return out;
}

/** The up-to-eight tiles next to `at`, clipped to the board. */
export function adjacentTiles(board: Board, at: Position): readonly Position[] {
  return tilesWithinSteps(board, at, 1);
}

/** Everyone standing next to `at`. Board order, so it is stable. */
export function actorsAdjacentTo(board: Board, at: Position): readonly Actor[] {
  return board.actors.filter((a) => areAdjacent(a, at));
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/**
 * May the mover pass over whoever is standing here? Allies yes, enemies no —
 * see the file header. `mover` is null when the caller is asking about a tile
 * nobody occupies (a preview of a shove or a landing), and a hypothetical mover
 * has no allies, so everyone blocks. That is the cautious answer: it can only
 * ever under-report where a move could go.
 */
function canCross(mover: Actor | null, standing: Actor | null): boolean {
  if (standing === null) return true;
  return mover !== null && standing.side === mover.side;
}

/**
 * Every tile an actor can finish a move on, with what it cost — the set
 * PlayerView highlights (§7.2: "reachable tiles highlighted. Illegal moves are
 * not presented, so they can't be attempted.").
 *
 * The mover is whoever stands on `from`. Deriving it from the board rather than
 * taking it as an argument means a caller cannot pass a mover that disagrees
 * with where the board says they are, which would silently produce a set the
 * server then rejects tile by tile.
 *
 * The origin is never included. Staying put is always legal and needs no
 * highlight; offering "move here" on the tile she is already standing on reads
 * as a move that does nothing.
 *
 * Uniform cost per step (§7.1), so this is a breadth-first flood, not Dijkstra.
 * Results are sorted by cost then row then column: the ordering is part of the
 * output because this set travels to clients in a state patch (architecture
 * §4.2), and an unstable order would rewrite the whole array every turn.
 */
export function reachableTiles(
  board: Board,
  from: Position,
  steps: number,
): readonly ReachableTile[] {
  const limit = Math.floor(steps);
  if (!Number.isFinite(limit) || limit < 1 || !inBounds(board, from)) return [];

  const actors = actorIndex(board);
  const mover = actors.get(indexOf(board, from.x, from.y)) ?? null;
  const seen = new Set<number>([indexOf(board, from.x, from.y)]);
  const found: ReachableTile[] = [];
  let frontier: Position[] = [from];

  for (let cost = 1; cost <= limit && frontier.length > 0; cost++) {
    const next: Position[] = [];
    for (const tile of frontier) {
      for (const dir of STEP_DIRECTIONS) {
        const at = { x: tile.x + dir.x, y: tile.y + dir.y };
        if (!inBounds(board, at)) continue;
        const key = indexOf(board, at.x, at.y);
        if (seen.has(key)) continue;
        if (!isPassable(board, at)) continue;
        const standing = actors.get(key) ?? null;
        if (!canCross(mover, standing)) continue;
        seen.add(key);
        next.push(at);
        // Crossed, but only an empty tile is somewhere you can stop.
        if (standing === null) found.push({ x: at.x, y: at.y, cost });
      }
    }
    frontier = next;
  }

  return found.sort((a, b) => a.cost - b.cost || a.y - b.y || a.x - b.x);
}

/**
 * The shortest walk from `from` to `to`, or null if there isn't one. Includes
 * both ends, so `path.length - 1` is the step cost and a path of length 1 means
 * you are already there.
 *
 * Deliberately unlimited: this answers "is there a way through", which is what
 * the enemy AI asks when its target is further than its steps and what the
 * client asks to draw a route. Whether the actor can afford it is
 * `reachableTiles`, and the two agree by construction — same crossing rule,
 * same direction order, same uniform cost.
 */
export function findPath(board: Board, from: Position, to: Position): readonly Position[] | null {
  if (!inBounds(board, from) || !inBounds(board, to)) return null;
  if (samePosition(from, to)) return [{ x: from.x, y: from.y }];
  // You cannot end on a wall or on somebody, ally or not.
  if (!isOpen(board, to)) return null;

  const actors = actorIndex(board);
  const start = indexOf(board, from.x, from.y);
  const goal = indexOf(board, to.x, to.y);
  const mover = actors.get(start) ?? null;
  const cameFrom = new Map<number, number>([[start, start]]);
  let frontier: Position[] = [from];

  while (frontier.length > 0) {
    const next: Position[] = [];
    for (const tile of frontier) {
      for (const dir of STEP_DIRECTIONS) {
        const at = { x: tile.x + dir.x, y: tile.y + dir.y };
        if (!inBounds(board, at)) continue;
        const key = indexOf(board, at.x, at.y);
        if (cameFrom.has(key)) continue;
        if (!isPassable(board, at)) continue;
        if (!canCross(mover, actors.get(key) ?? null)) continue;
        cameFrom.set(key, indexOf(board, tile.x, tile.y));
        if (key === goal) return rebuild(board, cameFrom, start, goal);
        next.push(at);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Every shortest walk from one origin, computed once.
 *
 * `findPath` answers one destination per flood, and the enemy planner asks
 * about every candidate attack tile around every hero — dozens of destinations
 * from the *same* origin, which was dozens of identical floods per monster per
 * turn. This runs the flood once and answers each destination by lookup.
 *
 * The expansion is byte-for-byte the same as `findPath`'s — same crossing
 * rule, same direction order, same first-visit-wins parents — so `pathTo`
 * returns the identical path `findPath` would have. That is not an
 * optimisation detail: plans replay (architecture §4.1), and a field that
 * picked even a different-but-equal path would fork a replay from its record.
 */
export interface WalkField {
  /** Steps to walk there, or Infinity when no route exists. */
  dist(to: Position): number;
  /** The same answer `findPath(board, from, to)` gives, from the shared flood. */
  pathTo(to: Position): readonly Position[] | null;
}

export function walkField(board: Board, from: Position): WalkField {
  const unreachable: WalkField = { dist: () => Infinity, pathTo: () => null };
  if (!inBounds(board, from)) return unreachable;

  const actors = actorIndex(board);
  const start = indexOf(board, from.x, from.y);
  const mover = actors.get(start) ?? null;
  const cameFrom = new Map<number, number>([[start, start]]);
  const distance = new Map<number, number>([[start, 0]]);
  let frontier: Position[] = [from];

  for (let cost = 1; frontier.length > 0; cost++) {
    const next: Position[] = [];
    for (const tile of frontier) {
      for (const dir of STEP_DIRECTIONS) {
        const at = { x: tile.x + dir.x, y: tile.y + dir.y };
        if (!inBounds(board, at)) continue;
        const key = indexOf(board, at.x, at.y);
        if (cameFrom.has(key)) continue;
        if (!isPassable(board, at)) continue;
        if (!canCross(mover, actors.get(key) ?? null)) continue;
        cameFrom.set(key, indexOf(board, tile.x, tile.y));
        distance.set(key, cost);
        next.push(at);
      }
    }
    frontier = next;
  }

  return {
    dist(to: Position): number {
      if (!inBounds(board, to)) return Infinity;
      return distance.get(indexOf(board, to.x, to.y)) ?? Infinity;
    },
    pathTo(to: Position): readonly Position[] | null {
      if (!inBounds(board, to)) return null;
      if (samePosition(from, to)) return [{ x: from.x, y: from.y }];
      // Same rule as findPath: you cannot end on a wall or on somebody.
      if (!isOpen(board, to)) return null;
      const goal = indexOf(board, to.x, to.y);
      if (!cameFrom.has(goal)) return null;
      return rebuild(board, cameFrom, start, goal);
    },
  };
}

function rebuild(
  board: Board,
  cameFrom: ReadonlyMap<number, number>,
  start: number,
  goal: number,
): readonly Position[] {
  const path: Position[] = [];
  let cursor = goal;
  while (cursor !== start) {
    path.push({ x: cursor % board.width, y: Math.floor(cursor / board.width) });
    const previous = cameFrom.get(cursor);
    // Unreachable: every key in the map was written with its predecessor.
    if (previous === undefined) throw new Error("grid: broken path reconstruction");
    cursor = previous;
  }
  path.push({ x: start % board.width, y: Math.floor(start / board.width) });
  return path.reverse();
}
