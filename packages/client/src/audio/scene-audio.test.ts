import { describe, expect, it } from "vitest";
import type { Chapter } from "@kad/shared";
import { makeState, makeMember, makeCharacter } from "../testing/fixtures";
import { ambienceForScene, sceneCuesFor, musicForScene } from "./scene-audio";
import gallery from "../../../../content/chapters/gemfall-08.json";
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
    const chapter = { id: "gemfall-06", biome: "red_sky_foothills" } as Chapter;
    const next = { ...state("scene_truth_table"), chapterId: chapter.id };
    expect(musicForScene(chapter, next)).toBe("gemfall-citadel");
    expect(musicForScene(chapter, { ...next, phase: "lobby" })).toBeNull();
    expect(musicForScene(chapter, { ...next, chapterId: "gemfall-08" })).toBeNull();
  });
});
