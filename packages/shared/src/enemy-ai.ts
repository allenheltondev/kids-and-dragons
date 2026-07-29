/**
 * Enemy AI — roadmap chapter 4, and the whole of it fits in one sentence:
 *
 * > **A monster walks at the nearest hero it can reach and hits them.**
 *
 * That sentence is the specification. The roadmap asks for an AI that is
 * "simple and readable — she should be able to predict it. Deliberately not
 * clever," and spec §7 caps the depth of the whole combat system at "she learns
 * that positioning matters without learning a rulebook." Positioning can only
 * teach her anything if the consequence of a position is knowable *before* she
 * commits to it. A monster she can model in her head turns "where do I stand"
 * into a decision; a monster she cannot turns it into a guess, and a guess
 * teaches nothing. An AI that outplays an eight-year-old has failed at its job
 * however good the code is.
 *
 * So the things a combat AI usually does are all absent, on purpose, and each
 * one is left out for the same reason — it breaks the sentence:
 *
 * - **No picking off the weakest.** `hp` and `maxHp` are in the input shape and
 *   deliberately never read (see `PartyTarget`). If wounding a hero made them a
 *   magnet, being hurt would be self-compounding and the safest play would be to
 *   hide the wounded — the opposite of the Help Up lesson in §7.2/§7.3.
 * - **No focus fire and no coordination.** Each monster decides alone, from the
 *   board in front of it. Three monsters converging on one hero is a swing she
 *   cannot see coming, and it turns a 6-minute encounter into a wipe.
 * - **No kiting and no retreating at low HP.** A monster that backs away
 *   punishes her for closing, which is the one move a child reliably makes.
 * - **No cleverness about walls, chokepoints, or turn order.** It walks at
 *   somebody and swings.
 *
 * **It never targets a knocked-down hero (§7.3).** She is down, not dead, and
 * lying on the grid waiting for a Help Up. An enemy that keeps hitting a fallen
 * friend is both cruel and, worse for this module, unreadable — the picture on
 * screen would show a monster attacking someone who is visibly out of the fight.
 * Downed heroes are filtered before anything else is decided, so they are not
 * merely deprioritised: they do not exist to this module at all.
 *
 * **"Nearest" means walking distance, not the straight line.** The two only
 * disagree when something is in the way, and that is exactly the case worth
 * getting right: a hero standing three tiles away on the far side of a
 * Thornguard's Bramble Wall is, to the monster, a six-step walk. Ranking by the
 * straight line would have it commit to someone it cannot get to and spend its
 * turn trudging the long way round, past a hero it could have reached and hit —
 * a turn that reads as broken rather than as simple. Ranking by the walk keeps
 * the *outcome* legible, and the outcome is what she watches: the monster hits
 * whoever was easiest to get to. It is also the entire positioning lesson —
 * putting a wall between herself and a monster visibly changes who it goes for.
 * Measuring *reach* stays straight-line (`stepsBetween`), because that is how
 * she checks whether something can hit her: she counts tiles between the two
 * figures. Walking pays for detours, reach does not — the same split grid.ts
 * draws between `reachableTiles`/`findPath` and `stepsBetween`.
 *
 * **No randomness, deliberately.** There is a seeded `Rng` in dice.ts and this
 * module does not take one. Dice are random because a roll is a moment she is
 * meant to hold her breath for; a monster's *choice* being random would mean the
 * same board could produce two different turns, and then there is nothing to
 * predict. Every tie is broken by a fixed rule instead — see `compareApproaches`
 * — so the same board and party always produce the same plan. Replay depends on
 * it too: the engine rebuilds a run from its event log (architecture §4.1/§4.3),
 * and an AI that re-decided differently on replay would desync the clients.
 *
 * This module only *plans*. It does not move anybody, roll anything, or know
 * what an attack does — the encounter loop applies the plan and rolls d20 +
 * attack vs. Guard (§7.2). Keeping it a pure function of a plain input shape is
 * what lets the client show her, in advance, where a monster would go.
 */

import { findPath, isOpen, reachableTiles, stepsBetween, tilesWithinSteps } from "./grid.js";
import type { ActorId, Board, Position } from "./grid.js";

/**
 * The acting monster. Its position is passed in rather than looked up by id
 * because this module is a seam: the encounter state machine owns HP, turn
 * order and reach, and hands over the little that the decision needs.
 *
 * The board is still expected to carry this enemy, standing on `at`. If it does
 * not, `reachableTiles` cannot tell who the mover's allies are and treats every
 * actor as a wall (grid.ts, `canCross`), so the plan comes out more timid than
 * it should — never illegal, just short. Build both from the same state.
 */
