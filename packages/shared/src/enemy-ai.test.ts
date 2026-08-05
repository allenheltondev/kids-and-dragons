import { describe, expect, it } from "vitest";

import { planEnemyTurn } from "./enemy-ai.js";
import type { EnemyTurn, PartyTarget } from "./enemy-ai.js";
import { parseBoard, placeActor, stepsBetween } from "./grid.js";
import type { Actor, Board, Position } from "./grid.js";

/**
 * Every test below builds the board and the party from the same tiles, the way
 * the encounter loop will: a hero in the party list is also an actor standing on
 * the grid, so paths run around the people who are actually there.
 */
const MONSTER = "e_bramblewisp";

function board(rows: readonly string[], ...actors: readonly Actor[]): Board {
  return actors.reduce(placeActor, parseBoard([...rows]));
}

function hero(id: string, at: Position, state: Partial<PartyTarget> = {}): PartyTarget {
  return { id, at, hp: 6, maxHp: 6, down: false, ...state };
}

/** The same hero, as the figure standing on the grid. */
function figure(who: PartyTarget): Actor {
  return { id: who.id, side: "party", x: who.at.x, y: who.at.y };
}

function monster(at: Position, id: string = MONSTER): Actor {
  return { id, side: "enemy", x: at.x, y: at.y };
}

function turn(
  rows: readonly string[],
  at: Position,
  party: readonly PartyTarget[],
  steps = 4,
  extra: readonly Actor[] = [],
): EnemyTurn {
  return {
    board: board(rows, monster(at), ...party.map(figure), ...extra),
    enemy: { id: MONSTER, at, steps },
    party,
  };
}

/** An open 8 x 6 field. Wide enough that nothing accidentally hugs an edge. */
const FIELD = ["........", "........", "........", "........", "........", "........"] as const;

describe("who it goes for", () => {
  it("attacks from where it stands when it is already next to somebody", () => {
    // Catches the shuffle bug: moving is optional (§7.2), and a monster that
    // steps sideways before swinging both wastes its position and destroys the
    // read on which hero was threatened. moveTo must be null, not "the tile it
    // is already on" and not "some other tile next to the same hero".
    const rowan = hero("c_rowan", { x: 4, y: 2 });
    const plan = planEnemyTurn(turn(FIELD, { x: 3, y: 2 }, [rowan]));

    expect(plan).toEqual({ moveTo: null, attack: "c_rowan" });
  });

  it("counts a diagonal as next to it, so it does not circle to line up", () => {
    // §7.1 diagonals cost 1 and adjacency is the same measure. If reach used
    // orthogonal distance, a monster touching a hero corner-to-corner would walk
    // a tile to "line up" — the exact shuffle a child reads as a glitch.
    const rowan = hero("c_rowan", { x: 4, y: 3 });
    const plan = planEnemyTurn(turn(FIELD, { x: 3, y: 2 }, [rowan]));

    expect(plan).toEqual({ moveTo: null, attack: "c_rowan" });
  });

  it("walks up to the nearest hero and hits them in the same turn", () => {
    const rowan = hero("c_rowan", { x: 6, y: 2 });
    const plan = planEnemyTurn(turn(FIELD, { x: 2, y: 2 }, [rowan]));

    // Four steps of allowance, three steps of walking, then a swing. The tile is
    // the topmost-then-leftmost of the eight it could attack from, which is what
    // makes this assertable at all rather than "some adjacent tile".
    expect(plan).toEqual({ moveTo: { x: 5, y: 1 }, attack: "c_rowan" });
  });

  it("never picks the hurt one — hp is in the input and is not a target rule", () => {
    // The failure this catches is a design regression, not a crash: if a wounded
    // hero drew attacks, being hurt would compound and hiding the wounded would
    // beat helping them up (§7.3). Both heroes are the same distance away and
    // only their hp differs, so any hp-awareness at all flips this assertion.
    const near = hero("c_ash", { x: 3, y: 1 }, { hp: 1 });
    const far = hero("c_bryn", { x: 3, y: 3 }, { hp: 6 });
    const plan = planEnemyTurn(turn(FIELD, { x: 5, y: 2 }, [near, far]));

    // Tie on both distances, so the rule that decides is board reading order:
    // topmost row first. It is c_ash's row, not c_ash's missing hp, that wins.
    expect(plan.attack).toBe("c_ash");
    expect(planEnemyTurn(turn(FIELD, { x: 5, y: 2 }, [hero("c_ash", { x: 3, y: 1 }), far])).attack)
      .toBe("c_ash");
  });
});

