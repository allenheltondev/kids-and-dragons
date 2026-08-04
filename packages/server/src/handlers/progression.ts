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

import {
  CharacterRuleError,
  commitCampaign,
  failCampaign,
  resolveCharacter,
  spendStatPoint as applyStatPointSpend,
  startCampaign,
  type Character,
  type Chapter,
  type ProgressionAward,
  type RunState,
  type StatId,
} from "@kad/shared";
import {
  awardChapterXp,
  awardChapterXpDetails,
  computeChapterXp,
  type AwardChapterXpResult,
} from "../engine/shared-engine.ts";
import { fail, iso, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import type { CampaignProgressRecord, ChapterProgressRecord } from "../store/repository.ts";

/**
 * The identity a provisional gain is scoped to.
 *
 * The campaign, not the room. `startCampaign()` re-seeds `provisional` from
 * `committed` whenever the identity changes, and a room — and therefore its
 * `runId` — lives for one evening. Scoping to the run meant Saturday's fresh
 * room quietly threw away Tuesday's provisional levels: every character was
 * permanently level 1 plus whatever the current sitting had earned. Campaigns
 * run 4–8 chapters across weeks (spec §8.1); the gains have to survive the
 * rooms they were earned in, and revert only when the *campaign* fails.
 *
 * `campaignId` is null for a one-off chapter, where the run really is the
 * campaign — so the fallback keeps the old scope exactly there.
 */
function campaignKey(state: RunState): string {
  return state.campaignId ?? state.runId;
}

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
 * Folds a completed chapter's gains — XP *and* the bag — into every character
 * in the party, updates the resolved snapshots the phones mirror, and returns
 * the rows to write.
 *
 * The award is the engine-settled `state.xpEarned` total. It already includes
 * authored `grantXp` effects, the success/setback base, and paid objectives;
 * recomputing any subset here would make persisted progression disagree with
 * the chapter-completion presentation.
 *
 * The inventory rides along because the engine's grants and swaps land on the
 * run's resolved characters and nowhere else (`syncRunInventory`). This fold
 * therefore runs even when no XP is awarded, so chapter items are not lost.
 *
 * When `campaignId` is present, the shared progression flow calls
 * `startCampaign()` before syncing inventory and awarding XP, keeping both
 * changes provisional. One-off chapters write directly to committed state.
 */
export async function foldChapterXp(
  state: RunState,
  deps: HandlerDeps,
  householdId: string,
  chapter: Chapter | null = state.chapterId ? deps.content.chapter(state.chapterId) : null,
): Promise<Character[]> {
  if (!chapter) return [];

  return awardChapterXp({
    state,
    chapter,
    householdId,
    repo: deps.repo,
    rules: deps.content.rules(),
    items: deps.content.items(),
  });
}

/** Row writes plus per-character level/tier triggers for response assembly. */
async function foldChapterXpDetails(
  state: RunState,
  deps: HandlerDeps,
  householdId: string,
  chapter: Chapter | null,
): Promise<AwardChapterXpResult> {
  if (!chapter) return { characters: [], awards: [] };

  return awardChapterXpDetails({
    state,
    chapter,
    householdId,
    repo: deps.repo,
    rules: deps.content.rules(),
    items: deps.content.items(),
  });
}

/**
 * Starts (or re-enters) the campaign for every stored party character and
 * immediately refreshes the resolved snapshots carried by the run.
 *
 * This runs on the successful `START_CHAPTER` action, before the state diff and
 * conditional commit. Waiting until chapter completion to seed provisional
 * state leaves the whole first chapter displaying committed progression and
 * misses the required campaign-start response entirely.
 */
export async function startPartyCampaign(
  state: RunState,
  deps: HandlerDeps,
  householdId: string,
): Promise<Character[]> {
  if (!state.campaignId) return [];
  return transformParty(state, deps, householdId, [], (character) => character);
}

/** Spec §8.3's default. A campaign may tune it (`Campaign.setbackLimit`). */
const DEFAULT_SETBACK_LIMIT = 3;

/** Everything a chapter completion owes the store, for one `repo.commit()`. */
export interface ChapterSettlement {
  characters: Character[];
  /** Award metadata retained for level-up and tier-transformation UI triggers. */
  awards: ProgressionAward[];
  chapterProgress?: ChapterProgressRecord;
  campaignProgress?: CampaignProgressRecord;
  campaignProgressExpectedVersion?: number | null;
}

/**
 * The campaign boundary — the half of the commitment rule that was never
 * wired. `startCampaign()` has always made gains provisional on the way in;
 * nothing ever called `commitCampaign()` or `failCampaign()`, so provisional
 * was where progress went to wait forever (roadmap chapter 5's "armed in one
 * direction only").
 *
 * On every chapter completion this settles three things:
 *
 *  1. **The chapter's record** — outcome and XP, persisted so §8.3's setback
 *     count survives the run it happened in.
 *  2. **The attempt's counter** — `CampaignProgressRecord`, read here and
 *     written back through the same seq-gated commit, which is what makes the
 *     read-modify-write safe against two phones finishing the chapter at once.
 *  3. **The campaign's fate, if this completion decides it** — the setback
 *     limit reached fails it (revert to committed, keep a souvenir, spec
 *     §8.3); completing the final chapter commits it (the gains become who
 *     you are). Everything in between stays provisional, exactly as before.
 *
 * A chapter with no campaign, or a campaign the content set does not know,
 * settles only the XP and its own record. Committing on a guess would make
 * gains permanent that a failed campaign was supposed to take back — the safe
 * failure is to keep them provisional.
 */
export async function settleChapterCompletion(
  state: RunState,
  deps: HandlerDeps,
  householdId: string,
): Promise<ChapterSettlement> {
  const now = iso(deps.now());
  const outcome = state.chapterOutcome ?? "success";
  const chapter = state.chapterId ? deps.content.chapter(state.chapterId) : null;
  const award = await foldChapterXpDetails(state, deps, householdId, chapter);
  const characters = award.characters;
  const xpEarned = chapter ? computeChapterXp(state, chapter) : 0;

  const chapterProgress: ChapterProgressRecord | undefined = chapter
    ? {
        runId: state.runId,
        index: chapter.index,
        chapterId: chapter.id,
        status: "complete",
        outcome,
        xpEarned,
        updatedAt: now,
      }
    : undefined;

  const campaignId = state.campaignId;
  const campaign = campaignId ? deps.content.campaign(campaignId) : null;
  if (!campaignId || !campaign || !chapter) {
    return { characters, awards: award.awards, ...(chapterProgress ? { chapterProgress } : {}) };
  }

  /*
   * The attempt. A record whose status is `complete` or `failed` is a finished
   * attempt — starting to count from it again would make a replayed campaign
   * inherit its own history and insta-fail (see CampaignProgressRecord).
   */
  const existing = await deps.repo.getCampaignProgress(householdId, campaignId);
  // The run seq serializes one room. This version serializes the household row
  // across rooms, so two campaign evenings cannot overwrite each other's count.
  const campaignProgressExpectedVersion = existing ? (existing.version ?? 0) : null;
  const version = (existing?.version ?? 0) + 1;
  const attempt: CampaignProgressRecord =
    existing && existing.status === "active"
      ? { ...existing, version, updatedAt: now }
      : { householdId, campaignId, status: "active", setbacks: 0, version, updatedAt: now };
  if (outcome === "setback") attempt.setbacks += 1;

  const limit = campaign.setbackLimit ?? DEFAULT_SETBACK_LIMIT;
  const finalChapter = campaign.chapters[campaign.chapters.length - 1] === chapter.id;

  if (attempt.setbacks >= limit) {
    attempt.status = "failed";
    return {
      characters: await transformParty(state, deps, householdId, characters, (c) => {
        // The souvenir reads the tier *before* the revert takes it away —
        // "she goes back to Fledgling and keeps something visible that says
        // she was Sworn once" (spec §8.3). The id is a display key for the
        // souvenir art roadmap chapter 5 commissions.
        const reached = c.provisional?.tier;
        const flavored = reached && reached !== c.committed.tier;
        return failCampaign(c, flavored ? `${campaignId}#${reached}` : campaignId, now);
      }),
      awards: award.awards,
      ...(chapterProgress ? { chapterProgress } : {}),
      campaignProgress: attempt,
      campaignProgressExpectedVersion,
    };
  }

  if (finalChapter) {
    attempt.status = "complete";
    return {
      characters: await transformParty(state, deps, householdId, characters, commitCampaign),
      awards: award.awards,
      ...(chapterProgress ? { chapterProgress } : {}),
      campaignProgress: attempt,
      campaignProgressExpectedVersion,
    };
  }

  return {
    characters,
    awards: award.awards,
    ...(chapterProgress ? { chapterProgress } : {}),
    campaignProgress: attempt,
    campaignProgressExpectedVersion,
  };
}

/**
 * Applies a campaign-fate transform to every stored party character.
 *
 * Starts from the XP writes when they exist and loads the rest — a final
 * chapter can award zero XP and still has to commit, so "who gets
 * transformed" cannot be "whoever happened to earn something". Every base is
 * passed through `startCampaign()` first so a provisional left over from some
 * *other* campaign can never be committed or failed at this one's boundary —
 * re-seeding discards it, which is what the one-campaign-in-flight model says
 * should happen.
 */
async function transformParty(
  state: RunState,
  deps: HandlerDeps,
  householdId: string,
  awarded: Character[],
  fate: (character: Character) => Character,
): Promise<Character[]> {
  const rules = deps.content.rules();
  const items = deps.content.items();
  const byId = new Map(awarded.map((c) => [c.id, c]));
  const writes: Character[] = [];

  for (const member of state.party) {
    let base = byId.get(member.character.id) ?? null;
    if (!base) {
      try {
        base = await deps.repo.getCharacter(householdId, member.character.id);
      } catch (err) {
        // Same policy as foldChapterXp: one bad row must not take the table
        // down at the moment the campaign ends.
        console.error(`settle: skipping character ${member.character.id}:`, err);
      }
      if (!base) continue;
    }
    const settled = fate(startCampaign(base, campaignKey(state)));
    writes.push(settled);
    // The revert (or the commit) has to reach the phones on the same patch —
    // a failed campaign whose party still *looks* levelled is a lie the next
    // chapter would expose anyway.
    member.character = resolveCharacter(settled, rules, items);
  }
  return writes;
}


// ---------------------------------------------------------------------------
// Rest-scene stat spending
// ---------------------------------------------------------------------------

export interface PreparedStatPointSpend {
  /** The unresolved durable row written by the run transaction. */
  character: Character;
  /** A fresh run snapshot whose party member has been re-resolved. */
  state: RunState;
}

/**
 * Computes a stat-point spend for `applyAction` without writing anything.
 *
 * The stored character is the arithmetic source; the resolved party snapshot
 * is only the authoritative mirror clients render. Returning both lets the
 * action handler commit state, event, and character under the same seq guard,
 * so a concurrent campaign transition wins or loses as one transaction rather
 * than being overwritten by a delayed full-row write.
 */
export async function prepareStatPointSpend(
  state: RunState,
  deps: HandlerDeps,
  householdId: string,
  playerId: string,
  stat: unknown,
): Promise<HandlerResult<PreparedStatPointSpend>> {
  if (state.phase !== "scene" || state.sceneType !== "rest") {
    return fail("ILLEGAL", "stat points may only be spent during an active Rest scene");
  }

  const member = state.party.find((candidate) => candidate.playerId === playerId);
  if (!member) return fail("NOT_FOUND", `player ${playerId} has no character in this run`);

  const character = await deps.repo.getCharacter(householdId, member.character.id);
  if (!character) return fail("NOT_FOUND", `no character ${member.character.id}`);
  if (character.householdId !== householdId || character.ownerPlayerId !== playerId) {
    return fail("FORBIDDEN", "this session cannot spend points for that character");
  }

  const rules = deps.content.rules();
  try {
    // Shared character rules validate the runtime value against STAT_IDS.
    const updated = applyStatPointSpend(character, rules, stat as StatId);
    const resolved = resolveCharacter(updated, rules, deps.content.items());
    return ok({
      character: updated,
      state: {
        ...state,
        party: state.party.map((candidate) =>
          candidate.playerId === playerId ? { ...candidate, character: resolved } : candidate,
        ),
      },
    });
  } catch (err) {
    if (err instanceof CharacterRuleError) return fail("ILLEGAL", err.message);
    throw err;
  }
}
