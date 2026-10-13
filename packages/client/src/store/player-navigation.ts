import { create } from "zustand";

export type PlayerSection = "bag" | "turn" | "guide";

interface PlayerNavigation {
  revision: number;
  section: PlayerSection;
  /** Canon id of the Field Guide entry open on the detail screen, if any. */
  guideEntry: string | null;
}

/** A tray tap dismisses the reference sheet, even when You is already selected.
 * Keep this separate from game state: it is local navigation, never an intent.
 */
export const usePlayerNavigation = create<PlayerNavigation>(() => ({ revision: 0, section: "bag", guideEntry: null }));

export function setPlayerSection(section: PlayerSection): void {
  usePlayerNavigation.setState({ section, ...(section === "guide" ? {} : { guideEntry: null }) });
}

/**
 * Open the Field Guide, optionally straight to one entry. Local only.
 *
 * Bumps `revision` like a tray tap, because it *is* one (the Guide tab in the
 * tray, or the "New in your Field Guide" toast): an open character sheet
 * closes so the guide is what you see.
 */
export function openGuide(entryId?: string): void {
  usePlayerNavigation.setState((state) => ({
    revision: state.revision + 1, section: "guide", guideEntry: entryId ?? null,
  }));
}

/** Select an entry (or null for the index) while staying in the guide. */
export function selectGuideEntry(entryId: string | null): void {
  usePlayerNavigation.setState({ guideEntry: entryId });
}

export function dismissPlayerSheet(): void {
  usePlayerNavigation.setState((state) => ({ revision: state.revision + 1, section: "bag", guideEntry: null }));
}
