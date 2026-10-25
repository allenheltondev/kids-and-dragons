/**
 * What the screens say about stopping and picking a game back up (#259).
 * Short, warm sentences an adult can read aloud to an eight-year-old.
 */

import type { SavedGameView } from "@kad/shared";

/** The lobby's offer: where the party stopped, in a line. */
export function savedHeading(saved: Pick<SavedGameView, "chapter">): string {
  return `You stopped partway through ${saved.chapter.title}.`;
}

/** Where the game is saved, when the family named its table: "Saved at Kitchen table." */
export function savedWhere(saved: Pick<SavedGameView, "location">): string {
  return saved.location ? `Saved at ${saved.location}.` : "";
}

/** Who was playing, as "Pip and Bo" or "Pip, Bo and Dot". */
export function savedHeroes(saved: Pick<SavedGameView, "heroes">): string {
  const names = saved.heroes;
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Where a hero is saved, on her own screen and the organizer's. */
export function savedHeroLine(name: string, saved: { at?: string }): string {
  return saved.at ? `${name} is saved in a game at ${saved.at}.` : `${name} is saved in a game.`;
}

export const LET_GO_NOTE = "What they gained in this adventure goes away, and they are free to join any game.";

export const STOP_OFFER = "This is a cozy place to stop for today. Your adventure will wait for you.";
export const STOP_CONFIRM = "Stop here and save? Next time, tap Keep going and you will be right back.";
export const STOPPED_MESSAGE = "Your game is saved. Next time, tap Keep going and you will be right back here.";
