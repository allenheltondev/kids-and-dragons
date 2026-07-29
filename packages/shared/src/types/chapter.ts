/**
 * Chapter format — docs/architecture.md §5.
 *
 * A chapter is one JSON file, authored offline, validated in CI, and served as
 * a static asset. A malformed chapter fails the build, never the play session.
 */

import type { SpeciesId, StatId } from "./domain.js";

export type SceneId = string;

/** Who receives a granted item. */
export type GrantTarget = "roller" | "party" | (string & {});

export type Effect =
  | { type: "grantItem"; itemId: string; to?: GrantTarget }
  | { type: "grantQuestItem"; itemId: string }
  | { type: "damage"; amount: number; to?: GrantTarget }
  | { type: "heal"; amount: number; to?: GrantTarget }
  | { type: "grantXp"; amount: number }
  | { type: "setFlag"; flag: string; value?: boolean };

export interface Branch {
  goto: SceneId;
  effects?: Effect[];
  /** Optional narration override shown before the transition. */
  narration?: string;
}

export interface Choice {
  id: string;
  label: string;
  icon: string;
  goto: SceneId;
  /**
   * Hidden — not greyed out — when nobody in the party matches.
   * See architecture §5.
   */
  requiresSpecies?: SpeciesId | SpeciesId[];
  requiresFlag?: string;
  requiresItem?: string;
  effects?: Effect[];
}

export interface StoryScene {
  type: "story";
  art?: string;
  narration: string;
  onEnter?: Effect[];
  choices: Choice[];
}

export interface CheckScene {
  type: "check";
  art?: string;
  stat: StatId;
  tn: number;
  prompt: string;
  narration?: string;
  onEnter?: Effect[];
  /** Which player rolls. Default: the party picks. */
  roller?: "party" | "active" | "best";
  onSuccess: Branch;
  onFailure: Branch;
}

export interface ChoicePointScene {
  type: "choice_point";
  art?: string;
  narration: string;
  onEnter?: Effect[];
  /** Party votes; ties broken by the active turn marker. spec §6.1. */
  choices: Choice[];
}

export interface RestScene {
  type: "rest";
  art?: string;
  narration: string;
  onEnter?: Effect[];
  /** Heals the party by this much on entry. */
  heal?: number;
  choices: Choice[];
}

export interface EnemySpec {
  id: string;
  name?: string;
  count: number;
  hp: number;
  guard: number;
  steps: number;
  attack: number;
  art?: string;
}

export interface EncounterScene {
  type: "encounter";
  map: string;
  art?: string;
  narration?: string;
  onEnter?: Effect[];
  enemies: EnemySpec[];
  onVictory: Branch;
  /** Never a game over — the story branches. spec §7.3. */
  onDefeat: Branch;
}

export type Scene =
  | StoryScene
  | CheckScene
  | ChoicePointScene
  | RestScene
  | EncounterScene;

export type SceneType = Scene["type"];

export interface LlmHints {
  tone: string;
  vocabulary: string;
  forbidden: string[];
  npcVoices?: Record<string, string>;
}

export interface Chapter {
  id: string;
  campaignId: string;
  index: number;
  title: string;
  biome: string;
  estimatedMinutes: number;
  xpAward: number;
  entry: SceneId;
  scenes: Record<SceneId, Scene>;
  llmHints?: LlmHints;
}

export interface Campaign {
  id: string;
  title: string;
  blurb: string;
  chapters: string[];
}
