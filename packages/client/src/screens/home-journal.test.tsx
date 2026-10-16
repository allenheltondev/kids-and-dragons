// @vitest-environment jsdom
/**
 * HomeScreen's way into the journal — offered to a phone that has a book to
 * open, and to nothing else: not a phone that has never played, not a TV that
 * only hosted, and the moment signing in binds a new phone, not a refresh later.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useKeepsakeStore } from "../store/keepsake";
import { DEVICE_IDENTITY_KEY } from "../store/persistence";
import { HomeScreen } from "./HomeScreen";

const BOOK = /open your book/i;

function bind(extra: Record<string, unknown> = {}): void {
  localStorage.setItem(
    DEVICE_IDENTITY_KEY,
    JSON.stringify({ householdId: "hh_1", playerId: "p_1", displayName: "Ada", deviceToken: "dev_1", ...extra }),
  );
}

beforeEach(() => {
  localStorage.clear();
  // No user pool to ask about in a unit test.
  useKeepsakeStore.setState({ check: async () => undefined, step: "closed", account: null });
});

afterEach(() => {
  cleanup();
});

describe("HomeScreen's adventure book", () => {
  it("is offered to a phone that has played", () => {
    bind();
    render(<HomeScreen />);
    expect(screen.getByRole("button", { name: BOOK })).toBeTruthy();
  });

  it("is not offered to a phone that has never played", () => {
    render(<HomeScreen />);
    expect(screen.queryByRole("button", { name: BOOK })).toBeNull();
  });

  it("is not offered to a TV that only hosted", () => {
    bind({ screenOnly: true });
    render(<HomeScreen />);
    expect(screen.queryByRole("button", { name: BOOK })).toBeNull();
  });

  it("appears as soon as signing in binds this phone, without a reload", () => {
    render(<HomeScreen />);
    expect(screen.queryByRole("button", { name: BOOK })).toBeNull();

    // The keepsake flow writes the binding, then moves on a step.
    act(() => {
      bind();
      useKeepsakeStore.setState({ step: "kept" });
    });
    expect(screen.getByRole("button", { name: BOOK })).toBeTruthy();
  });
});
