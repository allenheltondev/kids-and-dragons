/**
 * The enemy planner exactly as it stood before it learned about environments
 * (the #201 follow-up), frozen for one job: `enemy-ai-environment.test.ts`
 * runs it beside today's `planEnemyTurn` over a seeded corpus of boards and
 * requires the same plan for every turn without an `environment`. That is the
 * proof that a fight without one — every Gemfall fight — gets the monsters it
 * always got, decision for decision, not just the ones a golden digest
 * happens to exercise.
 *
 * Never edit the logic below. If the base sentence ever changes on purpose,
 * change it here in the same commit and say why. The body is
 * `packages/shared/src/enemy-ai.ts` at f523449d with its comments stripped and
 * its one export renamed; the input and output shapes are imported from the
 * live module so the two are always handed the same thing. Not exported from
 * the package — only the test imports it.
 */

import { isOpen, reachableTiles, stepsBetween, tilesWithinSteps, walkField } from "../grid.js";
import type { Board, Position, WalkField } from "../grid.js";
import type { EnemyPlan, EnemyTurn, PartyTarget } from "../enemy-ai.js";

const HOLD: EnemyPlan = { moveTo: null, attack: null };

const DEFAULT_REACH = 1;

export function planEnemyTurnBeforeEnvironment(turn: EnemyTurn): EnemyPlan {
  const { board, enemy } = turn;
  const allowance = wholeSteps(enemy.steps);
  const reach = Math.max(1, wholeSteps(enemy.reach ?? DEFAULT_REACH));
  const standing = turn.party.filter((hero) => !hero.down);
  if (standing.length === 0) return HOLD;

  const field = walkField(board, enemy.at);

  const best = standing
    .map((hero) => rateApproach(board, field, enemy.at, reach, hero))
    .sort(compareApproaches)[0];
  if (!best) return HOLD;
  if (best.cost === 0) return { moveTo: null, attack: best.target.id };
  if (best.cost <= allowance) return { moveTo: best.tile, attack: best.target.id };
  if (Number.isFinite(best.cost) && best.tile) {
    return { moveTo: walkToward(board, field, best.tile, allowance), attack: null };
  }
  return { moveTo: closeTheGap(board, enemy.at, best.target.at, allowance), attack: null };
}

interface Approach {
  readonly target: PartyTarget;
  readonly cost: number;
  readonly tile: Position | null;
  readonly line: number;
}

function rateApproach(
  board: Board,
  field: WalkField,
  from: Position,
  reach: number,
  target: PartyTarget,
): Approach {
  const line = stepsBetween(from, target.at);
  if (line <= reach) return { target, cost: 0, tile: null, line };

  let cost = Infinity;
  let tile: Position | null = null;
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

function compareApproaches(a: Approach, b: Approach): number {
  return (
    a.cost - b.cost ||
    a.line - b.line ||
    a.target.at.y - b.target.at.y ||
    a.target.at.x - b.target.at.x ||
    (a.target.id < b.target.id ? -1 : a.target.id > b.target.id ? 1 : 0)
  );
}

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
      best = { x: tile.x, y: tile.y };
    }
  }
  return best;
}

function wholeSteps(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
