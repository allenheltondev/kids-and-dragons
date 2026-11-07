import { create } from "zustand";
import type { KitMilestoneUnlock, LookUnlockNews } from "@kad/shared";

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
 *
 * Her earned looks (docs/hero-looks.md §6; #669) are told here too, from the
 * broadcast's `lookUnlocks` (`announceLookNews`), with a watermark of their
 * own since one message can carry both: a coat, a nameplate or a title, its
 * look id in `pieceId`, and what earned it (`cause`), which says when.
 */

/** What an item is: a kit piece (a tent, a decoration) or a look (a coat, a nameplate, a title). */
export type KitNewsKind = KitMilestoneUnlock["kind"] | LookUnlockNews["kind"];

/** Whether an item is one of her looks rather than a kit piece. */
export function isLookNews(item: { kind: KitNewsKind }): boolean {
  return item.kind === "coat" || item.kind === "special" || item.kind === "nameplate" || item.kind === "title";
}

export interface KitNewsItem {
  characterId: string;
  /** The kit piece's id, or the look's. */
  pieceId: string;
  kind: KitNewsKind;
  /** A look's: what earned it (`LookUnlockNews.cause`). */
  cause?: LookUnlockNews["cause"];
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
let lookWatermark = 0;
let currentRun: string | null = null;

type Keyed = Pick<KitNewsItem, "characterId" | "pieceId"> & { kind?: KitNewsKind };

// A look and a kit piece never share a key, whatever their ids.
const keyOf = (unlock: Keyed): string =>
  `${unlock.characterId}:${unlock.kind !== undefined && isLookNews({ kind: unlock.kind }) ? "look:" : ""}${unlock.pieceId}`;

/** What is waiting to be told, oldest first. Stable until it changes. */
export function useKitNews(): KitNewsItem[] {
  return useNewsStore((s) => s.pending);
}

/** The queue outside React. */
export function getKitNews(): KitNewsItem[] {
  return useNewsStore.getState().pending;
}

function forRun(runId: string): void {
  if (runId === currentRun) return;
  currentRun = runId;
  told = new Set();
  watermark = 0;
  lookWatermark = 0;
}

function enqueue(items: readonly Omit<KitNewsItem, "seq" | "arrivedAt" | "crossings">[], seq: number, crossings: number, now: number): void {
  const fresh = items.filter((u) => !told.has(keyOf(u)));
  if (fresh.length === 0) return;
  for (const u of fresh) told.add(keyOf(u));
  useNewsStore.setState((s) => ({
    pending: [...s.pending, ...fresh.map((u) => ({ ...u, seq, arrivedAt: now, crossings }))],
  }));
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
  forRun(runId);
  if (seq <= watermark) return;
  watermark = seq;
  enqueue(unlocks.map(({ characterId, pieceId, kind }) => ({ characterId, pieceId, kind })), seq, crossings, now);
}

/**
 * Queue a step's earned looks (#669). Called by the game store when a live
 * message with `lookUnlocks` is applied, beside its `kitUnlocks`.
 */
export function announceLookNews(
  runId: string,
  seq: number,
  unlocks: readonly LookUnlockNews[],
  crossings: number,
  now: number = Date.now(),
): void {
  forRun(runId);
  if (seq <= lookWatermark) return;
  lookWatermark = seq;
  enqueue(unlocks.map((u) => ({ characterId: u.characterId, pieceId: u.lookId, kind: u.kind, cause: u.cause })), seq, crossings, now);
}

/** Mark items told. They do not come back. */
export function ackKitNews(items: readonly Keyed[]): void {
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
  lookWatermark = 0;
  currentRun = null;
  useNewsStore.setState({ pending: EMPTY });
}
