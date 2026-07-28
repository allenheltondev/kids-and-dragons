/**
 * Authoritative run state.
 *
 * The server owns this object. Clients hold a mirror kept current by JSON Patch
 * (architecture §4.2) and never mutate it locally.
 */

import type { ResolvedCharacter, StatId } from "./domain.js";
import type { SceneId, SceneType } from "./chapter.js";

export type RoomMode = "party" | "travel";

export interface DiceRoll {
  die: number;
  mod: number;
  total: number;
  tn: number;
  result: "success" | "failure" | "hit" | "miss";
  /** Who rolled. */
  characterId: string;
  stat?: StatId;
}

/** A member of the party, as the clients see them. */
export interface PartyMember {
  character: ResolvedCharacter;
  playerId: string;
  hp: number;
  /** spec §7.3 — knocked down, never dead. */
  down: boolean;
  connected: boolean;
  ready: boolean;
}

export type PhaseKind =
  | "lobby"
  | "creation"
  | "scene"
  | "check"
  | "encounter"
  | "chapter_complete";

/** A decision the game is waiting on. Only one is ever open at a time. */
export type Prompt =
  | {
      kind: "choice";
      sceneId: SceneId;
      /** Choices already filtered for party eligibility. */
      options: { id: string; label: string; icon: string }[];
      /** Empty means anyone may answer. */
      forPlayerIds: string[];
      /** choice_point scenes tally votes rather than taking the first answer. */
      vote: boolean;
      votes?: Record<string, string>;
    }
  | {
      kind: "roll";
      sceneId: SceneId;
      stat: StatId;
      tn: number;
      prompt: string;
      characterId: string;
    }
  | {
      kind: "item_swap";
      characterId: string;
      incomingItemId: string;
    }
  | { kind: "ready"; forPlayerIds: string[] };

export interface RunState {
  runId: string;
  roomCode: string;
  mode: RoomMode;
  seq: number;
  phase: PhaseKind;
  campaignId: string | null;
  chapterId: string | null;
  sceneId: SceneId | null;
  sceneType: SceneType | null;
  /** Rendered narration for the current scene (authored, or LLM-validated). */
  narration: string;
  art: string | null;
  party: PartyMember[];
  prompt: Prompt | null;
  lastRoll: DiceRoll | null;
  /** Story flags set by effects, scoped to the run. */
  flags: Record<string, boolean>;
  xpEarned: number;
  updatedAt: string;
}

export interface RoomSummary {
  code: string;
  runId: string;
  mode: RoomMode;
  expiresAt: string;
}
