/**
 * The realtime half of the sync protocol (architecture §4.2–§4.4).
 *
 * Two pieces, deliberately separated so the hard part has no I/O in it:
 *
 *   MessageSequencer — pure. Owns `seq`, applies JSON Patches in order, buffers
 *                      anything early, and reports a hole it cannot fill.
 *   openChannel      — the EventSource wiring, backoff, and resync calls.
 *
 * The transport is behind `EventSourceLike` for the same reason the server's
 * `RoomChannel` exists (architecture §4.4): swapping SSE for AppSync Events or
 * Momento should mean writing one adapter, not rewriting ordering logic.
 */

import { applyPatch } from "fast-json-patch";
import type { Operation } from "fast-json-patch";
import type { ChannelMessage, Presentation, RunState, ServerMessage } from "@kad/shared";
import type { ConnectionStatus, PresentationEvent } from "../store/contract";

/**
 * Plays a presentation and resolves when it is done.
 *
 * Registered by whichever surface renders the world; nothing else installs one.
 * With a gate, the patch is applied *after* the animation, which is what makes
 * the TV show the die landing before the HP changes. Without one — a Party Mode
 * phone — the patch lands immediately and presentation is ignored entirely
 * (architecture §4.2). Neither surface has to know which case it is in.
 */
export type PresentationGate = (event: PresentationEvent) => Promise<void> | void;

export interface SequencerHandlers {
  /** A new authoritative mirror. Always a fresh object; never mutated in place. */
  onState(state: RunState, seq: number): void;
  onPresentation(event: PresentationEvent): void;
  /** A hole that did not fill in time. Resync from `sinceSeq`. */
  onGap(sinceSeq: number): void;
}

