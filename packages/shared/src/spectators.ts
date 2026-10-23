/**
 * Spectators (#388): a phone in the room at a table that is already full.
 *
 * A spectator is a player on the roster (`RunState.seats`) with no hero, at a
 * table where every seat is taken (`tableFull`), who has not been taken out.
 * They are never in `party`, and that is the whole design: votes, group
 * checks, helper dice, ready gates, the away rules, encounters and spawns all
 * count `party`, so none of them can see a spectator. Nothing that counts the
 * party may count a spectator.
 *
 * What a spectator can do is watch, and cheer: a tap that floats a small
 * picture up the corner of the shared screen. A cheer is live only, like a
 * preview. It never moves `seq`, never waits for anybody, and is never
 * written down.
 *
 * Shared because the server decides who may cheer and the screens draw it,
 * and the two must agree on who is a spectator.
 */

import { tableFull } from "./seats.js";
import type { RunState } from "./types/state.js";

/** One cheer: a painted picture and the word a screen reader says for it. */
export interface Cheer {
  id: string;
  /** An icon name with painted art (client `screens/icons.tsx`). */
  icon: string;
  label: string;
}

/** Every cheer there is. A fixed list, so nothing typed ever reaches the TV. */
export const CHEERS: readonly Cheer[] = [
  { id: "heart", icon: "heart", label: "Love it!" },
  { id: "star", icon: "star", label: "Wow!" },
  { id: "spark", icon: "spark", label: "Go, go, go!" },
  { id: "crown", icon: "crown", label: "Heroes!" },
  { id: "note", icon: "note", label: "Hooray!" },
];

/** The cheer with this id, or undefined for anything else. */
export function cheerById(id: unknown): Cheer | undefined {
  return typeof id === "string" ? CHEERS.find((cheer) => cheer.id === id) : undefined;
}

/**
 * Cheers one phone may send in `CHEER_WINDOW_MS`. A kid mashing the button
 * sends a few and then waits; the TV never fills with them.
 */
export const CHEER_LIMIT = 3;

/** The window `CHEER_LIMIT` is counted over. */
export const CHEER_WINDOW_MS = 10_000;

/** How long a phone waits between its own cheers, so it rarely meets the limit. */
export const CHEER_COOLDOWN_MS = Math.ceil(CHEER_WINDOW_MS / CHEER_LIMIT);

/** What a spectator's phone says. Read aloud to an eight-year-old; never counts the party. */
export const SPECTATOR_MESSAGE = "You can watch the story and cheer the heroes on!";

type SpectatorView = Pick<RunState, "party" | "removed" | "seats">;

/**
 * Whether `playerId` is a spectator here: on the roster, with no hero, not
 * taken out, at a table with no seat for them.
 */
export function isSpectator(state: SpectatorView, playerId: string | null | undefined): boolean {
  if (!playerId || state.seats?.[playerId] === undefined) return false;
  if (state.removed?.includes(playerId)) return false;
  if (state.party.some((member) => member.playerId === playerId)) return false;
  return tableFull(state, playerId);
}

/**
 * The spectators whose phones are here. `RunState.watching` is written by
 * presence, which does not hear a spectator sit down when a seat opens, so
 * this reads it through `isSpectator`: whoever has a hero now, or was taken
 * out, is not watching any more.
 */
export function watchers(state: SpectatorView & Pick<RunState, "watching">): string[] {
  return (state.watching ?? []).filter((playerId) => isSpectator(state, playerId));
}
