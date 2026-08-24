/**
 * What each presentation sounds like.
 *
 * One table, deliberately exhaustive: a `Record` over every presentation kind,
 * so adding a kind to the protocol without deciding its sound is a compile
 * error here rather than a beat that plays silently forever. `null` is a
 * decision too — it means "this moment is visual", not "nobody thought about
 * it".
 *
 * This lives apart from the seam because it is *policy*: WorldView's
 * presentation gate asks this table, and the table can change without touching
 * either the gate or the engine.
 */

import type { Presentation } from "@kad/shared";
import type { CueId } from "./cue";

export const PRESENTATION_CUES: Record<Presentation["kind"], CueId | null> = {
  SCENE_ENTER: "scene-enter",
  ROLL: "dice",
  CHOICE_MADE: "choice",
  ENCOUNTER_BEGAN: "encounter-begin",
  /*
   * The enemy round arrives as one presentation carrying every move and hit
   * (protocol.ts). One cue at its head marks "the enemies are acting" — a cue
   * per inner event would be a drum roll of identical thuds, and the board
   * already paces the damage numbers visually across the hold.
   */
  COMBAT_SEQUENCE: "attack",
  ATTACK: "attack",
  HEAL: "heal",
  DOWN: "down",
  REVIVE: "revive",
  LEVEL_UP: "level-up",
  TRANSFORM: "transform",
  CHAPTER_COMPLETE: "victory",
};

export function cueForPresentation(presentation: Presentation): CueId | null {
  return PRESENTATION_CUES[presentation.kind] ?? null;
}
