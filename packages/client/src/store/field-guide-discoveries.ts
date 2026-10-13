import { create } from "zustand";

/**
 * One find in the household's Field Guide. Matches the shape #105 will name
 * `FieldGuideFind` in `packages/shared/src/field-guide-record.ts`; defined
 * locally until that merges so the client does not import server record types.
 */
export interface FieldGuideFindView {
  firstFoundBy: string;
  foundAt: string;
  runId?: string;
}

export type FieldGuideDiscoveries = Record<string, FieldGuideFindView>;

const EMPTY: FieldGuideDiscoveries = Object.freeze({}) as FieldGuideDiscoveries;

/*
 * TODO(#106): the seam. Today this store is the whole source and starts empty.
 * When household sync lands, hydrate it from the server record (and apply
 * live patches) via `setFieldGuideDiscoveries`; consumers of
 * `useFieldGuideDiscoveries()` need not change.
 */
const useDiscoveryStore = create<{ discoveries: FieldGuideDiscoveries }>(() => ({ discoveries: EMPTY }));

/** Canon id -> find. Empty until something is discovered. */
export function useFieldGuideDiscoveries(): FieldGuideDiscoveries {
  return useDiscoveryStore((s) => s.discoveries);
}

/** Replace the discoveries wholesale. Tests use this as a fixture; #106 as the sync sink. */
export function setFieldGuideDiscoveries(discoveries: FieldGuideDiscoveries | null): void {
  useDiscoveryStore.setState({ discoveries: discoveries ?? EMPTY });
}
