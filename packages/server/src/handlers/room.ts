/**
 * Room lifecycle — architecture §4.5 ("Joining a session").
 *
 * `POST /room` → a 4-letter code. `POST /room/:code/join` → a room-scoped
 * session token and the current state.
 *
 * The rule this file exists to protect: **there is no "who are you?" step.**
 * `joinRoom` takes an already-resolved device principal. It cannot ask for a
 * name, because it is not given a way to accept one. A device scans the code
 * and its character is already on the board.
 */

import type {
  CreateRoomResponse,
  JoinRoomResponse,
  RoomMode,
  RunState,
} from "@kad/shared";
import type { DeviceIdentity } from "../identity.ts";
import type { EventRecord, RoomRecord } from "../store/repository.ts";
import { diff } from "../json-patch.ts";
import { newId } from "../ids.ts";
import { keepGuestHousehold } from "./account.ts";
import { lobbyCampaigns } from "./progression.ts";
import { fail, iso, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";

/**
 * No I, O, 0, or 1 (§4.5). Read aloud across a living room, `I`/`1` and `O`/`0`
 * are the same letter; and the code is read aloud far more often than it is
 * typed. Digits are dropped entirely rather than partially — a mixed alphabet
 * makes "is that a letter or a number?" a question again.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;

/** §3: room items carry a 6-hour TTL so abandoned rooms clean themselves up. */
export const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * 24^4 = 331,776 codes. With a handful of live rooms a collision is vanishingly
 * unlikely, but the conditional write is what makes it *impossible* rather than
 * unlikely — two families cannot be handed the same code by a race.
 */
const MAX_CODE_ATTEMPTS = 12;

export function generateRoomCode(random: () => number): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const index = Math.floor(random() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[index] ?? ROOM_CODE_ALPHABET[0];
  }
  return code;
}

export interface CreateRoomInput {
  householdId: string;
  mode: RoomMode;
  campaignId?: string | null;
  /**
   * The TV opened it (`RoomRecord.claimable`): `householdId` is the TV's
   * placeholder, and the first phone to join decides whose room it is.
   */
  claimable?: boolean;
}

export async function createRoom(
  input: CreateRoomInput,
  deps: HandlerDeps,
): Promise<HandlerResult<CreateRoomResponse>> {
  const household = await deps.repo.getHousehold(input.householdId);
  if (!household) {
    return fail("NOT_FOUND", `no household ${input.householdId}`);
  }
  if (input.mode !== "party" && input.mode !== "travel") {
    return fail("ILLEGAL", `unknown room mode ${String(input.mode)}`);
  }

  const nowMs = deps.now();

  /*
   * A guest's week starts again — and it has to start *before* anything is
   * created under the household, not after. On day eight the household can
   * read as an expired guest here while the sweeper is starting on it; renewing
   * first either wins (the sweep's own condition, `expiresAt <= now`, then
   * fails) or reports the sweep, and then nothing is created: a room returned
   * for a household being deleted would be a lie, and a run written after the
   * sweeper listed the runs would be orphaned.
   */
  if (household.guest) {
    const renewal = await keepGuestHousehold(input.householdId, deps);
    if (renewal === "swept") {
      return fail("NOT_FOUND", `household ${input.householdId} has expired`);
    }
    // The store could not say. Harmless while the household has days left —
    // the sweeper cannot touch it — but past its expiry we cannot rule the
    // sweep out, so ask for a retry rather than guess.
    if (renewal === "error" && household.expiresAt !== undefined && household.expiresAt <= iso(nowMs)) {
      return fail("ILLEGAL", "could not open a room just now; try again");
    }
  }

  const runId = newId("r");
  const campaignId = input.campaignId ?? null;

  const reserved = await reserveCode(
    runId,
    input.householdId,
    input.mode,
    input.claimable === true,
    nowMs,
    deps,
  );
  if (!reserved) {
    return fail("ILLEGAL", "could not allocate a room code; try again");
  }

  await deps.repo.putRun({
    id: runId,
    householdId: input.householdId,
    roomCode: reserved.code,
    campaignId,
    status: "active",
    createdAt: iso(nowMs),
  });

  // The engine owns the initial state's shape; the room owns its identity.
  const state = deps.engine.createRunState({
    runId,
    roomCode: reserved.code,
    mode: input.mode,
    campaignId,
    now: iso(nowMs),
  });
  // Where the household stands in this room's campaign — and in any other it
  // has part-way through — so the lobby can say which chapter is next, and
  // offer the choice, before anybody taps anything.
  await offerCampaigns(state, input.householdId, campaignId, deps);
  await deps.repo.putState(state);

  return ok({
    code: reserved.code,
    runId,
    mode: input.mode,
    expiresAt: reserved.expiresAt,
  });
}

