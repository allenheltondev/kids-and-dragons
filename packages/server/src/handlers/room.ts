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
  const runId = newId("r");
  const campaignId = input.campaignId ?? null;

  const reserved = await reserveCode(runId, input.householdId, input.mode, nowMs, deps);
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
  await deps.repo.putState(state);

  return ok({
    code: reserved.code,
    runId,
    mode: input.mode,
    expiresAt: reserved.expiresAt,
  });
}

async function reserveCode(
  runId: string,
  householdId: string,
  mode: RoomMode,
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

export async function joinRoom(
  input: JoinRoomInput,
  deps: HandlerDeps,
): Promise<HandlerResult<JoinRoomResponse>> {
  const room = await deps.repo.getRoom(input.code);
  // Expired rooms read as absent, so a stale code and an unknown code are the
  // same answer — there is nothing useful to tell a phone about either.
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

  const nowMs = deps.now();
  const next: RunState = {
    ...state,
    seq: state.seq + 1,
    updatedAt: iso(nowMs),
    party: state.party.map((m) => (m.playerId === playerId ? { ...m, connected: true } : m)),
  };
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
