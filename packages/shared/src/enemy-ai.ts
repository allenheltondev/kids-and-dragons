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
 * **If encounters ever play too soft, do not make this policy cleverer.** The
 * door left open is a *second sentence* for a specific creature — "the wolf
 * always goes for whoever moved last", "the sentinel never leaves the bridge" —
 * selected by a `behavior` field on `EnemySpec` in types/chapter.ts, which is
 * content-authored, so a new one is a chapter edit rather than a deploy. Two
 * readable sentences stay predictable and give a chapter author a real dial. One
 * sentence with exceptions bolted on does not: the moment a monster's choice
 * depends on something she cannot see on the board, positioning stops being a
 * decision and goes back to being a guess. The test that pins `hp`/`maxHp`
 * unread is the tripwire for the most tempting version of getting this wrong.
 *
 * **A place that fights back gets three more sentences, and only that place.**
 * A fight whose scene declared an `environment` (#201) has ground that burns,
 * a way out on a timer and somebody to save, all of it drawn on the board.
 * There a monster also *does not stop in the fire*, *the one nearest the way
 * out watches it*, and *the next one watches the captive* — see "In a place
 * that fights back" below for the exact rules. They pass the same test as the
 * first sentence: each is about something she can see, none reads hit points,
 * none involves monsters talking to each other, and the sentence still comes
 * first (a monster with somebody to hit hits them). A turn handed no
 * environment never reaches them — that is the line Gemfall stands behind.
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

import { exitOpen, hazardAt, hazardWeight } from "./environment.js";
import type { RescueStatus } from "./environment.js";
import {
  actorAt,
  inBounds,
  isOpen,
  moveActor,
  reachableTiles,
  samePosition,
  stepsBetween,
  tilesWithinSteps,
  walkField,
} from "./grid.js";
import type { Actor, ActorId, Board, Position, WalkField } from "./grid.js";
import type { EncounterEnvironment, MapTile } from "./types/chapter.js";

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
  /**
   * The place the fight is in, when its scene declared one (#201). Absent —
   * every fight without an environment, every Gemfall fight — and the plan is
   * the sentence above, computed by exactly the code it always was. Present,
   * and three more sentences apply on top of it; see "In a place that fights
   * back" below.
   */
  readonly environment?: EnemyEnvironment;
}

/**
 * The little of `EncounterState.environment` a monster's decision reads: the
 * authored place, the round this turn is played in (the round a hazard bites
 * in when the turn ends, and the one an exit is open in), and whether the
 * captive is still waiting. A plain shape for the same reason the rest of the
 * input is one — the client can ask the same question of the same board.
 */
export interface EnemyEnvironment {
  readonly spec: EncounterEnvironment;
  readonly round: number;
  /** `EnvironmentState.rescue`. Only `"waiting"` makes the captive worth watching. */
  readonly rescue?: RescueStatus;
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
  const decision = decide(turn);
  // The branch is on the *input*, not on anything the board says: a turn
  // handed no environment never reaches a line of the code below the sentence,
  // which is what keeps every fight without one identical by construction
  // (enemy-ai-environment.test.ts holds this to the frozen pre-#201 planner).
  return turn.environment ? planInEnvironment(turn, turn.environment, decision) : decision.plan;
}

/**
 * What the sentence decided, and — when it could not arrive this turn — where
 * it was heading, so the environment's rules can pick a different place to
 * stop on the same way there.
 */
interface Decision {
  readonly plan: EnemyPlan;
  /**
   * The attack tile it is walking toward (`walk: true`), or the hero it is
   * edging toward with no route at all (`walk: false`, measured as the crow
   * flies, as `closeTheGap` does). Null when it swings this turn or holds.
   */
  readonly toward: { readonly tile: Position; readonly walk: boolean } | null;
}

