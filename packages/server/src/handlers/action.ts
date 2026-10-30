/**
 * `POST /action` — the core loop, architecture §4.1–§4.2.
 *
 *   validate seq → applyIntent → persist state → append to the event log
 *                → compute an RFC 6902 patch → publish { seq, patch, presentation }
 *
 * Three things this file is responsible for keeping true:
 *
 * 1. **All dice roll here.** The client sends an *intent*; the server decides
 *    what happened. The `Rng` is seeded from `runId:seq` (behind the run's
 *    server-only `diceSecret`, see `diceSeed`), so replaying the event
 *    log re-rolls exactly the same numbers — a replay that re-rolls differently
 *    is not a replay (§4.1, §4.3).
 * 2. **Seq is monotonic and gapless.** Every published patch takes a client from
 *    `seq - 1` to `seq`. A client that cannot make that step must resync rather
 *    than guess, which is what `STALE_SEQ` means (§4.2).
 * 3. **State and spectacle stay separate.** The patch is what the world *is*;
 *    the presentation is how the TV should animate getting there. Phones apply
 *    the patch and ignore the presentation, so animation timing can never block
 *    game logic (§4.2).
 */

import type {
  Character,
  ActionRequest,
  ActionResponse,
  Campaign,
  Chapter,
  ClassId,
  ClientIntent,
  JourneyState,
  NodeId,
  ParsedCampaignGraph,
  PartyMember,
  RunBuff,
  RunState,
  FactValue,
} from "@kad/shared";
import {
  currentPlayable,
  decisionContext,
  isPracticeCampaign,
  lobbyCampaign,
  matchupsOn,
  resolveCharacter,
  withRunDeeds,
  resumeJourney,
  riftActionWays,
  riftPartyOf,
  RIFT_ACTION_KINDS,
  seedRunBuffs,
  takeExit,
  takeRiftAction,
  worldFacts,
} from "@kad/shared";
import type { DeviceIdentity } from "../identity.ts";
import type { ApplyIntentResult, EngineContext } from "../engine/port.ts";
import type { CampaignProgressRecord, CharacterWrite, EventRecord, RunRecord } from "../store/repository.ts";
import { checkNewcomers, followCrew, newcomersTo } from "./crew.ts";
import { diff } from "../json-patch.ts";
import { keepGuestHousehold } from "./account.ts";
import { iso, type HandlerDeps } from "./deps.ts";
import { closedIfIdle } from "./host.ts";
import { prepareStepFinds, recordStepFinds } from "./field-guide.ts";
import { dispatchTurnPush } from "./push.ts";
import { practiceChapterId, practiceRefusal, settlePractice } from "./practice.ts";
import {
  attemptJourney,
  campaignView,
  expectedIndex,
  joinOrStartAttempt,
  lockedRefusal,
  purseFor,
  newCharacterWrite,
  relockLobby,
  seatedParty,
  prepareStatPointSpend,
  prepareClassSwitch,
  prepareRiftWayDeeds,
  seatHero,
  settleChapterCompletion,
  startPartyCampaign,
  type ChapterSettlement,
  type StartedAttempt,
} from "./progression.ts";
import { recordTiming, timingNoteFor } from "./timing.ts";

/** Far above any intent a client builds (a hero's creation is the largest). */
const MAX_LOGGED_INTENT_CHARS = 4096;

/** The part of an identity that authorises an action. */
/**
 * The matchup half of the engine context: `rules.matchups` and the bestiary
 * when `matchupsOn` holds for this campaign, nothing otherwise.
 */
function matchupsContext(
  rules: ReturnType<HandlerDeps["content"]["rules"]>,
  campaignId: string | null,
  deps: HandlerDeps,
): Pick<EngineContext, "matchups" | "bestiary"> {
  if (!rules.matchups || !matchupsOn(rules, campaignId)) return {};
  return { matchups: rules.matchups, bestiary: deps.content.bestiary() };
}

export type ActingPrincipal = Pick<DeviceIdentity, "householdId" | "playerId">;

export interface ActionInput extends ActionRequest {
  /**
   * Resolved from the session or device token when there is one. Present in
   * prod (authorizer), optional in local dev.
   */
  /**
   * Who is acting, as resolved by the transport. A room session token and a
   * device binding both answer this; only the household and the player matter
   * here, so the narrower shape is what the handler asks for.
   */
  principal?: ActingPrincipal | undefined;
}

