/**
 * Environmental combat (#201) — the place fighting back.
 *
 * An encounter scene may carry an `environment` (types/chapter.ts
 * `EncounterEnvironment`): a visible rift clock, ground that hurts, exits that
 * open and close, somebody to rescue, monsters the rift spits elsewhere. This
 * module is the part of that which is *data*: what the fight stores about its
 * environment, the read rules (is this exit open in round 3? is this tile on
 * fire?), the view the phones draw, and the authoring check. The part that is
 * *turns* — when a hazard bites, when a hero steps through — lives in
 * encounter.ts beside the turn loop it hooks (`endTurnWithEvents`).
 *
 * ---------------------------------------------------------------------------
 * WHY TURN ENDS AND ROUND STARTS, AND NOTHING ELSE
 *
 * Every environmental rule fires at one of two moments: the end of a figure's
 * own turn ("where you stop": hazards, exits, a rescue) or the start of a
 * round (the clock, a surge, a relocation). Never during a move, never inside
 * an action. So `moveTo`, `performAction`, `legalMoves` and `legalActions` —
 * the base loop every campaign shares, and the one gate the phones and the
 * server both read — are exactly what they were, and an environment can only
 * add consequences *between* the decisions that loop already offers. That is
 * the "avoid rewriting base combat globally" line drawn where a child can see
 * it: walk across the fire freely, just don't stop on it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SPEC RIDES IN THE STATE
 *
 * `EncounterState.environment.spec` is a copy of what the scene authored. The
 * fight has to survive a JSON round trip on its own (the same reason
 * `openingOrder` is stored), and the phones draw hazard and exit tiles from
 * the encounter they hold — they never load the chapter's scene to do it.
 *
 * ---------------------------------------------------------------------------
 * WHY IMPORT-FREE
 *
 * tools/content/validate.mjs loads this file straight under Node to run
 * `checkEncounterEnvironment`, so it takes type imports only (the rule
 * world-state.ts and buffs.ts already live by).
 */

import type { Branch, EncounterEnvironment, EncounterScene, EncounterMap, MapTile, RiftExit, EnvironmentHazard } from "./types/chapter.js";
import type { Combatant, EncounterState } from "./encounter.js";

/** What became of the person to rescue. */
export type RescueStatus = "waiting" | "freed" | "lost";

/**
 * What a fight remembers about its environment. Present only on a fight whose
 * scene declared one; every other fight — every Gemfall fight — has no
 * `environment` key at all.
 */
export interface EnvironmentState {
  /** The scene's `environment`, as authored. See "why the spec rides in the state". */
  readonly spec: EncounterEnvironment;
  /** The clock ran out: a round started past `clock.rounds`. Never unset. */
  readonly expired: boolean;
  /** Present exactly when the spec has a `rescue`. */
  readonly rescue?: RescueStatus;
}

/** The bounds the checker holds an authored environment to. */
export const ENVIRONMENT_LIMITS = {
  /** A clock longer than this is not a clock anybody at the table feels. */
  clockRounds: 12,
  hazardDamage: 5,
  surge: 3,
} as const;

/** How hard a surge hits when the clock does not say. */
export const DEFAULT_SURGE = 1;

// ---------------------------------------------------------------------------
// Reading the rules
// ---------------------------------------------------------------------------

function onTile(tiles: readonly MapTile[], at: MapTile): boolean {
  return tiles.some((tile) => tile.x === at.x && tile.y === at.y);
}

function within(round: number, from: number | undefined, until: number | undefined): boolean {
  return round >= (from ?? 1) && (until === undefined || round <= until);
}

export function exitOpen(exit: RiftExit, round: number): boolean {
  return within(round, exit.opensRound, exit.closesRound);
}

export function hazardActive(hazard: EnvironmentHazard, round: number): boolean {
  return within(round, hazard.fromRound, hazard.untilRound);
}

/** The active hazard on a tile this round, the first authored if several. */
export function hazardAt(spec: EncounterEnvironment, round: number, at: MapTile): EnvironmentHazard | null {
  return (spec.hazards ?? []).find((h) => hazardActive(h, round) && onTile(h.tiles, at)) ?? null;
}

