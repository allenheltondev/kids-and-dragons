/**
 * Wire protocol — docs/architecture.md §4.
 *
 * Clients send intents. The server validates, applies, persists, and broadcasts
 * a { patch, presentation } pair. Phones apply the patch and ignore
 * presentation; the WorldView plays the presentation, *then* applies the patch.
 * State and spectacle stay decoupled.
 */

import type {
  Appearance,
  ClassId,
  ResolvedCharacter,
  SpeciesId,
  StatId,
  Stats,
  TierId,
} from "./domain.js";
import type { ChapterOutcome } from "./chapter.js";
import type { RoomMode, RunState, DiceRoll } from "./state.js";
import type { EncounterEvent } from "../encounter.js";

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

export type ClientIntent =
  | { type: "READY"; ready: boolean }
  | {
      type: "CREATE_CHARACTER";
      name: string;
      species: SpeciesId;
      class: ClassId;
      /** Points the player assigned, before species bonus. */
      stats: Stats;
      appearance: Appearance;
      /**
       * Joining a party already underway (spec §8.4) — 1, or the party's tier
       * floor. Absent means 1. Validated in `newCharacter()`, never trusted:
       * it arrives from a phone and decides how strong the character is.
       */
      startingLevel?: number;
    }
  | { type: "START_CHAPTER"; chapterId: string }
  | { type: "CHOOSE"; choiceId: string }
  | { type: "ROLL" }
  | { type: "ADVANCE" }
  /**
   * `targetId` is for a thrown consumable during the holder's combat turn —
   * the Thunder Acorn needs a monster to land on. Ignored outside a fight,
   * where the only usable effect is a heal and it lands on the user.
   */
  | { type: "USE_ITEM"; itemId: string; targetId?: string }
  | { type: "RESOLVE_ITEM_SWAP"; dropItemId: string | null }
  | { type: "SPEND_STAT_POINT"; stat: StatId }
  | { type: "SET_MODE"; mode: RoomMode }
  /**
   * Combat, spec §7.2 — move up to your steps, then take one action.
   *
   * Three intents rather than one because they are three different taps with
   * three different undo stories: a move is committed the moment the figure
   * arrives, an action is committed once a target is confirmed, and ending a
   * turn is the only one that hands control to somebody else. Folding them
   * together would make "I moved and then changed my mind about who to hit" a
   * protocol error instead of a normal thing an eight-year-old does.
   */
  | { type: "MOVE"; to: { x: number; y: number } }
  /**
   * `targetIds` / `targetTiles` are the multi-select forms (Storm of Blades'
   * two enemies, Bramble Wall's two tiles). The singular fields stay for every
   * one-target ability; a request may send either shape and the engine reads
   * the plural first (encounter.ts CombatActionRequest).
   */
  | {
      type: "COMBAT_ACTION";
      abilityId: string;
      targetId?: string;
      targetTile?: { x: number; y: number };
      targetIds?: string[];
      targetTiles?: { x: number; y: number }[];
    }
  | { type: "END_TURN" };

export interface ActionRequest {
  runId: string;
  playerId: string;
  /** The client's last-seen server seq. The server rejects stale intents. */
  seq: number;
  intent: ClientIntent;
}

export interface ActionResponse {
  ok: boolean;
  seq: number;
  /** Set when ok is false. Clients resync rather than retrying blindly. */
  error?: { code: "STALE_SEQ" | "ILLEGAL" | "NOT_FOUND" | "FORBIDDEN"; message: string };
}

// ---------------------------------------------------------------------------
// Server → clients
// ---------------------------------------------------------------------------

/** RFC 6902. */
export type JsonPatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: unknown }
  | { op: "move"; from: string; path: string }
  | { op: "copy"; from: string; path: string }
  | { op: "test"; path: string; value: unknown };

