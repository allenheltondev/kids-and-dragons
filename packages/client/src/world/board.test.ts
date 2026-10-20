// @vitest-environment jsdom
/**
 * The combat board's wiring — what `update()` does to the tree it already built.
 *
 * `board-math.test.ts` and `nameplate.test.ts` cover the rules this module
 * calls. This covers the *calling*, which is where every fix commit against
 * board.ts has actually landed. The clearest example is the one this file opens
 * with: `fitNameplate()` is pure, exported, and thoroughly tested, and the bug
 * that shipped was that the rename path never called it. No test of a pure
 * function can catch its caller skipping it — only a test that renames a figure
 * and then measures what is on the board.
 *
 * Everything here runs against a real `BoardLayer` on a renderer-free stage
 * (`testing/fake-stage.ts`). Text is measured at a fixed width per character,
 * which is what makes "did it re-fit" a number rather than a screenshot.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { Container, Text } from "pixi.js";
import { beginEncounter, parseBoard } from "@kad/shared";
import type {
  EncounterSetup,
  EncounterState,
  PartyMember,
  ResolvedCharacter,
} from "@kad/shared";
import { makeRules } from "../../../shared/src/test-fixtures";
import { CHAR_WIDTH, installFakeCanvas2D } from "../testing/fake-stage";
import { nameplatesCollide } from "./nameplate";
import { BOARD_TILE_PX, createBoardLayer, walkRoutes } from "./board";
import { gridCells } from "../screens/combat-grid";
import type { Facing } from "./board-math";
import type { BoardLayer, BoardViewState } from "./board";

beforeAll(installFakeCanvas2D);

/** The cap board.ts fits party names to — strictly under one tile. */
const NAMEPLATE_MAX_WIDTH = BOARD_TILE_PX * 0.9;

/**
 * `fitNameplate` scales a long name to land *exactly* on the cap, so the
 * comparison is against a float that has been multiplied and divided back.
 * The epsilon is for that and nothing else — it is a millionth of a pixel,
 * while the bug being guarded overruns by tens of them.
 */
const CAP = NAMEPLATE_MAX_WIDTH + 1e-6;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function character(id: string, name: string): ResolvedCharacter {
  return {
    id,
    ownerPlayerId: `p_${id}`,
    name,
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 1,
    xp: 0,
    tier: "fledgling",
    stats: { might: 2, quick: 9, clever: 3, heart: 5 },
    unspentPoints: 0,
    spendableStats: ["might", "quick", "clever", "heart"],
    committedLevel: 1,
    maxHp: 10,
    steps: 4,
    guard: 11,
    attackStat: "heart",
    actions: [],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: false,
  };
}

function member(char: ResolvedCharacter): PartyMember {
  return {
    character: char,
    playerId: char.ownerPlayerId,
    hp: char.maxHp,
    down: false,
    connected: true,
    ready: true,
  };
}

const WISP = {
  id: "wisp",
  name: "Bramblewisp",
  count: 1,
  hp: 6,
  guard: 11,
  quick: 3,
  steps: 5,
  attack: 3,
};

function encounterOf(chars: ResolvedCharacter[], at: { x: number; y: number }[]): EncounterState {
  const setup: EncounterSetup = {
    board: parseBoard(["......", "......", "......", "......", "......", "......"]),
    party: chars.map((c, i) => ({ character: c, at: at[i] ?? { x: 0, y: i } })),
    enemies: [{ spec: WISP, at: { x: 5, y: 5 } }],
  };
  return beginEncounter(setup, { rules: makeRules(), abilities: {}, rng: { next: () => 0.5 } });
}

function viewOf(encounter: EncounterState, chars: ResolvedCharacter[]): BoardViewState {
  return { encounter, biome: null, enemyArt: {}, party: chars.map(member) };
}

/** Build a board, draw a frame, and hand back both the layer and a redraw. */
function board(chars: ResolvedCharacter[], at: { x: number; y: number }[]) {
  const encounter = encounterOf(chars, at);
  const layer = createBoardLayer();
  const draw = (next: ResolvedCharacter[] = chars, enc: EncounterState = encounter): void => {
    layer.update(viewOf(enc, next));
    // Labels are followed to their figure in `tick`, not in `update` — they
    // live in their own layer above the depth sort, so nothing is positioned
    // until a frame runs.
    layer.tick(0.016);
  };
  draw();
  return { layer, encounter, draw };
}

