/**
 * How the screens name a household's crews (architecture §4.5, "Crews"): the
 * host's Room panel and the lobby. Its own module so the lobby does not pull
 * in the host's lazy chunk for one line.
 */

import { CREW_NAMES, FIRST_CREW_NAME, type HeroHold, type RunState } from "@kad/shared";

export { CREW_NAMES };

/** What the household's first crew, which has no row and no name of its own, is called. */
export const FIRST_CREW = FIRST_CREW_NAME;

/** The crew this lobby plays, by name, and the ones it could switch to. */
export function crewChoices(state: Pick<RunState, "crew" | "crews" | "firstCrewName">): {
  current: string;
  others: { id: string | null; name: string }[];
} {
  const all = [{ id: null as string | null, name: state.firstCrewName ?? FIRST_CREW }, ...(state.crews ?? [])];
  const mine = state.crew ?? null;
  return {
    current: all.find((crew) => crew.id === mine)?.name ?? (state.firstCrewName ?? FIRST_CREW),
    others: all.filter((crew) => crew.id !== mine),
  };
}

/**
 * What the hero picker says holds a hero (`HeroHold`), on her card:
 * "Playing Gemfall with The Otter Crew". `saved` when a stopped game is it.
 */
export function heroHoldLine(hold: HeroHold, saved: boolean): string {
  const where = hold.at
    ? `Partway through ${hold.campaign} at ${hold.at}`
    : hold.crew
      ? `Playing ${hold.campaign} with ${hold.crew}`
      : `Partway through ${hold.campaign}`;
  return saved ? `${where}, saved for next time` : where;
}

/**
 * Under the chosen hero, what sitting her down does to this room, when it
 * does something a kid would not expect. Null when it is just "she sits down".
 */
export function heroHoldNote(name: string, hold: HeroHold): string | null {
  if (hold.blocked || !hold.crew) return null;
  if (hold.switches) return `This room will switch to ${hold.crew} so ${name} can keep going.`;
  return `${name} can sit down, but this room is playing as a different crew. A grown-up can switch crews in the Room panel.`;
}

/** The server's refusal for a hero this room cannot seat, as a sentence. */
export function heroBlockedLine(hold: Pick<HeroHold, "blocked">): string {
  const words = hold.blocked ?? "";
  return /[.!?]$/.test(words) ? words : `${words}.`;
}
