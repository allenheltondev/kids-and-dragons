import type { StatId, Stats } from "@kad/shared";
import type { CreationStep } from "./creationDraft";

export const STAT_MEANING: Record<StatId, string> = {
  might: "Lift, push and stand strong.",
  quick: "Dodge, sneak and move fast.",
  clever: "Notice clues and solve puzzles.",
  heart: "Help friends and be brave.",
};

/** A suggestion, never a committed choice: the selected class names its main stat. */
export function suggestedCreationStats(points: number, primary: StatId): Stats {
  return { might: 0, quick: 0, clever: 0, heart: 0, [primary]: Math.max(0, Math.floor(points)) };
}

export function creationNextHint(step: CreationStep, done: boolean, remaining: number): string {
  if (done) return "";
  switch (step) {
    case "species": return "Pick your creature to keep going.";
    case "class": return "Pick what you love doing to keep going.";
    case "stats": return `Spend your last ${remaining} point${remaining === 1 ? "" : "s"}, or tap Help me choose.`;
    case "name": return "Pick a name or type your own.";
  }
}
