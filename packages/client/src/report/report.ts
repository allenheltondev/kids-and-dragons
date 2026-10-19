/**
 * Builds a crash report and sends it to our own endpoint (#317). A lazy chunk:
 * `listen.ts` loads it when something is first thrown.
 *
 * What is in a report is `ClientErrorReport` and nothing else, and the
 * exception's own message is not in it: only the kind of failure it was
 * (`diagnose`). That holds before anything has loaded, because it never reads
 * the page's state. The server checks every field again.
 */

import {
  browserFamily,
  diagnose,
  ourFrames,
  routeShape,
  scrubReport,
  type ClientErrorLayout,
  type ClientErrorReport,
} from "@kad/shared";

/** One page's reports tell one story; past this a loop is not adding to it. */
const MAX_PER_PAGE = 5;

const pageId = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
const sent = new Set<string>();

function layoutFor(path: string): ClientErrorLayout {
  if (path.startsWith("/tv/")) return "tv";
  return Math.min(screen.width, screen.height) >= 600 ? "tablet" : "phone";
}

export function report(thrown: unknown): void {
  try {
    const error = thrown instanceof Error ? thrown : undefined;
    const raw = {
      message: diagnose(error?.name ?? "", error ? error.message : String(thrown)),
      stack: error?.stack ? ourFrames(error.stack) : [],
      version: import.meta.env.VITE_KAD_BUILD,
      route: routeShape(location.pathname),
      layout: layoutFor(location.pathname),
      browser: browserFamily(navigator.userAgent),
      id: pageId,
    };
    const body: ClientErrorReport | null = scrubReport(raw);
    if (!body) return;
    const key = `${body.message}|${body.stack[0] ?? ""}`;
    if (sent.has(key) || sent.size >= MAX_PER_PAGE) return;
    sent.add(key);
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Never throw from the thing that handles throwing.
  }
}
