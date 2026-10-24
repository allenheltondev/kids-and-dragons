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

import type { Operation } from "fast-json-patch";
import { cheerById, readIntentPreview } from "@kad/shared";
import type {
  ArrivalMessage,
  CheerMessage,
  ChannelMessage,
  Presentation,
  PreviewMessage,
  RunState,
  ServerMessage,
} from "@kad/shared";
import type {
  ConnectionStatus,
  PresentationEvent,
  ProgressionEvent,
} from "../store/contract";
import { applyPatchShared } from "./apply-patch";

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
  /** Ordered with patches and emitted once per applied server sequence. */
  onProgression(event: ProgressionEvent): void;
  /** A hole that did not fill in time. Resync from `sinceSeq`. */
  onGap(sinceSeq: number): void;
  /**
   * The mirror can no longer be trusted: a patch failed to apply (it no longer
   * fits the mirror it was built for), or the hole-filling buffer overflowed.
   * Replaying events from `seq` would replay the same failure, so only a full
   * snapshot repairs it; until one arrives through `reset`, nothing further is
   * applied on top of the broken mirror.
   */
  onDesync?(seq: number): void;
  /**
   * Field Guide ids a step found for the first time (`ServerMessage.discovered`,
   * #106), emitted once, right after that step's patch is applied. Only live
   * messages carry them — the server keeps them out of the event log — so a
   * snapshot or a replayed gap never emits this.
   */
  onDiscovered?(event: { runId: string; seq: number; canonIds: string[] }): void;
  /**
   * A player's unconfirmed tap (`PreviewMessage`). Handed over the moment it
   * arrives and never ordered: it is not a step of the state, so it neither
   * waits for a gap to fill nor moves `seq`.
   */
  onPreview?(message: PreviewMessage): void;
  /** Somebody joined the room (`ArrivalMessage`, #267). Live, unordered, like a preview. */
  onArrival?(message: ArrivalMessage): void;
  /** A spectator cheered (`CheerMessage`, #388). Live, unordered, like a preview. */
  onCheer?(message: CheerMessage): void;
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

/**
 * Out-of-order messages held while waiting on a hole. A chapter is a few
 * hundred steps; past this many, the hole is not going to fill.
 */
