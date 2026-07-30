/**
 * How long each presentation holds the stage before its patch is applied.
 *
 * This is the "play the animation, *then* apply the patch" half of
 * architecture §4.2 — the die has to land before the HP number moves. Values
 * are placeholders sized to the spec's ~1.5s roll (spec §2.2); real durations
 * come from the Rive state machines in Chapter 4.
 *
 * Lives here rather than in WorldView because two things must agree on it:
 * the presentation gate WorldView registers (which holds the patch), and the
 * board renderer (which spaces damage numbers across exactly that hold — a
 * number that pops after its patch has landed is a number nobody can match to
 * the hit). One table, two readers, no drift.
 */

import type { Presentation } from "@kad/shared";

export const PRESENTATION_MS: Record<Presentation["kind"], number> = {
  SCENE_ENTER: 350,
  ROLL: 1500,
  CHOICE_MADE: 200,
  // Everyone taking their places on a board that was not there a moment ago.
  // Longer than any other beat except a transformation: the camera has to frame
  // the fight and three phones have to swap to a combat UI, and arriving mid-
  // shuffle is how a player misses whose turn it is (spec §7.2).
  ENCOUNTER_BEGAN: 1200,
  // Never read: COMBAT_SEQUENCE's hold scales with its events — see
  // presentationDuration(). The entry only satisfies the Record.
  COMBAT_SEQUENCE: 700,
  ATTACK: 700,
  HEAL: 600,
  DOWN: 700,
  REVIVE: 700,
  LEVEL_UP: 1200,
  TRANSFORM: 2000,
  CHAPTER_COMPLETE: 800,
};

/*
 * COMBAT_SEQUENCE carries the whole enemy round — every move, roll and hit in
 * one presentation (protocol.ts). A flat hold meant one goblin and four got
 * the same 700ms: four beats of damage flashed past unreadably. So the hold
 * grows with the beats, capped so a crowded round cannot stall the table.
 */
export const COMBAT_BEAT_BASE_MS = 300;
export const COMBAT_BEAT_PER_EVENT_MS = 400;
export const COMBAT_BEAT_MAX_MS = 4000;

export function presentationDuration(presentation: Presentation): number {
  if (presentation.kind === "COMBAT_SEQUENCE") {
    return Math.min(
      COMBAT_BEAT_MAX_MS,
      COMBAT_BEAT_BASE_MS + presentation.events.length * COMBAT_BEAT_PER_EVENT_MS,
    );
  }
  return PRESENTATION_MS[presentation.kind] ?? 0;
}
