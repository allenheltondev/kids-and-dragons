/**
 * Visually hidden, still announced.
 *
 * The board is a canvas and the canvas is `aria-hidden` — everything happening
 * in the world has to reach assistive tech as text. This is also where the
 * `speak()` seam (roadmap, cross-cutting) will eventually read from, so
 * narration and status changes belong here even when the sighted UI already
 * shows them.
 */

import type { ReactNode } from "react";

export interface ScreenReaderOnlyProps {
  children: ReactNode;
  /** Announce changes as they happen rather than only on focus. */
  live?: "off" | "polite" | "assertive";
  as?: "span" | "div";
}

export function ScreenReaderOnly({
  children,
  live = "off",
  as: Tag = "span",
}: ScreenReaderOnlyProps): React.JSX.Element {
  return (
    <Tag className="kad-sr-only" aria-live={live === "off" ? undefined : live}>
      {children}
    </Tag>
  );
}