/**
 * Fills in the lobby's campaigns for `householdId` (`RunState.campaignOptions`)
 * and points `campaign` at the first of them — the one a Begin tap plays until
 * somebody votes otherwise. Any votes already cast were cast on a different
 * list, so they go.
 */
async function offerCampaigns(
  state: RunState,
  householdId: string,
  featuredId: string | null,
  deps: HandlerDeps,
): Promise<void> {
  const options = await lobbyCampaigns(householdId, featuredId, deps);
  state.campaignOptions = options;
  state.campaignVotes = {};
  if (options[0]) state.campaign = options[0];
}

async function reserveCode(
  runId: string,
  householdId: string,
  mode: RoomMode,
  claimable: boolean,
  nowMs: number,
  deps: HandlerDeps,
): Promise<RoomRecord | null> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const room: RoomRecord = {
      code: generateRoomCode(deps.random),
      runId,
      householdId,
      mode,
      createdAt: iso(nowMs),
      expiresAt: iso(nowMs + ROOM_TTL_MS),
      ttl: Math.floor((nowMs + ROOM_TTL_MS) / 1000),
      ...(claimable ? { claimable: true } : {}),
    };
    // Conditional create: whoever writes the code first owns it.
    if (await deps.repo.putRoomIfAbsent(room)) return room;
  }
  return null;
}

export interface JoinRoomInput {
  code: string;
  /**
   * Resolved from the device token before the handler runs — in prod by an API
   * Gateway authorizer, in dev by `dev-server.ts`. The handler never sees a raw
   * token and never sees a display name.
   */
  principal: DeviceIdentity;
}

/**
 * Settles a TV-opened room on `householdId` if nobody has yet
 * (`RoomRecord.claimable`), and returns the room as it now stands — which, when
 * another phone got there first, names *their* household rather than this one.
 * A room that was never claimable comes back untouched. Null only when the room
 * has expired in the meantime.
 *
 * When the room changes household, the lobby is re-read for the new one: its
 * campaigns, where it stands in each, and the TV sees that on the next patch.
 */
export async function settleRoom(
  room: RoomRecord,
  householdId: string,
  deps: HandlerDeps,
): Promise<HandlerResult<RoomRecord | null>> {
  if (room.claimable !== true) return ok(room);

  const run = await deps.repo.getRun(room.runId);
  if (!run) return fail("NOT_FOUND", `run ${room.runId} is missing`);

  const moving = householdId !== run.householdId;
  if (moving) {
    // As in `createRoom`, and for its reason: a guest household is renewed
    // before anything lands under it, so a run is never moved into a
    // household the sweeper is part-way through deleting.
    const household = await deps.repo.getHousehold(householdId);
    if (!household) return fail("NOT_FOUND", `no household ${householdId}`);
    if (household.guest && (await keepGuestHousehold(householdId, deps)) === "swept") {
      return fail("NOT_FOUND", `household ${householdId} has expired`);
    }
  }

  if (!(await deps.repo.claimRoom({ code: room.code, run, householdId }))) {
    // Somebody settled it first. Go by what it says now.
    return ok(await deps.repo.getRoom(room.code));
  }

  const { claimable: _claimable, ...rest } = room;
  const settled: RoomRecord = { ...rest, householdId };
  if (moving) {
    // Nobody can act in a room nobody has joined, so this should land first
    // time; the retry is for the reconnect of whoever joins a moment later.
    const options = await lobbyCampaigns(householdId, run.campaignId, deps);
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await deps.repo.getState(room.runId);
      if (!state) break;
      const next: RunState = {
        ...state,
        campaignOptions: options,
        campaignVotes: {},
        ...(options[0] ? { campaign: options[0] } : {}),
      };
      if ((await advanceRoom(state, next, "", deps)).campaignOptions === options) break;
    }
  }
  return ok(settled);
}