describe("knocked down is out of the fight — §7.3", () => {
  it("walks past a fallen hero at its feet to reach one still standing", () => {
    // The cruelty bug, and the unreadable one: a monster standing over a downed
    // hero and hitting her again shows a child a picture of someone being
    // attacked while visibly out of the fight, and makes Help Up look pointless.
    const fallen = hero("c_ash", { x: 3, y: 2 }, { hp: 0, down: true });
    const upright = hero("c_bryn", { x: 6, y: 2 });
    const plan = planEnemyTurn(turn(FIELD, { x: 2, y: 2 }, [fallen, upright]));

    expect(plan.attack).toBe("c_bryn");
    expect(plan.moveTo).not.toBeNull();
  });

  it("does nothing at all when the whole party is down", () => {
    // The encounter is over and the story is about to branch (§7.3). Anything
    // other than standing still — drifting toward a body, "attacking" a downed
    // hero — is a turn the loop would have to animate and she would have to read.
    const party = [
      hero("c_ash", { x: 3, y: 2 }, { hp: 0, down: true }),
      hero("c_bryn", { x: 4, y: 2 }, { hp: 0, down: true }),
    ];
    const plan = planEnemyTurn(turn(FIELD, { x: 3, y: 3 }, party));

    expect(plan).toEqual({ moveTo: null, attack: null });
  });

  it("does nothing when there is no party at all", () => {
    // Cheap guard on an empty list: the encounter loop can call this while the
    // last hero is being removed, and an empty sort must not read index 0.
    expect(planEnemyTurn(turn(FIELD, { x: 3, y: 3 }, []))).toEqual({ moveTo: null, attack: null });
  });
});

describe("a wall changes who is nearest", () => {
  /**
   * A wall down x = 3, open only along the bottom row. Ash is visibly closer to
   * the monster than Bryn is, and is the longer walk of the two.
   *
   *   x  01234567
   *   y0 ...#....
   *   y1 ...#....
   *   y2 .E.#A...
   *   y3 ...#....
   *   y4 ...#....
   *   y5 ........
   */
  const WALLED = ["...#....", "...#....", "...#....", "...#....", "...#....", "........"] as const;
  const AT: Position = { x: 1, y: 2 };
  const ASH = hero("c_ash", { x: 4, y: 2 });
  const BRYN = hero("c_bryn", { x: 5, y: 5 });

  it("is set up so the nearest-looking hero really is the longer walk", () => {
    // Guards the fixture itself: if a later edit to the map made Ash both nearer
    // and easier to reach, the test below would pass for the wrong reason.
    expect(stepsBetween(AT, ASH.at)).toBe(3);
    expect(stepsBetween(AT, BRYN.at)).toBe(4);
  });

  it("goes for the one it can actually walk to, not the one that looks closest", () => {
    // Ranking by the straight line would send it at Ash — three tiles away and
    // five steps of walking round the wall — and it would spend the turn
    // trudging past Bryn, who it could have reached and hit. That turn reads as
    // broken. This is also the positioning lesson of §7: put a wall between
    // yourself and a monster and it goes after somebody else.
    const plan = planEnemyTurn(turn(WALLED, AT, [ASH, BRYN]));

    expect(plan).toEqual({ moveTo: { x: 4, y: 4 }, attack: "c_bryn" });
  });

  it("walks the long way round when the walled-off hero is the only one left", () => {
    // The wall does not make her safe forever — it buys her a turn. Ash is a
    // five-step walk with four steps of allowance, so the monster spends the
    // whole allowance getting there, through the gap at the bottom, and swings
    // next turn. A plan that gave up and stood still would teach her that a wall
    // is permanent cover, which it is not.
    const plan = planEnemyTurn(turn(WALLED, AT, [ASH]));

    expect(plan.attack).toBeNull();
    expect(plan.moveTo).toEqual({ x: 4, y: 4 });
  });
});

