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

import { awardXp, resolveCharacter, startCampaign, type Character, type RunState } from "@kad/shared";
import type { HandlerDeps } from "./deps.ts";

/**
 * The character rows a completed chapter owes, ready for the run's own commit.
 *
 * Nothing here writes. Both of these used to call `putCharacter` directly, and
 * that was wrong in a way only a race shows: the writes landed *before* the
 * conditional run commit, so two phones tapping the chapter's last choice in
 * the same millisecond would both award XP, one run commit would lose on seq,
 * and the loser's XP stayed on the character anyway. A retry after a transient
 * commit failure double-awarded the same chapter for the same reason.
 *
 * Returning the rows instead lets `applyAction` hand them to `repo.commit()`,
 * which already writes the state and the event as one conditional transaction.
 * Either the whole turn lands or none of it does.
 */

/**
 * The character a `CREATE_CHARACTER` intent just built, ready to store.
 *
 * Takes the engine's **unresolved** `Character` (`EngineResult.created`) rather
 * than reading `state.party`. That is the whole point: a party member holds a
 * `ResolvedCharacter`, which already has the species passive folded into its
 * stats, and reconstructing a `Character` from one would save the passive as
 * part of the base — so the next `resolveCharacter()` would apply it a second
 * time and leave a unicorn permanently a point of Heart up.
 *
 * Create-if-absent still, so a re-sent intent cannot flatten a character that
 * already exists back to the level the run happens to be holding.
 */
export async function newCharacterWrite(
  created: Character,
  deps: HandlerDeps,
  householdId: string,
): Promise<Character[]> {
  if (created.householdId !== householdId) {
    // The engine builds this from `ctx.householdId`, so a mismatch means the
    // handler and the engine disagree about whose run this is.
    throw new Error(`character ${created.id} belongs to ${created.householdId}, not ${householdId}`);
  }
  const existing = await deps.repo.getCharacter(householdId, created.id);
  return existing ? [] : [created];
}

/**
 * Folds a completed chapter's XP into every character in the party, updates the
 * resolved snapshots the phones mirror, and returns the rows to write.
 *
 * `state.xpEarned` is the whole award — base plus bonus objectives, already
 * halved if the ending was a setback (spec §8.2) — and every character gets the
 * same number. XP is uniform *by design*: the reward for a level is a visible
 * new body, and per-player XP would leave one child visibly smaller than the
 * rest of the party (spec §8.2).
 *
 * `startCampaign()` first, always. It is idempotent for a run, and calling it
 * here means a gain is provisional by construction — there is no path through
 * this function that writes an unrevertible level. Get that wrong and the
 * commitment rule silently stops being true.
 */
export async function foldChapterXp(
  state: RunState,
  deps: HandlerDeps,
  householdId: string,
): Promise<Character[]> {
  if (state.xpEarned <= 0) return [];

  const rules = deps.content.rules();
  const items = deps.content.items();
  const writes: Character[] = [];

  for (const member of state.party) {
    const stored = await deps.repo.getCharacter(householdId, member.character.id);
    // A swept household, or a member created before any of this existed. The
    // character on screen keeps playing; it just does not accrue. Throwing here
    // would end the session at the table.
    if (!stored) continue;

    const { character } = awardXp(startCampaign(stored, state.runId), rules, state.xpEarned);
    writes.push(character);

    // Re-resolve so the level, tier, unlocked actions and the waiting stat
    // point reach the phones. The engine resolved this character once at
    // creation and never again, so without this the sheet would keep showing
    // the level she started the evening on.
    member.character = resolveCharacter(character, rules, items);
  }
  return writes;
}
