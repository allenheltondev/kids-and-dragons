/**
 * The enemy planner in a place that fights back (#201 follow-up): the three
 * sentences `planEnemyTurn` adds when a fight has an `environment` — it does
 * not stop in the fire, the nearest monster watches the way out, the next one
 * watches the captive — and the promise that matters more than any of them:
 * a turn handed no environment is planned exactly as it was before any of
 * this existed. That last one is held to a frozen copy of the old planner
 * (testing/enemy-ai-before-environment.ts) over a seeded corpus, not to a few
 * hand-picked boards, because Gemfall's fights are every board.
 */

import { describe, expect, it } from "vitest";

import { EXIT_LOOKAHEAD, planEnemyTurn } from "./enemy-ai.js";
import type { EnemyEnvironment, EnemyTurn, PartyTarget } from "./enemy-ai.js";
import { createBoard, parseBoard, placeActor, setTerrain, stepsBetween, walkField } from "./grid.js";
import type { Actor, Board, Position } from "./grid.js";
import { planEnemyTurnBeforeEnvironment } from "./testing/enemy-ai-before-environment.js";
import type { EncounterEnvironment, EnvironmentHazard } from "./types/chapter.js";

const MONSTER = "shade#1";

function hero(id: string, at: Position, state: Partial<PartyTarget> = {}): PartyTarget {
  return { id, at, hp: 6, maxHp: 6, down: false, ...state };
}

function figure(who: PartyTarget): Actor {
  return { id: who.id, side: "party", x: who.at.x, y: who.at.y };
}

function monster(at: Position, id: string = MONSTER): Actor {
  return { id, side: "enemy", x: at.x, y: at.y };
}

/** A turn for MONSTER on `rows`, the party and any other monsters standing on the board too. */
function turn(
  rows: readonly string[],
  at: Position,
  party: readonly PartyTarget[],
  options: { steps?: number; reach?: number; others?: readonly Actor[]; environment?: EnemyEnvironment } = {},
): EnemyTurn {
  const board = [monster(at), ...party.map(figure), ...(options.others ?? [])].reduce(placeActor, parseBoard([...rows]));
  return {
    board,
    enemy: { id: MONSTER, at, steps: options.steps ?? 4, ...(options.reach !== undefined ? { reach: options.reach } : {}) },
    party,
    ...(options.environment ? { environment: options.environment } : {}),
  };
}

/** The same turn, with no environment: what the sentence alone would do. */
function bare(input: EnemyTurn): EnemyTurn {
  const { environment: _ignored, ...rest } = input;
  return rest;
}

function fire(tiles: readonly Position[], extra: Partial<EnvironmentHazard> = {}): EnvironmentHazard {
  return { id: "fire", kind: "fire", label: "Rift fire", tiles: tiles.map((t) => ({ ...t })), damage: 2, ...extra };
}

function place(spec: EncounterEnvironment, round = 1, rescue?: EnemyEnvironment["rescue"]): EnemyEnvironment {
  return { spec, round, ...(rescue ? { rescue } : {}) };
}

/** An open 8 x 6 field, as in enemy-ai.test.ts. */
const FIELD = ["........", "........", "........", "........", "........", "........"] as const;
/** The sandbox's size: 10 x 8, open. */
const OPEN = Array.from({ length: 8 }, () => "..........");

// ---------------------------------------------------------------------------
// No environment: the same monster, decision for decision
// ---------------------------------------------------------------------------

/** mulberry32 — a fixed, local generator so the corpus is the same corpus on every machine. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random fight-shaped turn: walls, a monster, one to four heroes (some down),
 * up to three more monsters, any allowance (fractional and zero included) and
 * reach. Built the way the engine builds one — everybody on the board.
 */
