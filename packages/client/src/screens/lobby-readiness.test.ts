import { describe, expect, it } from "vitest";
import { makeMember, makeState } from "../testing/fixtures";
import { lobbyReadiness } from "./lobby-readiness";

const seat = { name: "Sam", color: "#abc", device: "phone" as const };

describe("the lobby's next step", () => {
  it("waits for a roster player making a hero even when seated heroes are ready", () => {
    const result = lobbyReadiness(makeState({ party: [makeMember({ ready: true })], seats: { p_new: seat } }));
    expect(result.making).toEqual([{ id: "p_new", name: "Sam" }]);
    expect(result.total).toBe(2);
    expect(result.ready).toBe(1);
    expect(result.allReady).toBe(false);
  });

  it("waits for a connected hero to tap ready", () => {
    expect(lobbyReadiness(makeState({ party: [makeMember({ ready: false })] })).allReady).toBe(false);
  });

  it("does not wait for away heroes, removed players, or people choosing to watch", () => {
    const result = lobbyReadiness(makeState({
      party: [makeMember({ playerId: "p_ready", ready: true }), makeMember({ playerId: "p_away", connected: false })],
      seats: { p_watch: { ...seat, watching: true }, p_removed: seat }, removed: ["p_removed"],
    }));
    expect(result.making).toEqual([]);
    expect(result.total).toBe(1);
    expect(result.allReady).toBe(true);
  });

  it("does not count spectators at a full table or removed heroes", () => {
    const result = lobbyReadiness(makeState({
      party: [0, 1, 2, 3].map(i => makeMember({ playerId: `p_${i}`, ready: true })),
      seats: { p_watch: seat },
    }));
    expect(result.making).toEqual([]);
    expect(result.allReady).toBe(true);
    const removed = lobbyReadiness(makeState({ party: [makeMember({ ready: true })], removed: ["p_1"] }));
    expect(removed.members).toEqual([]);
    expect(removed.allReady).toBe(false);
  });

  it("never starts an empty room or one where every phone is away", () => {
    expect(lobbyReadiness(makeState({ party: [] })).allReady).toBe(false);
    expect(lobbyReadiness(makeState({ party: [makeMember({ ready: true, connected: false })] })).allReady).toBe(false);
  });
});
