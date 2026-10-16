/**
 * A byte-counting proxy for the performance spec (e2e/perf.spec.ts).
 *
 * It sits between the browser and the production server and counts every
 * response body that crosses it — including the ones the service worker
 * fetches for itself, which Playwright's page-level network events never see.
 * That makes it the honest measure of "what this phone downloaded".
 *
 * Not a spec (no `.spec.`), so Playwright does not collect it.
 */

import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** What a request was for, by path — the categories the report is broken into. */
export type Kind = "page" | "bundle" | "content" | "rig" | "art" | "audio" | "api" | "worker" | "other";

export function kindOf(path: string): Kind {
  if (path.startsWith("/api/") || path.startsWith("/events/")) return "api";
  if (path === "/sw.js") return "worker";
  if (path.startsWith("/bundle/")) return "bundle";
  if (path.startsWith("/content/")) return "content";
  if (path.endsWith(".riv")) return "rig";
  if (/\.(?:webm|ogg|mp3|m4a|wav)$/.test(path)) return "audio";
  if (/\.(?:webp|png|jpe?g|gif|svg|avif|ico)$/.test(path)) return "art";
  if (!path.includes(".")) return "page";
  return "other";
}

export interface Tally {
  requests: number;
  /** Responses that carried a body (200), as opposed to a 304 or an error. */
  bodies: number;
  /** Bytes of response body. */
  bytes: number;
  /** Which paths came down with a body — what to look at when a number is wrong. */
  downloaded: string[];
}

export type Report = Record<Kind, Tally>;

function emptyReport(): Report {
  const kinds: Kind[] = ["page", "bundle", "content", "rig", "art", "audio", "api", "worker", "other"];
  return Object.fromEntries(kinds.map((kind) => [kind, { requests: 0, bodies: 0, bytes: 0, downloaded: [] }])) as Report;
}

export interface CountingProxy {
  readonly url: string;
  /** Everything counted since the last `reset()`. */
  report(): Report;
  reset(): void;
  /** Resolves once nothing but the event stream has been in flight for `quietMs`. */
  settled(quietMs?: number, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export interface ProxyOptions {
  /**
   * Paths whose bytes the proxy changes on the way through (one extra byte on
   * the end) — a CDN edge serving something other than what the build
   * fingerprinted. The worker must serve it and must never save it.
   */
  tamper?: (path: string) => boolean;
}

export async function startCountingProxy(target: string, options: ProxyOptions = {}): Promise<CountingProxy> {
  const upstream = new URL(target);
  let tally = emptyReport();
  let inFlight = 0;
  let lastActivity = Date.now();

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? "/", "http://proxy").pathname;
    const kind = kindOf(path);
    // The event stream stays open for the whole game; it is not "loading".
    const tracked = !path.startsWith("/events/");
    if (tracked) inFlight += 1;
    lastActivity = Date.now();
    tally[kind].requests += 1;

    const forward = request(
      {
        host: upstream.hostname,
        port: upstream.port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: upstream.host },
      },
      (reply) => {
        const tampered = reply.statusCode === 200 && options.tamper?.(path) === true;
        const headers = { ...reply.headers };
        if (tampered) {
          // The length changes, so the framing does too.
          delete headers["content-length"];
          delete headers["etag"];
        }
        res.writeHead(reply.statusCode ?? 502, headers);
        if (reply.statusCode === 200) {
          tally[kind].bodies += 1;
          tally[kind].downloaded.push(path);
        }
        reply.on("data", (chunk: Buffer) => {
          tally[kind].bytes += chunk.length;
          lastActivity = Date.now();
        });
        reply.pipe(res, { end: !tampered });
        reply.on("end", () => {
          if (tampered) res.end(Buffer.from([0]));
          if (tracked) inFlight -= 1;
          lastActivity = Date.now();
        });
      },
    );
    forward.on("error", () => {
      if (tracked) inFlight -= 1;
      res.writeHead(502).end();
    });
    req.pipe(forward);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://localhost:${String(port)}`,
    report: () => structuredClone(tally),
    reset: () => {
      tally = emptyReport();
    },
    async settled(quietMs = 2_500, timeoutMs = 60_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (inFlight === 0 && Date.now() - lastActivity >= quietMs) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(`network never settled (${String(inFlight)} in flight)`);
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** The report as a table, for the run log. */
export function formatReport(title: string, report: Report): string {
  const rows = Object.entries(report)
    .filter(([, tally]) => tally.requests > 0)
    .map(([kind, tally]) =>
      `  ${kind.padEnd(8)} ${String(tally.requests).padStart(4)} req  ${String(tally.bodies).padStart(4)} bodies  ${(tally.bytes / 1024).toFixed(0).padStart(7)} KB`,
    );
  const total = Object.values(report).reduce((sum, tally) => sum + tally.bytes, 0);
  const trips = Object.values(report).reduce((sum, tally) => sum + tally.requests, 0);
  return [`${title}: ${(total / 1024).toFixed(0)} KB in ${String(trips)} round trips`, ...rows].join("\n");
}
