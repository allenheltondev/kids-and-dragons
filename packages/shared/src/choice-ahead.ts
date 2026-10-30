/**
 * What a choice leads to (playtest feedback): a dice roll, a game or a fight,
 * so the table sees on each option what picking it will ask of them before
 * anybody taps. The TV's pills and the phones' buttons draw it as a small
 * badge beside the label.
 *
 * Read from the chapter, never authored: the scene the choice goes to, or,
 * when that scene is only a step on the way (a Story beat with a single way
 * on, which is how a choice "lands on a scene that shows its result"), the one
 * after it, up to `LOOK_AHEAD` steps. Anything else (another decision, a rest,
 * an ending) is no badge: the option leads to more story.
 */

import type { Chapter, Choice, Scene, SceneId } from "./types/chapter.js";
import type { StatId } from "./types/domain.js";

/** What picking an option will ask of the table next. */
export type ChoiceAhead =
  /** A check: one hero rolls (`party` true: everyone does), on `stat`. */
  | { kind: "roll"; stat: StatId; party?: true }
  /** A story game (an interaction scene). */
  | { kind: "game" }
  /** A fight on the board. */
  | { kind: "fight" };

/** How many single-way-on Story scenes to look through for what comes next. */
export const LOOK_AHEAD = 2;

function aheadOf(scene: Scene): ChoiceAhead | null {
  switch (scene.type) {
    case "check":
      return scene.roller === "all" ? { kind: "roll", stat: scene.stat, party: true } : { kind: "roll", stat: scene.stat };
    case "interaction":
      return { kind: "game" };
    case "encounter":
      // A fight that resolves itself never puts the board up.
      return scene.autoResolve === undefined ? { kind: "fight" } : null;
    default:
      return null;
  }
}

/** What `choice` leads to in `chapter`, or null when it leads to more story. */
export function choiceAhead(chapter: Pick<Chapter, "scenes">, choice: Pick<Choice, "goto">): ChoiceAhead | null {
  const seen = new Set<SceneId>();
  let at: SceneId | undefined = choice.goto;
  for (let step = 0; step <= LOOK_AHEAD && at !== undefined && !seen.has(at); step++) {
    seen.add(at);
    const scene: Scene | undefined = chapter.scenes[at];
    if (!scene) return null;
    const ahead = aheadOf(scene);
    if (ahead !== null) return ahead;
    // Only a beat with one way on is a step on the way; a real decision is where the look stops.
    if (scene.type !== "story" || scene.choices.length !== 1) return null;
    at = scene.choices[0]?.goto;
  }
  return null;
}
