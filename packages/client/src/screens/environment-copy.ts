/**
 * What the combat panel says about the place fighting back (#201), for an
 * 8-year-old.
 *
 * Pure strings and glyph names, kept apart from the component so the words
 * can be tested without a DOM (buff-copy.ts's rule). Every line says the rule
 * in words — "end your turn on it to escape", "stopping here costs 2 hearts"
 * — and every board mark has a glyph of its own shape, so nothing is told
 * apart by colour alone (spec §11). All of it reads `environmentView`, the one
 * shared reading of `EncounterState.environment`; a fight without one shows
 * none of it.
 */

import type {
  EnvironmentClockView,
  EnvironmentExitView,
  EnvironmentHazardView,
  EnvironmentRescueView,
} from "@kad/shared";

const s = (n: number) => (n === 1 ? "" : "s");

/** The glyphs (icons.tsx names): a flame, a thorn, a spark — shapes, not colours. */
const HAZARD_ICON: Record<EnvironmentHazardView["kind"], string> = {
  fire: "flame",
  thorns: "thorn",
  rift: "spark",
};

export function hazardIcon(kind: EnvironmentHazardView["kind"]): string {
  return HAZARD_ICON[kind] ?? "spark";
}

export const CLOCK_ICON = "waiting";
export const EXIT_ICON = "forward";
export const CAPTIVE_ICON = "heart";

/** "The rift closes in 3 rounds." — the visible timer. */
export function clockLine(clock: EnvironmentClockView): string {
  if (clock.expired) {
    if (clock.onExpire === "collapse") return `${clock.label} — now!`;
    const surge = clock.surge ?? 1;
    return `${clock.label} — now! Every round you stay, everyone loses ${surge} heart${s(surge)}.`;
  }
  if (clock.roundsLeft <= 1) return `${clock.label} at the end of this round!`;
  return `${clock.label} in ${clock.roundsLeft} rounds.`;
}

/** What one hazard costs, and whether it is burning yet. */
export function hazardLine(hazard: EnvironmentHazardView): string {
  const cost = `stopping on it costs ${hazard.damage} heart${s(hazard.damage)}.`;
  return hazard.active ? `${hazard.label}: ${cost}` : `${hazard.label} (not yet): soon ${cost}`;
}

/** Where the way out is, and for how long. */
export function exitLine(exit: EnvironmentExitView): string {
  if (exit.gone) return `${exit.label} has closed.`;
  if (!exit.open) {
    const n = exit.opensIn ?? 1;
    return `${exit.label} opens ${n === 1 ? "next round" : `in ${n} rounds`}.`;
  }
  const base = `${exit.label} is open: end your turn on it to escape.`;
  if (exit.closesIn === undefined) return base;
  return `${base} ${exit.closesIn <= 1 ? "It closes after this round!" : `It closes in ${exit.closesIn} rounds.`}`;
}

/** Who needs saving, and how. */
export function rescueLine(rescue: EnvironmentRescueView): string {
  switch (rescue.status) {
    case "freed":
      return `${rescue.name} is free!`;
    case "lost":
      return `${rescue.name} is lost to the rift.`;
    default: {
      const how = `Free ${rescue.name}: end your turn next to them.`;
      if (rescue.roundsLeft === undefined) return how;
      return rescue.roundsLeft <= 1 ? `${how} This round is the last chance!` : `${how} ${rescue.roundsLeft} rounds left.`;
    }
  }
}

/** A board square's mark, as words: what the cell's button and the legend say. */
export function tileWords(feature: { kind: "hazard" | "exit" | "captive"; label: string; active: boolean }): string {
  switch (feature.kind) {
    case "hazard":
      return feature.active ? `${feature.label}, don't stop here` : `${feature.label} (not yet)`;
    case "exit":
      return feature.active ? `${feature.label}, open: stop here to escape` : `${feature.label}, closed`;
    default:
      return feature.label;
  }
}