const MAX_BUFFERED = 200;

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
  /** Waiting on a snapshot after `onDesync`; nothing is applied meanwhile. */
  private desynced = false;

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
    // An HTTP snapshot can arrive after newer realtime state, or after leave.
    if (this.disposed || seq < this.lastSeq) return;
    this.mirror = state;
    this.lastSeq = seq;
    this.desynced = false;
    for (const key of [...this.buffer.keys()]) {
      if (key <= seq) this.buffer.delete(key);
    }
    this.clearGapTimer();
    this.handlers.onState(state, seq);
    this.drain();
  }

  ingest(message: ChannelMessage): void {
    if (this.disposed) return;

    if (message.kind === "preview") {
      this.handlers.onPreview?.(message);
      return;
    }
    if (message.kind === "arrival") {
      this.handlers.onArrival?.(message);
      return;
    }
    if (message.kind === "cheer") {
      this.handlers.onCheer?.(message);
      return;
    }

    if (message.kind === "snapshot") {
      // A snapshot always wins: it is the server's own view, not a delta.
      if (message.seq >= this.lastSeq) this.reset(message.state, message.seq);
      return;
    }

    // Duplicates and replays of already-applied events are ignored outright.
    if (message.seq <= this.lastSeq) return;

    this.buffer.set(message.seq, message);
    if (this.buffer.size > MAX_BUFFERED) {
      // A hole that never fills, with the stream still flowing behind it:
      // stop holding a session's worth of patches and start over from the
      // server's own view.
      this.buffer.clear();
      this.desync();
      return;
    }
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
    if (this.draining || this.disposed || this.desynced) return;

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
    if (this.mirror === null || this.desynced) return;
    // Structural sharing: React needs a new reference for what changed and the
    // *same* reference for what did not, a half-applied patch must never be
    // observable, and the old mirror is never mutated (see apply-patch.ts).
    let next: RunState;
    try {
      next = applyPatchShared(this.mirror, message.patch as Operation[]);
    } catch {
      // The patch does not fit this mirror. The old mirror is intact (the
      // apply is all-or-nothing), but it is behind, and every later patch
      // was built on the step this one failed to take.
      this.desync();
      return;
    }
    this.mirror = next;
    this.lastSeq = message.seq;
    this.handlers.onState(this.mirror, this.lastSeq);
    if (message.progression) {
      this.handlers.onProgression({ seq: message.seq, progression: message.progression });
    }
    if (message.discovered && message.discovered.length > 0) {
      this.handlers.onDiscovered?.({ runId: message.runId, seq: message.seq, canonIds: message.discovered });
    }
  }

  private desync(): void {
    if (this.desynced) return;
    this.desynced = true;
    this.clearGapTimer();
    this.handlers.onDesync?.(this.lastSeq);
  }

  private emitPresentation(
    presentation: Presentation | undefined,
    seq: number,
  ): Promise<void> | null {
    if (!presentation) return null;
    const event: PresentationEvent = { seq, presentation };
    this.handlers.onPresentation(event);
    // ENCOUNTER_BEGAN and COMBAT_SEQUENCE can carry a chained beat that must
    // play *after* them (protocol.ts). It rides one server message, so it gets
    // a synthetic seq strictly between this one and the next integer — later
    // than its parent for the subscribers' watermarks, and never able to
    // swallow the presentation on the next real message.
    const after = "after" in presentation ? presentation.after : undefined;
    const afterSeq = (seq + Math.floor(seq) + 1) / 2;

    if (!this.gate) {
      // No gate — a Party Mode phone. Spectacle is not played, but the events
      // are still surfaced in order for anything subscribed to them.
      if (after) this.emitPresentation(after, afterSeq);
      return null;
    }

    const played = this.gate(event);
    if (!after) return played instanceof Promise ? played : null;

    // The chained beat starts when the parent's animation finishes — even a
    // broken one, so a throwing animation cannot eat the beat after it — and
    // the patch stays held until the whole chain has played.
    const parentDone = played instanceof Promise ? played.catch(() => undefined) : Promise.resolve();
    return parentDone.then(() => {
      if (this.disposed) return;
      return this.emitPresentation(after, afterSeq) ?? undefined;
    });
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
      // The resync can fail or return nothing; if the hole is still there,
      // keep asking rather than waiting for a message that may never come —
      // without this, a dropped resync left the mirror stuck forever.
      this.armGapTimer();
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

  if (candidate.kind === "preview") {
    const { playerId, context } = candidate as Partial<PreviewMessage>;
    const preview = readIntentPreview((candidate as Partial<PreviewMessage>).preview ?? null);
    if (typeof playerId !== "string" || preview === undefined) return null;
    // A pick with no decision named cannot be checked against the screen, so
    // it is not a pick at all; a clear needs none.
    if (preview !== null && typeof context !== "string") return null;
    return {
      kind: "preview",
      seq: candidate.seq,
      runId: candidate.runId,
      playerId,
      preview,
      context: preview === null ? null : (context as string),
    };
  }

  if (candidate.kind === "arrival") {
    const { playerId, name, color } = candidate as Partial<ArrivalMessage>;
    if (typeof playerId !== "string" || typeof name !== "string" || typeof color !== "string") return null;
    return { kind: "arrival", seq: candidate.seq, runId: candidate.runId, playerId, name, color };
  }

  if (candidate.kind === "cheer") {
    // Only a cheer the game knows: the TV draws its picture, never its text.
    const cheer = cheerById((candidate as Partial<CheerMessage>).cheer);
    if (!cheer) return null;
    return { kind: "cheer", seq: candidate.seq, runId: candidate.runId, cheer: cheer.id };
  }

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
  const progression = (candidate as ServerMessage).progression;
  const discovered: unknown = (candidate as ServerMessage).discovered;
  const finds =
    Array.isArray(discovered) && discovered.every((id): id is string => typeof id === "string")
      ? discovered
      : null;
  return {
    ...message,
    ...(presentation ? { presentation } : {}),
    ...(progression ? { progression } : {}),
    ...(finds ? { discovered: finds } : {}),
  };
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
  /**
   * Drop the stream and open a fresh one now, whatever state the old one is in
   * (#264). A screen that slept can hold a stream the network killed without
   * telling it; this is how a woken page stops trusting it. The new stream's
   * `onopen` resyncs from the sequencer's seq, so nothing missed is lost.
   */
  reconnect?(): void;
}

