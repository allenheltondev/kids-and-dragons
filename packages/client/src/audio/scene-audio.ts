import type { Chapter, RunState } from "@kad/shared";
import type { AmbienceId, CueId } from "./cue";

const SCENE_CUES: Record<string, Record<string, CueId>> = {
  "gemfall-06": { scene_citadel_gate: "citadel-bell" },
  "gemfall-08": {
    scene_bells_first: "citadel-bell", scene_bells_ringing: "citadel-bell",
    scene_seal_chamber: "seal-awakening", scene_tether: "seal-awakening",
  },
};

/** The illustration identifies the location across story, vote, rest, and check scenes. */
export function ambienceForScene(chapter: Chapter | null, state: RunState | null): AmbienceId | null {
  if (!chapter || chapter.id !== state?.chapterId || state.campaignId !== "gemfall" ||
    !state.sceneId || !["scene", "check"].includes(state.phase) || state.encounter) return null;
  const scene = chapter.scenes[state.sceneId];
  if (!scene || scene.type === "encounter") return null;
  if (scene.art === "scenes/gemfall/gem-gallery") return "cavern-air";
  if (scene.art === "scenes/gemfall/hollow-gate") return "gate-hum";
  return null;
}

/** A snapshot comparison prevents repeats on HP patches, votes, and reconnect snapshots. */
export function sceneCuesFor(previous: RunState | null, next: RunState | null): CueId[] {
  if (!next || next.campaignId !== "gemfall" || !next.chapterId || !next.sceneId || next.phase === "chapter_complete") return [];
  const out: CueId[] = [];
  if (previous?.chapterId !== next.chapterId || previous.sceneId !== next.sceneId) {
    const cue = SCENE_CUES[next.chapterId]?.[next.sceneId];
    if (cue && !next.encounter) out.push(cue);
  }
  // Joining an existing run establishes a baseline, rather than replaying its entire bag.
  if (previous?.runId === next.runId) {
    const before = new Set(previous.party.flatMap((m) => m.character.questItems));
    if (next.party.some((m) => m.character.questItems.some((id) => id.startsWith("facet_") && !before.has(id)))) out.push("gem-pickup");
  }
  return out;
}

export function musicForScene(chapter: Chapter | null, state: RunState | null): string | null {
  if (!state || ["lobby", "creation"].includes(state.phase) || chapter?.id !== state.chapterId) return null;
  if (state.chapterId === "gemfall-06" && state.sceneId &&
    /^(scene_(citadel_gate|truth_table|whole_truth|reading_|who_to_tell|what_for)|rest_end)/.test(state.sceneId)) return "gemfall-citadel";
  return chapter?.biome ?? null;
}