const boxFor = (layer: BoardLayer, text: string) =>
  layer.nameplateBoxes().find((b) => b.text === text);

/**
 * Every live `Text` still in the tree, by what it says.
 *
 * `nameplateBoxes()` reports from the actor map, so a label that outlives its
 * actor is invisible to it — which is exactly the leak worth checking, since
 * labels are deliberately not children of the figure they belong to. Only the
 * scene graph can answer "is it still being drawn".
 */
function drawnLabels(layer: BoardLayer): string[] {
  const found: string[] = [];
  const walk = (node: Container): void => {
    if (node.destroyed) return;
    if (node instanceof Text) found.push(node.text);
    for (const child of node.children) walk(child as Container);
  };
  walk(layer.container);
  return found;
}

// ---------------------------------------------------------------------------
// Nameplates
// ---------------------------------------------------------------------------

describe("nameplates on the board", () => {
  it("draws a party figure's name under its feet", () => {
    const hero = character("c_1", "Sparklehoof");
    const { layer } = board([hero], [{ x: 1, y: 1 }]);

    const box = boxFor(layer, "Sparklehoof");
    expect(box).toBeTruthy();
    // Under the figure, and horizontally on its tile.
    expect(box!.y).toBeGreaterThan(1 * BOARD_TILE_PX);
    expect(Math.abs(box!.x - (1 + 0.5) * BOARD_TILE_PX)).toBeLessThan(BOARD_TILE_PX);
  });

  it("gives a monster no name at all", () => {
    /*
     * An enemy's label would be a spec id, and three wisps are told apart by
     * where they are standing (spec §7.3). One drawn name, for the one hero.
     */
    const { layer } = board([character("c_1", "Sparklehoof")], [{ x: 0, y: 0 }]);
    const boxes = layer.nameplateBoxes();
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.text).toBe("Sparklehoof");
  });

  it("re-fits a renamed label instead of keeping the old scale", () => {
    /*
     * The bug this file exists for, verbatim: the rewrite set `.text` and
     * stopped. The *cap* is the tile and does not change, which is what made
     * "no need to re-fit" sound right — but the width of what is in the label
     * does, so a short name replaced by a long one kept the old scale and
     * overran into the next tile.
     *
     * Sixteen characters at CHAR_WIDTH is far wider than the cap, so an
     * unfitted label fails this by a wide margin rather than by a rounding
     * error.
     */
    const { layer, draw } = board([character("c_1", "Mo")], [{ x: 1, y: 1 }]);
    expect(boxFor(layer, "Mo")!.width).toBeLessThanOrEqual(CAP);

    draw([character("c_1", "Moonlightbramble")]);

    const renamed = boxFor(layer, "Moonlightbramble");
    expect(renamed, "the label never picked up the new name").toBeTruthy();
    expect("Moonlightbramble".length * CHAR_WIDTH).toBeGreaterThan(NAMEPLATE_MAX_WIDTH);
    expect(renamed!.width).toBeLessThanOrEqual(CAP);
  });

  it("keeps two long names on adjacent tiles readable as two names", () => {
    /*
     * The rule the nameplate cap exists to hold, asserted on real drawn boxes.
     * `nameplatesCollide` is a minimum *gutter*, not an intersection test —
     * two names whose edges touch are unreadable and do not technically
     * overlap, which is how the first two attempts at the e2e passed against
     * the live bug.
     *
     * Long names on purpose: the cap only binds on a long name, so ordinary
     * ones pass whether it is set right or wrong.
     */
    const a = character("c_1", "Moonlightbramble");
    const b = character("c_2", "Skyclawthunderer");
    const { layer } = board([a, b], [{ x: 1, y: 1 }, { x: 2, y: 1 }]);

    const boxes = layer.nameplateBoxes();
    expect(boxes).toHaveLength(2);
    expect(nameplatesCollide(boxes[0]!, boxes[1]!)).toBe(false);
  });

  it("moves a label with the figure it belongs to", () => {
    const hero = character("c_1", "Sparklehoof");
    const { layer, encounter, draw } = board([hero], [{ x: 0, y: 0 }]);
    const before = boxFor(layer, "Sparklehoof")!;

    // Walk her across the board and let the approach settle.
    const moved: EncounterState = {
      ...encounter,
      board: {
        ...encounter.board,
        actors: encounter.board.actors.map((a) =>
          a.id === "c_1" ? { ...a, x: 4, y: 4 } : a,
        ),
      },
    };
    draw([hero], moved);
    for (let i = 0; i < 240; i++) layer.tick(1 / 60);

    const after = boxFor(layer, "Sparklehoof")!;
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y);
  });

  it("takes a figure's name down with the figure", () => {
    /*
     * Labels are deliberately not children of their actor's container — that
     * put them in the depth sort, where the figure in front cropped the name
     * behind it. The cost of moving them out is that a destroyed actor no
     * longer takes its label down for free, so `update` has to do it by hand;
     * skipping that leaves a name floating over an empty tile.
     */
    const a = character("c_1", "Sparklehoof");
    const b = character("c_2", "Thistle");
    const { layer, encounter, draw } = board([a, b], [{ x: 1, y: 1 }, { x: 3, y: 1 }]);
    expect(layer.nameplateBoxes()).toHaveLength(2);

    // Thistle leaves the board entirely.
    const gone: EncounterState = {
      ...encounter,
      combatants: encounter.combatants.filter((c) => c.id !== "c_2"),
      board: { ...encounter.board, actors: encounter.board.actors.filter((x) => x.id !== "c_2") },
    };
    draw([a, b], gone);

    const left = layer.nameplateBoxes();
    expect(left).toHaveLength(1);
    expect(left[0]!.text).toBe("Sparklehoof");
    // And it is genuinely gone from the tree, not merely unreported: the
    // actor map forgot it either way, so only the scene graph can tell a
    // destroyed label from one still being drawn over an empty tile.
    expect(drawnLabels(layer)).toEqual(["Sparklehoof"]);
  });
});

