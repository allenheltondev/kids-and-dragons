import { create } from "zustand";
import type { FieldGuideFind } from "@kad/shared";

/**
 * The household's Field Guide — canon id → who found it first and when.
 *
 * Fed by the game store (#106): the server carries the household's book on the
 * run state (`RunState.fieldGuide`), so the join, a snapshot resync, a replay
 * of missed events and every live patch all keep it current through the one
 * mirror. `store/index.ts` copies it here whenever the mirror changes, so
 * screens that only want the book need not subscribe to the whole run state —
 * and a test can set it as a fixture without building one.
 *
 * Only the *book*. What is newly found is a separate, live-only signal; see
 * `field-guide-news.ts`.
 */
export type FieldGuideDiscoveries = Record<string, FieldGuideFind>;

const EMPTY: FieldGuideDiscoveries = Object.freeze({}) as FieldGuideDiscoveries;

const useDiscoveryStore = create<{ discoveries: FieldGuideDiscoveries }>(() => ({ discoveries: EMPTY }));

/** Canon id -> find. Empty until something is discovered. */
export function useFieldGuideDiscoveries(): FieldGuideDiscoveries {
  return useDiscoveryStore((s) => s.discoveries);
}

/** The current book, outside React. */
export function getFieldGuideDiscoveries(): FieldGuideDiscoveries {
  return useDiscoveryStore.getState().discoveries;
}

/**
 * Replace the discoveries wholesale — the sync sink (`store/index.ts`) and a
 * test fixture. `null` (no room, or a room whose household is not settled yet)
 * is the empty book. Setting the same object again is a no-op, so the game
 * store can call this on every state without re-rendering the guide: the
 * mirror's structural sharing keeps `fieldGuide`'s reference until it changes.
 */
export function setFieldGuideDiscoveries(discoveries: FieldGuideDiscoveries | null | undefined): void {
  const next = discoveries ?? EMPTY;
  if (useDiscoveryStore.getState().discoveries === next) return;
  useDiscoveryStore.setState({ discoveries: next });
}
