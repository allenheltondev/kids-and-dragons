/**
 * More than one screen at a table: a leader and its followers.
 *
 * A family on the sofa and a child in a hospital bed with a parent beside her
 * are one game on two TVs. They are one room, one run and one channel; what
 * they lack is a second *screen*, because only the screen that opened a room
 * may show it (`watchRoom`, #267). Phones already reach the room from
 * anywhere, as visitors (#249).
 *
 * The leader is the room's host: the screen or phone that opened it, which
 * already holds Lock, Remove, Close and the keeper's hand. It taps "Add a
 * screen" and gets a one-time code (`createScreenCode`). A follower TV types
 * it (`redeemScreenCode`) and gets what the leader's own TV got: a viewer
 * token naming this room and nothing else. A follower screen is never a
 * player, never in `party`, never counted for presence, and cannot act, so
 * the table's rules do not change. Its people play from their own phones.
 *
 * The code is the credential, so it is short-lived (ten minutes) and single
 * use, and wrong ones are counted per client like wrong room codes
 * (`code-guard.ts`). Showing the room is the only thing it grants, and the
 * viewer token dies with the room, so Close ends every follower at once.
 */

import type { ScreenCode } from "@kad/shared";
import { admitCodeLookup } from "./code-guard.ts";
import { fail, iso, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { closeIfIdle, hostedRoom, isClosed, type HostPrincipal } from "./host.ts";
import { ROOM_CODE_ALPHABET, type WatchRoomResult } from "./room.ts";

export const SCREEN_CODE_LENGTH = 8;

/** Long enough to carry a code down a ward, short enough that one left on a screen goes dead. */
export const SCREEN_TTL_MS = 10 * 60 * 1000;

export type ScreenDeps = Pick<HandlerDeps, "repo" | "now" | "random" | "channel" | "identity">;

/** The leader asks for a code. Only the room's host may, and only while the room is open. */
export async function createScreenCode(
  input: { code: string; principal: HostPrincipal },
  deps: ScreenDeps,
): Promise<HandlerResult<ScreenCode>> {
  const hosted = await hostedRoom(input.code, input.principal, deps);
  if (!hosted.ok) return hosted;
  const room = hosted.value;
  const state = await deps.repo.getState(room.runId);
  if (!state || isClosed(state) || (await closeIfIdle(room, state, deps))) {
    return fail("NOT_FOUND", `no open room ${input.code.toUpperCase()}`);
  }

  const nowMs = deps.now();
  const expires = nowMs + SCREEN_TTL_MS;
  // A conditional write, so a collision is impossible rather than unlikely.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = screenCode(deps.random);
    const written = await deps.repo.putScreenCodeIfAbsent({
      code,
      roomCode: room.code,
      runId: room.runId,
      createdBy: `device:${input.principal.deviceId}`,
      createdAt: iso(nowMs),
      expiresAt: iso(expires),
      ttl: Math.ceil(expires / 1000),
    });
    if (written) return ok({ code, expiresAt: iso(expires) });
  }
  throw new Error("could not mint a screen code");
}

export type ShownRoom = Omit<WatchRoomResult, "host">;

/**
 * A follower TV spends a code. The code is spent first, by a conditional
 * delete, so of two screens holding one exactly one gets in; if the room has
 * closed since, the code is gone and the leader makes another.
 */
export async function redeemScreenCode(
  input: { code: unknown; client: string },
  deps: ScreenDeps,
): Promise<HandlerResult<ShownRoom> | { slowDown: true }> {
  const code = typeof input.code === "string" ? normalizeScreenCode(input.code) : "";
  if (code.length !== SCREEN_CODE_LENGTH) return fail("ILLEGAL", `A screen code is ${SCREEN_CODE_LENGTH} letters.`);

  const ticket = await admitCodeLookup(`screen:${input.client}`, deps);
  if (!ticket) return { slowDown: true };

  const record = await deps.repo.redeemScreenCode(code, iso(deps.now()));
  if (!record) return fail("NOT_FOUND", "That code didn't work. It may be used up or too old; ask for a new one.");
  // It was a real code, so it was not a guess.
  await ticket.hit();

  const room = await deps.repo.getRoom(record.roomCode);
  const state = room ? await deps.repo.getState(room.runId) : null;
  // The same run, not merely the same letters: a closed room's code is free to be reused.
  if (!room || room.runId !== record.runId || !state || isClosed(state) || (await closeIfIdle(room, state, deps))) {
    return fail("NOT_FOUND", "That game has finished.");
  }
  const viewerToken = await deps.identity.issueViewerToken({
    runId: room.runId,
    roomCode: room.code,
    expiresAt: Date.parse(room.expiresAt),
  });
  return ok({ runId: room.runId, mode: room.mode, expiresAt: room.expiresAt, viewerToken, state });
}

export function isScreenSlowDown(result: Awaited<ReturnType<typeof redeemScreenCode>>): result is { slowDown: true } {
  return "slowDown" in result;
}

function screenCode(random: () => number): string {
  let code = "";
  for (let i = 0; i < SCREEN_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)] ?? "A";
  }
  return code;
}

/** As typed or read off a TV: any case, with the dash it is shown with, or spaces. */
export function normalizeScreenCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "");
}