export async function applyAction(
  received: ActionInput,
  deps: HandlerDeps,
): Promise<ActionResponse> {
  let input = received;
  // The three reads every tap needs, side by side rather than one after
  // another: none depends on another's answer once the principal names the
  // household (always, in prod). `authorize` still checks them in order.
  const principalHome = input.principal?.householdId;
  const [stored, run, principalPlayer] = await Promise.all([
    deps.repo.getState(input.runId),
    deps.repo.getRun(input.runId),
    principalHome ? deps.repo.getPlayer(principalHome, input.playerId) : Promise.resolve(undefined),
  ]);
  if (!stored) {
    return { ok: false, seq: input.seq, error: { code: "NOT_FOUND", message: `no run ${input.runId}` } };
  }
  // An open room idle too long closes now (#249), and `authorize` refuses.
  const state = await closedIfIdle(stored, deps);

  const auth = await authorize(input, state, deps, { run, principalPlayer });
  if ("error" in auth) return auth.error;

  // --- 1. seq gate (§4.2) --------------------------------------------------
  // The client sends its last-seen server seq. Anything but "exactly current"
  // means it is acting on a world that no longer exists — including the ahead
  // case, which is a client that replayed a patch twice. Both answers are the
  // same: here is the real seq, resync.
  if (input.seq !== state.seq) {
    return {
      ok: false,
      seq: state.seq,
      error: {
        code: "STALE_SEQ",
        message: `intent was built on seq ${input.seq}, run is at seq ${state.seq}`,
      },
    };
  }

  // --- 1b. the question it answers (#413) ------------------------------------
  // A phone that fell behind re-posts its tap at the seq this handler reported,
  // so a matching seq does not prove the tap was made on this question. The
  // context it was stamped with does: when the question it answered is gone,
  // a choice id the next question happens to share ("onward") is not an answer
  // to it. Nothing is applied and nothing is logged.
  if (typeof input.context === "string" && input.context !== decisionContext(state)) {
    return {
      ok: false,
      seq: state.seq,
      error: { code: "STALE_DECISION", message: "The story moved on. Choose again." },
    };
  }

  // --- 2. apply ------------------------------------------------------------
  if (input.intent.type === "CONTINUE_CAMPAIGN") {
    // Which campaign is the lobby's decision, not the tapper's (lobbyCampaign).
    const choice = lobbyCampaign(state);
    if (choice.contested && choice.waitingOn.length > 0) {
      const names = choice.waitingOn.map((m) => m.character.name).join(", ");
      return {
        ok: false,
        seq: state.seq,
        error: { code: "ILLEGAL", message: `still waiting for ${names} to pick an adventure` },
      };
    }
    const campaignId = state.campaignOptions?.length ? choice.leader?.id : input.intent.campaignId;
    if (!campaignId) {
      return { ok: false, seq: state.seq, error: { code: "ILLEGAL", message: "no campaign to continue" } };
    }
    // A crew partway through this adventure, and nobody seated has been on it:
    // the host chooses first (crew.ts, `checkNewcomers`), rather than these
    // heroes being dropped into the middle of somebody else's story.
    if (await newcomersTo(state, auth.run.householdId, campaignId, deps)) {
      const title = deps.content.campaign(campaignId)?.title ?? campaignId;
      return {
        ok: false,
        seq: state.seq,
        error: {
          code: "ILLEGAL",
          message: `This crew is partway through ${title}, and none of these heroes have been on it yet. The grown-up running the game picks: keep going, or start a new crew.`,
        },
      };
    }
    const next = await nextChapter(campaignId, auth.run.householdId, seatedParty(state), deps, state.crew);
    if ("refusal" in next) {
      return { ok: false, seq: state.seq, error: { code: next.code, message: next.refusal } };
    }
    // From here on it is an ordinary chapter start — including `roadTo`'s
    // check below, which re-derives the same answer from the same record.
    input = { ...input, intent: { type: "START_CHAPTER", chapterId: next.chapterId } };
  }
  if (input.intent.type === "START_PRACTICE") {
    // The practice (#255): its chapter is content, and whether this party may
    // play it is `roadTo`'s, below, the same as for any start.
    const chapterId = practiceChapterId(deps);
    if (!chapterId) {
      return { ok: false, seq: state.seq, error: { code: "NOT_FOUND", message: "there is no practice to play" } };
    }
    input = { ...input, intent: { type: "START_CHAPTER", chapterId } };
  }

  const chapter = resolveChapter(input, state, deps);
  if (chapter === undefined) {
    const wanted = input.intent.type === "START_CHAPTER" ? input.intent.chapterId : state.chapterId;
    return {
      ok: false,
      seq: state.seq,
      error: { code: "NOT_FOUND", message: `unknown chapter "${String(wanted)}"` },
    };
  }

  /*
   * Which road this party is on — and, because the two are the same question,
   * whether they are allowed to start the chapter they just asked for.
   *
   * `resolveChapter` above answers "does this id name a chapter", which is all
   * a chapter start ever checked. That was enough while a campaign's beats
   * were one file each. A routed beat is several (`shared/routes.ts`), so a
   * client that sends the id of the river variant while the party carries the
   * wild-road flag would have been handed the river — the client picking the
   * branch, which is precisely what architecture §4.1 says it may never do.
   *
   * So the server re-derives the answer from the durable flags and refuses
   * anything else. The same read supplies `campaignFlags` below, because "what
   * road are they on" is one fact, not two.
   */
  let campaignFlags: Record<string, boolean> = {};
  let campaignCoins: number | undefined;
  // A graph campaign's temporary buffs (#200), seeded into the run with its
  // flags. Undefined for every other start, which then carries none.
  let campaignBuffs: RunBuff[] | undefined;
  // Its world facts (#220), for an environment keyed on them. Undefined
  // unless the graph declares facts.
  let campaignFacts: Record<string, FactValue> | undefined;
  let campaignAttemptId: string | null = null;
  let startedAttempt: StartedAttempt | null = null;
  // The journey visit a graph campaign's chapter plays (#194), stamped on the
  // run below so its completion settles against exactly that visit.
  let journeyVisit: { node: NodeId; visit: number } | null = null;
  // The household had already played this chapter (session timing, #511).
  let revisit = false;
  if (input.intent.type === "START_CHAPTER" && chapter) {
    const road = await roadTo(chapter, auth.run.householdId, seatedParty(state), deps, state.crew);
    if ("refusal" in road) {
      return { ok: false, seq: state.seq, error: { code: "ILLEGAL", message: road.refusal } };
    }
    campaignFlags = road.flags;
    campaignCoins = road.coins;
    campaignBuffs = road.buffs;
    campaignFacts = road.facts;
    if (road.campaign) {
      // Join the household's active attempt, or start one — so this room
      // carries the id of the attempt it began under (progression.ts).
      const joined = joinOrStartAttempt(
        road.attempt,
        auth.run.householdId,
        chapter.campaignId,
        input.runId,
        iso(deps.now()),
        // A graph campaign's fresh attempt is created holding its journey.
        road.journey,
        state.crew,
      );
      campaignAttemptId = joined.attemptId;
      startedAttempt = joined.startedAttempt;
      journeyVisit = road.visit ?? null;
      revisit = (road.visit?.visit ?? 1) > 1 || Boolean(road.attempt && (road.attempt.everCompleted || road.attempt.status === "complete"));
    }
  }

  const nowMs = deps.now();
  const nextSeq = state.seq + 1;
  let spentCharacter: CharacterWrite | null = null;
  // A saved hero seated into a chapter under way, acquiring her claim (#282).
  let seated: CharacterWrite | null = null;
  let exitTaken: ExitWrite | null = null;
  let riftDeeds: CharacterWrite[] = [];
  let result: ApplyIntentResult;
  if (input.intent.type === "CHOOSE_EXIT" || input.intent.type === "RIFT_ACTION") {
    // A journey transition, not a run one: the engine never sees it, exactly
    // like SPEND_STAT_POINT below (shared journey.ts decides). A rift action
    // (#197) is CHOOSE_EXIT's sibling: the same read, the same conditional
    // write, the same answer to a repeat.
    const exit =
      input.intent.type === "CHOOSE_EXIT"
        ? await chooseExit(state, input.intent, auth.run.householdId, deps)
        : await riftAction(state, input.intent, auth.run.householdId, deps);
    if ("refusal" in exit) {
      return { ok: false, seq: state.seq, error: { code: exit.code, message: exit.refusal } };
    }
    // The same crossing (or rift action) reported again — a double tap, a
    // retry after a lost response. It already happened; nothing is written
    // and no seq is burned.
    if (exit.duplicate) return { ok: true, seq: state.seq };
    exitTaken = exit.write;
    result = { state: exit.state };
    if (input.intent.type === "RIFT_ACTION") {
      // A class way is that class's story deed (#310), written with the move.
      const campaignId = input.intent.campaignId ?? state.campaignId;
      if (campaignId) {
        const deeds = await prepareRiftWayDeeds(exit.state, campaignId, riftWayClasses(campaignId, input.intent, deps), auth.run.householdId, deps);
        // A deed that cannot be written refuses the move with it: the way is used once.
        if (!deeds.ok) return { ok: false, seq: state.seq, error: deeds.error };
        if (deeds.value.writes.length > 0) {
          riftDeeds = deeds.value.writes;
          result = { state: deeds.value.state };
        }
      }
    }
  } else if (input.intent.type === "SPEND_STAT_POINT") {
    if (auth.run.status !== "active") {
      return {
        ok: false,
        seq: state.seq,
        error: { code: "ILLEGAL", message: "stat points require an active run" },
      };
    }
    const spend = await prepareStatPointSpend(
      state,
      deps,
      auth.run.householdId,
      input.playerId,
      input.intent.stat,
    );
    if (!spend.ok) return { ok: false, seq: state.seq, error: spend.error };
    spentCharacter = spend.value.character;
    result = { state: spend.value.state };
  } else if (input.intent.type === "SWITCH_CLASS") {
    // At a class place (#311) or the fitting stall (#312). Like a stat
    // point, it writes the hero's row, so it is prepared here and committed
    // with the run below.
    if (auth.run.status !== "active") {
      return {
        ok: false,
        seq: state.seq,
        error: { code: "ILLEGAL", message: "a class is switched in an active run" },
      };
    }
    const change = await prepareClassSwitch(
      state,
      deps,
      auth.run.householdId,
      input.playerId,
      input.intent.classId,
      chapter,
      input.intent.stall === true,
    );
    if (!change.ok) return { ok: false, seq: state.seq, error: change.error };
    spentCharacter = change.value.character;
    result = { state: change.value.state };
  } else {
    // A returning hero is a household row the engine cannot reach, so it is
    // loaded here and handed in; whether this player may bring it is the
    // engine's call (doSeatCharacter).
    const savedCharacter =
      input.intent.type === "SEAT_CHARACTER"
        ? await deps.repo.getCharacter(auth.home, input.intent.characterId)
        : undefined;
    // One game at a time per hero (#282): a hero another adventure holds is
    // refused here, before the engine seats anybody.
    if (savedCharacter && savedCharacter.ownerPlayerId === input.playerId) {
      const seat = await seatHero(state, deps, auth.run.householdId, savedCharacter);
      if (!seat.ok) return { ok: false, seq: state.seq, error: seat.error };
      seated = seat.value;
    }
    result = deps.engine.applyIntent(
      state,
      // The engine re-checks seq itself; passing it keeps that guard armed even
      // if this handler is ever bypassed.
      { playerId: input.playerId, intent: input.intent, seq: input.seq },
      {
        rules: deps.content.rules(),
        items: deps.content.items(),
        chapter,
        // The board an encounter scene names. A lookup rather than a value: a
        // chapter can hold several fights, and the engine should not be handed
        // every map it might reach.
        map: (id) => deps.content.map(id),
        // What every class and species action does on the board. A value rather
        // than a lookup, unlike maps: `legalActions` runs for every combatant on
        // every turn and needs the whole catalog anyway.
        abilities: deps.content.abilities(),
        // Characters belong to the household, not the run (architecture §3), so
        // CREATE_CHARACTER needs to know which household it is building into:
        // the player's own, which is the run's unless they are visiting (#249).
        householdId: auth.home,
        ...(savedCharacter === undefined ? {} : { savedCharacter }),
        // The roads this campaign attempt has already taken, which a chapter
        // start seeds its flags from rather than starting empty. Empty for
        // every other intent — nothing else touches the chapter boundary.
        campaignFlags,
        // The purse, carried the same way. Undefined outside a campaign.
        ...(campaignCoins === undefined ? {} : { campaignCoins }),
        // Temporary buffs (#200): a graph campaign's chapter start only.
        ...(campaignBuffs === undefined ? {} : { campaignBuffs }),
        // World facts (#220): a graph campaign with declared facts only.
        ...(campaignFacts === undefined ? {} : { campaignFacts }),
        // Matchups (docs/matchups.md): on unless the run's campaign is exempt
        // (Gemfall is pinned and plays without them, byte for byte). The
        // chapter's own campaign first, so a one-off Gemfall chapter is exempt
        // too. The bestiary rides along for a check scene's creatures.
        ...matchupsContext(deps.content.rules(), chapter?.campaignId ?? state.campaignId, deps),
        // Seeded per event, never per wall clock — see the header. The run's
        // secret keeps the next roll unguessable from the public run id.
        rng: deps.rng(diceSeed(auth.run, input.runId, nextSeq)),
        now: iso(nowMs),
        // Roadmap chapter 6's playtest cheats, refused by the engine unless
        // this is true. `dev-server.ts` sets it; `lambda/runtime.ts` passes a
        // literal `false` (playtest.ts).
        playtest: deps.playtest,
      },
    );
  }

  if (result.error) {
    // An illegal intent leaves the run exactly where it was. No seq is burned:
    // a rejected tap must not force everyone else to resync.
    return { ok: false, seq: state.seq, error: result.error };
  }
  // A visitor's hero sat down (#249): it says where it lives, so everything
  // it earns here is written back there.
  if (auth.home !== auth.run.householdId) {
    result = { ...result, state: withHome(result.state, input.playerId, auth.home) };
  }
  if (result.state.chapterId !== null && (result.state.crewSetup || result.state.crewCheck || result.state.crewConfirmed)) {
    result = { ...result, state: { ...result.state } };
    delete result.state.crewSetup;
    delete result.state.crewCheck;
    delete result.state.crewConfirmed;
  }
  // A hero sat down or got up in the lobby: her own finished campaigns can
  // unlock one the household has not finished (#283), so the lobby's locks
  // follow who is seated. A no-op unless an option declares `requires`.
  if (
    (result.state.phase === "lobby" || result.state.phase === "creation") &&
    !sameParty(state.party, result.state.party)
  ) {
    result = { ...result, state: await relockLobby(result.state, auth.run.householdId, deps) };
    // And the crew follows who sat down: a returning crew's heroes bring
    // their own saves with them (crew.ts). A no-op for a household with none.
    result = { ...result, state: await followCrew(result.state, auth.run.householdId, auth.run.campaignId, deps) };
  }
  // Whether the heroes now seated are new to the adventure the lobby rests on
  // (crew.ts): rechecked when who is seated or which adventure leads changes.
  if (
    (result.state.phase === "lobby" || result.state.phase === "creation") &&
    (!sameParty(state.party, result.state.party) ||
      state.campaignVotes !== result.state.campaignVotes ||
      state.crew !== result.state.crew)
  ) {
    result = { ...result, state: await checkNewcomers(result.state, auth.run.householdId, deps) };
  }

  /*
   * Progression, computed here and committed below.
   *
   * The engine is pure and cannot reach the store, so this is where a character
   * created at the table becomes a household row and where a completed
   * chapter's XP becomes a level (progression.ts). Two things about the timing
   * are load-bearing:
   *
   * It runs *before* `diff()`, so a re-resolved character rides out on this
   * turn's patch — afterwards it would persist correctly and show nobody.
   *
   * And it only *computes* the rows. They are written by `repo.commit()` in the
   * same conditional transaction as the state and the event, so a turn that
   * loses the seq race cannot leave its XP behind on a character.
   */
  const characters: CharacterWrite[] = [...riftDeeds];
  if (spentCharacter) characters.push(spentCharacter);
  if (seated) {
    const hero = seated.character;
    characters.push(seated);
    // She plays this chapter's gains from her first tap, and every phone sees
    // her as she now stands: provisional, at this table.
    const resolved = withRunDeeds(
      resolveCharacter(hero, deps.content.rules(), deps.content.items()),
      result.state,
      deps.content.rules(),
    );
    result = {
      ...result,
      state: {
        ...result.state,
        party: result.state.party.map((m) => (m.character.id === hero.id ? { ...m, character: resolved } : m)),
      },
    };
  }
  if (result.created) {
    characters.push(...(await newCharacterWrite(result.created, deps, auth.home)));
  }
  /*
   * Keyed off the phase transition, not the presentation.
   *
   * A chapter can finish without a CHAPTER_COMPLETE presentation ever being
   * returned: when a check's branch lands on an ending scene, `doRoll` keeps
   * the ROLL presentation on purpose — the dice are the centrepiece of the
   * screen — and says so in a comment. Watching for the presentation therefore
   * missed every chapter that ends straight off a roll, and the ADVANCE that
   * follows leaves `chapter_complete` without a second chance, so the whole
   * award was silently lost.
   *
   * The before/after phase cannot miss a path in, and cannot fire twice: the
   * run has to have been somewhere else a moment ago.
   */
  const finishedChapter =
    state.phase !== "chapter_complete" && result.state.phase === "chapter_complete";
  // The practice is never a campaign a hero is claimed for (#255, practice.ts).
  const practice = isPracticeCampaign(result.state.campaignId);
  const startedCampaign =
    input.intent.type === "START_CHAPTER" && Boolean(result.state.campaignId) && !practice;
  // Which attempt this chapter belongs to, so its completion can be checked
  // against the attempt it was started under (settleChapterCompletion).
  if (input.intent.type === "START_CHAPTER") {
    // A new chapter: whatever the last one ended, that moment has passed.
    const campaign = result.state.campaign ? { ...result.state.campaign } : result.state.campaign;
    if (campaign) delete campaign.ended;
    const stamped: RunState = { ...result.state, campaignAttemptId, campaign };
    // A pause belongs to the sitting it was made in (#511).
    delete stamped.timingPaused;
    // Only a graph campaign's run carries a visit; an ordered start leaves the
    // key absent (and clears one a graph chapter earlier in this room left).
    if (journeyVisit) stamped.journeyVisit = journeyVisit;
    else delete stamped.journeyVisit;
    result = { ...result, state: stamped };
  }
  if (startedCampaign && !finishedChapter) {
    // Campaign entry is a progression transition too. Seed/re-seed every
    // stored character and re-resolve the party before diffing so the same
    // action patch exposes isProvisional and committedLevel to clients. An
    // entry scene that immediately completes is handled by settlement below,
    // avoiding two writes to the same character in one transaction.
    const started = await startPartyCampaign(result.state, deps, auth.run.householdId);
    // A hero another adventure holds cannot start this one (#282): nothing is
    // written, no seq is burned, and the table is told who.
    if (!started.ok) return { ok: false, seq: state.seq, error: started.error };
    characters.push(...started.value);
  }
  let settlement: ChapterSettlement | null = null;
  if (finishedChapter) {
    // XP, the chapter's record, the setback counter, and — when this
    // completion decides it — the campaign's fate (progression.ts). All of it
    // rides the same conditional commit below.
    settlement = practice
      ? await settlePractice(result.state, deps, auth.run.householdId)
      : await settleChapterCompletion(result.state, deps, auth.run.householdId, startedAttempt ?? undefined);
    characters.push(...settlement.characters);
    if (settlement.campaignView) {
      // What the lobby offers next, and whether this chapter just ended the
      // whole campaign — the completion screen reads it (RunState.campaign).
      // The lobby's list follows: the campaign just played is one of its
      // options, and a phone back in the lobby must see where it now stands.
      const view = settlement.campaignView;
      const options = result.state.campaignOptions?.map((o) => (o.id === view.id ? view : o));
      result = {
        ...result,
        state: { ...result.state, campaign: view, ...(options ? { campaignOptions: options } : {}) },
      };
    }
    if (settlement.stale || settlement.replay) {
      // Another room already finished this beat for the household — or, in a
      // graph campaign, this chapter already paid this attempt (a replay). The
      // table still sees its chapter end; it is not told it earned XP it did
      // not get.
      result = { ...result, state: { ...result.state, xpEarned: 0, bonuses: [] } };
    } else if (settlement.alreadyPaid) {
      // A hero the chapter paid before earned nothing now (#408). The others
      // did, so the total stands; the screens say who it skipped.
      result = { ...result, state: { ...result.state, xpAlreadyPaid: settlement.alreadyPaid } };
    }
  }
  const progression =
    startedCampaign || finishedChapter || spentCharacter
      ? {
          characters: result.state.party.map((member) => member.character),
          ...(settlement && settlement.awards.length > 0
            ? { awards: settlement.awards }
            : {}),
        }
      : undefined;

  const next: RunState = {
    ...result.state,
    seq: nextSeq,
    updatedAt: iso(nowMs),
  };

  /*
   * The Field Guide (#106, field-guide.ts) — what this step revealed.
   *
   * Worked out before `diff()` so the household's book, with this step's finds
   * in it, rides the same patch as the scene that revealed them; *recorded*
   * after the commit (below), because the book is the household's and is not
   * part of this run's transaction. Read off before/after, like
   * `finishedChapter` above, so no path into a scene can skip it.
   */
  const finds = await prepareStepFinds(
    {
      before: state,
      after: next,
      chapter,
      chapterStarted: input.intent.type === "START_CHAPTER",
      actorId: input.playerId,
      run: auth.run,
      now: iso(nowMs),
    },
    deps,
  );
  if (finds) next.fieldGuide = finds.book;

  const timing = timingNoteFor(
    { before: state, after: next, chapter: chapter ?? undefined, started: input.intent.type === "START_CHAPTER", finished: finishedChapter, revisit },
    deps,
  );

  const patch = diff(state, next);

  /*
   * A no-op intent (a re-tap, a READY that was already true) writes nothing.
   * Burning a seq on it would churn every client's mirror for no reason. The
   * engine stamps seq and updatedAt on every accepted intent, so "did anything
   * happen?" is asked of the one patch we were going to need anyway: if the
   * only operations are the two transport fields, nothing did. This used to be
   * a separate full deep diff (plus two full-state spreads) run *before* the
   * real one — three walks of the whole RunState per tap where one suffices.
   */
  const trivial = patch.every((op) => op.path === "/seq" || op.path === "/updatedAt");
  // A taken exit is never trivial, even when this room shows nothing of the
  // campaign it moved: the household's journey changed and must be written.
  if (!result.presentation && trivial && !exitTaken) {
    return { ok: true, seq: state.seq };
  }

  const event: EventRecord = {
    seq: nextSeq,
    runId: input.runId,
    patch,
    ...(result.presentation ? { presentation: result.presentation } : {}),
    ...(progression ? { progression } : {}),
    at: iso(nowMs),
    playerId: input.playerId,
    // Kept for the log's own sake, while it is the size of a real intent.
    // The engine ignores fields it does not know, so a padded one would
    // otherwise be accepted and stored as sent.
    intent: JSON.stringify(input.intent).length <= MAX_LOGGED_INTENT_CHARS ? input.intent : ({ type: input.intent.type } as ClientIntent),
  };

  // State and event land together or not at all — the log can never disagree
  // with the snapshot it is supposed to explain.
  const committed = await deps.repo.commit({
    runId: input.runId,
    expectedSeq: state.seq,
    state: next,
    event,
    ...(characters.length > 0 ? { characters } : {}),
    ...(settlement?.chapterProgress ? { chapterProgress: settlement.chapterProgress } : {}),
    ...(settlement?.campaignProgress
      ? {
          campaignProgress: settlement.campaignProgress,
          campaignProgressExpectedVersion: settlement.campaignProgressExpectedVersion ?? null,
        }
      : startedAttempt
        ? {
            // A fresh start creates the attempt, conditionally: two rooms
            // starting at once cannot both create one.
            campaignProgress: startedAttempt.attempt,
            campaignProgressExpectedVersion: startedAttempt.expectedVersion,
          }
        : exitTaken
          ? {
              // The journey moved, under the version it was read at: two
              // phones taking different exits at once cannot both land.
              campaignProgress: exitTaken.attempt,
              campaignProgressExpectedVersion: exitTaken.expectedVersion,
            }
          : {}),
  });
  if (!committed) {
    // Two phones tapped inside the same millisecond. One of them wins; the
    // other is, by definition, now stale.
    const current = await deps.repo.getState(input.runId);
    return {
      ok: false,
      seq: current?.seq ?? state.seq,
      error: { code: "STALE_SEQ", message: "another action landed first; resync" },
    };
  }

  // A finished chapter is play: a guest household's week starts again. Started
  // after the commit, so only a chapter that really landed counts — and
  // awaited only after the broadcast below, so a slow store call can never
  // hold the completion back from the table.
  const renewal = finishedChapter ? keepHomes(auth.run.householdId, next, deps) : null;

  /*
   * The finds land in the household's book now that the step has, and what the
   * store says was *new* rides this broadcast as `discovered` — the "new page!"
   * signal (#110). On the message and not on `event`: the log is what a
   * reconnect replays (§4.3), and a replay must never announce a find twice.
   *
   * This is the one store write that sits in front of the broadcast, and only
   * on a step that found something not already in the book — a handful of
   * times a chapter. It is there so the signal can ride the patch that shows
   * the scene; publishing first would mean a second, out-of-band message.
   */
  const discovered = await recordStepFinds(finds, deps);

  // The session clock's mark (#511), written alongside the broadcast and
  // awaited with the other after-commit work. It cannot fail the turn.
  const recording = recordTiming(deps, { runId: input.runId, chapterId: next.chapterId, seq: nextSeq, at: event.at }, timing);

  const message = {
    kind: "patch" as const,
    seq: event.seq,
    runId: event.runId,
    patch: event.patch,
    ...(event.presentation ? { presentation: event.presentation } : {}),
    ...(event.progression ? { progression: event.progression } : {}),
    ...(discovered.length > 0 ? { discovered } : {}),
  };
  try {
    await deps.channel.publish(next.roomCode, message);
  } catch (err) {
    /*
     * The transaction has already landed, so this request *succeeded* — a 500
     * here would tell the acting phone to retry an action that took, and the
     * retry would bounce off STALE_SEQ while every other client stayed dark.
     *
     * But "ok" alone is not a recovery contract either: subscribers wait on
     * this broadcast, and nothing else is coming to open a gap for them. So:
     * one immediate retry for the transient blip, and past that the response
     * still names the committed seq — the client holds the server to that
     * (store `expectBroadcast`), resyncing when the promised patch never
     * arrives. Duplicate delivery is safe by construction: the sequencer
     * drops anything at or below its watermark.
     */
    console.error(`publish failed for run ${event.runId} seq ${event.seq}, retrying:`, err);
    try {
      await deps.channel.publish(next.roomCode, message);
    } catch (retryErr) {
      console.error(`publish retry failed for run ${event.runId} seq ${event.seq}:`, retryErr);
    }
  }

  if (renewal) await renewal;
  await recording;

  // A question this step opened for somebody (#466): the job is decided here,
  // from the two states already in hand, and handed to the push sender, off
  // the request path. Only the hand-over is awaited, and never for long
  // (`DISPATCH_WAIT_MS`); nothing about presence, phones or push services is.
  await dispatchTurnPush({ before: state, after: next, actorId: input.playerId }, deps);

  return { ok: true, seq: nextSeq };
}

