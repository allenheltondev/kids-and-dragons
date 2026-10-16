import { create } from "zustand";

/**
 * Who found what, between games — player id → the name a Field Guide find is
 * credited to (`JournalResponse.finders`).
 *
 * In play the party names the finder; the journal has no party, so it hands
 * the household's names here and the guide reads them as a fallback. Empty
 * whenever the journal is not open.
 */
export type JournalFinders = Readonly<Record<string, string>>;

const EMPTY: JournalFinders = Object.freeze({});

const useFinderStore = create<{ finders: JournalFinders }>(() => ({ finders: EMPTY }));

export function useJournalFinders(): JournalFinders {
  return useFinderStore((s) => s.finders);
}

/** `null` clears it — the journal closing. */
export function setJournalFinders(finders: Record<string, string> | null): void {
  useFinderStore.setState({ finders: finders ?? EMPTY });
}
