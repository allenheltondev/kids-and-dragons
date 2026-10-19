/**
 * What a crash report may say, and the scrubbing that keeps a kid out of it (#317).
 *
 * The client scrubs before it sends; the server runs the same functions again
 * before it logs, because a report is whatever arrives on the wire, not what
 * our reporter meant to send. Both ends import this file, so there is one
 * definition of "looks like a name, a code or a token".
 *
 * Nothing here knows who anyone is. A name is only recognizable if the caller
 * hands it in (`known`, which the client does from the room it is in), so the
 * shape rules are deliberately blunt: quoted text is dropped wholesale, since
 * that is where an engine puts a value it is complaining about (`reading
 * 'Maya'`) and where a kid's typing would land.
 */

export const CLIENT_ERROR_LAYOUTS = ["phone", "tv", "tablet", "other"] as const;
export type ClientErrorLayout = (typeof CLIENT_ERROR_LAYOUTS)[number];

export const BROWSER_FAMILIES = ["chrome", "safari", "firefox", "edge", "samsung", "other"] as const;
export type BrowserFamily = (typeof BROWSER_FAMILIES)[number];

/** The route's shape: room codes are never in it. */
export const CLIENT_ERROR_ROUTES = ["/", "/journal", "/tv/:code", "/p/:code", "/what-we-store", "other"] as const;
export type ClientErrorRoute = (typeof CLIENT_ERROR_ROUTES)[number];

/** A report as it is sent, and as it is logged. */
export interface ClientErrorReport {
  message: string;
  /** Frames in our own bundle only, one `file:line:col` per entry. */
  stack: string[];
  /** The build that crashed. */
  version: string;
  route: ClientErrorRoute;
  layout: ClientErrorLayout;
  browser: BrowserFamily;
  /** Random per page load. Ties one page's reports together, and nothing else. */
  id: string;
}

export const MAX_MESSAGE = 300;
export const MAX_FRAMES = 10;
const MAX_VERSION = 40;

/* Regex literals only: a top-level `new RegExp` is a side effect, and keeps this file in every bundle. */
/** Order matters: tokens and emails go first, so a quote never hides half of one. */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // `kaddev.<anything>` (a dev-auth token), and `Bearer <token>`.
  [/\bkaddev\.[^\s"'`,;)]+/gi, "[token]"],
  [/\bBearer\s+[^\s"'`,;)]+/gi, "Bearer [token]"],
  // JWT-shaped: three dot-separated base64url runs.
  [/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[token]"],
  // Any other long opaque run: a device, session or viewer token.
  [/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g, "[token]"],
  [/[^\s@"'<>()[\]]+@[^\s@"'<>()[\]]+\.[A-Za-z]{2,}/g, "[email]"],
  // A query string or fragment on a URL or path: `?token=`, `?code=`, `#...`.
  [/\?[\w%.~-]+=[^\s)"'`]*/g, ""],
  [/(?<=[\w/])#[^\s)"'`]+/g, ""],
  // A path that carries a room code: `/p/ABCD`, `/tv/abcdef`, `/api/room/ABCD/join`.
  [/(?<=\/(?:p|tv|room)\/)[A-Za-z0-9]{4,6}(?![A-Za-z0-9])/gi, ":code"],
  // Typed text, or anything an engine quotes back at us. An apostrophe inside a
  // word (`can't`) never opens a quote.
  [/(?<![\p{L}\p{N}])(["'`])(?:(?!\1).){0,200}?\1(?![\p{L}\p{N}])/gu, "[text]"],
  // A bare room code: four letters, or a visitor's six, in capitals.
  [/(?<![A-Za-z0-9])(?:[A-Z0-9]{4}|[A-Z0-9]{6})(?![A-Za-z0-9])/g, "[code]"],
];

/**
 * `text` with everything that could name a kid or open a door removed.
 * `known` is every name the page knows (display names, hero names): they are
 * replaced wherever they appear as a word, whatever their case.
 */
export function scrubText(text: string, known: readonly string[] = [], max = MAX_MESSAGE): string {
  let out = text.slice(0, max * 4);
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  for (const name of known) {
    const trimmed = name.trim();
    if (trimmed.length < 2) continue;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), "[name]");
  }
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}

const FRAME = /(\/(?:bundle|src)\/[\w./-]+?\.(?:m?js|tsx?)):(\d+):(\d+)/;

/**
 * The frames of a stack that are in our own files, as `file:line:col`. Browsers
 * disagree on the line format, so this looks for the location and ignores the
 * rest: function names and origins are left behind.
 */
export function ourFrames(stack: string): string[] {
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    const match = FRAME.exec(line);
    if (match) frames.push(`${match[1]}:${match[2]}:${match[3]}`);
    if (frames.length === MAX_FRAMES) break;
  }
  return frames;
}

/** A path as its shape: room codes never appear, and unknown pages are `other`. */
export function routeShape(path: string): ClientErrorRoute {
  const [, first = "", second] = path.split("?")[0]!.split("#")[0]!.split("/");
  if (first === "") return second === undefined ? "/" : "other";
  if (first === "journal" || first === "what-we-store") return `/${first}`;
  if (first === "tv" || first === "p") return `/${first}/:code`;
  return "other";
}

/** The browser family a user agent names. */
export function browserFamily(userAgent: string): BrowserFamily {
  if (/\bEdg(?:e|A|iOS)?\//.test(userAgent)) return "edge";
  if (/SamsungBrowser\//.test(userAgent)) return "samsung";
  if (/\b(?:Firefox|FxiOS)\//.test(userAgent)) return "firefox";
  if (/\b(?:Chrome|CriOS|Chromium)\//.test(userAgent)) return "chrome";
  if (/\bSafari\//.test(userAgent)) return "safari";
  return "other";
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown, otherwise: T): T {
  return allowed.includes(value as T) ? (value as T) : otherwise;
}

/**
 * A report from the wire, or null when it is not one. Every field is checked
 * against its shape, free text is scrubbed, and anything else the sender
 * included is dropped, so what comes out is all there is to log.
 */
export function scrubReport(raw: unknown, known: readonly string[] = []): ClientErrorReport | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (typeof body.message !== "string") return null;

  const frames = Array.isArray(body.stack) ? body.stack.slice(0, MAX_FRAMES) : [];
  const version = typeof body.version === "string" ? body.version : "";
  const id = typeof body.id === "string" ? body.id : "";
  return {
    message: scrubText(body.message, known),
    // Re-derived from the sender's frames, so only a location can get through.
    stack: frames.flatMap((f) => (typeof f === "string" ? ourFrames(f.slice(0, 200)).slice(0, 1) : [])),
    version: /^[\w.-]{1,40}$/.test(version) ? version.slice(0, MAX_VERSION) : "unknown",
    route: oneOf(CLIENT_ERROR_ROUTES, body.route, "other"),
    layout: oneOf(CLIENT_ERROR_LAYOUTS, body.layout, "other"),
    browser: oneOf(BROWSER_FAMILIES, body.browser, "other"),
    id: /^[a-f0-9]{8,32}$/.test(id) ? id : "unknown",
  };
}