describe("ties break the same way every time", () => {
  const AT: Position = { x: 2, y: 4 };
  const LEFT = hero("c_zephyr", { x: 0, y: 0 });
  const RIGHT = hero("c_ash", { x: 4, y: 0 });
  const SMALL = [".....", ".....", ".....", ".....", "....."] as const;

  it("takes the topmost then leftmost hero when two are equally far", () => {
    // Both are four tiles away and a three-step walk. Without a fixed rule the
    // answer would be whichever the party array happened to list first, which
    // differs between the server's state and a client's patched copy — and she
    // could never learn it. Reading order is the rule; note it beats id, or the
    // "c_ash" on the right would win.
    const plan = planEnemyTurn(turn(SMALL, AT, [LEFT, RIGHT]));

    expect(plan.attack).toBe("c_zephyr");
  });

  it("does not care what order the party is listed in", () => {
    // The array order reaching this function is an accident of how the encounter
    // state was built. If it leaked into the decision, replaying an event log
    // (architecture §4.1) could produce a different fight than the one played.
    const forwards = planEnemyTurn(turn(SMALL, AT, [LEFT, RIGHT]));
    const backwards = planEnemyTurn(turn(SMALL, AT, [RIGHT, LEFT]));

    expect(backwards).toEqual(forwards);
  });

  it("returns the identical plan when asked twice", () => {
    // No clock, no Math.random, no Rng: the same board and party must always
    // produce the same plan or the client's preview and the server's decision
    // are two different fights.
    const input = turn(FIELD, { x: 1, y: 1 }, [hero("c_ash", { x: 7, y: 5 })]);

    expect(planEnemyTurn(input)).toEqual(planEnemyTurn(input));
  });
});

describe("when it cannot get to anybody", () => {
  it("spends its whole allowance closing the distance and does not attack", () => {
    // "It is coming for you" has to be visible a turn ahead, or she never gets
    // the chance to move away. Six steps of walking, four steps of allowance: it
    // covers four of them, lands on a tile it could legally stand on, and swings
    // next turn.
    const rowan = hero("c_rowan", { x: 7, y: 5 });
    const plan = planEnemyTurn(turn(FIELD, { x: 0, y: 0 }, [rowan]));

    expect(plan.attack).toBeNull();
    expect(plan.moveTo).toEqual({ x: 4, y: 2 });
  });

  it("stops on the last open tile rather than on top of another monster", () => {
    // A route may cross a fellow monster without being allowed to stop on it
    // (grid.ts). Four steps along this corridor lands on (4,0), which is
    // occupied, so the plan must name (3,0). Naming (4,0) would not be a bad
    // decision, it would be a `moveActor` throw in the middle of an encounter.
    const rowan = hero("c_rowan", { x: 7, y: 0 });
    const packmate = monster({ x: 4, y: 0 }, "e_packmate");
    const plan = planEnemyTurn(turn(["........"], { x: 0, y: 0 }, [rowan], 4, [packmate]));

    expect(plan).toEqual({ moveTo: { x: 3, y: 0 }, attack: null });
  });

  it("walks up to the thorns when there is no way through at all", () => {
    /**
     * A wall with no gap — a Thornguard's Bramble Wall grown across the corridor
     * (grid.ts, `setTerrain`). There is no route to Rowan, so walking distance
     * has nothing to rank by and the monster falls back to what she can see: get
     * as close as the thorns allow, then stop. Standing still instead would look
     * like it had lost interest in her.
     *
     *   x  012345
     *   y0 ...#..
     *   y1 E..#.R
     *   y2 ...#..
     */
    const rowan = hero("c_rowan", { x: 5, y: 1 });
    const plan = planEnemyTurn(turn(["...#..", "...#..", "...#.."], { x: 0, y: 1 }, [rowan]));

    // Right up against the wall. Of the three tiles in that column, all equally
    // close to Rowan and equally cheap, it takes the topmost — the same reading
    // order everything else in this module breaks ties by.
    //
    // Exact equality on the tile, not a coordinate check, because this is the
    // one branch that picks a tile out of `reachableTiles`: those carry a `cost`
    // alongside x and y, and passing one straight through would ship a stray
    // field in the state patch and in every replay of the encounter.
    expect(plan).toEqual({ moveTo: { x: 2, y: 0 }, attack: null });
  });

  it("stays put rather than jittering when no tile gets it any closer", () => {
    // Sealed into a one-tile cell. There is nowhere to stand that is nearer
    // Rowan, so it holds. Without the "closer than here" test the fallback would
    // pick *some* tile every round and the monster would jitter on the spot.
    const rowan = hero("c_rowan", { x: 4, y: 1 });
    const plan = planEnemyTurn(turn(["###..", "#.#..", "###.."], { x: 1, y: 1 }, [rowan]));

    expect(plan).toEqual({ moveTo: null, attack: null });
  });

  it("holds when it has no steps and nobody is in reach", () => {
    // Tanglelight ("it cannot move on its next turn") lands here as steps: 0.
    // The floor must not produce a phantom move or a swing from across the board.
    const rowan = hero("c_rowan", { x: 6, y: 2 });
    const plan = planEnemyTurn(turn(FIELD, { x: 2, y: 2 }, [rowan], 0));

    expect(plan).toEqual({ moveTo: null, attack: null });
  });
});