export type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface SequencerOptions {
  handlers: SequencerHandlers;
  gate?: PresentationGate | null;
  /**
   * How long to wait for a missing seq before giving up and resyncing. SSE is
   * ordered, so a hole almost always means loss rather than reordering — but
   * waiting a beat costs nothing and avoids a resync storm on a flaky LTE hop.
   */
  gapTimeoutMs?: number;
  schedule?: (fn: () => void, ms: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
}

export class MessageSequencer {
  private readonly handlers: SequencerHandlers;
  private readonly gapTimeoutMs: number;
  private readonly schedule: (fn: () => void, ms: number) => TimerHandle;
  private readonly cancel: (handle: TimerHandle) => void;

  private gate: PresentationGate | null;
  private mirror: RunState | null = null;
  private lastSeq = 0;
  private readonly buffer = new Map<number, ServerMessage>();
  private gapTimer: TimerHandle | null = null;
  private draining = false;
  private disposed = false;

  constructor(options: SequencerOptions) {
    this.handlers = options.handlers;
    this.gate = options.gate ?? null;
    this.gapTimeoutMs = options.gapTimeoutMs ?? 750;
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get seq(): number {
    return this.lastSeq;
  }

  get state(): RunState | null {
    return this.mirror;
  }

  /** Pending out-of-order messages. Exposed for tests and diagnostics. */
  get buffered(): number[] {
    return [...this.buffer.keys()].sort((a, b) => a - b);
  }

  setGate(gate: PresentationGate | null): void {
    this.gate = gate;
  }

  /** Seed or replace the mirror from a snapshot (join, or a too-large gap). */
  reset(state: RunState, seq: number): void {
    this.mirror = state;
    this.lastSeq = seq;
    for (const key of [...this.buffer.keys()]) {
      if (key <= seq) this.buffer.delete(key);
    }
    this.clearGapTimer();
    this.handlers.onState(state, seq);
    this.drain();
  }

  ingest(message: ChannelMessage): void {
    if (this.disposed) return;

    if (message.kind === "snapshot") {
      // A snapshot always wins: it is the server's own view, not a delta.
      if (message.seq >= this.lastSeq) this.reset(message.state, message.seq);
      return;
    }

    // Duplicates and replays of already-applied events are ignored outright.
    if (message.seq <= this.lastSeq) return;

    this.buffer.set(message.seq, message);
    this.drain();
  }

  /** Replay a batch of missed events from `GET /api/state?sinceSeq=N`. */
  ingestAll(messages: ServerMessage[]): void {
    for (const message of messages) this.ingest({ kind: "patch", ...message });
  }

  dispose(): void {
    this.disposed = true;
    this.clearGapTimer();
    this.buffer.clear();
  }

  private drain(): void {
    if (this.draining || this.disposed) return;

    for (;;) {
      const next = this.buffer.get(this.lastSeq + 1);
      if (!next || this.mirror === null) break;

      this.buffer.delete(next.seq);

      const gated = this.emitPresentation(next.presentation, next.seq);
      if (gated) {
        // Hold the patch until the animation finishes, then keep draining.
        this.draining = true;
        void gated.then(
          () => this.resume(next),
          () => this.resume(next), // a broken animation must never stall state
        );
        return;
      }

      this.apply(next);
    }

    this.armGapTimer();
  }

  private resume(message: ServerMessage): void {
    this.draining = false;
    if (this.disposed) return;
    /*
     * The world can move while an animation plays. A reconnect or a resync can
     * land a snapshot mid-gate, and that snapshot already contains this patch —
     * applying it again would duplicate an `add` into an array, throw on a
     * `remove`, and walk `lastSeq` backwards. A patch is only ever valid as the
     * very next step from where the mirror actually is.
     */
    if (message.seq === this.lastSeq + 1) this.apply(message);
    this.drain();
  }

  private apply(message: ServerMessage): void {
    if (this.mirror === null) return;
    // mutateDocument: false — React needs a new reference, and a half-applied
    // patch must never be observable.
    const result = applyPatch(this.mirror, message.patch as Operation[], false, false);
    this.mirror = result.newDocument;
    this.lastSeq = message.seq;
    this.handlers.onState(this.mirror, this.lastSeq);
  }

  private emitPresentation(
    presentation: Presentation | undefined,
    seq: number,
  ): Promise<void> | null {
    if (!presentation) return null;
    const event: PresentationEvent = { seq, presentation };
    this.handlers.onPresentation(event);
    if (!this.gate) return null;
    const result = this.gate(event);
    return result instanceof Promise ? result : null;
  }

  private armGapTimer(): void {
    const hasHole = this.buffer.size > 0;
    if (!hasHole || this.gapTimer !== null) {
      if (!hasHole) this.clearGapTimer();
      return;
    }
    this.gapTimer = this.schedule(() => {
      this.gapTimer = null;
      if (this.disposed || this.buffer.size === 0) return;
      // Still holed. Ask for the missing range rather than guessing.
      this.handlers.onGap(this.lastSeq);
    }, this.gapTimeoutMs);
  }

  private clearGapTimer(): void {
    if (this.gapTimer !== null) {
      this.cancel(this.gapTimer);
      this.gapTimer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Tolerant of a missing `kind`: an older server or a hand-rolled test publisher
 * is inferred from the payload rather than dropped. A message we cannot make
 * sense of returns null and the caller ignores it.
 */
export function parseChannelMessage(raw: string): ChannelMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const candidate = parsed as Partial<ChannelMessage> & {
    state?: RunState;
    patch?: unknown;
  };
  if (typeof candidate.seq !== "number" || typeof candidate.runId !== "string") return null;

  if (candidate.kind === "snapshot" || (candidate.kind === undefined && candidate.state)) {
    if (!candidate.state) return null;
    return { kind: "snapshot", seq: candidate.seq, runId: candidate.runId, state: candidate.state };
  }

  if (!Array.isArray(candidate.patch)) return null;
  const message: ChannelMessage = {
    kind: "patch",
    seq: candidate.seq,
    runId: candidate.runId,
    patch: candidate.patch,
  };
  const presentation = (candidate as ServerMessage).presentation;
  return presentation ? { ...message, presentation } : message;
}

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** Injected for deterministic tests. */
  random?: () => number;
}

/**
 * Exponential with full jitter. Three phones reconnecting off the same dropped
 * hotspot must not retry in lockstep.
 */
export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? 500;
  const max = options.maxMs ?? 15_000;
  const random = options.random ?? Math.random;
  const ceiling = Math.min(max, base * 2 ** Math.max(0, attempt));
  return Math.round(ceiling * (0.5 + 0.5 * random()));
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface EventSourceLike {
  onopen: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  close(): void;
}

export interface ChannelOptions {
  url: (sinceSeq: number) => string;
  sequencer: MessageSequencer;
  onStatus: (status: ConnectionStatus) => void;
  /**
   * Bring the mirror forward from `sinceSeq`. Called on every (re)connect and
   * on a gap. Implemented by the store against `GET /api/state?sinceSeq=N`.
   */
  resync: (sinceSeq: number) => Promise<void>;
  createEventSource?: (url: string) => EventSourceLike;
  backoff?: BackoffOptions;
  schedule?: (fn: () => void, ms: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
}

export interface Channel {
  close(): void;
}

export function openChannel(options: ChannelOptions): Channel {
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((h: TimerHandle) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const create =
    options.createEventSource ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike);

  let source: EventSourceLike | null = null;
  let retryTimer: TimerHandle | null = null;
  let attempt = 0;
  let closed = false;
  /** Serializes resyncs so a gap during a reconnect doesn't double-fetch. */
  let resyncing: Promise<void> | null = null;

  function resync(sinceSeq: number): void {
    if (closed || resyncing) return;
    resyncing = options
      .resync(sinceSeq)
      .catch(() => {
        /* the next reconnect or gap will try again */
      })
      .finally(() => {
        resyncing = null;
      });
  }

  function connect(): void {
    if (closed) return;
    options.onStatus(attempt === 0 ? "connecting" : "reconnecting");

    const es = create(options.url(options.sequencer.seq));
    source = es;

    es.onopen = () => {
      attempt = 0;
      options.onStatus("open");
      // Anything published while we were away is fetched, not waited for
      // (architecture §4.3 — hard-refresh recovery in under a second).
      resync(options.sequencer.seq);
    };

    es.onmessage = (event) => {
      const message = parseChannelMessage(event.data);
      if (message) options.sequencer.ingest(message);
    };

    es.onerror = () => {
      if (closed) return;
      es.close();
      if (source === es) source = null;
      options.onStatus("reconnecting");
      const delay = backoffDelay(attempt, options.backoff);
      attempt += 1;
      retryTimer = schedule(connect, delay);
    };
  }

  connect();

  return {
    close() {
      closed = true;
      if (retryTimer !== null) cancel(retryTimer);
      source?.close();
      source = null;
      options.onStatus("idle");
    },
  };
}
