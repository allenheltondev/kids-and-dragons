/**
 * The persistence half of progression — the step `engine.ts` has always
 * deferred to and nobody had written.
 *
 * The engine is pure and its `RunState` holds **resolved** characters, which
 * deliberately cannot express the committed/provisional split (see the comment
 * on `completeChapter`). So the engine records `xpEarned` on the run and stops.
 * Until this module existed, that was the end of it: XP accumulated on a run and
 * evaporated with it, `startCampaign()` was never called so nothing was ever
 * provisional, and `putCharacter()` had no caller at all — a character created
 * at the table lived in the run and was never written to the household.
 *
 * Everything here runs **after** the engine has applied an intent and **before**
 * the handler diffs the state, so any change to a party member's resolved
 * snapshot rides out on the same JSON Patch as the rest of the turn. Doing it
 * afterwards would persist correctly and show nobody.
 *
 * Both functions are deliberately tolerant of a missing stored character. A run
 * whose household row was swept, or a party member created before this module
 * existed, must not take the table down mid-session — the character on screen
 * keeps playing, it just does not accrue.
 */

import { awardXp, resolveCharacter, startCampaign, type RunState } from "@kad/shared";
import type { HandlerDeps } from "./deps.ts";

/**
 * Writes party characters that the household does not have yet.
 *
 * Called after `CREATE_CHARACTER`. The engine has already built and resolved the
 * character into `draft.party`; this is what makes it survive the run, which is
 * the entire promise of "characters hang off the household, not off a run"
 * (architecture §3).
 *
 * Create-if-absent rather than an unconditional write: a re-sent intent, or a
 * character that already exists from a previous campaign, must not have its
 * level reset to whatever the run happens to be holding.
 */
export async function persistNewCharacters(
  state: RunState,
  deps: HandlerDeps,
  householdId: string,
): Promise<void> {
  for (const member of state.party) {
    const existing = await deps.repo.getCharacter(householdId, member.character.id);
    if (existing) continue;

    await deps.repo.putCharacter({
      id: member.character.id,
      householdId,
      ownerPlayerId: member.playerId,
      name: member.character.name,
      species: member.character.species,
      class: member.character.class,
      appearance: member.character.appearance,
      committed: {
        level: member.character.level,
        xp: member.character.xp,
        stats: { ...member.character.stats },
        tier: member.character.tier,
        unlockedActions: [...member.character.actions],
        inventory: member.character.inventory.map((e) => ({ ...e })),
        unspentPoints: member.character.unspentPoints,
      },
      provisional: null,
      questItems: [...member.character.questItems],
      souvenirs: member.character.souvenirs.map((s) => ({ ...s })),
      createdAt: new Date(deps.now()).toISOString(),
    });
  }
}

/**
 * Folds a completed chapter's XP into every character in the party, and updates
 * the resolved snapshots the phones are mirroring.
 *
 * `state.xpEarned` is the whole award — base plus any bonus objectives, already
 * halved if the ending was a setback (spec §8.2) — and every character gets the
 * same number. That is not a simplification: XP is uniform *by design*, because
 * the reward for a level is a visible new body, and per-player XP would leave
 * one child visibly smaller than the rest of the party (spec §8.2).
 *
 * `startCampaign()` first, always. It is idempotent for a run, and calling it
 * here means a gain is provisional by construction — there is no path through
 * this function that writes an unrevertible level. Get that wrong and the
 * commitment rule silently stops being true: a campaign that later fails would
 * revert to a snapshot that had already absorbed the gains.
 */
export async function foldChapterXp(
  state: RunState,
  deps: HandlerDeps,
  householdId: string,
): Promise<void> {
  if (state.xpEarned <= 0) return;

  const rules = deps.content.rules();
  const items = deps.content.items();

  for (const member of state.party) {
    const stored = await deps.repo.getCharacter(householdId, member.character.id);
    if (!stored) continue;

    const { character } = awardXp(startCampaign(stored, state.runId), rules, state.xpEarned);
    await deps.repo.putCharacter(character);

    // Re-resolve so the level, tier, unlocked actions and the waiting stat
    // point reach the phones. The engine resolved this character once at
    // creation and never again, so without this the sheet would keep showing
    // the level she started the evening on.
    member.character = resolveCharacter(character, rules, items);
  }
}
