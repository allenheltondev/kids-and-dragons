// @vitest-environment jsdom
/**
 * The book on the tray (#299; docs/camp.md §7): on her own phone while her
 * kit and look can change (the lobby, a rest, the chapter's end), on a family
 * tablet that is nobody's always, and never on a screen with nobody seated.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentRoute, navigate } from "../router";
import { useGameStore } from "../store";
import { makeState } from "../testing/fixtures";
import { BookTab } from "./BookTab";

const SEAT = { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "travel" as const, sessionToken: "seat_1" };

afterEach(() => {
  cleanup();
  localStorage.clear();
  useGameStore.setState({ session: null, state: null });
  navigate({ name: "home" });
});

describe("BookTab", () => {
  it("opens the book for a kid seated on a tablet that is nobody's, mid-scene too: it is her only way there", async () => {
    useGameStore.setState({ session: SEAT, state: makeState({ phase: "scene", sceneType: "story" }) });
    render(<BookTab />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Book" }));
    expect(currentRoute()).toEqual({ name: "journal" });
  });

  it.each([
    ["the lobby", { phase: "lobby" }],
    ["a rest", { phase: "scene", sceneType: "rest" }],
    ["the chapter's end", { phase: "chapter_complete" }],
  ] as const)("is on her own phone in %s, while her kit and look can change", async (_, over) => {
    localStorage.setItem("kad.device", JSON.stringify({ deviceToken: "dev_1" }));
    useGameStore.setState({ session: SEAT, state: makeState(over) });
    render(<BookTab />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Book" }));
    expect(currentRoute()).toEqual({ name: "journal" });
  });

  it("is not on her own phone in a scene, a check or a fight, when nothing of hers changes", () => {
    localStorage.setItem("kad.device", JSON.stringify({ deviceToken: "dev_1" }));
    useGameStore.setState({ session: SEAT, state: makeState({ phase: "scene", sceneType: "story" }) });
    const { rerender } = render(<BookTab />);
    expect(screen.queryByRole("button", { name: "Book" })).toBeNull();
    useGameStore.setState({ state: makeState({ phase: "scene", sceneType: "encounter" }) });
    rerender(<BookTab />);
    expect(screen.queryByRole("button", { name: "Book" })).toBeNull();
  });

  it("is not on a screen with nobody seated", () => {
    render(<BookTab />);
    expect(screen.queryByRole("button", { name: "Book" })).toBeNull();
  });
});