// ---------------------------------------------------------------------------
// The update contract
// ---------------------------------------------------------------------------

describe("facing", () => {
  it("stands each side facing the other, and turns round when the fight moves", () => {
    // Art is drawn facing left. The hero at (0,0) has the wisp at (5,5) on
    // her right, so she arrives turned; the wisp's nearest hero is on its
    // left, so it stands as drawn.
    const hero = character("c_1", "Sparklehoof");
    const { layer, encounter, draw } = board([hero], [{ x: 0, y: 0 }]);
    expect(layer.facings()).toEqual({ c_1: -1, "wisp#1": 1 });

    // She walks past the wisp. The turn is eased, not snapped: a frame in it
    // is between the two, and a second later she has turned round.
    const past: EncounterState = {
      ...encounter,
      board: {
        ...encounter.board,
        actors: encounter.board.actors.map((a) => (a.id === "c_1" ? { ...a, x: 5, y: 3 } : a)),
      },
    };
    draw([hero], past);
    // Same column as the wisp: straight above it, so she keeps facing right.
    expect(layer.facings()["c_1"]).toBe(-1);
    const beyond: EncounterState = {
      ...past,
      board: {
        ...past.board,
        actors: past.board.actors.map((a) => (a.id === "c_1" ? { ...a, x: 5, y: 3 } : a.id === "wisp#1" ? { ...a, x: 2, y: 3 } : a)),
      },
    };
    draw([hero], beyond);
    layer.tick(1 / 60);
    const mid = layer.facings()["c_1"]!;
    expect(mid).toBeGreaterThan(-1);
    expect(mid).toBeLessThan(1);
    for (let i = 0; i < 120; i++) layer.tick(1 / 60);
    expect(layer.facings()["c_1"]).toBeCloseTo(1, 2);
    expect(layer.facings()["wisp#1"]).toBeCloseTo(-1, 2);
  });
});

