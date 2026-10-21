/**
 * A TV remote's arrows, on the few controls the shared screen keeps (the corner row, the
 * host's Room panel, the settings sheet). A remote has arrows and OK, not Tab; most TV
 * browsers turn OK into Enter, which a button already answers, but not all of them move
 * focus with the arrows. This does: an arrow moves focus to the nearest control that way,
 * and from nowhere to the first control on screen. The global `:focus-visible` ring shows
 * where it is (styles/theme.css).
 *
 * Only on the shared screen (DisplayExtras installs it), and never inside something that
 * answers arrows itself: a text field, a select, or a group of radios.
 */

export type Direction = "left" | "right" | "up" | "down";

const KEYS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

const FOCUSABLE = "button:not([disabled]), a[href], summary, [tabindex]:not([tabindex='-1'])";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The nearest box from `from` in `direction`, by distance along the way plus twice the
 * distance across it, so a control straight ahead beats a nearer one off to the side.
 * -1 when nothing lies that way.
 */
export function nearest(from: Box, boxes: Box[], direction: Direction): number {
  const cx = (from.left + from.right) / 2;
  const cy = (from.top + from.bottom) / 2;
  let best = -1;
  let bestScore = Infinity;
  boxes.forEach((box, i) => {
    const bx = (box.left + box.right) / 2;
    const by = (box.top + box.bottom) / 2;
    const along =
      direction === "left" ? from.left - box.right
        : direction === "right" ? box.left - from.right
          : direction === "up" ? from.top - box.bottom
            : box.top - from.bottom;
    // Overlapping boxes count as ahead when their centre is.
    const ahead =
      direction === "left" ? bx < cx
        : direction === "right" ? bx > cx
          : direction === "up" ? by < cy
            : by > cy;
    if (!ahead) return;
    const across = direction === "left" || direction === "right" ? Math.abs(by - cy) : Math.abs(bx - cx);
    const score = Math.max(0, along) + 2 * across;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** What may take focus now: shown, enabled, and not behind an open sheet (`inert`). */
function candidates(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.closest("[inert]") === null && el.getClientRects().length > 0 && (el.checkVisibility?.() ?? true),
  );
}

function answersArrowsItself(el: Element | null): boolean {
  if (!el) return false;
  if (el.closest("input, textarea, select, [contenteditable='true'], [role='radiogroup'], [role='listbox'], [role='menu'], [role='slider']")) return true;
  return false;
}

/** Move focus one step `direction` from what has it; true if it moved. */
export function step(direction: Direction, doc: Document = document): boolean {
  const active = doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body ? doc.activeElement : null;
  // An open sheet keeps focus in itself (its own Tab trap); so do the arrows.
  const sheet = active?.closest<HTMLElement>("[aria-modal='true']") ?? doc.querySelector<HTMLElement>("[aria-modal='true']");
  const all = candidates(sheet ?? doc);
  if (all.length === 0) return false;
  if (!active || !all.includes(active)) {
    all[0]!.focus();
    return true;
  }
  const others = all.filter((el) => el !== active);
  const at = nearest(active.getBoundingClientRect(), others.map((el) => el.getBoundingClientRect()), direction);
  if (at < 0) return false;
  others[at]!.focus();
  return true;
}

/** Listen for the arrows on this screen; returns the way to stop. */
export function installRemoteFocus(doc: Document = document): () => void {
  const onKey = (event: KeyboardEvent): void => {
    const direction = KEYS[event.key];
    if (!direction || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
    if (answersArrowsItself(doc.activeElement)) return;
    if (step(direction, doc)) event.preventDefault();
  };
  doc.addEventListener("keydown", onKey);
  return () => doc.removeEventListener("keydown", onKey);
}
