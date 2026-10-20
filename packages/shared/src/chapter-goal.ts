/**
 * A chapter's goal (#356): which steps a run has ticked, and which steps some
 * road to a success ending never ticks.
 *
 * The screens read `goalProgress` against the run's flags, so a step ticks the
 * moment the engine sets its flag and there is nothing to tap. The validator
 * reads `stepsOffTheSpine` so a step a party can finish the chapter without doing
 * fails the build rather than sitting unticked on the TV at the end.
 */

import type { Chapter, ChapterGoal, Effect, GoalStep, Scene, SceneId } from "./types/chapter.js";

/** The flags a step watches: one, or any of a list. */
export function goalStepFlags(step: GoalStep): string[] {
  return Array.isArray(step.flag) ? step.flag : [step.flag];
}

/** Whether a step is ticked by these run flags. */
export function goalStepDone(step: GoalStep, flags: Readonly<Record<string, boolean>>): boolean {
  return goalStepFlags(step).some((flag) => flags[flag] === true);
}

/** Ticked or not, for each step in order. */
export function goalProgress(goal: ChapterGoal, flags: Readonly<Record<string, boolean>>): boolean[] {
  return goal.steps.map((step) => goalStepDone(step, flags));
}

const BRANCH_KEYS = ["onSuccess", "onFailure", "onVictory", "onDefeat", "onEscape", "onTimeout"] as const;

/** Every way out of a scene: where it goes and what happens on the way. */
function exits(scene: Scene): { goto: SceneId; effects: readonly Effect[] }[] {
  const out: { goto: SceneId; effects: readonly Effect[] }[] = [];
  const record = scene as unknown as Record<string, unknown>;
  for (const choice of (record.choices as { goto: SceneId; effects?: Effect[] }[] | undefined) ?? []) {
    out.push({ goto: choice.goto, effects: choice.effects ?? [] });
  }
  for (const key of BRANCH_KEYS) {
    const branch = record[key] as { goto?: SceneId; effects?: Effect[] } | undefined;
    if (branch?.goto) out.push({ goto: branch.goto, effects: branch.effects ?? [] });
  }
  return out;
}

/** A scene with no way out ends the chapter (content/README.md). */
function isEnding(scene: Scene): boolean {
  return exits(scene).length === 0;
}

/**
 * The steps that some path from the entry to a success ending can reach the
 * end without ticking, each with one ending that proves it.
 *
 * A must-analysis over the scene graph: what is ticked on arrival at a scene is
 * what every way in has ticked. Every authored way counts, gated or not, since
 * a gate can only hide a choice beside an ungated one; a setFlag that only some
 * party sees (a freed captive, a met objective) is not counted, and a step
 * whose flag some way sets false is ticked no further. Optional steps are left
 * out, which is what `optional` is for.
 */
export function stepsOffTheSpine(chapter: Chapter): { stepId: string; ending: SceneId }[] {
  const goal = chapter.goal;
  if (!goal) return [];
  const steps = goal.steps.filter((step) => step.optional !== true);
  if (steps.length === 0) return [];

  const apply = (ticked: Set<string>, effects: readonly Effect[] | undefined): Set<string> => {
    const next = new Set(ticked);
    for (const effect of effects ?? []) {
      if (effect.type !== "setFlag") continue;
      for (const step of steps) {
        if (!goalStepFlags(step).includes(effect.flag)) continue;
        if (effect.value ?? true) next.add(step.id);
        else next.delete(step.id);
      }
    }
    return next;
  };

  // `null` is "no way in found yet", the top of the lattice.
  const arriving = new Map<SceneId, Set<string> | null>();
  for (const id of Object.keys(chapter.scenes)) arriving.set(id, null);
  if (!chapter.scenes[chapter.entry]) return [];
  arriving.set(chapter.entry, new Set());

  const queue: SceneId[] = [chapter.entry];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const scene = chapter.scenes[id];
    const here = arriving.get(id);
    if (!scene || here == null) continue;
    const entered = apply(here, scene.onEnter);
    for (const exit of exits(scene)) {
      if (!chapter.scenes[exit.goto]) continue;
      const out = apply(entered, exit.effects);
      const before = arriving.get(exit.goto);
      const merged = before == null ? out : new Set([...before].filter((step) => out.has(step)));
      if (before == null || merged.size !== before.size) {
        arriving.set(exit.goto, merged);
        queue.push(exit.goto);
      }
    }
  }

  const missing = new Map<string, SceneId>();
  for (const [id, scene] of Object.entries(chapter.scenes)) {
    if (!isEnding(scene) || ("outcome" in scene && scene.outcome === "setback")) continue;
    const here = arriving.get(id);
    if (here == null) continue;
    const ended = apply(here, scene.onEnter);
    for (const step of steps) {
      if (!ended.has(step.id) && !missing.has(step.id)) missing.set(step.id, id);
    }
  }
  return steps.filter((step) => missing.has(step.id)).map((step) => ({ stepId: step.id, ending: missing.get(step.id)! }));
}
