/**
 * Who is actually still at the table.
 *
 * Presence is a fact the *transport* observes, not a decision a player makes:
 * an SSE stream opening or closing is the only evidence there is. So it does
 * not go through `applyIntent` — there is no intent to send, and the phone that
 * would send it is the one that just vanished.
 *
 * It still has to be committed and broadcast like anything else, because the
 * engine reads it. A rest or an encounter waits for every member satisfying
 * `ready || !connected`; if a phone that walked out of Wi-Fi is remembered as
 * connected forever, the chapter stops until that exact device comes back —
 * which at a real table means "we can't carry on because Rosie's phone died".
 */

import { isSpectator, settleChapterEndVote, type RunState } from "@kad/shared";
import type { EventRecord } from "../store/repository.ts";
import { diff } from "../json-patch.ts";
import { iso, type HandlerDeps } from "./deps.ts";
import { isOut } from "./remove.ts";
import { ROOM_TTL_MS } from "./room.ts";

/** Presence needs no engine and no dice — just the table and the channel. */
export type PresenceDeps = Pick<HandlerDeps, "repo" | "channel" | "now">;

export interface PresenceInput {
  runId: string;
  playerId: string;
  connected: boolean;
}

/**
 * Returns the new seq when something changed, or `null` when there was nothing
 * to say — an unknown player, an already-correct flag, or a losing race that
 * still would not stick after retries.
 *
 * A lost seq race is retried rather than dropped. Presence changes *cause*
 * traffic — a phone dying mid-turn arrives together with the tap it
 * interrupted — so "best effort, the stream re-announces itself" was weakest at
 * exactly the moment it mattered: a disconnect that lost its race was never
 * recorded, and the ready-gate then waited forever on a phone that was gone.
 * The re-read makes the retry cheap; the cap keeps a hot room from looping.
 */
const COMMIT_ATTEMPTS = 3;

export async function setPresence(
  input: PresenceInput,
  deps: PresenceDeps,
): Promise<number | null> {
  for (let attempt = 1; ; attempt++) {
    const result = await trySetPresence(input, deps);
    if (result !== "lost-race") return result;
    if (attempt >= COMMIT_ATTEMPTS) return null;
  }
}

/** One optimistic attempt: read, diff, conditional commit. */
async function trySetPresence(
  input: PresenceInput,
  deps: PresenceDeps,
): Promise<number | null | "lost-race"> {
  const state = await deps.repo.getState(input.runId);
  if (!state) return null;

  const member = state.party.find((m) => m.playerId === input.playerId);
  if (!member) return trySetWatching(state, input, deps);
  if (member.connected === input.connected) return null;
  // Taken out by the host (#267), or retired (#248): their stream opening
  // again is not them coming back.
  if (input.connected && (await isOut(state, input.playerId, null, deps.repo))) return null;
  // Closed by its host (#263): nothing more is written to it.
  if (state.closed) return null;

  // The phone that drops off can be the last one still reading the chapter's
  // end; everyone left has said they're done, so the table goes back now
  // rather than waiting on a tap nobody is there to make.
  const next: RunState = settleChapterEndVote({
    ...withoutWatcher(state, input.playerId),
    party: state.party.map((m) =>
      m.playerId === input.playerId ? { ...m, connected: input.connected } : m,
    ),
  });
  return commitPresence(state, next, input, deps);
}

/**
 * Presence for a spectator (#388), who is not in `party` and so has no
 * `connected` flag: their id in `RunState.watching`, or not. Only a phone that
 * is a spectator now is added, so a kid still making a hero at a table with
 * room writes nothing, and a lobby filling up costs no extra patches. Leaving
 * always takes the id out, whatever they are now.
 */
async function trySetWatching(
  state: RunState,
  input: PresenceInput,
  deps: PresenceDeps,
): Promise<number | null | "lost-race"> {
  if (state.closed) return null;
  const listed = state.watching?.includes(input.playerId) === true;
  if (input.connected) {
    if (listed || !isSpectator(state, input.playerId)) return null;
    if (await isOut(state, input.playerId, null, deps.repo)) return null;
    return commitPresence(state, { ...state, watching: [...(state.watching ?? []), input.playerId] }, input, deps);
  }
  if (!listed) return null;
  return commitPresence(state, withoutWatcher(state, input.playerId), input, deps);
}

/** The state without `playerId` among the watchers, and without an empty list. */
function withoutWatcher(state: RunState, playerId: string): RunState {
  if (!state.watching?.includes(playerId)) return state;
  const { watching, ...rest } = state;
  const left = watching.filter((id) => id !== playerId);
  return left.length > 0 ? { ...rest, watching: left } : rest;
}

