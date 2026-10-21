/**
 * A TV remote's arrows, on the few controls the shared screen keeps (the corner row, the
 * host's Room panel, the settings sheet). A remote has arrows and OK, not Tab; most TV
 * browsers turn OK into Enter, which a button already answers, but not all of them move
 * focus with the arrows. This does: an arrow moves focus to the nearest control that way,
 * and from nowhere to the first control on screen. The global `:focus-visible` ring shows
 * where it is (styles/theme.css).
 *
 * Only on the shared screen (DisplayExtras installs it). Fields count: the grown-up's
 * sign-in behind "Let visitors join" has an email field and a code field, and a remote has
 * to reach them; while focus is in that sign-in, the arrows stay in it. Inside a field the
 * arrows are the field's own, with two ways out, so a remote is never stuck in it: Up and
 * Down leave a one-line text field (Left and Right still move the caret), and Escape and
 * then any arrow leaves any field. A select, a slider or a group of radios keeps its arrows
 * the same way.
 */

export type Direction = "left" | "right" | "up" | "down";

const KEYS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "summary",
  "input:not([disabled]):not([type='hidden'])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/** One-line text fields, where Up and Down mean nothing and so may leave. */
const ONE_LINE = new Set(["text", "email", "search", "tel", "url", "password", "number"]);

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

/**
 * A radio or checkbox drawn by something else (a card, a chip) and itself hidden away: its
 * drawing is what a person points at, so the arrows skip the box.
 */
function hiddenToggle(el: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement) || (el.type !== "radio" && el.type !== "checkbox")) return false;
  const box = el.getBoundingClientRect();
  return box.width < 4 || box.height < 4 || el.closest(".kad-sr-only") !== null;
}

/** What may take focus now: shown, enabled, and not behind an open sheet (`inert`). */
function candidates(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) =>
      el.closest("[inert]") === null &&
      el.getClientRects().length > 0 &&
      (el.checkVisibility?.() ?? true) &&
      !hiddenToggle(el),
  );
}

function answersArrowsItself(el: Element | null): boolean {
  if (!el) return false;
  if (el.closest("input, textarea, select, [contenteditable='true'], [role='radiogroup'], [role='listbox'], [role='menu'], [role='slider']")) return true;
  return false;
}

/** A one-line text field gives Up and Down to the remote; it keeps Left and Right for the caret. */
function leavesOnUpDown(el: Element | null, direction: Direction): boolean {
  return (direction === "up" || direction === "down") && el instanceof HTMLInputElement && ONE_LINE.has(el.type);
}

/** Move focus one step `direction` from what has it; true if it moved. */
export function step(direction: Direction, doc: Document = document): boolean {
  const active = doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body ? doc.activeElement : null;
  // An open sheet keeps focus in itself (its own Tab trap); so do the arrows. So does a dialog
  // focus is in, such as the grown-up's sign-in over the Room panel: its own Not now and close
  // box are the way out, and the panel's buttons behind it are not.
  const sheet =
    active?.closest<HTMLElement>("[aria-modal='true'], [role='dialog'], [role='alertdialog']") ??
    doc.querySelector<HTMLElement>("[aria-modal='true']");
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
  // The field Escape was pressed in: the next arrow leaves it, whichever arrow it is.
  let escaped: Element | null = null;
  const onKey = (event: KeyboardEvent): void => {
    const active = doc.activeElement;
    if (event.key === "Escape") {
      escaped = answersArrowsItself(active) ? active : null;
      return;
    }
    const direction = KEYS[event.key];
    const leaving = escaped !== null && escaped === active;
    escaped = null;
    if (!direction || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
    if (answersArrowsItself(active) && !leaving && !leavesOnUpDown(active, direction)) return;
    if (step(direction, doc)) event.preventDefault();
  };
  doc.addEventListener("keydown", onKey);
  return () => doc.removeEventListener("keydown", onKey);
}
