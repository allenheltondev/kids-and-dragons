import { describe, expect, it } from "vitest";
import type { Chapter } from "@kad/shared";
import { makeState, makeMember, makeCharacter } from "../testing/fixtures";
import { ambienceForScene, sceneCuesFor, musicForScene, reachableScenes } from "./scene-audio";
import gallery from "../../../../content/chapters/gemfall-08.json";
import ashfall from "../../../../content/chapters/gemfall-06.json";
import gate from "../../../../content/chapters/gemfall-03b.json";
import { musicUrl } from "./paths";

const state = (sceneId: string) => makeState({ phase: "scene", campaignId: "gemfall", chapterId: "gemfall-08", sceneId });
describe("Gemfall scene sound", () => {
  it("keeps gallery air through checks and rests, and leaves it for combat or the seal", () => {
    const chapter = gallery as unknown as Chapter;
    for (const sceneId of ["scene_mouth", "scene_bells_first", "check_remains", "rest_cool_gallery", "check_race_1", "check_race_2"]) {
      expect(ambienceForScene(chapter, { ...state(sceneId), phase: sceneId.startsWith("check_") ? "check" : "scene" })).toBe("cavern-air");
    }
    expect(ambienceForScene(chapter, { ...state("encounter_gallery"), phase: "encounter" })).toBeNull();
    expect(ambienceForScene(chapter, state("scene_seal_chamber"))).toBeNull();
    expect(sceneCuesFor(state("scene_mouth"), state("check_remains"))).toEqual([]);
  });
  it("keeps the Gate hum through its shard and exit vote, then stops at the river", () => {
    const chapter = gate as unknown as Chapter;
    const at = (sceneId: string) => ({ ...state(sceneId), chapterId: chapter.id });
    for (const sceneId of ["scene_hollow_gate", "scene_gate_hum", "scene_gate_shard", "choice_exit"]) expect(ambienceForScene(chapter, at(sceneId))).toBe("gate-hum");
    expect(ambienceForScene(chapter, at("scene_west_branch"))).toBeNull();
  });
  it("plays the seal cue on entry, not on votes or health updates", () => {
    const next = state("scene_seal_chamber");
    expect(sceneCuesFor(state("scene_verdict"), next)).toEqual(["seal-awakening"]);
    expect(sceneCuesFor(next, { ...next, seq: next.seq + 1 })).toEqual([]);
    expect(sceneCuesFor(next, { ...next, phase: "chapter_complete" })).toEqual([]);
  });
  it("sounds a newly acquired facet once for the party, never for an existing bag", () => {
    const before = state("scene_keystone");
    const after = { ...before, party: [makeMember({ character: makeCharacter({ questItems: ["facet_keystone"] }) })] };
    expect(sceneCuesFor(before, after)).toEqual(["gem-pickup"]);
    expect(sceneCuesFor(after, { ...after, seq: 5 })).toEqual([]);
    expect(sceneCuesFor(null, after)).toEqual([]);
  });
  it("uses forest, marsh, travelling strings, and mountain beds across environments", () => {
    expect(musicUrl("enchanted_woods")).toBe("/assets/audio/music/forest.webm");
    expect(musicUrl("whispering_marsh")).toBe("/assets/audio/music/gemfall-marsh.webm");
    expect(musicUrl("exchange")).toBe("/assets/audio/music/gemfall-citadel.webm");
    expect(musicUrl("mount_red_sky")).toBe("/assets/audio/music/gemfall-mountain.webm");
    const chapter = ashfall as unknown as Chapter;
    const next = { ...state("scene_truth_table"), chapterId: chapter.id };
    expect(musicForScene(chapter, next)).toBe("gemfall-citadel");
    expect(musicForScene(chapter, { ...next, phase: "lobby" })).toBeNull();
    expect(musicForScene(chapter, { ...next, chapterId: "gemfall-08" })).toBeNull();
  });
});

