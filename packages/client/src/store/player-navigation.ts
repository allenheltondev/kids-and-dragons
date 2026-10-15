import { create } from "zustand";
import type { FieldGuideCategory } from "@kad/shared";

export type PlayerSection = "bag" | "turn" | "guide";

interface PlayerNavigation {
  revision: number;
  section: PlayerSection;
  /** Canon id of the Field Guide entry open on the detail screen, if any. */
  guideEntry: string | null;
  /**
   * The index tab, kept here rather than in the index because opening an entry
   * unmounts the index: coming back has to land on the tab you left, not on
   * Creatures. Null is "the first one". Cleared when the guide closes.
   */
  guideTab: FieldGuideCategory | null;
}

/** A tray tap dismisses the reference sheet, even when You is already selected.
 * Keep this separate from game state: it is local navigation, never an intent.
 */
export const usePlayerNavigation = create<PlayerNavigation>(() => ({
  revision: 0, section: "bag", guideEntry: null, guideTab: null,
}));

/*
 * How far down the index was scrolled, for the same reason as `guideTab`. Not
 * store state: it changes on every scroll event and nothing renders from it,
 * so it is read once, when the index mounts.
 */
let guideScroll = 0;

export function guideIndexScroll(): number {
  return guideScroll;
}

export function rememberGuideIndexScroll(top: number): void {
  guideScroll = top;
}

const leftGuide = { guideEntry: null, guideTab: null } as const;

export function setPlayerSection(section: PlayerSection): void {
  if (section !== "guide") guideScroll = 0;
  usePlayerNavigation.setState({ section, ...(section === "guide" ? {} : leftGuide) });
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

/** Pick an index tab. A different tab starts at its top. */
export function selectGuideTab(tab: FieldGuideCategory): void {
  guideScroll = 0;
  usePlayerNavigation.setState({ guideTab: tab });
}

export function dismissPlayerSheet(): void {
  guideScroll = 0;
  usePlayerNavigation.setState((state) => ({ revision: state.revision + 1, section: "bag", ...leftGuide }));
}