/** How the WorldView should animate a transition. Never load-bearing. */
export type Presentation =
  | { kind: "SCENE_ENTER"; sceneId: string; art?: string }
  | { kind: "ROLL"; roll: DiceRoll }
  | { kind: "CHOICE_MADE"; choiceId: string; byPlayerId: string }
  /**
   * A fight has started: the board is up and initiative is rolled.
   *
   * Carried as a presentation rather than left to the patch because the client
   * has to play the "everyone takes their places" beat *before* the new state
   * lands, exactly like a chapter's ending beat below — a board that simply
   * appears mid-scene reads as a glitch.
   */
  | {
      kind: "ENCOUNTER_BEGAN";
      mapId: string;
      firstActorId: string | null;
      /** Enemy turns that resolved before the first player could act. */
      events?: readonly EncounterEvent[];
      /** A branch reached if those opening turns immediately ended the fight. */
      after?: Presentation;
    }
  | {
      kind: "COMBAT_SEQUENCE";
      /** Every move, roll and state-changing effect, in resolution order. */
      events: readonly EncounterEvent[];
      /** A scene transition that must wait until the combat beats finish. */
      after?: Presentation;
    }
  | { kind: "ATTACK"; sourceId: string; targetId: string; roll: DiceRoll; damage: number }
  | { kind: "HEAL"; targetId: string; amount: number }
  | { kind: "DOWN"; targetId: string }
  | { kind: "REVIVE"; targetId: string }
  | { kind: "LEVEL_UP"; characterId: string; level: number }
  | { kind: "TRANSFORM"; characterId: string; tier: string }
  /**
   * `outcome` is the one thing on a presentation that a client cannot recompute
   * from the patch alone in time to use it: the ending beat has to be chosen
   * *before* the state lands (see the WorldView's play-then-apply order above),
   * and a setback plays a different one (spec §8.2).
   */
  | { kind: "CHAPTER_COMPLETE"; chapterId: string; xp: number; outcome: ChapterOutcome };

/** A character-specific progression trigger emitted by a chapter XP award. */
export interface ProgressionAward {
  characterId: string;
  /** Present only when this award crossed at least one level boundary. */
  leveledTo?: number;
  /** Present only when this award crossed an appearance-tier boundary. */
  newTier?: TierId;
}

/**
 * Progression data that accompanies the authoritative state patch.
 *
 * `characters` deliberately repeats the resolved snapshots represented by the
 * patch. It gives UI trigger code one self-contained payload while the patch
 * remains the source of truth for every existing client.
 */
export interface ProgressionUpdate {
  characters: ResolvedCharacter[];
  /** Present for chapter XP awards; campaign-only transitions have no awards. */
  awards?: ProgressionAward[];
}

export interface ServerMessage {
  seq: number;
  runId: string;
  patch: JsonPatchOp[];
  presentation?: Presentation;
  /** Additive progression data; older clients safely ignore this field. */
  progression?: ProgressionUpdate;
}

/** A full snapshot, sent on join and whenever a client's gap is too large. */
export interface SnapshotMessage {
  seq: number;
  runId: string;
  state: RunState;
}

export type ChannelMessage =
  | ({ kind: "patch" } & ServerMessage)
  | ({ kind: "snapshot" } & SnapshotMessage);

// ---------------------------------------------------------------------------
// Transport seam — architecture §4.4
// ---------------------------------------------------------------------------

export type Unsubscribe = () => void;

export interface RoomChannel {
  publish(roomCode: string, message: ChannelMessage): Promise<void>;
  subscribe(roomCode: string, onMessage: (m: ChannelMessage) => void): Unsubscribe;
}

// ---------------------------------------------------------------------------
// HTTP surface
// ---------------------------------------------------------------------------

export interface CreateRoomRequest {
  householdId: string;
  mode: RoomMode;
  campaignId?: string;
}

export interface CreateRoomResponse {
  code: string;
  runId: string;
  mode: RoomMode;
  expiresAt: string;
}

export interface JoinRoomRequest {
  /** The device-bound token. In local dev, a playerId is accepted directly. */
  deviceToken?: string;
  playerId?: string;
}

export interface JoinRoomResponse {
  runId: string;
  playerId: string;
  mode: RoomMode;
  sessionToken: string;
  state: RunState;
}

export interface StateResponse {
  seq: number;
  /** Present when the client's gap was small enough to replay. */
  events?: ServerMessage[];
  /** Present when a full resync was cheaper. */
  state?: RunState;
}
