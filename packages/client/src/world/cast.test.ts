/**
 * The story stage's cast: what a chapter's `cast` turns into, and where
 * everybody stands. Pure, so the composition rules are numbers a test holds.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Chapter } from "@kad/shared";
import manifest from "../../../../assets/manifest.json";
import { makeState } from "../testing/fixtures";
import {
  ENSEMBLES,
  MAX_CAST,
  MAX_GROUP,
  MAX_OVERLAP,
  SLOT_FILL,
  STORY_MEASURE,
  castFigureUrl,
  castFor,
  stageCast,
  stageLayout,
  stageSlots,
  type StageFigure,
} from "./cast";
import { FIGURE_SIZES } from "./figure-sizes";
import { NOMINAL_PAINT, paintAspect } from "./figure-scale";

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

describe("cast ensembles", () => {
  it("stands the Skywardens as three full-size members, not one picture of three", () => {
    const out = stageCast([{ figure: "entities/skywardens", name: "Skywardens" }]);
    expect(out.map((m) => m.url)).toEqual([
      "/assets/cast/skywarden_griffin/assembled.png",
      "/assets/cast/skywarden_faun/assembled.png",
      "/assets/cast/skywarden_centaur/assembled.png",
    ]);
    expect(out.map((m) => m.name)).toEqual(["Skywardens", null, null]);
    expect(out.map((m) => m.crowd)).toEqual([0, 1, 2].map((index) => ({ index, size: 3 })));
    // Each member at its own height: the centaur stands over the faun.
    expect(out.map((m) => m.heightCm)).toEqual(
      ["skywarden_griffin", "skywarden_faun", "skywarden_centaur"].map((id) => FIGURE_SIZES[`cast/${id}`]![0]),
    );
    // The first member keeps the entry's plain key, like any group's first.
    expect(out[0]!.key).toBe("entities/skywardens|Skywardens");
  });

  it("lets an authored size and stance apply to the whole group, and ignores count", () => {
    const out = stageCast([{ figure: "entities/skywardens", size: "small", stance: "flying", count: 5 }]);
    expect(out).toHaveLength(3);
    // "small" tops out at 75 cm, and every member is taller than that.
    expect(out.every((m) => m.heightCm === 75 && m.stance === "flying")).toBe(true);
  });

  it("stands the one Warden Clerk as one warden, not the group", () => {
    const chapters = fileURLToPath(new URL("../../../../content/chapters", import.meta.url));
    let clerks = 0;
    for (const file of readdirSync(chapters).filter((f) => f.endsWith(".json"))) {
      const chapter = JSON.parse(readFileSync(`${chapters}/${file}`, "utf8")) as Chapter;
      for (const [id, scene] of Object.entries(chapter.scenes)) {
        if (scene.type === "encounter") continue;
        for (const member of scene.cast ?? []) {
          if (member.name !== "Warden Clerk") continue;
          clerks++;
          expect(stageCast([member]), `${file} ${id}`).toHaveLength(1);
        }
      }
    }
    // gemfall-07h's checkpoint; a sweep that finds nobody proves nothing.
    expect(clerks).toBeGreaterThanOrEqual(5);
  });

  it("cuts every ensemble into declared, drawn, sized cast figures", () => {
    const declared = new Set(manifest.castFigures.map((f) => `cast/${f.id}`));
    for (const [id, parts] of Object.entries(ENSEMBLES)) {
      expect(existsSync(`${ASSETS}/entities/${id}/assembled.png`), id).toBe(true);
      for (const part of parts) {
        expect(declared.has(part), part).toBe(true);
        expect(FIGURE_SIZES[part], part).toBeDefined();
        expect(existsSync(`${ASSETS}${castFigureUrl(part)!.slice("/assets".length)}`), part).toBe(true);
      }
    }
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
    expect(castFigureUrl("cast/deep-ice-figure")).toBe("/assets/cast/deep-ice-figure/assembled.png");
    expect(castFigureUrl("cast/deep--ice")).toBeNull();
    expect(castFigureUrl("selkie")).toBeNull();
    expect(castFigureUrl("entities/../secrets")).toBeNull();
    expect(stageCast([{ figure: "nonsense" }])).toEqual([]);
  });

  it("sizes every declared entity and every drawn figure the table names", () => {
    for (const entity of manifest.entities) expect(FIGURE_SIZES[`entities/${entity.id}`], entity.id).toBeDefined();
    for (const figure of Object.keys(FIGURE_SIZES)) {
      expect(existsSync(`${ASSETS}${castFigureUrl(figure)!.slice("/assets".length)}`), figure).toBe(true);
    }
  });

  it("stands a sprite, a hero and a centaur at their own heights", () => {
    const [sprite] = stageCast([{ figure: "entities/harvest_sprite" }]);
    const [centaur] = stageCast([{ figure: "entities/centaur" }]);
    const [unicorn] = stageCast([{ figure: "characters/unicorn" }]);
    expect(sprite!.heightCm).toBe(FIGURE_SIZES["entities/harvest_sprite"]![0]);
    expect(sprite!.heightCm).toBeLessThan(unicorn!.heightCm);
    expect(centaur!.heightCm).toBeGreaterThan(unicorn!.heightCm);
    // A cast figure is its own height now, not "medium" for want of a size.
    expect(stageCast([{ figure: "cast/pib" }])[0]!.heightCm).toBe(25);
    // An authored size moves the height into its band; a redundant one is a no-op.
    expect(stageCast([{ figure: "entities/centaur", size: "small" }])[0]!.heightCm).toBe(75);
    expect(stageCast([{ figure: "entities/centaur", size: "large" }])[0]!.heightCm).toBe(centaur!.heightCm);
  });

  it("takes each figure's own stance, and the chapter's over it", () => {
    expect(stageCast([{ figure: "entities/will_o_wisp" }])[0]!.stance).toBe("hovering");
    expect(stageCast([{ figure: "entities/cloud_whale" }])[0]!.stance).toBe("flying");
    expect(stageCast([{ figure: "entities/merfolk" }])[0]!.stance).toBe("swimming");
    expect(stageCast([{ figure: "entities/centaur" }])[0]!.stance).toBe("standing");
    expect(stageCast([{ figure: "cast/captain_voss", stance: "flying" }])[0]!.stance).toBe("flying");
    // Nobody the table knows: a person, standing.
    expect(stageCast([{ figure: "entities/nobody_drawn" }])[0]).toMatchObject({ heightCm: 160, stance: "standing" });
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

  it("leaves room for full hero rig canvases beside a paged guest on a narrow stage", () => {
    const slots = stageSlots(3, [1], WIDTH, [], true);
    for (const x of slots.party) {
      expect(x - 345).toBeGreaterThanOrEqual(0);
      expect(x + 345).toBeLessThanOrEqual(WIDTH);
    }
    expect(slots.cast[0]).toBe(WIDTH * 0.8);
  });

  it("fits three heroes and three guests on the stage, spilling only off the right when crowded", () => {
    const hero = (heightCm: number): StageFigure => ({ heightCm, stance: "standing", paint: null });
    for (const width of [1600, 2560]) for (const heights of [[160, 160, 160], [25, 230, 330]]) {
      const party = [hero(165), hero(85), hero(215)];
      const cast = heights.map(hero);
      const fit = stageLayout(party, cast, width);
      const aspect = paintAspect(NOMINAL_PAINT);
      const figures = [
        ...fit.slots.party.map((x, i) => ({ x, width: fit.party[i]! * aspect, room: fit.slots.partySlot })),
        ...fit.slots.cast.map((x, i) => ({ x, width: fit.cast[i]! * aspect, room: fit.slots.castSlots[i]! })),
      ];
      for (const figure of figures) {
        expect(figure.x - figure.width / 2).toBeGreaterThanOrEqual(0);
        // Above the floors, nobody's painted box spans more than SLOT_FILL of
        // its slot; at the minimum scale neighbours overlap instead.
        if (figure.width > STORY_MEASURE.floor * aspect && fit.k > STORY_MEASURE.minScale!) {
          expect(figure.width).toBeLessThanOrEqual(figure.room * SLOT_FILL + 1e-6);
          expect(figure.x + figure.width / 2).toBeLessThanOrEqual(width);
        }
      }
      // Left to right, centres in order and apart.
      for (let i = 1; i < figures.length; i++) expect(figures[i]!.x).toBeGreaterThan(figures[i - 1]!.x);
    }
  });

  it("never shrinks a crowded scene below minScale: three heroes and three guests (#366 review)", () => {
    const figure = (heightCm: number): StageFigure => ({ heightCm, stance: "standing", paint: null });
    const party = [figure(165), figure(85), figure(215)];
    const cast = [figure(160), figure(230), figure(330)];
    const aspect = paintAspect(NOMINAL_PAINT);
    for (const width of [1600, 2560]) {
      const fit = stageLayout(party, cast, width);
      expect(fit.k, `k at ${width}`).toBeGreaterThanOrEqual(STORY_MEASURE.minScale!);
      expect(fit.party[2]! / fit.party[1]!).toBeCloseTo(215 / 85);
      const partyEdge = Math.max(...fit.slots.party) + fit.slots.partySlot / 2;
      const half = fit.cast.map((h) => (h * aspect) / 2);
      fit.slots.cast.forEach((x, i) => {
        // Nobody over the party: a guest's paint starts at or after the party's share.
        expect(x - half[i]!, `guest ${i} at ${width}`).toBeGreaterThanOrEqual(partyEdge - 1e-6);
        if (i > 0) {
          expect(x).toBeGreaterThan(fit.slots.cast[i - 1]!);
          // Neighbours overlap by at most MAX_OVERLAP of their half-widths.
          expect(x - fit.slots.cast[i - 1]!).toBeGreaterThanOrEqual((1 - MAX_OVERLAP) * (half[i]! + half[i - 1]!) - 1e-6);
        }
      });
      // On a TV-wide stage everybody fits; on a narrow one the spill is off the right only.
      if (width === 2560) fit.slots.cast.forEach((x, i) => expect(x + half[i]!).toBeLessThanOrEqual(width));
      else expect(fit.slots.cast[0]! + half[0]!).toBeLessThanOrEqual(width);
      // Names keep to their slots, so adjacent slots never overlap: names cannot touch.
      for (let i = 1; i < fit.slots.cast.length; i++) {
        const gap = fit.slots.cast[i]! - fit.slots.cast[i - 1]!;
        expect(gap).toBeGreaterThanOrEqual((fit.slots.castSlots[i]! + fit.slots.castSlots[i - 1]!) / 2 - 1e-6);
      }
    }
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

  it("gives a wide figure more room than a narrow one", () => {
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