/** The open exit on a tile this round, if any. */
export function openExitAt(spec: EncounterEnvironment, round: number, at: MapTile): RiftExit | null {
  return (spec.exits ?? []).find((e) => exitOpen(e, round) && onTile(e.tiles, at)) ?? null;
}

/**
 * The last round the captive can still be freed in: `byRound`, else the
 * clock's last round, else never lost (null).
 */
export function rescueDeadline(spec: EncounterEnvironment): number | null {
  return spec.rescue?.byRound ?? spec.clock?.rounds ?? null;
}

/** Off the board, by stepping through an exit. */
export function hasEscaped(combatant: Combatant): boolean {
  return combatant.escaped === true;
}

/**
 * The branch a finished fight takes. `onEscape` / `onTimeout` are required by
 * the checker whenever the environment can produce them; the fallback to
 * `onDefeat` is only what a hand-built scene without them gets, so a missing
 * branch can never strand a run.
 */
export function outcomeBranch(
  scene: Pick<EncounterScene, "onVictory" | "onDefeat" | "onEscape" | "onTimeout">,
  outcome: "victory" | "defeat" | "escaped" | "timedOut",
): Branch {
  switch (outcome) {
    case "victory":
      return scene.onVictory;
    case "escaped":
      return scene.onEscape ?? scene.onDefeat;
    case "timedOut":
      return scene.onTimeout ?? scene.onDefeat;
    default:
      return scene.onDefeat;
  }
}

// ---------------------------------------------------------------------------
// What the phones draw
// ---------------------------------------------------------------------------

export interface EnvironmentClockView {
  readonly label: string;
  readonly onExpire: "collapse" | "surge";
  /**
   * Rounds still to play before the rift acts, counting this one: 1 means
   * "at the end of this round". 0 once it has run out.
   */
  readonly roundsLeft: number;
  readonly expired: boolean;
  /** What a surge costs each hero, each round past the clock. */
  readonly surge?: number;
}

export interface EnvironmentExitView {
  readonly id: string;
  readonly label: string;
  readonly tiles: readonly MapTile[];
  readonly open: boolean;
  /** Rounds until it opens, while it has not yet. */
  readonly opensIn?: number;
  /** Rounds it stays open, counting this one, when it will close. */
  readonly closesIn?: number;
  /** Closed for good. */
  readonly gone?: true;
}

export interface EnvironmentHazardView {
  readonly id: string;
  readonly kind: EnvironmentHazard["kind"];
  readonly label: string;
  readonly tiles: readonly MapTile[];
  readonly damage: number;
  readonly active: boolean;
}

export interface EnvironmentRescueView {
  readonly name: string;
  readonly at: MapTile;
  readonly status: RescueStatus;
  /** Rounds left to free them, counting this one, while waiting with a deadline. */
  readonly roundsLeft?: number;
}

export interface EnvironmentView {
  readonly clock?: EnvironmentClockView;
  readonly exits: readonly EnvironmentExitView[];
  readonly hazards: readonly EnvironmentHazardView[];
  readonly rescue?: EnvironmentRescueView;
  /** Heroes already through an exit. */
  readonly escaped: readonly string[];
}