/**
 * The chapter the engine needs for this intent.
 *
 * `undefined` means "asked for a chapter that does not exist" — an error.
 * `null` means "no chapter yet", which is the correct context for the lobby and
 * character creation. START_CHAPTER is the one intent that needs the chapter it
 * is moving *to* rather than the one the state is on.
 */
function resolveChapter(
  input: ActionInput,
  state: RunState,
  deps: HandlerDeps,
): Chapter | null | undefined {
  const chapterId =
    input.intent.type === "START_CHAPTER" ? input.intent.chapterId : state.chapterId;
  if (!chapterId) return null;
  return deps.content.chapter(chapterId) ?? undefined;
}

/**
 * The durable route flags for the chapter a party is trying to start, or the
 * reason they may not start it.
 *
 * Three cases, and only the third is new:
 *
 *  - **A chapter the campaign does not claim** — a one-off, a fixture, a
 *    chapter whose campaign file is not in this content set. Nothing to check
 *    and no flags to seed. This is every chapter authored before routing
 *    existed, and it stays the common case.
 *  - **An unrouted beat** — one chapter at that index, so `chapterAt` returns
 *    it and the check is a tautology that costs one map lookup.
 *  - **A routed beat** — several chapters at that index. The party's road
 *    decides which, and the *server* decides the road: whatever id arrived on
 *    the intent, only the chapter the flags select may be entered.
 *
 * A finished attempt (`complete` or `failed`) seeds nothing, matching the
 * setback counter directly above it in the record: the next chapter completion
 * starts a fresh attempt, and a fresh attempt has taken no roads yet. That
 * means a party replaying a campaign chooses again rather than inheriting the
 * country they walked through last time.
 */
