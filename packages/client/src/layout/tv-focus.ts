/**
 * TV focus (Display settings): the shared screen tells the story, and the phone shows only the
 * thing to do now, so a kid never scrolls or hunts for where to tap.
 *
 * The setting is per device (a11y/prefs.ts puts `data-focus="tv"` on <html>), but whether it
 * applies is the shell's call, because only the shell knows whether there is a TV at all. Party
 * Mode provides `TvFocus`; Travel Mode, where the phone *is* the world, never does. PlayerView
 * and everything under it read the context and never the room mode (PlayerView's first rule).
 */

import { createContext, useContext, useSyncExternalStore } from "react";
import { PREFS_EVENT } from "../a11y/prefs";

/** True when this player surface should defer to the TV. Only a shell with a TV sets it. */
export const TvFocus = createContext(false);

export function useTvFocus(): boolean {
  return useContext(TvFocus);
}

function subscribe(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  document.addEventListener(PREFS_EVENT, onChange);
  return () => document.removeEventListener(PREFS_EVENT, onChange);
}

function snapshot(): boolean {
  return typeof document !== "undefined" && document.documentElement.getAttribute("data-focus") === "tv";
}

/** Whether this device has TV focus switched on, following the setting as it changes. */
export function useTvFocusSetting(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
