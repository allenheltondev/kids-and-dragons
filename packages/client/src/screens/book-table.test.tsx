// @vitest-environment jsdom
/**
 * The book while its kid is seated at a live game (book-table.tsx; docs/camp.md
 * §7): which heroes are the table's, whether it is in downtime, and the way
 * back to its Camp panel.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { RunState } from "@kad/shared";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { currentRoute, navigate } from "../router";
import { BookTableNote, handOffToCamp, useBookTable } from "./book-table";
import { campPanelOpen, closeCampPanel, takeCampFocus } from "./camp-panel";

const SEAT = { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "party" as const, sessionToken: "t" };
const mine = makeMember({ playerId: "p_1", character: makeCharacter({ id: "c_1", ownerPlayerId: "p_1", name: "Pip" }) });
const theirs = makeMember({ playerId: "p_2", character: makeCharacter({ id: "c_2", ownerPlayerId: "p_2", name: "Wren" }) });

function seat(over: Partial<RunState> = {}): void {
  useGameStore.setState({ session: SEAT, state: makeState({ roomCode: "ABCD", party: [mine, theirs], ...over }) });
}

afterEach(() => {
  cleanup();
  act(() => closeCampPanel());
  takeCampFocus();
  useGameStore.setState({ session: null, state: null });
  navigate({ name: "home" });
});

describe("useBookTable", () => {
  it("is nothing with no game, or for a hero not hers at this table", () => {
    expect(renderHook(() => useBookTable("c_1")).result.current).toBeNull();
    seat();
    expect(renderHook(() => useBookTable("c_2")).result.current).toBeNull();
    expect(renderHook(() => useBookTable("c_9")).result.current).toBeNull();
    expect(renderHook(() => useBookTable(null)).result.current).toBeNull();
  });

  it("is nothing once she has been taken off the table", () => {
    seat({ removed: ["p_1"] });
    expect(renderHook(() => useBookTable("c_1")).result.current).toBeNull();
  });

  it("is downtime in the lobby, at a rest and at the chapter's end, and play in a scene", () => {
    seat({ phase: "lobby" });
    expect(renderHook(() => useBookTable("c_1")).result.current).toEqual({ code: "ABCD", downtime: true });
    seat({ phase: "scene", sceneType: "rest" });
    expect(renderHook(() => useBookTable("c_1")).result.current).toEqual({ code: "ABCD", downtime: true });
    seat({ phase: "chapter_complete" });
    expect(renderHook(() => useBookTable("c_1")).result.current).toEqual({ code: "ABCD", downtime: true });
    seat({ phase: "scene", sceneType: "story" });
    expect(renderHook(() => useBookTable("c_1")).result.current).toEqual({ code: "ABCD", downtime: false });
  });

  it("follows the game as it moves on, while the book is open", () => {
    seat({ phase: "scene", sceneType: "story" });
    const { result } = renderHook(() => useBookTable("c_1"));
    expect(result.current?.downtime).toBe(false);
    act(() => seat({ phase: "scene", sceneType: "rest" }));
    expect(result.current?.downtime).toBe(true);
  });
});

describe("handing off to the game's Camp", () => {
  it("goes back to the game with Camp open at that hero's part", () => {
    handOffToCamp({ code: "ABCD", downtime: true }, { hero: "c_1", part: "decor" });
    expect(currentRoute()).toEqual({ name: "player", code: "ABCD" });
    expect(campPanelOpen()).toBe(true);
    expect(takeCampFocus()).toEqual({ hero: "c_1", part: "decor" });
  });

  it("says the way in downtime, and that a pick waits for the rest in a scene", () => {
    const { unmount } = render(<BookTableNote table={{ code: "ABCD", downtime: false }} focus={{ hero: "c_1", part: "look" }} />);
    expect(screen.getByTestId("book-table-note").textContent).toContain("next rest");
    expect(screen.queryByRole("button", { name: "Change it at camp" })).toBeNull();
    unmount();
    render(<BookTableNote table={{ code: "ABCD", downtime: true }} focus={{ hero: "c_1", part: "look" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Change it at camp" }));
    expect(currentRoute()).toEqual({ name: "player", code: "ABCD" });
    expect(takeCampFocus()).toEqual({ hero: "c_1", part: "look" });
  });
});
