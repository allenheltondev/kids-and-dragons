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
import type { EventRecord, RunRecord } from "../store/repository.ts";
import { diff } from "../json-patch.ts";
import { iso, type HandlerDeps } from "./deps.ts";
import { foldChapterXp, newCharacterWrite } from "./progression.ts";

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
  const result = deps.engine.applyIntent(
    state,
    // The engine re-checks seq itself; passing it keeps that guard armed even
    // if this handler is ever bypassed.
    { playerId: input.playerId, intent: input.intent, seq: input.seq },
    {
      rules: deps.content.rules(),
      items: deps.content.items(),
      chapter,
      // Characters belong to the household, not the run (architecture §3), so
      // CREATE_CHARACTER needs to know which household it is building into.
      householdId: auth.run.householdId,
      // Seeded per event, never per wall clock — see the header.
      rng: deps.rng(`${input.runId}:${nextSeq}`),
      now: iso(nowMs),
    },
  );

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
  if (result.created) {
    characters.push(...(await newCharacterWrite(result.created, deps, auth.run.householdId)));
  }
  if (result.presentation?.kind === "CHAPTER_COMPLETE") {
    characters.push(...(await foldChapterXp(result.state, deps, auth.run.householdId)));
  }

  // A no-op intent (a re-tap, a READY that was already true) writes nothing.
  // Burning a seq on it would churn every client's mirror for no reason. The
  // engine stamps seq and updatedAt on every accepted intent, so "did anything
  // happen?" has to be asked of the domain fields alone.
  if (!result.presentation && sameDomainState(state, result.state)) {
    return { ok: true, seq: state.seq };
  }

  // --- 3. stamp, persist, broadcast ---------------------------------------
  // Normalising seq here is what makes the sequence gapless by construction:
  // every published patch takes a client from seq-1 to seq, whatever the engine
  // did internally.
  const next: RunState = { ...result.state, seq: nextSeq, updatedAt: iso(nowMs) };
  const patch = diff(state, next);

  const event: EventRecord = {
    seq: nextSeq,
    runId: input.runId,
    patch,
    ...(result.presentation ? { presentation: result.presentation } : {}),
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

  await deps.channel.publish(next.roomCode, {
    kind: "patch",
    seq: event.seq,
    runId: event.runId,
    patch: event.patch,
    ...(event.presentation ? { presentation: event.presentation } : {}),
  });

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

/** Equal ignoring the two fields the transport owns. */
function sameDomainState(a: RunState, b: RunState): boolean {
  const strip = (s: RunState): RunState => ({ ...s, seq: 0, updatedAt: "" });
  return diff(strip(a), strip(b)).length === 0;
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
