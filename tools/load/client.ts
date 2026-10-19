/**
 * One HTTP client for the whole run. Everything a simulated phone does goes
 * through `Api.call`, so it is all measured the same way and none of it can
 * reach the store: this file and the base URL are the only way in.
 */

import type { Recorder } from "./metrics.ts";

export interface Reply<T = Record<string, any>> {
  status: number;
  body: T;
  /** `Retry-After` in ms when the server sent one. */
  retryAfterMs: number | undefined;
}

export interface CallOptions {
  /** A room session token, sent as a bearer token. */
  token?: string | undefined;
  /** A device token (`x-kad-device-token`), for what only the device that opened the room may do. */
  deviceToken?: string | undefined;
  body?: unknown;
  /** The route as reported, with the room code and ids taken out: `POST /api/room/:code/join`. */
  route: string;
}

/** Anything we send that identifies the traffic as ours, so it is easy to find in the logs. */
const USER_AGENT = "kad-load/1";
const TIMEOUT_MS = 15_000;

export class Api {
  constructor(
    private readonly baseUrl: string,
    private readonly recorder: Recorder,
  ) {}

  async call<T = Record<string, any>>(method: "GET" | "POST", path: string, options: CallOptions): Promise<Reply<T>> {
    const started = performance.now();
    let status = 0;
    let body: any = {};
    let retryAfterMs: number | undefined;
    try {
      const response = await fetch(new URL(path, this.baseUrl), {
        method,
        headers: {
          "user-agent": USER_AGENT,
          ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
          ...(options.deviceToken ? { "x-kad-device-token": options.deviceToken } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = response.status;
      const retry = Number(response.headers.get("retry-after"));
      if (Number.isFinite(retry) && retry > 0) retryAfterMs = retry * 1000;
      body = await response.json().catch(() => ({}));
    } catch {
      status = 0;
    }
    // A refused action comes back 200 with `ok: false` (architecture §4.2).
    const code = status === 200 && body?.ok === false ? body?.error?.code : undefined;
    this.recorder.record({ route: options.route, status, ms: performance.now() - started, code, at: Date.now() });
    return { status, body: body as T, retryAfterMs };
  }
}