async function roadTo(
  chapter: Chapter,
  householdId: string,
  /** Who is starting it: any one hero's own record can meet a prerequisite (#283). */
  party: readonly PartyMember[],
  deps: HandlerDeps,
  /** Whose saves (`RunState.crew`): absent is the household's first crew. */
  crew?: string,
): Promise<
  | {
      flags: Record<string, boolean>;
      coins?: number;
      campaign: boolean;
      attempt: CampaignProgressRecord | null;
      /** A graph campaign's journey, as this start finds it (#194). */
      journey?: JourneyState;
      /** The visit this start plays — stamped on the run (`RunState.journeyVisit`). */
      visit?: { node: NodeId; visit: number };
      /** The journey's temporary buffs, resolved for the run (#200). Graph campaigns only. */
      buffs?: RunBuff[];
      /** The journey's world facts (#220), when the graph declares any. */
      facts?: Record<string, FactValue>;
    }
  | { refusal: string }
> {
  // A playtest start (deps.ts `playtestStart`, dev-seed.ts): any chapter, out of order and
  // unlocked, with the flags and facts the developer asked for, and no attempt, so nothing it
  // does reaches the household's journey. Only where the playtest cheats are allowed at all.
  const forced = deps.playtest ? deps.playtestStart : undefined;
  if (forced && forced.chapterId === chapter.id) {
    return { flags: { ...(forced.flags ?? {}) }, ...(forced.facts ? { facts: { ...forced.facts } } : {}), campaign: false, attempt: null };
  }
  const campaign = deps.content.campaign(chapter.campaignId);
  if (!campaign || !campaign.chapters.includes(chapter.id)) {
    return { flags: {}, campaign: false, attempt: null };
  }
  // The practice (#255): no attempt and no road, and only while somebody
  // seated is new to the game, so it runs once per hero.
  if (isPracticeCampaign(campaign.id)) {
    const refusal = practiceRefusal(party);
    return refusal ? { refusal } : { flags: {}, campaign: false, attempt: null };
  }

  // A campaign this table has not unlocked (#221) starts nothing - whatever
  // the lobby showed, and whichever intent asked. Absent `requires`, a no-op.
  // The household's record or any seated hero's own meets it (#283).
  const locked = await lockedRefusal(campaign, householdId, deps, party, crew);
  if (locked) return { refusal: locked };

  const attempt = await deps.repo.getCampaignProgress(householdId, chapter.campaignId, crew);
  const graph = deps.content.graph(campaign.id);
  if (graph) {
    /*
     * A graph campaign (#194): no beat, no road — the journey says which
     * chapter is next, and only that chapter may start. The answer is the one
     * CONTINUE_CAMPAIGN computes (`nextChapter`), from the same read: the
     * visit under way resumes (same visit, same resolved chapter), and a
     * party standing at a choice starts nothing until it has chosen.
     *
     * Its flags are the journey's, seeded into the run so a chapter can read
     * what an earlier place decided (§5 of graph-campaigns.md).
     */
    const resumed = attemptJourney(campaign, graph, attempt);
    if (!resumed.ok) return { refusal: `this party's map of "${campaign.id}" cannot be read: ${resumed.message}` };
    const playable = currentPlayable(graph, resumed.journey);
    if (playable.kind !== "play") {
      return {
        refusal:
          playable.kind === "choose"
            ? `this party is at "${playable.node}" choosing a way on, not starting a chapter`
            : `this party's journey through "${campaign.id}" has reached its ending`,
      };
    }
    if (playable.chapter !== chapter.id) {
      return {
        refusal: `this party's next chapter of "${campaign.id}" is "${playable.chapter}" at "${playable.node}", not "${chapter.id}"`,
      };
    }
    return {
      flags: { ...(resumed.journey.flags ?? {}) },
      coins: purseFor(campaign, attempt),
      campaign: true,
      attempt,
      journey: resumed.journey,
      visit: { node: playable.node, visit: playable.visit },
      // Seeded from the journey every time this visit's chapter starts, so a
      // restart never inherits what an abandoned run had already spent.
      buffs: seedRunBuffs(graph.buffs, resumed.journey.buffs),
      // What an environment's variants test (#220), read the same way.
      ...(Object.keys(graph.facts ?? {}).length > 0 ? { facts: worldFacts(graph.facts ?? {}, resumed.journey) } : {}),
    };
  }
  const flags =
    attempt && attempt.status === "active" ? { ...(attempt.routeFlags ?? {}) } : {};

  // The beat, before the road. A chapter id names its index, and a client that
  // could start any index it liked could skip a beat or walk an attempt
  // backwards — and settlement would then record that index as where the
  // party got to. The answer is the one CONTINUE_CAMPAIGN computes.
  const expected = expectedIndex(campaign, attempt, deps);
  if (chapter.index !== expected) {
    return {
      refusal: `this party's next chapter of "${campaign.id}" is beat ${expected}, not beat ${chapter.index}`,
    };
  }

  const road = deps.content.chapterAt(chapter.campaignId, chapter.index, flags);
  if (!road) {
    // Only reachable at a routed beat the party has no flag for — they are
    // standing at a fork having never chosen. Stopping here with a message is
    // the whole reason `chapterFor` refuses rather than picking a file.
    return {
      refusal: `chapter "${chapter.id}" is one of several roads through beat ${chapter.index}, and this party has not taken one`,
    };
  }
  if (road.id !== chapter.id) {
    return {
      refusal: `this party's road through beat ${chapter.index} is "${road.id}", not "${chapter.id}"`,
    };
  }
  // The purse rides with the road (see `purseFor`, which also backfills an
  // attempt saved before the purse existed).
  const coins = purseFor(campaign, attempt);
  return { flags, coins, campaign: true, attempt };
}

