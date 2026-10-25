/**
 * Domain types — characters, species, classes, items.
 *
 * Source of truth: docs/spec.md §4, §8, §9 and docs/architecture.md §3.1.
 * These are the shapes; the *values* (which species exist, what they grant)
 * live in content/rules.json, per the "content as data" rule in the roadmap.
 */

import type { ProfileFlair } from "../kid-profile.js";
import type { MatchupRules } from "./matchups.js";

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

/**
 * A hero's distinction in one class (docs/class-mastery.md §5), lowest first.
 * Each rank above `none` unlocks one more of the class's moves: Apprentice the
 * first, Expert the second, Master the third. The same three for every class.
 */
export type ClassRank = "none" | "apprentice" | "expert" | "master";

/** The ranks in order; a rank's index is how many class unlocks it grants. */
export const CLASS_RANKS: readonly ClassRank[] = ["none", "apprentice", "expert", "master"] as const;

/**
 * Every deed the game knows how to count (docs/class-mastery.md §6), each
 * read off events the game already produces (deeds.ts). Content picks which
 * of them a rank asks for, and how many; a deed id content names that is not
 * here is refused by `content:validate`, because nothing would ever count it.
 */
export const DEED_IDS = [
  // Thornguard
  "brace_friend",
  "hold_ground",
  "shove_off_friend",
  "shove",
  "bramble_wall_fight",
  // Duskrunner
  "new_target",
  "vanish_miss",
  "twin_step_finish",
  // Starweaver
  "burst_two",
  "burst_three",
  "glimmer_made",
  "tangle_guard",
  "tanglelight",
  // Songkeeper
  "song_hearts",
  // Every class: a class-only choice or a class way at a rift
  "class_story",
] as const;

export type DeedId = (typeof DEED_IDS)[number];

/**
 * The class whose move a deed is done with, or null for one any hero can do.
 * A rank that asks for another class's deed could never be earned, so
 * `content:validate` refuses it.
 */
export const DEED_OWNERS: Record<DeedId, ClassId | null> = {
  brace_friend: "thornguard",
  hold_ground: "thornguard",
  shove_off_friend: "thornguard",
  shove: "thornguard",
  bramble_wall_fight: "thornguard",
  new_target: "duskrunner",
  vanish_miss: "duskrunner",
  twin_step_finish: "duskrunner",
  burst_two: "starweaver",
  burst_three: "starweaver",
  glimmer_made: "starweaver",
  tangle_guard: "starweaver",
  tanglelight: "starweaver",
  song_hearts: "songkeeper",
  class_story: null,
};

/** One way to earn a rank: every deed in it, at least this many times. */
export type DeedTrack = Partial<Record<DeedId, number>>;

/**
 * What earns one rank (docs/class-mastery.md §6). Either track completes it:
 * `withFriends` at any table, and `alone`, when present, at any table too, so
 * a hero playing solo always has a way. Absent `alone` means the same deeds
 * serve both.
 */
export interface RankDeeds {
  withFriends: DeedTrack;
  alone?: DeedTrack;
}

/** Appearance tiers, in level order. See spec §8.1. */
export type TierId = "fledgling" | "sworn" | "radiant" | "mythic";

export const TIER_IDS: readonly TierId[] = ["fledgling", "sworn", "radiant", "mythic"] as const;

export type Stats = Record<StatId, number>;

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
 * What a hero has earned in one class (docs/class-mastery.md §5): kept for
 * every class they have ever worn, never lost by switching, and counted only
 * while that class is the one they wear.
 */
export interface ClassMastery {
  rank: ClassRank;
  /**
   * Partial progress toward the next rank, by deed id (`DeedId`): only the
   * deeds that rank asks for, each capped at the most any track asks. Kept
   * for every class, so a hero who switches away and back picks up exactly
   * where they left it. Emptied when a rank lands, since each rank is earned
   * afresh, and empty for good at Master.
   */
  deeds: Record<string, number>;
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
  /**
   * The class the hero is wearing: the one whose moves are on the phone and
   * whose deeds count. Picked at creation and changed only where
   * docs/class-mastery.md §1 allows. It lives here rather than on `Character`
   * so a failed campaign puts it back with everything else (spec §8.3), for
   * the same reason `unspentPoints` does.
   */
  class: ClassId;
  /**
   * Rank and deed progress per class (docs/class-mastery.md §5). A class
   * with no entry has rank `none` and no progress, which is every class the
   * hero has not worn. Here, beside `class`, so a failed campaign rolls back
   * ranks and deeds too.
   *
   * The class moves on the phone are derived from this and `class` in
   * `resolveCharacter()`, never stored: a hero's moves are their worn
   * class's signature plus one per rank.
   */
  mastery: Partial<Record<ClassId, ClassMastery>>;
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
  /**
   * She has had her one free fitting at the Exchange's fitting stall
   * (docs/class-mastery.md §1, #312): the class swap a new hero gets once.
   * Here, beside `class`, so a failed campaign that puts the old class back
   * gives the fitting back with it. Absent until then, and on every row
   * written before it existed. Only ever `true`.
   */
  fitted?: true;
  /**
   * The chapters that have paid her their XP, by chapter id (#408): a chapter
   * pays a hero once, ever, so replaying it in a new attempt, at another
   * table or in another campaign run pays her nothing more. An unseen chapter
   * (another road through Gemfall, say) still pays in full.
   *
   * Here, beside `xp`, for the reason `unspentPoints` is: a chapter paid
   * during a campaign that then fails is taken back with the XP it paid, so
   * she can earn it again; one paid in a completed campaign is hers for good.
   * Absent until a chapter pays her, and on every row written before it
   * existed (character schema v7), which reads as nothing paid yet.
   */
  paidChapters?: string[];
}