/** Everything about the fight's environment a phone shows, or null without one. */
export function environmentView(state: EncounterState): EnvironmentView | null {
  const env = state.environment;
  if (!env) return null;
  const { spec } = env;
  const round = state.round;
  const clock = spec.clock;
  const deadline = rescueDeadline(spec);
  return {
    ...(clock
      ? {
          clock: {
            label: clock.label,
            onExpire: clock.onExpire,
            roundsLeft: env.expired ? 0 : Math.max(0, clock.rounds - round + 1),
            expired: env.expired,
            ...(clock.onExpire === "surge" ? { surge: clock.surge ?? DEFAULT_SURGE } : {}),
          },
        }
      : {}),
    exits: (spec.exits ?? []).map((exit) => {
      const open = exitOpen(exit, round);
      const opens = exit.opensRound ?? 1;
      return {
        id: exit.id,
        label: exit.label,
        tiles: exit.tiles,
        open,
        ...(!open && round < opens ? { opensIn: opens - round } : {}),
        ...(open && exit.closesRound !== undefined ? { closesIn: exit.closesRound - round + 1 } : {}),
        ...(!open && exit.closesRound !== undefined && round > exit.closesRound ? { gone: true as const } : {}),
      };
    }),
    hazards: (spec.hazards ?? []).map((hazard) => ({
      id: hazard.id,
      kind: hazard.kind,
      label: hazard.label,
      tiles: hazard.tiles,
      damage: hazard.damage,
      active: hazardActive(hazard, round),
    })),
    ...(spec.rescue && env.rescue
      ? {
          rescue: {
            name: spec.rescue.name,
            at: spec.rescue.at,
            status: env.rescue,
            ...(env.rescue === "waiting" && deadline !== null
              ? { roundsLeft: Math.max(0, deadline - round + 1) }
              : {}),
          },
        }
      : {}),
    escaped: state.combatants.filter(hasEscaped).map((c) => c.id),
  };
}

// ---------------------------------------------------------------------------
// The authoring check
// ---------------------------------------------------------------------------

export interface EnvironmentProblem {
  /** JSON pointer, relative to the scene. */
  readonly path: string;
  readonly problem: string;
}

const WIDTH = 10;
const HEIGHT = 8;

/**
 * Everything about a scene's environment that the schema cannot say: tiles on
 * the board and on open ground, the right branches present for what the
 * environment can end in (and none it cannot), windows that are possible,
 * exits a hero can actually reach, a captive somebody can stand beside.
 *
 * `map` is optional: without it (the shared `validateChapter`, which has no
 * maps) only the map-free rules run; content:validate passes the map.
 *
 * A scene without `environment` is checked only for the branches it must not
 * carry — `onEscape` / `onTimeout` with nothing that could take them.
 */