/**
 * The chapter a party continuing this campaign plays next.
 *
 * The beat after the last one this attempt finished, on the road the attempt
 * carries. A finished attempt (`complete` or `failed`) or no attempt at all
 * starts again at beat one with no roads — the same rule `roadTo` applies to
 * seeding, so a replayed campaign chooses its roads again.
 */
async function nextChapter(
  campaignId: string,
  householdId: string,
  party: readonly PartyMember[],
  deps: HandlerDeps,
  /** Whose saves (`RunState.crew`): absent is the household's first crew. */
  crew?: string,
): Promise<{ chapterId: string } | { refusal: string; code: "NOT_FOUND" | "ILLEGAL" }> {
  const campaign = deps.content.campaign(campaignId);
  if (!campaign) return { refusal: `unknown campaign "${campaignId}"`, code: "NOT_FOUND" };

  // Refused here too, so a locked Begin answers before it resolves a chapter (#221).
  const locked = await lockedRefusal(campaign, householdId, deps, party, crew);
  if (locked) return { refusal: locked, code: "ILLEGAL" };

  const attempt = await deps.repo.getCampaignProgress(householdId, campaignId, crew);
  const graph = deps.content.graph(campaignId);
  if (graph) {
    // A graph campaign (#194): the journey's current visit — resumed, never
    // replayed — or the fresh start at the entry. A party choosing a way on
    // has nothing to continue until it chooses (CHOOSE_EXIT).
    const resumed = attemptJourney(campaign, graph, attempt);
    if (!resumed.ok) {
      return { refusal: `this party's map of "${campaignId}" cannot be read: ${resumed.message}`, code: "ILLEGAL" };
    }
    const playable = currentPlayable(graph, resumed.journey);
    if (playable.kind === "choose") {
      return { refusal: `this party is at "${playable.node}" and has not chosen a way on yet`, code: "ILLEGAL" };
    }
    if (playable.kind === "ended") {
      return { refusal: `this party's journey through "${campaignId}" has reached its ending`, code: "ILLEGAL" };
    }
    return { chapterId: playable.chapter };
  }
  const flags = attempt && attempt.status === "active" ? { ...(attempt.routeFlags ?? {}) } : {};
  const index = expectedIndex(campaign, attempt, deps);

  const chapter = deps.content.chapterAt(campaignId, index, flags);
  if (!chapter) {
    return {
      refusal: `beat ${index} of "${campaignId}" is several roads, and this party has not taken one`,
      code: "ILLEGAL",
    };
  }
  return { chapterId: chapter.id };
}