export interface ProvisionalProgress extends CharacterProgress {
  runId: string;
}

export interface Souvenir {
  id: string;
  fromRun: string;
  earnedAt: string;
}

/**
 * One campaign a hero has finished (#283, architecture §4.5, "Who owns what"):
 * her own record, kept on her row at her home whichever table she finished it
 * at. Written beside the commit of her provisional state, so only a campaign
 * that *completed* is here; a failed one leaves a souvenir instead.
 */
export interface FinishedCampaign {
  campaignId: string;
  /**
   * How its last chapter ended. A loss ending completes a campaign exactly as a
   * win does (spec §8.3), so both are finished.
   */
  outcome: "success" | "setback";
  /** ISO timestamp of the completion. */
  at: string;
  /** The household whose table she finished it at: her home, or one she visited. */
  table: string;
}

export interface Character {
  id: string;
  householdId: string;
  ownerPlayerId: string;
  name: string;
  species: SpeciesId;
  // No `class` (character schema v5, #308): the worn class is
  // `CharacterProgress.class`, so it rolls back with a failed campaign. Read
  // it as `classOf(character)` (character.ts).
  appearance: Appearance;
  committed: CharacterProgress;
  provisional?: ProvisionalProgress | null;
  /** Campaign-scoped, slot-free, cleared at campaign end. */
  questItems: string[];
  /** Permanent, cosmetic-only, grows on campaign failure. */
  souvenirs: Souvenir[];
  /**
   * The campaigns she has finished, one entry per campaign, the latest
   * completion kept (#283). Absent until she finishes one, and on every row
   * written before the record existed (character schema v3).
   */
  finished?: FinishedCampaign[];
  /**
   * She has played the practice (#255, architecture §4.5 "The practice"), so
   * the lobby stops offering it for her. Absent until then, and on every row
   * written before it existed (character schema v4). Only ever `true`.
   */
  practiced?: true;
  createdAt: string;
  /**
   * The row's monotonic version, which the claim conditions every write on
   * (#282, architecture §4.5, "One game at a time per hero: the claim"). The
   * claim itself is `provisional.runId`. The store sets this on every write;
   * nothing else does. Absent on rows written before it, which are version 0.
   */
  version?: number;
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
  /** The class the hero is wearing (`CharacterProgress.class`). */
  class: ClassId;
  /**
   * Their distinction in that class, for "Starweaver Apprentice" on screen.
   * Present only above `none`, so a hero with no rank resolves exactly as
   * before distinctions; and a run in flight across a deploy holds snapshots
   * resolved before it existed. Absent reads as `none`.
   */
  rank?: ClassRank;
  /**
   * The worn class's progress toward its next rank (`ClassMastery.deeds`),
   * where the fight engine starts counting from. Present only when something
   * has been counted, so a hero with none resolves exactly as before deeds.
   */
  deeds?: Record<string, number>;
  /**
   * The tokens of the classes the hero has worn and taken off, with the rank
   * each earned (docs/class-mastery.md §4): they ride in the pack with their
   * notches and take no slot. In rules order. Present only when there is one,
   * so a hero who has only ever worn one class resolves exactly as before.
   */
  spares?: { class: ClassId; rank: ClassRank }[];
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
   * `Character.practiced`, carried so the lobby can tell a newcomer
   * (`isNewcomer`, practice.ts). Present only when true, so a hero who never
   * played the practice resolves exactly as before it existed.
   */
  practiced?: true;
  /**
   * `CharacterProgress.fitted`, from the effective half, so the engine can
   * tell a hero who still has the fitting stall's swap (`isNewHero`,
   * class-place.ts). Present only when true, like `practiced`.
   */
  fitted?: true;
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
  // No role (#265): a profile is a player, nothing more. Authority comes from
  // signing in, or from being the device that opened a room, never from a
  // label on the profile. Rows written before this still carry `role`, and
  // nothing reads it.
  /**
   * An owner took this kid off the household's pickers (#248): a group's kid
   * who stopped coming. The profile and its heroes stay, and an owner can
   * bring it back; nobody can pick it or bind a phone to it until then.
   */
  retired?: true;
  /**
   * What she chose for her own page (#299): a color, a frame for each hero, a
   * title from her badges. Presets only, versioned (`PROFILE_FLAIR_VERSION`),
   * and read through `readFlair`. Seen by her own household and her own devices
   * and by nobody at a table; it goes with the profile when she is deleted or moves.
   */
  flair?: ProfileFlair;
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
  /**
   * The Cognito sub of the account that claimed or created it. `null` while
   * anonymous. A group (#248) may have more owners than this one: each is an
   * `ACCT#` pointer plus an `OWNER#` row, and the pointer is the authority.
   * This one is the founding owner, whom no other owner can remove.
   */
  ownerSub: string | null;
  /** True until an account claims it. Guests are swept; claimed ones never are. */
  guest: boolean;
  /** ISO. Present only while `guest` — when the sweeper may delete everything. */
  expiresAt?: string;
  createdAt: string;
  /**
   * The device that started this household, and the only one that may claim
   * it by signing in (#265). Knowing a room code gets a phone a seat, never the
   * household: a joiner is bound here too, so the claim has to name something a
   * joiner cannot be. `""` once a host has taken the founder out: nobody may
   * claim it. Absent only on a household made before this field existed,
   * which keeps the old rule (any device in it) until it expires.
   */
  founderDeviceId?: string;
  /**
   * Set at creation and cleared by the first device to found the household
   * (`founderDeviceId`). A phone that opens a room founds its household on the
   * spot; a TV's placeholder household is founded by the first phone to join,
   * the same phone that decides whose evening it is (`RoomRecord.claimable`).
   */
  awaitingFounder?: true;
  /**
   * How long a kid who stops playing is kept, in days (#252), set by a
   * signed-in owner. Absent is the behavior from before it existed: a kept
   * household keeps every kid until an owner deletes one. Only a kept
   * household has it; a guest household is swept whole a week after it last
   * played (`expiresAt`), whoever is in it.
   */
  retentionDays?: number;
}