export function checkEncounterEnvironment(
  scene: Pick<EncounterScene, "environment" | "onEscape" | "onTimeout" | "enemies">,
  map?: Pick<EncounterMap, "rows" | "partySpawns" | "enemySpawns"> | null,
): EnvironmentProblem[] {
  const out: EnvironmentProblem[] = [];
  const fail = (path: string, problem: string) => out.push({ path, problem });
  const env = scene.environment;

  const collapses = env?.clock?.onExpire === "collapse";
  const exits = env?.exits ?? [];
  if (exits.length > 0 && !scene.onEscape) {
    fail("/onEscape", "an environment with exits needs an onEscape branch — stepping through one ends the fight");
  }
  if (scene.onEscape && exits.length === 0) {
    fail("/onEscape", "onEscape with no environment exits — nothing can ever take it");
  }
  if (collapses && !scene.onTimeout) {
    fail("/onTimeout", 'a "collapse" clock needs an onTimeout branch — running out ends the fight');
  }
  if (scene.onTimeout && !collapses) {
    fail("/onTimeout", 'onTimeout without a "collapse" clock — nothing can ever take it');
  }
  if (!env) return out;

  const width = map?.rows?.[0]?.length ?? WIDTH;
  const height = map?.rows?.length ?? HEIGHT;
  const key = (t: MapTile) => `${t.x},${t.y}`;
  const partySpawns = new Set((map?.partySpawns ?? []).map(key));
  const enemySpawns = new Set((map?.enemySpawns ?? []).map(key));
  const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

  /** A tile on the board and, with a map, on open ground. */
  const tileOk = (tile: MapTile, path: string): boolean => {
    if (!isInt(tile?.x) || !isInt(tile?.y) || tile.x < 0 || tile.y < 0 || tile.x >= width || tile.y >= height) {
      fail(path, `(${tile?.x}, ${tile?.y}) is off the ${width}×${height} board`);
      return false;
    }
    if (map?.rows && map.rows[tile.y]?.[tile.x] !== ".") {
      fail(path, `(${tile.x}, ${tile.y}) is a blocked tile on the map`);
      return false;
    }
    return true;
  };
  const roundOk = (n: number | undefined, path: string, min = 1): void => {
    if (n !== undefined && (!isInt(n) || n < min)) fail(path, `must be a whole number of rounds, at least ${min}`);
  };
  /** Which feature claimed each tile first: exits, hazards and the captive never share. */
  const claimed = new Map<string, string>();
  const claim = (tile: MapTile, what: string, path: string): void => {
    const k = key(tile);
    const before = claimed.get(k);
    if (before && before !== what) fail(path, `(${tile.x}, ${tile.y}) is already ${before}`);
    else claimed.set(k, what);
  };

  // --- clock
  const clock = env.clock;
  if (clock) {
    if (!isInt(clock.rounds) || clock.rounds < 1 || clock.rounds > ENVIRONMENT_LIMITS.clockRounds) {
      fail("/environment/clock/rounds", `must be a whole number from 1 to ${ENVIRONMENT_LIMITS.clockRounds}`);
    }
    if (clock.surge !== undefined) {
      if (clock.onExpire !== "surge") fail("/environment/clock/surge", 'surge only means something with onExpire "surge"');
      else if (!isInt(clock.surge) || clock.surge < 1 || clock.surge > ENVIRONMENT_LIMITS.surge) {
        fail("/environment/clock/surge", `must be a whole number from 1 to ${ENVIRONMENT_LIMITS.surge}`);
      }
    }
  }
  /** The last round anything can happen in, when the clock ends the fight. */
  const lastRound = collapses && clock ? clock.rounds : null;

  // --- exits
  const ids = new Set<string>();
  const seenId = (id: string, path: string): void => {
    if (ids.has(id)) fail(path, `id "${id}" is used twice in this environment`);
    ids.add(id);
  };
  exits.forEach((exit, i) => {
    const at = `/environment/exits/${i}`;
    seenId(exit.id, `${at}/id`);
    roundOk(exit.opensRound, `${at}/opensRound`);
    roundOk(exit.closesRound, `${at}/closesRound`);
    if (exit.opensRound !== undefined && exit.closesRound !== undefined && exit.closesRound < exit.opensRound) {
      fail(`${at}/closesRound`, "closes before it opens");
    }
    if (lastRound !== null && (exit.opensRound ?? 1) > lastRound) {
      fail(`${at}/opensRound`, `opens in round ${exit.opensRound}, after the clock collapses the fight at the end of round ${lastRound}`);
    }
    (exit.tiles ?? []).forEach((tile, j) => {
      if (!tileOk(tile, `${at}/tiles/${j}`)) return;
      if (partySpawns.has(key(tile))) fail(`${at}/tiles/${j}`, `(${tile.x}, ${tile.y}) is a party spawn — a hero would leave on their first turn`);
      claim(tile, `exit "${exit.id}"`, `${at}/tiles/${j}`);
    });
  });

  // --- hazards
  (env.hazards ?? []).forEach((hazard, i) => {
    const at = `/environment/hazards/${i}`;
    seenId(hazard.id, `${at}/id`);
    if (!isInt(hazard.damage) || hazard.damage < 1 || hazard.damage > ENVIRONMENT_LIMITS.hazardDamage) {
      fail(`${at}/damage`, `must be a whole number from 1 to ${ENVIRONMENT_LIMITS.hazardDamage}`);
    }
    roundOk(hazard.fromRound, `${at}/fromRound`);
    roundOk(hazard.untilRound, `${at}/untilRound`);
    if (hazard.fromRound !== undefined && hazard.untilRound !== undefined && hazard.untilRound < hazard.fromRound) {
      fail(`${at}/untilRound`, "ends before it starts");
    }
    (hazard.tiles ?? []).forEach((tile, j) => {
      if (!tileOk(tile, `${at}/tiles/${j}`)) return;
      if (partySpawns.has(key(tile))) fail(`${at}/tiles/${j}`, `(${tile.x}, ${tile.y}) is a party spawn — a hero would be hurt for standing where the fight put them`);
      claim(tile, `hazard "${hazard.id}"`, `${at}/tiles/${j}`);
    });
  });

  // --- rescue
  const rescue = env.rescue;
  if (rescue) {
    const at = "/environment/rescue";
    roundOk(rescue.byRound, `${at}/byRound`);
    if (lastRound !== null && rescue.byRound !== undefined && rescue.byRound > lastRound) {
      fail(`${at}/byRound`, `round ${rescue.byRound} is after the clock collapses the fight at the end of round ${lastRound}`);
    }
    if (tileOk(rescue.at, `${at}/at`)) {
      if (partySpawns.has(key(rescue.at)) || enemySpawns.has(key(rescue.at))) {
        fail(`${at}/at`, `(${rescue.at.x}, ${rescue.at.y}) is a spawn point — the captive stands there, so nobody else can`);
      }
      claim(rescue.at, "the captive", `${at}/at`);
      if (map?.rows) {
        const beside = neighbours(rescue.at, width, height).filter((t) => map.rows[t.y]?.[t.x] === ".");
        if (beside.length === 0) fail(`${at}/at`, "nobody can stand next to the captive, so they can never be freed");
      }
    }
  }

  // --- relocations
  const counts = new Map<string, number>();
  for (const spec of scene.enemies ?? []) {
    // The authored shape may leave `count` to canon; one is the least it can be.
    counts.set(spec.id, (counts.get(spec.id) ?? 0) + (isInt(spec.count) ? spec.count : 1));
  }
  (env.relocate ?? []).forEach((move, i) => {
    const at = `/environment/relocate/${i}`;
    roundOk(move.round, `${at}/round`, 2);
    if (lastRound !== null && isInt(move.round) && move.round > lastRound) {
      fail(`${at}/round`, `round ${move.round} never starts — the clock collapses the fight at the end of round ${lastRound}`);
    }
    const [specId, ordinal] = String(move.enemy).split("#");
    const n = Number(ordinal);
    if (!specId || !Number.isInteger(n) || n < 1 || n > (counts.get(specId) ?? 0)) {
      fail(`${at}/enemy`, `"${move.enemy}" is not one of this scene's enemies (ids are <enemy id>#<n>, from 1)`);
    }
    if (tileOk(move.to, `${at}/to`) && claimed.get(key(move.to)) === "the captive") {
      fail(`${at}/to`, "that is where the captive stands");
    }
  });

  // --- reach: an exit, or the captive, the party cannot walk to is a lie
  if (map?.rows && map.partySpawns?.[0]) {
    const blocked = new Set<string>(rescue ? [key(rescue.at)] : []);
    const reach = flood(map.rows, map.partySpawns[0], blocked);
    exits.forEach((exit, i) => {
      if ((exit.tiles ?? []).length > 0 && !(exit.tiles ?? []).some((t) => reach.has(key(t)))) {
        fail(`/environment/exits/${i}/tiles`, `no hero can walk to exit "${exit.id}"`);
      }
    });
    if (rescue && !neighbours(rescue.at, width, height).some((t) => reach.has(key(t)))) {
      fail("/environment/rescue/at", "no hero can walk to the captive");
    }
  }
  return out;
}

function neighbours(at: MapTile, width: number, height: number): MapTile[] {
  const out: MapTile[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = at.x + dx;
      const y = at.y + dy;
      if ((dx || dy) && x >= 0 && y >= 0 && x < width && y < height) out.push({ x, y });
    }
  }
  return out;
}

/** Open tiles reachable from `from`, eight directions, around `blocked`. */
function flood(rows: readonly string[], from: MapTile, blocked: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>([`${from.x},${from.y}`]);
  const queue: MapTile[] = [from];
  const width = rows[0]?.length ?? WIDTH;
  while (queue.length > 0) {
    const at = queue.pop() as MapTile;
    for (const next of neighbours(at, width, rows.length)) {
      const k = `${next.x},${next.y}`;
      if (seen.has(k) || blocked.has(k) || rows[next.y]?.[next.x] !== ".") continue;
      seen.add(k);
      queue.push(next);
    }
  }
  return seen;
}
