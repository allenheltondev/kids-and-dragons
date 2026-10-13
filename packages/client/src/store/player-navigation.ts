import { create } from "zustand";

/** A tray tap dismisses the reference sheet, even when You is already selected.
 * Keep this separate from game state: it is local navigation, never an intent.
 */
export const usePlayerNavigation = create<{ revision: number; section: "bag" | "turn" }>(() => ({ revision: 0, section: "bag" }));

export function setPlayerSection(section: "bag" | "turn"): void {
  usePlayerNavigation.setState({ section });
}

export function dismissPlayerSheet(): void {
  usePlayerNavigation.setState((state) => ({ revision: state.revision + 1, section: "bag" }));
}
