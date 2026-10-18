/**
 * Opening a room to visitors (#249): phones from other households at one
 * table, each playing its own hero.
 *
 * One room-level switch, not an approval per visitor, and only a signed-in
 * owner of the room's household may turn it on. It lowers the barrier to
 * joining, so it is not a host control (`host.ts`): a TV or a kid's phone that
 * opened the room cannot do it alone.
 *
 * Opening gives the room a longer code (`RunState.visitorCode`): its own four
 * letters and two more. The short code still works for the room's own
 * household, exactly as before, and a phone from anywhere else needs the long
 * one. Nothing else about the room changes, so it is still one `ROOM#` row,
 * one channel and one run, and every phone already in it keeps its session.
 *
 * Turning it off takes the long code away: no new visitor can join. Visitors
 * already on the roster stay in the game, and can come back to it, as anybody
 * on a locked room's roster can; the host removes one who should go.
 */

import type { SetVisitorsResponse } from "@kad/shared";
import { VISITOR_CODE_EXTRA } from "@kad/shared";
import { fail, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { closeIfIdle, commitRoomChange } from "./host.ts";
import { ownedHousehold, type Organizer } from "./organizer.ts";
import { ROOM_CODE_ALPHABET } from "./room.ts";

export interface SetVisitorsInput extends Organizer {
  code: string;
  open: unknown;
}

export async function setVisitors(
  input: SetVisitorsInput,
  deps: HandlerDeps,
): Promise<HandlerResult<SetVisitorsResponse>> {
  if (typeof input.open !== "boolean") return fail("ILLEGAL", "expected { open: true | false }");
  const room = await deps.repo.getRoom(input.code);
  if (!room) return fail("NOT_FOUND", `no open room ${input.code.toUpperCase()}`);
  // A TV's room belongs to nobody until a phone settles it (§4.5).
  if (room.claimable === true) return fail("ILLEGAL", "Somebody has to join the room before it can be opened.");
  const owned = await ownedHousehold(input, room.householdId, deps);
  if (!owned.ok) return owned.error.code === "FORBIDDEN" ? fail("FORBIDDEN", "Only a grown-up who runs this game can open it to visitors.") : owned;
  // An open room already past its idle window is over (`closeIfIdle`): the
  // switch must not stamp it fresh and bring it back.
  const before = await deps.repo.getState(room.runId);
  if (before && (await closeIfIdle(room, before, deps))) {
    return fail("NOT_FOUND", `no open room ${input.code.toUpperCase()}`);
  }

  const visitorCode = input.open ? room.code + extraLetters(deps.random) : null;
  const result = await commitRoomChange(
    room,
    "",
    (state) => {
      if (input.open) return state.visitorCode !== undefined ? null : { ...state, visitorCode: visitorCode! };
      if (state.visitorCode === undefined) return null;
      const { visitorCode: _gone, ...closed } = state;
      return closed;
    },
    deps,
  );
  if (!result.ok) return result;
  const code = result.value.state.visitorCode;
  return ok({ ok: true, seq: result.value.seq, ...(code !== undefined ? { visitorCode: code } : {}) });
}

function extraLetters(random: () => number): string {
  let out = "";
  for (let i = 0; i < VISITOR_CODE_EXTRA; i++) {
    out += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)] ?? ROOM_CODE_ALPHABET[0];
  }
  return out;
}
