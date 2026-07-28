/**
 * Characters — the commitment rule, in code.
 *
 * architecture §3.1 / spec §8.2 store a character as a **committed** snapshot
 * plus **provisional** gains from the in-flight campaign:
 *
 *   success → provisional replaces committed, provisional cleared, quest cleared
 *   failure → provisional cleared, quest cleared, souvenir appended, committed untouched
 *   effective = provisional ?? committed
 *
 * The whole point of that shape is that there is *no* code path which partially
 * applies a failed campaign's gains. This module is the only place allowed to
 * read either half, and `resolveCharacter()` is the only place species bonuses,
 * trinket passives, tiers and derived combat numbers are applied. Anything
 * downstream sees a `ResolvedCharacter` and cannot tell where a bonus came from.
 */

import { STAT_IDS } from "./types/domain.js";
import type {
  Appearance,
  Character,
  CharacterProgress,
  ClassId,
  ItemCatalog,
  ProvisionalProgress,
  ResolvedCharacter,
  RulesContent,
  SpeciesId,
  Stats,
  TierId,
} from "./types/domain.js";
import { getClass, getSpecies, levelForXp, tierForLevel } from "./rules.js";

/** Thrown for creation payloads that break the rules. Callers map it to ILLEGAL. */
export class CharacterRuleError extends Error {
  override name = "CharacterRuleError";
}

// ---------------------------------------------------------------------------
// The commitment rule
// ---------------------------------------------------------------------------

/** architecture §3.1 — `provisional ?? committed`, resolved in exactly one place. */
export function effectiveProgress(character: Character): CharacterProgress {
  return character.provisional ?? character.committed;
}

/**
 * Seeds `provisional` from `committed` at the start of a campaign. Everything
 * earned from here is revertible until the campaign is completed.
 *
 * Idempotent for the same run: re-entering a run mid-campaign (a reconnect, a
 * second chapter) must not reset gains back to the committed snapshot.
 */
export function startCampaign(character: Character, runId: string): Character {
  if (character.provisional && character.provisional.runId === runId) {
    return character;
  }
  return {
    ...character,
    provisional: { ...cloneProgress(character.committed), runId },
  };
}

/** Campaign completed: the gains become who you are. spec §8.2. */
export function commitCampaign(character: Character): Character {
  const provisional = character.provisional;
  if (!provisional) {
    // Nothing in flight — still clear quest items, which are campaign-scoped
    // either way (§9.2).
    return { ...character, provisional: null, questItems: [] };
  }
  const { runId: _runId, ...progress } = provisional;
  return {
    ...character,
    committed: cloneProgress(progress),
    provisional: null,
    questItems: [],
  };
}

/**
 * Campaign failed or abandoned: revert to the committed snapshot and keep a
 * souvenir. The souvenir is the *point* — a failed campaign still leaves a
 * visible mark. It is cosmetic and never mechanical, so it lands nowhere near
 * `committed`.
 */
export function failCampaign(
  character: Character,
  souvenirId: string,
  earnedAt: string,
): Character {
  const fromRun = character.provisional?.runId ?? "";
  return {
    ...character,
    provisional: null,
    questItems: [],
    souvenirs: [...character.souvenirs, { id: souvenirId, fromRun, earnedAt }],
  };
}

function cloneProgress(progress: CharacterProgress): CharacterProgress {
  return {
    level: progress.level,
    xp: progress.xp,
    stats: { ...progress.stats },
    tier: progress.tier,
    unlockedActions: [...progress.unlockedActions],
    inventory: progress.inventory.map((e) => ({ ...e })),
  };
}

// ---------------------------------------------------------------------------
// Creation — spec §5
// ---------------------------------------------------------------------------

export interface NewCharacterInput {
  id: string;
  householdId: string;
  ownerPlayerId: string;
  name: string;
  species: SpeciesId;
  class: ClassId;
  /**
   * Points the player assigned at creation, per stat — the deltas from a
   * tap-to-increment UI, *not* the final block. `rules.baseStats` is added
   * here and the species bonus is applied at resolve time.
   */
  stats: Stats;
  appearance: Appearance;
  rules: RulesContent;
  /** ISO timestamp; the caller owns the clock so the engine stays pure. */
  now: string;
}

/**
 * Builds a level-1 character. This runs on the server against a payload from a
 * phone, so every arithmetic claim in it is checked: the creation budget is
 * exactly `rules.creationPoints` (spec §5 step 3) and nothing goes negative.
 */
export function newCharacter(input: NewCharacterInput): Character {
  const { rules } = input;
  getSpecies(rules, input.species);
  getClass(rules, input.class);

  if (!input.name.trim()) {
    throw new CharacterRuleError("character: name is required");
  }

  let assigned = 0;
  const stats = {} as Stats;
  for (const stat of STAT_IDS) {
    const points = input.stats[stat];
    if (!Number.isInteger(points)) {
      throw new CharacterRuleError(
        `character: ${stat} must be a whole number of points (got ${String(points)})`,
      );
    }
    if (points < 0) {
      throw new CharacterRuleError(
        `character: cannot assign negative points to ${stat} (got ${points})`,
      );
    }
    const base = rules.baseStats[stat];
    const total = base + points;
    if (total < 0) {
      throw new CharacterRuleError(`character: ${stat} would end up negative (${total})`);
    }
    stats[stat] = total;
    assigned += points;
  }

  if (assigned !== rules.creationPoints) {
    throw new CharacterRuleError(
      `character: must spend exactly ${rules.creationPoints} creation points (spent ${assigned})`,
    );
  }

  const classDef = getClass(rules, input.class);
  const committed: CharacterProgress = {
    level: 1,
    xp: 0,
    stats,
    tier: tierForLevel(rules, 1),
    // The signature action is yours from level 1 (spec §4.3); level unlocks are
    // appended by awardXp and recomputed defensively in resolveCharacter.
    unlockedActions: [classDef.signature.id],
    inventory: [],
  };

  return {
    id: input.id,
    householdId: input.householdId,
    ownerPlayerId: input.ownerPlayerId,
    name: input.name.trim(),
    species: input.species,
    class: input.class,
    appearance: input.appearance,
    committed,
    provisional: null,
    questItems: [],
    souvenirs: [],
    createdAt: input.now,
  };
}

