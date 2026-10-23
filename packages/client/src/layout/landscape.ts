/**
 * A screen held sideways: a tablet (the screen kids reach for first, an iPad on a
 * lap with both thumbs on the edges) or a phone.
 *
 * The phone shells put one surface on the screen at a time and the tray along
 * the bottom, because a phone has neither the width for two panes nor the
 * height to spare. A landscape tablet has the width and is short on height, so
 * it gets the opposite: the tray becomes a rail down the side (components.css)
 * and the world, or the map, sits beside your own controls instead of behind
 * them.
 *
 * A phone on its side (about 390 to 430px tall, 640 to 930px wide) gets the same
 * shape at a smaller scale: a slim rail of just the objects, the world and your
 * controls side by side, and the corner row standing in a column down the far
 * edge instead of taking a strip off the top of a screen with none to spare.
 *
 * The CSS repeats these queries (a media query cannot read a variable); keep
 * them in step. The tablet is wide enough for two panes and tall enough for the
 * rail's five objects with the corner row above them, and landscape, so a tablet
 * held upright keeps the phone layout. The phone is landscape and short; the
 * two never overlap, and a phone held upright (narrower than 600px) matches
 * neither.
 */

import { useSyncExternalStore } from "react";
// The painted chrome, which both room layouts dress (docs/briefs/tablet-chrome-art.md). Imported
// here because both import this, so it loads with the room and never with the start screen.
import "../styles/chrome.css";

export const LANDSCAPE_TABLET = "(orientation: landscape) and (min-width: 900px) and (min-height: 560px)";

export const LANDSCAPE_PHONE = "(orientation: landscape) and (min-width: 600px) and (max-height: 559px)";

function queries(): MediaQueryList[] {
  if (typeof matchMedia !== "function") return [];
  return [matchMedia(LANDSCAPE_TABLET), matchMedia(LANDSCAPE_PHONE)];
}

function subscribe(onChange: () => void): () => void {
  const lists = queries().filter((list) => list.addEventListener);
  for (const list of lists) list.addEventListener("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange);
  };
}

function subscribePhone(onChange: () => void): () => void {
  if (typeof matchMedia !== "function") return () => undefined;
  const list = matchMedia(LANDSCAPE_PHONE);
  if (!list.addEventListener) return () => undefined;
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/**
 * True while the screen is a phone held sideways, where height is the scarce thing and what the
 * game does not need every moment (the goal) folds into an icon. A tablet has the room.
 */
export function useLandscapePhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => (typeof matchMedia === "function" ? matchMedia(LANDSCAPE_PHONE).matches : false),
    () => false,
  );
}

/** True while the screen is held sideways, tablet or phone: the world beside your controls. Follows a turn of the device. */
export function useSideBySide(): boolean {
  return useSyncExternalStore(subscribe, () => queries().some((list) => list.matches), () => false);
}
