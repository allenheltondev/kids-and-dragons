// @vitest-environment jsdom
/**
 * The one error surface (ErrorToast.tsx): a close box on a phone, none on the shared screen,
 * where it goes by itself once read (ui/notice-timing.ts).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useGameStore } from "../store";
import { ErrorToast } from "./ErrorToast";
import { noticeMs } from "./notice-timing";

const SAID = "Could not hand over the game.";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  act(() => {
    useGameStore.setState({ error: null });
  });
});

function fail(): void {
  act(() => {
    useGameStore.setState({ error: SAID });
  });
}

describe("error toast", () => {
  it("has a close box on a phone, and goes after six seconds", () => {
    vi.useFakeTimers();
    fail();
    render(<ErrorToast />);
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(5_999);
    });
    expect(screen.getByRole("alert").textContent).toContain(SAID);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("has nothing to tap on the shared screen, and goes once its words are read", () => {
    vi.useFakeTimers();
    fail();
    render(<ErrorToast placement="dock" />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    const ms = noticeMs(SAID);
    act(() => {
      vi.advanceTimersByTime(ms - 1);
    });
    expect(screen.getByRole("alert").classList.contains("kad-toast--dock")).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