export interface ActingEnemy {
  readonly id: ActorId;
  readonly at: Position;
  /** Movement allowance, in steps. §7.1 — base 4, and diagonals cost 1. */
  readonly steps: number;
  /**
   * How far it can hit, in straight-line steps. Omit for a melee monster: 1 is
   * "standing next to you", the same measure as `areAdjacent`.
   */
  readonly reach?: number;
}

/**
 * A hero, as the AI sees one. `hp` and `maxHp` are carried because the caller
 * has them and because their *absence* would be the easier thing to fix later —
 * but nothing in this file reads them, and that is the point (see the header).
 * The only field that changes a decision is `down`.
 */
export interface PartyTarget {
  readonly id: ActorId;
  readonly at: Position;
  readonly hp: number;
  readonly maxHp: number;
  /** §7.3 — at 0 HP, lying on the grid. Never a target. */
  readonly down: boolean;
}

export interface EnemyTurn {
  readonly board: Board;
  readonly enemy: ActingEnemy;
  readonly party: readonly PartyTarget[];
}

/**
 * What the monster intends to do, in the order §7.2 allows it: move up to your
 * steps, then take one action.
 */
export interface EnemyPlan {
  /** Where to walk, or null to stay put. Always a tile it can legally stand on. */
  readonly moveTo: Position | null;
  /** Who to attack from there, or null if it could not get to anybody. */
  readonly attack: ActorId | null;
}

/** Stand still, do nothing. */
const HOLD: EnemyPlan = { moveTo: null, attack: null };

/** Melee. §7.2's Attack and Help Up both mean "standing next to you". */
const DEFAULT_REACH = 1;

/**
 * The monster's whole turn, decided. Pure: it reads the board and returns an
 * intention, and the encounter loop is what applies it.
 *
 * Read top to bottom, this is the sentence in the header: find who it could get
 * to, take the nearest, and either hit them or walk at them.
 */
export function planEnemyTurn(turn: EnemyTurn): EnemyPlan {
  const { board, enemy } = turn;
  const allowance = wholeSteps(enemy.steps);
  // Floored at 1: a reach of 0 could only ever hit a hero standing on the
  // monster's own tile, which grid.ts makes impossible, so a mistyped or
  // zeroed-out reach would produce a monster that wanders the board all
  // encounter and never swings — a bug that looks like AI, not like a bug.
  const reach = Math.max(1, wholeSteps(enemy.reach ?? DEFAULT_REACH));

  // §7.3 — knocked down is out of the fight, not a softer target. Filtering
  // first means no later comparison can accidentally rank a fallen hero at all.
  const standing = turn.party.filter((hero) => !hero.down);
  // Nobody left upright: the encounter is already over and the story is about to
  // branch (§7.3). Hovering over the bodies would be the wrong picture.
  if (standing.length === 0) return HOLD;

  const best = standing
    .map((hero) => rateApproach(board, enemy.at, reach, hero))
    .sort(compareApproaches)[0];
  // `standing` is not empty, so there is always a best; the guard is here for
  // the compiler's benefit rather than the game's.
  if (!best) return HOLD;

  // Already in reach. It does not shuffle first: moving is optional in §7.2, and
  // a monster that sidesteps a tile before swinging costs her the read on which
  // hero was actually threatened — and can only ever walk itself out of position.
  if (best.cost === 0) return { moveTo: null, attack: best.target.id };

  // Close enough to walk up and swing this turn.
  if (best.cost <= allowance) return { moveTo: best.tile, attack: best.target.id };

  // Too far to arrive, but there is a way through: spend the whole allowance
  // walking that way. Next turn it arrives, which is a thing she can watch
  // coming and move away from — the readable version of "it is coming for you".
  if (Number.isFinite(best.cost) && best.tile) {
    return { moveTo: walkToward(board, enemy.at, best.tile, allowance), attack: null };
  }

  // No route at all — a Bramble Wall across the corridor, or a hero who walled
  // herself in. It walks up to the obstruction and stops there, which is what
  // she expects to see, rather than standing still as if it had given up.
  return { moveTo: closeTheGap(board, enemy.at, best.target.at, allowance), attack: null };
}

// ---------------------------------------------------------------------------
// Ranking the heroes
// ---------------------------------------------------------------------------

/** One hero, measured: how far the monster would have to walk to hit them. */
interface Approach {
  readonly target: PartyTarget;
  /** Steps of walking before it could attack. 0 = already in reach, Infinity = no route. */
  readonly cost: number;
  /** The tile it would attack from, or null when it is already standing on one. */
  readonly tile: Position | null;
  /** Straight-line steps. The tie-break, and the fallback when nothing is walkable. */
  readonly line: number;
}

