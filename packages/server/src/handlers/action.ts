/**
 * `POST /action` — the core loop, architecture §4.1–§4.2.
 *
 *   validate seq → applyIntent → persist state → append to the event log
 *                → compute an RFC 6902 patch → publish { seq, patch, presentation }
 *
 * Three things this file is responsible for keeping true:
 *
 * 1. **All dice roll here.** The client sends an *intent*; the server decides
 *    what happened. The `Rng` is seeded from `runId:seq`, so replaying the event
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
  Chapter,
  RunState,
} from "@kad/shared";
import type { DeviceIdentity } from "../identity.ts";
import type { ApplyIntentResult } from "../engine/port.ts";
import type { EventRecord, RunRecord } from "../store/repository.ts";
import { diff } from "../json-patch.ts";
import { arrivalKey, authoredLine, nextMoments } from "../llm/moments.ts";
import { partyBrief } from "../llm/port.ts";
import { iso, type HandlerDeps } from "./deps.ts";
import {
  newCharacterWrite,
  prepareStatPointSpend,
  settleChapterCompletion,
  startPartyCampaign,
  type ChapterSettlement,
} from "./progression.ts";

/** The part of an identity that authorises an action. */
export type ActingPrincipal = Pick<DeviceIdentity, "householdId" | "playerId" | "role">;

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
  input: ActionInput,
  deps: HandlerDeps,
): Promise<ActionResponse> {
  const state = await deps.repo.getState(input.runId);
  if (!state) {
    return { ok: false, seq: input.seq, error: { code: "NOT_FOUND", message: `no run ${input.runId}` } };
  }

  const auth = await authorize(input, state, deps);
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

  // --- 2. apply ------------------------------------------------------------
  const chapter = resolveChapter(input, state, deps);
  if (chapter === undefined) {
    const wanted = input.intent.type === "START_CHAPTER" ? input.intent.chapterId : state.chapterId;
    return {
      ok: false,
      seq: state.seq,
      error: { code: "NOT_FOUND", message: `unknown chapter "${String(wanted)}"` },
    };
  }

  const nowMs = deps.now();
  const nextSeq = state.seq + 1;
  let spentCharacter: Character | null = null;
  let result: ApplyIntentResult;
  if (input.intent.type === "SPEND_STAT_POINT") {
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
  } else {
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
        // CREATE_CHARACTER needs to know which household it is building into.
        householdId: auth.run.householdId,
        // Seeded per event, never per wall clock — see the header.
        rng: deps.rng(`${input.runId}:${nextSeq}`),
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
  const characters: Character[] = [];
  if (spentCharacter) characters.push(spentCharacter);
  if (result.created) {
    characters.push(...(await newCharacterWrite(result.created, deps, auth.run.householdId)));
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
  const startedCampaign = input.intent.type === "START_CHAPTER" && Boolean(result.state.campaignId);
  if (startedCampaign && !finishedChapter) {
    // Campaign entry is a progression transition too. Seed/re-seed every
    // stored character and re-resolve the party before diffing so the same
    // action patch exposes isProvisional and committedLevel to clients. An
    // entry scene that immediately completes is handled by settlement below,
    // avoiding two writes to the same character in one transaction.
    characters.push(...(await startPartyCampaign(result.state, deps, auth.run.householdId)));
  }
  let settlement: ChapterSettlement | null = null;
  if (finishedChapter) {
    // XP, the chapter's record, the setback counter, and — when this
    // completion decides it — the campaign's fate (progression.ts). All of it
    // rides the same conditional commit below.
    settlement = await settleChapterCompletion(result.state, deps, auth.run.householdId);
    characters.push(...settlement.characters);
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

  /*
   * The live layer — roadmap chapter 7, architecture §6.
   *
   * Here, and not in the engine, for the reason the engine takes an `Rng` and a
   * clock: `applyIntent` is pure and replayable, and a language model is
   * neither. Decorating afterwards keeps the engine's output a function of
   * `(state, intent, seed)` — replay the log and the same authored line comes
   * out, whatever the layer said on the night.
   *
   * It runs before `diff()` so the decorated line rides out on this turn's
   * patch, and it cannot wait: `take()` reads a map that was filled while the
   * party was still reading the previous scene (§6.4). A miss is the authored
   * text, which is what shipped, which is fine.
   */
  const decorated = liveNarration(state, result.state, chapter, deps);
  /*
   * The session recap — the one live call that is allowed to be awaited.
   *
   * Everything else in this layer refuses to wait because somebody is holding a
   * phone mid-tap. Here the chapter is over: the completion screen is the next
   * thing anybody sees, nothing is queued behind this, and a second and a half
   * at the end of half an hour of play is not a pause anybody experiences as
   * one. It is still bounded — see `recapFor`.
   */
  const recap = await recapFor(result.state, chapter, deps, finishedChapter);
  const next: RunState = {
    ...result.state,
    ...(decorated === null ? {} : { narration: decorated }),
    ...(recap === null ? {} : { recap }),
    seq: nextSeq,
    updatedAt: iso(nowMs),
  };
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
  if (!result.presentation && trivial) {
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
    intent: input.intent,
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

  const message = {
    kind: "patch" as const,
    seq: event.seq,
    runId: event.runId,
    patch: event.patch,
    ...(event.presentation ? { presentation: event.presentation } : {}),
    ...(event.progression ? { progression: event.progression } : {}),
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

  /*
   * §6.4's speculative prefetch, fired *after* the broadcast has gone out.
   *
   * The position in this function is the whole trick. Every phone already has
   * the patch; the television is already playing the transition; somebody is
   * already reading the new scene out loud. That gap is the budget, and asking
   * for the next lines before the response was sent would have spent it on the
   * wrong side of the wire.
   *
   * Not awaited, and it never rejects — `warm` swallows its own failures. The
   * turn has already committed and already been published, so nothing this does
   * or fails to do can change the answer below.
   */
  if (deps.narrator && chapter) deps.narrator.warm(nextMoments(next, chapter));

  return { ok: true, seq: nextSeq };
}

/**
 * The live line for this turn, or `null` to keep what the engine wrote.
 *
 * Synchronous, and that is the design rather than a convenience: §6.4's promise
 * is that "the player should never observe a wait", and the only way to keep a
 * promise like that is to remove the ability to break it. `take()` reads a map.
 * There is no path from here to the network.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT REPLACES, AND WHAT IT LEAVES ALONE
 *
 * `enterSceneDraft` builds the narration as the *branch's* line — "the thorns
 * part for you" — followed by the destination scene's own text. Only the second
 * half is replaced. The first half is authored content about this specific
 * transition, and a live layer that quietly ate it would be deleting the
 * author's work to make room for its own.
 */
function liveNarration(
  before: RunState,
  after: RunState,
  chapter: Chapter | null,
  deps: HandlerDeps,
): string | null {
  if (!deps.narrator || !chapter || after.sceneId === null) return null;

  const arrival = arrivalKey(before, after, chapter);
  if (!arrival) return null;

  const scene = chapter.scenes[after.sceneId];
  if (!scene) return null;
  const authored = authoredLine(scene);
  if (authored.trim().length === 0) return null;

  const live = deps.narrator.take(arrival, {
    runId: after.runId,
    chapter,
    sceneId: after.sceneId,
    scene,
    authored,
    via: arrival.choiceId,
    party: partyBrief(after),
    flags: after.flags,
  });
  if (live === null) return null;

  // The branch's own line, recovered by subtraction rather than by threading it
  // through — the engine already joined the two and this is the seam it used.
  const whole = after.narration;
  const transition = whole.endsWith(authored) ? whole.slice(0, whole.length - authored.length).trim() : "";
  return transition.length > 0 ? `${transition}\n\n${live}` : live;
}

/** How long the end-of-chapter recap may take before the game stops caring. */
const RECAP_BUDGET_MS = 4000;

/**
 * The recap for a chapter that just ended, or `null`.
 *
 * Bounded rather than trusted. `recap()` already swallows its own failures, but
 * "returns null on error" and "returns" are different promises: a request that
 * hangs rather than fails would hold the completion of a chapter open behind a
 * socket nobody is watching. The race is what turns the second one into the
 * first.
 *
 * Losing the race is not an error and not retried. The recap was a bonus on top
 * of a completion screen that already has content on it.
 */
async function recapFor(
  state: RunState,
  chapter: Chapter | null,
  deps: HandlerDeps,
  finished: boolean,
): Promise<string | null> {
  if (!finished || !deps.narrator || !chapter) return null;

  const timeout = new Promise<null>((resolve) => {
    const timer = setTimeout(() => { resolve(null); }, RECAP_BUDGET_MS);
    // Node keeps the process alive for a pending timer, which in a test runner
    // means a suite that will not exit until the budget elapses.
    if (typeof timer.unref === "function") timer.unref();
  });

  return Promise.race([
    deps.narrator.recap({
      runId: state.runId,
      chapter,
      party: partyBrief(state),
      flags: state.flags,
      visited: state.visited ?? [],
      outcome: state.chapterOutcome ?? null,
    }),
    timeout,
  ]);
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
 * A player may only act as themselves, and only inside their own household's
 * run (§4.5). In prod the principal comes from the authorizer; in local dev it
 * may be absent, in which case the household membership check still holds.
 */
async function authorize(
  input: ActionInput,
  state: RunState,
  deps: HandlerDeps,
): Promise<{ run: RunRecord } | { error: ActionResponse }> {
  if (input.principal && input.principal.playerId !== input.playerId) {
    return errorResult({
      ok: false,
      seq: state.seq,
      error: { code: "FORBIDDEN", message: "this device cannot act for another player" },
    });
  }

  const run = await deps.repo.getRun(input.runId);
  if (!run) {
    return errorResult({
      ok: false,
      seq: state.seq,
      error: { code: "NOT_FOUND", message: `no run ${input.runId}` },
    });
  }
  if (input.principal && input.principal.householdId !== run.householdId) {
    return errorResult({
      ok: false,
      seq: state.seq,
      error: { code: "FORBIDDEN", message: "this device belongs to a different household" },
    });
  }

  const player = await deps.repo.getPlayer(run.householdId, input.playerId);
  if (!player) {
    return errorResult({
      ok: false,
      seq: state.seq,
      error: { code: "FORBIDDEN", message: `player ${input.playerId} is not in this household` },
    });
  }
  return { run };
}

function errorResult(error: ActionResponse): { error: ActionResponse } {
  return { error };
}
