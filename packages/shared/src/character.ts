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
  StatId,
  Stats,
  TierId,
} from "./types/domain.js";
import { getClass, getSpecies, levelForXp, maxLevel, tierForLevel } from "./rules.js";

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
    // Normalized on the way through: a character stored before unspent points
    // existed comes back without the field, and the arithmetic downstream must
    // never see `undefined + 1`.
    unspentPoints: progress.unspentPoints ?? 0,
  };
}

/**
 * Writes progress to `provisional` when a campaign is in flight and to
 * `committed` otherwise. Every mutation in this module goes through here so
 * there is exactly one answer to "is this gain revertible?" — a second copy of
 * this branch is how a stat point earned mid-campaign ends up permanent.
 */
function writeProgress(character: Character, next: CharacterProgress): Character {
  return character.provisional
    ? {
        ...character,
        provisional: { ...next, runId: character.provisional.runId } as ProvisionalProgress,
      }
    : { ...character, committed: next };
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
  /**
   * Joining a party already underway (spec §8.4): level 1, or the party's tier
   * floor — 1, 4, 7, 10 and nothing in between. Defaults to 1.
   */
  startingLevel?: number;
  /** ISO timestamp; the caller owns the clock so the engine stays pure. */
  now: string;
}

/**
 * Builds a new character, at level 1 or at a tier floor (spec §8.4). This runs
 * on the server against a payload from a phone, so every arithmetic claim in it
 * is checked: the creation budget is exactly `rules.creationPoints` (spec §5
 * step 3), nothing goes negative, and the starting level is one of the four the
 * spec allows rather than any number the client felt like sending.
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

  const level = startingLevel(input);
  const classDef = getClass(rules, input.class);
  const committed: CharacterProgress = {
    level,
    // The threshold, never 0. A level-7 character carrying 0 XP is one chapter
    // award away from being level 1 again, because level is derived from XP and
    // not the other way around (spec §8.4).
    xp: xpForLevel(rules, level),
    stats,
    tier: tierForLevel(rules, level),
    // The signature action is yours from level 1 (spec §4.3); a character that
    // joins above 1 also owns everything its level already unlocked, exactly as
    // if it had earned them. Later unlocks are appended by awardXp and
    // recomputed defensively in resolveCharacter.
    unlockedActions: [
      ...new Set([classDef.signature.id, ...levelUnlocks(rules, input.class, level)]),
    ],
    inventory: [],
    // One point per level gained, the same as if those levels had been earned
    // (spec §8.4 "arithmetically identical") — so a level-7 join sits down with
    // six points to spend and no other compensation of any kind.
    unspentPoints: level - 1,
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

/**
 * spec §8.4 — a joining character starts at level 1 or at the party's tier
 * floor, "nothing in between". The floors are read out of content rather than
 * spelled 1/4/7/10 here, so retuning the tiers cannot leave this check behind.
 * An out-of-range value is rejected as hard as a bad creation budget is: it
 * arrives from a phone and decides how strong the character is forever.
 */
function startingLevel(input: NewCharacterInput): number {
  const level = input.startingLevel ?? 1;
  const floors = [...new Set([1, ...Object.values(input.rules.tierLevels)])].sort((a, b) => a - b);
  if (!Number.isInteger(level) || !floors.includes(level)) {
    throw new CharacterRuleError(
      `character: startingLevel must be 1 or a tier floor (${floors.join(", ")}) — ` +
        `got ${String(input.startingLevel)}`,
    );
  }
  return level;
}

/**
 * Total XP a level is worth. `levelXp[n]` is the total needed to *reach* level
 * `n + 2`, so level 1 is the zero case and every other level is a lookup —
 * derived rather than duplicated so a retuned curve moves the join with it.
 */
function xpForLevel(rules: RulesContent, level: number): number {
  if (level <= 1) return 0;
  const threshold = rules.levelXp[level - 2];
  if (threshold === undefined) {
    throw new CharacterRuleError(
      `character: rules define no XP for level ${level} (the curve stops at ${maxLevel(rules)})`,
    );
  }
  return threshold;
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
 * immediate and cannot be reverted. The stat point each level grants is banked
 * as `unspentPoints`, not assigned to a stat here; the player chooses where it
 * goes at a Rest scene, via `spendStatPoint()` (spec §6.1, §8.1).
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
    // One point per level *gained*, not one per award: a big chapter that jumps
    // three levels owes three points, and a level that a setback's half award
    // failed to reach owes none (spec §8.1).
    unspentPoints: (before.unspentPoints ?? 0) + Math.max(0, level - before.level),
  };

  return {
    character: writeProgress(character, next),
    ...(level > before.level ? { leveledTo: level } : {}),
    ...(tier !== before.tier && level > before.level ? { newTier: tier } : {}),
  };
}

/**
 * Spends one banked stat point on `stat`. Levelling banks the point (spec
 * §8.1); this is the Rest scene where the player decides what it becomes.
 *
 * Follows `awardXp` into `provisional` while a campaign is in flight, which is
 * the whole reason `unspentPoints` sits next to `stats`: revert has to take the
 * point and the stat it bought at the same time, or a failed campaign leaves
 * behind a permanent +1 nobody earned (spec §8.3).
 *
 * Both refusals are hard errors rather than no-ops. A spend that silently does
 * nothing looks, on a phone, exactly like a spend that worked.
 */
export function spendStatPoint(
  character: Character,
  rules: RulesContent,
  stat: StatId,
): Character {
  // The stat id crosses the wire as a string; a typo must not quietly create a
  // fifth stat on the sheet that nothing else in the game reads.
  if (!STAT_IDS.includes(stat) || typeof rules.baseStats[stat] !== "number") {
    throw new CharacterRuleError(`character: unknown stat "${String(stat)}"`);
  }

  const before = effectiveProgress(character);
  const available = before.unspentPoints ?? 0;
  if (available < 1) {
    throw new CharacterRuleError("character: no unspent stat points to spend");
  }

  const next: CharacterProgress = {
    ...cloneProgress(before),
    stats: { ...before.stats, [stat]: before.stats[stat] + 1 },
    unspentPoints: available - 1,
  };

  return writeProgress(character, next);
}
