/**
 * Installing Kids & Dragons (epic #410, #412): what this browser can do about
 * it, decided from what it says about itself. Pure, so every rule is a test.
 *
 * Two ways to install exist, and only two get words. A Chromium browser that
 * fired `beforeinstallprompt` has an Install button we can press for it.
 * Safari on an iPhone or iPad has none: a grown-up taps Share, then Add to Home
 * Screen. Everywhere else says nothing, rather than promise a button that some
 * browser does not have.
 *
 * Installed is not the same as "has played". On an iPhone or iPad a Home
 * Screen app can start with storage of its own, empty, apart from Safari's, so
 * the hero that phone made in Safari is not there. `needsFirstLaunchChoice`
 * says when to ask about that before anything makes a new one.
 */

/** How this browser installs, as far as we will say. */
export type InstallWay = "prompt" | "ios-share" | "none";

/** The parts of `window` and `navigator` the rules below read. */
export interface InstallEnv {
  userAgent: string;
  maxTouchPoints?: number;
  /** Safari's own flag, set in a Home Screen app on iOS and iPadOS. */
  standalone?: boolean;
  matchMedia?: (query: string) => { matches: boolean };
}

/** The live browser's, read without throwing where there is no window (tests, SSR). */
export function browserEnv(): InstallEnv {
  if (typeof window === "undefined" || typeof navigator === "undefined") return { userAgent: "" };
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints,
    ...(typeof nav.standalone === "boolean" ? { standalone: nav.standalone } : {}),
    ...(typeof window.matchMedia === "function" ? { matchMedia: (query: string) => window.matchMedia(query) } : {}),
  };
}

/** Opened from the home screen or the app list, in a window of its own. */
export function isStandalone(env: InstallEnv): boolean {
  if (env.standalone === true) return true;
  try {
    return env.matchMedia?.("(display-mode: standalone)").matches === true;
  } catch {
    return false;
  }
}

/**
 * An iPhone, iPod or iPad. iPadOS asks for desktop sites by default and calls
 * itself a Mac; a Mac has no touch screen, so touch points tell them apart.
 */
export function isAppleTouch(env: InstallEnv): boolean {
  if (/iPhone|iPad|iPod/.test(env.userAgent)) return true;
  return /Macintosh/.test(env.userAgent) && (env.maxTouchPoints ?? 0) > 1;
}

/*
 * Safari itself, not another browser on the same engine. Chrome, Firefox and
 * Edge on iOS name themselves, and an app's built-in browser drops "Version/".
 * Their Add to Home Screen, where there is one, is somewhere else.
 */
const NOT_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo|FBAN|FBAV|Instagram|Line\//;

/** Safari on an iPhone or iPad. */
export function isIosSafari(env: InstallEnv): boolean {
  return isAppleTouch(env) && /Version\/[\d.]+.*Safari\//.test(env.userAgent) && !NOT_SAFARI.test(env.userAgent);
}

/** The way to install we can describe here, given whether a prompt is waiting. */
export function installWay(env: InstallEnv, promptReady: boolean): InstallWay {
  if (promptReady) return "prompt";
  if (isIosSafari(env)) return "ios-share";
  return "none";
}

/**
 * The home screen's install card. The route is the caller's: only the personal
 * home draws it, never the TV or a room.
 */
export function installCardVisible(input: { standalone: boolean; dismissed: boolean; way: InstallWay }): boolean {
  return !input.standalone && !input.dismissed && input.way !== "none";
}

/**
 * Ask "played in Safari before?" before this storage is anybody: opened as an
 * app, with no device identity of any kind (not a player's, not a TV's, not a
 * family tablet's), and nobody has answered yet. Pairing answers by leaving a
 * player token; "Start fresh" answers by being remembered.
 */
export function needsFirstLaunchChoice(input: {
  standalone: boolean;
  hasIdentity: boolean;
  sharedDevice: boolean;
  answered: boolean;
}): boolean {
  return input.standalone && !input.hasIdentity && !input.sharedDevice && !input.answered;
}

/** What the browser a hero came from is called in the words we show. */
export function browserName(env: InstallEnv): string {
  return isAppleTouch(env) ? "Safari" : "your browser";
}
