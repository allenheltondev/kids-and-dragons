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

import { NUMBED_BUFF_ID } from "@kad/shared";
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

/** Is this combat buff the numbing sting's (#227) rather than a rift power? */
export function isNumbed(id: string): boolean {
  return id === NUMBED_BUFF_ID;
}

/**
 * The combat log's line for a numbing sting. It says the sting, the cost and
 * that it wears off — a numbing sting that fades, never lasting harm.
 */
export function numbedLine(who: string, steps: number, turns: number): string {
  const verb = who === "You" ? "are" : "is";
  return `${who} ${verb} numbed by a sting: ${steps} fewer ${steps === 1 ? "step" : "steps"} for ${turns} ${turns === 1 ? "turn" : "turns"}. It wears off.`;
}

/**
 * The combat log's line for an enemy puffing up (#227). It says what to
 * expect, so nobody is stung without being told it was coming.
 */
export function puffedLine(enemy: string): string {
  return `${enemy} puffs up! Hitting it now means a numbing sting.`;
}

/** The words on a puffed enemy's marker, wherever it is drawn. */
export const PUFFED_WORDS = "Puffed";
export const PUFFED_HINT = "Hitting it numbs you for a while";

/** How long a Numbed has left, in words that promise it ends. */
export function numbedTurnsText(turnsLeft: number | undefined): string {
  if (turnsLeft === undefined) return "wears off when the fight ends";
  return turnsLeft === 1 ? "wears off after 1 more turn" : `wears off after ${turnsLeft} more turns`;
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
