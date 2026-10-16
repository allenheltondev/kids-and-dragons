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

import type { Branch, EncounterEnvironment, EncounterScene, EncounterMap, MapTile, RiftExit, EnvironmentHazard, EnvironmentObjective, HazardPush, RescueObjective } from "./types/chapter.js";
import type { SlowEffect } from "./types/buffs.js";
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
  /**
   * Present exactly when the spec has a `rescue`, in the spec's own form: one
   * status for one captive, a list (in authored order) for a list (#220).
   * Read it through `captiveStatuses`.
   */
  readonly rescue?: RescueStatus | readonly RescueStatus[];
  /**
   * What each captive has left before the monsters drag them off (#220), in
   * authored order — present only when some captive has `hp`. A captive
   * without `hp` has no entry worth reading (0) and is never worn down.
   */
  readonly captiveHp?: readonly number[];
  /**
   * How far along each objective is (#220), in authored order: rounds held,
   * turns spent closing. Present exactly when the spec has `objectives`.
   */
  readonly objectives?: readonly number[];
}

/** The bounds the checker holds an authored environment to. */
export const ENVIRONMENT_LIMITS = {
  /** The most captives one fight holds (#220). */
  captives: 3,
  /** The most objectives one fight holds, and the longest any can take (#220). */
  objectives: 3,
  objectiveCount: 12,
  /** The most a captive can take before the monsters drag them off (#220). */
  captiveHp: 6,
  /** A clock longer than this is not a clock anybody at the table feels. */
  clockRounds: 12,
  hazardDamage: 5,
  surge: 3,
  /** The farthest a pushing hazard throws (#220). */
  pushTiles: 3,
  /** A hazard's slow, held to the `"move"` buff limit and the buff duration cap (buffs.ts). */
  slowSteps: 2,
  slowTurns: 5,
} as const;

/** A modifier's limit per kind (#220): `BUFF_LIMITS` in buffs.ts, kept here because this file imports nothing. */
export const MODIFIER_LIMITS = { guard: 3, damage: 2, move: 2, roll: 3 } as const;

/** The combat buff a slowing hazard leaves (#220): Numbed's mechanism, the ground's name. */
export const SLOWED_BUFF_ID = "slowed";
export const SLOWED_LABEL = "Slowed";

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

/** Anything a hazard does besides hurting (#220). */
export function hazardHinders(hazard: EnvironmentHazard): boolean {
  return hazard.slow !== undefined || hazard.root === true || hazard.push !== undefined;
}

/**
 * How much a monster minds stopping on a hazard: its damage, and one more if
 * it also slows, holds or pushes — so ground that only sticks is still ground
 * worth stepping round, and never worth more than ground that burns harder.
 */
export function hazardWeight(hazard: EnvironmentHazard | null): number {
  if (!hazard) return 0;
  return (hazard.damage ?? 0) + (hazardHinders(hazard) ? 1 : 0);
}

/** How much an objective needs: rounds held, or turns spent closing (#220). */
export function objectiveTarget(objective: EnvironmentObjective): number {
  return objective.kind === "hold" ? objective.rounds : objective.turns;
}

/** The tiles an objective is drawn on: the ground to hold, or the tear itself. */
export function objectiveTiles(objective: EnvironmentObjective): readonly MapTile[] {
  return objective.kind === "hold" ? objective.tiles : [objective.at];
}

/** Every objective done, by index, in a fight with an environment. */
export function objectivesDone(env: EnvironmentState): boolean[] {
  return (env.spec.objectives ?? []).map((objective, i) => (env.objectives?.[i] ?? 0) >= objectiveTarget(objective));
}

/** One tile's step for a push direction; north is up the map (y − 1). */
export function pushStep(direction: HazardPush["direction"]): MapTile {
  switch (direction) {
    case "north":
      return { x: 0, y: -1 };
    case "south":
      return { x: 0, y: 1 };
    case "east":
      return { x: 1, y: 0 };
    default:
      return { x: -1, y: 0 };
  }
}

/** The active hazard on a tile this round, the first authored if several. */
export function hazardAt(spec: EncounterEnvironment, round: number, at: MapTile): EnvironmentHazard | null {
  return (spec.hazards ?? []).find((h) => hazardActive(h, round) && onTile(h.tiles, at)) ?? null;
}

/** The open exit on a tile this round, if any. */
export function openExitAt(spec: EncounterEnvironment, round: number, at: MapTile): RiftExit | null {
  return (spec.exits ?? []).find((e) => exitOpen(e, round) && onTile(e.tiles, at)) ?? null;
}

/** Every captive the spec holds, in authored order: none, the one, or the list (#220). */
export function captivesOf(spec: Pick<EncounterEnvironment, "rescue">): readonly RescueObjective[] {
  const rescue = spec.rescue;
  if (rescue === undefined) return [];
  return Array.isArray(rescue) ? rescue : [rescue as RescueObjective];
}

