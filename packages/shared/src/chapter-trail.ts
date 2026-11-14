/**
 * The trail and the chances: what the goal card shows besides the goal's sentence.
 *
 * The goal's steps always get done (`stepsOffTheSpine` holds every road to them), so
 * listing them ahead is a checklist the party cannot miss, and a mild spoiler. The
 * screens show them as milestones instead: a pip each, named only once it ticks, in
 * the words for how this party did it (`goalStepSaid`). Beside them, how far along
 * the chapter the party is (`trailFraction`), for the grown-up wondering about bedtime.
 *
 * What the party *can* miss is the chapter's bonus objectives. Those become chances
 * (`chanceStates`): an objective with a `reveal` shows its `hint` once the story has
 * mentioned it, and drops off once no road left can set its flag. One met with no
 * reveal is a surprise, shown the moment it ticks. All of it is read from the run
 * the screens already mirror (flags, `visited`, the scene), so nothing new is sent.
 */

import type { Chapter, ChapterObjective, GoalStep, SceneId } from "./types/chapter.js";
// Value imports carry `.ts` so the content gate can load this file under plain Node.
import { goalStepDone, goalStepFlags } from "./chapter-goal.ts";
import type { GoalFacts } from "./chapter-goal.js";
import { sceneEffects } from "./chapter-graph.ts";
import { sceneExits } from "./scene-exits.ts";

/**
 * What a ticked step says: its `doneLabel` for the flag that ticked it (the first
 * of its flags that is set), or its one `doneLabel`, or its `label`.
 */
export function goalStepSaid(step: GoalStep, facts: GoalFacts): string {
  const said = step.doneLabel;
  if (said === undefined) return step.label;
  if (typeof said === "string") return said;
  const flag = goalStepFlags(step).find((f) => facts.flags[f] === true && said[f] !== undefined);
  return flag === undefined ? step.label : said[flag]!;
}

/** Each step, ticked or not, with what a ticked one says. */
export function goalMilestones(steps: readonly GoalStep[], facts: GoalFacts): { step: GoalStep; done: boolean; said: string }[] {
  return steps.map((step) => ({ step, done: goalStepDone(step, facts), said: goalStepSaid(step, facts) }));
}

function isEnding(chapter: Chapter, id: SceneId): boolean {
  const scene = chapter.scenes[id];
  return scene !== undefined && sceneExits(scene).length === 0;
}

function isSuccessEnding(chapter: Chapter, id: SceneId): boolean {
  const scene = chapter.scenes[id];
  return isEnding(chapter, id) && !(scene && "outcome" in scene && scene.outcome === "setback");
}

/** Every scene's ways in, for walking the graph backwards. */
function waysIn(chapter: Chapter): Map<SceneId, SceneId[]> {
  const into = new Map<SceneId, SceneId[]>();
  for (const [id, scene] of Object.entries(chapter.scenes)) {
    for (const exit of sceneExits(scene)) {
      if (!chapter.scenes[exit.to]) continue;
      const list = into.get(exit.to) ?? [];
      list.push(id);
      into.set(exit.to, list);
    }
  }
  return into;
}

/** Scenes from each scene to the nearest of `goals`, walking backwards from them. */
function distancesTo(chapter: Chapter, goals: SceneId[]): Map<SceneId, number> {
  const into = waysIn(chapter);
  const dist = new Map<SceneId, number>();
  const queue: SceneId[] = [];
  for (const id of goals) {
    dist.set(id, 0);
    queue.push(id);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = dist.get(id)!;
    for (const from of into.get(id) ?? []) {
      if (dist.has(from)) continue;
      dist.set(from, d + 1);
      queue.push(from);
    }
  }
  return dist;
}

/**
 * Scenes from each scene to the nearest success ending, or to the nearest ending
 * of any kind from a scene that can only reach a setback.
 */
export function scenesToEnding(chapter: Chapter): Map<SceneId, number> {
  const ids = Object.keys(chapter.scenes);
  const success = distancesTo(chapter, ids.filter((id) => isSuccessEnding(chapter, id)));
  const any = distancesTo(chapter, ids.filter((id) => isEnding(chapter, id)));
  for (const [id, d] of any) if (!success.has(id)) success.set(id, d);
  return success;
}

/**
 * How far along the chapter a party standing at `sceneId` is, 0 at the entry and
 * 1 at an ending: one less the share of the entry's shortest road still to walk.
 * A detour can read a little behind; the screen keeps the furthest it has shown.
 */
export function trailFraction(chapter: Chapter, sceneId: SceneId | null, distances: Map<SceneId, number> = scenesToEnding(chapter)): number {
  if (sceneId === null) return 0;
  const total = distances.get(chapter.entry);
  const left = distances.get(sceneId);
  if (total === undefined || total === 0 || left === undefined) return 0;
  return Math.max(0, Math.min(1, 1 - left / total));
}

/** The scenes an objective's `reveal` names, as a list. */
export function chanceRevealScenes(objective: ChapterObjective): SceneId[] {
  if (objective.reveal === undefined) return [];
  return Array.isArray(objective.reveal) ? objective.reveal : [objective.reveal];
}

/**
 * The scenes from which some road can still set `flag`: every scene that can set it
 * itself (on entry, on a way out, in a fight's place), and every scene that leads to
 * one. A party standing anywhere else has missed it.
 */
export function scenesThatCanStillSet(chapter: Chapter, flag: string): Set<SceneId> {
  // The screens ask on every render; the answer only changes with the chapter.
  let byFlag = canStillSet.get(chapter);
  if (!byFlag) canStillSet.set(chapter, (byFlag = new Map()));
  const known = byFlag.get(flag);
  if (known) return known;
  const setters = Object.entries(chapter.scenes)
    .filter(([, scene]) => sceneEffects(scene).some((e) => e.type === "setFlag" && e.flag === flag && (e.value ?? true)))
    .map(([id]) => id);
  const found = new Set(distancesTo(chapter, setters).keys());
  byFlag.set(flag, found);
  return found;
}

const canStillSet = new WeakMap<Chapter, Map<string, Set<SceneId>>>();

/**
 * - `hidden`: not revealed and not met, so not shown.
 * - `open`: revealed, not met, and some road from here can still set it.
 * - `met`: its flag is set; it pays when the chapter ends.
 * - `missed`: revealed, not met, and no road from here can set it any more.
 */
export type ChanceState = "hidden" | "open" | "met" | "missed";

export interface ChanceFacts {
  flags: Readonly<Record<string, boolean>>;
  /** The scenes entered this chapter (`RunState.visited`). */
  visited?: readonly SceneId[];
  /** Where the party is now, or null between scenes. */
  sceneId: SceneId | null;
}

export interface Chance {
  objective: ChapterObjective;
  state: ChanceState;
  /** Whether the story mentioned it before it was met. */
  revealed: boolean;
}

/** Each of the chapter's bonus objectives as a chance, in authored order. */
export function chanceStates(chapter: Chapter, facts: ChanceFacts): Chance[] {
  const seen = new Set(facts.visited ?? []);
  if (facts.sceneId !== null) seen.add(facts.sceneId);
  return (chapter.objectives ?? []).map((objective) => {
    const revealed = chanceRevealScenes(objective).some((id) => seen.has(id));
    if (facts.flags[objective.flag] === true) return { objective, state: "met", revealed };
    if (!revealed) return { objective, state: "hidden", revealed };
    const still = facts.sceneId !== null && scenesThatCanStillSet(chapter, objective.flag).has(facts.sceneId);
    return { objective, state: still ? "open" : "missed", revealed };
  });
}
