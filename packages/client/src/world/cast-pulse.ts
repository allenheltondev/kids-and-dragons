/**
 * The cast pulse: whoever is speaking a recorded line swells gently on the stage while their
 * clip is heard (docs/voice-narration-plan.md §6, "Speaker → face").
 *
 * The voice manifest says who says each clip, by their figure and names on the cast sheet
 * (`ManifestClip.figure`, `.names`: the sheet's name and aliases), the clip speaker reports it as
 * the clip is heard (speech/read-aloud.ts `watchSpeakingCast`), and the stage pulses every cast
 * member standing in the scene as them: one figure, a whole group of it (`count`), or an
 * ensemble's members. Somebody who is not on the stage in this scene, the narrator and the device
 * voice pulse nobody.
 *
 * Who is "them": a figure the chapter names is them only under one of their names, whatever it
 * is painted with. Several people share a painting (Tansy and the faun prospector are both
 * `entities/faun`), and a chapter may paint someone differently from the sheet (bramblewood-01
 * stands Pib as `entities/pib`; the sheet says `cast/pib`), so a name settles it either way. Only
 * an unnamed figure, or a speaker the sheet gives no name, is matched by painting.
 *
 * Pure and Pixi-free, so the rule and the motion are numbers a test can hold.
 */

import type { SpeakingCast } from "@kad/shared";
import { castKeyParts } from "./cast";

/** How fast the pulse comes on when they start speaking and goes when they stop, per second. */
export const PULSE_RATE = 6;
/** How much bigger a speaker stands while talking, at the low point of each beat. */
export const PULSE_BASE = 0.02;
/** How much more at the top of each beat. */
export const PULSE_BEAT = 0.025;
/** Beats a second: about the rhythm of a sentence's stresses, slow enough not to jitter. */
export const PULSE_HZ = 2.2;
/** With reduced motion: a steady lift, no beat. */
export const PULSE_STILL = 0.03;
/**
 * How high a speaker hops at the top of each beat, as a share of the stage's height: the same
 * on every figure, because a swell by a share of the figure is nothing on a tiny one (a
 * teapot-sized sprite, 33 px tall on a 720p TV, swells under 2 px). None with reduced motion.
 */
export const PULSE_HOP = 0.011;

/**
 * Whether the stage member under `key` (world/cast.ts: `<figure>|<name>`, with `#<n>` for a
 * group's others and `@<url>` for a special pose, read by `castKeyParts`) is the one speaking.
 * Named on both sides: one of the speaker's names. Otherwise: the same painting.
 */
export function speaksFor(key: string, who: SpeakingCast | null): boolean {
  if (who === null) return false;
  const parts = castKeyParts(key);
  const figure = parts.figure;
  const name = sameName(parts.name);
  const theirs = (who.names ?? []).map(sameName).filter((n) => n !== "");
  if (name !== "" && theirs.length > 0) return theirs.includes(name);
  return who.figure !== undefined && who.figure !== "" && figure === who.figure;
}

/**
 * A name as two writers would both mean it: case, punctuation and a plural set aside, so the
 * stage's "Dock workers" is the sheet's "Dock worker" and "Gullets Cousins" its "Gullet's Cousins".
 */
function sameName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "")
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))
    .join(" ");
}

/**
 * The scale a cast member is drawn at for `voice` (0 silent, 1 speaking, eased between) at
 * `elapsed` seconds. `phase` keeps two speakers' beats apart; reduced motion holds still.
 */
export function pulseScale(voice: number, elapsed: number, phase: number, still: boolean): number {
  if (voice <= 0) return 1;
  if (still) return 1 + voice * PULSE_STILL;
  return 1 + voice * (PULSE_BASE + PULSE_BEAT * beatAt(elapsed, phase));
}

/**
 * How far above their feet a cast member is lifted, as a share of the stage's height, in time
 * with the swell: a hop that lands between beats. Zero when silent and with reduced motion.
 */
export function pulseHop(voice: number, elapsed: number, phase: number, still: boolean): number {
  if (voice <= 0 || still) return 0;
  return voice * PULSE_HOP * beatAt(elapsed, phase);
}

/** 0 → 1 → 0 once a beat: a bounce, landing between beats. */
function beatAt(elapsed: number, phase: number): number {
  return Math.abs(Math.sin(elapsed * PULSE_HZ * Math.PI + phase));
}
