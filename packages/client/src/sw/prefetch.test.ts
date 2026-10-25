/**
 * Prefetching the scenes ahead (prefetch.ts): which files, in what order, and
 * how far. The fetching itself goes through `warm`, which does nothing without
 * a service worker, so this is about the choosing.
 */

import { describe, expect, it } from "vitest";
import type { Chapter } from "@kad/shared";
import { makeChapter } from "../../../shared/src/test-fixtures";
import { makeCharacter, makeMember } from "../testing/fixtures";
import { chapterAssets, upcomingAssets } from "./prefetch";

/**
 * The shared fixture, with real art: clearing → (check_squeeze | shrine);
 * check_squeeze → (shrine | scratched); shrine → encounter_wisps → camp.
 */
function chapter(): Chapter {
  const base = makeChapter();
  const scenes = structuredClone(base.scenes);
  scenes["scene_clearing"] = { ...scenes["scene_clearing"]!, art: "scenes/bramblewood/clearing" } as never;
  scenes["scene_shrine"] = { ...scenes["scene_shrine"]!, art: "scenes/bramblewood/shrine" } as never;
  const fight = scenes["encounter_wisps"] as Extract<Chapter["scenes"][string], { type: "encounter" }>;
  scenes["encounter_wisps"] = { ...fight, enemies: fight.enemies.map((enemy) => ({ ...enemy, art: "enemies/will_o_wisp" })) };
  return { ...base, scenes };
}

const PARTY = [makeMember({ character: makeCharacter({ species: "unicorn", tier: "fledgling", class: "songkeeper" }) })];

describe("the scenes ahead", () => {
  it("starts with the party's own figures — every scene needs them", () => {
    const urls = upcomingAssets(null, null, PARTY);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe("/assets/characters/unicorn/fledgling/assembled.png");
  });

  it("before the chapter begins, fetches its entry and what follows it", () => {
    const urls = upcomingAssets(chapter(), null, []);
    expect(urls[0]).toBe("/assets/scenes/bramblewood/clearing.webp");
    expect(urls).toContain("/assets/scenes/bramblewood/shrine.webp");
  });

  it("from a scene, fetches the next two steps but not the scene itself", () => {
    const urls = upcomingAssets(chapter(), "scene_shrine", []);
    expect(urls).not.toContain("/assets/scenes/bramblewood/shrine.webp");
    // One step: the fight — its enemies and the biome's tiles.
    expect(urls).toContain("/assets/entities/will_o_wisp/assembled.png");
    expect(urls).toContain("/assets/biomes/enchanted_woods/tiles.png");
    // Two steps: the camp, which has no art of its own, so the biome's backdrop.
    expect(urls).toContain("/assets/biomes/enchanted_woods/bg.webp");
  });

  it("stops at the depth it is given", () => {
    // From the clearing: step 1 is check_squeeze and the shrine, step 2 the
    // scratch and the fight. One step does not reach the fight.
    const two = upcomingAssets(chapter(), "scene_clearing", []);
    expect(two).toContain("/assets/entities/will_o_wisp/assembled.png");
    const one = upcomingAssets(chapter(), "scene_clearing", [], 1);
    expect(one).not.toContain("/assets/entities/will_o_wisp/assembled.png");
  });

  it("never lists a file twice", () => {
    const urls = upcomingAssets(chapter(), "scene_clearing", PARTY);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("the whole chapter", () => {
  it("lists the entry's backdrop first, every enemy with art, and the biome's tiles", () => {
    const urls = chapterAssets(chapter(), PARTY);
    expect(urls[0]).toBe("/assets/characters/unicorn/fledgling/assembled.png");
    expect(urls[1]).toBe("/assets/scenes/bramblewood/clearing.webp");
    expect(urls).toContain("/assets/scenes/bramblewood/shrine.webp");
    expect(urls).toContain("/assets/entities/will_o_wisp/assembled.png");
    expect(urls).toContain("/assets/biomes/enchanted_woods/tiles.png");
    expect(urls).toContain("/assets/biomes/enchanted_woods/bg.webp");
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("reaches scenes beyond the prefetch depth, and visits each scene once", () => {
    const c = chapter();
    const scenes = { ...c.scenes };
    // A scene no more than the entry's neighbours away from nothing: unreachable by depth.
    scenes["scene_far"] = { ...scenes["scene_shrine"]!, art: "scenes/bramblewood/far" } as never;
    const deep = { ...c, scenes };
    expect(upcomingAssets(deep, null, [])).not.toContain("/assets/scenes/bramblewood/far.webp");
    expect(chapterAssets(deep, [])).toContain("/assets/scenes/bramblewood/far.webp");
  });

  it("is just the party when there is no chapter", () => {
    expect(chapterAssets(null, PARTY)).toHaveLength(1);
  });
});