/** What became of each captive, in authored order. */
export function captiveStatuses(env: Pick<EnvironmentState, "rescue">): readonly RescueStatus[] {
  const rescue = env.rescue;
  if (rescue === undefined) return [];
  return Array.isArray(rescue) ? rescue : [rescue as RescueStatus];
}

/** The environment with captive `index`'s status changed, kept in the spec's form. */
export function withCaptiveStatus(env: EnvironmentState, index: number, status: RescueStatus): EnvironmentState {
  if (!Array.isArray(env.rescue)) return { ...env, rescue: status };
  const next = [...env.rescue];
  next[index] = status;
  return { ...env, rescue: next };
}

/** The `captive` index an event carries: only for a list, so one captive's events read as they always did. */
export function captiveIndexField(spec: Pick<EncounterEnvironment, "rescue">, index: number): { captive?: number } {
  return Array.isArray(spec.rescue) ? { captive: index } : {};
}

/** The name of the captive an event names (by its `captive` index, else the first). */
export function captiveName(spec: Pick<EncounterEnvironment, "rescue"> | undefined, index?: number): string {
  return (spec ? captivesOf(spec)[index ?? 0]?.name : undefined) ?? "the captive";
}

/**
 * The last round a captive can still be freed in: its `byRound`, else the
 * clock's last round, else never lost (null). Without `captive`, the first.
 */
export function rescueDeadline(spec: EncounterEnvironment, captive?: RescueObjective): number | null {
  return (captive ?? captivesOf(spec)[0])?.byRound ?? spec.clock?.rounds ?? null;
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
  /** 0 for ground that does not hurt (#220). */
  readonly damage: number;
  /** What else stopping here does (#220), when it does. */
  readonly slow?: SlowEffect;
  readonly root?: true;
  readonly push?: { readonly direction: HazardPush["direction"]; readonly tiles: number };
  readonly active: boolean;
  /**
   * Burnt out for good: past its `untilRound`. Without this a reader could
   * only see "not active" and had to guess between "not yet" and "never
   * again" — the TV board draws the first faint and the second not at all.
   */
  readonly gone?: true;
}

export interface EnvironmentRescueView {
  readonly name: string;
  readonly at: MapTile;
  readonly status: RescueStatus;
  /** Rounds left to free them, counting this one, while waiting with a deadline. */
  readonly roundsLeft?: number;
  /** A captive the monsters can drag off (#220): what they have left, and started with. */
  readonly hp?: number;
  readonly maxHp?: number;
}

export interface EnvironmentModifierView {
  readonly id: string;
  readonly label: string;
  readonly kind: "guard" | "damage" | "move" | "roll";
  readonly amount: number;
  readonly on: "everyone" | "party" | "monsters";
}

export interface EnvironmentView {
  readonly clock?: EnvironmentClockView;
  /** The place's own numbers (#220), as authored. What they add is in the fight's buffs. */
  readonly modifiers: readonly EnvironmentModifierView[];
  readonly exits: readonly EnvironmentExitView[];
  readonly hazards: readonly EnvironmentHazardView[];
  /** Every captive, in authored order (#220): one, several, or none. */
  readonly captives: readonly EnvironmentRescueView[];
  /** Heroes already through an exit. */
  readonly escaped: readonly string[];
  /** Everything else to get done (#220), in authored order. */
  readonly objectives: readonly EnvironmentObjectiveView[];
}

export interface EnvironmentObjectiveView {
  readonly id: string;
  readonly kind: EnvironmentObjective["kind"];
  readonly label: string;
  readonly tiles: readonly MapTile[];
  /** Rounds held or turns spent so far, never past `target`. */
  readonly progress: number;
  readonly target: number;
  readonly done: boolean;
  /** Getting it done ends the fight as a victory. */
  readonly endsFight?: true;
}

