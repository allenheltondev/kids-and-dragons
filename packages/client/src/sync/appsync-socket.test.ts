/**
 * The AppSync Events transport.
 *
 * This exists because the first cut of the AWS work shipped a server that
 * published to AppSync and a browser that still opened an `EventSource` against
 * a route no Lambda served. Everything passed — locally the SSE transport was
 * the only one exercised, and in production every client would have 404ed
 * forever and silently never applied a patch.
 *
 * So the handshake is asserted step by step, and the one that matters most is
 * that `onopen` waits for `subscribe_success`: a socket being up is not the
 * same as being subscribed, and treating it as such is how you get a connection
 * that looks healthy and receives nothing.
 */

import { describe, expect, it, vi } from "vitest";
import { appSyncEventSource, channelPath, type WebSocketLike } from "./appsync-socket";
import type { EventSourceLike } from "./channel";

const OPTIONS = {
  httpDomain: "abc.appsync-api.us-east-1.amazonaws.com",
  realtimeDomain: "abc.appsync-realtime-api.us-east-1.amazonaws.com",
  namespace: "room",
  roomCode: "ABCD",
  token: "tok_session",
};

interface Fake {
  socket: WebSocketLike;
  url: string;
  protocols: string[];
  sent: string[];
  closed: number;
}

function setup(): { source: EventSourceLike; fake: Fake; events: string[]; errors: unknown[] } {
  const fake = { sent: [] as string[], closed: 0 } as Fake;

  const socket: WebSocketLike = {
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send: (data: string) => fake.sent.push(data),
    close: () => {
      fake.closed += 1;
    },
  };
  fake.socket = socket;

  const create = appSyncEventSource({
    ...OPTIONS,
    createWebSocket: (url, protocols) => {
      fake.url = url;
      fake.protocols = protocols;
      return socket;
    },
    newId: () => "sub_1",
  });

  const source = create("/events/ABCD?sinceSeq=0");
  const events: string[] = [];
  const errors: unknown[] = [];
  source.onmessage = (e) => events.push(e.data);
  source.onerror = (e) => errors.push(e);
  return { source, fake, events, errors };
}

/** Deliver a server frame. */
function deliver(fake: Fake, message: unknown): void {
  fake.socket.onmessage?.({ data: JSON.stringify(message) });
}

function parseSent(fake: Fake, index: number): Record<string, unknown> {
  return JSON.parse(fake.sent[index] ?? "{}") as Record<string, unknown>;
}

describe("channelPath", () => {
  it("namespaces and upper-cases the room", () => {
    expect(channelPath("room", "abcd")).toBe("/room/ABCD");
  });
});

describe("the handshake", () => {
  it("carries auth in a subprotocol, because a browser cannot set a header", () => {
    const { fake } = setup();

    expect(fake.url).toBe("wss://abc.appsync-realtime-api.us-east-1.amazonaws.com/event/realtime");
    expect(fake.protocols[0]).toBe("aws-appsync-event-ws");

    const header = fake.protocols[1] ?? "";
    expect(header.startsWith("header-")).toBe(true);
    // `=` is not legal in a subprotocol name, and a padded value fails the
    // handshake with nothing more informative than a close event.
    expect(header).not.toContain("=");

    const decoded = JSON.parse(
      Buffer.from(header.slice("header-".length), "base64url").toString("utf8"),
    ) as { host: string; Authorization: string };
    expect(decoded).toEqual({
      host: OPTIONS.httpDomain,
      Authorization: "tok_session",
    });
  });

  it("sends connection_init once the socket is up", () => {
    const { fake } = setup();
    expect(fake.sent).toEqual([]);

    fake.socket.onopen?.({});
    expect(parseSent(fake, 0)).toEqual({ type: "connection_init" });
  });

  it("subscribes to this room, and only this room, after the ack", () => {
    const { fake } = setup();
    fake.socket.onopen?.({});
    deliver(fake, { type: "connection_ack", connectionTimeoutMs: 300000 });

    expect(parseSent(fake, 1)).toEqual({
      type: "subscribe",
      id: "sub_1",
      channel: "/room/ABCD",
      // Repeated per subscribe: connection auth admits you to the API, this
      // admits you to one room.
      authorization: { host: OPTIONS.httpDomain, Authorization: "tok_session" },
    });
  });

  it("does not report open until the subscription is confirmed", () => {
    const { source, fake } = setup();
    const opened = vi.fn();
    source.onopen = opened;

    fake.socket.onopen?.({});
    // The socket is up. We are not subscribed. Reporting open here would make
    // openChannel reset its backoff and resync against a room it is not
    // receiving from.
    expect(opened).not.toHaveBeenCalled();

    deliver(fake, { type: "connection_ack" });
    expect(opened).not.toHaveBeenCalled();

    deliver(fake, { type: "subscribe_success", id: "sub_1" });
    expect(opened).toHaveBeenCalledOnce();
  });
});

