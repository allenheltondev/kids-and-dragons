/**
 * The real binding: the engine port → `@kad/shared`.
 *
 * This is the **only** file in the server that imports the game rules, so if
 * `applyIntent`'s signature moves, exactly one file stops compiling. It also
 * hands back `makeRng`, because the dice must come from the same module as the
 * rules that consume them — a second PRNG in the server would mean a replay
 * could roll differently from the run it is replaying (architecture §4.1).
 *
 * This module still loads the shared implementation lazily: health, static,
 * and SSE routes remain available while game rules are being edited. The same
 * runtime owns progression mutations so chapter settlement cannot accidentally
 * bind a second copy of the rules package.
 */

import type {
  AwardXpResult,
  Character,
  Chapter,
  ClassId,
  ClassMastery,
  ItemCatalog,
  ProgressionAward,
  ResolvedCharacter,
  Rng,
  RulesContent,
  RunState,
} from "@kad/shared";
import type { CharacterWrite, GameRepository } from "../store/repository.ts";
import type { Engine } from "./port.ts";

export interface SharedRuntime {
  engine: Engine;
  rng: (seed: string | number) => Rng;
  progression: {
    startCampaign(character: Character, runId: string): Character;
    syncRunInventory(
      character: Character,
      inventory: readonly Character["committed"]["inventory"][number][],
      questItems: readonly string[],
    ): Character;
    awardXp(character: Character, rules: RulesContent, amount: number): AwardXpResult;
    foldRunDeeds(character: Character, counted: Partial<Record<ClassId, ClassMastery>> | undefined): Character;
    resolveCharacter(character: Character, rules: RulesContent, items: ItemCatalog): ResolvedCharacter;
  };
}

let cached: Promise<SharedRuntime> | null = null;

export function loadSharedRuntime(): Promise<SharedRuntime> {
  if (!cached) {
    const pending = import("@kad/shared").then((shared) => ({
      engine: {
        applyIntent: shared.applyIntent,
        createRunState: shared.createRunState,
      },
      rng: shared.makeRng,
      progression: {
        startCampaign: shared.startCampaign,
        syncRunInventory: shared.syncRunInventory,
        awardXp: shared.awardXp,
        foldRunDeeds: shared.foldRunDeeds,
        resolveCharacter: shared.resolveCharacter,
      },
    }));
    // Drop a failed load so the next request retries the (possibly fixed) module.
    pending.catch(() => {
      if (cached === pending) cached = null;
    });
    cached = pending;
  }
  return cached;
}

/**
 * The authoritative XP total already settled by the engine for this chapter.
 *
 * `RunState.xpEarned` includes authored `grantXp` effects as well as the
 * success/setback base and paid objectives. Reconstructing it from chapter
 * content here would silently drop effects accumulated earlier in the run.
 */
export function computeChapterXp(state: RunState, _chapter: Chapter): number {
  return state.xpEarned;
}

export interface AwardChapterXpInput {
  state: RunState;
  chapter: Chapter;
  /** The run's household. A visiting member's row is read from its own (`PartyMember.homeHouseholdId`). */
  householdId: string;
  repo: Pick<GameRepository, "getCharacter">;
  rules: RulesContent;
  items: ItemCatalog;
  /**
   * The claim this table's campaign stamps on a stored hero (#282, handlers/
   * claim.ts). Defaults to the campaign id, which is the claim at home.
   */
  claim?: (row: Character) => string;
  /**
   * Whether this table may write a stored hero at all. A hero another
   * adventure holds is left as she is: nothing folded, nothing written.
   */
  admit?: (row: Character) => Promise<boolean>;
}

export interface AwardChapterXpResult {
  characters: Character[];
  /** `characters`, each conditioned on the row as it was read (#282). */
  writes: CharacterWrite[];
  awards: ProgressionAward[];
}

/**
 * Builds every character row and UI trigger owed by a chapter completion.
 * Inventory is always synchronized; XP mutation and award triggers are skipped
 * when the authored total is not positive.
 */
export async function awardChapterXpDetails(
  input: AwardChapterXpInput,
): Promise<AwardChapterXpResult> {
  const amount = computeChapterXp(input.state, input.chapter);
  const { progression } = await loadSharedRuntime();
  const stored = await Promise.all(
    input.state.party.map(async (member) => {
      try {
        // The member's own household: the room's, or a visitor's (#249).
        return await input.repo.getCharacter(member.homeHouseholdId ?? input.householdId, member.character.id);
      } catch (err) {
        console.error(`awardChapterXp: skipping character ${member.character.id}:`, err);
        return null;
      }
    }),
  );

  const characters: Character[] = [];
  const writes: CharacterWrite[] = [];
  const awards: ProgressionAward[] = [];
  for (const [index, member] of input.state.party.entries()) {
    const row = stored[index];
    if (!row) continue;
    if (input.admit && !(await input.admit(row))) continue;

    const campaignId = input.state.campaignId;
    const target = campaignId
      ? progression.startCampaign(row, input.claim ? input.claim(row) : campaignId)
      : row;
    // The deeds this chapter counted (#310), folded beside the bag and the
    // XP and under the same rule: provisional while a campaign is in flight.
    const carried = progression.foldRunDeeds(
      progression.syncRunInventory(target, member.character.inventory, member.character.questItems),
      input.state.deeds?.heroes[member.character.id],
    );
    const awarded: AwardXpResult =
      amount > 0 ? progression.awardXp(carried, input.rules, amount) : { character: carried };
    characters.push(awarded.character);
    writes.push({
      character: awarded.character,
      expectedVersion: row.version ?? 0,
      expectedClaim: row.provisional?.runId ?? null,
    });
    if (amount > 0) {
      awards.push({
        characterId: awarded.character.id,
        ...(awarded.leveledTo !== undefined ? { leveledTo: awarded.leveledTo } : {}),
        ...(awarded.newTier !== undefined ? { newTier: awarded.newTier } : {}),
      });
    }
    member.character = progression.resolveCharacter(awarded.character, input.rules, input.items);
  }
  // Folded: the heroes carry them now. Left on the run, a campaign that fails
  // at this completion would have the reverted heroes re-dressed in them.
  delete input.state.deeds;
  return { characters, writes, awards };
}

/**
 * Backward-compatible row-only surface used by existing persistence callers.
 * New response assembly uses `awardChapterXpDetails()` so award metadata is not
 * discarded before the broadcast is built.
 */
export async function awardChapterXp(input: AwardChapterXpInput): Promise<Character[]> {
  return (await awardChapterXpDetails(input)).characters;
}
