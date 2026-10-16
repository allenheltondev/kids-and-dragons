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

/** Chapters whose citadel track starts at a gate scene. Every scene reachable from the gate plays the track. */
const CITADEL_GATES: Record<string, { gate: string; track: string }> = {
  "gemfall-06": { gate: "scene_citadel_gate", track: "gemfall-citadel" },
};

const citadelSceneCache = new WeakMap<Chapter, Set<string>>();

/** Every `goto` target in a scene, at any depth: choices, check outcomes, and encounter victories all route through `goto`. */
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

/** Scenes the party can reach from `start` by following the chapter graph, so a new scene inherits its track without a name rule. */
export function reachableScenes(chapter: Chapter, start: string): Set<string> {
  const seen = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const id = pending.pop()!;
    const scene = chapter.scenes[id];
    if (seen.has(id) || !scene) continue;
    seen.add(id);
    pending.push(...gotoTargets(scene));
  }
  return seen;
}

function citadelScenes(chapter: Chapter, gate: string): Set<string> {
  let scenes = citadelSceneCache.get(chapter);
  if (!scenes) {
    scenes = reachableScenes(chapter, gate);
    citadelSceneCache.set(chapter, scenes);
  }
  return scenes;
}

export function musicForScene(chapter: Chapter | null, state: RunState | null): string | null {
  if (!state || ["lobby", "creation"].includes(state.phase) || chapter?.id !== state.chapterId) return null;
  // Scene beats chapter beats biome (#226). Music still changes only when the scene does.
  const scene = state.sceneId ? chapter?.scenes[state.sceneId] : undefined;
  if (scene?.music) return scene.music;
  if (chapter?.music) return chapter.music;
  const citadel = chapter ? CITADEL_GATES[chapter.id] : undefined;
  if (chapter && citadel && state.sceneId && citadelScenes(chapter, citadel.gate).has(state.sceneId)) return citadel.track;
  return chapter?.biome ?? null;
}
