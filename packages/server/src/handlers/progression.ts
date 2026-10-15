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
  completeVisit,
  currentPlayable,
  failCampaign,
  journeyView,
  readJourney,
  resolveCharacter,
  resumeJourney,
  spendStatPoint as applyStatPointSpend,
  startCampaign,
  startJourney,
  type Campaign,
  type CampaignView,
  type Character,
  type Chapter,
  type ChapterOutcome,
  type JourneyRefusal,
  type JourneyState,
  type ParsedCampaignGraph,
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

function newAttempt(
  householdId: string,
  campaignId: string,
  runId: string,
  now: string,
  version: number,
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
  const attempt = newAttempt(householdId, campaignId, runId, now, (existing?.version ?? 0) + 1, journey);
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
 * The campaigns a lobby can play (`RunState.campaignOptions`): the one the room
 * was opened for, then every other campaign this household has part-way
 * through, most recently played first — so a party that started something on
 * another evening can pick it back up rather than only ever being offered the
 * launch campaign.
 *
 * Only *active* attempts are offered beyond the featured one. A finished or
 * failed campaign is history; starting it again is the featured campaign's
 * "again", not a resume. And a campaign the content no longer ships is
 * skipped rather than offered as a button that cannot start anything.
 */
export async function lobbyCampaigns(
  householdId: string,
  featuredId: string | null,
  deps: HandlerDeps,
): Promise<CampaignView[]> {
  const attempts = await deps.repo.listCampaignProgress(householdId);
  const options: CampaignView[] = [];
  const featured = featuredId ? deps.content.campaign(featuredId) : null;
  if (featured) {
    const attempt = attempts.find((a) => a.campaignId === featured.id) ?? null;
    options.push(campaignView(featured, attempt, deps));
  }
  const resumable = attempts
    .filter((a) => a.status === "active" && a.campaignId !== featured?.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const attempt of resumable) {
    const campaign = deps.content.campaign(attempt.campaignId);
    if (campaign) options.push(campaignView(campaign, attempt, deps));
  }
  return options;
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
  characters: Character[];
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

  if (!campaignId || !campaign || !chapter) {
    return { characters, awards: award.awards, ...(chapterProgress ? { chapterProgress } : {}) };
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
        newAttempt(householdId, campaignId, state.runId, now, version);
  if (outcome === "setback") attempt.setbacks += 1;
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
      campaignView: campaignView(campaign, attempt, deps, "failed"),
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
      campaignView: campaignView(campaign, attempt, deps, "complete"),
    };
  }

  return {
    characters,
    awards: award.awards,
    ...(chapterProgress ? { chapterProgress } : {}),
    campaignProgress: attempt,
    campaignProgressExpectedVersion,
    campaignView: campaignView(campaign, attempt, deps),
  };
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
 * still folds the bag — what was found on a replay is real — but no XP.
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
  // characters in place; only the amount it reads is withheld on a replay.
  const award = await foldChapterXpDetails(replay ? { ...state, xpEarned: 0 } : state, deps, householdId, chapter);
  const characters = award.characters;
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
  attempt.coins = state.coins ?? attempt.coins ?? 0;
  const settled = {
    awards: award.awards,
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
      characters: await transformParty(state, deps, householdId, characters, (c) => {
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
      characters: await transformParty(state, deps, householdId, characters, commitCampaign),
      campaignProgress: attempt,
      campaignView: campaignView(campaign, attempt, deps, "complete"),
    };
  }
  return { ...settled, characters, campaignProgress: attempt, campaignView: campaignView(campaign, attempt, deps) };
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
