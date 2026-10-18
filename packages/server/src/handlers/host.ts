/**
 * Host controls: running a room once it has started (#263).
 *
 * The host is the device that opened the room (`RoomRecord.hostDeviceId`):
 * the TV in Party Mode, the host's phone in Travel Mode, or a family tablet
 * (#250). Its controls are the low-stakes, recoverable ones, which is why it
 * is fine for the host to be a TV or a kid's phone:
 *
 *   - take a player out (`removePlayer`, #267)
 *   - lock the room to new joins, and unlock it again
 *   - close the room for everyone
 *
 * Anything that lowers the barrier to joining (opening a room to visitors,
 * #249, `handlers/visitors.ts`) or reaches beyond the room (forgetting a
 * device, #250) needs a signed-in owner instead, and is not here.
 *
 * Every control is one committed change to the run: one seq, one logged
 * patch with the host's player as its author, one broadcast. That is what
 * puts it on the run's event log, and what makes every screen see it at once.
 */

import { idleOpenRoom, type RunState } from "@kad/shared";
import type { DeviceIdentity } from "../identity.ts";
import type { EventRecord, RoomRecord } from "../store/repository.ts";
import { diff } from "../json-patch.ts";
import { fail, iso, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";

/**
 * The device asking and who is holding it: a phone's own device token, or a
 * shared tablet's token plus its seated player's session (`tabletHost`).
 */
export type HostPrincipal = Pick<DeviceIdentity, "deviceId" | "playerId">;

/** Lost seq races retried before giving up, as presence does. */
const COMMIT_ATTEMPTS = 3;

/** The open room `code`, if `principal` is the device that opened it. */
export async function hostedRoom(
  code: string,
  principal: HostPrincipal,
  deps: Pick<HandlerDeps, "repo">,
): Promise<HandlerResult<RoomRecord>> {
  const room = await deps.repo.getRoom(code);
  if (!room) return fail("NOT_FOUND", `no open room ${code.toUpperCase()}`);
  if (!room.hostDeviceId || room.hostDeviceId !== principal.deviceId) {
    return fail("FORBIDDEN", "only the screen or phone that opened this room can do that");
  }
  return ok(room);
}

/**
 * Commits one host change to the room's run. `change` gets the state as it now
 * stands and returns the next one, or `null` when there is nothing to do (the
 * change has already happened), which answers with the current seq. Retried on
 * a lost seq race, since the room may be mid-turn while the host taps.
 *
 * A closed run is terminal: every control sent to it is refused, a no-op
 * included, so a Lock or Remove never reports success on a run that is over.
 * The one exception is Close itself (`closing`), whose no-op on a closed run
 * is what lets a second Close finish deleting a code the first one left
 * behind.
 */
export async function commitRoomChange(
  room: RoomRecord,
  actor: string,
  change: (state: RunState) => RunState | null,
  deps: Pick<HandlerDeps, "repo" | "now" | "channel">,
  options: { closing?: boolean } = {},
): Promise<HandlerResult<{ seq: number; state: RunState; changed: boolean }>> {
  for (let attempt = 1; ; attempt++) {
    const state = await deps.repo.getState(room.runId);
    if (!state) return fail("NOT_FOUND", `run ${room.runId} has no state`);
    if (isClosed(state) && options.closing !== true) {
      return fail("NOT_FOUND", `no open room ${room.code.toUpperCase()}`);
    }
    const changed = change(state);
    if (!changed) return ok({ seq: state.seq, state, changed: false });

    const nowMs = deps.now();
    const next: RunState = { ...changed, seq: state.seq + 1, updatedAt: iso(nowMs) };
    const event: EventRecord = {
      seq: next.seq,
      runId: next.runId,
      patch: diff(state, next),
      at: iso(nowMs),
      playerId: actor,
    };
    if (await deps.repo.commit({ runId: next.runId, expectedSeq: state.seq, state: next, event })) {
      await deps.channel.publish(next.roomCode, {
        kind: "patch",
        seq: event.seq,
        runId: event.runId,
        patch: event.patch,
      });
      return ok({ seq: next.seq, state: next, changed: true });
    }
    if (attempt >= COMMIT_ATTEMPTS) {
      return fail("STALE_SEQ", "the game moved on just then; try again");
    }
  }
}

export interface LockRoomInput {
  code: string;
  principal: HostPrincipal;
  /** True to lock, false to open it to new joins again. */
  locked: boolean;
}

/**
 * Lock or unlock the room to new joins. Locked, `joinRoom` refuses anybody not
 * already on the room's roster (`RunState.seats`); everybody on it can still
 * come back, from any device, so a dropped phone is never locked out of its
 * own game. Unlocking is the undo, which is what makes it the host's to do.
 */
export async function lockRoom(
  input: LockRoomInput,
  deps: HandlerDeps,
): Promise<HandlerResult<{ seq: number }>> {
  const hosted = await hostedRoom(input.code, input.principal, deps);
  if (!hosted.ok) return hosted;
  const result = await commitRoomChange(
    hosted.value,
    input.principal.playerId,
    (state) => {
      if ((state.locked === true) === input.locked) return null;
      if (input.locked) return { ...state, locked: true };
      const { locked: _locked, ...open } = state;
      return open;
    },
    deps,
  );
  return result.ok ? ok({ seq: result.value.seq }) : result;
}

export interface CloseRoomInput {
  code: string;
  principal: HostPrincipal;
}

/**
 * Close the room for everyone. The run is marked closed first, as one logged
 * patch every screen receives, and then the room's code is deleted, so it
 * reads as unknown from then on and is free for another family.
 *
 * The run itself is kept, and everything already earned in it stays earned:
 * characters persist to the household as they are played (§3), so closing
 * costs the table this evening's room and nothing else.
 *
 * In that order on purpose: a server that dies between the two leaves a
 * closed run under a live code, which refuses every join and action, rather
 * than a deleted code over a run that still accepts them. A second tap on
 * Close finishes the job.
 */
export async function closeRoom(
  input: CloseRoomInput,
  deps: HandlerDeps,
): Promise<HandlerResult<{ seq: number }>> {
  const hosted = await hostedRoom(input.code, input.principal, deps);
  if (!hosted.ok) return hosted;
  const result = await commitRoomChange(
    hosted.value,
    input.principal.playerId,
    (state) => (state.closed ? null : { ...state, closed: true }),
    deps,
    { closing: true },
  );
  if (!result.ok) return result;
  await deps.repo.deleteRoom(hosted.value.code);
  return ok({ seq: result.value.seq });
}

/** Closed by its host (`closeRoom`): nothing more is accepted from anybody. */
export function isClosed(state: Pick<RunState, "closed">): boolean {
  return state.closed === true;
}

/**
 * Closes an open room that has sat idle past `OPEN_ROOM_IDLE_MS` (#249), the
 * way the host's Close does, with nobody as its author. True when the room is
 * (now) closed for that reason, and the caller refuses whatever it was asked.
 *
 * Lazy, on purpose: every way into a room (a join, a watch, a state read, an
 * action) passes through here first, so an idle room is closed the moment
 * anybody tries to use it, and a code nobody uses is harmless. A lost race
 * means somebody else just did something in the room, which is activity; the
 * caller then reads the room as open, as it is.
 */
export async function closeIfIdle(
  room: RoomRecord,
  state: RunState,
  deps: Pick<HandlerDeps, "repo" | "now" | "channel">,
): Promise<boolean> {
  if (!idleOpenRoom(state, deps.now())) return false;
  const result = await commitRoomChange(
    room,
    "",
    (current) => (current.closed || !idleOpenRoom(current, deps.now()) ? null : { ...current, closed: true }),
    deps,
    { closing: true },
  );
  if (!result.ok || !isClosed(result.value.state)) return false;
  await deps.repo.deleteRoom(room.code);
  return true;
}

/**
 * `closeIfIdle` for a caller that holds the run rather than the room: a state
 * read or an action. Returns the run as it now stands, closed when it was idle.
 */
export async function closedIfIdle(
  state: RunState,
  deps: Pick<HandlerDeps, "repo" | "now" | "channel">,
): Promise<RunState> {
  if (!idleOpenRoom(state, deps.now())) return state;
  const room = await deps.repo.getRoom(state.roomCode);
  // Codes recycle: only the room that still points at this run is this run's.
  if (!room || room.runId !== state.runId) return state;
  if (!(await closeIfIdle(room, state, deps))) return state;
  return (await deps.repo.getState(state.runId)) ?? state;
}
