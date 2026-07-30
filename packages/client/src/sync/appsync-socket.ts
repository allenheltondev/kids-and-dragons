/**
 * The browser half of the realtime transport — architecture §4.4.
 *
 * `AppSyncEventsChannel` on the server publishes to `room/<code>`; this is what
 * listens. Locally the same job is done by an `EventSource` against the dev
 * server's `/events/<code>`, and both sit behind `EventSourceLike` in
 * `channel.ts` — so the ordering, backoff and resync logic is written once and
 * neither transport knows the other exists.
 *
 * The protocol is a small state machine over a WebSocket, and every step of it
 * is load-bearing:
 *
 *   connect   `wss://<realtime>/event/realtime`, with the auth handed over as a
 *             **subprotocol**, because a browser cannot set headers on a
 *             WebSocket handshake
 *   init      → `connection_init`, ← `connection_ack`
 *   subscribe → `subscribe` naming the channel, ← `subscribe_success`
 *   data      ← `data`, whose `event` is the exact string the server published
 *
 * `onopen` is deliberately not raised until `subscribe_success`. The socket
 * being up is not the same as being subscribed, and treating it as such would
 * make `openChannel` reset its backoff and resync against a room it is not yet
 * receiving from — which looks like a healthy connection that silently misses
 * every patch.
 */

import type { EventSourceLike } from "./channel";

export interface AppSyncSocketOptions {
  /** `abc123.appsync-api.<region>.amazonaws.com` — the signing/host domain. */
  httpDomain: string;
  /** `abc123.appsync-realtime-api.<region>.amazonaws.com`. */
  realtimeDomain: string;
  /** The channel namespace the API is configured with. `room`. */
  namespace: string;
  roomCode: string;
  /**
   * A room session token (a player) or a viewer token (the TV). The Lambda
   * authorizer accepts either and checks that it names *this* room.
   */
  token: string;
  /** Injected by tests. */
  createWebSocket?: (url: string, protocols: string[]) => WebSocketLike;
  newId?: () => string;
}

/** Just enough of `WebSocket`. */
export interface WebSocketLike {
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  send(data: string): void;
  close(): void;
}

/** The `aws-appsync-event-ws` protocol name, plus the auth-bearing one. */
const WS_PROTOCOL = "aws-appsync-event-ws";

/**
 * How long to sit in total silence before declaring the socket dead. AppSync
 * sends `ka` keepalives on the cadence its `connection_ack` names (usually
 * every minute against a 5-minute timeout), so a healthy connection is never
 * quiet for long — but a half-open one (phone slept, hotspot swapped, NAT
 * timed out) stays "connected" forever, receives nothing, and never fires
 * `onclose`. The `connection_ack`'s own `connectionTimeoutMs` replaces this
 * default when present; the fallback is deliberately generous so a slow but
 * live link is never killed by us.
 */
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;

export function channelPath(namespace: string, roomCode: string): string {
  return `/${namespace}/${roomCode.toUpperCase()}`;
}

/**
 * Builds the factory `openChannel` calls. The `url` it passes is the SSE one and
 * is ignored: this transport addresses a channel, not a path.
 */
export function appSyncEventSource(
  options: AppSyncSocketOptions,
): (url: string) => EventSourceLike {
  return () => connect(options);
}

function connect(options: AppSyncSocketOptions): EventSourceLike {
  const auth = { host: options.httpDomain, Authorization: options.token };
  const create =
    options.createWebSocket ??
    ((url: string, protocols: string[]) => new WebSocket(url, protocols) as unknown as WebSocketLike);
  const newId = options.newId ?? (() => crypto.randomUUID());

  const adapter: EventSourceLike = { onopen: null, onerror: null, onmessage: null, close };

  const subscriptionId = newId();
  const channel = channelPath(options.namespace, options.roomCode);
  let closed = false;
  let opened = false;

  /*
   * The auth rides in a second subprotocol because the browser WebSocket API
   * offers no way to set a header on the handshake. AppSync reads the token out
   * of `header-<base64url(json)>`, and the padding has to go — `=` is not legal
   * in a subprotocol name, and a padded value fails the handshake with nothing
   * more useful than a close event.
   */
  const socket = create(`wss://${options.realtimeDomain}/event/realtime`, [
    WS_PROTOCOL,
    `header-${b64url(JSON.stringify(auth))}`,
  ]);

  // The silence watchdog. Reset by *every* inbound frame — data and `ka`
  // alike — and fatal when it fires: `fail` hands the socket to `openChannel`,
  // whose existing backoff reconnects.
  let idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const clearWatchdog = (): void => {
    if (watchdog !== null) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  };

  const armWatchdog = (): void => {
    clearWatchdog();
    if (closed) return;
    watchdog = setTimeout(() => {
      fail(new Error(`no frame received in ${String(idleTimeoutMs)}ms — connection presumed dead`));
    }, idleTimeoutMs);
  };

  const fail = (reason: unknown): void => {
    clearWatchdog();
    if (closed) return;
    // One error shape out, whatever went wrong: `openChannel` reconnects with
    // backoff and does not care why.
    adapter.onerror?.(reason);
  };

  socket.onopen = () => {
    armWatchdog();
    try {
      socket.send(JSON.stringify({ type: "connection_init" }));
    } catch (err) {
      fail(err);
    }
  };

  socket.onmessage = (event) => {
    // Any frame at all proves the link is alive.
    armWatchdog();

    let message: { type?: string; event?: unknown; errors?: unknown; connectionTimeoutMs?: unknown };
    try {
      message = JSON.parse(event.data) as typeof message;
    } catch {
      return; // not ours to interpret
    }

    switch (message.type) {
      case "connection_ack":
        // The ack names how long AppSync itself will tolerate silence; trust
        // it over our default and re-arm on the new deadline.
        if (typeof message.connectionTimeoutMs === "number" && message.connectionTimeoutMs > 0) {
          idleTimeoutMs = message.connectionTimeoutMs;
          armWatchdog();
        }
        socket.send(
          JSON.stringify({
            type: "subscribe",
            id: subscriptionId,
            channel,
            // Repeated per subscribe: the connection's auth admits you to the
            // API, this admits you to one room (see channel-authorizer.ts).
            authorization: auth,
          }),
        );
        return;

      case "subscribe_success":
        opened = true;
        adapter.onopen?.(message);
        return;

      case "data":
        // `event` is the string the server published — pass it through
        // untouched so `parseChannelMessage` is the only thing that decodes.
        if (typeof message.event === "string") adapter.onmessage?.({ data: message.event });
        return;

      case "ka":
        return; // keepalive

      case "connection_error":
      case "subscribe_error":
        fail(message.errors ?? message);
        return;

      default:
        return;
    }
  };

  socket.onerror = (event) => {
    fail(event);
  };

  socket.onclose = (event) => {
    /*
     * Every close is an error to `openChannel`, which backs off and retries.
     * A close *before* `subscribe_success` is usually auth — an expired room, a
     * revoked device, a token for someone else's room — and a close after it is
     * usually the network. They are worth telling apart in a log and not worth
     * telling apart in the reconnect, which is the same either way.
     */
    if (!opened) console.warn(`[channel] closed before subscribing to ${channel}`);
    fail(event);
  };

  function close(): void {
    closed = true;
    clearWatchdog();
    adapter.onopen = null;
    adapter.onmessage = null;
    adapter.onerror = null;
    try {
      socket.close();
    } catch {
      /* already gone */
    }
  }

  return adapter;
}

function b64url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
