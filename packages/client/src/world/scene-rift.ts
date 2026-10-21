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

/*
 * Making the tear easy to see (#401). The painted tear is a thin matte
 * charcoal outline, made to sit lightly on a backdrop, and on mud or rock it
 * all but disappears from a sofa. Two colourless layers behind it fix that
 * without repainting the art or giving a rule away:
 *
 *   - the **hole**: the inside of the tear, filled near-black, so it reads as
 *     a gap in the air on any backdrop, bright ice included;
 *   - the **glow**: a soft pale-grey mist around it that breathes slowly, so
 *     the eye finds it on a dark backdrop, and so it looks alive.
 *
 * Neither is a palette colour, nor white, silver, gold or red (the Riftlight
 * brief's forbidden list): the mist is a cool mid-pale grey at low strength,
 * read as air, not as light. They are the same on every screen.
 */

/** The tear's middle, in sheet-frame pixels above the foot (the delivered art: y 76 to 183 of 256). */
export const TEAR_MIDDLE_PX = (183 - 76) / 2;
/** Half the tear's painted width and height, in sheet-frame pixels (x 103 to 152, y 76 to 183). */
export const TEAR_HALF_WIDTH_PX = (152 - 103) / 2;
export const TEAR_HALF_HEIGHT_PX = (183 - 76) / 2;

/** The hole's near-black and the glow's mist (see above). */
export const RIFT_HOLE_COLOR = 0x15121f;
export const RIFT_GLOW_COLOR = 0xc9cad6;

/** How long one slow breath of the glow takes. Slower than the sheet's loop, like breathing beside it. */
export const RIFT_GLOW_PERIOD_S = 2.4;

export interface RiftPresence {
  /** The hole and glow's size, 0 to 1 of a full tear. */
  readonly size: number;
  /** The glow's strength, 0 to 1. */
  readonly glow: number;
  /** The hole's strength, 0 to 1. */
  readonly hole: number;
}

/**
 * How strongly the hole and glow show at this moment. A shimmering rift is
 * full size, its glow breathing between 0.55 and 0.85; an opening one grows
 * with its sheet, a collapsing one shrinks with it. Reduced motion holds the
 * breath in the middle.
 *
 * @param pass what is playing, or null for nothing
 * @param frame the sheet frame a one-shot is on (0 to frames - 1); ignored for a loop
 * @param seconds the stage clock, for the breath
 */
export function riftPresence(
  pass: RiftPass | null,
  frame: number,
  seconds: number,
  reducedMotion: boolean,
  frames = 12,
): RiftPresence {
  if (pass === null) return { size: 0, glow: 0, hole: 0 };
  const breath = reducedMotion ? 0.7 : 0.7 + 0.15 * Math.sin((2 * Math.PI * seconds) / RIFT_GLOW_PERIOD_S);
  if (pass.loop) return { size: 1, glow: breath, hole: 0.68 };
  const done = Math.min(1, Math.max(0, (frame + 1) / frames));
  const size = pass.effect === RIFT_OPEN_EFFECT ? done : 1 - done;
  return { size, glow: breath * size, hole: 0.68 * size };
}
