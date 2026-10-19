/**
 * What a crash report may say, and how it keeps a kid out of it (#317).
 *
 * A report never carries what the exception said. An engine's message can hold
 * anything a page handed it, and a kid's typing is among that, in any shape we
 * would have to recognize. So the message is not scrubbed, it is replaced: the
 * client reduces it to a *kind* of failure (`diagnose`), and the server accepts
 * only one of those exact phrases (`safeMessage`), anything else becoming
 * `Error: other`. Free text cannot reach a log because there is no field for it.
 * Every other field is checked against its own fixed shape, and the stack is
 * only locations in our own bundle.
 *
 * What is lost is the exception's detail; the build, the page, and the top
 * frame (`file:line:col`, through the sourcemap) say where it happened.
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

export const MAX_FRAMES = 10;

/** The exception types a report may name; any other is `Error`. */
const ERROR_NAMES = [
  "Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "EvalError", "URIError",
  "AbortError", "NetworkError", "NotAllowedError", "QuotaExceededError", "SecurityError", "InvalidStateError",
] as const;

/** Failure kinds, each a fixed phrase. The patterns read the message; none of it is kept. */
const KINDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/cannot read propert(?:y|ies) of (?:undefined|null)|undefined is not an object|null is not an object/i, "read a property of nothing"],
  [/is not a function/i, "not a function"],
  [/is not defined/i, "not defined"],
  [/is not iterable/i, "not iterable"],
  [/dynamically imported module|importing a module script failed|loading chunk|chunkloaderror/i, "a chunk failed to load"],
  [/failed to fetch|networkerror|load failed|network request failed/i, "a network request failed"],
  [/resizeobserver loop/i, "resize observer loop"],
  [/maximum call stack|too much recursion/i, "stack overflow"],
  [/unexpected token|unexpected end of json|json/i, "unreadable data"],
  [/^script error\.?$/i, "cross-origin script error"],
  [/webgl|context lost|gpu/i, "graphics unavailable"],
  [/audiocontext|play\(\)|not allowed to start|autoplay/i, "audio blocked"],
  [/quota|storage/i, "storage unavailable"],
  [/minified react error|react/i, "react error"],
];

/** `Name: kind` for an exception, built only from the lists above. */
export function diagnose(name: string, message: string): string {
  const type = (ERROR_NAMES as readonly string[]).includes(name) ? name : "Error";
  const kind = KINDS.find(([pattern]) => pattern.test(message.slice(0, 1000)))?.[1] ?? "other";
  return `${type}: ${kind}`;
}

/** The message as given when it is exactly one `diagnose` can produce, else `Error: other`. */
export function safeMessage(message: unknown): string {
  if (typeof message !== "string") return "Error: other";
  const split = message.indexOf(": ");
  const type = message.slice(0, split);
  const kind = message.slice(split + 2);
  // Not a module-level constant: a top-level call is a side effect that keeps this file in every bundle.
  const known =
    (ERROR_NAMES as readonly string[]).includes(type) && (kind === "other" || KINDS.some(([, phrase]) => phrase === kind));
  return known ? message : "Error: other";
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
 * against its own shape and anything else the sender included is dropped, so
 * what comes out is all there is to log.
 */
export function scrubReport(raw: unknown): ClientErrorReport | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (typeof body.message !== "string") return null;

  const frames = Array.isArray(body.stack) ? body.stack.slice(0, MAX_FRAMES) : [];
  const version = typeof body.version === "string" ? body.version : "";
  const id = typeof body.id === "string" ? body.id : "";
  return {
    message: safeMessage(body.message),
    // Re-derived from the sender's frames, so only a location can get through.
    stack: frames.flatMap((f) => (typeof f === "string" ? ourFrames(f.slice(0, 200)).slice(0, 1) : [])),
    // A commit's short sha, or `dev`; nothing a person could type.
    version: /^(?:dev|[0-9a-f]{7,12})$/.test(version) ? version : "unknown",
    route: oneOf(CLIENT_ERROR_ROUTES, body.route, "other"),
    layout: oneOf(CLIENT_ERROR_LAYOUTS, body.layout, "other"),
    browser: oneOf(BROWSER_FAMILIES, body.browser, "other"),
    id: /^[a-f0-9]{8,32}$/.test(id) ? id : "unknown",
  };
}