/** The attempt row a taken exit owes, and the version it was read at. */
interface ExitWrite {
  attempt: CampaignProgressRecord;
  expectedVersion: number;
}

/**
 * CHOOSE_EXIT (#194): take a way on out of the node a graph campaign's
 * journey is at — shared `takeExit` decides, against the household's stored
 * journey, and this only reads it, writes it back, and shows the result.
 *
 * Between chapters only. The journey refuses an exit while its visit is
 * playing anyway, but a room *in the middle of a chapter* is refused here
 * first and plainly, because that room is the one place a tap could come from
 * that thinks it is somewhere it is not.
 *
 * The room's views of the campaign — `campaign` (when it is this campaign, or
 * none yet) and the lobby's option for it — are refreshed on the same patch,
 * so every phone sees the party arrive. The attempt row is written by the
 * action's own commit under the version read here (`ExitWrite`).
 */
async function chooseExit(
  state: RunState,
  intent: Extract<ClientIntent, { type: "CHOOSE_EXIT" }>,
  householdId: string,
  deps: HandlerDeps,
): Promise<JourneyMove> {
  return moveJourney(state, intent.campaignId, householdId, deps, "a way on is chosen", (graph, journey, campaign) =>
    takeExit(graph, journey, { edge: intent.edgeId, visit: intent.visit }, campaign),
  );
}

