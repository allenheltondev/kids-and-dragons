/**
 * How the screens name a household's crews (architecture §4.5, "Crews"): the
 * host's Room panel and the lobby. Its own module so the lobby does not pull
 * in the host's lazy chunk for one line.
 */

import { CREW_NAMES, FIRST_CREW_NAME, type RunState } from "@kad/shared";

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
