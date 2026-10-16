/**
 * The story stage's cast: what a chapter's `cast` turns into, and where
 * everybody stands. Pure, so the composition rules are numbers a test holds.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Chapter } from "@kad/shared";
import manifest from "../../../../assets/manifest.json";
import { makeState } from "../testing/fixtures";
import {
  ENTITY_SIZES,
  MAX_CAST,
  MAX_GROUP,
  SIZE_SCALE,
  castFigureUrl,
  castFor,
  stageCast,
  stageSlots,
  stageFigureScale,
} from "./cast";

const ASSETS = fileURLToPath(new URL("../../../../assets", import.meta.url));

const chapter = {
  id: "c1",
  scenes: {
    tavern: {
      type: "story",
      narration: "A selkie is waving her arms.",
      choices: [],
      cast: [{ figure: "entities/selkie", name: "Professor Tidewell" }],
    },
    empty: { type: "story", narration: "Nobody here.", choices: [] },
    fight: { type: "encounter", map: "m", enemies: [], onVictory: { goto: "x" }, onDefeat: { goto: "x" } },
  },
} as unknown as Chapter;

describe("cast groups", () => {
  it("draws as many figures as the count says, with one nameplate", () => {
    const out = stageCast([{ figure: "entities/cinder_wolf", name: "Pack", count: 3 }]);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((m) => m.key)).size).toBe(3);
    expect(out.map((m) => m.name)).toEqual(["Pack", null, null]);
    expect(stageCast([{ figure: "entities/cinder_wolf" }])[0]?.crowd).toBeUndefined();
  });

  it("clamps a silly count", () => {
    expect(stageCast([{ figure: "entities/cinder_wolf", count: 99 }])).toHaveLength(MAX_GROUP);
    expect(stageCast([{ figure: "entities/cinder_wolf", count: 0 }])).toHaveLength(1);
  });

  it("packs a group tighter than the same number of separate figures", () => {
    const spread = stageSlots(2, [1, 1, 1], 1600, [false, false, false]).cast;
    const huddle = stageSlots(2, [1, 1, 1], 1600, [true, true, true]).cast;
    expect(huddle[2]! - huddle[0]!).toBeLessThan(spread[2]! - spread[0]!);
  });
});

describe("cast figures", () => {
  it("resolves every kind of figure to a file under assets/", () => {
    for (const figure of ["entities/selkie", "characters/dragonling"]) {
      const url = castFigureUrl(figure);
      expect(url, figure).not.toBeNull();
      expect(existsSync(`${ASSETS}${url!.slice("/assets".length)}`), url!).toBe(true);
    }
    expect(castFigureUrl("cast/tidewell")).toBe("/assets/cast/tidewell/assembled.png");
  });

  it("refuses a figure the schema would refuse", () => {
    expect(castFigureUrl("selkie")).toBeNull();
    expect(castFigureUrl("entities/../secrets")).toBeNull();
    expect(stageCast([{ figure: "nonsense" }])).toEqual([]);
  });

  it("keeps the size table in lockstep with manifest.entities", () => {
    for (const entity of manifest.entities) {
      expect(ENTITY_SIZES[entity.id], entity.id).toBe(entity.scale);
    }
    // The rest are drawn but undeclared; each must at least be real art.
    const declared = new Set(manifest.entities.map((e) => e.id));
    for (const id of Object.keys(ENTITY_SIZES).filter((id) => !declared.has(id))) {
      expect(existsSync(`${ASSETS}/entities/${id}/assembled.png`), id).toBe(true);
    }
  });

  it("sizes a sprite below a hero and a centaur above one", () => {
    const [sprite] = stageCast([{ figure: "entities/harvest_sprite" }]);
    const [centaur] = stageCast([{ figure: "entities/centaur" }]);
    const [elder] = stageCast([{ figure: "characters/unicorn" }]);
    expect(sprite!.scale).toBeLessThan(1);
    expect(centaur!.scale).toBeGreaterThan(1);
    expect(elder!.scale).toBe(SIZE_SCALE.medium);
    // An authored size wins over the manifest's.
    expect(stageCast([{ figure: "entities/centaur", size: "small" }])[0]!.scale).toBe(SIZE_SCALE.small);
  });

  it("names only who the chapter names", () => {
    const [named, unnamed] = stageCast([
      { figure: "entities/selkie", name: "Professor Tidewell" },
      { figure: "entities/yeti" },
    ]);
    expect(named!.name).toBe("Professor Tidewell");
    expect(unnamed!.name).toBeNull();
    expect(named!.key).not.toBe(unnamed!.key);
  });

  it("never stands more than three", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ figure: "entities/sheeple", name: `S${i}` }));
    expect(stageCast(many)).toHaveLength(MAX_CAST);
  });
});

describe("castFor", () => {
  const state = makeState({ chapterId: "c1", sceneId: "tavern" });

  it("follows the scene", () => {
    expect(castFor(chapter, state).map((m) => m.name)).toEqual(["Professor Tidewell"]);
    expect(castFor(chapter, { ...state, sceneId: "empty" })).toEqual([]);
  });

  it("stands nobody in a fight, or for a chapter the client has not caught up to", () => {
    expect(castFor(chapter, { ...state, sceneId: "fight" })).toEqual([]);
    expect(castFor(chapter, { ...state, encounter: {} as never })).toEqual([]);
    expect(castFor(chapter, { ...state, chapterId: "c2" })).toEqual([]);
    expect(castFor(null, state)).toEqual([]);
  });
});

describe("stageSlots", () => {
  const WIDTH = 1600;

  it("fits three heroes and three guests' entire canvases inside their slots", () => {
    for (const width of [1600, 2560]) for (const scales of [[1, 1, 1], [0.4, 1.25, 1.45]]) {
      const slots = stageSlots(3, scales, width);
      const factor = stageFigureScale(slots, scales, 504);
      const figures = [...slots.party.map((x) => ({ x, half: 252 * factor })),
        ...slots.cast.map((x, i) => ({ x, half: 252 * scales[i]! * factor }))];
      for (const figure of figures) {
        expect(figure.x - figure.half).toBeGreaterThanOrEqual(0);
        expect(figure.x + figure.half).toBeLessThanOrEqual(width);
      }
      for (let i = 1; i < figures.length; i++) {
        expect(figures[i]!.x - figures[i]!.half).toBeGreaterThan(figures[i - 1]!.x + figures[i - 1]!.half);
      }
    }
    expect(stageFigureScale(stageSlots(3, [1], WIDTH), [1], 504)).toBe(1);
  });

  it("centres the party when nobody else is there, as it always did", () => {
    const { party, cast } = stageSlots(3, [], WIDTH);
    expect(cast).toEqual([]);
    expect((party[0]! + party[2]!) / 2).toBeCloseTo(WIDTH / 2);
  });

  it("puts the party on the left and the cast on the right, with a gap between", () => {
    for (const partyCount of [1, 2, 3]) {
      for (const scales of [[1], [1.25, 1.25], [0.4, 1, 1.45]]) {
        const { party, cast } = stageSlots(partyCount, scales, WIDTH);
        expect(party).toHaveLength(partyCount);
        expect(cast).toHaveLength(scales.length);
        expect(Math.max(...party)).toBeLessThan(WIDTH / 2);
        expect(Math.min(...cast)).toBeGreaterThan(WIDTH / 2);
        for (const x of [...party, ...cast]) {
          expect(x).toBeGreaterThan(0);
          expect(x).toBeLessThan(WIDTH);
        }
        // Left to right, in order: nobody swaps places with their neighbour.
        expect([...cast].sort((a, b) => a - b)).toEqual(cast);
      }
    }
  });

  it("gives a big figure more room than a small one", () => {
    const { castSlots } = stageSlots(3, [0.4, 1.25], WIDTH);
    expect(castSlots[1]!).toBeGreaterThan(castSlots[0]!);
  });

  it("keeps the party a group on a wide stage instead of scattering it", () => {
    const wide = stageSlots(3, [1], 2560);
    const wider = stageSlots(3, [1], 4000);
    const spread = (xs: number[]) => xs[xs.length - 1]! - xs[0]!;
    expect(spread(wider.party)).toBeCloseTo(spread(wide.party));
    expect(spread(wide.party)).toBeLessThan(2560 * 0.3);
  });
});
