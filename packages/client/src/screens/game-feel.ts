/**
 * How a story interaction (#493) feels in the hand and sounds in the room.
 *
 * Phones in Party Mode have no speaker of their own (App.tsx enables audio on the shared screen
 * and in Travel Mode), so the TV voices what happens to the whole table and a phone answers its
 * own tap with a short vibration. Both are flavour: a device without either plays the same game.
 */
import type { InteractionPrompt } from "@kad/shared";
import { reducedMotion } from "../a11y/prefs";
import { cue, type CueId } from "../audio/cue";
import type { InteractionKind } from "./interaction-copy";

/** One note per pad colour, a pentatonic so any authored pattern plays as a tune. */
export const PAD_CUES: readonly CueId[] = ["pad-1", "pad-2", "pad-3", "pad-4"];

export function padNote(tone: number): void {
  cue(PAD_CUES[((tone % 4) + 4) % 4] ?? null);
}

/** A short buzz on a phone that has one, never under reduced motion. */
export function buzz(pattern: number | number[]): void {
  if (reducedMotion()) return;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  } catch {
    // Flavour, never load-bearing.
  }
}

/** The word stamped over the board when a game ends, by kind; a miss is never scolded. */
const STAMP_WIN: Record<InteractionKind, string> = {
  precision: "Bullseye!",
  timing: "Just right!",
  memory: "Perfect!",
  sequence: "That's the way!",
  tracking: "Found it!",
  balance: "Steady!",
  relay: "Delivered!",
  cooperate: "Heave-ho!",
  play: "Hooray!",
};

export function stampFor(prompt: InteractionPrompt): string {
  if (prompt.outcome === "assisted") return "Phew!";
  if (prompt.outcome === "failure") return "Whoops!";
  return STAMP_WIN[prompt.spec.kind];
}

/** Kinds whose first moment is a GO, rather than a pattern everyone has to be watching. */
export function saysGo(kind: InteractionKind): boolean {
  return kind !== "memory" && kind !== "tracking";
}

/** Which pad is lit during a pattern's playback, or null between steps and after it. */
export function litStep(elapsedMs: number, stepMs: number, length: number): number | null {
  if (elapsedMs < 0 || stepMs <= 0) return null;
  const index = Math.floor(elapsedMs / stepMs);
  if (index >= length) return null;
  // Dark for the last part of each step, so a repeat (snow, air, snow) flashes twice.
  return elapsedMs - index * stepMs < stepMs * 0.72 ? index : null;
}
