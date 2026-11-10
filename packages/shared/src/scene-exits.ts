/**
 * The ways out of a scene.
 *
 * "Where can this scene lead?" is asked all over the repo (the graph check,
 * the goal's spine, the content gate, the continuity sweep, the map, the
 * loader) and was answered by hand in each place, not always the same way.
 * This is the one answer: the choices of a story, choice-point or rest scene,
 * and the branches the scene's type has, in a fixed order.
 *
 * A scene with no exits ends the chapter (content/README.md).
 */

import type { Branch, Choice, Effect, Scene, SceneId } from "./types/chapter.js";

/** A check's, an interaction's and an encounter's branch keys, in the order exits are listed. */
export const SCENE_BRANCH_KEYS = ["onSuccess", "onFailure", "onAssisted", "onVictory", "onDefeat", "onEscape", "onTimeout"] as const;
export type BranchKey = (typeof SCENE_BRANCH_KEYS)[number];

/** The branch keys a scene of each type may carry. */
const BRANCHES_OF: Partial<Record<string, readonly BranchKey[]>> = {
  check: ["onSuccess", "onFailure"],
  interaction: ["onSuccess", "onFailure", "onAssisted"],
  // An environmental fight's other endings (#201) are exits like the first two.
  encounter: ["onVictory", "onDefeat", "onEscape", "onTimeout"],
};
/** The types that leave by their choices. */
const CHOICE_TYPES: ReadonlySet<string> = new Set(["story", "choice_point", "rest"]);

interface ExitBase {
  /** The scene it leads to. Authored JSON, so it may name no scene at all. */
  to: SceneId;
  /** Where it is authored, as a JSON pointer below the scene: `/choices/2`, `/onSuccess`. */
  at: string;
  /** What happens on the way. */
  effects: readonly Effect[];
}

export interface ChoiceExit extends ExitBase {
  via: "choice";
  choice: Choice;
  /** Its place in the scene's `choices`. */
  index: number;
}

export interface BranchExit extends ExitBase {
  via: BranchKey;
  branch: Branch;
}

export type SceneExit = ChoiceExit | BranchExit;

/**
 * Every way out of a scene, in authored order: choices first to last, or the
 * branches its type has, in `SCENE_BRANCH_KEYS` order. A branch the scene does not
 * carry is left out; one it carries is listed even when its `goto` is missing,
 * so a caller checking the graph can say so.
 *
 * Read by type, as the engine reads a scene: a branch key on a scene whose
 * type does not have it is not an exit (the chapter schema refuses it anyway).
 * An unknown type has no exits, which is safer for a walker than throwing
 * past the check about to report it.
 */
export function sceneExits(scene: Scene): SceneExit[] {
  const record = scene as unknown as Partial<Record<BranchKey, Branch>> & { type?: string; choices?: Choice[] };
  const type = record.type ?? "";
  const keys = BRANCHES_OF[type];
  if (keys) {
    const exits: SceneExit[] = [];
    for (const key of keys) {
      const branch = record[key];
      if (branch) exits.push({ via: key, to: branch.goto, at: `/${key}`, effects: branch.effects ?? [], branch });
    }
    return exits;
  }
  if (!CHOICE_TYPES.has(type) || !Array.isArray(record.choices)) return [];
  return record.choices.map((choice, index) => ({
    via: "choice",
    to: choice.goto,
    at: `/choices/${String(index)}`,
    effects: choice.effects ?? [],
    choice,
    index,
  }));
}

/** Whether the scene ends the chapter: it leads nowhere. */
export function isEndingScene(scene: Scene): boolean {
  return sceneExits(scene).length === 0;
}