describe("reach", () => {
  it("swings from two tiles away without closing, when it has the reach", () => {
    // Reach is straight-line (grid.ts: range ignores walls, walking does not),
    // so a reach-2 monster hits from where it stands. Walking in anyway would
    // hand her a free step of distance and misteach what "within 2" means.
    const rowan = hero("c_rowan", { x: 5, y: 2 });
    const base = turn(FIELD, { x: 3, y: 2 }, [rowan]);
    const plan = planEnemyTurn({ ...base, enemy: { ...base.enemy, reach: 2 } });

    expect(plan).toEqual({ moveTo: null, attack: "c_rowan" });
  });

  it("defaults to melee when the caller says nothing about reach", () => {
    // `EnemySpec` in content has no reach field, so the encounter adapter will
    // simply not pass one. The default has to be 1, not 0 — a reach of 0 could
    // never attack anyone and the monsters would wander the board forever.
    const rowan = hero("c_rowan", { x: 5, y: 2 });
    const plan = planEnemyTurn(turn(FIELD, { x: 3, y: 2 }, [rowan]));

    expect(plan.attack).toBe("c_rowan");
    expect(plan.moveTo).toEqual({ x: 4, y: 1 });
  });
});

/*
 * The step budget, at its edges.
 *
 * Found by flipping `Math.floor` to `Math.ceil` on the allowance and `>= 1` to
 * `> 1` in the walk, and watching nothing object. Both are the same kind of
 * mistake — a monster that gets one more tile than it has, or one fewer — and
 * both are invisible in a test where the budget is a round number and the
 * distance is comfortable.
 */
describe("how far it actually gets", () => {
  it("spends a fractional step budget downwards", () => {
    /*
     * `wholeSteps` exists because the number arriving here need not be whole —
     * a step bonus is applied before this is called. Rounding up hands the
     * monster a free tile, which on the turn it matters is the difference
     * between "it is coming for you" and "it reached you".
     */
    const rowan = hero("c_rowan", { x: 7, y: 2 });
    const generous = planEnemyTurn(turn(FIELD, { x: 0, y: 2 }, [rowan], 2.9));
    const whole = planEnemyTurn(turn(FIELD, { x: 0, y: 2 }, [rowan], 2));
    const rounded = planEnemyTurn(turn(FIELD, { x: 0, y: 2 }, [rowan], 3));

    expect(generous.moveTo).toEqual(whole.moveTo);
    expect(generous.moveTo).not.toEqual(rounded.moveTo);
  });

  it("still takes its one step when one step is all it has", () => {
    /*
     * The walk counts down from the far end of the path looking for a tile it
     * can stand on, and stops at 1 — the first step. Stopping at 2 instead
     * leaves a monster with a single step standing still, which reads as the
     * fight having quietly stopped rather than as a creature closing in.
     */
    const rowan = hero("c_rowan", { x: 7, y: 2 });
    const plan = planEnemyTurn(turn(FIELD, { x: 0, y: 2 }, [rowan], 1));

    expect(plan.attack).toBeNull();
    expect(plan.moveTo).not.toBeNull();
    expect(stepsBetween({ x: 0, y: 2 }, plan.moveTo!)).toBe(1);
  });

  it("stands still on no budget at all rather than teleporting a tile", () => {
    const rowan = hero("c_rowan", { x: 7, y: 2 });
    expect(planEnemyTurn(turn(FIELD, { x: 0, y: 2 }, [rowan], 0)).moveTo).toBeNull();
    expect(planEnemyTurn(turn(FIELD, { x: 0, y: 2 }, [rowan], 0.9)).moveTo).toBeNull();
  });
});
