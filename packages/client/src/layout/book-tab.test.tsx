// @vitest-environment jsdom
/**
 * The book on the tray, for any kid seated at the game (#299; docs/camp.md
 * §7): on a family tablet that is nobody's and on her own phone alike, never
 * on a screen with nobody seated.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { currentRoute, navigate } from "../router";
import { useGameStore } from "../store";
import { BookTab } from "./BookTab";

const SEAT = { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "travel" as const, sessionToken: "seat_1" };

afterEach(() => {
  cleanup();
  localStorage.clear();
  useGameStore.setState({ session: null });
  navigate({ name: "home" });
});

describe("BookTab", () => {
  it("opens the book for a kid seated on a tablet that is nobody's", async () => {
    useGameStore.setState({ session: SEAT });
    render(<BookTab />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Book" }));
    expect(currentRoute()).toEqual({ name: "journal" });
  });

  it("is on her own phone too, where the game would otherwise never show her the book", async () => {
    localStorage.setItem("kad.device", JSON.stringify({ deviceToken: "dev_1" }));
    useGameStore.setState({ session: SEAT });
    render(<BookTab />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Book" }));
    expect(currentRoute()).toEqual({ name: "journal" });
  });

  it("is not on a screen with nobody seated", () => {
    render(<BookTab />);
    expect(screen.queryByRole("button", { name: "Book" })).toBeNull();
  });
});
