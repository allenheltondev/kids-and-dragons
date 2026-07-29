/**
 * The engine port.
 *
 * Game rules live in `@kad/shared` so that dice and rules resolution have
 * exactly one implementation (architecture §4.1 — the server rolls, always).
 * The handlers reach it through this narrow port rather than importing it
 * directly, for two reasons:
 *
 *  1. It names the exact surface the server depends on — two functions — so a
 *     change in `@kad/shared` shows up here, in one adapter, instead of in
 *     three handlers.
 *  2. It lets the protocol tests (seq monotonicity, stale-seq rejection,
 *     reconnect replay) drive the handlers with a trivial stub engine. Those
 *     tests are about the *transport*; making them depend on rules content
 *     would make them fail for reasons that have nothing to do with sync.
 *
 * `shared-engine.ts` is the real binding and the only file that imports the
 * engine itself.
 */

import type {
  Chapter,
  ClientIntent,
  ItemCatalog,
  Presentation,
  Rng,
  RoomMode,
  RulesContent,
  RunState,
} from "@kad/shared";

/** `ctx` as handed to `applyIntent`. */
export interface EngineContext {
  rules: RulesContent;
  items: ItemCatalog;
  /** `null` before a chapter has started (lobby, character creation). */
  chapter: Chapter | null;
  /** Characters belong to a household (§3), so creation needs to know which. */
  householdId?: string;
  /** Seeded per action so a replay of the event log re-rolls identically. */
  rng: Rng;
  /** ISO timestamp — the caller owns the clock so the engine stays pure. */
  now: string;
}

export interface IntentInput {
  playerId: string;
  intent: ClientIntent;
  /** The client's last-seen seq. The engine re-checks it when provided. */
  seq?: number;
}

export interface ApplyIntentResult {
  /** The next state. Unchanged (or the same object) when the intent was rejected. */
  state: RunState;
  presentation?: Presentation | undefined;
  /** Set when the intent was illegal. The handler maps it onto ActionResponse. */
  error?: { code: "STALE_SEQ" | "ILLEGAL" | "NOT_FOUND" | "FORBIDDEN"; message: string } | undefined;
}

export interface CreateRunStateInput {
  runId: string;
  roomCode: string;
  mode: RoomMode;
  campaignId: string | null;
  now: string;
}

export interface Engine {
  applyIntent(state: RunState, input: IntentInput, ctx: EngineContext): ApplyIntentResult;
  createRunState(input: CreateRunStateInput): RunState;
}