function randomTurn(next: () => number): EnemyTurn {
  const width = 4 + Math.floor(next() * 7);
  const height = 3 + Math.floor(next() * 6);
  let board: Board = createBoard(width, height);
  const free: Position[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (next() < 0.18) board = setTerrain(board, { x, y }, "blocked");
      else free.push({ x, y });
    }
  }
  const take = (): Position | null => (free.length === 0 ? null : free.splice(Math.floor(next() * free.length), 1)[0]!);
  const at = take() ?? { x: 0, y: 0 };
  board = setTerrain(board, at, "open");
  board = placeActor(board, monster(at));
  const party: PartyTarget[] = [];
  const heroes = 1 + Math.floor(next() * 4);
  for (let i = 0; i < heroes; i++) {
    const spot = take();
    if (!spot) break;
    const who = hero(`c_${String.fromCharCode(97 + Math.floor(next() * 26))}${i}`, spot, { down: next() < 0.2 });
    party.push(who);
    board = placeActor(board, figure(who));
  }
  const others = Math.floor(next() * 4);
  for (let i = 0; i < others; i++) {
    const spot = take();
    if (spot) board = placeActor(board, monster(spot, `wisp#${i + 1}`));
  }
  const steps = [0, 0.9, 1, 2, 2.9, 3, 4, 5, 6][Math.floor(next() * 9)]!;
  const reach = [undefined, 1, 2, 3, 0][Math.floor(next() * 5)];
  return { board, enemy: { id: MONSTER, at, steps, ...(reach !== undefined ? { reach } : {}) }, party };
}

describe("a fight without an environment", () => {
  const CORPUS = 4000;

  it(`plans exactly what the pre-environment planner planned, over ${CORPUS} seeded turns`, () => {
    // The hard gate of this change. `planEnemyTurn` branches on whether the
    // turn carries an environment, and nothing else; this holds the other
    // branch to the frozen copy of the old planner on boards nobody chose, so
    // a refactor that moved one tie-break would fail here before it ever
    // reached Gemfall's golden digest.
    const next = seeded(201);
    let attacks = 0;
    let walks = 0;
    for (let i = 0; i < CORPUS; i++) {
      const input = randomTurn(next);
      const now = planEnemyTurn(input);
      expect(now, `turn ${i}`).toEqual(planEnemyTurnBeforeEnvironment(input));
      if (now.attack) attacks++;
      else if (now.moveTo) walks++;
    }
    // The corpus must be a real one, or the comparison pins nothing.
    expect(attacks).toBeGreaterThan(CORPUS / 10);
    expect(walks).toBeGreaterThan(CORPUS / 20);
  });

  it("an environment with nothing in force this round changes nothing either", () => {
    // A clock alone; fire that has burned out or not yet lit; a way out shut
    // for good; a captive already freed. The place is there and none of it is
    // on the board this turn, so the monster is the one the sentence makes.
    const quiet: EncounterEnvironment = {
      clock: { rounds: 6, label: "The rift closes", onExpire: "collapse" },
      hazards: [
        fire([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], { id: "late", fromRound: 5 }),
        fire([{ x: 3, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }], { id: "spent", untilRound: 2 }),
      ],
      exits: [{ id: "gone", label: "A shut tear", tiles: [{ x: 0, y: 0 }], closesRound: 2 }],
      rescue: { name: "Pip", at: { x: 2, y: 0 } },
    };
    const next = seeded(7);
    for (let i = 0; i < 1500; i++) {
      const input = randomTurn(next);
      const placed = { ...input, environment: place(quiet, 3, "freed") };
      expect(planEnemyTurn(placed), `turn ${i}`).toEqual(planEnemyTurnBeforeEnvironment(input));
    }
  });
});

// ---------------------------------------------------------------------------
// 1. It does not stop in the fire
// ---------------------------------------------------------------------------

