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

/**
 * What a quiet room (#260, quiet.ts) does with each cue: `keep` it, or `drop`
 * it. A `Record` over every cue for the same reason as the table above: a new
 * cue has to decide, or it does not compile.
 *
 * `drop` is for the sudden ones: the impacts, stingers and fanfares that start
 * at full strength with no lead-in. Everything kept is soft or slow to arrive,
 * and the engine scales it down on top (audio/engine.ts). The test beside this
 * table walks a whole encounter through it.
 */
export const CUE_QUIET: Record<CueId, "keep" | "drop"> = {
  "rift-open": "keep",
  "rift-collapse": "keep",
  "chime-sour": "keep",
  "chime-echo": "keep",
  "attune-hum": "keep",
  riftspark: "keep",
  anchor: "keep",
  "party-ready": "keep",
  "gem-pickup": "keep",
  "gate-hum": "keep",
  "citadel-bell": "drop",
  "seal-awakening": "keep",
  "cavern-air": "keep",
  dice: "keep",
  bonk: "drop",
  attack: "drop",
  heal: "keep",
  down: "drop",
  revive: "keep",
  "level-up": "drop",
  transform: "drop",
  "scene-enter": "keep",
  choice: "keep",
  "encounter-begin": "drop",
  victory: "drop",
  tap: "keep",
  "page-turn": "keep",
  "pad-1": "keep",
  "pad-2": "keep",
  "pad-3": "keep",
  "pad-4": "keep",
  catch: "keep",
  whoosh: "keep",
  tick: "keep",
  error: "drop",
};
