import { create } from "zustand";

/**
 * "New page in the Field Guide!" — the finds waiting to be celebrated (#106,
 * consumed by #110's toasts and TV banner).
 *
 * A separate store from the game store for the reason `keepsake.ts` gives: the
 * game store's `state` is the server's mirror and moves only by patch, while
 * this is local UI state — a queue the screens drain by acknowledging what
 * they showed.
 *
 * Fed only by the live broadcast's `discovered` field, which the server never
 * writes to the event log, so a reload, a reconnect or a resync cannot re-fire
 * a celebration: they rebuild the *book* (`field-guide-discoveries.ts`) and
 * leave this queue alone. On top of that, an id is announced at most once per
 * room on this device, and a message is taken at most once (by seq), so a
 * duplicate delivery is harmless too.
 */

export interface FieldGuideNewsItem {
  canonId: string;
  /** The server seq of the step that found it — orders the queue. */
  seq: number;
}

interface NewsState {
  pending: FieldGuideNewsItem[];
}

const EMPTY: FieldGuideNewsItem[] = [];
const useNewsStore = create<NewsState>(() => ({ pending: EMPTY }));

/** Ids announced since the last clear, so one find is never celebrated twice. */
let announced = new Set<string>();
/** The highest seq taken, so a duplicate delivery of one message is ignored. */
let watermark = 0;
/** The run those two belong to; a different run starts them afresh. */
let currentRun: string | null = null;

/** What is waiting to be celebrated, oldest first. Stable until it changes. */
export function useFieldGuideNews(): FieldGuideNewsItem[] {
  return useNewsStore((s) => s.pending);
}

/** The queue outside React — for a subscriber that is not a component. */
export function getFieldGuideNews(): FieldGuideNewsItem[] {
  return useNewsStore.getState().pending;
}

/** Subscribe outside React (e.g. an audio cue). Returns the unsubscribe. */
export function subscribeFieldGuideNews(listener: (pending: FieldGuideNewsItem[]) => void): () => void {
  return useNewsStore.subscribe((s) => listener(s.pending));
}

/**
 * Queue a step's new finds. Called by the game store when a live message with
 * `discovered` is applied — after its patch, so the book already holds them.
 */
export function announceFieldGuideNews(runId: string, seq: number, canonIds: readonly string[]): void {
  if (runId !== currentRun) {
    currentRun = runId;
    announced = new Set();
    watermark = 0;
  }
  if (seq <= watermark) return;
  watermark = seq;
  const fresh = canonIds.filter((id) => !announced.has(id));
  if (fresh.length === 0) return;
  for (const id of fresh) announced.add(id);
  useNewsStore.setState((s) => ({
    pending: [...s.pending, ...fresh.map((canonId) => ({ canonId, seq }))],
  }));
}

/**
 * Mark finds as celebrated — the given ids, or everything pending when called
 * with none. They do not come back: acknowledging is the consume.
 */
export function ackFieldGuideNews(canonIds?: readonly string[]): void {
  const pending = useNewsStore.getState().pending;
  if (pending.length === 0) return;
  const done = canonIds ? new Set(canonIds) : null;
  const left = done ? pending.filter((item) => !done.has(item.canonId)) : EMPTY;
  if (left.length !== pending.length) useNewsStore.setState({ pending: left.length ? left : EMPTY });
}

/** Forget everything — leaving a room. The next room starts with no news. */
export function clearFieldGuideNews(): void {
  announced = new Set();
  watermark = 0;
  currentRun = null;
  useNewsStore.setState({ pending: EMPTY });
}