describe("hazards", () => {
  const ROWAN = hero("c_rowan", { x: 4, y: 2 });

  it("swings from a tile that is not burning when the sentence's tile is", () => {
    // The sentence walks to (3,1) — the cheapest tile next to Rowan, topmost
    // first. With (3,1) on fire it takes (3,2), just as cheap and not burning,
    // and swings at the same hero.
    const input = turn(FIELD, { x: 0, y: 2 }, [ROWAN], { environment: place({ hazards: [fire([{ x: 3, y: 1 }])] }, 2) });
    expect(planEnemyTurn(bare(input))).toEqual({ moveTo: { x: 3, y: 1 }, attack: "c_rowan" });
    expect(planEnemyTurn(input)).toEqual({ moveTo: { x: 3, y: 2 }, attack: "c_rowan" });
  });

  it("steps out of the fire it is standing in before it swings, when it can still reach", () => {
    // Already next to Rowan, but on a burning tile: staying would cost it at
    // the end of its turn. It moves one step to a tile still next to Rowan.
    const input = turn(FIELD, { x: 3, y: 2 }, [ROWAN], { environment: place({ hazards: [fire([{ x: 3, y: 2 }])] }) });
    expect(planEnemyTurn(bare(input))).toEqual({ moveTo: null, attack: "c_rowan" });
    expect(planEnemyTurn(input)).toEqual({ moveTo: { x: 3, y: 1 }, attack: "c_rowan" });
  });

  it("walks across the fire freely — only where it stops is judged", () => {
    // A burning column between it and Rowan. The walk crosses it; the stop is
    // past it, so nothing changes from the sentence.
    const column = fire([0, 1, 2, 3, 4, 5].map((y) => ({ x: 2, y })));
    const input = turn(FIELD, { x: 0, y: 2 }, [ROWAN], { environment: place({ hazards: [column] }) });
    expect(planEnemyTurn(input)).toEqual(planEnemyTurn(bare(input)));
    expect(planEnemyTurn(input).attack).toBe("c_rowan");
  });

  it("goes for a hero it can hit from safe ground before one it could only hit from the fire", () => {
    // Ash is nearer, but every tile beside Ash that it can reach this turn is
    // burning; Bryn is a step further and has a cool tile beside him.
    const ash = hero("c_ash", { x: 4, y: 0 });
    const bryn = hero("c_bryn", { x: 4, y: 4 });
    const ring = fire([{ x: 3, y: 0 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 0 }]);
    const input = turn(FIELD, { x: 1, y: 1 }, [ash, bryn], { steps: 3, environment: place({ hazards: [ring] }) });
    expect(planEnemyTurn(bare(input)).attack).toBe("c_ash");
    const plan = planEnemyTurn(input);
    expect(plan.attack).toBe("c_bryn");
    expect(plan.moveTo).toEqual({ x: 3, y: 3 });
  });

  it("steps into the fire to swing only when every tile it could swing from is burning", () => {
    // One row: the only tile beside Rowan it can reach is on fire. It would
    // rather burn than stand and watch — the hazard costs it, it does not make
    // her untouchable.
    const rowan = hero("c_rowan", { x: 4, y: 0 });
    const input = turn([".........."], { x: 0, y: 0 }, [rowan], { steps: 3, environment: place({ hazards: [fire([{ x: 3, y: 0 }])] }) });
    expect(planEnemyTurn(input)).toEqual({ moveTo: { x: 3, y: 0 }, attack: "c_rowan" });
  });

  it("and then picks the tile that burns least", () => {
    // Three tiles beside Rowan in reach: two in fire (2 hearts), one in thorns
    // (1 heart). The thorns, though it is last in reading order.
    const rowan = hero("c_rowan", { x: 4, y: 1 });
    const hazards = [
      fire([{ x: 3, y: 0 }, { x: 3, y: 1 }]),
      fire([{ x: 3, y: 2 }], { id: "thorns", kind: "thorns", label: "Thorns", damage: 1 }),
    ];
    const input = turn(["........", "........", "........"], { x: 0, y: 1 }, [rowan], { steps: 3, environment: place({ hazards }) });
    expect(planEnemyTurn(input)).toEqual({ moveTo: { x: 3, y: 2 }, attack: "c_rowan" });
  });

  it("ignores a hazard outside its round window", () => {
    // Not lit until round 3; burned out after round 1. In round 2 neither is
    // there, and it stops on (3,1) exactly as the sentence says.
    for (const window of [{ fromRound: 3 }, { untilRound: 1 }]) {
      const input = turn(FIELD, { x: 0, y: 2 }, [ROWAN], { environment: place({ hazards: [fire([{ x: 3, y: 1 }], window)] }, 2) });
      expect(planEnemyTurn(input)).toEqual({ moveTo: { x: 3, y: 1 }, attack: "c_rowan" });
    }
    // And in round 3 the late one is lit.
    const lit = turn(FIELD, { x: 0, y: 2 }, [ROWAN], { environment: place({ hazards: [fire([{ x: 3, y: 1 }], { fromRound: 3 })] }, 3) });
    expect(planEnemyTurn(lit).moveTo).toEqual({ x: 3, y: 2 });
  });

  it("on a walk that cannot arrive, stops short of the fire on the closest safe tile", () => {
    const far = hero("c_rowan", { x: 9, y: 2 });
    const input0 = turn(OPEN, { x: 0, y: 2 }, [far]);
    const stop = planEnemyTurn(input0).moveTo!;
    expect(stop).toEqual({ x: 4, y: 0 });
    const input = { ...input0, environment: place({ hazards: [fire([stop])] }) };
    const plan = planEnemyTurn(input);
    expect(plan.attack).toBeNull();
    // Still four steps along — just not on the burning one.
    expect(plan.moveTo).toEqual({ x: 4, y: 1 });
  });

  it("crosses fire wider than its stride rather than wait at the edge forever", () => {
    // A corridor, a band of fire three tiles deep, two steps a turn. No safe
    // tile gets it any closer, so it walks in — to the furthest burning tile,
    // since they all burn the same — and is out the other side next turn.
    const rowan = hero("c_rowan", { x: 9, y: 0 });
    const band = fire([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
    const first = turn([".........."], { x: 0, y: 0 }, [rowan], { steps: 2, environment: place({ hazards: [band] }) });
    expect(planEnemyTurn(first)).toEqual({ moveTo: { x: 2, y: 0 }, attack: null });
    const second = turn([".........."], { x: 2, y: 0 }, [rowan], { steps: 2, environment: place({ hazards: [band] }) });
    expect(planEnemyTurn(second)).toEqual({ moveTo: { x: 4, y: 0 }, attack: null });
  });

  it("walking, it prefers a cooler burning tile when every way forward burns", () => {
    const rowan = hero("c_rowan", { x: 7, y: 1 });
    const hazards = [
      fire([{ x: 1, y: 0 }, { x: 1, y: 1 }], { damage: 3 }),
      fire([{ x: 1, y: 2 }], { id: "embers", damage: 1 }),
    ];
    const input = turn(["........", "........", "........"], { x: 0, y: 1 }, [rowan], { steps: 1, environment: place({ hazards }) });
    expect(planEnemyTurn(input)).toEqual({ moveTo: { x: 1, y: 2 }, attack: null });
  });
});

// ---------------------------------------------------------------------------
// 2. The one nearest the way out watches it
// ---------------------------------------------------------------------------

describe("exits", () => {
  const TEAR = { id: "north-tear", label: "The tear in the air", tiles: [{ x: 4, y: 0 }, { x: 5, y: 0 }] };
  const FAR = hero("c_rowan", { x: 0, y: 4 });

  it("with nobody to hit, the nearest monster goes to stand beside an open way out", () => {
    const input = turn(OPEN, { x: 9, y: 3 }, [FAR], { steps: 3, environment: place({ exits: [TEAR] }, 2) });
    // The sentence would trudge after Rowan.
    expect(planEnemyTurn(bare(input))).toEqual({ moveTo: { x: 6, y: 6 }, attack: null });
    // Beside the tear, never on it.
    expect(planEnemyTurn(input)).toEqual({ moveTo: { x: 6, y: 0 }, attack: null });
  });

  it(`starts watching ${EXIT_LOOKAHEAD} round ahead of the exit opening, and not before`, () => {
    const soon = turn(OPEN, { x: 9, y: 3 }, [FAR], { steps: 3, environment: place({ exits: [{ ...TEAR, opensRound: 2 }] }, 1) });
    expect(planEnemyTurn(soon).moveTo).toEqual({ x: 6, y: 0 });
    const later = turn(OPEN, { x: 9, y: 3 }, [FAR], { steps: 3, environment: place({ exits: [{ ...TEAR, opensRound: 3 }] }, 1) });
    expect(planEnemyTurn(later)).toEqual(planEnemyTurn(bare(later)));
  });

  it("forgets a way out that has closed for good", () => {
    const shut = turn(OPEN, { x: 9, y: 3 }, [FAR], { steps: 3, environment: place({ exits: [{ ...TEAR, closesRound: 2 }] }, 3) });
    expect(planEnemyTurn(shut)).toEqual(planEnemyTurn(bare(shut)));
  });

  it("stays at its post while nobody comes within reach — no shuffling along the wall", () => {
    const input = turn(OPEN, { x: 6, y: 0 }, [FAR], { steps: 3, environment: place({ exits: [TEAR] }, 2) });
    expect(planEnemyTurn(input)).toEqual({ moveTo: null, attack: null });
  });

  it("hits a hero it can reach instead — the sentence always comes first", () => {
    const close = hero("c_rowan", { x: 7, y: 3 });
    const input = turn(OPEN, { x: 9, y: 3 }, [close], { steps: 3, environment: place({ exits: [TEAR] }, 2) });
    expect(planEnemyTurn(input)).toEqual(planEnemyTurn(bare(input)));
    expect(planEnemyTurn(input).attack).toBe("c_rowan");
  });

  it("only the monster nearest the way out watches it; the rest come for the party", () => {
    // The other wisp at (5,2) is nearer the tear, so this one chases Rowan
    // exactly as the sentence says.
    const input = turn(OPEN, { x: 9, y: 6 }, [FAR], {
      steps: 3,
      others: [monster({ x: 5, y: 2 }, "shade#2")],
      environment: place({ exits: [TEAR] }, 2),
    });
    expect(planEnemyTurn(input)).toEqual(planEnemyTurn(bare(input)));
  });

  it("never takes the one tile that would shut the way out", () => {
    /*
     * The tear at (2,0) opens onto a one-tile neck at (2,1): the only ground
     * beside it. Standing there would leave no hero a walk to the tear, so the
     * monster does not — it chases, as the sentence says. The checker proved
     * the way out reachable on the empty map; the guard keeps it so.
     *
     *   x  0123456789
     *   y0 ##T#######
     *   y1 ##.#######
     *   y2 ..........
     *   y3 R........M
     */
    const rows = ["##.#######", "##.#######", "..........", ".........."];
    const rowan = hero("c_rowan", { x: 0, y: 3 });
    const neck = { id: "neck", label: "The tear", tiles: [{ x: 2, y: 0 }] };
    const input = turn(rows, { x: 9, y: 3 }, [rowan], { steps: 3, environment: place({ exits: [neck] }, 1) });
    const plan = planEnemyTurn(input);
    expect(plan).toEqual(planEnemyTurn(bare(input)));
    expect(plan.moveTo).not.toEqual({ x: 2, y: 1 });
  });

  it("walks toward a post it cannot reach this turn without stopping in the fire", () => {
    // Two steps a turn, the tear far off: it heads for (3,1), the tile beside
    // the tear nearest Rowan, and would stop on (7,3) — the first of three
    // equally good tiles in reading order. With (7,3) burning, the next one.
    const cool = turn(OPEN, { x: 9, y: 5 }, [FAR], { steps: 2, environment: place({ exits: [TEAR] }, 2) });
    expect(planEnemyTurn(cool)).toEqual({ moveTo: { x: 7, y: 3 }, attack: null });
    const hazards = [fire([{ x: 7, y: 1 }, { x: 7, y: 2 }, { x: 7, y: 3 }])];
    const input = turn(OPEN, { x: 9, y: 5 }, [FAR], { steps: 2, environment: place({ exits: [TEAR], hazards }, 2) });
    expect(planEnemyTurn(input)).toEqual({ moveTo: { x: 7, y: 4 }, attack: null });
  });
});

// ---------------------------------------------------------------------------
// 3. The next one watches the captive
// ---------------------------------------------------------------------------

describe("the captive", () => {
  /** Pip at (1,7), walled in for the fight as the engine walls them. */
  const PIPPED = OPEN.map((row, y) => (y === 7 ? `.#${row.slice(2)}` : row));
  const PIP = { name: "Pip the ferry-sprite", at: { x: 1, y: 7 } };
  const PARTY = [hero("c_ash", { x: 0, y: 3 }), hero("c_bryn", { x: 0, y: 4 })];

  it("with nobody to hit, the nearest monster goes to stand beside the captive, on the heroes' side", () => {
    // Out of reach of the party this turn. Of Pip's sides it can reach, (2,6)
    // and (2,7), the one nearer the party: between them and Pip.
    const party = [hero("c_ash", { x: 0, y: 2 }), hero("c_bryn", { x: 0, y: 3 })];
    const input = turn(PIPPED, { x: 5, y: 7 }, party, { steps: 3, environment: place({ rescue: PIP }, 1, "waiting") });
    expect(planEnemyTurn(bare(input)).moveTo).not.toEqual({ x: 2, y: 6 });
    expect(planEnemyTurn(input)).toEqual({ moveTo: { x: 2, y: 6 }, attack: null });
  });

  it("watches the captive with the second-nearest monster when another one is watching the way out", () => {
    const tear = { id: "north-tear", label: "The tear", tiles: [{ x: 4, y: 0 }, { x: 5, y: 0 }] };
    const spec: EncounterEnvironment = { exits: [tear], rescue: PIP };
    // shade#2 is nearer the tear, so it is the exit's; this one takes Pip.
    const input = turn(PIPPED, { x: 6, y: 6 }, PARTY, {
      steps: 3,
      others: [monster({ x: 6, y: 1 }, "shade#2")],
      environment: place(spec, 2, "waiting"),
    });
    const plan = planEnemyTurn(input);
    expect(plan.attack).toBeNull();
    // Heading for (2,6), Pip's side nearest the party; three steps get it to
    // (3,5), first in reading order of the tiles one step short.
    expect(plan.moveTo).toEqual({ x: 3, y: 5 });
    // And shade#2, on its own turn, holds by the tear.
    const its = { ...input, enemy: { id: "shade#2", at: { x: 6, y: 1 }, steps: 3 } };
    expect(planEnemyTurn(its)).toEqual({ moveTo: null, attack: null });
  });

  it("forgets the captive once they are freed or lost", () => {
    for (const status of ["freed", "lost"] as const) {
      const input = turn(OPEN, { x: 4, y: 6 }, PARTY, { steps: 3, environment: place({ rescue: PIP }, 1, status) });
      expect(planEnemyTurn(input)).toEqual(planEnemyTurn(bare(input)));
    }
  });

  it("is never the target — only heroes are", () => {
    // Standing right beside Pip with Ash in reach: it swings at Ash.
    const ash = hero("c_ash", { x: 2, y: 5 });
    const input = turn(PIPPED, { x: 2, y: 6 }, [ash], { environment: place({ rescue: PIP }, 1, "waiting") });
    expect(planEnemyTurn(input)).toEqual({ moveTo: null, attack: "c_ash" });
  });

  it("never takes the last open side of the captive", () => {
    // Pip in the corner at (0,7) with walls at (1,7) and (1,6): the only side
    // left is (0,6). Standing there would make Pip impossible to free.
    const rows = OPEN.map((row, y) => (y === 7 ? "##" + row.slice(2) : y === 6 ? ".#" + row.slice(2) : row));
    const corner = { name: "Pip", at: { x: 0, y: 7 } };
    const input = turn(rows, { x: 2, y: 4 }, PARTY.slice(1).map((h) => ({ ...h, at: { x: 7, y: 0 } })), {
      steps: 3,
      environment: place({ rescue: corner }, 1, "waiting"),
    });
    expect(planEnemyTurn(input).moveTo).not.toEqual({ x: 0, y: 6 });
    expect(planEnemyTurn(input)).toEqual(planEnemyTurn(bare(input)));
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("determinism", () => {
  const spec: EncounterEnvironment = {
    hazards: [fire([{ x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }, { x: 3, y: 5 }])],
    exits: [{ id: "north-tear", label: "The tear", tiles: [{ x: 4, y: 0 }, { x: 5, y: 0 }] }],
    rescue: { name: "Pip", at: { x: 1, y: 7 } },
  };

  it("the same board gives the same plan, whatever order the party and the monsters are listed in", () => {
    const party = [hero("c_ash", { x: 0, y: 3 }), hero("c_bryn", { x: 1, y: 4 })];
    const forwards = turn(OPEN, { x: 9, y: 3 }, party, { steps: 3, others: [monster({ x: 9, y: 5 }, "shade#2")], environment: place(spec, 1, "waiting") });
    const backwards: EnemyTurn = {
      ...forwards,
      party: [...party].reverse(),
      board: { ...forwards.board, actors: [...forwards.board.actors].reverse() },
    };
    expect(planEnemyTurn(forwards)).toEqual(planEnemyTurn(forwards));
    expect(planEnemyTurn(backwards)).toEqual(planEnemyTurn(forwards));
  });

  it("over a seeded corpus in the sandbox's place, every plan is legal and repeatable", () => {
    const next = seeded(42);
    for (let i = 0; i < 1500; i++) {
      const base = randomTurn(next);
      const round = 1 + Math.floor(next() * 5);
      const input = { ...base, environment: place(spec, round, next() < 0.5 ? "waiting" : "freed") };
      const plan = planEnemyTurn(input);
      expect(planEnemyTurn(input), `turn ${i}`).toEqual(plan);
      if (plan.moveTo) {
        // A tile it can walk to and stand on, within its steps.
        const allowance = Math.max(0, Math.floor(base.enemy.steps));
        expect(walkField(base.board, base.enemy.at).dist(plan.moveTo)).toBeLessThanOrEqual(allowance);
        expect(base.board.actors.some((a) => a.x === plan.moveTo!.x && a.y === plan.moveTo!.y)).toBe(false);
      }
      if (plan.attack) {
        const target = base.party.find((h) => h.id === plan.attack)!;
        expect(target.down).toBe(false);
        expect(stepsBetween(plan.moveTo ?? base.enemy.at, target.at)).toBeLessThanOrEqual(Math.max(1, Math.floor(base.enemy.reach ?? 1)));
      }
    }
  });
});