/** Everything about the fight's environment a phone shows, or null without one. */
export function environmentView(state: EncounterState): EnvironmentView | null {
  const env = state.environment;
  if (!env) return null;
  const { spec } = env;
  const round = state.round;
  const clock = spec.clock;
  const statuses = captiveStatuses(env);
  return {
    modifiers: (spec.modifiers ?? []).map((m) => ({ id: m.id, label: m.label, kind: m.kind, amount: m.amount, on: m.on ?? "everyone" })),
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
      damage: hazard.damage ?? 0,
      ...(hazard.slow ? { slow: { steps: hazard.slow.steps, turns: hazard.slow.turns } } : {}),
      ...(hazard.root ? { root: true as const } : {}),
      ...(hazard.push ? { push: { direction: hazard.push.direction, tiles: hazard.push.tiles ?? 1 } } : {}),
      active: hazardActive(hazard, round),
      ...(hazard.untilRound !== undefined && round > hazard.untilRound ? { gone: true as const } : {}),
    })),
    captives: captivesOf(spec).map((captive, i) => {
      const status = statuses[i] ?? "waiting";
      const deadline = rescueDeadline(spec, captive);
      const hp = env.captiveHp?.[i];
      return {
        name: captive.name,
        at: captive.at,
        status,
        ...(status === "waiting" && deadline !== null ? { roundsLeft: Math.max(0, deadline - round + 1) } : {}),
        ...(captive.hp !== undefined ? { hp: hp ?? captive.hp, maxHp: captive.hp } : {}),
      };
    }),
    escaped: state.combatants.filter(hasEscaped).map((c) => c.id),
    objectives: (spec.objectives ?? []).map((objective, i) => {
      const target = objectiveTarget(objective);
      const progress = Math.min(target, env.objectives?.[i] ?? 0);
      return {
        id: objective.id,
        kind: objective.kind,
        label: objective.label,
        tiles: objectiveTiles(objective),
        progress,
        target,
        done: progress >= target,
        ...(objective.endsFight ? { endsFight: true as const } : {}),
      };
    }),
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
    if (hazard.damage !== undefined && (!isInt(hazard.damage) || hazard.damage < 1 || hazard.damage > ENVIRONMENT_LIMITS.hazardDamage)) {
      fail(`${at}/damage`, `must be a whole number from 1 to ${ENVIRONMENT_LIMITS.hazardDamage}`);
    }
    if (hazard.damage === undefined && !hazardHinders(hazard)) {
      fail(at, "a hazard must do something: damage, slow, root or push");
    }
    if (hazard.slow !== undefined) {
      const { steps, turns } = hazard.slow ?? ({} as SlowEffect);
      if (!isInt(steps) || steps < 1 || steps > ENVIRONMENT_LIMITS.slowSteps) {
        fail(`${at}/slow/steps`, `must be a whole number from 1 to ${ENVIRONMENT_LIMITS.slowSteps}`);
      }
      if (!isInt(turns) || turns < 1 || turns > ENVIRONMENT_LIMITS.slowTurns) {
        fail(`${at}/slow/turns`, `must be a whole number from 1 to ${ENVIRONMENT_LIMITS.slowTurns}`);
      }
    }
    if (hazard.root !== undefined && hazard.root !== true) fail(`${at}/root`, "is true or absent");
    if (hazard.push !== undefined) {
      if (!["north", "south", "east", "west"].includes(hazard.push?.direction)) {
        fail(`${at}/push/direction`, 'must be "north", "south", "east" or "west"');
      }
      const n = hazard.push?.tiles;
      if (n !== undefined && (!isInt(n) || n < 1 || n > ENVIRONMENT_LIMITS.pushTiles)) {
        fail(`${at}/push/tiles`, `must be a whole number from 1 to ${ENVIRONMENT_LIMITS.pushTiles}`);
      }
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

  // --- rescue: one captive, or a list of them (#220)
  const captives = captivesOf(env);
  if (Array.isArray(env.rescue) && (env.rescue.length < 1 || env.rescue.length > ENVIRONMENT_LIMITS.captives)) {
    fail("/environment/rescue", `a list of 1 to ${ENVIRONMENT_LIMITS.captives} captives`);
  }
  captives.forEach((rescue, i) => {
    const at = Array.isArray(env.rescue) ? `/environment/rescue/${i}` : "/environment/rescue";
    roundOk(rescue.byRound, `${at}/byRound`);
    if (rescue.hp !== undefined && (!isInt(rescue.hp) || rescue.hp < 1 || rescue.hp > ENVIRONMENT_LIMITS.captiveHp)) {
      fail(`${at}/hp`, `must be a whole number from 1 to ${ENVIRONMENT_LIMITS.captiveHp}`);
    }
    if (lastRound !== null && rescue.byRound !== undefined && rescue.byRound > lastRound) {
      fail(`${at}/byRound`, `round ${rescue.byRound} is after the clock collapses the fight at the end of round ${lastRound}`);
    }
    if (tileOk(rescue.at, `${at}/at`)) {
      if (partySpawns.has(key(rescue.at)) || enemySpawns.has(key(rescue.at))) {
        fail(`${at}/at`, `(${rescue.at.x}, ${rescue.at.y}) is a spawn point — the captive stands there, so nobody else can`);
      }
      claim(rescue.at, captives.length > 1 ? `the captive ${rescue.name} (${i + 1})` : "the captive", `${at}/at`);
      if (map?.rows) {
        const beside = neighbours(rescue.at, width, height).filter(
          (t) => map.rows[t.y]?.[t.x] === "." && !captives.some((c) => c.at.x === t.x && c.at.y === t.y),
        );
        if (beside.length === 0) fail(`${at}/at`, "nobody can stand next to the captive, so they can never be freed");
      }
    }
  });

  // --- objectives (#220)
  const objectives = env.objectives ?? [];
  if (objectives.length > ENVIRONMENT_LIMITS.objectives) {
    fail("/environment/objectives", `at most ${ENVIRONMENT_LIMITS.objectives} objectives`);
  }
  objectives.forEach((objective, i) => {
    const at = `/environment/objectives/${i}`;
    seenId(objective.id, `${at}/id`);
    const count = objective.kind === "hold" ? objective.rounds : objective.kind === "close" ? objective.turns : undefined;
    const countKey = objective.kind === "hold" ? "rounds" : "turns";
    if (objective.kind !== "hold" && objective.kind !== "close") {
      fail(`${at}/kind`, 'must be "hold" or "close"');
      return;
    }
    if (!isInt(count) || count < 1 || count > ENVIRONMENT_LIMITS.objectiveCount) {
      fail(`${at}/${countKey}`, `must be a whole number from 1 to ${ENVIRONMENT_LIMITS.objectiveCount}`);
    }
    if (objective.kind === "hold" && lastRound !== null && isInt(count) && count > lastRound) {
      fail(`${at}/rounds`, `${count} rounds can never be held — the clock collapses the fight at the end of round ${lastRound}`);
    }
    if (objective.endsFight !== undefined && objective.endsFight !== true) fail(`${at}/endsFight`, "is true or absent");
    const tiles = objective.kind === "hold" ? objective.tiles ?? [] : [objective.at];
    const where = (j: number) => (objective.kind === "hold" ? `${at}/tiles/${j}` : `${at}/at`);
    tiles.forEach((tile, j) => {
      if (!tileOk(tile, where(j))) return;
      if (objective.kind === "hold" && partySpawns.has(key(tile))) {
        fail(where(j), `(${tile.x}, ${tile.y}) is a party spawn — the party would hold it without moving`);
      }
      claim(tile, `objective "${objective.id}"`, where(j));
    });
  });

  // --- modifiers (#220)
  const modifiers = env.modifiers ?? [];
  if (modifiers.length > ENVIRONMENT_LIMITS.objectives) fail("/environment/modifiers", `at most ${ENVIRONMENT_LIMITS.objectives} modifiers`);
  modifiers.forEach((modifier, i) => {
    const at = `/environment/modifiers/${i}`;
    seenId(modifier.id, `${at}/id`);
    if (modifier.id === "numbed" || modifier.id === SLOWED_BUFF_ID) fail(`${at}/id`, `"${modifier.id}" is a name the fight gives its own stings and slows`);
    const limit = MODIFIER_LIMITS[modifier.kind as keyof typeof MODIFIER_LIMITS];
    if (limit === undefined) {
      fail(`${at}/kind`, 'must be "guard", "damage", "move" or "roll"');
      return;
    }
    if (!isInt(modifier.amount) || modifier.amount === 0 || Math.abs(modifier.amount) > limit) {
      fail(`${at}/amount`, `must be a non-zero whole number from -${limit} to ${limit} (the ${modifier.kind} limit)`);
    }
    if (modifier.on !== undefined && !["everyone", "party", "monsters"].includes(modifier.on)) {
      fail(`${at}/on`, 'must be "everyone", "party" or "monsters"');
    }
  });

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
    if (tileOk(move.to, `${at}/to`) && claimed.get(key(move.to))?.startsWith("the captive")) {
      fail(`${at}/to`, "that is where the captive stands");
    }
  });

  // --- reach: an exit, or the captive, the party cannot walk to is a lie
  if (map?.rows && map.partySpawns?.[0]) {
    const blocked = new Set<string>(captives.map((c) => key(c.at)));
    const reach = flood(map.rows, map.partySpawns[0], blocked);
    exits.forEach((exit, i) => {
      if ((exit.tiles ?? []).length > 0 && !(exit.tiles ?? []).some((t) => reach.has(key(t)))) {
        fail(`/environment/exits/${i}/tiles`, `no hero can walk to exit "${exit.id}"`);
      }
    });
    objectives.forEach((objective, i) => {
      const goals = objective.kind === "hold" ? objective.tiles ?? [] : [objective.at, ...neighbours(objective.at, width, height)];
      if (goals.length > 0 && !goals.some((t) => reach.has(key(t)))) {
        fail(`/environment/objectives/${i}`, `no hero can walk to objective "${objective.id}"`);
      }
    });
    captives.forEach((rescue, i) => {
      if (!neighbours(rescue.at, width, height).some((t) => reach.has(key(t)))) {
        fail(Array.isArray(env.rescue) ? `/environment/rescue/${i}/at` : "/environment/rescue/at", "no hero can walk to the captive");
      }
    });
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
