/**
 * Authoritative run state.
 *
 * The server owns this object. Clients hold a mirror kept current by JSON Patch
 * (architecture §4.2) and never mutate it locally.
 */

import type { ResolvedCharacter, StatId } from "./domain.js";
import type { ChapterOutcome, SceneId, SceneType } from "./chapter.js";

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
  /**
   * How the chapter now in `chapterId` ended, once it has (spec §8.2). Null
   * while one is still being played.
   *
   * The client needs it to play a different ending beat, and the persistence
   * layer needs it to count setbacks toward the three that fail a campaign
   * (§8.3). It is *not* derivable from `xpEarned`, because bonus objectives and
   * `grantXp` effects mean a successful chapter and a setback can pay the same
   * number.
   *
   * Optional, along with `bonuses`, because RunState is persisted and shipped
   * as plain JSON: a run written before these fields existed has to keep
   * loading, and a Friday-evening session must not end because the shape of the
   * object changed under it. `createRunState` always writes both.
   */
  chapterOutcome?: ChapterOutcome | null;
  /**
   * The bonus objectives this run met, itemised for the completion screen.
   * Their XP is already folded into `xpEarned`; this is the breakdown, not a
   * second pot.
   */
  bonuses?: EarnedBonus[];
  updatedAt: string;
}

/**
 * One bonus objective the party earned, as paid.
 *
 * `xp` is what was actually awarded rather than what the chapter asked for:
 * the engine clamps against the 25% ceiling (spec §8.2), and a screen that
 * itemised the authored number would not add up to `xpEarned`.
 */
export interface EarnedBonus {
  id: string;
  label: string;
  xp: number;
}

export interface RoomSummary {
  code: string;
  runId: string;
  mode: RoomMode;
  expiresAt: string;
}