// ---------------------------------------------------------------------------
// Resolution — the one place the rules are applied
// ---------------------------------------------------------------------------

/** Class actions unlocked at or below `level`, in level order. */
function levelUnlocks(rules: RulesContent, classId: ClassId, level: number): string[] {
  const classDef = getClass(rules, classId);
  return Object.entries(classDef.unlocks)
    .map(([at, action]) => ({ at: Number(at), id: action.id }))
    .filter((u) => Number.isFinite(u.at) && level >= u.at)
    .sort((a, b) => a.at - b.at)
    .map((u) => u.id);
}

export function resolveCharacter(
  character: Character,
  rules: RulesContent,
  items: ItemCatalog,
): ResolvedCharacter {
  const progress = effectiveProgress(character);
  const species = getSpecies(rules, character.species);
  const classDef = getClass(rules, character.class);

  const stats = { ...progress.stats } as Stats;
  let maxHp = rules.baseMaxHp;
  let steps = classDef.baseSteps ?? rules.baseSteps;

  // Species passive: either a stat bump or extra max HP (spec §4.2).
  if (species.passive.stat) {
    stats[species.passive.stat] += species.passive.amount;
  }
  if (typeof species.passive.maxHp === "number") {
    maxHp += species.passive.maxHp;
  }

  // Trinket passives are always on (spec §9.2). An item id that has fallen out
  // of the catalog is skipped rather than thrown on: a stale save must not take
  // the table down mid-session.
  for (const entry of progress.inventory) {
    const def = items[entry.itemId];
    if (!def || def.kind !== "trinket" || !def.passive) continue;
    const passive = def.passive;
    switch (passive.type) {
      case "statBonus":
        stats[passive.stat] += passive.amount;
        break;
      case "stepBonus":
        steps += passive.amount;
        break;
      case "maxHpBonus":
        maxHp += passive.amount;
        break;
      case "rerollOnes":
        // Consumed inside an encounter (chapter 4); nothing to fold in here.
        break;
    }
  }

  const level = progress.level;
  const actions = [
    classDef.signature.id,
    ...levelUnlocks(rules, character.class, level),
    // Once per encounter, the combat-flavored world ability (spec §7.2).
    species.combatAction.id,
    // Anything the stored progress knows about that the rules no longer do.
    ...progress.unlockedActions,
  ];

  return {
    id: character.id,
    ownerPlayerId: character.ownerPlayerId,
    name: character.name,
    species: character.species,
    class: character.class,
    appearance: character.appearance,
    level,
    xp: progress.xp,
    // Derived, never trusted from storage: a hand-edited tier can't lie.
    tier: tierForLevel(rules, level),
    stats,
    maxHp,
    steps,
    // Quick governs dodging (spec §4.1), so it is what an attacker rolls against.
    guard: rules.baseGuard + stats.quick,
    attackStat: classDef.stat,
    actions: [...new Set(actions)],
    worldAbility: species.worldAbility.id,
    inventory: progress.inventory.map((e) => ({ ...e })),
    questItems: [...character.questItems],
    souvenirs: character.souvenirs.map((s) => ({ ...s })),
    isProvisional: Boolean(character.provisional),
  };
}

// ---------------------------------------------------------------------------
// Progression — spec §8.1
// ---------------------------------------------------------------------------

export interface AwardXpResult {
  character: Character;
  /** Set only when the award crossed a level boundary. */
  leveledTo?: number;
  /** Set only when the new level is an appearance tier — the cutscene trigger. */
  newTier?: TierId;
}

/**
 * XP is awarded per chapter, not per kill (spec §8.1), so this is called once
 * at chapter completion.
 *
 * It writes to `provisional` when a campaign is in flight and to `committed`
 * otherwise — meaning: call `startCampaign()` first, always, or the gain is
 * immediate and cannot be reverted. The stat point each level grants is *not*
 * assigned here; the player spends it at a Rest scene (spec §6.1).
 */
export function awardXp(
  character: Character,
  rules: RulesContent,
  amount: number,
): AwardXpResult {
  const before = effectiveProgress(character);
  const xp = Math.max(0, before.xp + amount);
  const level = levelForXp(rules, xp);
  const tier = tierForLevel(rules, level);

  const unlocked = new Set(before.unlockedActions);
  for (const id of levelUnlocks(rules, character.class, level)) unlocked.add(id);

  const next: CharacterProgress = {
    ...cloneProgress(before),
    xp,
    level,
    tier,
    unlockedActions: [...unlocked],
  };

  const updated: Character = character.provisional
    ? {
        ...character,
        provisional: { ...next, runId: character.provisional.runId } as ProvisionalProgress,
      }
    : { ...character, committed: next };

  return {
    character: updated,
    ...(level > before.level ? { leveledTo: level } : {}),
    ...(tier !== before.tier && level > before.level ? { newTier: tier } : {}),
  };
}
