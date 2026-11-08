/**
 * Whether this phone's Camp panel is open (docs/camp.md §3; #620), and the
 * first-session choice a kid skipped (§5.3). Tiny stores rather than React
 * state, so a Camp button anywhere on the page opens the one panel the player
 * pane renders, and so Begin can close it from anywhere.
 */

type Listener = () => void;

/**
 * Where to open the panel: one hero's tent, decorations or look (the "Try it on" of a piece's
 * news). The hero, because one kid may play several, each with her own editors in the panel.
 */
export interface CampFocus {
  hero: string;
  part: "tent" | "decor" | "look";
}

let open = false;
let focus: CampFocus | null = null;
const listeners = new Set<Listener>();
const emit = (): void => {
  for (const listener of [...listeners]) listener();
};

export const campPanelOpen = (): boolean => open;

/** Open the panel, at `at` if given (scrolled to it once it is drawn: `takeCampFocus`). */
export function openCampPanel(at?: CampFocus): void {
  focus = at ?? null;
  if (open) return;
  open = true;
  emit();
}

/** Where the panel was asked to open, once: the panel takes it as it opens. */
export function takeCampFocus(): CampFocus | null {
  const at = focus;
  focus = null;
  return at;
}

export function closeCampPanel(): void {
  if (!open) return;
  open = false;
  emit();
}

export function onCampPanel(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// The first-session choice, once per hero on this phone (§5.3)
// ---------------------------------------------------------------------------

const SKIPPED_KEY = "kad.kitWelcome";
/** Remembered in memory too, for a phone whose storage throws (a private window). */
const skippedHere = new Set<string>();

function readSkipped(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(SKIPPED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Whether this phone has already offered the first-session choice for this hero, picked or skipped. */
export function kitWelcomeDone(heroId: string): boolean {
  return skippedHere.has(heroId) || readSkipped().includes(heroId);
}

/** The choice was made or skipped: it is never offered again for this hero here. */
export function finishKitWelcome(heroId: string): void {
  skippedHere.add(heroId);
  try {
    const all = new Set(readSkipped());
    all.add(heroId);
    globalThis.localStorage?.setItem(SKIPPED_KEY, JSON.stringify([...all].slice(-50)));
  } catch {
    // Storage blocked: the memory copy holds for this visit.
  }
  emit();
}
