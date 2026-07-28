/**
 * Wire protocol — docs/architecture.md §4.
 *
 * Clients send intents. The server validates, applies, persists, and broadcasts
 * a { patch, presentation } pair. Phones apply the patch and ignore
 * presentation; the WorldView plays the presentation, *then* applies the patch.
 * State and spectacle stay decoupled.
 */

import type { Appearance, ClassId, SpeciesId, Stats } from "./domain.js";
import type { RoomMode, RunState, DiceRoll } from "./state.js";

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
    }
  | { type: "START_CHAPTER"; chapterId: string }
  | { type: "CHOOSE"; choiceId: string }
  | { type: "ROLL" }
  | { type: "ADVANCE" }
  | { type: "USE_ITEM"; itemId: string }
  | { type: "RESOLVE_ITEM_SWAP"; dropItemId: string | null }
  | { type: "SET_MODE"; mode: RoomMode };

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
  | { kind: "ATTACK"; sourceId: string; targetId: string; roll: DiceRoll; damage: number }
  | { kind: "HEAL"; targetId: string; amount: number }
  | { kind: "DOWN"; targetId: string }
  | { kind: "REVIVE"; targetId: string }
  | { kind: "LEVEL_UP"; characterId: string; level: number }
  | { kind: "TRANSFORM"; characterId: string; tier: string }
  | { kind: "CHAPTER_COMPLETE"; chapterId: string; xp: number };

export interface ServerMessage {
  seq: number;
  runId: string;
  patch: JsonPatchOp[];
  presentation?: Presentation;
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
