// @vitest-environment jsdom
/**
 * The room's cheers on the shared screen (#388): how many are watching, never
 * who, and each cheer floating up and let go on a timer.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MAX_PARTY, type PartyMember, type RunState } from "@kad/shared";
import { useGameStore } from "../store";
import { makeState } from "../testing/fixtures";
import { CHEER_FLOAT_MS, RoomCheers } from "./RoomCheers";

const hero = (i: number): PartyMember =>
  ({ playerId: `p_${i}`, character: { id: `c_${i}`, name: `Hero ${i}` }, hp: 10, down: false, connected: true, ready: false }) as never;

function fullTable(extra: Partial<RunState> = {}): RunState {
  const seat = { name: "Kid", color: "#7FD4C1", device: "phone" as const };
  return makeState({
    phase: "scene",
    party: Array.from({ length: MAX_PARTY }, (_, i) => hero(i + 1)),
    seats: { p_5: { ...seat, name: "Posy" }, p_6: { ...seat, name: "Wren" } },
    ...extra,
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useGameStore.setState({ cheers: [] });
});

describe("RoomCheers", () => {
  it("draws nothing while nobody is watching", () => {
    useGameStore.setState({ state: fullTable(), cheers: [] });
    render(<RoomCheers />);
    expect(screen.queryByTestId("room-cheers")).toBeNull();
  });

  it("says how many are watching, and never their names", () => {
    useGameStore.setState({ state: fullTable({ watching: ["p_5", "p_6"] }), cheers: [] });
    render(<RoomCheers />);
    const badge = screen.getByTestId("watching");
    expect(badge.getAttribute("aria-label")).toBe("Watching: 2");
    expect(screen.getByTestId("room-cheers").textContent).not.toMatch(/Posy|Wren/);
  });

  it("does not count a watcher who has since sat down", () => {
    const state = fullTable({ watching: ["p_5"] });
    useGameStore.setState({ state: { ...state, party: [...state.party.slice(0, MAX_PARTY - 1), hero(5)] }, cheers: [] });
    render(<RoomCheers />);
    expect(screen.queryByTestId("watching")).toBeNull();
  });

  it("floats each cheer and lets it go", () => {
    vi.useFakeTimers();
    useGameStore.setState({ state: fullTable({ watching: ["p_5"] }), cheers: [{ key: 1, cheer: "star" }, { key: 2, cheer: "heart" }] });
    render(<RoomCheers />);
    expect(screen.getAllByTestId("cheer")).toHaveLength(2);
    act(() => vi.advanceTimersByTime(CHEER_FLOAT_MS));
    expect(screen.queryAllByTestId("cheer")).toHaveLength(0);
    expect(useGameStore.getState().cheers).toEqual([]);
  });
});