/**
 * RIFT_ACTION (#197): discover, open, close, steady or turn a rift where the
 * party stands — shared `takeRiftAction` decides. Everything else is
 * CHOOSE_EXIT's: between chapters only, the household's stored journey read
 * at a version and written back under it in the action's one conditional
 * commit (so the rift's change and its rule's effects land together or not at
 * all), a repeat answered as done without a write, and every phone's view of
 * the campaign refreshed on the same patch — which is how a second phone, or
 * a phone that dropped and rejoined, sees what the action did.
 *
 * A way that needs a particular hero (#199, `requires`) is judged here, and
 * only here, against the party **seated in this room now** (`state.party`,
 * the resolved characters: their classes, their inventories and quest
 * items). Never against the journey — the journey is the household's across
 * evenings, the table is tonight's — and never by the engine, which never
 * sees a journey. Nobody seated who can: refused (`"party-cannot"`), nothing
 * written. What a way earns (a Starweaver's attunement) is a world fact its
 * effects write, so it is stored on the attempt row with the rest of the
 * journey and is there on the next evening, whoever comes.
 */
async function riftAction(
  state: RunState,
  intent: Extract<ClientIntent, { type: "RIFT_ACTION" }>,
  householdId: string,
  deps: HandlerDeps,
): Promise<JourneyMove> {
  const party = riftPartyOf(state.party.map((member) => member.character));
  return moveJourney(state, intent.campaignId, householdId, deps, "a rift is acted on", (graph, journey, campaign) =>
    takeRiftAction(
      graph,
      journey,
      {
        action: intent.action,
        edge: intent.edgeId,
        visit: intent.visit,
        ...(typeof intent.to === "string" ? { to: intent.to } : {}),
        ...(typeof intent.way === "string" ? { way: intent.way } : {}),
      },
      campaign,
      { party },
    ),
  );
}

/** The classes the rift way an action takes asks for (#199), if any. */
function riftWayClasses(
  campaignId: string,
  intent: Extract<ClientIntent, { type: "RIFT_ACTION" }>,
  deps: HandlerDeps,
): readonly ClassId[] | undefined {
  const rift = deps.content.graph(campaignId)?.edges[intent.edgeId]?.rift;
  if (!rift || !(RIFT_ACTION_KINDS as readonly string[]).includes(intent.action)) return undefined;
  const ways = riftActionWays(rift, intent.action);
  const chosen = typeof intent.way === "string" ? ways.find((each) => each.way === intent.way) : ways.length === 1 ? ways[0] : undefined;
  return chosen?.rule.requires?.anyClass;
}

type JourneyMove =
  | { refusal: string; code: "NOT_FOUND" | "ILLEGAL" }
  | { duplicate: true }
  | { duplicate: false; state: RunState; write: ExitWrite };

/**
 * The read-move-write every between-chapters journey intent shares
 * (CHOOSE_EXIT, RIFT_ACTION): the phase, the campaign and its graph, the
 * household's active attempt and its readable journey, then `move` — the
 * shared transition — and, unless it refused or was a repeat, the attempt row
 * it owes and the room's refreshed views.
 */