describe("walking", () => {
  /** Where board.ts stands a figure's feet on tile (x, y). */
  const feet = (x: number, y: number) => ({ x: (x + 0.5) * BOARD_TILE_PX, y: (y + 0.82) * BOARD_TILE_PX });

  it("walks the route a square at a time, a footprint on each, corner to corner in three", () => {
    /*
     * Three diagonal steps from (0,0) to (3,3). Counted along the edges that
     * is six squares; the game charges three (spec §7.1). The walk crossing
     * (1,1) and (2,2) on its way is what shows the table why.
     */
    const hero = character("c_1", "Sparklehoof");
    const { layer } = board([hero], [{ x: 0, y: 0 }]);
    layer.playEvents([{ type: "moved", actorId: "c_1", to: { x: 3, y: 3 } }], 700);

    const seen: string[] = [];
    for (let i = 0; i < 90; i++) {
      layer.tick(1 / 60);
      for (const mark of layer.trailMarks()) {
        const key = `${mark.x},${mark.y}`;
        if (!seen.includes(key)) seen.push(key);
      }
    }
    expect(seen).toEqual([feet(1, 1), feet(2, 2), feet(3, 3)].map((f) => `${f.x},${f.y}`));

    // And the footprints fade: nothing left a couple of seconds on.
    for (let i = 0; i < 180; i++) layer.tick(1 / 60);
    expect(layer.trailMarks()).toEqual([]);
  });

  it("goes around a wall rather than through it", () => {
    // A wall in column 1, rows 0 to 2: the only way from (0,1) to (2,1) is
    // under it, through (1,3). The route says so; a straight glide would not.
    const hero = character("c_1", "Sparklehoof");
    const encounter = beginEncounter(
      {
        board: parseBoard([".#....", ".#....", ".#....", "......", "......", "......"]),
        party: [{ character: hero, at: { x: 0, y: 1 } }],
        enemies: [{ spec: WISP, at: { x: 5, y: 5 } }],
      },
      { rules: makeRules(), abilities: {}, rng: { next: () => 0.5 } },
    );
    const layer = createBoardLayer();
    layer.update(viewOf(encounter, [hero]));
    layer.playEvents([{ type: "moved", actorId: "c_1", to: { x: 2, y: 1 } }], 700);

    const seen: string[] = [];
    for (let i = 0; i < 120; i++) {
      layer.tick(1 / 60);
      for (const mark of layer.trailMarks()) {
        const key = `${mark.x},${mark.y}`;
        if (!seen.includes(key)) seen.push(key);
      }
    }
    expect(seen).toEqual([feet(0, 2), feet(1, 3), feet(2, 2), feet(2, 1)].map((f) => `${f.x},${f.y}`));
  });

  it("still walks the route when the patch lands before the beat plays", () => {
    /*
     * The race a slow frame rate causes. The beat is timed on the board's
     * clock and the patch is released on a wall-clock timer, so on a weak
     * renderer the patch can arrive first. The route has to be worked out
     * when the sequence arrives, not when its beat plays.
     */
    const hero = character("c_1", "Sparklehoof");
    const { layer, encounter, draw } = board([hero], [{ x: 0, y: 0 }]);
    layer.playEvents([{ type: "moved", actorId: "c_1", to: { x: 3, y: 3 } }], 700);
    const after: EncounterState = {
      ...encounter,
      board: {
        ...encounter.board,
        actors: encounter.board.actors.map((a) => (a.id === "c_1" ? { ...a, x: 3, y: 3 } : a)),
      },
    };
    draw([hero], after);

    const seen: string[] = [];
    for (let i = 0; i < 90; i++) {
      layer.tick(1 / 60);
      for (const mark of layer.trailMarks()) {
        const key = `${mark.x},${mark.y}`;
        if (!seen.includes(key)) seen.push(key);
      }
    }
    expect(seen).toEqual([feet(1, 1), feet(2, 2), feet(3, 3)].map((f) => `${f.x},${f.y}`));
  });

  it("routes each walk in a sequence around where the earlier ones ended", () => {
    // A wisp steps into the hero's straight line, then the hero walks. A foe
    // cannot be crossed, so the hero's route has to bend round the square the
    // wisp only just took, which the board in view does not show yet.
    const board = parseBoard(["......", "......", "......"]);
    const placed = {
      ...board,
      actors: [
        { id: "w1", side: "enemy" as const, x: 2, y: 0 },
        { id: "h", side: "party" as const, x: 0, y: 1 },
      ],
    };
    const routes = walkRoutes(placed, [
      { type: "moved", actorId: "w1", to: { x: 1, y: 1 } },
      { type: "damage", actorId: "c_1", amount: 3, hp: 7 },
      { type: "moved", actorId: "h", to: { x: 2, y: 1 } },
    ]);
    expect(routes[0]).toEqual([{ x: 2, y: 0 }, { x: 1, y: 1 }]);
    expect(routes[1]).toBeUndefined();
    expect(routes[2]?.[0]).toEqual({ x: 0, y: 1 });
    expect(routes[2]).toHaveLength(3);
    expect(routes[2]).not.toContainEqual({ x: 1, y: 1 });
  });

  it("routes a walk round a Bramble Wall grown earlier in the same sequence", () => {
    // A hero's Bramble Wall goes up on (1,1), then a wisp walks from (0,1) to
    // (2,1). The board in view has no wall yet; the route must not cross it.
    const board = parseBoard(["......", "......", "......"]);
    const placed = { ...board, actors: [{ id: "w1", side: "enemy" as const, x: 0, y: 1 }] };
    const routes = walkRoutes(placed, [
      { type: "walled", at: { x: 1, y: 1 } },
      { type: "moved", actorId: "w1", to: { x: 2, y: 1 } },
    ]);
    expect(routes[0]).toBeUndefined();
    expect(routes[1]).toHaveLength(3);
    expect(routes[1]).not.toContainEqual({ x: 1, y: 1 });
    // Without the wall it is the straight line, so the bend is the wall's doing.
    expect(walkRoutes(placed, [{ type: "moved", actorId: "w1", to: { x: 2, y: 1 } }])[0]).toContainEqual({ x: 1, y: 1 });
  });

  it("leaves no footprints for a shove — a push is not a walk", () => {
    const hero = character("c_1", "Sparklehoof");
    const { layer } = board([hero], [{ x: 0, y: 0 }]);
    layer.playEvents([{ type: "shoved", actorId: "c_1", to: { x: 2, y: 0 } }], 700);
    for (let i = 0; i < 90; i++) layer.tick(1 / 60);
    expect(layer.trailMarks()).toEqual([]);
  });
});

