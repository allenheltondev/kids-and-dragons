/**
 * What the screens say about a temporary buff (#200), for an 8-year-old.
 *
 * Pure strings, kept apart from the components so the words can be tested
 * without a DOM and shared by the two places a buff shows: the journey panel
 * between chapters (`JourneyView.buffs`) and the combat panel during a fight
 * (`EncounterState.buffs`). Every line says what the buff does in words and
 * a sign — "+1 Guard", "−1 Guard" — so a boon and a burden are told apart
 * without colour (spec §11), and how long it has left.
 */

import type { BuffKind, JourneyBuffView } from "@kad/shared";

/** The stat word each kind changes, as the character sheet and combat say it. */
const KIND_WORD: Record<BuffKind, string> = {
  guard: "Guard",
  damage: "Hit power",
  move: "Steps",
  roll: "To hit",
};

/** The glyph each kind is drawn with (icons.tsx names). */
const KIND_ICON: Record<BuffKind, string> = {
  guard: "guard",
  damage: "might",
  move: "steps",
  roll: "d20",
};

export function buffIcon(kind: BuffKind): string {
  return KIND_ICON[kind] ?? "star";
}

/** "+1 Guard", "−2 Steps" — a real minus sign, so a screen reader says "minus". */
export function buffAmountText(kind: BuffKind, amount: number): string {
  const sign = amount < 0 ? "−" : "+";
  return `${sign}${Math.abs(amount)} ${KIND_WORD[kind] ?? kind}`;
}

/** A burden is the cost side of a rift's tradeoff. */
export function isBurden(amount: number): boolean {
  return amount < 0;
}

/** How long a held buff has left, between fights. */
export function buffRemainingText(remaining: JourneyBuffView["remaining"]): string {
  if (remaining.turns !== undefined) {
    return remaining.turns === 1 ? "your first turn of the next fight" : `your first ${remaining.turns} turns of the next fight`;
  }
  return remaining.encounters === 1 ? "the next fight" : `the next ${remaining.encounters} fights`;
}

/** How long a buff has left inside the fight it is in. */
export function buffTurnsText(turnsLeft: number | undefined): string {
  if (turnsLeft === undefined) return "this fight";
  return turnsLeft === 1 ? "1 more turn" : `${turnsLeft} more turns`;
}

/** Who a buff is on, between fights. */
export function buffTargetText(target: JourneyBuffView["target"]): string {
  return target === "one" ? "one hero" : "everyone";
}
