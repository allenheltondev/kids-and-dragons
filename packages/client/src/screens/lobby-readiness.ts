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

/** What the shared screen's party heading says once everyone is ready: where to start, never how
 * many (the heading's count said that a moment ago). Short, since it stands in the heading's pill
 * at the TV's largest text. */
export function readyLine(saved: boolean): string {
  return saved ? "Everyone is ready! Keep going on a phone." : "Everyone is ready! Start on a phone.";
}
