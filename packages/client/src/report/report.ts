/**
 * Builds a crash report, scrubs it and sends it to our own endpoint (#317).
 * A lazy chunk: `listen.ts` loads it when something is first thrown.
 *
 * What is in a report is `ClientErrorReport` and nothing else. The scrubbing
 * lives in `@kad/shared` and runs again on the server; this side adds what
 * only the page knows, the names of the kids and heroes in front of it.
 */

import {
  browserFamily,
  ourFrames,
  routeShape,
  scrubReport,
  type ClientErrorLayout,
  type ClientErrorReport,
} from "@kad/shared";
import { loadIdentity } from "../store/persistence";
import { useGameStore } from "../store";

/** One page's reports tell one story; past this a loop is not adding to it. */
const MAX_PER_PAGE = 5;

const pageId = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
const sent = new Set<string>();

function layoutFor(path: string): ClientErrorLayout {
  if (path.startsWith("/tv/")) return "tv";
  return Math.min(screen.width, screen.height) >= 600 ? "tablet" : "phone";
}

/** Everything the page knows that is a name, or opens a door. */
function knownNames(): string[] {
  const names: string[] = [];
  try {
    const { state, session } = useGameStore.getState();
    for (const member of state?.party ?? []) names.push(member.character.name);
    for (const seat of Object.values(state?.seats ?? {})) names.push(seat.name);
    if (session) names.push(session.roomCode, session.sessionToken);
    const me = loadIdentity();
    names.push(me.displayName, me.deviceToken ?? "");
  } catch {
    // Whatever cannot be read is scrubbed by its shape instead.
  }
  return names;
}

export function report(thrown: unknown): void {
  try {
    const error = thrown instanceof Error ? thrown : undefined;
    const raw = {
      message: error ? `${error.name}: ${error.message}` : String(thrown),
      stack: error?.stack ? ourFrames(error.stack) : [],
      version: import.meta.env.VITE_KAD_BUILD,
      route: routeShape(location.pathname),
      layout: layoutFor(location.pathname),
      browser: browserFamily(navigator.userAgent),
      id: pageId,
    };
    const body: ClientErrorReport | null = scrubReport(raw, knownNames());
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