/**
 * What it would take to hit this hero. `cost` is the walk, which is the ranking
 * metric; `line` is what she sees, kept alongside it for the two cases where the
 * walk cannot decide — an exact tie, and a party nothing can walk to.
 */
function rateApproach(
  board: Board,
  from: Position,
  reach: number,
  target: PartyTarget,
): Approach {
  const line = stepsBetween(from, target.at);
  // Reach ignores walls, exactly as ability ranges do (grid.ts header). A
  // monster in the doorway can swing at the hero on the other side of it.
  if (line <= reach) return { target, cost: 0, tile: null, line };

  let cost = Infinity;
  let tile: Position | null = null;
  // Row-major order from `tilesWithinSteps`, and a strict `<` below, so two
  // attack tiles that cost the same resolve to the topmost then leftmost — the
  // same reading order grid.ts sorts by, on every device.
  for (const stand of tilesWithinSteps(board, target.at, reach)) {
    if (!isOpen(board, stand)) continue;
    const path = findPath(board, from, stand);
    if (!path) continue;
    const walk = path.length - 1;
    if (walk < cost) {
      cost = walk;
      tile = stand;
    }
  }
  return { target, cost, tile, line };
}

/**
 * The tie-breaking rule, and it is fixed rather than random for the reason in
 * the header — she has to be able to predict it, and replay has to reproduce it.
 *
 * In order: the shorter walk; then the shorter straight line (which is also what
 * ranks a party the monster cannot walk to at all, since every one of those ties
 * at `Infinity`); then board reading order, topmost row first and leftmost tile
 * within a row; then id. Position order comes before id because it is the one a
 * person watching the screen could actually infer. The id comparison can only
 * fire if two heroes stand on the same tile, which grid.ts forbids — it is there
 * so the ordering is total and `sort` cannot depend on the input array's order.
 */
function compareApproaches(a: Approach, b: Approach): number {
  return (
    a.cost - b.cost ||
    a.line - b.line ||
    a.target.at.y - b.target.at.y ||
    a.target.at.x - b.target.at.x ||
    (a.target.id < b.target.id ? -1 : a.target.id > b.target.id ? 1 : 0)
  );
}

// ---------------------------------------------------------------------------
// Walking part of the way
// ---------------------------------------------------------------------------

/**
 * As far along the route as the allowance reaches. A prefix of a shortest path
 * is a shortest path to the tile it ends on (uniform cost per step, §7.1), so
 * the tile this returns is always in `reachableTiles` — the client's highlight
 * and the server's plan agree by construction.
 *
 * The walk backs off to the last *open* tile because a route may cross a fellow
 * monster's tile without being allowed to stop on it (grid.ts header). Without
 * the back-off, a plan could name an occupied tile and `moveActor` would throw
 * mid-encounter — a crash at the table, not a bad decision.
 */
function walkToward(
  board: Board,
  from: Position,
  toward: Position,
  allowance: number,
): Position | null {
  const path = findPath(board, from, toward);
  if (!path) return null;
  for (let i = Math.min(allowance, path.length - 1); i >= 1; i--) {
    const step = path[i];
    if (step && isOpen(board, step)) return step;
  }
  return null;
}

/**
 * No route exists, so it walks to whichever tile it *can* stand on that ends up
 * closest to the hero as the crow flies — i.e. it walks up to the thorns and
 * stops. `reachableTiles` is already sorted by cost then reading order and the
 * comparison is strict, so of several equally close tiles it takes the cheapest,
 * topmost, leftmost one: it does not spend steps it has no reason to spend.
 *
 * If nothing gets it closer than where it already stands, it stays. Otherwise a
 * blocked-off monster would jitter between two equally useless tiles every round
 * and read as broken.
 */
function closeTheGap(
  board: Board,
  from: Position,
  target: Position,
  allowance: number,
): Position | null {
  let best: Position | null = null;
  let bestLine = stepsBetween(from, target);
  for (const tile of reachableTiles(board, from, allowance)) {
    const line = stepsBetween(tile, target);
    if (line < bestLine) {
      bestLine = line;
      // Copied down to a bare tile, not passed through: a `ReachableTile` also
      // carries `cost`, and a plan is broadcast as a JSON patch and kept in the
      // event log (architecture §4.2). Handing the whole object back would put a
      // stray `cost` on the wire and into every replay of the encounter.
      best = { x: tile.x, y: tile.y };
    }
  }
  return best;
}

/**
 * Steps are whole tiles. A fractional or missing allowance floors to something
 * safe rather than throwing, because the caller is a live encounter: a monster
 * that stands still for one turn is a wobble, a monster that throws ends the
 * session.
 */
function wholeSteps(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