export async function joinRoom(
  input: JoinRoomInput,
  deps: HandlerDeps,
): Promise<HandlerResult<JoinRoomResponse>> {
  const found = await deps.repo.getRoom(input.code);
  // Expired rooms read as absent, so a stale code and an unknown code are the
  // same answer — there is nothing useful to tell a phone about either.
  if (!found) return fail("NOT_FOUND", `no open room ${input.code.toUpperCase()}`);

  // The TV opened this room and nobody has joined yet: this phone's household
  // is the one whose evening it is (`RoomRecord.claimable`).
  const settled = await settleRoom(found, input.principal.householdId, deps);
  if (!settled.ok) return settled;
  const room = settled.value;
  if (!room) return fail("NOT_FOUND", `no open room ${input.code.toUpperCase()}`);

  // The device resolves to a household; that household must own this run (§4.5).
  if (room.householdId !== input.principal.householdId) {
    return fail("FORBIDDEN", "this device belongs to a different household");
  }

  const player = await deps.repo.getPlayer(input.principal.householdId, input.principal.playerId);
  if (!player) return fail("NOT_FOUND", `no player ${input.principal.playerId}`);

  const state = await deps.repo.getState(room.runId);
  if (!state) return fail("NOT_FOUND", `run ${room.runId} has no state`);

  const joined = await markConnected(state, input.principal.playerId, deps);

  const sessionToken = await deps.identity.issueSessionToken({
    runId: room.runId,
    roomCode: room.code,
    householdId: room.householdId,
    playerId: player.id,
    role: player.role,
    // A session can never outlive its room.
    expiresAt: Date.parse(room.expiresAt),
  });

  return ok({
    runId: room.runId,
    playerId: player.id,
    mode: room.mode,
    sessionToken,
    state: joined,
  });
}

export interface WatchRoomResult {
  runId: string;
  mode: RoomMode;
  expiresAt: string;
  /** Read-only, room-scoped, expires with the room. */
  viewerToken: string;
  state: RunState;
}

/**
 * How a display client attaches — the TV in Party Mode (spec §2.1).
 *
 * It has no device, no player, and no token, and that is the design: the TV is
 * a screen, and screens do not sign in. But in prod the realtime channel is
 * authorised per subscriber, so it still needs *something* to present, and this
 * is where it gets it: a token naming this room and nothing else.
 *
 * Deliberately not a `joinRoom` variant. A viewer is not a party member — it
 * must not appear in `party`, must not affect presence, and must not satisfy any
 * check that expects a player. Sharing the code path is exactly how it would
 * end up doing one of those by accident.
 */
export async function watchRoom(
  input: { code: string },
  deps: HandlerDeps,
): Promise<HandlerResult<WatchRoomResult>> {
  const room = await deps.repo.getRoom(input.code);
  if (!room) return fail("NOT_FOUND", `no open room ${input.code.toUpperCase()}`);

  const state = await deps.repo.getState(room.runId);
  if (!state) return fail("NOT_FOUND", `run ${room.runId} has no state`);

  const viewerToken = await deps.identity.issueViewerToken({
    runId: room.runId,
    roomCode: room.code,
    expiresAt: Date.parse(room.expiresAt),
  });
  return ok({ runId: room.runId, mode: room.mode, expiresAt: room.expiresAt, viewerToken, state });
}

/**
 * Flips `connected` on this player's party member and broadcasts the patch.
 *
 * A player who has not built a character yet is not in `party` at all, so there
 * is nothing to patch and nothing to say — the join is silent and the client
 * goes on to send CREATE_CHARACTER. When there *is* a member, the rest of the
 * table has to see them come back: this is the reconnect half of "hard-refresh
 * the TV mid-encounter and recover" (§4.3).
 */
async function markConnected(
  state: RunState,
  playerId: string,
  deps: HandlerDeps,
): Promise<RunState> {
  const member = state.party.find((m) => m.playerId === playerId);
  if (!member || member.connected) return state;

  return advanceRoom(
    state,
    {
      ...state,
      party: state.party.map((m) => (m.playerId === playerId ? { ...m, connected: true } : m)),
    },
    playerId,
    deps,
  );
}

/**
 * A change the room makes to its own run, outside any player's intent — a
 * reconnect, or a phone settling the TV's room on its household. One seq, one
 * logged patch, one broadcast, the same as an action.
 */
async function advanceRoom(
  state: RunState,
  changed: RunState,
  playerId: string,
  deps: HandlerDeps,
): Promise<RunState> {
  const nowMs = deps.now();
  const next: RunState = { ...changed, seq: state.seq + 1, updatedAt: iso(nowMs) };
  const patch = diff(state, next);
  const event: EventRecord = {
    seq: next.seq,
    runId: next.runId,
    patch,
    at: iso(nowMs),
    playerId,
  };

  const committed = await deps.repo.commit({
    runId: next.runId,
    expectedSeq: state.seq,
    state: next,
    event,
  });
  // Losing this race is harmless: someone else advanced the run first, so hand
  // the joiner whatever the run says now and let the next action reconcile.
  if (!committed) return (await deps.repo.getState(next.runId)) ?? state;

  await deps.channel.publish(next.roomCode, {
    kind: "patch",
    seq: event.seq,
    runId: event.runId,
    patch: event.patch,
  });
  return next;
}
