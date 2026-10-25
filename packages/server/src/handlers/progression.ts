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
  classOf,
  commitCampaign,
  deedTargets,
  earnStoredDeed,
  heroDeedsOf,
  nextRankDeeds,
  rankUpLine,
  completeVisit,
  currentPlayable,
  failCampaign,
  isPracticeCampaign,
  journeyView,
  readJourney,
  resolveCharacter,
  withRunDeeds,
  resumeJourney,
  spendStatPoint as applyStatPointSpend,
  switchClass as applyClassSwitch,
  fitClass,
  classAnswerRefusal,
  classPlaceOf,
  effectiveProgress,
  fittingStallAt,
  isNewHero,
  startCampaign,
  memberHome,
  startJourney,
  prerequisiteReason,
  recordFinished,
  unmetPrerequisites,
  lobbyCampaign,
  chapterStoryOf,
  seatedMembers,
  type Campaign,
  type CampaignView,
  type Character,
  type Chapter,
  type ClassId,
  type RankUp,
  type RulesContent,
  type ChapterOutcome,
  type JourneyRefusal,
  type JourneyState,
  type ParsedCampaignGraph,
  type PartyMember,
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
import type { CampaignProgressRecord, ChapterProgressRecord, CharacterWrite } from "../store/repository.ts";
import { busyMessage, claimFor, claimOf, create, parseClaim, rewrite, standing } from "./claim.ts";

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
): Promise<CharacterWrite[]> {
  if (created.householdId !== householdId) {
    // The engine builds this from `ctx.householdId`, so a mismatch means the
    // handler and the engine disagree about whose run this is.
    throw new Error(`character ${created.id} belongs to ${created.householdId}, not ${householdId}`);
  }
  const existing = await deps.repo.getCharacter(householdId, created.id);
  return existing ? [] : [create(created)];
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
  if (!chapter) return { characters: [], writes: [], awards: [], alreadyPaid: [] };

  return awardChapterXpDetails({
    state,
    chapter,
    householdId,
    repo: deps.repo,
    rules: deps.content.rules(),
    items: deps.content.items(),
    claim: (row) => claimFor(campaignKey(state), householdId, row),
    // A hero another adventure holds is not this table's to write (#282).
    // Seating and chapter start refuse her, so this is only ever a race lost
    // between them and here: she keeps what she has, and the chapter ends.
    admit: async (row) => {
      if (!state.campaignId) return true;
      const busy = (await standing(row, claimFor(campaignKey(state), householdId, row), deps)) === "busy";
      if (busy) console.error(`settle: ${row.id} is claimed by ${row.provisional?.runId}; not writing her`);
      return !busy;
    },
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
): Promise<HandlerResult<CharacterWrite[]>> {
  if (!state.campaignId) return ok([]);
  const { writes, busy } = await transformParty(state, deps, householdId, [], (character) => character);
  // Acquiring the claim (#282): a hero another adventure still holds cannot
  // start this one, and nothing is written for anybody.
  if (busy.length > 0) return fail("HERO_BUSY", busyMessage(busy[0]!));
  return ok(writes);
}

/** Phases a chapter is under way in, where a hero seated now plays it. */
export const UNDER_WAY: ReadonlySet<RunState["phase"]> = new Set(["scene", "check", "encounter"]);

/**
 * Seating a saved hero, against her claim (#282, architecture §4.5). Every
 * path that seats one comes through here: a lobby pick and a join mid-chapter
 * are both SEAT_CHARACTER.
 *
 * In a campaign chapter already under way she plays it from the first tap, so
 * seating her acquires the claim: the write returned rides the seat's own
 * commit, conditioned on the row as read. Anywhere else (a lobby, between
 * chapters) nothing is written, and the chapter start acquires her with the
 * rest of the party; she is refused here only when a different table holds
 * her, because which of this table's campaigns is next is not decided yet.
 */
export async function seatHero(
  state: RunState,
  deps: HandlerDeps,
  householdId: string,
  hero: Character,
): Promise<HandlerResult<CharacterWrite | null>> {
  // The practice claims nobody (#255): a hero seated into it is held by nothing.
  const underWay =
    Boolean(state.campaignId) && !isPracticeCampaign(state.campaignId) && UNDER_WAY.has(state.phase);
  const claim = underWay ? claimFor(campaignKey(state), householdId, hero) : null;
  const where = await standing(hero, claim, deps);
  if (where === "busy") {
    const held = claimOf(hero)!;
    if (underWay || parseClaim(held, hero).table !== householdId) {
      return fail("HERO_BUSY", busyMessage(hero));
    }
  }
  if (!claim || where === "mine") return ok(null);
  return ok(rewrite(hero, startCampaign(hero, claim)));
}

/**
 * The beat a party may play next in this campaign — the one rule chapter
 * start (both CONTINUE_CAMPAIGN and a direct START_CHAPTER) and settlement
 * answer to.
 *
 * The beat after the last one an active attempt finished; beat one for a fresh
 * or finished attempt. Past the end can only be an attempt whose final chapter
 * did not settle it, so that starts over rather than stranding the party at a
 * beat that does not exist.
 */
export function expectedIndex(
  campaign: Campaign,
  attempt: CampaignProgressRecord | null,
  deps: HandlerDeps,
): number {
  const index = attempt && attempt.status === "active" ? (attempt.lastIndex ?? 0) + 1 : 1;
  return index > finalIndex(campaign, deps) ? 1 : index;
}

/**
 * The party purse a chapter of this attempt starts with.
 *
 * An active attempt's saved `coins`, or an empty purse for an attempt that is
 * new or finished. The third case is an attempt that was already under way
 * when the purse was introduced: it has finished at least one chapter but
 * never saved a purse, so it missed the coins chapter 1 hands out. Reading
 * that as 0 would hide every paying choice for the rest of its campaign, so it
 * gets the campaign's `purseBackfill` instead: the base, plus each carried
 * flag's amount (Gemfall pays the Ember sale back to a party that sold it).
 */
export function purseFor(campaign: Campaign | null, attempt: CampaignProgressRecord | null): number {
  if (!attempt || attempt.status !== "active") return 0;
  if (attempt.coins !== undefined) return attempt.coins;
  if ((attempt.lastIndex ?? 0) < 1) return 0;
  return backfilledPurse(campaign, attempt.routeFlags);
}

/** `purseBackfill` for a party holding these carried flags; 0 without one. */
export function backfilledPurse(
  campaign: Campaign | null,
  routeFlags: Readonly<Record<string, boolean>> | undefined,
): number {
  const backfill = campaign?.purseBackfill;
  if (!backfill) return 0;
  let coins = backfill.coins;
  for (const [flag, amount] of Object.entries(backfill.byFlag ?? {})) {
    if (routeFlags?.[flag] === true) coins += amount;
  }
  return coins;
}

/** An attempt a chapter start is creating, and the version its write expects. */
export interface StartedAttempt {
  attempt: CampaignProgressRecord;
  expectedVersion: number | null;
}

/**
 * Has this household ever completed the campaign this row is for (#221)? A
 * `complete` row, or one that replaced a completed attempt
 * (`CampaignProgressRecord.everCompleted`). What a campaign prerequisite reads.
 */
export function hasCompleted(record: CampaignProgressRecord | null | undefined): boolean {
  return record?.status === "complete" || record?.everCompleted === true;
}

function newAttempt(
  householdId: string,
  campaignId: string,
  runId: string,
  now: string,
  version: number,
  /** The row this attempt replaces, if any: a completion it records is carried. */
  previous: CampaignProgressRecord | null,
  journey?: JourneyState,
): CampaignProgressRecord {
  return {
    householdId,
    campaignId,
    status: "active",
    setbacks: 0,
    lastIndex: 0,
    // The row version is unique per household campaign row, so the id is too.
    attemptId: `${campaignId}:${version}:${runId}:${now}`,
    // A graph campaign's attempt is born with its journey (#194); an ordered
    // one never carries the key at all, so its row is exactly as before.
    ...(journey ? { journey } : {}),
    version,
    updatedAt: now,
    // Replaying a finished campaign must not forget it was finished (#221).
    // Only then is the key written, so every other fresh row is as before.
    ...(hasCompleted(previous) ? { everCompleted: true as const } : {}),
  };
}

/**
 * The attempt a chapter start belongs to. An active attempt is joined; with
 * none — a household's first time, or a replay after one finished — the start
 * *creates* it, so every room that begins a beat carries the id of the attempt
 * it began under. Minting it here rather than at the first completion is what
 * lets a stale beat-1 room from a finished attempt be told apart from the
 * replay that followed it: they carry different ids.
 *
 * `startedAttempt` is null when the start joins an existing attempt (nothing
 * to write); otherwise it is the row the start's own commit writes, under the
 * version it read, so two rooms starting fresh at once cannot both create one.
 */
export function joinOrStartAttempt(
  existing: CampaignProgressRecord | null,
  householdId: string,
  campaignId: string,
  runId: string,
  now: string,
  /**
   * A graph campaign's fresh journey, stored on the attempt this start creates
   * (#194). Ignored when the start joins an active attempt: that attempt's
   * journey — or, unwritten, the fresh start every reader derives — stands.
   */
  journey?: JourneyState,
): { attemptId: string | null; startedAttempt: StartedAttempt | null } {
  if (existing && existing.status === "active") {
    return { attemptId: existing.attemptId ?? null, startedAttempt: null };
  }
  const attempt = newAttempt(householdId, campaignId, runId, now, (existing?.version ?? 0) + 1, existing, journey);
  return {
    attemptId: attempt.attemptId ?? null,
    startedAttempt: { attempt, expectedVersion: existing ? (existing.version ?? 0) : null },
  };
}

/**
 * Is this completion no longer its attempt's next beat?
 *
 * A household can play its campaign in two rooms at once. If another room
 * finished this beat first, or the attempt the room began under has since
 * ended, the completion is stale: awarding it would hand out the beat twice,
 * and recording it would move `lastIndex` somewhere the attempt has passed.
 *
 * Against an active attempt: the run must carry that attempt's id, and its
 * chapter must be the attempt's next beat. With no active attempt there is
 * nothing a current run can belong to — chapter start creates one — so the
 * only admissible completion is a run from before chapter start stamped
 * anything (`campaignAttemptId` absent) at beat one of a household that has
 * never had an attempt at all, which settles the way it always did.
 */
function isStale(
  state: RunState,
  chapter: Chapter,
  campaign: Campaign,
  existing: CampaignProgressRecord | null,
  deps: HandlerDeps,
): boolean {
  if (existing && existing.status === "active") {
    return (
      chapter.index !== expectedIndex(campaign, existing, deps) ||
      (state.campaignAttemptId ?? null) !== (existing.attemptId ?? null)
    );
  }
  return !(existing === null && state.campaignAttemptId === undefined && chapter.index === 1);
}

/**
 * Where a household stands in a campaign, for the screens (`RunState.campaign`).
 *
 * `next` is exactly the chapter CONTINUE_CAMPAIGN would start from this
 * attempt — the same `expectedIndex` and the same road — so the lobby never
 * promises a chapter the button will not open. `ended` is passed only by the
 * completion that finished or failed the attempt.
 */
export function campaignView(
  campaign: Campaign,
  attempt: CampaignProgressRecord | null,
  deps: HandlerDeps,
  ended?: "complete" | "failed",
): CampaignView {
  const graph = deps.content.graph(campaign.id);
  if (graph) return graphCampaignView(campaign, graph, attempt, deps, ended);
  const index = expectedIndex(campaign, attempt, deps);
  const flags = attempt && attempt.status === "active" ? (attempt.routeFlags ?? {}) : {};
  const chapter = deps.content.chapterAt(campaign.id, index, flags);
  return {
    id: campaign.id,
    title: campaign.title,
    blurb: campaign.blurb,
    chapters: finalIndex(campaign, deps),
    next: chapter ? { index: chapter.index, title: chapter.title } : null,
    ...(ended ? { ended } : {}),
  };
}

/**
 * `campaignView` for a graph campaign (#194).
 *
 * `next` answers the question it always has — what "Begin" would start — from
 * the journey CONTINUE_CAMPAIGN would resume (`attemptJourney`): the visit's
 * chapter while it is playing, and null while the party is choosing a way on,
 * which is exactly "a fork nobody has chosen at". `chapters` keeps its
 * ordered meaning as best it can — the highest act number — since a graph
 * has no fixed count of beats.
 *
 * `journey` is where the attempt stands: the journey CONTINUE resumes, or —
 * for an attempt that reached an ending — that ending, so the completion
 * screen (and the lobby until a replay starts) can say which one. In that
 * case `next` is the fresh start a replay would begin.
 *
 * A journey this build cannot read (`readJourney` refused it) shows nothing
 * to start and no journey: better a lobby that offers nothing than one that
 * offers a chapter the server will then refuse.
 */
function graphCampaignView(
  campaign: Campaign,
  graph: ParsedCampaignGraph,
  attempt: CampaignProgressRecord | null,
  deps: HandlerDeps,
  ended?: "complete" | "failed",
): CampaignView {
  const base = {
    id: campaign.id,
    title: campaign.title,
    blurb: campaign.blurb,
    chapters: finalIndex(campaign, deps),
    ...(ended ? { ended } : {}),
  };
  const resumed = attemptJourney(campaign, graph, attempt);
  if (!resumed.ok) return { ...base, next: null };
  const playable = currentPlayable(graph, resumed.journey);
  const chapter = playable.kind === "play" ? deps.content.chapter(playable.chapter) : null;
  const finished = attempt && attempt.status === "complete" ? readJourney(graph, attempt.journey) : null;
  const shown = finished?.ok && finished.journey?.status === "ended" ? finished.journey : resumed.journey;
  return {
    ...base,
    next: chapter ? { index: chapter.index, title: chapter.title } : null,
    journey: journeyView(graph, shown, (id) => deps.content.chapter(id)?.title, campaign),
  };
}

/**
 * The journey a graph campaign's attempt stands at — the one CONTINUE resumes,
 * a chapter start must match, and a completion settles against (#194).
 *
 * An active attempt's stored journey, or — none written yet — the fresh start
 * at the entry, which `startJourney` makes the same for every reader. No
 * attempt, or a finished one, is a fresh start too: the next chapter start
 * creates a new attempt, and a replayed campaign walks its map again rather
 * than inheriting the last one's — the rule `roadTo` applies to route flags.
 * A stored journey this build cannot read is refused (`readJourney`), never
 * replaced: overwriting it with a fresh start would throw away a party's map.
 */
export function attemptJourney(
  campaign: Campaign,
  graph: ParsedCampaignGraph,
  attempt: CampaignProgressRecord | null,
): { ok: true; journey: JourneyState; fresh: boolean } | JourneyRefusal {
  if (!attempt || attempt.status !== "active") {
    return { ok: true, journey: startJourney(graph, campaign), fresh: true };
  }
  return resumeJourney(graph, attempt.journey, campaign);
}

/**
 * What keeps this household out of a campaign (#221), or null when nothing does.
 *
 * Only a *start* is locked: a household with an active attempt at the campaign
 * is already in it (it could only have started once the prerequisite was met).
 * Replaying Gemfall keeps it unlocked for new starts too, through the replay's
 * `everCompleted`; the active-attempt rule also covers a replay begun before
 * that field existed, which carries none. `attempts` is
 * everything the household has on record, so the lobby passes the list it
 * already read and a chapter start reads it once.
 */
export function campaignLock(
  campaign: Campaign,
  attempts: readonly CampaignProgressRecord[],
  deps: Pick<HandlerDeps, "content">,
  /** Campaign ids the party's heroes have finished, from their own records (#283). */
  finished: readonly string[] = [],
): CampaignView["locked"] | null {
  if (!isGated(campaign)) return null;
  if (!campaign.comingSoon && attempts.some((a) => a.campaignId === campaign.id && a.status === "active")) return null;
  const requires = unmetPrerequisites(campaign, attempts, finished);
  // A teaser stays locked once its prerequisites are met: it says what is
  // still owed while anything is, then that the story is on its way.
  if (requires.length === 0) return campaign.comingSoon ? { requires, reason: COMING_SOON } : null;
  const titles = requires.map((id) => deps.content.campaign(id)?.title ?? id);
  return { requires, reason: prerequisiteReason(titles) };
}

/** What a `comingSoon` teaser says once nothing else stands in its way. */
export const COMING_SOON = "Coming soon";

/** A campaign that can be locked: one with prerequisites, or a teaser. */
function isGated(campaign: Campaign): boolean {
  return campaign.comingSoon === true || (campaign.requires?.length ?? 0) > 0;
}

/**
 * The heroes a prerequisite counts: the party, less anybody the host or a
 * grown-up has taken out (`RunState.removed`). Taking a player out leaves
 * them in `party`, disconnected (remove.ts), so the list alone would let a
 * removed hero's record keep a campaign open for the table she left. A hero
 * who is only disconnected still counts: she is still the table's.
 */
export function seatedParty(state: Pick<RunState, "party" | "removed">): PartyMember[] {
  return seatedMembers(state);
}

/**
 * The campaigns any hero in `party` has finished, from her own record (#283),
 * read from her row at her home: a visitor's at hers (#249). A resolved party
 * member does not carry the record, so this reads; callers only ask when a
 * campaign declares `requires`, which Gemfall does not.
 *
 * A row that cannot be read is left out, as settlement does: it can only make
 * a lock stand that her record would have lifted, never lift one wrongly.
 */
export async function partyFinished(
  party: readonly PartyMember[],
  householdId: string,
  deps: Pick<HandlerDeps, "repo">,
): Promise<string[]> {
  const ids = new Set<string>();
  await Promise.all(
    party.map(async (member) => {
      try {
        const hero = await deps.repo.getCharacter(memberHome(member, householdId), member.character.id);
        for (const entry of hero?.finished ?? []) ids.add(entry.campaignId);
      } catch (err) {
        console.error(`prerequisites: skipping character ${member.character.id}:`, err);
      }
    }),
  );
  return [...ids].sort();
}

/**
 * The refusal for starting a campaign this table has not unlocked, or null
 * to go ahead. The server's half of the lock: the lobby only shows it, so this
 * is what actually stops a locked start, whichever intent asked for it. Met by
 * the household's own record or by any hero in `party` (#283).
 */
export async function lockedRefusal(
  campaign: Campaign,
  householdId: string,
  deps: HandlerDeps,
  party: readonly PartyMember[] = [],
): Promise<string | null> {
  if (!isGated(campaign)) return null;
  const [attempts, finished] = await Promise.all([
    deps.repo.listCampaignProgress(householdId),
    partyFinished(party, householdId, deps),
  ]);
  const lock = campaignLock(campaign, attempts, deps, finished);
  return lock ? `"${campaign.title}" is locked: ${lock.reason}` : null;
}

/**
 * The lobby's locks, again, for the party now seated (#283): a hero who
 * finished a prerequisite herself unlocks it for the table the moment she
 * sits down, and the lock comes back if she is the one who leaves. Returns
 * the state unchanged (the same object) when no option declares `requires`,
 * so a lobby of campaigns without prerequisites (Gemfall's) reads nothing and
 * changes nothing.
 *
 * A vote for a campaign that is locked again goes, as `doVoteCampaign` would
 * have refused it, and the screens follow the lobby's pick (`lobbyCampaign`).
 */
export async function relockLobby(
  state: RunState,
  householdId: string,
  deps: Pick<HandlerDeps, "repo" | "content">,
): Promise<RunState> {
  const options = state.campaignOptions ?? [];
  const gated = options.filter((o) => {
    const campaign = deps.content.campaign(o.id);
    return campaign !== null && isGated(campaign);
  });
  if (gated.length === 0) return state;
  const [attempts, finished] = await Promise.all([
    deps.repo.listCampaignProgress(householdId),
    partyFinished(seatedParty(state), householdId, deps),
  ]);
  const relocked = options.map((option): CampaignView => {
    const campaign = deps.content.campaign(option.id);
    if (!campaign || !isGated(campaign)) return option;
    const { locked: _was, ...open } = option;
    const locked = campaignLock(campaign, attempts, deps, finished);
    return locked ? { ...open, locked } : open;
  });
  const lockedIds = new Set(relocked.filter((o) => o.locked).map((o) => o.id));
  const votes = Object.fromEntries(
    Object.entries(state.campaignVotes ?? {}).filter(([, id]) => !lockedIds.has(id)),
  );
  const shown = state.campaign ? (relocked.find((o) => o.id === state.campaign!.id) ?? state.campaign) : null;
  const next: RunState = { ...state, campaignOptions: relocked, campaignVotes: votes, campaign: shown };
  const leader = lobbyCampaign(next).leader;
  return leader ? { ...next, campaign: leader } : next;
}

/**
 * The campaigns a lobby can play (`RunState.campaignOptions`): the one the room
 * was opened for; then every `listed` campaign, in file order — a sequel the
 * table should see coming, locked with its reason until its prerequisites are
 * met; then every other campaign this household has part-way through, most
 * recently played first — so a party that started something on another evening
 * can pick it back up rather than only ever being offered the launch campaign.
 *
 * But a household with a campaign under way is offered only that one (the most
 * recently played): continuing is not choosing. With nothing under way the
 * rest of the above stands.
 *
 * Only *active* attempts are offered beyond the featured and listed ones. A
 * finished or failed campaign is history; starting it again is the featured
 * campaign's "again", not a resume. And a campaign the content no longer ships
 * is skipped rather than offered as a button that cannot start anything.
 */
export async function lobbyCampaigns(
  householdId: string,
  featuredId: string | null,
  deps: HandlerDeps,
  /** The party already seated, whose own records can unlock it (#283). */
  party: readonly PartyMember[] = [],
): Promise<CampaignView[]> {
  const attempts = await deps.repo.listCampaignProgress(householdId);
  const featured = featuredId ? deps.content.campaign(featuredId) : null;
  // Beside the room's own campaign, never instead of it: a room opened for no
  // campaign offers none, and Begin plays what the phone names, as before.
  const listed = !featured ? [] : deps.content
    .campaignIds()
    .map((id) => deps.content.campaign(id))
    .filter((c): c is Campaign => c !== null && c.listed === true && c.id !== featured?.id);
  const shown = featured ? [featured, ...listed] : listed;
  const finished = shown.some((c) => c.requires?.length) ? await partyFinished(party, householdId, deps) : [];
  const options: CampaignView[] = [];
  for (const campaign of shown) {
    const attempt = attempts.find((a) => a.campaignId === campaign.id) ?? null;
    // A locked campaign is still offered: shown with its reason, not startable.
    const locked = campaignLock(campaign, attempts, deps, finished);
    options.push({ ...campaignView(campaign, attempt, deps), ...(locked ? { locked } : {}) });
  }
  const resumable = attempts
    .filter((a) => a.status === "active" && !options.some((o) => o.id === a.campaignId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const attempt of resumable) {
    const campaign = deps.content.campaign(attempt.campaignId);
    if (campaign) options.push(campaignView(campaign, attempt, deps));
  }
  // A household with a campaign under way is continuing it: the lobby offers
  // that one alone, the most recently played, rather than a picker that invites
  // the table to wander off to something else mid-story.
  const underWay = attempts
    .filter((a) => a.status === "active")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((a) => options.find((o) => o.id === a.campaignId))
    .find((o) => o !== undefined);
  return underWay ? [underWay] : options;
}

/** The highest beat a campaign's chapters reach. */
export function finalIndex(campaign: Campaign, deps: HandlerDeps): number {
  let last = 0;
  for (const id of campaign.chapters) {
    const chapter = deps.content.chapter(id);
    if (chapter && chapter.index > last) last = chapter.index;
  }
  return last;
}

/** Spec §8.3's default. A campaign may tune it (`Campaign.setbackLimit`). */
const DEFAULT_SETBACK_LIMIT = 3;

/** Everything a chapter completion owes the store, for one `repo.commit()`. */
export interface ChapterSettlement {
  characters: CharacterWrite[];
  /** Award metadata retained for level-up and tier-transformation UI triggers. */
  awards: ProgressionAward[];
  chapterProgress?: ChapterProgressRecord;
  campaignProgress?: CampaignProgressRecord;
  campaignProgressExpectedVersion?: number | null;
  /**
   * The completion belonged to a beat its attempt has already moved past (see
   * `settleChapterCompletion`). Nothing was awarded or recorded.
   */
  stale?: boolean;
  /** The household's standing after this completion, for `RunState.campaign`. */
  campaignView?: CampaignView;
  /**
   * A graph campaign's replay (#194): the visit completed and was recorded, but
   * its chapter had already paid this attempt, so it paid nothing now — XP is
   * once per chapter per attempt. The room's completion screen shows no XP.
   */
  replay?: boolean;
  /**
   * Heroes this chapter had already paid, on some earlier attempt or at some
   * other table (#408): they earned nothing now. Absent when there are none.
   */
  alreadyPaid?: string[];
}

/**
 * What the attempt keeps of this chapter for the Story page (#358), appended
 * to a copy of its story (the row may be shared with the one read). `before`
 * is the route-set flags the attempt held before this chapter, so a flag it
 * carried in is not counted as this chapter's choice. A completion with no
 * ending scene (none is possible today) keeps nothing.
 */
function keepStory(
  attempt: CampaignProgressRecord,
  state: RunState,
  campaign: Campaign,
  chapter: Chapter,
  before: Readonly<Record<string, boolean>> | undefined,
): void {
  if (!state.sceneId) return;
  const story = chapterStoryOf({
    campaign,
    chapter,
    ending: state.sceneId,
    visited: state.visited ?? [],
    flags: state.flags,
    before,
    party: { members: seatedParty(state).map((m) => m.character) },
    ...(state.revealHeld ? { revealHeld: state.revealHeld } : {}),
  });
  attempt.story = [...(attempt.story ?? []), story];
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
  /**
   * An attempt this same action is creating (a chapter start whose entry scene
   * is already an ending), not yet committed: settle against it rather than
   * the stored row, and keep its write's version condition.
   */
  pending?: StartedAttempt,
): Promise<ChapterSettlement> {
  const now = iso(deps.now());
  const outcome = state.chapterOutcome ?? "success";
  const chapter = state.chapterId ? deps.content.chapter(state.chapterId) : null;
  const campaignId = state.campaignId;
  const campaign = campaignId ? deps.content.campaign(campaignId) : null;

  /*
   * The attempt — read, and judged, before anything is folded. Folding XP and
   * the bag re-resolves the run's party in place, so a check after it would
   * keep the durable rows clean and still hand the room a phantom level or a
   * quest item that opens a door next chapter.
   *
   * A record whose status is `complete` or `failed` is a finished attempt —
   * starting to count from it again would make a replayed campaign inherit its
   * own history and insta-fail (see CampaignProgressRecord).
   */
  const existing =
    campaignId && campaign && chapter
      ? (pending?.attempt ?? (await deps.repo.getCampaignProgress(householdId, campaignId)))
      : null;
  // A graph campaign settles by visit, not by beat (#194). Branched here, after
  // the one read both share and before anything ordered-only runs, so an
  // ordered campaign's path below is untouched.
  const graph = campaign && chapter ? deps.content.graph(campaign.id) : null;
  if (graph && campaign && chapter) {
    return settleVisit({ state, deps, householdId, campaign, graph, chapter, existing, pending, now, outcome });
  }
  if (campaign && chapter && isStale(state, chapter, campaign, existing, deps)) {
    return { characters: [], awards: [], stale: true };
  }

  const award = await foldChapterXpDetails(state, deps, householdId, chapter);
  const characters = award.writes;
  const xpEarned = chapter ? computeChapterXp(state, chapter) : 0;
  const paid = paidBefore(award);

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

  if (!campaignId || !campaign || !chapter) {
    return { characters, awards: award.awards, ...paid, ...(chapterProgress ? { chapterProgress } : {}) };
  }

  // The run seq serializes one room. This version serializes the household row
  // across rooms, so two campaign evenings cannot overwrite each other's count
  // — and two rooms racing to finish the same beat cannot both count it.
  const campaignProgressExpectedVersion = pending
    ? pending.expectedVersion
    : existing
      ? (existing.version ?? 0)
      : null;
  const version = pending ? (pending.attempt.version ?? 1) : (existing?.version ?? 0) + 1;
  const attempt: CampaignProgressRecord =
    existing && existing.status === "active"
      ? { ...existing, version, updatedAt: now }
      : // Only reachable for a run started before chapter start began creating
        // the attempt (isStale admits exactly that case).
        newAttempt(householdId, campaignId, state.runId, now, version, existing);
  if (outcome === "setback") attempt.setbacks += 1;
  keepStory(attempt, state, campaign, chapter, attempt.routeFlags);
  const roads = routesTaken(campaign, state.flags, attempt.routeFlags);
  if (roads) attempt.routeFlags = roads;
  // A run started before the purse existed has none, even if it walked past
  // the scene that hands one out. It gets the attempt's saved purse, or the
  // backfill (counting the roads this very chapter took), so finishing that
  // chapter does not save an empty purse the party never got to see.
  attempt.coins = state.coins ?? attempt.coins ?? backfilledPurse(campaign, attempt.routeFlags);
  attempt.lastIndex = chapter.index;

  const limit = campaign.setbackLimit ?? DEFAULT_SETBACK_LIMIT;
  // The final *beat*, not the last-listed file: a routed last beat has several
  // files at the same index (Gemfall's climb and its Walk), and finishing any
  // one of them finishes the campaign.
  // Or an ending authored to finish the campaign early (`endsCampaign`).
  const ending = state.sceneId ? chapter.scenes[state.sceneId] : undefined;
  const endsCampaign = ending !== undefined && "endsCampaign" in ending && ending.endsCampaign === true;
  const finalChapter = endsCampaign || chapter.index === finalIndex(campaign, deps);

  if (attempt.setbacks >= limit) {
    attempt.status = "failed";
    return {
      characters: await settleParty(state, deps, householdId, characters, (c) => {
        // The souvenir reads the tier *before* the revert takes it away —
        // "she goes back to Fledgling and keeps something visible that says
        // she was Sworn once" (spec §8.3). The id is a display key for the
        // souvenir art roadmap chapter 5 commissions.
        const reached = c.provisional?.tier;
        const flavored = reached && reached !== c.committed.tier;
        return failCampaign(c, flavored ? `${campaignId}#${reached}` : campaignId, now);
      }),
      awards: award.awards,
      ...paid,
      ...(chapterProgress ? { chapterProgress } : {}),
      campaignProgress: attempt,
      campaignProgressExpectedVersion,
      campaignView: campaignView(campaign, attempt, deps, "failed"),
    };
  }

  if (finalChapter) {
    attempt.status = "complete";
    return {
      characters: await settleParty(state, deps, householdId, characters, finish(campaignId, outcome, householdId, now)),
      awards: award.awards,
      ...paid,
      ...(chapterProgress ? { chapterProgress } : {}),
      campaignProgress: attempt,
      campaignProgressExpectedVersion,
      campaignView: campaignView(campaign, attempt, deps, "complete"),
    };
  }

  return {
    characters,
    awards: award.awards,
    ...paid,
    ...(chapterProgress ? { chapterProgress } : {}),
    campaignProgress: attempt,
    campaignProgressExpectedVersion,
    campaignView: campaignView(campaign, attempt, deps),
  };
}

/** `ChapterSettlement.alreadyPaid` from a fold: the key only when someone was. */
function paidBefore(award: AwardChapterXpResult): Pick<ChapterSettlement, "alreadyPaid"> {
  return award.alreadyPaid.length > 0 ? { alreadyPaid: award.alreadyPaid } : {};
}

/**
 * `settleChapterCompletion` for a graph campaign (#194): the visit completes
 * (shared `completeVisit`), and the attempt's fate is decided exactly as an
 * ordered campaign's is — the setback limit fails it wherever the party is,
 * and completing an ending node completes it.
 *
 * What differs is what "stale" means. An ordered completion is checked by
 * beat; a graph completion is checked by **visit** — the `(attemptId, node,
 * visit)` the run was stamped with at chapter start (`RunState.journeyVisit`).
 * A completion is settled only against the active attempt it began under, for
 * the visit the journey is playing. Anything else — another room already
 * finished this visit, the visit has been left, the attempt ended, the run
 * carries no visit — settles nothing and awards nothing (`stale`), which is
 * the double-count guard: a repeat is answered, never applied.
 *
 * The write rides the run's commit under the attempt row's version, as every
 * campaign write does, so two rooms completing the same visit at the same
 * moment cannot both land: the loser's commit fails, and anything it retries
 * finds the visit already completed — a duplicate.
 *
 * XP pays once per chapter per attempt (`firstCompletion`): a replayed visit
 * still folds the bag — what was found on a replay is real — but no XP. And
 * once per chapter per hero, ever (#408): a first visit this attempt still
 * pays nothing to a hero the chapter paid on an earlier one (`alreadyPaid`).
 */
async function settleVisit(input: {
  state: RunState;
  deps: HandlerDeps;
  householdId: string;
  campaign: Campaign;
  graph: ParsedCampaignGraph;
  chapter: Chapter;
  existing: CampaignProgressRecord | null;
  pending: StartedAttempt | undefined;
  now: string;
  outcome: ChapterOutcome;
}): Promise<ChapterSettlement> {
  const { state, deps, householdId, campaign, graph, chapter, existing, pending, now, outcome } = input;
  const stale: ChapterSettlement = { characters: [], awards: [], stale: true };
  const at = state.journeyVisit;
  if (
    !existing ||
    existing.status !== "active" ||
    !at ||
    (state.campaignAttemptId ?? null) !== (existing.attemptId ?? null)
  ) {
    return stale;
  }
  const resumed = resumeJourney(graph, existing.journey, campaign);
  if (!resumed.ok) {
    console.error(`settle: journey for ${householdId}/${campaign.id} unreadable: ${resumed.message}`);
    return stale;
  }
  const step = completeVisit(
    graph,
    resumed.journey,
    {
      node: at.node,
      visit: at.visit,
      chapterId: chapter.id,
      outcome,
      flags: state.flags,
      // What the run's fights left of its temporary buffs (#200), read back
      // like the flags. A run started before #200 carries none to read.
      ...(state.buffs === undefined ? {} : { buffs: state.buffs }),
    },
    campaign,
  );
  if (!step.ok || step.duplicate) return stale;

  const replay = !step.firstCompletion;
  // A shallow copy shares the party, so the fold still re-resolves the room's
  // characters in place; only the amounts it reads are withheld on a replay.
  const award = await foldChapterXpDetails(
    replay ? { ...state, xpEarned: 0, heroRollXp: {} } : state,
    deps,
    householdId,
    chapter,
  );
  // The copy's deeds were folded, but the room's run still holds them (#310).
  delete state.deeds;
  const characters = award.writes;
  const chapterProgress: ChapterProgressRecord = {
    runId: state.runId,
    index: chapter.index,
    chapterId: chapter.id,
    status: "complete",
    outcome,
    xpEarned: replay ? 0 : computeChapterXp(state, chapter),
    updatedAt: now,
  };

  const campaignProgressExpectedVersion = pending ? pending.expectedVersion : (existing.version ?? 0);
  const version = pending ? (pending.attempt.version ?? 1) : (existing.version ?? 0) + 1;
  const attempt: CampaignProgressRecord = { ...existing, journey: step.journey, version, updatedAt: now };
  if (outcome === "setback") attempt.setbacks += 1;
  keepStory(attempt, state, campaign, chapter, existing.journey?.flags);
  attempt.coins = state.coins ?? attempt.coins ?? 0;
  const settled = {
    awards: award.awards,
    ...paidBefore(award),
    chapterProgress,
    campaignProgressExpectedVersion,
    ...(replay ? { replay } : {}),
  };

  // Failure first, as for an ordered campaign: a setback that reaches the
  // limit fails the attempt even at an ending node.
  if (attempt.setbacks >= (campaign.setbackLimit ?? DEFAULT_SETBACK_LIMIT)) {
    attempt.status = "failed";
    return {
      ...settled,
      characters: await settleParty(state, deps, householdId, characters, (c) => {
        const reached = c.provisional?.tier;
        const flavored = reached && reached !== c.committed.tier;
        return failCampaign(c, flavored ? `${campaign.id}#${reached}` : campaign.id, now);
      }),
      campaignProgress: attempt,
      campaignView: campaignView(campaign, attempt, deps, "failed"),
    };
  }
  if (step.ended) {
    attempt.status = "complete";
    return {
      ...settled,
      characters: await settleParty(state, deps, householdId, characters, finish(campaign.id, outcome, householdId, now)),
      campaignProgress: attempt,
      campaignView: campaignView(campaign, attempt, deps, "complete"),
    };
  }
  return { ...settled, characters, campaignProgress: attempt, campaignView: campaignView(campaign, attempt, deps) };
}

/**
 * A completed campaign's fate for each hero: her gains become who she is
 * (`commitCampaign`), and the campaign goes on her own record (#283), in the
 * same write, at her home, whichever table this is. Only heroes this table
 * settles get it: one another adventure holds is left out (`settleParty`).
 */
function finish(
  campaignId: string,
  outcome: ChapterOutcome,
  table: string,
  at: string,
): (character: Character) => Character {
  return (character) => recordFinished(commitCampaign(character), { campaignId, outcome, at, table });
}

/**
 * Where this attempt stands, after this chapter — or null if it stands
 * nowhere and never did.
 *
 * Only flags the campaign *declares* in `routeSets` survive the chapter
 * boundary (`CampaignProgressRecord.routeFlags`). The filter is the whole
 * point: a chapter's own flags are scoped to the chapter and die with it, and
 * the declaration is what tells the two apart. Inferring "looks like a route
 * flag" from the flags a run happens to hold would make the opened door and
 * the paid objective permanent too.
 *
 * ---------------------------------------------------------------------------
 * ONE ROAD PER SET, AND THE NEWEST ONE WINS
 *
 * A set is a fork, so at most one of its flags may be standing. Accumulating
 * them strands the party, and Gemfall strands them on purpose: fail the ford
 * on the Rush Road and the current carries you west into the marsh, so you
 * finish chapter 3 in the Enchanted Woods on a road you did not choose
 * (design brief, "their storyline has changed under them"). Carry both flags
 * and `chapterFor` sees two members of one set match, correctly refuses to
 * guess, and the party arrives at beat 4 with nothing to enter — mid-evening,
 * at a table.
 *
 * Different sets do coexist: the road is one fork and the pursuit is another,
 * and choosing what you are chasing does not take you off the road you are
 * walking.
 *
 * "Newest" cannot mean "true", because a party walks into a routed chapter
 * with its road already in `flags` — that is the seed. It means **newly**
 * true: set during this chapter, not carried in. Which is exactly what a
 * re-route is, and exactly what a first choice is.
 */
function routesTaken(
  campaign: Campaign,
  flags: Readonly<Record<string, boolean>>,
  carried: Readonly<Record<string, boolean>> | undefined,
): Record<string, boolean> | null {
  const sets = Object.values(campaign.routeSets ?? {});
  if (sets.length === 0) return carried ? { ...carried } : null;

  const taken: Record<string, boolean> = { ...(carried ?? {}) };
  let changed = false;

  for (const members of sets) {
    // A road explicitly revoked — the chapter said "not this way any more"
    // without naming a replacement. Rare, and cheap to honour: leaving it
    // standing would put the party back on a road the story took away.
    for (const flag of members) {
      if (taken[flag] === true && flags[flag] === false) {
        delete taken[flag];
        changed = true;
      }
    }

    const picked = members.filter((flag) => flags[flag] === true && carried?.[flag] !== true);
    // None: they kept the road they arrived on, which is the common case and
    // is already in `taken`. Two: a content bug no rule can resolve — the
    // chapter set two roads of one fork — so the set is left as it was rather
    // than replaced by whichever sorted first. `chapterFor` refuses on the
    // same ambiguity for the same reason.
    if (picked.length !== 1) continue;
    for (const flag of members) delete taken[flag];
    taken[picked[0]!] = true;
    changed = true;
  }

  if (!changed && !carried) return null;
  return taken;
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
  awarded: CharacterWrite[],
  fate: (character: Character) => Character,
): Promise<{ writes: CharacterWrite[]; busy: Character[] }> {
  const rules = deps.content.rules();
  const items = deps.content.items();
  const byId = new Map(awarded.map((w) => [w.character.id, w]));
  const writes: CharacterWrite[] = [];
  const busy: Character[] = [];

  for (const member of state.party) {
    let write = byId.get(member.character.id) ?? null;
    if (!write) {
      let read: Character | null = null;
      try {
        // A visitor's hero is read from, and so written back to, its own
        // household (#249).
        read = await deps.repo.getCharacter(memberHome(member, householdId), member.character.id);
      } catch (err) {
        // Same policy as foldChapterXp: one bad row must not take the table
        // down at the moment the campaign ends.
        console.error(`settle: skipping character ${member.character.id}:`, err);
      }
      if (!read) continue;
      // Held by another adventure (#282): not this table's to seed or settle.
      if ((await standing(read, claimFor(campaignKey(state), householdId, read), deps)) === "busy") {
        busy.push(read);
        continue;
      }
      write = rewrite(read, read);
    }
    const base = write.character;
    const settled = fate(startCampaign(base, claimFor(campaignKey(state), householdId, base)));
    writes.push({ ...write, character: settled });
    // The revert (or the commit) has to reach the phones on the same patch —
    // a failed campaign whose party still *looks* levelled is a lie the next
    // chapter would expose anyway.
    member.character = resolveCharacter(settled, rules, items);
  }
  return { writes, busy };
}

/**
 * `transformParty` at a campaign's end. A hero another adventure holds is left
 * out rather than refused: the chapter has already ended at this table, and
 * she was never this table's to settle.
 */
async function settleParty(
  state: RunState,
  deps: HandlerDeps,
  householdId: string,
  awarded: CharacterWrite[],
  fate: (character: Character) => Character,
): Promise<CharacterWrite[]> {
  return (await transformParty(state, deps, householdId, awarded, fate)).writes;
}


// ---------------------------------------------------------------------------
// Rest-scene stat spending
// ---------------------------------------------------------------------------

export interface PreparedStatPointSpend {
  /** The unresolved durable row written by the run transaction, under her claim. */
  character: CharacterWrite;
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
  // The practice writes nothing but `practiced` (#255): a point waits for a real rest.
  if (isPracticeCampaign(state.campaignId)) {
    return fail("ILLEGAL", "stat points are spent at a rest in a real chapter, not in the practice");
  }

  const member = state.party.find((candidate) => candidate.playerId === playerId);
  if (!member) return fail("NOT_FOUND", `player ${playerId} has no character in this run`);

  const home = memberHome(member, householdId);
  const character = await deps.repo.getCharacter(home, member.character.id);
  if (!character) return fail("NOT_FOUND", `no character ${member.character.id}`);
  if (character.householdId !== home || character.ownerPlayerId !== playerId) {
    return fail("FORBIDDEN", "this session cannot spend points for that character");
  }
  if (
    state.campaignId &&
    (await standing(character, claimFor(campaignKey(state), householdId, character), deps)) === "busy"
  ) {
    return fail("HERO_BUSY", busyMessage(character));
  }

  const rules = deps.content.rules();
  try {
    // Shared character rules validate the runtime value against STAT_IDS.
    const updated = applyStatPointSpend(character, rules, stat as StatId);
    // Still wearing whatever rank this chapter has earned her so far (#310):
    // the stored row only learns of it when the chapter is folded.
    const resolved = withRunDeeds(resolveCharacter(updated, rules, deps.content.items()), state, rules);
    return ok({
      character: rewrite(character, updated),
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


// ---------------------------------------------------------------------------
// Class places: switching the worn class (#311)
// ---------------------------------------------------------------------------

/**
 * Computes a class switch for `applyAction` without writing anything, the way
 * `prepareStatPointSpend` does and for the same reason: the row, the run and
 * the event commit together under the seq guard.
 *
 * The server's checks (docs/class-mastery.md §7): the party is in that class's
 * room, read from the chapter itself rather than only the run's mirror of it,
 * and the hero is not already that class. The switch lands in `provisional`
 * while a campaign is in flight (`switchClass`), so a failed campaign puts the
 * class back with everything else. From here the engine credits deeds to the
 * class put on, because it reads the party snapshot this returns; what the
 * class taken off earned this chapter stays on the run (`RunState.deeds`) and
 * is folded at the chapter's end.
 *
 * At the fitting stall (`stall`, #312) only the gate differs: the stall
 * stands in this scene (`rules.fittingStall`), the hero is new on the stored
 * row (no XP, the swap unspent), and the class may be any but the one worn.
 * `fitClass` marks the swap spent in the same provisional write, so a failed
 * campaign hands back the class and the swap together.
 */
/** The same pair a stat-point spend prepares: the row, and the run that shows it. */
export type PreparedClassSwitch = PreparedStatPointSpend;

export async function prepareClassSwitch(
  state: RunState,
  deps: HandlerDeps,
  householdId: string,
  playerId: string,
  classId: unknown,
  chapter: Chapter | null,
  stall = false,
): Promise<HandlerResult<PreparedClassSwitch>> {
  const refusal = classAnswerRefusal(state, playerId, classId, true, stall);
  if (refusal) return fail("ILLEGAL", refusal);
  const scene = state.sceneId ? chapter?.scenes[state.sceneId] : undefined;
  if (stall) {
    // The fitting stall (#312): where the rules say it stands, read from the
    // chapter in play rather than only the run's mirror of it.
    if (!scene || !chapter || !state.sceneId || !fittingStallAt(deps.content.rules(), chapter.id, state.sceneId)) {
      return fail("ILLEGAL", "there is no fitting stall here");
    }
  } else if (!scene || classPlaceOf(scene) !== classId) {
    return fail("ILLEGAL", `this is not the ${String(classId)} place`);
  }
  // The practice writes nothing but `practiced` (#255), and has no class places.
  if (isPracticeCampaign(state.campaignId)) {
    return fail("ILLEGAL", "a class is switched in a real chapter, not in the practice");
  }

  const member = state.party.find((candidate) => candidate.playerId === playerId);
  if (!member) return fail("NOT_FOUND", `player ${playerId} has no character in this run`);

  const home = memberHome(member, householdId);
  const character = await deps.repo.getCharacter(home, member.character.id);
  if (!character) return fail("NOT_FOUND", `no character ${member.character.id}`);
  if (character.householdId !== home || character.ownerPlayerId !== playerId) {
    return fail("FORBIDDEN", "this session cannot switch that character's class");
  }
  if (
    state.campaignId &&
    (await standing(character, claimFor(campaignKey(state), householdId, character), deps)) === "busy"
  ) {
    return fail("HERO_BUSY", busyMessage(character));
  }

  // New on the row itself, not only on the run's snapshot of it (#312): the
  // swap is the row's to spend, and the row is what a second tap would find.
  if (stall && !isNewHero(effectiveProgress(character))) {
    return fail("ILLEGAL", `${character.name} has had a fitting already, or is not new`);
  }

  const rules = deps.content.rules();
  try {
    const updated = stall ? fitClass(character, rules, classId as ClassId) : applyClassSwitch(character, rules, classId as ClassId);
    // In step with what this chapter has already counted for the class put
    // on (#310): a hero who earned a rank in it earlier tonight, took it off
    // and is putting it back on wears that rank now, not the stored one.
    const resolved = withRunDeeds(resolveCharacter(updated, rules, deps.content.items()), state, rules);
    const place = state.classPlace;
    return ok({
      character: rewrite(character, updated),
      state: {
        ...state,
        party: state.party.map((candidate) =>
          candidate.playerId === playerId ? { ...candidate, character: resolved } : candidate,
        ),
        ...(place
          ? {
              classPlace: {
                ...place,
                answers: { ...place.answers, [playerId]: { switched: true, from: member.character.class } },
              },
            }
          : {}),
      },
    });
  } catch (err) {
    if (err instanceof CharacterRuleError) return fail("ILLEGAL", err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// A class way at a rift (#199): that class's story deed (#310)
// ---------------------------------------------------------------------------

/**
 * The story deed a class way at a rift earns (docs/class-mastery.md §6): every
 * seated hero wearing a class the way asks for, whose next rank wants it.
 * Taken between chapters, with no run to count it on, so it goes straight
 * onto her stored row, in the rift action's own commit, under her claim and
 * through `startCampaign` like any campaign gain: a failed campaign takes it
 * back. A rank it completes lands now and is said on the room's screens.
 *
 * All or nothing, because the way is used once: a repeat of the same rift
 * action is answered as done without coming back here. So a hero who should
 * earn it but cannot be written safely — her row missing, or another
 * adventure holding her — refuses the whole action, and a store that fails to
 * read throws; either way nothing is committed and a retry can earn it. A hero
 * the deed would not move (another class, or a next rank that wants no story
 * deed) is skipped without being read.
 */
export async function prepareRiftWayDeeds(
  state: RunState,
  campaignId: string,
  classes: readonly ClassId[] | undefined,
  householdId: string,
  deps: HandlerDeps,
): Promise<HandlerResult<{ writes: CharacterWrite[]; state: RunState }>> {
  if (!classes || classes.length === 0) return ok({ writes: [], state });
  const rules = deps.content.rules();
  const items = deps.content.items();
  const writes: CharacterWrite[] = [];
  const ups: RankUp[] = [];
  const party: PartyMember[] = [];
  for (const member of state.party) {
    if (!classes.includes(member.character.class) || !wantsStoryDeed(member, rules)) {
      party.push(member);
      continue;
    }
    // Not caught: a read that fails must fail the action, not skip her deed.
    const row = await deps.repo.getCharacter(memberHome(member, householdId), member.character.id);
    if (!row) return fail("NOT_FOUND", `no character ${member.character.id}`);
    const claim = claimFor(campaignId, householdId, row);
    if ((await standing(row, claim, deps)) === "busy") return fail("HERO_BUSY", busyMessage(row));
    const earned = earnStoredDeed(startCampaign(row, claim), rules, "class_story");
    if (earned.character === row || classOf(earned.character) !== member.character.class) {
      party.push(member);
      continue;
    }
    writes.push(rewrite(row, earned.character));
    const resolved = resolveCharacter(earned.character, rules, items);
    party.push({ ...member, character: resolved });
    const classDef = rules.classes[resolved.class];
    if (earned.rankedUp && classDef) ups.push(rankUpLine(resolved.name, classDef, earned.rankedUp, resolved.id));
  }
  if (writes.length === 0) return ok({ writes, state });
  return ok({
    writes,
    state: { ...state, party, ...(ups.length > 0 ? { rankUps: { sceneId: state.sceneId, ups } } : {}) },
  });
}

/** Does this hero's worn class, as her snapshot has it, want a story deed for its next rank? */
function wantsStoryDeed(member: PartyMember, rules: RulesContent): boolean {
  const hero = heroDeedsOf(member.character);
  const req = nextRankDeeds(rules.classes[hero.class], hero.rank);
  const target = req ? deedTargets(req).get("class_story") : undefined;
  return target !== undefined && (hero.deeds.class_story ?? 0) < target;
}
