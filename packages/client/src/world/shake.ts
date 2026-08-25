/**
 * Screen shake — roadmap chapter 8, the "impacts" half of scene polish.
 *
 * A jolt is the one bit of camera language every player already reads: the
 * board flinching says "that landed" faster than a damage number does. Two
 * rules keep it a seasoning rather than an effect reel:
 *
 * - **Small and short.** The amplitude tops out around one percent of the
 *   pane's height and is gone in under half a second. An eight-year-old's
 *   game must never look like it is being hit hard (spec §1's tone), and a
 *   phone pane in a moving car cannot afford real displacement.
 * - **Deterministic.** The wobble is two incommensurate sines, not random
 *   jitter — the same beat shakes the same way every time, and a test can
 *   assert the whole curve.
 *
 * Pure state-in state-out, like camera.ts and for the same reason: the maths
 * is testable with no WebGL context, and the scene only integrates it.
 */

import type { EncounterEvent, Presentation } from "@kad/shared";
import { beatOffsetsMs } from "./board-math";

/** Seconds from jolt to stillness. */
export const SHAKE_DURATION_S = 0.4;

/** Peak displacement at strength 1, as a fraction of the pane's height. */
export const SHAKE_MAX_FRACTION = 0.012;

/**
 * How hard each presentation hits, 0..1. A `Record` over every kind — the
 * same exhaustiveness contract as the cue and hold tables, so a new beat
 * must decide its shake to compile. Zero is a decision: most beats are not
 * impacts, and a screen that flinches at a heal has stopped meaning anything.
 */
export const PRESENTATION_SHAKES: Record<Presentation["kind"], number> = {
  SCENE_ENTER: 0,
  ROLL: 0,
  CHOICE_MADE: 0,
  // The board arriving is an event, but a gentle one — the fight has not
  // landed a blow yet. Any opening monster turns ride in its events, and
  // their impacts are scheduled to their own beats via `impactBeats`.
  ENCOUNTER_BEGAN: 0.4,
  // Never read at the sequence's head: a round's impacts are scheduled to
  // the beats they belong to — see `impactBeats`. The entry only satisfies
  // the Record, the same convention as its row in PRESENTATION_MS.
  COMBAT_SEQUENCE: 0,
  ATTACK: 0.7,
  HEAL: 0,
  // The hardest hit in the vocabulary, because §7.3 makes going down the
  // biggest beat a fight has.
  DOWN: 1,
  REVIVE: 0,
  LEVEL_UP: 0,
  TRANSFORM: 0,
  CHAPTER_COMPLETE: 0,
};

export function shakeStrengthFor(presentation: Presentation): number {
  return PRESENTATION_SHAKES[presentation.kind] ?? 0;
}

/** How hard one combat event hits, 0 for everything that is not an impact. */
export function impactStrengthOf(event: EncounterEvent): number {
  if (event.type === "down") return 1;
  if (event.type === "damage") return 0.7;
  if (event.type === "shoved") return 0.45;
  return 0;
}

/**
 * When a combat sequence's impacts land, and how hard — each on the *beat it
 * belongs to*, not at the sequence's head.
 *
 * Two facts force this shape. The engine wraps everything a fight does —
 * walks, heals, misses, whole enemy rounds — in COMBAT_SEQUENCE
 * presentations, so a flat per-kind strength shook the screen for somebody
 * strolling two tiles and never gave a real knockdown its full hit. And the
 * board paces those events across the hold (`beatOffsetsMs`, the same table
 * the damage numbers ride), so a single aggregate jolt at the head had the
 * screen flinching during the walk-up and already still when the blow
 * actually played. The scene schedules these alongside the beats it hands
 * the board, off the same offsets, so the flinch and the number land on the
 * same frame.
 */
export function impactBeats(
  events: readonly EncounterEvent[],
  totalMs: number,
): { atMs: number; strength: number }[] {
  const offsets = beatOffsetsMs(events.length, totalMs);
  const beats: { atMs: number; strength: number }[] = [];
  events.forEach((event, index) => {
    const strength = impactStrengthOf(event);
    if (strength > 0) beats.push({ atMs: offsets[index] ?? 0, strength });
  });
  return beats;
}

export interface Shake {
  /** 0..1, scales the peak displacement. */
  strength: number;
  /** Seconds since the jolt. */
  age: number;
}

/**
 * A new jolt, on top of whatever is still ringing. The stronger one wins
 * outright rather than summing — two hits in one beat should read as one
 * good flinch, not a doubled earthquake.
 */
export function startShake(current: Shake | null, strength: number): Shake | null {
  const clamped = Math.min(1, Math.max(0, strength));
  if (clamped === 0) return current;
  if (current && current.strength * remaining(current) >= clamped) return current;
  return { strength: clamped, age: 0 };
}

export function advanceShake(current: Shake | null, dt: number): Shake | null {
  if (!current) return null;
  const age = current.age + dt;
  return age >= SHAKE_DURATION_S ? null : { ...current, age };
}

/** The (1 - t/T)² envelope: a sharp arrival that rings down smoothly. */
function remaining(shake: Shake): number {
  const t = Math.min(1, shake.age / SHAKE_DURATION_S);
  return (1 - t) * (1 - t);
}

/**
 * Where the stage sits right now, in pixels. Two sine voices at incommensurate
 * frequencies so the path never visibly repeats inside one shake, with phase
 * offsets so the very first frame already has displacement — a jolt that
 * starts at rest is a wobble, not a hit.
 */
export function shakeOffset(
  current: Shake | null,
  viewportHeight: number,
): { x: number; y: number } {
  if (!current) return { x: 0, y: 0 };
  const amplitude = current.strength * remaining(current) * SHAKE_MAX_FRACTION * viewportHeight;
  return {
    x: amplitude * Math.sin(current.age * 87 + 1.1),
    y: amplitude * Math.cos(current.age * 73 + 0.7),
  };
}
