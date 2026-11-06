/**
 * A friend tapped on a phone, on the TV (docs/camp.md §4.4, §8.5; #624): its
 * words, then a walk over to the tapping kid's hero, one at a time.
 *
 * The server already lets each phone through only a few taps a window
 * (`FRIEND_TAP_LIMIT`); this is the TV's half. Each friend acts out one tap
 * at a time and holds at most one more (`TAP_WAITING`); anything past that is
 * dropped, and a tap that would only repeat the one waiting (the same kid
 * again) replaces nothing. So four kids hammering the button get a friend
 * that says something, walks over, says something else and walks again: a
 * happy friend, never one twitching between heroes.
 *
 * Pure and Pixi-free: camp.ts asks it what to do and when, on its own clock.
 */

/** A tap as the camp acts it out. */
export interface FriendTap {
  /** The friend's figure id in camp (`friend:<id>`). */
  figureId: string;
  /** The tapping kid's hero, whom it walks over to. */
  heroId: string;
  /** What it says (its catalog reaction). */
  words: string;
}

/** How long a tapped friend's words stay up, seconds. */
export const WORDS_S = 4;
/** How long it reacts where it stands (words up, a hop and a turn) before it walks over. */
export const REACT_S = 1.2;
/** Taps a friend holds while it acts one out. One: anything more is dropped. */
export const TAP_WAITING = 1;
/** A friend at rest between two taps, seconds, so one tap's walk never runs straight into the next one's hop. */
export const TAP_GAP_S = 0.6;

export type TapVerdict = "start" | "waiting" | "dropped";

interface FriendTaps {
  /** The tap being acted out, and when it started. */
  active: { tap: FriendTap; since: number } | null;
  waiting: FriendTap[];
  /** When it may start the next. */
  restUntil: number;
}

export interface TapQueue {
  /** A tap arrived at `now`: started at once, held for later, or dropped. */
  offer(tap: FriendTap, now: number): TapVerdict;
  /** The friend finished acting a tap out at `now` (its walk is over, or it could not walk). */
  finish(figureId: string, now: number): void;
  /** Taps whose time has come: each friend's waiting one, once it has rested. */
  due(now: number): FriendTap[];
  /** The tap a friend is acting out, and since when, or null. */
  active(figureId: string): { tap: FriendTap; since: number } | null;
  /** Taps held for a friend (for tests). */
  waiting(figureId: string): readonly FriendTap[];
  /** A friend went in, or the camp was taken down: forget its taps. */
  forget(figureId: string): void;
}

export function createTapQueue(): TapQueue {
  const friends = new Map<string, FriendTaps>();
  const of = (id: string): FriendTaps => {
    let entry = friends.get(id);
    if (!entry) {
      entry = { active: null, waiting: [], restUntil: -Infinity };
      friends.set(id, entry);
    }
    return entry;
  };
  return {
    offer(tap, now) {
      const entry = of(tap.figureId);
      if (!entry.active && entry.waiting.length === 0 && now >= entry.restUntil) {
        entry.active = { tap, since: now };
        return "start";
      }
      // The same kid again while hers waits: nothing new to show.
      if (entry.waiting.some((w) => w.heroId === tap.heroId)) return "dropped";
      if (entry.waiting.length >= TAP_WAITING) return "dropped";
      entry.waiting.push(tap);
      return "waiting";
    },
    finish(figureId, now) {
      const entry = friends.get(figureId);
      if (!entry?.active) return;
      entry.active = null;
      entry.restUntil = now + TAP_GAP_S;
    },
    due(now) {
      const out: FriendTap[] = [];
      for (const entry of friends.values()) {
        if (entry.active || entry.waiting.length === 0 || now < entry.restUntil) continue;
        const tap = entry.waiting.shift()!;
        entry.active = { tap, since: now };
        out.push(tap);
      }
      return out;
    },
    active: (figureId) => friends.get(figureId)?.active ?? null,
    waiting: (figureId) => friends.get(figureId)?.waiting ?? [],
    forget(figureId) {
      friends.delete(figureId);
    },
  };
}
