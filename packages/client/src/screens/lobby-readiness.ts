import { isSpectator, type RunState } from "@kad/shared";

/** Roster seats exist before heroes do. Do not announce an all-ready party
 * while one of those players is still choosing, or wait for spectators. */
export function lobbyReadiness(state: Pick<RunState, "party" | "seats" | "removed">) {
  const removed = new Set(state.removed ?? []);
  const members = state.party.filter(member => !removed.has(member.playerId));
  const connected = members.filter(member => member.connected);
  const making = Object.entries(state.seats ?? {})
    .filter(([id]) => !removed.has(id) && !members.some(member => member.playerId === id) && !isSpectator(state, id))
    .map(([id, seat]) => ({ id, name: seat.name || "A player" }));
  const ready = connected.filter(member => member.ready).length;
  return {
    members,
    making,
    ready,
    total: connected.length + making.length,
    allReady: connected.length > 0 && ready === connected.length && making.length === 0,
  };
}
