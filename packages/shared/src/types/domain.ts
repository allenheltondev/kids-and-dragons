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

/**
 * The most characters a run will seat. The table this game is built for is
 * three (spec §1); four leaves room for a guest without asking every map to
 * budget spawn tiles for a crowd. Every map's `partySpawns` is validated
 * against this, and `CREATE_CHARACTER` refuses past it — the pair is what
 * keeps "a 5th phone joins" an error at the door instead of a crash at the
 * first encounter.
 */
export const MAX_PARTY = 4;

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
  /**
   * Stat points earned by levelling and not yet spent (spec §8.1 — a level
   * grants a point, the player spends it at a Rest scene). It lives *here*, in
   * the same object as `stats`, so a failed campaign reverts the point and
   * whatever it was spent on together; anywhere else and a level-up spent
   * mid-campaign would survive the revert as a permanent stat.
   *
   * Optional only because characters written to the store before this field
   * existed come back without it (`getCharacter` casts, it does not migrate).
   * Read it as `?? 0`; everything in character.ts writes it as a number.
   */
  unspentPoints?: number;
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

/** Result of applying an XP award to a character's effective progress. */
export interface AwardXpResult {
  character: Character;
  /** Set only when the award crossed a level boundary. */
  leveledTo?: number;
  /** Set only when the award crossed into a different appearance tier. */
  newTier?: TierId;
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
  /**
   * Stat points waiting to be spent, so the "you have a point waiting" badge
   * (spec §8.1) can render off the resolved view instead of reaching around
   * `resolveCharacter()` into the stored halves and re-deriving
   * `provisional ?? committed` for itself.
   *
   * Required here while `CharacterProgress.unspentPoints` is optional, and the
   * asymmetry is deliberate: the stored shape has to admit records written
   * before the field existed, but `resolveCharacter()` always produces a
   * number, so the resolved view should say so rather than making every reader
   * of a fully-derived character write `?? 0`.
   */
  unspentPoints: number;
  /**
   * The stats a banked point could legally go into — the +9 ceiling
   * `spendStatPoint()` enforces, resolved here so the Rest-scene spend panel
   * can obey "only legal actions are ever rendered" (spec §7.2) without
   * re-deriving the stored halves the ceiling is measured against.
   *
   * Independent of `unspentPoints`: a full list with zero points means "not
   * yet", an empty list with points in hand means "nowhere left to put them",
   * and those are different sentences on a phone.
   *
   * Optional for the reason `RunState.bonuses` is (state.ts): a resolved
   * character is not only produced, it is *persisted* — `RunState.party[]`
   * holds these snapshots, `getState` hands back the stored JSON verbatim, and
   * a member is re-resolved only when something touches it (an XP award, a
   * campaign settling, a spend). So a run in flight across a deploy carries
   * characters shaped like the code that wrote them, and a Friday-evening
   * session must not end because a field was added under it.
   *
   * Why this one is optional while `unspentPoints` beside it is not: a missing
   * number reads as `undefined` and every comparison against it is quietly
   * false, so an old snapshot degrades to "no points waiting". A missing array
   * throws on the first `.length` or `.includes`, which is a white screen
   * instead of a controller. `resolveCharacter()` always writes it; readers
   * still have to survive a snapshot that predates it.
   */
  spendableStats?: StatId[];
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
  /**
   * The level this character keeps if the campaign fails — `committed.level`,
   * not the effective one above.
   *
   * Exposed because the resolved view otherwise hides the distinction
   * entirely, and one decision genuinely needs it: a newcomer joining at the
   * party's tier floor (spec §8.4) writes that level straight into their own
   * *committed* snapshot. Capping on a veteran's provisional level would let
   * the campaign fail, revert the veterans, and leave the newcomer permanently
   * a tier above the people who earned it.
   */
  committedLevel: number;
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

/**
 * The family — and the unit persistence hangs off. Characters, players, devices,
 * and runs all live under one household (§3), which is what makes "the character
 * is still there next Tuesday" fall out for free.
 *
 * A household is born one of two ways:
 *
 *   **anonymous** — the first person to start a game gets `guest: true` and an
 *   `expiresAt`. Everything under it is swept once that passes. Nobody signs up
 *   to play; that is the point.
 *
 *   **claimed** — an adult signs in, and the household they are already playing
 *   in becomes theirs: `guest: false`, `ownerSub` set, `expiresAt` gone. Nothing
 *   moves and no ids change, so a character created ten minutes ago as a guest
 *   is the same character afterwards.
 *
 * There is no third state, and no separate "anonymous" code path above this
 * type — every read below the auth layer sees an ordinary household either way.
 */
export interface Household {
  id: string;
  displayName: string;
  /** The Cognito sub of the adult who claimed it. `null` while anonymous. */
  ownerSub: string | null;
  /** True until an account claims it. Guests are swept; claimed ones never are. */
  guest: boolean;
  /** ISO. Present only while `guest` — when the sweeper may delete everything. */
  expiresAt?: string;
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
  /**
   * The thresholds *above* level 1: `levelXp[n]` is the total XP needed to
   * reach level `n + 2`, so nine entries cap the game at level 10 (spec §8.1)
   * and a character with 0 XP is level 1 rather than level 2.
   */
  levelXp: number[];
  /** Level at which each tier is reached. */
  tierLevels: Record<TierId, number>;
  species: Record<SpeciesId, SpeciesDef>;
  classes: Record<ClassId, ClassDef>;
}
