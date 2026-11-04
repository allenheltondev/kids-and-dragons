/**
 * What a phone seated in a room adds to the Settings sheet (a11y/A11yControl): the room's own
 * controls (play on phones instead, or hand the world back to a TV) and the intro again.
 *
 * One gear for everything (playtest, November 2026): these used to be a second gear tile in the
 * party row of the You page, beside the corner's gear, and nobody could say which was which. The
 * player's pane hands them in while it is mounted; the sheet, which loads later, reads them.
 * Its own tiny module so neither side has to import the other's chunk.
 */

import type { ReactNode } from "react";
import { create } from "zustand";

interface SettingsRoomState {
  /** The "This game" group, or null where the device is in no room (the TV, the home screen). */
  room: ReactNode | null;
  setRoom: (room: ReactNode | null) => void;
}

export const useSettingsRoom = create<SettingsRoomState>((set) => ({
  room: null,
  setRoom: (room) => set({ room }),
}));
