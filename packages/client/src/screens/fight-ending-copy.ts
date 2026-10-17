/**
 * How a fight in a place that fought back ended (#220), as the chapter
 * complete screen says it: "You got out through the rift. You freed Pip."
 * Pure strings, apart from the component, so the words are tested without a
 * DOM (buff-copy.ts's rule). Read from `RunState.fightEndings`, which only an
 * environmental fight writes.
 */

import type { FightEnding } from "@kad/shared";

/** "a", "a and b", "a, b and c". */
function names(list: readonly string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** The glyph for the ending (icons.tsx names): the shape says it before the words do. */
export function fightEndingIcon(ending: FightEnding): string {
  switch (ending.outcome) {
    case "escaped":
      return "forward";
    case "timedOut":
      return "waiting";
    case "victory":
      return "trophy";
    default:
      return "scroll";
  }
}

/** One sentence per thing that happened, ending first. Never a loss: a lost fight is a turn in the story. */
export function fightEndingLine(ending: FightEnding): string {
  const how = (() => {
    switch (ending.outcome) {
      case "escaped":
        return "You got out through the rift.";
      case "timedOut":
        return "The rift closed and threw you out.";
      case "victory":
        return ending.byObjective ? `You won by finishing: ${ending.byObjective}.` : "You won the fight.";
      default:
        return "The fight went the monsters' way, and the story carried on.";
    }
  })();
  const parts = [how];
  if (ending.freed.length > 0) parts.push(`You freed ${names(ending.freed)}.`);
  if (ending.lost.length > 0) parts.push(`${names(ending.lost)} ${ending.lost.length === 1 ? "was" : "were"} lost to the rift.`);
  const done = ending.done.filter((label) => label !== ending.byObjective);
  if (done.length > 0) parts.push(`Done: ${names(done)}.`);
  return parts.join(" ");
}
