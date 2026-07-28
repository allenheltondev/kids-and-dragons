/**
 * Domain types — characters, species, classes, items.
 *
 * Source of truth: docs/spec.md §4, §8, §9 and docs/architecture.md §3.1.
 * These are the shapes; the *values* (which species exist, what they grant)
 * live in content/rules.json, per the "content as data" rule in the roadmap.
 */

export type StatId = "might" | "quick" | "clever" | "heart";

export const STAT_IDS: readonly StatId[] = ["might", "quick", "clever", "heart"] as const;

export type SpeciesId =
  | "unicorn"
  | "dragonling"
  | "griffin"
  | "bigfoot"
  | "kitsune"
  | "manticore";

export type ClassId = "thornguard" | "duskrunner" | "starweaver" | "songkeeper";

/** Appearance tiers, in level order. See spec §8.1. */
export type TierId = "fledgling" | "sworn" | "radiant" | "mythic";

export const TIER_IDS: readonly TierId[] = ["fledgling", "sworn", "radiant", "mythic"] as const;

export type Stats = Record<StatId, number>;

export type Role = "adult" | "child";

export type Difficulty = "easy" | "normal" | "hard";

// ---------------------------------------------------------------------------
// Items — spec §9
// ---------------------------------------------------------------------------

export type ItemKind = "consumable" | "trinket" | "quest";

/** Immediate effect of using a consumable. */
export type ItemEffect =
  | { type: "heal"; amount: number }
  | { type: "rollBonus"; amount: number }
  | { type: "damage"; amount: number };

/** Always-on effect of a trinket. */
export type ItemPassive =
  | { type: "statBonus"; stat: StatId; amount: number }
  | { type: "stepBonus"; amount: number }
  | { type: "maxHpBonus"; amount: number }
  | { type: "rerollOnes"; perEncounter: number };

export interface ItemDef {
  kind: ItemKind;
  name: string;
  text: string;
  icon: string;
  effect?: ItemEffect;
  passive?: ItemPassive;
}

/** The catalog served from content/items.json. */
export type ItemCatalog = Record<string, ItemDef>;

/** An item instance held by a character. Quest items are tracked separately. */
export interface InventoryEntry {
  itemId: string;
  kind: Exclude<ItemKind, "quest">;
}

/** The six-slot limit from spec §9.1. Quest items never count against it. */
export const INVENTORY_SLOTS = 6;

// ---------------------------------------------------------------------------
// Characters — architecture §3.1
// ---------------------------------------------------------------------------

export interface Appearance {
  /** Palette slot name from assets/manifest.json. */
  palette: string;
  accent: string;
  hornStyle?: string;
  wingStyle?: string;
  markings?: string;
}

/**
 * The mutable half of a character. Stored twice: once committed, once
 * provisional. `provisional ?? committed` is the effective state, and
 * resolveCharacter() is the only place that resolution happens.
 */
export interface CharacterProgress {
  level: number;
  xp: number;
  /** Points spent by the player. Species bonuses are applied at resolve time. */
  stats: Stats;
  tier: TierId;
  unlockedActions: string[];
  inventory: InventoryEntry[];
}

export interface ProvisionalProgress extends CharacterProgress {
  runId: string;
}

export interface Souvenir {
  id: string;
  fromRun: string;
  earnedAt: string;
}

export interface Character {
  id: string;
  householdId: string;
  ownerPlayerId: string;
  name: string;
  species: SpeciesId;
  class: ClassId;
  appearance: Appearance;
  committed: CharacterProgress;
  provisional?: ProvisionalProgress | null;
  /** Campaign-scoped, slot-free, cleared at campaign end. */
  questItems: string[];
  /** Permanent, cosmetic-only, grows on campaign failure. */
  souvenirs: Souvenir[];
  createdAt: string;
}

/**
 * A character with every rule applied: species bonus, trinket passives, tier,
 * derived combat numbers. Nothing downstream of resolveCharacter() should ever
 * need to know whether a bonus came from a species or a charm.
 */
export interface ResolvedCharacter {
  id: string;
  ownerPlayerId: string;
  name: string;
  species: SpeciesId;
  class: ClassId;
  appearance: Appearance;
  level: number;
  xp: number;
  tier: TierId;
  /** Base + species + trinkets. */
  stats: Stats;
  maxHp: number;
  steps: number;
  guard: number;
  /** The stat this character's class attacks with. */
  attackStat: StatId;
  actions: string[];
  worldAbility: string;
  inventory: InventoryEntry[];
  questItems: string[];
  souvenirs: Souvenir[];
  /** True when the effective state came from an in-flight campaign. */
  isProvisional: boolean;
}

// ---------------------------------------------------------------------------
// Household, players, devices — architecture §4.5
// ---------------------------------------------------------------------------

export interface PlayerProfile {
  id: string;
  householdId: string;
  displayName: string;
  color: string;
  avatar?: string;
  role: Role;
}

export interface Household {
  id: string;
  displayName: string;
  ownerSub: string;
  createdAt: string;
}

export interface DeviceBinding {
  deviceId: string;
  householdId: string;
  playerId: string;
  tokenHash: string;
  lastSeen: string;
  userAgent?: string;
  revoked?: boolean;
}

// ---------------------------------------------------------------------------
// Rules content — content/rules.json
// ---------------------------------------------------------------------------

export interface SpeciesDef {
  id: SpeciesId;
  name: string;
  blurb: string;
  /** Passive: a flat stat bonus, or extra max HP. */
  passive: { stat?: StatId; amount: number; maxHp?: number; text: string };
  worldAbility: { id: string; name: string; text: string; icon: string };
  /** Combat-flavored version of the world ability, once per encounter. */
  combatAction: { id: string; name: string; text: string; icon: string };
}

export interface ClassDef {
  id: ClassId;
  name: string;
  stat: StatId;
  role: string;
  blurb: string;
  baseSteps: number;
  signature: { id: string; name: string; text: string; icon: string };
  /** Actions unlocked at levels beyond the signature, keyed by level. */
  unlocks: Record<string, { id: string; name: string; text: string; icon: string }>;
}

export interface RulesContent {
  version: number;
  /** Every character starts here before species bonus and creation points. */
  baseStats: Stats;
  /** Points the player distributes at creation. See spec §5 step 3. */
  creationPoints: number;
  baseMaxHp: number;
  baseGuard: number;
  baseSteps: number;
  /** TN by difficulty. spec §4.1. */
  difficultyTn: Record<Difficulty, number>;
  /** xpThreshold[n] is the total XP needed to reach level n+1. */
  levelXp: number[];
  /** Level at which each tier is reached. */
  tierLevels: Record<TierId, number>;
  species: Record<SpeciesId, SpeciesDef>;
  classes: Record<ClassId, ClassDef>;
}