async function moveJourney(
  state: RunState,
  requestedCampaign: string | undefined,
  householdId: string,
  deps: HandlerDeps,
  what: string,
  move: (
    graph: ParsedCampaignGraph,
    journey: JourneyState,
    campaign: Campaign,
  ) => { ok: false; code: string; message: string } | { ok: true; duplicate: true } | { ok: true; duplicate: false; journey: JourneyState },
): Promise<JourneyMove> {
  if (state.phase !== "lobby" && state.phase !== "creation" && state.phase !== "chapter_complete") {
    return { refusal: `${what} between chapters, not in the middle of one`, code: "ILLEGAL" };
  }
  const campaignId = requestedCampaign ?? state.campaignId;
  if (!campaignId) return { refusal: "no campaign to choose a way through", code: "ILLEGAL" };
  const campaign = deps.content.campaign(campaignId);
  if (!campaign) return { refusal: `unknown campaign "${campaignId}"`, code: "NOT_FOUND" };
  const graph = deps.content.graph(campaignId);
  if (!graph) return { refusal: `"${campaignId}" has no map to choose a way through`, code: "ILLEGAL" };

  const attempt = await deps.repo.getCampaignProgress(householdId, campaignId, state.crew);
  if (!attempt || attempt.status !== "active") {
    return { refusal: `this party has no journey under way in "${campaignId}"`, code: "ILLEGAL" };
  }
  const resumed = resumeJourney(graph, attempt.journey, campaign);
  if (!resumed.ok) {
    return { refusal: `this party's map of "${campaignId}" cannot be read: ${resumed.message}`, code: "ILLEGAL" };
  }
  const step = move(graph, resumed.journey, campaign);
  if (!step.ok) return { refusal: step.message, code: step.code === "unknown-edge" ? "NOT_FOUND" : "ILLEGAL" };
  if (step.duplicate) return { duplicate: true };

  const now = iso(deps.now());
  const moved: CampaignProgressRecord = {
    ...attempt,
    journey: step.journey,
    version: (attempt.version ?? 0) + 1,
    updatedAt: now,
  };
  const view = campaignView(campaign, moved, deps);
  const options = state.campaignOptions?.map((option) => (option.id === view.id ? view : option));
  const showsThis = !state.campaign || state.campaign.id === view.id;
  return {
    duplicate: false,
    state: {
      ...state,
      ...(showsThis ? { campaign: view } : {}),
      ...(options ? { campaignOptions: options } : {}),
    },
    write: { attempt: moved, expectedVersion: attempt.version ?? 0 },
  };
}

/**
 * The seed for one event's dice. `runId:seq` alone is public (every screen has
 * the run id and the seq), which made the next roll computable; the run's
 * server-only secret in front of it is not. A run from before the secret
 * existed keeps its old seed so its log still replays roll for roll.
 */
export function diceSeed(run: Pick<RunRecord, "diceSecret">, runId: string, seq: number): string {
  return run.diceSecret ? `${run.diceSecret}:${runId}:${String(seq)}` : `${runId}:${String(seq)}`;
}

/**
 * A player may only act as themselves, and only inside their own household's
 * run (§4.5), or as a visitor the run has seated (#249). In prod the principal
 * comes from the authorizer; in local dev it may be absent, in which case the
 * household membership check still holds.
 *
 * `home` is the household the player's hero lives in: the run's, or a
 * visitor's own. Every character read and write for this player goes there.
 */
async function authorize(
  input: ActionInput,
  state: RunState,
  deps: HandlerDeps,
  read: {
    run: RunRecord | null;
    /** Read from the principal's household; undefined when there is no principal. */
    principalPlayer: Awaited<ReturnType<HandlerDeps["repo"]["getPlayer"]>> | undefined;
  },
): Promise<{ run: RunRecord; home: string } | { error: ActionResponse }> {
  if (input.principal && input.principal.playerId !== input.playerId) {
    return errorResult({
      ok: false,
      seq: state.seq,
      error: { code: "FORBIDDEN", message: "this device cannot act for another player" },
    });
  }

  // Taken out by the host (#267, `removePlayer`). Their session token is still
  // well-formed until the room ends; this is what makes it worthless.
  if (state.removed?.includes(input.playerId)) {
    return errorResult({
      ok: false,
      seq: state.seq,
      error: { code: "FORBIDDEN", message: "This phone was taken out of the game." },
    });
  }

  // Closed by its host (#263): the room is over for everybody.
  if (state.closed) {
    return errorResult({
      ok: false,
      seq: state.seq,
      error: { code: "FORBIDDEN", message: "This game was closed." },
    });
  }

  const run = read.run;
  if (!run) {
    return errorResult({
      ok: false,
      seq: state.seq,
      error: { code: "NOT_FOUND", message: `no run ${input.runId}` },
    });
  }
  const home = input.principal?.householdId ?? run.householdId;
  // A visitor is somebody the join seated from that household (`RoomSeat`).
  // Their session reaches this room and their own heroes, nothing more.
  if (home !== run.householdId && state.seats?.[input.playerId]?.homeHouseholdId !== home) {
    return errorResult({
      ok: false,
      seq: state.seq,
      error: { code: "FORBIDDEN", message: "this device belongs to a different household" },
    });
  }

  const player =
    read.principalPlayer !== undefined ? read.principalPlayer : await deps.repo.getPlayer(home, input.playerId);
  if (!player) {
    return errorResult({
      ok: false,
      seq: state.seq,
      error: { code: "FORBIDDEN", message: `player ${input.playerId} is not in this household` },
    });
  }
  // Retired by an organizer (#248). Read from the profile, so it holds even
  // before (or without) the run's `removed` list catching up.
  if (player.retired) {
    return errorResult({
      ok: false,
      seq: state.seq,
      error: { code: "FORBIDDEN", message: "This player was taken off the list." },
    });
  }
  return { run, home };
}

/** Do two parties seat the same heroes? */
function sameParty(a: readonly PartyMember[], b: readonly PartyMember[]): boolean {
  const ids = (party: readonly PartyMember[]) => party.map((m) => m.character.id).sort().join(" ");
  return ids(a) === ids(b);
}

/** The player's party member, marked as living in `home` (`PartyMember.homeHouseholdId`). */
function withHome(state: RunState, playerId: string, home: string): RunState {
  const at = state.party.findIndex((m) => m.playerId === playerId);
  const member = state.party[at];
  if (!member || member.homeHouseholdId === home) return state;
  const party = [...state.party];
  party[at] = { ...member, homeHouseholdId: home };
  return { ...state, party };
}

/**
 * A finished chapter renews every guest household that played in it: the
 * room's, and each visitor's (#249), whose heroes were played here too. All
 * at once, and awaited together, so none is left running after the response.
 * None of them throws (`keepGuestHousehold`).
 */
async function keepHomes(runHousehold: string, state: RunState, deps: HandlerDeps): Promise<void> {
  const homes = new Set([runHousehold, ...state.party.flatMap((m) => (m.homeHouseholdId ? [m.homeHouseholdId] : []))]);
  await Promise.all([...homes].map((home) => keepGuestHousehold(home, deps)));
}

function errorResult(error: ActionResponse): { error: ActionResponse } {
  return { error };
}
