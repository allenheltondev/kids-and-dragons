import { create } from "zustand";
import type { KitMilestoneUnlock } from "@kad/shared";

/**
 * "New tent unlocked!" — milestone kit pieces waiting to be told to their
 * hero's phone (docs/camp.md §5.4, #621).
 *
 * Fed only by the live broadcast's `kitUnlocks`, which the server never writes
 * to the event log, so a reload, a reconnect or a resync cannot tell it twice;
 * on top of that a message is taken at most once (by seq), and a piece is told
 * at most once per hero on this device. The piece itself is already on the
 * hero's kit: this is only the telling.
 *
 * Each item keeps when it arrived and how many heroes crossed a tier on the
 * same message, because the telling waits for the moment it belongs to: the
 * transformation cutscene, one beat per crossing hero, and the rank-up moment
 * (`kitNewsReadyAt`, KitNews.tsx). Never during them.
 */

export interface KitNewsItem extends KitMilestoneUnlock {
  /** The server seq of the step that unlocked it, which orders the queue. */
  seq: number;
  /** `Date.now()` when it arrived. */
  arrivedAt: number;
  /** Heroes whose tier changed on the same message: the cutscene's beats. */
  crossings: number;
}

interface NewsState {
  pending: KitNewsItem[];
}

const EMPTY: KitNewsItem[] = [];
const useNewsStore = create<NewsState>(() => ({ pending: EMPTY }));

let told = new Set<string>();
let watermark = 0;
let currentRun: string | null = null;

const keyOf = (unlock: Pick<KitMilestoneUnlock, "characterId" | "pieceId">): string => `${unlock.characterId}:${unlock.pieceId}`;

/** What is waiting to be told, oldest first. Stable until it changes. */
export function useKitNews(): KitNewsItem[] {
  return useNewsStore((s) => s.pending);
}

/** The queue outside React. */
export function getKitNews(): KitNewsItem[] {
  return useNewsStore.getState().pending;
}

/**
 * Queue a step's unlocks. Called by the game store when a live message with
 * `kitUnlocks` is applied, after its patch and its progression.
 */
export function announceKitNews(
  runId: string,
  seq: number,
  unlocks: readonly KitMilestoneUnlock[],
  crossings: number,
  now: number = Date.now(),
): void {
  if (runId !== currentRun) {
    currentRun = runId;
    told = new Set();
    watermark = 0;
  }
  if (seq <= watermark) return;
  watermark = seq;
  const fresh = unlocks.filter((u) => !told.has(keyOf(u)));
  if (fresh.length === 0) return;
  for (const u of fresh) told.add(keyOf(u));
  useNewsStore.setState((s) => ({
    pending: [...s.pending, ...fresh.map((u) => ({ ...u, seq, arrivedAt: now, crossings }))],
  }));
}

/** Mark items told. They do not come back. */
export function ackKitNews(items: readonly Pick<KitMilestoneUnlock, "characterId" | "pieceId">[]): void {
  const pending = useNewsStore.getState().pending;
  if (pending.length === 0) return;
  const done = new Set(items.map(keyOf));
  const left = pending.filter((item) => !done.has(keyOf(item)));
  if (left.length !== pending.length) useNewsStore.setState({ pending: left.length ? left : EMPTY });
}

/** Forget everything: leaving a room. */
export function clearKitNews(): void {
  told = new Set();
  watermark = 0;
  currentRun = null;
  useNewsStore.setState({ pending: EMPTY });
}
