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
 * all but disappears from a sofa. Colourless layers around it fix that, and
 * give it the presence of the rest of the art, without repainting it:
 *
 *   - the **hole**: the inside of the tear, filled near-black with a lighter
 *     rim, so it reads as a deep gap in the air on any backdrop, bright ice
 *     included;
 *   - the **glow**: a soft pale-grey mist around it, so the eye finds it on a
 *     dark backdrop;
 *   - two **rings** turning around it the opposite ways: broken dashes close
 *     in (`RIFT_DASHES`) and small motes farther out (`RIFT_MOTES`).
 *
 * WHAT THEY MAY NOT DO. Every Riftlight rule has its pattern (brief Part A1):
 * green breathes, amber flickers once, blue ripples outward, violet spirals
 * inward. This shimmer is on every rift, on every screen, so it must look
 * like none of them, or the TV would teach a rule it is not showing. So the
 * rings only turn: each keeps its distance (no ripple, no spiral) and its
 * brightness (no flicker), and nothing grows and shrinks in a beat (no
 * breath). Only an opening or collapsing rift changes size, with its sheet.
 *
 * None is a palette colour, nor white, silver, gold or red (the brief's
 * forbidden list): the mist and the ring cores are a cool mid-pale grey,
 * outlined in the same near-black as the hole so they read on bright ground
 * too. They are the same on every screen.
 */

/** The tear's middle, in sheet-frame pixels above the foot (the delivered art: y 76 to 183 of 256). */
export const TEAR_MIDDLE_PX = (183 - 76) / 2;
/** Half the tear's painted width and height, in sheet-frame pixels (x 103 to 152, y 76 to 183). */
export const TEAR_HALF_WIDTH_PX = (152 - 103) / 2;
export const TEAR_HALF_HEIGHT_PX = (183 - 76) / 2;

/** The hole's near-black and the glow's mist (see above). */
export const RIFT_HOLE_COLOR = 0x15121f;
export const RIFT_GLOW_COLOR = 0xc9cad6;
/** The rings' outline: the warm dark brown every figure in the game is outlined in (asset-brief §2). */
export const RIFT_INK_COLOR = 0x2e2320;

/** The mist's steady strength: steady, never breathing (see above). */
export const RIFT_GLOW_STRENGTH = 0.7;

/** One ring turning around the tear's middle, in sheet-frame pixels (see above). */
export interface RiftRing {
  /** The ellipse's half width and half height. */
  readonly rx: number;
  readonly ry: number;
  /** How many marks stand on it, evenly spaced. */
  readonly count: number;
  /** The share of each mark's slot it fills: a dash's length, or 0 for a mote. */
  readonly fill: number;
  /** Radians a second, positive clockwise on screen. */
  readonly speed: number;
}

/** Broken dashes close around the tear, turning slowly clockwise. */
export const RIFT_DASHES: RiftRing = {
  rx: TEAR_HALF_WIDTH_PX * 1.6,
  ry: TEAR_HALF_HEIGHT_PX * 1.17,
  count: 13,
  fill: 0.74,
  speed: 0.32,
};

/**
 * A faint unbroken line close around the tear, between it and the dashes. It
 * does not turn: it is what holds the rings together as one shape.
 */
export const RIFT_HALO_LINE = { rx: TEAR_HALF_WIDTH_PX * 1.28, ry: TEAR_HALF_HEIGHT_PX * 1.08 } as const;

/** Small motes farther out, turning the other way, a little slower. */
export const RIFT_MOTES: RiftRing = {
  rx: TEAR_HALF_WIDTH_PX * 2.15,
  ry: TEAR_HALF_HEIGHT_PX * 1.32,
  count: 7,
  fill: 0,
  speed: -0.21,
};

/**
 * Each mark's own small difference from its neighbours, so a ring reads as
 * brushwork rather than a dashed line: how long it is (times the ring's
 * `fill`), how thick (times its stroke), how far it sits off the ellipse, and
 * a nudge along it. Fixed for the life of the ring and carried round with it,
 * so nothing about a mark changes as it turns.
 */
