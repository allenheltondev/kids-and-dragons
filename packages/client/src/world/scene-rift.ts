/**
 * A rift in plain view in a story scene (#401, `SceneRift`): which sheets the
 * stage plays, where the tear stands, and how tall. Pure, so the rules are
 * numbers a test holds; scene.ts only turns them into a sprite.
 *
 * Every screen draws the same thing. A scene's rift has no rules of its own
 * (those belong to the journey graph's rift edges, screens/riftlight.ts), so
 * there is no Riftlight to read in it, and the TV and every phone get
 * `rift_neutral`. Only the lobby's list of ways on ever shows colours.
 */

import type { Chapter, RunState, SceneRift } from "@kad/shared";
import { RIFT_COLLAPSE_EFFECT, RIFT_NEUTRAL_EFFECT, RIFT_OPEN_EFFECT } from "../screens/riftlight";

/** The scene's rift, or null: none tagged, not this chapter's scene, or a fight (the board draws its own ground). */
export function sceneRiftFor(chapter: Chapter | null, state: RunState | null): SceneRift | null {
  if (!chapter || chapter.id !== state?.chapterId || !state.sceneId || state.encounter) return null;
  const scene = chapter.scenes[state.sceneId];
  return scene && scene.type !== "encounter" ? scene.rift ?? null : null;
}

/** One sheet, played through once or looped. */
export interface RiftPass {
  readonly effect: string;
  readonly loop: boolean;
}

/**
 * What the stage plays for a scene's rift, in order. A loop is the last pass
 * and plays until the scene changes; a sequence ending in a one-shot leaves
 * nothing behind.
 *
 * Under reduced motion nothing unfolds or folds: an opening rift is simply
 * there, a collapsing one simply gone, and the shimmer holds one frame
 * (`stillFrame`).
 */
export function riftPasses(rift: SceneRift | null, reducedMotion: boolean): RiftPass[] {
  const shimmer: RiftPass = { effect: RIFT_NEUTRAL_EFFECT, loop: true };
  if (rift === null) return [];
  if (rift === "steady") return [shimmer];
  if (rift === "open") return reducedMotion ? [shimmer] : [{ effect: RIFT_OPEN_EFFECT, loop: false }, shimmer];
  return reducedMotion ? [] : [{ effect: RIFT_COLLAPSE_EFFECT, loop: false }];
}

/** The frame a still loop holds: mid-pattern, as the lobby's reduced-motion glyph does. */
export const STILL_FRAME = 6;

/**
 * How tall the tear stands, in centimeters on the stage's own measure
 * (cast.ts `STORY_MEASURE`, 2.5 design units a centimeter): an adult
 * faun's height, so it reads as a doorway beside the party rather than a prop
 * at their feet, and still fits the gap between the party and a guest.
 */
export const RIFT_TEAR_CM = 160;

/**
 * Where the tear is painted inside each square sheet frame
 * (assets/effects/rift_*.sheet.png, measured from the delivered art): its
 * height is 42% of the frame, its foot 71.5% of the way down, and it is
 * centred across. The sprite is anchored at the foot and sized by the tear,
 * so it stands on the floor line like the figures do.
 */
export const RIFT_TEAR_SHARE = 0.42;
export const RIFT_FOOT = 0.715;

export interface RiftStand {
  /** Design-unit x of the tear's centre. */
  readonly x: number;
  /** The sheet frame's drawn size, in design units (square). */
  readonly frame: number;
}

/**
 * Where the tear stands. With company it fills the gap between the party and
 * the cast, the middle of the meeting. With the party alone it stands just
 * past the last hero, on the side the cast would come from, kept inside the
 * visible stage; with nobody on stage, in the middle.
 *
 * @param slots the lineup's slots (cast.ts `stageSlots`), already in design units
 * @param left the visible stage's left edge, in design units
 * @param width the visible stage's width, in design units
 * @param k the stage's scale (cast.ts `stageLayout`), so the tear shrinks with the figures
 */
export function riftStand(
  slots: { party: readonly number[]; partySlot: number; castLeft: readonly number[] },
  left: number,
  width: number,
  k: number,
): RiftStand {
  const tear = RIFT_TEAR_CM * 2.5 * k;
  const frame = tear / RIFT_TEAR_SHARE;
  const partyEdge = slots.party.length > 0 ? Math.max(...slots.party) + slots.partySlot / 2 : null;
  if (slots.castLeft.length > 0) {
    const castEdge = Math.min(...slots.castLeft);
    return { x: ((partyEdge ?? left) + castEdge) / 2, frame };
  }
  if (partyEdge === null) return { x: left + width / 2, frame };
  // The tear itself is about a third of its frame wide.
  const half = frame * 0.18;
  return { x: Math.min(partyEdge + half, left + width - half), frame };
}