/** Independent of scene-audio.ts: the test walks the JSON itself, so a wrong helper cannot pass its own check. */
function gotoTargets(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((child) => gotoTargets(child, out));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "goto" && typeof value === "string") out.push(value);
      else gotoTargets(value, out);
    }
  }
  return out;
}

describe("Ashfall citadel music", () => {
  const chapter = ashfall as unknown as Chapter;
  const inAshfall = (sceneId: string) => ({ ...state(sceneId), chapterId: chapter.id });

  it("plays the citadel track for the scenes named in issue #168", () => {
    for (const sceneId of [
      "scene_ledger", "scene_told_wardens_room", "scene_told_gatherers_room", "scene_kept_close_room",
      "scene_declared_restore", "scene_declared_hoard", "scene_declared_leash",
      "scene_record_restore", "scene_record_hoard", "scene_record_leash",
    ]) {
      expect(musicForScene(chapter, inAshfall(sceneId)), sceneId).toBe("gemfall-citadel");
    }
  });

  it("plays the citadel track for every scene reachable from the gate", () => {
    const reachable = reachableScenes(chapter, "scene_citadel_gate");
    expect(reachable.size).toBeGreaterThan(40);
    for (const sceneId of reachable) {
      expect(musicForScene(chapter, inAshfall(sceneId)), sceneId).toBe("gemfall-citadel");
    }
  });

  it("keeps one continuous track on a path from the gate to rest_end_ashfall", () => {
    const parent = new Map<string, string | null>([["scene_citadel_gate", null]]);
    const queue = ["scene_citadel_gate"];
    for (let i = 0; i < queue.length; i++) {
      for (const target of gotoTargets(chapter.scenes[queue[i]!])) {
        if (!parent.has(target) && chapter.scenes[target]) {
          parent.set(target, queue[i]!);
          queue.push(target);
        }
      }
    }
    const path: string[] = [];
    for (let id: string | null | undefined = "rest_end_ashfall"; id; id = parent.get(id)) path.unshift(id);
    expect(path[0]).toBe("scene_citadel_gate");
    for (const sceneId of path) expect(musicForScene(chapter, inAshfall(sceneId)), sceneId).toBe("gemfall-citadel");
  });

  it("leaves the foothills before the gate on the biome track", () => {
    for (const sceneId of ["scene_arrival", "scene_crab", "scene_doorstep", "encounter_crab", "rest_end_shut_out"]) {
      expect(musicForScene(chapter, inAshfall(sceneId)), sceneId).toBe("red_sky_foothills");
    }
  });

  it("does not claim same-named scenes in other chapters", () => {
    const other = gallery as unknown as Chapter;
    expect(musicForScene(other, { ...state("scene_record_leash"), chapterId: other.id })).toBe(other.biome);
    expect(musicForScene(other, { ...state("scene_truth_table"), chapterId: other.id })).toBe(other.biome);
  });
});

describe("music overrides (#226)", () => {
  const base = gallery as unknown as Chapter;
  const at = (chapter: Chapter, sceneId: string) => ({ ...state(sceneId), chapterId: chapter.id });

  it("keeps the biome's track when neither the chapter nor the scene names one", () => {
    expect(musicForScene(base, at(base, "scene_mouth"))).toBe(base.biome);
  });

  it("plays the chapter's track in place of the biome's", () => {
    const chapter: Chapter = { ...base, music: "gemfall-marsh" };
    expect(musicForScene(chapter, at(chapter, "scene_mouth"))).toBe("gemfall-marsh");
  });

  it("lets a scene's track win over its chapter's", () => {
    const chapter: Chapter = {
      ...base,
      music: "gemfall-marsh",
      scenes: { ...base.scenes, scene_mouth: { ...base.scenes.scene_mouth!, music: "forest" } },
    };
    expect(musicForScene(chapter, at(chapter, "scene_mouth"))).toBe("forest");
    expect(musicForScene(chapter, at(chapter, "scene_bells_first"))).toBe("gemfall-marsh");
  });
});
