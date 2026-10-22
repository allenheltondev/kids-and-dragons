/**
 * A tablet held sideways: the screen kids reach for first (an iPad on a lap,
 * both thumbs on the edges).
 *
 * The phone shells put one surface on the screen at a time and the tray along
 * the bottom, because a phone has neither the width for two panes nor the
 * height to spare. A landscape tablet has the width and is short on height, so
 * it gets the opposite: the tray becomes a rail down the side (components.css)
 * and the world, or the map, sits beside your own controls instead of behind
 * them.
 *
 * The CSS repeats this query (a media query cannot read a variable); keep the
 * two in step. Wide enough for two panes, tall enough for the rail's five
 * objects and the corner row under them, and landscape, so a phone on its side
 * (430px tall) and a tablet held upright both keep the phone layout.
 */

import { useSyncExternalStore } from "react";

export const LANDSCAPE_TABLET = "(orientation: landscape) and (min-width: 900px) and (min-height: 560px)";

function query(): MediaQueryList | null {
  return typeof matchMedia === "function" ? matchMedia(LANDSCAPE_TABLET) : null;
}

function subscribe(onChange: () => void): () => void {
  const list = query();
  if (!list?.addEventListener) return () => undefined;
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/** True while the screen is a landscape tablet: the world beside your controls. Follows a turn of the tablet. */
export function useSideBySide(): boolean {
  return useSyncExternalStore(subscribe, () => query()?.matches ?? false, () => false);
}
