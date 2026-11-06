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

/** A tap a friend acts out by its words alone, and since when. */
export interface SaidTap {
  tap: FriendTap;
  since: number;
}

/**
 * A friend that only says its words where it sits (docs/camp.md §3.2; #624):
 * the camp packed down at an indoor rest, where nobody walks, and the still
 * stage, where nothing moves. The same queue and drop rules as the full camp
 * (`createTapQueue`): one tap at a time, one more held, the rest dropped. A
 * tap is over once its words have been up `WORDS_S`, as the full camp's is
 * under reduced motion; then the friend rests `TAP_GAP_S` before the next.
 *
 * Pure: the caller's clock, in seconds. `tick` says whether what is said changed.
 */
export interface WordsTaps {
  offer(tap: FriendTap, now: number): TapVerdict;
  /** The clock moved on to `now`: words whose time is up go, held taps whose time has come start. */
  tick(now: number): boolean;
  /** What each friend is saying now. */
  said(): SaidTap[];
  /** When `tick` next has something to do, or null for never (a timer's deadline). */
  next(): number | null;
  /** A friend is no longer shown: forget its taps. */
  forget(figureId: string): void;
}

export function createWordsTaps(): WordsTaps {
  const queue = createTapQueue();
  const saying = new Map<string, SaidTap>();
  /** When each friend's last tap ended: it rests `TAP_GAP_S` from then before a held one starts. */
  const restingFrom = new Map<string, number>();
  const start = (tap: FriendTap, now: number): void => {
    saying.set(tap.figureId, { tap, since: now });
    restingFrom.delete(tap.figureId);
  };
  return {
    offer(tap, now) {
      const verdict = queue.offer(tap, now);
      if (verdict === "start") start(tap, now);
      return verdict;
    },
    tick(now) {
      let changed = false;
      for (const [id, said] of saying) {
        const end = said.since + WORDS_S;
        if (now < end) continue;
        saying.delete(id);
        queue.finish(id, end);
        restingFrom.set(id, end);
        changed = true;
      }
      for (const tap of queue.due(now)) {
        start(tap, now);
        changed = true;
      }
      return changed;
    },
    said: () => [...saying.values()],
    next() {
      let soonest: number | null = null;
      const consider = (at: number): void => {
        soonest = soonest === null ? at : Math.min(soonest, at);
      };
      for (const said of saying.values()) consider(said.since + WORDS_S);
      for (const [id, from] of restingFrom) if (!saying.has(id) && queue.waiting(id).length > 0) consider(from + TAP_GAP_S);
      return soonest;
    },
    forget(figureId) {
      queue.forget(figureId);
      saying.delete(figureId);
      restingFrom.delete(figureId);
    },
  };
}

/** A tap as the phone's message names it: the friend's catalog id, the tapping kid's hero, its words. */
export interface HeardTap {
  friendId: string;
  heroId: string;
  words: string;
}

/** A stage that may be showing a friend out: the full camp, or the camp packed into a scene. */
export interface FriendTapTarget {
  showsFriend(friendId: string): boolean;
  tapFriend(tap: HeardTap): TapVerdict;
}

/**
 * A tap goes to whichever stage is showing its friend (#624): the full camp
 * (the lobby, an outdoor rest, the chapter end) or the camp packed down into
 * an indoor rest's scene. Dropped only when none of them shows it.
 */
export function routeFriendTap(tap: HeardTap, targets: readonly (FriendTapTarget | null | undefined)[]): TapVerdict {
  for (const target of targets) {
    if (target?.showsFriend(tap.friendId)) return target.tapFriend(tap);
  }
  return "dropped";
}