function decide(turn: EnemyTurn): Decision {
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
  if (standing.length === 0) return { plan: HOLD, toward: null };

  /*
   * One flood for the whole turn. Every question this planner asks — how far
   * is each attack tile around each hero, and which way is the walk — is a
   * shortest-path question *from the monster's own tile*, so the answers all
   * live in a single field. Rating used to re-flood the board once per
   * candidate tile per hero (~150 floods for a reach-3 monster); now the
   * floods-per-turn is exactly one, and the answers are the same ones.
   */
  const field = walkField(board, enemy.at);

  const best = standing
    .map((hero) => rateApproach(board, field, enemy.at, reach, hero))
    .sort(compareApproaches)[0];
  // `standing` is not empty, so there is always a best; the guard is here for
  // the compiler's benefit rather than the game's.
  if (!best) return { plan: HOLD, toward: null };

  // Already in reach. It does not shuffle first: moving is optional in §7.2, and
  // a monster that sidesteps a tile before swinging costs her the read on which
  // hero was actually threatened — and can only ever walk itself out of position.
  if (best.cost === 0) return { plan: { moveTo: null, attack: best.target.id }, toward: null };

  // Close enough to walk up and swing this turn.
  if (best.cost <= allowance) return { plan: { moveTo: best.tile, attack: best.target.id }, toward: null };

  // Too far to arrive, but there is a way through: spend the whole allowance
  // walking that way. Next turn it arrives, which is a thing she can watch
  // coming and move away from — the readable version of "it is coming for you".
  if (Number.isFinite(best.cost) && best.tile) {
    return {
      plan: { moveTo: walkToward(board, field, best.tile, allowance), attack: null },
      toward: { tile: best.tile, walk: true },
    };
  }

  // No route at all — a Bramble Wall across the corridor, or a hero who walled
  // herself in. It walks up to the obstruction and stops there, which is what
  // she expects to see, rather than standing still as if it had given up.
  return {
    plan: { moveTo: closeTheGap(board, enemy.at, best.target.at, allowance), attack: null },
    toward: { tile: best.target.at, walk: false },
  };
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
  field: WalkField,
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
    const walk = field.dist(stand);
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
  field: WalkField,
  toward: Position,
  allowance: number,
): Position | null {
  const path = field.pathTo(toward);
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

// ---------------------------------------------------------------------------
// In a place that fights back (#201)
// ---------------------------------------------------------------------------

/*
 * A fight whose scene declared an `environment` has ground that burns, a way
 * out that opens and shuts, and somebody to save. The sentence alone walks a
 * monster into the fire and leaves the way out to whoever wants it — the gap
 * #201 left open. What closes it is not a cleverer policy but three more
 * sentences, each as short as the first and each about something drawn on
 * the board, so she can still predict every turn from what she sees:
 *
 *   1. **It does not stop in the fire.** Walking across is free for a monster
 *      exactly as it is for her (a hazard bites a figure that *ends its turn*
 *      on it, in the round that turn is played — `turnEndInEnvironment`). So
 *      only where it stops is judged: the same hero from ground that is not
 *      burning if it can; any hero it can hit from such ground if not; and
 *      only when every tile it could swing from is burning does it step in and
 *      swing anyway, on the tile that burns least. A walk that would end in the
 *      fire stops on the safe tile that gets it closest, and only when no safe
 *      tile gets it any closer at all does it walk in — on the least-burning
 *      tile that does. It would rather burn than give up: a monster that waits
 *      forever at the edge of a fire wider than its stride turns a hazard into
 *      a wall, and a stalled fight into a clock that runs out on a table that
 *      did nothing wrong.
 *   2. **The one nearest the way out watches it.** While an exit is open, or
 *      opens next round (`EXIT_LOOKAHEAD`), the monster standing nearest to it
 *      — and only that one, so a pack never abandons the fight for the door —
 *      goes and stands *beside* it when it has nobody to hit this turn, on the
 *      side nearest the heroes, and stays there until somebody comes within
 *      reach. Never *on* an exit tile, and never anywhere that would leave no
 *      hero a walk to one of its tiles: it contests the escape, it does not
 *      close it, so every exit the checker proved reachable stays reachable.
 *   3. **The next one watches the captive.** While somebody still waits to be
 *      freed, the nearest monster not already watching an exit stands beside
 *      them the same way, so freeing Pip means stopping next to a monster. The
 *      captive is never a target — they are walled terrain, not a figure, and
 *      nothing here swings at terrain — and the same reachability rule keeps
 *      at least one of the captive's sides open to a hero.
 *
 * Who watches what is decided from the board alone (the posts in authored
 * order, each to the nearest monster as the crow flies, ties by reading
 * order), so every monster on the board agrees on it without talking — no
 * coordination, just the same picture read the same way. A monster with
 * somebody to hit hits them: the sentence always comes first.
 *
 * Nothing here is random and nothing reads hit points; every list is ranked
 * by a fixed rule ending in reading order, like the rest of this file.
 */

/**
 * How many rounds ahead a monster starts watching an exit that is not yet
 * open: 1 is "it opens next round". A tuning dial, not a rule — raise it and
 * the guard walks over sooner; 0 and it only watches an exit already open.
 */
export const EXIT_LOOKAHEAD = 1;

/** A tile it could end its move on this turn — where it stands (cost 0), or one it can walk to. */
interface Stop extends Position {
  readonly cost: number;
}

/** Something on the board worth standing beside: an exit (all its tiles) or the captive. */
interface Post {
  readonly kind: "exit" | "captive";
  readonly tiles: readonly MapTile[];
}

function planInEnvironment(turn: EnemyTurn, env: EnemyEnvironment, decision: Decision): EnemyPlan {
  const { board, enemy } = turn;
  const plan = decision.plan;
  const standing = turn.party.filter((hero) => !hero.down);
  if (standing.length === 0) return plan;

  const allowance = wholeSteps(enemy.steps);
  const reach = Math.max(1, wholeSteps(enemy.reach ?? DEFAULT_REACH));
  /** What ending its turn here would cost it, this round: damage, and one more for ground that sticks or throws (#220). */
  const burn = (at: Position): number => hazardWeight(hazardAt(env.spec, env.round, at));
  const stops: readonly Stop[] = [
    { x: enemy.at.x, y: enemy.at.y, cost: 0 },
    ...reachableTiles(board, enemy.at, allowance),
  ];

  // 1. A swing this turn: keep it, unless it means standing in the fire.
  if (plan.attack !== null) {
    if (burn(plan.moveTo ?? enemy.at) === 0) return plan;
    return swingFromCoolestTile(enemy.at, reach, stops, standing, plan.attack, burn);
  }

  // 2 and 3. Nobody to hit: the way out, or the captive, if this one watches it.
  const posted = planPost(turn, env, allowance, stops, standing, burn);
  if (posted) return posted;

  // 1 again, for a walk: the sentence's stop, unless it is burning.
  if (!decision.toward || burn(plan.moveTo ?? enemy.at) === 0) return plan;
  const { tile, walk } = decision.toward;
  return stopClearOfHazards(enemy.at, stops, walk ? walkDistanceTo(board, enemy, tile) : lineTo(tile), burn);
}

/**
 * Every tile it could swing at somebody from, ranked: least burning first —
 * so any safe one beats every burning one — then the hero the sentence chose,
 * then the shorter walk, then the hero's own order (the sentence's tie-break:
 * straight line, reading order, id), then the tile's reading order. There is
 * always at least one: the sentence's own tile is among them.
 */
function swingFromCoolestTile(
  at: Position,
  reach: number,
  stops: readonly Stop[],
  standing: readonly PartyTarget[],
  chosen: ActorId,
  burn: (at: Position) => number,
): EnemyPlan {
  const options: { stop: Stop; hero: PartyTarget; burn: number }[] = [];
  for (const stop of stops) {
    for (const hero of standing) {
      if (stepsBetween(stop, hero.at) <= reach) options.push({ stop, hero, burn: burn(stop) });
    }
  }
  options.sort(
    (a, b) =>
      a.burn - b.burn ||
      (a.hero.id === chosen ? 0 : 1) - (b.hero.id === chosen ? 0 : 1) ||
      a.stop.cost - b.stop.cost ||
      stepsBetween(at, a.hero.at) - stepsBetween(at, b.hero.at) ||
      a.hero.at.y - b.hero.at.y ||
      a.hero.at.x - b.hero.at.x ||
      compareIds(a.hero.id, b.hero.id) ||
      a.stop.y - b.stop.y ||
      a.stop.x - b.stop.x,
  );
  const best = options[0];
  if (!best) return HOLD;
  return { moveTo: samePosition(best.stop, at) ? null : bare(best.stop), attack: best.hero.id };
}

/**
 * Where to stop on a walk that cannot arrive this turn, given how far each
 * stop leaves it from where it is going. A stop counts only if it gets it
 * *closer* than staying would — otherwise "avoid the fire" could read as
 * "walk backwards". Of those: the closest safe one (then the cheaper walk,
 * then reading order); failing any safe one, the least-burning one that still
 * gets closer (the fire wider than its stride — it crosses rather than wait
 * forever); failing any progress at all, it stays, unless where it stands is
 * burning, in which case it takes the least-burning tile it can reach.
 */
function stopClearOfHazards(
  at: Position,
  stops: readonly Stop[],
  distance: (to: Position) => number,
  burn: (at: Position) => number,
): EnemyPlan {
  const here = distance(at);
  const rank = (byBurn: boolean) => (a: Stop, b: Stop) =>
    (byBurn ? burn(a) - burn(b) : 0) || distance(a) - distance(b) || a.cost - b.cost || a.y - b.y || a.x - b.x;
  const closer = stops.filter((stop) => !samePosition(stop, at) && distance(stop) < here);
  const safe = closer.filter((stop) => burn(stop) === 0).sort(rank(false))[0];
  const pick = safe ?? [...closer].sort(rank(true))[0] ?? (burn(at) === 0 ? null : [...stops].sort(rank(true))[0]);
  if (!pick || samePosition(pick, at)) return HOLD;
  return { moveTo: bare(pick), attack: null };
}

/**
 * The walking distance from any tile to `goal`, for this mover — computed
 * from the goal's end with the mover standing there, which is the same walk
 * backwards (uniform steps, the same crossing rule: grid.ts). Falls back to
 * the straight line if the board does not carry the mover where the turn says
 * it stands (see `ActingEnemy`).
 */
function walkDistanceTo(board: Board, enemy: ActingEnemy, goal: Position): (to: Position) => number {
  const mover = actorAt(board, enemy.at);
  if (!mover || mover.id !== enemy.id || !(samePosition(goal, enemy.at) || isOpen(board, goal))) return lineTo(goal);
  const back = walkField(moveActor(board, enemy.id, goal), goal);
  return (to) => back.dist(to);
}

function lineTo(goal: Position): (to: Position) => number {
  return (to) => stepsBetween(to, goal);
}

/** The posts in force this round, exits first in authored order, then the captive. */
function postsInForce(env: EnemyEnvironment): Post[] {
  const posts: Post[] = [];
  for (const exit of env.spec.exits ?? []) {
    let watched = false;
    for (let ahead = 0; ahead <= EXIT_LOOKAHEAD; ahead++) watched ||= exitOpen(exit, env.round + ahead);
    if (watched && exit.tiles.length > 0) posts.push({ kind: "exit", tiles: exit.tiles });
  }
  if (env.spec.rescue && env.rescue === "waiting") posts.push({ kind: "captive", tiles: [env.spec.rescue.at] });
  return posts;
}

/**
 * Rules 2 and 3: the post this monster watches, if any, and how it gets
 * there. Null when it watches nothing (or nothing it could stand beside), and
 * the sentence's walk applies instead.
 */
function planPost(
  turn: EnemyTurn,
  env: EnemyEnvironment,
  allowance: number,
  stops: readonly Stop[],
  standing: readonly PartyTarget[],
  burn: (at: Position) => number,
): EnemyPlan | null {
  const { board, enemy } = turn;
  const mover = actorAt(board, enemy.at);
  if (!mover || mover.id !== enemy.id) return null;
  const posts = postsInForce(env);
  if (posts.length === 0) return null;
  const field = walkField(board, enemy.at);
  const post = assignPosts(posts, board.actors.filter((a) => a.side === mover.side)).get(mover.id);
  if (!post) return null;

  const exitTiles = (env.spec.exits ?? []).flatMap((exit) => exit.tiles);
  const onExit = (at: Position) => exitTiles.some((tile) => samePosition(tile, at));
  const keepsWay = (stand: Position) => leavesAWay(board, mover, stand, post, standing);

  // Already beside it, on ground that is not burning: it stays. A guard that
  // shuffled along the wall every time a hero moved would read as restless,
  // not as watchful.
  if (besidePost(enemy.at, post) && !onExit(enemy.at) && burn(enemy.at) === 0 && keepsWay(enemy.at)) return HOLD;

  const nearestHero = (at: Position) => Math.min(...standing.map((hero) => stepsBetween(at, hero.at)));
  const candidates = postTiles(board, post)
    .filter((tile) => isOpen(board, tile) && !onExit(tile) && burn(tile) === 0 && Number.isFinite(field.dist(tile)))
    .map((tile) => ({ tile, cost: field.dist(tile), hero: nearestHero(tile) }))
    .sort(
      (a, b) =>
        (a.cost <= allowance ? 0 : 1) - (b.cost <= allowance ? 0 : 1) ||
        a.hero - b.hero ||
        a.cost - b.cost ||
        a.tile.y - b.tile.y ||
        a.tile.x - b.tile.x,
    );
  for (const { tile, cost } of candidates) {
    if (!keepsWay(tile)) continue;
    if (cost <= allowance) return { moveTo: bare(tile), attack: null };
    return stopClearOfHazards(enemy.at, stops, walkDistanceTo(board, enemy, tile), burn);
  }
  return null;
}

/**
 * Who watches what: each post, in order, to the nearest monster not already
 * watching one (straight line to the post's nearest tile, then reading
 * order, then id). Every monster computes the same answer from the same
 * board, which is the whole of the "coordination".
 */
function assignPosts(posts: readonly Post[], monsters: readonly Actor[]): Map<ActorId, Post> {
  const out = new Map<ActorId, Post>();
  const lineToPost = (at: Position, post: Post) => Math.min(...post.tiles.map((tile) => stepsBetween(at, tile)));
  for (const post of posts) {
    const free = monsters
      .filter((m) => !out.has(m.id))
      .sort((a, b) => lineToPost(a, post) - lineToPost(b, post) || a.y - b.y || a.x - b.x || compareIds(a.id, b.id));
    const nearest = free[0];
    if (!nearest) break;
    out.set(nearest.id, post);
  }
  return out;
}

function besidePost(at: Position, post: Post): boolean {
  return post.tiles.some((tile) => stepsBetween(at, tile) === 1);
}

/** Every tile next to one of the post's tiles (not one of them), once, in reading order. */
function postTiles(board: Board, post: Post): Position[] {
  const out: Position[] = [];
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const at = { x, y };
      if (inBounds(board, at) && besidePost(at, post) && !post.tiles.some((tile) => samePosition(tile, at))) out.push(at);
    }
  }
  return out;
}

/**
 * With the monster standing on `stand`, can some standing hero still walk to
 * the post — to one of the exit's tiles, or to a tile beside the captive? The
 * guarantee the checker's flood fill made for the empty map, kept for the
 * board as it is, so a guard contests a way out without ever closing it.
 */
function leavesAWay(
  board: Board,
  mover: Actor,
  stand: Position,
  post: Post,
  standing: readonly PartyTarget[],
): boolean {
  const after = samePosition(stand, mover) ? board : moveActor(board, mover.id, stand);
  const goals =
    post.kind === "exit"
      ? post.tiles.filter((tile) => isOpen(after, tile))
      : postTiles(after, post).filter((tile) => isOpen(after, tile));
  if (post.kind === "captive" && standing.some((hero) => besidePost(hero.at, post))) return true;
  return standing.some((hero) => {
    const walk = walkField(after, hero.at);
    return goals.some((goal) => Number.isFinite(walk.dist(goal)));
  });
}

/** A bare tile, never a `ReachableTile` with its `cost` — see `closeTheGap`. */
function bare(at: Position): Position {
  return { x: at.x, y: at.y };
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