describe("facing on both surfaces", () => {
  it("turns every figure the same way on the phone grid and the TV board, patch after patch", () => {
    // The same walk shown to both: past the wisp, into its column, and back.
    const hero = character("c_1", "Sparklehoof");
    const { layer, encounter, draw } = board([hero], [{ x: 0, y: 0 }]);
    let phoneMemory: Record<string, Facing> = {};
    const phone = (enc: EncounterState): Record<string, Facing> => {
      const cells = gridCells(enc, [member(hero)], [], [], phoneMemory);
      const out: Record<string, Facing> = {};
      for (const cell of cells) if (cell.occupant) out[cell.occupant.id] = cell.occupant.facing;
      phoneMemory = { ...phoneMemory, ...out };
      return out;
    };
    const tv = (): Record<string, Facing> =>
      Object.fromEntries(Object.entries(layer.facings()).map(([id, x]) => [id, x < 0 ? "right" : "left"]));
    const at = (x: number, y: number): EncounterState => ({
      ...encounter,
      board: { ...encounter.board, actors: encounter.board.actors.map((a) => (a.id === "c_1" ? { ...a, x, y } : a)) },
    });

    expect(phone(encounter)).toEqual(tv());
    for (const [x, y] of [[3, 3], [5, 3], [5, 1], [2, 1], [2, 5]] as const) {
      const step = at(x, y);
      draw([hero], step);
      for (let i = 0; i < 120; i++) layer.tick(1 / 60);
      expect(phone(step), `hero at ${x},${y}`).toEqual(tv());
    }
  });
});

describe("facing across fights", () => {
  it("starts a new fight's figures fresh, even when their ids repeat", () => {
    // Fight one: she faces the wisp on her right. Fight two reuses both ids
    // and starts her straight above it: she is drawn as painted, facing left,
    // at once, rather than keeping the last fight's turn.
    const hero = character("c_1", "Sparklehoof");
    const { layer, encounter, draw } = board([hero], [{ x: 0, y: 0 }]);
    draw([hero], { ...encounter, startedAt: 1 });
    expect(layer.facings()["c_1"]).toBe(-1);
    const second: EncounterState = {
      ...encounter,
      startedAt: 2,
      board: {
        ...encounter.board,
        actors: encounter.board.actors.map((a) => (a.id === "c_1" ? { ...a, x: 5, y: 2 } : a)),
      },
    };
    draw([hero], second);
    expect(layer.facings()["c_1"]).toBe(1);
  });
});

