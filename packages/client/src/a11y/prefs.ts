/**
 * Accessibility settings, per device (#262): the part that has to run before first paint.
 *
 * A setting is an attribute on <html>, and every rule that honours one is CSS keyed off it
 * (styles/theme.css), so no component forks on a setting:
 *
 *   data-text="large" | "largest"   text size (--kad-text-scale)
 *   data-contrast="high"            stronger ink, borders and focus ring
 *   data-motion="reduced"           the blanket motion flattening in theme.css, and the JS checks
 *   data-hand="right" | "left"      one-handed play: the corner controls drop to the thumb
 *   data-focus="tv"                 TV focus: a Party Mode phone shows only what there is to tap
 *                                   (layout/tv-focus.ts; the shell decides where it applies)
 *
 * The device's own preference is the floor, never overridden: `prefers-contrast: more` and
 * `prefers-reduced-motion: reduce` turn their attribute on whatever was stored, and a stored
 * "on" adds to them. This file is small on purpose; the panel that edits these lives in a lazy
 * chunk (./index.ts), because nobody can open it before the first paint.
 */

export const A11Y_KEY = "kad.a11y";

export type TextSize = "normal" | "large" | "largest";
export type Hand = "off" | "right" | "left";

export interface A11yPrefs {
  text: TextSize;
  /** Always high contrast, on top of the device preference. */
  contrast: boolean;
  /** Always reduced motion, on top of the device preference. */
  motion: boolean;
  hand: Hand;
  /** TV focus: the shared screen tells the story, the phone shows only the thing to do now. */
  focus: boolean;
}

export const DEFAULT_PREFS: A11yPrefs = { text: "normal", contrast: false, motion: false, hand: "off", focus: false };

const TEXT_SIZES: readonly TextSize[] = ["normal", "large", "largest"];
const HANDS: readonly Hand[] = ["off", "right", "left"];

/** What this device remembered, tolerating private mode, a missing key and anything hand-edited. */
export function loadPrefs(): A11yPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(A11Y_KEY) ?? "null") as Partial<A11yPrefs> | null;
    if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
    return {
      text: TEXT_SIZES.includes(raw.text as TextSize) ? (raw.text as TextSize) : "normal",
      contrast: raw.contrast === true,
      motion: raw.motion === true,
      hand: HANDS.includes(raw.hand as Hand) ? (raw.hand as Hand) : "off",
      focus: raw.focus === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: A11yPrefs): void {
  try {
    localStorage.setItem(A11Y_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode: the setting holds for this visit only */
  }
}

function deviceAsks(query: string): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia(query).matches;
  } catch {
    return false;
  }
}

export const deviceWantsContrast = (): boolean => deviceAsks("(prefers-contrast: more)");
export const deviceWantsLessMotion = (): boolean => deviceAsks("(prefers-reduced-motion: reduce)");

function setAttribute(root: HTMLElement, name: string, value: string | null): void {
  if (value === null) root.removeAttribute(name);
  else root.setAttribute(name, value);
}

/** Puts the settings on <html>. Cheap and idempotent, so every change just calls it. */
export function applyPrefs(prefs: A11yPrefs, root: HTMLElement = document.documentElement): void {
  setAttribute(root, "data-text", prefs.text === "normal" ? null : prefs.text);
  setAttribute(root, "data-contrast", prefs.contrast || deviceWantsContrast() ? "high" : null);
  setAttribute(root, "data-motion", prefs.motion || deviceWantsLessMotion() ? "reduced" : null);
  setAttribute(root, "data-hand", prefs.hand === "off" ? null : prefs.hand);
  setAttribute(root, "data-focus", prefs.focus ? "tv" : null);
  // The one setting React reads (TV focus changes what renders, not just how it looks).
  try {
    root.ownerDocument.dispatchEvent(new Event(PREFS_EVENT));
  } catch {
    /* no DOM events: the attribute is still right */
  }
}

/** Fired on the document whenever the settings are applied. */
export const PREFS_EVENT = "kad:a11y";

/** Applies what was saved, and keeps following the device's own preferences while the page is open. */
export function startA11y(): void {
  applyPrefs(loadPrefs());
  if (typeof matchMedia !== "function") return;
  for (const query of ["(prefers-contrast: more)", "(prefers-reduced-motion: reduce)"]) {
    try {
      matchMedia(query).addEventListener("change", () => applyPrefs(loadPrefs()));
    } catch {
      /* an old webview: the saved setting still applies */
    }
  }
}

/**
 * Whether motion effects should be skipped, for the effects CSS cannot reach (the roll, the
 * cutscene, the tap pop). The attribute covers the device preference and the setting together;
 * the query is kept as a second source so the answer is right before `startA11y` has run.
 */
export function reducedMotion(): boolean {
  return (typeof document !== "undefined" && document.documentElement.getAttribute("data-motion") === "reduced")
    || deviceWantsLessMotion();
}