/**
 * Consecutive failures before the stream ever subscribed, after which the room
 * is treated as gone (ended, or this phone signed out) rather than as a bad
 * network. A network drop after a subscribe never counts.
 */
export const TERMINAL_AFTER = 5;

/** Consecutive stream failures after which the catch-up is fetched once, to learn whether the room is gone. */
export const RESYNC_AFTER_FAILURES = 3;

/** The transport marks a failure that happened before `subscribe_success`. */
export function failedBeforeSubscribe(reason: unknown): boolean {
  return typeof reason === "object" && reason !== null && (reason as { beforeSubscribe?: unknown }).beforeSubscribe === true;
}

/**
 * Pure counter step: the next run of pre-subscribe failures, and whether that
 * run is long enough to stop retrying. A failure that is not pre-subscribe
 * (the SSE path never marks one) resets the count.
 */
export function nextFailureRun(run: number, reason: unknown): { run: number; lost: boolean } {
  const next = failedBeforeSubscribe(reason) ? run + 1 : 0;
  return { run: next, lost: next >= TERMINAL_AFTER };
}

export function openChannel(options: ChannelOptions): Channel {
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((h: TimerHandle) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const create =
    options.createEventSource ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike);

  let source: EventSourceLike | null = null;
  let retryTimer: TimerHandle | null = null;
  let attempt = 0;
  let preSubscribeFailures = 0;
  let closed = false;

  /**
   * `again`: a stream replacing one this page had, which is a reconnect even
   * on its first attempt. Said as one, so a wake that is slow to find the
   * network shows the banner, and the catch-up line (screens/CatchUp) knows
   * the story may have moved while the screen was away.
   */
  function connect(again = false): void {
    if (closed) return;
    options.onStatus(attempt === 0 && !again ? "connecting" : "reconnecting");

    const es = create(options.url(options.sequencer.seq));
    source = es;

    es.onopen = () => {
      if (closed || source !== es) return;
      attempt = 0;
      preSubscribeFailures = 0;
      options.onStatus("open");
      // Anything published while we were away is fetched, not waited for
      // (architecture §4.3 — hard-refresh recovery in under a second).
      // The store owns fetch serialization, catch-up requests and retries.
      void options.resync(options.sequencer.seq).catch(() => undefined);
    };

    es.onmessage = (event) => {
      if (closed || source !== es) return;
      const message = parseChannelMessage(event.data);
      if (message) options.sequencer.ingest(message);
    };

    es.onerror = (reason) => {
      if (closed || source !== es) return;
      source = null;
      es.close();
      const step = nextFailureRun(preSubscribeFailures, reason);
      preSubscribeFailures = step.run;
      if (step.lost) {
        options.onStatus("lost");
        return;
      }
      options.onStatus("reconnecting");
      const delay = backoffDelay(attempt, options.backoff);
      attempt += 1;
      // A stream that keeps failing may be refused because the room is gone,
      // which only the catch-up fetch can tell (the store ends on "lost" when
      // it answers so). Once per run of failures, on the third: a blip never
      // asks, an outage asks once and the fetch fails as cheaply as the stream.
      if (attempt === RESYNC_AFTER_FAILURES) void options.resync(options.sequencer.seq).catch(() => undefined);
      retryTimer = schedule(() => { connect(); }, delay);
    };
  }

  connect();

  return {
    reconnect() {
      if (closed) return;
      if (retryTimer !== null) cancel(retryTimer);
      retryTimer = null;
      const old = source;
      source = null;
      old?.close();
      attempt = 0;
      preSubscribeFailures = 0;
      connect(true);
    },
    close() {
      closed = true;
      if (retryTimer !== null) cancel(retryTimer);
      source?.close();
      source = null;
      options.onStatus("idle");
    },
  };
}