/**
 * A device's binding (§4.5), one of two kinds (#250):
 *
 *   **personal** — one player's phone. The device token *is* that player.
 *   **shared**   — a family tablet. Bound to the household and nobody in it;
 *                  each kid picks themselves and gets only a room session.
 *
 * Bindings stored before #250 carry no `kind` and are personal.
 */
export type DeviceBinding = PersonalDeviceBinding | SharedDeviceBinding;

interface DeviceBindingBase {
  deviceId: string;
  householdId: string;
  tokenHash: string;
  lastSeen: string;
  userAgent?: string;
  revoked?: boolean;
}

export interface PersonalDeviceBinding extends DeviceBindingBase {
  kind?: "personal";
  playerId: string;
}

export interface SharedDeviceBinding extends DeviceBindingBase {
  kind: "shared";
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
  /**
   * The class's moves beyond the signature, keyed by the level that unlocked
   * each before distinctions (3, 6, 9). Since #308 the keys only order them:
   * the first is the Apprentice move, the second Expert, the third Master
   * (docs/class-mastery.md §5). The levels are still read where a level has
   * to become a rank: a hero joining at a tier floor (spec §8.4).
   */
  unlocks: Record<string, { id: string; name: string; text: string; icon: string }>;
  /**
   * What earns each rank (docs/class-mastery.md §6), counted by deeds.ts.
   * Optional so a class without any never ranks up, rather than refusing to
   * load; `content:validate` requires all three for every shipped class.
   */
  deeds?: Partial<Record<Exclude<ClassRank, "none">, RankDeeds>>;
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
  /**
   * Sides on the die a helper adds to a check, by the helper's tier: the d20
   * never changes, but the help you give grows as you do. Optional so rules
   * written before it existed fall back to `DEFAULT_HELP_DIE` (dice.ts).
   */
  helpDie?: Record<TierId, number>;
  species: Record<SpeciesId, SpeciesDef>;
  classes: Record<ClassId, ClassDef>;
  /**
   * The Exchange's fitting stall (docs/class-mastery.md §1, #312): where it
   * stands and what the shared screen says when it opens. Optional: rules
   * without it have no stall, and nobody is offered a fitting.
   */
  fittingStall?: FittingStall;
  /**
   * Who is good and bad against what (docs/matchups.md). Optional: rules
   * without it play with no matchups at all.
   */
  matchups?: MatchupRules;
}

/**
 * The fitting stall, where a new hero may swap class once, for free, to any
 * class (docs/class-mastery.md §1). It lives in the rules rather than in a
 * chapter because it is a rule about classes that stands in a place, and
 * the campaign that opens there (Gemfall) is pinned: naming its scene here
 * gives Gemfall the stall without editing a Gemfall file.
 */
export interface FittingStall {
  /**
   * The scenes it stands in: a scene at the Exchange that every party walks
   * through as its campaign opens. A Story or Choice Point scene, never an
   * ending, never a class place; `content:validate` refuses the rest.
   */
  stands: { chapterId: string; sceneId: string }[];
  /** The tailor's name, for the phone. The narration introduces her first. */
  keeper: string;
  /** What the shared screen says while the stall is open. */
  narration: string;
}
