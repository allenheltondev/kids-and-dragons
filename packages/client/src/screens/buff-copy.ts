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

import type { BuffKind, CheckBuffOffer, JourneyBuffView } from "@kad/shared";

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

/**
 * "+1 Guard", "−2 Steps" — a real minus sign, so a screen reader says "minus".
 * A story-check buff (#222) changes a check, not "To hit": "+2 on a check".
 */
export function buffAmountText(kind: BuffKind, amount: number, appliesTo?: "check"): string {
  const sign = amount < 0 ? "−" : "+";
  if (appliesTo === "check") return `${sign}${Math.abs(amount)} on a check`;
  return `${sign}${Math.abs(amount)} ${KIND_WORD[kind] ?? kind}`;
}

/** A burden is the cost side of a rift's tradeoff. */
export function isBurden(amount: number): boolean {
  return amount < 0;
}

/** How long a held buff has left, between fights — or, for a story-check buff (#222), between checks. */
export function buffRemainingText(remaining: JourneyBuffView["remaining"]): string {
  if (remaining.uses !== undefined) return remaining.uses === 1 ? "one check" : `${remaining.uses} checks`;
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

/** Who a buff is on, between fights. A story-check buff (#222) is whoever rolls next. */
export function buffTargetText(target: JourneyBuffView["target"], appliesTo?: "check"): string {
  if (appliesTo === "check") return "whoever rolls";
  return target === "one" ? "one hero" : "everyone";
}

/**
 * The line a roll prompt shows for the party's story-check buff (#222): the
 * question when the roller chooses ("Use Riftspark (+2)?"), the plain fact
 * when it is spent anyway ("Riftspark: +2 on this roll").
 */
export function checkBuffLine(offer: CheckBuffOffer): string {
  const amount = `${offer.amount < 0 ? "−" : "+"}${Math.abs(offer.amount)}`;
  return offer.spend === "choose" ? `Use ${offer.label} (${amount})?` : `${offer.label}: ${amount} on this roll`;
}
