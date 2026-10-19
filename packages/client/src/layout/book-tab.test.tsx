// @vitest-environment jsdom
/**
 * The book on the tray, for a kid seated on a family tablet (#299): offered
 * only to a seat that has no device token of its own.
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

  it("is not on a phone that remembers her: her book is on the home screen there", () => {
    localStorage.setItem("kad.device", JSON.stringify({ deviceToken: "dev_1" }));
    useGameStore.setState({ session: SEAT });
    render(<BookTab />);
    expect(screen.queryByRole("button", { name: "Book" })).toBeNull();
  });

  it("is not on a screen with nobody seated", () => {
    render(<BookTab />);
    expect(screen.queryByRole("button", { name: "Book" })).toBeNull();
  });
});
