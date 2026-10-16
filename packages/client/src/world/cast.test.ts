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
  ENTITY_SIZES,
  MAX_CAST,
  MAX_GROUP,
  SIZE_SCALE,
  castFigureUrl,
  castFor,
  stageCast,
  stageSlots,
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
    expect(out[1]!.scale).toBe(SIZE_SCALE.medium);
    expect(out[2]!.scale).toBe(SIZE_SCALE.large);
    // The first member keeps the entry's plain key, like any group's first.
    expect(out[0]!.key).toBe("entities/skywardens|Skywardens");
  });

  it("lets an authored size win for the whole group, and ignores count", () => {
    const out = stageCast([{ figure: "entities/skywardens", size: "small", count: 5 }]);
    expect(out).toHaveLength(3);
    expect(out.every((m) => m.scale === SIZE_SCALE.small)).toBe(true);
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

  it("cuts every ensemble into declared, drawn cast figures of their declared size", () => {
    const declared = new Map(manifest.castFigures.map((f) => [`cast/${f.id}`, f.scale]));
    for (const [id, parts] of Object.entries(ENSEMBLES)) {
      expect(existsSync(`${ASSETS}/entities/${id}/assembled.png`), id).toBe(true);
      for (const part of parts) {
        expect(declared.get(part.figure), part.figure).toBe(part.size);
        expect(existsSync(`${ASSETS}${castFigureUrl(part.figure)!.slice("/assets".length)}`), part.figure).toBe(true);
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
