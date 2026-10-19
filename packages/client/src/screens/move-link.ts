/**
 * A scanned move code (#251) arrives as `/?move=…`. It is a one-time code, so
 * the link is taken off the URL only once the code is safely recorded in the
 * organizer store. That store is a lazy chunk, and a chunk can fail to load
 * (offline, or a deploy mid-session). Until it loads, the link stays where a
 * refresh will find it again.
 */

export interface MoveLinkStore {
  setPendingMove(code: string): void;
}

export interface MoveLinkDeps {
  /** Reads and rewrites the address bar. */
  location: { href: string };
  replaceUrl(url: string): void;
  /** Fetches the organizer store. */
  load(): Promise<MoveLinkStore>;
  /** Waits between tries. */
  wait(ms: number): Promise<void>;
}

/** The code in `?move=`, as typed into the organizer panel, or null if there is none. */
export function moveCodeIn(href: string): string | null {
  const move = new URL(href).searchParams.get("move");
  if (!move) return null;
  const code = move.toUpperCase().replace(/[^A-Z]/g, "");
  return code || null;
}

/**
 * Records the link's code and only then takes it off the URL. The chunk is
 * asked for up to `tries` times. On a final failure it returns null and the
 * link stays put, for a refresh to try again.
 */
export async function takeMoveLink(deps: MoveLinkDeps, tries = 3): Promise<string | null> {
  const code = moveCodeIn(deps.location.href);
  if (!code) return null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const store = await deps.load();
      store.setPendingMove(code);
      const url = new URL(deps.location.href);
      url.searchParams.delete("move");
      deps.replaceUrl(`${url.pathname}${url.search}${url.hash}`);
      return code;
    } catch {
      if (attempt < tries) await deps.wait(500 * attempt);
    }
  }
  return null;
}
