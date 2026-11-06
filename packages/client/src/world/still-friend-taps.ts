/**
 * Friend taps on the still stage (#624, #264): with no WebGL, StaticStage
 * takes each tap the store hears and shows the friend's words over its head,
 * in the full still camp (the lobby, an outdoor rest, the chapter end) or in
 * the packed row at an indoor rest (docs/camp.md §3.2). Nothing moves on the
 * still stage, so it is the words alone, as the full camp under reduced
 * motion: the same queue and drop rules (camp-taps.ts `createWordsTaps`).
 *
 * A tap for a friend the still stage is not showing is dropped, and every
 * tap heard is taken off the store, as PixiStage does.
 */

import { useEffect, useRef, useState } from "react";
import { useGameStore } from "../store";
import { createWordsTaps, type WordsTaps } from "./camp-taps";
import { friendFigureId } from "./camp-friends";

const seconds = (): number => performance.now() / 1000;

/** Each shown friend's words up now, by friend id. `shows` says which friends the still stage is drawing. */
export function useStillFriendTaps(shows: (friendId: string) => boolean): ReadonlyMap<string, string> {
  const taps = useGameStore((store) => store.friendTaps);
  const queue = useRef<WordsTaps | null>(null);
  queue.current ??= createWordsTaps();
  const showsRef = useRef(shows);
  showsRef.current = shows;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [said, setSaid] = useState<ReadonlyMap<string, string>>(() => new Map());

  const refresh = useRef(() => {});
  refresh.current = () => {
    const q = queue.current!;
    q.tick(seconds());
    const next = new Map<string, string>();
    for (const { tap } of q.said()) {
      const id = tap.figureId.slice("friend:".length);
      if (showsRef.current(id)) next.set(id, tap.words);
      else q.forget(tap.figureId);
    }
    setSaid((was) => (was.size === next.size && [...next].every(([id, words]) => was.get(id) === words) ? was : next));
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const at = q.next();
    if (at !== null) timer.current = setTimeout(() => refresh.current(), Math.max(0, (at - seconds()) * 1000) + 16);
  };

  useEffect(() => {
    if (taps.length === 0) return;
    const { dropFriendTap } = useGameStore.getState();
    // Words whose time is up are gone before the next tap is weighed.
    queue.current!.tick(seconds());
    for (const tap of taps) {
      if (showsRef.current(tap.friendId)) queue.current!.offer({ figureId: friendFigureId(tap.friendId), heroId: tap.heroId, words: tap.words }, seconds());
      dropFriendTap(tap.key);
    }
    refresh.current();
  }, [taps]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return said;
}