/** Commit a presence change on top of `state` and tell the room. */
async function commitPresence(
  state: RunState,
  changed: RunState,
  input: PresenceInput,
  deps: PresenceDeps,
): Promise<number | "lost-race"> {
  const nowMs = deps.now();
  const nextSeq = state.seq + 1;
  const next: RunState = { ...changed, seq: nextSeq, updatedAt: iso(nowMs) };

  const event: EventRecord = {
    seq: nextSeq,
    runId: input.runId,
    patch: diff(state, next),
    at: iso(nowMs),
    playerId: input.playerId,
  };

  const committed = await deps.repo.commit({
    runId: input.runId,
    expectedSeq: state.seq,
    state: next,
    event,
  });
  if (!committed) return "lost-race";

  await deps.channel.publish(next.roomCode, {
    kind: "patch",
    seq: event.seq,
    runId: event.runId,
    patch: event.patch,
  });

  return nextSeq;
}

// ---------------------------------------------------------------------------
// Heartbeats: presence where no stream says it (#258)
// ---------------------------------------------------------------------------

/*
 * In production a phone listens on AppSync Events, which tells the Lambda
 * nothing when a socket opens or closes, so nothing above ever ran there and a
 * phone that died stayed `connected` until the host removed it. So every
 * seated phone also says "still here" on a timer (`POST /api/presence`), and
 * whichever phone beats next notices a friend who has gone quiet.
 *
 * - **A beat** marks its own player here, if they were away.
 * - **A quiet friend** is one whose last beat is older than `AWAY_AFTER_MS`.
 *   The beat that finds them marks them away: there is no timer on the server
 *   to do it, and none is needed, because a table with nobody beating has
 *   nobody to stall.
 * - **A goodbye** (`leaving`, sent as the page closes) marks its player away
 *   at once, rather than a timeout later.
 *
 * The timeout is long on purpose. A phone set down while its kid watches the
 * TV goes to sleep and stops beating, and the moment it wakes it beats again
 * (the client beats on becoming visible). Marking it away in between costs
 * little, since nothing is skipped automatically (spec §8.5: a friend's turn
 * is passed by a tap), but the screen saying "stepped away" about a kid on
 * the sofa should take a couple of minutes, not seconds.
 *
 * A friend with no beat on record is left alone: their phone has not said
 * anything yet (it is still joining, or predates beats), and the sweep only
 * acts on evidence that a phone *was* here and stopped.
 *
 * The dev server keeps its stream-based presence as well; the two agree, and
 * a beat heals a stream close that misread a refresh, and the other way round.
 */

/** How often a seated phone says it is here. */
export const HEARTBEAT_MS = 20_000;

/** How long a phone may be quiet before it counts as stepped away. */
export const AWAY_AFTER_MS = 120_000;

export interface PresenceBeatInput {
  /** From the room session token, never the body. */
  runId: string;
  playerId: string;
  /** The player's household, from the same token. Absent, the run's is used. */
  householdId?: string;
  /** The page is closing: away now. */
  leaving?: boolean;
  /**
   * `AWAY_AFTER_MS` unless the server says otherwise. Only the dev server
   * does (`KAD_PRESENCE_AWAY_MS`), so an e2e test can wait a phone out.
   */
  awayAfterMs?: number;
}

export type PresenceBeatResult =
  | { ok: true; connected: boolean }
  | { ok: false; status: 403 | 404; code: "FORBIDDEN" | "NOT_FOUND"; message: string };

export async function beatPresence(input: PresenceBeatInput, deps: PresenceDeps): Promise<PresenceBeatResult> {
  const state = await deps.repo.getState(input.runId);
  if (!state) return { ok: false, status: 404, code: "NOT_FOUND", message: `no run ${input.runId}` };
  // Somebody in this room: at the table, or on its roster still making a hero.
  const seated =
    state.party.some((m) => m.playerId === input.playerId) || state.seats?.[input.playerId] !== undefined;
  if (!seated || state.closed || (await isOut(state, input.playerId, input.householdId ?? null, deps.repo))) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "not seated at this table" };
  }

  if (input.leaving) {
    await setPresence({ runId: input.runId, playerId: input.playerId, connected: false }, deps);
    return { ok: true, connected: false };
  }

  const nowMs = deps.now();
  const beats = await deps.repo.touchPresence(
    input.runId,
    input.playerId,
    iso(nowMs),
    Math.floor((nowMs + ROOM_TTL_MS) / 1000),
  );
  const me = state.party.find((m) => m.playerId === input.playerId);
  // A spectator (#388) is here when they beat, as a hero is.
  const watcher = !me && isSpectator(state, input.playerId) && !state.watching?.includes(input.playerId);
  if ((me && !me.connected) || watcher) {
    await setPresence({ runId: input.runId, playerId: input.playerId, connected: true }, deps);
  }
  const quiet = (playerId: string): boolean => {
    const seen = beats[playerId];
    return seen !== undefined && nowMs - Date.parse(seen) > (input.awayAfterMs ?? AWAY_AFTER_MS);
  };
  for (const member of state.party) {
    if (member.playerId === input.playerId || !member.connected || !quiet(member.playerId)) continue;
    await setPresence({ runId: input.runId, playerId: member.playerId, connected: false }, deps);
  }
  // A spectator who has gone quiet stops being counted as watching, the same way.
  for (const playerId of state.watching ?? []) {
    if (playerId === input.playerId || !quiet(playerId)) continue;
    await setPresence({ runId: input.runId, playerId, connected: false }, deps);
  }
  return { ok: true, connected: true };
}