describe("update", () => {
  it("draws the same board twice without drawing it twice", () => {
    // `update` runs on every patch, and patches arrive constantly. Anything
    // that appends rather than reconciles turns a fight into a memory leak.
    const hero = character("c_1", "Sparklehoof");
    const { layer, draw } = board([hero], [{ x: 1, y: 1 }]);
    const childCounts = () => layer.container.children.map((c) => c.children?.length ?? 0);
    const before = childCounts();

    for (let i = 0; i < 5; i++) draw();

    expect(childCounts()).toEqual(before);
    expect(layer.nameplateBoxes()).toHaveLength(1);
  });

  it("holds a fitted label's size steady across a run of patches", () => {
    /*
     * `labelText` is cached so an unchanged name is not re-measured on every
     * patch, and patches arrive constantly.
     *
     * Worth being precise about what this does and does not guard: re-fitting
     * an already-fitted label is *harmless*, because `fitNameplate` resets the
     * scale to 1 before measuring. So the cache is an efficiency, not a
     * correctness guard, and removing it does not fail this test — it is the
     * reset inside `fitNameplate` that keeps the size stable, and that is what
     * is actually being pinned here.
     */
    const hero = character("c_1", "Moonlightbramble");
    const { layer, draw } = board([hero], [{ x: 1, y: 1 }]);
    const first = boxFor(layer, "Moonlightbramble")!.width;

    for (let i = 0; i < 10; i++) draw();

    expect(boxFor(layer, "Moonlightbramble")!.width).toBeCloseTo(first, 5);
  });

  it("survives an encounter with nobody left standing on it", () => {
    // A wipe is a real state (`encounterOutcome` reports it) and the board is
    // still on screen while the outcome is narrated.
    const hero = character("c_1", "Sparklehoof");
    const { layer, encounter, draw } = board([hero], [{ x: 1, y: 1 }]);
    const empty: EncounterState = {
      ...encounter,
      combatants: [],
      board: { ...encounter.board, actors: [] },
    };

    expect(() => draw([hero], empty)).not.toThrow();
    expect(layer.nameplateBoxes()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

describe("destroy", () => {
  it("tears the tree down and stops answering", () => {
    const hero = character("c_1", "Sparklehoof");
    const { layer, draw } = board([hero], [{ x: 1, y: 1 }]);

    layer.destroy();

    expect(layer.nameplateBoxes()).toEqual([]);
    // A late patch or a late frame after teardown is normal — the store does
    // not know the surface is gone — and must not throw into the ticker.
    expect(() => draw()).not.toThrow();
    expect(() => layer.tick(0.016)).not.toThrow();
    expect(() => layer.playEvents([], 0)).not.toThrow();
  });

  it("is safe to destroy twice", () => {
    const { layer } = board([character("c_1", "Sparklehoof")], [{ x: 0, y: 0 }]);
    layer.destroy();
    expect(() => layer.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// True relative size (#362)
// ---------------------------------------------------------------------------

describe("true size on the board", () => {
  function sized(species: string[], art: string) {
    const chars = species.map((s, i) => ({ ...character(`c${i}`, `Hero${i}`), species: s }) as ResolvedCharacter);
    const encounter = encounterOf(chars, chars.map((_, i) => ({ x: i, y: 0 })));
    const layer = createBoardLayer();
    layer.update({ ...viewOf(encounter, chars), enemyArt: { wisp: art } });
    layer.tick(0.016);
    return layer;
  }

  it("stands the heroes in proportion to each other and the enemy at its canon height", () => {
    const layer = sized(["bigfoot", "kitsune"], "enemies/river_drake");
    const sizes = layer.figureSizes();
    expect(sizes.c0!.height / sizes.c1!.height).toBeCloseTo(215 / 85);
    expect(sizes["wisp#1"]!.height / sizes.c0!.height).toBeCloseTo(180 / 215);
    expect(sizes["wisp#1"]!.stance).toBe("standing");
    layer.destroy();
  });

  it("puts a tiny enemy on the floor, lifted off its square if it hovers", () => {
    const layer = sized(["unicorn"], "enemies/will_o_wisp");
    const wisp = layer.figureSizes()["wisp#1"]!;
    expect(wisp.height).toBe(BOARD_TILE_PX * 0.55);
    expect(wisp.stance).toBe("hovering");
    layer.destroy();
  });

  it("shrinks every figure together when the tallest would pass its headroom", () => {
    // A frost wyrm fits at natural scale (260 cm is 2.2 tiles); a troll-sized
    // figure past 2.7 tiles would not, and the heroes shrink with it.
    const natural = sized(["bigfoot"], "enemies/frost_wyrm").figureSizes();
    expect(natural.c0!.height).toBeCloseTo(215 * 1.1);
    const huge = sized(["bigfoot"], "enemies/boughkin").figureSizes();
    expect(huge["wisp#1"]!.height).toBeCloseTo(BOARD_TILE_PX * 2.7);
    expect(huge["wisp#1"]!.height / huge.c0!.height).toBeCloseTo(900 / 215);
  });
});
