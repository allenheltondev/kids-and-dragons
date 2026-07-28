/**
 * `LocalSseChannel` — the dev implementation of the transport seam,
 * architecture §4.4.
 *
 * Prod publishes to an AppSync Events channel named `room/<code>`; locally we
 * hold the fan-out in process and push it to browsers over Server-Sent Events.
 * SSE is the right dev transport for this protocol specifically because the
 * protocol is one-directional: clients send intents over HTTP POST and only
 * ever *receive* on the channel (§4.1). No socket bookkeeping, no upgrade
 * dance, and a phone that drops off Wi-Fi reconnects on its own.
 *
 * Every subscriber (in-process listener or SSE response) is attached to exactly
 * one room code, and each room keeps a **bounded replay buffer** so a client
 * that reconnects within a few seconds catches up from `Last-Event-ID` without
 * touching DynamoDB. The durable answer for a bigger gap is `GET /state`
 * (§4.3) — this buffer is an optimisation, never the source of truth.
 */

import type { ChannelMessage, RoomChannel, Unsubscribe } from "@kad/shared";

/** Just enough of `http.ServerResponse` to write an SSE stream to it. */
export interface SseSink {
  writeHead(status: number, headers: Record<string, string>): unknown;
  write(chunk: string): unknown;
  end(): unknown;
  on(event: "close", listener: () => void): unknown;
}

export interface LocalSseChannelOptions {
  /** Messages retained per room for reconnect replay. */
  replayLimit?: number;
  /** Comment-frame interval; keeps proxies and phone radios from idling out. */
  heartbeatMs?: number;
}

interface Room {
  /** Ascending by seq; snapshots are not buffered, only patches. */
  buffer: ChannelMessage[];
  listeners: Set<(m: ChannelMessage) => void>;
}

const DEFAULT_REPLAY_LIMIT = 100;
const DEFAULT_HEARTBEAT_MS = 15_000;

export class LocalSseChannel implements RoomChannel {
  private readonly rooms = new Map<string, Room>();
  private readonly replayLimit: number;
  private readonly heartbeatMs: number;

  constructor(options: LocalSseChannelOptions = {}) {
    this.replayLimit = options.replayLimit ?? DEFAULT_REPLAY_LIMIT;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  }

  async publish(roomCode: string, message: ChannelMessage): Promise<void> {
    const room = this.room(roomCode);
    if (message.kind === "patch") {
      room.buffer.push(message);
      if (room.buffer.length > this.replayLimit) {
        room.buffer.splice(0, room.buffer.length - this.replayLimit);
      }
    }
    // Copy the listener set: a handler may unsubscribe itself (a phone that
    // just disconnected) while we are iterating.
    for (const listener of [...room.listeners]) {
      try {
        listener(message);
      } catch (err) {
        // One broken subscriber must never fail the publish for the others —
        // the TV going away mid-encounter cannot stop the phones updating.
        console.warn(`[channel] subscriber threw on room ${roomCode}: ${String(err)}`);
      }
    }
  }

  subscribe(roomCode: string, onMessage: (m: ChannelMessage) => void): Unsubscribe {
    const room = this.room(roomCode);
    room.listeners.add(onMessage);
    return () => {
      room.listeners.delete(onMessage);
      this.gc(roomCode);
    };
  }

  /**
   * Buffered patches with `seq > sinceSeq`, or `null` when the buffer cannot
   * prove it covers the gap — the caller must then send a full snapshot.
   */
  replay(roomCode: string, sinceSeq: number): ChannelMessage[] | null {
    const room = this.rooms.get(roomCode);
    if (!room) return null;
    const first = room.buffer[0];
    if (!first) return [];
    if (first.seq > sinceSeq + 1) return null; // buffer already rolled past the gap
    return room.buffer.filter((m) => m.seq > sinceSeq);
  }

  /**
   * Attaches an HTTP response as an SSE subscriber. Returns the unsubscribe so
   * the route can also drop it on server shutdown.
   *
   * A `preamble` (the snapshot a client gets on connect) is written before any
   * replayed patch, which is the whole reason it is passed in here rather than
   * written by the caller afterwards: a patch published between reading the
   * snapshot and attaching would otherwise reach the client *before* the
   * snapshot that it applies on top of, and be lost.
   */
  attach(
    roomCode: string,
    sink: SseSink,
    options: { sinceSeq?: number; preamble?: ChannelMessage } = {},
  ): Unsubscribe {
    sink.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and friends buffer text/event-stream by default, which turns a
      // 50ms round trip into seconds. Say so explicitly.
      "X-Accel-Buffering": "no",
    });
    // Tell the browser to back off before retrying; the default is 3s.
    sink.write("retry: 1000\n\n");

    const send = (message: ChannelMessage): void => {
      // `id:` is what the browser echoes back as Last-Event-ID after a drop,
      // so it must be the seq the client has applied — §4.3.
      //
      // Deliberately *unnamed* (no `event:` field). A named SSE event only
      // reaches an `addEventListener` for that name — `onmessage` never sees
      // it — so naming these would mean every transport adapter has to know
      // the message kinds up front. `ChannelMessage.kind` already carries the
      // discriminator inside the payload, where the ordering logic reads it.
      sink.write(`id: ${message.seq}\ndata: ${JSON.stringify(message)}\n\n`);
    };

    if (options.preamble) send(options.preamble);
    if (options.sinceSeq !== undefined) {
      const missed = this.replay(roomCode, options.sinceSeq);
      for (const message of missed ?? []) send(message);
    }

    const unsubscribe = this.subscribe(roomCode, send);
    const heartbeat = setInterval(() => sink.write(": ping\n\n"), this.heartbeatMs);
    heartbeat.unref?.();

    let closed = false;
    const detach = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    sink.on("close", detach);
    return detach;
  }

  /** Live subscriber count, for `/api/health` and tests. */
  subscriberCount(roomCode: string): number {
    return this.rooms.get(roomCode)?.listeners.size ?? 0;
  }

  roomCodes(): string[] {
    return [...this.rooms.keys()];
  }

  private room(roomCode: string): Room {
    let room = this.rooms.get(roomCode);
    if (!room) {
      room = { buffer: [], listeners: new Set() };
      this.rooms.set(roomCode, room);
    }
    return room;
  }

  /** Drop rooms nobody is listening to and that hold nothing to replay. */
  private gc(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (room && room.listeners.size === 0 && room.buffer.length === 0) {
      this.rooms.delete(roomCode);
    }
  }
}
