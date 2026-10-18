/** The settings as state, for the panel. The attributes on <html> are the truth for everything else. */

import { create } from "zustand";
import { applyPrefs, loadPrefs, savePrefs, type A11yPrefs } from "./prefs";

interface A11yState {
  prefs: A11yPrefs;
  open: boolean;
  set: (change: Partial<A11yPrefs>) => void;
  setOpen: (open: boolean) => void;
}

export const useA11y = create<A11yState>((set, get) => ({
  prefs: loadPrefs(),
  open: false,
  set: (change) => {
    const prefs = { ...get().prefs, ...change };
    savePrefs(prefs);
    applyPrefs(prefs);
    set({ prefs });
  },
  setOpen: (open) => set({ open }),
}));

/** Opens the panel from anywhere (the player's room settings, at the bottom of the phone). */
export function openA11ySettings(): void {
  useA11y.getState().setOpen(true);
}