describe("messages", () => {
  it("passes the published payload through untouched", () => {
    const { fake, events } = setup();
    fake.socket.onopen?.({});
    deliver(fake, { type: "connection_ack" });
    deliver(fake, { type: "subscribe_success", id: "sub_1" });

    const published = JSON.stringify({
      kind: "patch",
      seq: 7,
      runId: "r_1",
      patch: [{ op: "replace", path: "/seq", value: 7 }],
    });
    deliver(fake, { type: "data", id: "sub_1", event: published });

    // Exactly the string the server published — `parseChannelMessage` is the
    // only thing that decodes it, in either transport.
    expect(events).toEqual([published]);
  });

  it("ignores keepalives and anything it does not recognise", () => {
    const { fake, events, errors } = setup();
    fake.socket.onopen?.({});
    deliver(fake, { type: "connection_ack" });
    deliver(fake, { type: "subscribe_success", id: "sub_1" });

    deliver(fake, { type: "ka" });
    deliver(fake, { type: "something_new" });
    fake.socket.onmessage?.({ data: "not json at all" });

    expect(events).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe("failures", () => {
  it("reports a refused connection", () => {
    const { fake, errors } = setup();
    fake.socket.onopen?.({});
    deliver(fake, { type: "connection_error", errors: [{ errorType: "UnauthorizedException" }] });
    expect(errors).toHaveLength(1);
  });

  it("reports a refused subscription", () => {
    // The shape of "your token names a different room" — the authorizer's
    // whole job (channel-authorizer.ts).
    const { fake, errors } = setup();
    fake.socket.onopen?.({});
    deliver(fake, { type: "connection_ack" });
    deliver(fake, { type: "subscribe_error", id: "sub_1", errors: [{ errorType: "Forbidden" }] });
    expect(errors).toHaveLength(1);
  });

  it("reports a close so openChannel can back off and retry", () => {
    const { fake, errors } = setup();
    fake.socket.onopen?.({});
    deliver(fake, { type: "connection_ack" });
    deliver(fake, { type: "subscribe_success", id: "sub_1" });

    fake.socket.onclose?.({ code: 1006 });
    expect(errors).toHaveLength(1);
  });
});

describe("close", () => {
  it("closes the socket and goes quiet", () => {
    const { source, fake, events, errors } = setup();
    fake.socket.onopen?.({});
    deliver(fake, { type: "connection_ack" });
    deliver(fake, { type: "subscribe_success", id: "sub_1" });

    source.close();
    expect(fake.closed).toBe(1);

    // A frame in flight when the room was left must not resurrect the surface,
    // and a close event must not schedule a reconnect for a channel nobody
    // wants any more.
    deliver(fake, { type: "data", id: "sub_1", event: "{}" });
    fake.socket.onclose?.({ code: 1000 });
    expect(events).toEqual([]);
    expect(errors).toEqual([]);
  });
});
