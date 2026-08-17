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
  AbilityCatalog,
  EncounterMap,
  Character,
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
  /**
   * The board an encounter scene names, by id. A lookup rather than a value
   * because a chapter can hold several fights, and the engine should not have to
   * be handed every map a chapter might reach.
   */
  map?: (id: string) => EncounterMap | null;
  /**
   * Combat abilities by id — authored content, like the item catalog. Attack,
   * Help Up and Ready are built into `encounter.ts`, so an absent catalog still
   * gives a playable fight.
   */
  abilities?: AbilityCatalog;
  /** Characters belong to a household (§3), so creation needs to know which. */
  householdId?: string;
  /** Seeded per action so a replay of the event log re-rolls identically. */
  rng: Rng;
  /** ISO timestamp — the caller owns the clock so the engine stays pure. */
  now: string;
  /**
   * Whether the engine may run roadmap chapter 6's playtest cheats. Named in
   * the port for the reason the port exists: this is the surface the server
   * depends on, and "can this entry point warp the run to any scene" belongs
   * in it rather than being discovered from the implementation.
   */
  playtest?: boolean;
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
  /**
   * The unresolved `Character` a CREATE_CHARACTER intent built, for the handler
   * to persist. It cannot come out of `state.party`, which holds only the
   * resolved view — see `EngineResult.created` in engine.ts.
   */
  created?: Character | undefined;
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
