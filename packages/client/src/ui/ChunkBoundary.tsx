/**
 * What a lazy chunk that fails to load looks like (#329), instead of a blank
 * page. Without a boundary, a rejected `import()` throws during render and
 * React unmounts the whole tree: one blocked sound chunk ended a game that
 * was already playing.
 *
 *   quiet     an optional control (the corner row, a decoration): draws its
 *             `fallback` or nothing, and tries again when the signal is back.
 *   inline    a required part of a screen: a small message and Try again.
 *   otherwise a required screen: the same, in the middle of the page.
 *
 * Try again imports the chunk again (`lazyChunk`). Two failures only a
 * reload can clear: the chunk is gone, because a deploy deleted it
 * (scripts/deploy.sh syncs with --delete), or it is there but a chunk it
 * imports failed, which the browser keeps under that chunk's own address. A
 * reload loses nothing (the room code is in the URL, the session in
 * localStorage), and it happens once per chunk per tab, so a chunk that
 * stays broken cannot loop the page.
 *
 * In the first paint, so it stays small.
 */

import { Component, createElement, lazy, type ComponentProps, type ComponentType, type ReactElement, type ReactNode } from "react";
import { Button } from "./Button";

/** The chunk a failed import names: Chrome and Firefox say which, and so does Vite's CSS preload. */
const CHUNK_URL = /\S+\.(?:js|css|tsx?)\b/;

const chunkUrl = (error: unknown) => CHUNK_URL.exec(String((error as Error | undefined)?.message))?.[0];

/**
 * Each failed chunk's address to import it from now. A browser keeps a failed
 * import's failure for good, under its URL, so asking again needs another one;
 * every importer of the chunk shares it, so the module still loads once.
 */
const fresh = new Map<string, string>();

function importAgain(url: string): Promise<unknown> {
  let next = fresh.get(url);
  if (!next) fresh.set(url, (next = `${url}?retry=${Date.now()}`));
  const tried = next;
  return import(/* @vite-ignore */ tried).catch((error: unknown) => {
    if (fresh.get(url) === tried) fresh.delete(url);
    throw error;
  });
}

/**
 * How many times a boundary has asked for another try. React renders a lazy
 * component again when its import settles, failed or not, so a failure is
 * retried only once a boundary has asked since: never on its own, in a loop.
 */
let asked = 0;

/**
 * `lazy()`, except that a failed import is tried again once a boundary asks:
 * React keeps a rejected `lazy` forever, so this hands it a new one.
 */
export function lazyChunk<M, C extends ComponentType<any>>(
  load: () => Promise<M>,
  pick: (module: M) => C,
): (props: ComponentProps<C>) => ReactElement {
  let failed: { error: unknown; at: number } | undefined;
  const make = (error?: unknown) => lazy(async () => {
    try {
      // A script that failed is asked for under a new address; anything else
      // (a stylesheet Vite preloads) is not cached as failed, so the same import.
      const url = error === undefined ? undefined : chunkUrl(error);
      const named = url && !url.endsWith(".css") ? ((await importAgain(url)) as M) : undefined;
      const component = named === undefined ? undefined : pick(named);
      if (component !== undefined) return { default: component };
      try {
        return { default: pick(await load()) };
      } catch (thrown: unknown) {
        // The address named a chunk this one imports, not this one: that
        // chunk is back, but the browser keeps this one's failure for good
        // under the address only `load` knows. A reload asks for it again
        // (this runs only after a boundary asked, so never in a loop).
        if (named !== undefined && url && reloadOnce(url)) return new Promise<never>(() => undefined);
        throw thrown;
      }
    } catch (thrown: unknown) {
      failed = { error: thrown, at: asked };
      throw thrown;
    }
  });
  let Lazy = make();
  return (props: ComponentProps<C>) => {
    if (failed && asked > failed.at) {
      Lazy = make(failed.error);
      failed = undefined;
    }
    return createElement(Lazy, props);
  };
}

/** At most once per chunk per tab: the guard against a reload loop. */
function reloadOnce(key: string): boolean {
  try {
    key = `kad-chunk-reload:${key}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
  } catch {
    return false;
  }
  location.reload();
  return true;
}

interface Props {
  children: ReactNode;
  /** What could not load, for a kid and the grown-up beside them. Required chunks only. */
  message?: string;
  inline?: boolean;
  /** An optional chunk: no message, just `fallback`. */
  quiet?: boolean;
  fallback?: ReactNode;
  /** The alert's own class: a page fills `kad-boot` by default. */
  className?: string;
  /** Beside Try again, such as a way to close what could not open. */
  extra?: ReactNode;
}

export class ChunkBoundary extends Component<Props, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  private pressed = 0;
  private readonly again = () => {
    if (!this.state.error) return;
    asked++;
    this.setState({ error: null });
  };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    // A caught error never reaches the window `error` event the reporter
    // listens for (report/listen.ts, #322), so hand it there.
    globalThis.reportError?.(error);
  }

  override componentDidMount(): void {
    if (this.props.quiet) addEventListener("online", this.again);
  }

  override componentWillUnmount(): void {
    removeEventListener("online", this.again);
  }

  private readonly retry = async () => {
    const url = chunkUrl(this.state.error);
    // A browser that does not say which chunk (Safari) gets one plain retry first.
    if (!url) {
      if (this.pressed++ > 0 && reloadOnce(location.pathname)) return;
      this.again();
      return;
    }
    const status = await fetch(url, { method: "HEAD", cache: "no-store" }).then((r) => r.status, () => 0);
    if (status >= 400 && status < 500) {
      // Gone: a deploy deleted it.
      if (reloadOnce(url)) return;
    } else if (status >= 200 && status < 300 && !url.endsWith(".css")) {
      // There, so can this page still load it? Not if a chunk it imports
      // failed: the browser keeps that failure too, under an address only a
      // reload asks for again.
      if (!(await importAgain(url).then(() => true, () => false)) && reloadOnce(url)) return;
    }
    // Otherwise unreachable (no signal), or now loadable: try in place.
    this.again();
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.quiet) return this.props.fallback ?? null;
    const message = (
      <div className="kad-chunk-error">
        <p>{this.props.message ?? "This part of the game couldn’t load."}</p>
        <p>Check the Wi-Fi, then tap Try again.</p>
        <Button onClick={() => { void this.retry(); }}>Try again</Button>
        {this.props.extra}
      </div>
    );
    return <div className={this.props.className ?? (this.props.inline ? undefined : "kad-boot")} role="alert">{message}</div>;
  }
}
