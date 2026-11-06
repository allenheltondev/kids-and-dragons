/**
 * The camp's friends (docs/camp.md §4.4, §8.5, §12.5; #624): who is out at a
 * downtime moment, each hero's buddy, and how often a phone may tap one.
 *
 * Pure, and shared because the server chooses who is out (and stores how
 * often each friend has been) while the screens only draw what it chose:
 *
 *   - **At most four out** (`FRIENDS_OUT`, decided). The rest stay in the
 *     crew's collection; nobody is ever shown leaving.
 *   - **Buddies first.** A hero may pick one of the crew's friends as her
 *     buddy (`HeroKit.buddies`, per crew); while she is seated it is always
 *     out. Two heroes can share one, and the spare seat rotates.
 *   - **Then the rotation**, chosen once as the moment begins
 *     (`friendRotation`): the friends who have been out least
 *     (`CampFriend.outs`), then the newest, then by id, so it is the same on
 *     every screen and in every retry. A friend just befriended has been out
 *     never, so it is out at its first chance; past four new friends, the
 *     rest queue for the moments after, oldest last.
 */

import type { CampFriend, FriendId } from "./types/camp.js";

/** At most this many friends are out at once (§4.4, decided). */
export const FRIENDS_OUT = 4;

/**
 * Taps one phone may send in `FRIEND_TAP_WINDOW_MS` (§8.5). A friend takes a
 * few seconds to react and walk over, so two a window is all a kid can see;
 * past it the server answers SLOW_DOWN and the phone waits.
 */
export const FRIEND_TAP_LIMIT = 2;
/** The window `FRIEND_TAP_LIMIT` is counted over. */
export const FRIEND_TAP_WINDOW_MS = 8_000;
/** How long a phone waits between its own taps, so it rarely meets the limit. */
export const FRIEND_TAP_COOLDOWN_MS = Math.ceil(FRIEND_TAP_WINDOW_MS / FRIEND_TAP_LIMIT);

/**
 * The key a hero's buddy is kept under on her kit (`HeroKit.buddies`): the
 * camp it applies in, which is its household's first crew (no crew id) or
 * one of its other crews.
 */
export function campKey(householdId: string, crew?: string | null): string {
  return crew ? `${householdId}#${crew}` : householdId;
}

/** Whether a `campKey` names one of this household's camps. */
export function campKeyOf(key: string, householdId: string): boolean {
  return key === householdId || key.startsWith(`${householdId}#`);
}

/**
 * Every friend in the order the spare seats fill this moment (§12.5): out
 * least first, then the newest (`at`, latest first), then by id.
 */
export function friendRotation(friends: Readonly<Record<FriendId, Pick<CampFriend, "at" | "outs">>>): FriendId[] {
  return Object.entries(friends)
    .sort(([a, fa], [b, fb]) => (fa.outs ?? 0) - (fb.outs ?? 0) || fb.at.localeCompare(fa.at) || a.localeCompare(b))
    .map(([id]) => id);
}

/**
 * Who is out (§4.4): each seated hero's buddy, in seat order and once each,
 * then the rotation's next, to `FRIENDS_OUT`. A buddy that is not one of
 * `rotation`'s friends (a friend this crew does not have) is ignored.
 */
export function friendsOut(rotation: readonly FriendId[], buddies: readonly (FriendId | null | undefined)[], max = FRIENDS_OUT): FriendId[] {
  const known = new Set(rotation);
  const out: FriendId[] = [];
  for (const buddy of buddies) if (buddy && known.has(buddy) && !out.includes(buddy) && out.length < max) out.push(buddy);
  for (const id of rotation) if (out.length < max && !out.includes(id)) out.push(id);
  return out;
}

/** The friends with one more moment out each for `out`. Returns `friends` itself when nothing is out. */
export function withOuting<T extends Pick<CampFriend, "at" | "outs">>(friends: Readonly<Record<FriendId, T>>, out: readonly FriendId[]): Record<FriendId, T> {
  if (!out.some((id) => Object.hasOwn(friends, id))) return friends as Record<FriendId, T>;
  const next: Record<FriendId, T> = { ...friends };
  for (const id of out) {
    const friend = next[id];
    if (friend) next[id] = { ...friend, outs: (friend.outs ?? 0) + 1 };
  }
  return next;
}