const MARK_LENGTH = [1, 0.62, 0.86, 0.48, 1.12, 0.7, 0.94, 0.55, 1.05, 0.66, 0.8];
const MARK_WIDTH = [1, 0.8, 1.15, 0.72, 0.95, 1.2, 0.85, 1.05, 0.78, 1.1, 0.9];
const MARK_OFFSET = [0, 0.04, -0.03, 0.05, -0.05, 0.02, -0.02, 0.06, -0.04, 0.03, -0.01];
const MARK_NUDGE = [0, 0.12, -0.08, 0.18, -0.15, 0.05, 0.1, -0.12, 0.16, -0.05, 0.08];

export interface RingMark {
  /** Start and end angle (equal for a mote). */
  readonly from: number;
  readonly to: number;
  /** This mark's thickness, times the ring's stroke. */
  readonly width: number;
  /** This mark's distance from the tear, times the ring's ellipse. */
  readonly reach: number;
}

/** Where a ring's marks are at this moment. The whole ring turns; each mark keeps its own shape and distance. */
export function ringMarks(ring: RiftRing, seconds: number, reducedMotion: boolean): RingMark[] {
  const turn = reducedMotion ? 0 : ring.speed * seconds;
  const slot = (2 * Math.PI) / ring.count;
  return Array.from({ length: ring.count }, (_, i) => {
    const k = i % MARK_LENGTH.length;
    const from = turn + (i + MARK_NUDGE[k]!) * slot;
    return { from, to: from + slot * ring.fill * MARK_LENGTH[k]!, width: MARK_WIDTH[k]!, reach: 1 + MARK_OFFSET[k]! };
  });
}

/** A point on a ring's ellipse about the tear's middle (y down, so a positive angle runs clockwise). */
export function ringPoint(ring: RiftRing, angle: number, reach = 1): { x: number; y: number } {
  return { x: ring.rx * reach * Math.cos(angle), y: ring.ry * reach * Math.sin(angle) };
}

/**
 * How much of a ring shows at height `y` (sheet-frame pixels below the tear's
 * middle). The rift stands on the ground, so its rings arch over it like a
 * doorway: full above, fading out over the last stretch before the floor line
 * (`TEAR_MIDDLE_PX` below the middle), gone under it. A mark passing into the
 * ground fades as it goes rather than vanishing in one frame.
 */
export function groundFade(y: number): number {
  const floor = TEAR_MIDDLE_PX * 0.92;
  const band = TEAR_MIDDLE_PX * 0.45;
  if (y >= floor) return 0;
  if (y <= floor - band) return 1;
  return (floor - y) / band;
}

export interface RiftPresence {
  /** The hole and glow's size, 0 to 1 of a full tear. */
  readonly size: number;
  /** The glow's strength, 0 to 1. */
  readonly glow: number;
  /** The hole's strength, 0 to 1. */
  readonly hole: number;
}

/**
 * How large and strong the hole, glow and rings are at this moment. A
 * shimmering rift is full size and steady; an opening one grows with its
 * sheet, a collapsing one shrinks with it.
 *
 * @param pass what is playing, or null for nothing
 * @param frame the sheet frame a one-shot is on (0 to frames - 1); ignored for a loop
 */
export function riftPresence(pass: RiftPass | null, frame: number, frames = 12): RiftPresence {
  if (pass === null) return { size: 0, glow: 0, hole: 0 };
  if (pass.loop) return { size: 1, glow: RIFT_GLOW_STRENGTH, hole: 0.68 };
  const done = Math.min(1, Math.max(0, (frame + 1) / frames));
  const size = pass.effect === RIFT_OPEN_EFFECT ? done : 1 - done;
  return { size, glow: RIFT_GLOW_STRENGTH * size, hole: 0.68 * size };
}
