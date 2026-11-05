import { create } from "zustand";

/**
 * "Dash Cash!" — the lucky drops waiting to sparkle (docs/camp.md §5.2, #619).
 *
 * Local UI state beside the game store, for the reason field-guide-news.ts
 * gives. Fed only by the live broadcast's `campDrops`, which the server sends
 * only for a drop the store accepted and never writes to the event log, so a
 * reload, a reconnect or a resync never sparkles twice, and a roll that did
 * not come up never reaches a screen at all (no near misses). A message is
 * taken at most once (by seq), so a duplicate delivery is harmless too.
 */

export interface DashCashNewsItem {
  /** The scene the drop fell in, which with the seq keys it. */
  sceneId: string;
  /** The server seq of the step that paid it. */
  seq: number;
}

interface NewsState {
  pending: DashCashNewsItem[];
}

const EMPTY: DashCashNewsItem[] = [];
const useNewsStore = create<NewsState>(() => ({ pending: EMPTY }));

let watermark = 0;
let currentRun: string | null = null;

/** What is waiting to sparkle, oldest first. Stable until it changes. */
export function useDashCashNews(): DashCashNewsItem[] {
  return useNewsStore((s) => s.pending);
}

/** Queue a step's paid drops. Called by the game store when a live message with `campDrops` is applied. */
export function announceDashCash(runId: string, seq: number, sceneIds: readonly string[]): void {
  if (runId !== currentRun) {
    currentRun = runId;
    watermark = 0;
  }
  if (seq <= watermark || sceneIds.length === 0) return;
  watermark = seq;
  useNewsStore.setState((s) => ({ pending: [...s.pending, ...sceneIds.map((sceneId) => ({ sceneId, seq }))] }));
}

/** The sparkle has been shown: it does not come back. */
export function ackDashCash(): void {
  if (useNewsStore.getState().pending.length > 0) useNewsStore.setState({ pending: EMPTY });
}

/** Forget everything — leaving a room. */
export function clearDashCash(): void {
  watermark = 0;
  currentRun = null;
  useNewsStore.setState({ pending: EMPTY });
}
