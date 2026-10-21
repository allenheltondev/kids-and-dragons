/**
 * A TV remote's arrows, on the few controls the shared screen keeps (the corner row, the
 * host's Room panel, the settings sheet). A remote has arrows and OK, not Tab; most TV
 * browsers turn OK into Enter, which a button already answers, but not all of them move
 * focus with the arrows. This does: an arrow moves focus to the nearest control that way,
 * and from nowhere to the first control on screen. The global `:focus-visible` ring shows
 * where it is (styles/theme.css).
 *
 * Always on the shared screen. On the start screen, where a TV hosts its room, it waits for a
 * remote to show itself: an arrow pressed with nothing focused, which is how a remote begins and
 * not how a keyboard does (it Tabs first; a screen reader keeps its arrows). Until then the start
 * screen is exactly as it was for every keyboard (App installs it, a lazy chunk off the first
 * paint). Fields count: the grown-up's
 * sign-in behind "Let visitors join" has an email field and a code field, and a remote has
 * to reach them; while focus is in that sign-in, the arrows stay in it. Inside a field the
 * arrows are the field's own, with two ways out, so a remote is never stuck in it: Up and
 * Down leave a one-line text field (Left and Right still move the caret), and Escape and
 * then any arrow leaves any field. A select, a slider or a listbox keeps its arrows the same
 * way. In a group of radios (the start screen's Party Mode and Phone Mode) selection follows
 * focus, as a browser's own radio arrows do: an arrow to the next radio of the same name checks
 * it. Past the group's last radio that way the arrow leaves the group, where a browser would wrap
 * round, so a remote is never caught in it. Those radios are hidden inside the cards that draw
 * them, so the card's box is where a radio stands, and OK (Enter) checks it, as Space would.
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

function isToggle(el: Element | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox");
}

/**
 * Where a control stands for the arrows. A radio or checkbox hidden away inside what draws it (a
 * card, a chip: its label) stands where that is, since that is what a person looks at. null for a
 * hidden one with nothing drawing it, which the arrows skip.
 */
function standsAt(el: HTMLElement): DOMRect | null {
  const box = el.getBoundingClientRect();
  if (!isToggle(el) || (box.width >= 4 && box.height >= 4 && el.closest(".kad-sr-only") === null)) return box;
  const label = el.labels?.[0] ?? null;
  return label ? label.getBoundingClientRect() : null;
}

/** What may take focus now: shown, enabled, and not behind an open sheet (`inert`). */
function candidates(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) =>
      el.closest("[inert]") === null &&
      el.getClientRects().length > 0 &&
      (el.checkVisibility?.() ?? true) &&
      standsAt(el) !== null,
  );
}

function answersArrowsItself(el: Element | null): boolean {
  if (!el || isToggle(el)) return false;
  if (el.closest("input, textarea, select, [contenteditable='true'], [role='radiogroup'], [role='listbox'], [role='menu'], [role='slider']")) return true;
  return false;
}

/** A one-line text field gives Up and Down to the remote; it keeps Left and Right for the caret. */
function leavesOnUpDown(el: Element | null, direction: Direction): boolean {
  return (direction === "up" || direction === "down") && el instanceof HTMLInputElement && ONE_LINE.has(el.type);
}

/** The control whose box is closest to `place`, centre to centre. */
function closestTo(place: Box, els: HTMLElement[]): HTMLElement {
  const cx = (place.left + place.right) / 2;
  const cy = (place.top + place.bottom) / 2;
  let best = els[0]!;
  let bestDistance = Infinity;
  for (const el of els) {
    const box = standsAt(el)!;
    const distance = Math.hypot((box.left + box.right) / 2 - cx, (box.top + box.bottom) / 2 - cy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = el;
    }
  }
  return best;
}

/**
 * Move focus one step `direction` from what has it; true if it moved. With nothing focused, the
 * first arrow lands on the control nearest `lastPlace` (where focus last stood, when OK replaced
 * the control it was on: Host a game opening its card), or on the first control.
 */
export function step(direction: Direction, doc: Document = document, lastPlace: Box | null = null): boolean {
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
    (lastPlace ? closestTo(lastPlace, all) : all[0]!).focus();
    return true;
  }
  const others = all.filter((el) => el !== active);
  const at = nearest(standsAt(active)!, others.map((el) => standsAt(el)!), direction);
  // Inside a group of radios, the next one that way first, and selection follows focus.
  const group = active instanceof HTMLInputElement && active.type === "radio" && active.name !== ""
    ? others.filter((el) => el instanceof HTMLInputElement && el.type === "radio" && el.name === active.name && el.form === active.form)
    : [];
  const inGroup = group.length > 0 ? nearest(standsAt(active)!, group.map((el) => standsAt(el)!), direction) : -1;
  if (inGroup >= 0) {
    const next = group[inGroup]!;
    next.focus();
    next.click();
    return true;
  }
  if (at < 0) return false;
  others[at]!.focus();
  return true;
}

/**
 * Listen for the arrows on this screen; returns the way to stop. `armed: false` waits for a remote
 * to show itself (an arrow with nothing focused) before it takes any key.
 */
export function installRemoteFocus(doc: Document = document, { armed = true }: { armed?: boolean } = {}): () => void {
  let on = armed;
  // The field Escape was pressed in: the next arrow leaves it, whichever arrow it is.
  let escaped: Element | null = null;
  // Where focus last stood, for when what had it goes away under it.
  let lastPlace: Box | null = null;
  const onFocus = (event: FocusEvent): void => {
    if (event.target instanceof HTMLElement) lastPlace = standsAt(event.target);
  };
  const onKey = (event: KeyboardEvent): void => {
    const active = doc.activeElement;
    if (!on) {
      const nothing = active === null || active === doc.body || active === doc.documentElement;
      if (!(event.key in KEYS) || !nothing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      on = true;
    }
    if (event.key === "Escape") {
      escaped = answersArrowsItself(active) ? active : null;
      return;
    }
    // OK on a radio or checkbox checks it, as Space does; a remote has no Space.
    if (event.key === "Enter" && isToggle(active) && !event.defaultPrevented) {
      escaped = null;
      event.preventDefault();
      active.click();
      return;
    }
    const direction = KEYS[event.key];
    const leaving = escaped !== null && escaped === active;
    escaped = null;
    if (!direction || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
    if (answersArrowsItself(active) && !leaving && !leavesOnUpDown(active, direction)) return;
    if (step(direction, doc, lastPlace)) event.preventDefault();
  };
  doc.addEventListener("keydown", onKey);
  doc.addEventListener("focusin", onFocus);
  return () => {
    doc.removeEventListener("keydown", onKey);
    doc.removeEventListener("focusin", onFocus);
  };
}
