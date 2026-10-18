// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { A11Y_KEY, applyPrefs, loadPrefs, reducedMotion, startA11y, DEFAULT_PREFS } from "./prefs";
import { A11yControl } from "./A11yControl";
import { useA11y } from "./store";

const root = document.documentElement;
const attributes = ["data-text", "data-contrast", "data-motion", "data-hand"];

/** matchMedia as a device that asks for the listed features. */
function device(asks: string[]): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: asks.some((feature) => query.includes(feature)),
    addEventListener: () => undefined,
  }));
}

beforeEach(() => {
  localStorage.clear();
  device([]);
  useA11y.setState({ prefs: DEFAULT_PREFS, open: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const name of attributes) root.removeAttribute(name);
});

describe("prefs", () => {
  it("starts with nothing set", () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    startA11y();
    for (const name of attributes) expect(root.hasAttribute(name)).toBe(false);
  });

  it("puts each saved setting on the root", () => {
    localStorage.setItem(A11Y_KEY, JSON.stringify({ text: "largest", contrast: true, motion: true, hand: "left" }));
    startA11y();
    expect(root.getAttribute("data-text")).toBe("largest");
    expect(root.getAttribute("data-contrast")).toBe("high");
    expect(root.getAttribute("data-motion")).toBe("reduced");
    expect(root.getAttribute("data-hand")).toBe("left");
  });

  it("ignores anything hand-edited that is not a setting", () => {
    localStorage.setItem(A11Y_KEY, JSON.stringify({ text: "huge", contrast: "yes", hand: "both" }));
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    localStorage.setItem(A11Y_KEY, "not json");
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("follows the device's preferences when nothing is saved, and never turns them off", () => {
    device(["prefers-contrast", "prefers-reduced-motion"]);
    startA11y();
    expect(root.getAttribute("data-contrast")).toBe("high");
    expect(root.getAttribute("data-motion")).toBe("reduced");
    expect(root.hasAttribute("data-text")).toBe(false);
    expect(reducedMotion()).toBe(true);
  });

  it("reports reduced motion from the setting alone", () => {
    expect(reducedMotion()).toBe(false);
    applyPrefs({ ...DEFAULT_PREFS, motion: true });
    expect(reducedMotion()).toBe(true);
  });
});

describe("the settings sheet", () => {
  it("changes a setting, applies it and remembers it", async () => {
    const user = userEvent.setup();
    render(<A11yControl />);
    await user.click(screen.getByRole("button", { name: "Display settings" }));
    const sheet = screen.getByRole("dialog", { name: "Display settings" });
    expect(sheet).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Largest" }));
    await user.click(screen.getByRole("button", { name: "Left hand" }));
    await user.click(screen.getByRole("button", { name: "High contrast" }));
    expect(root.getAttribute("data-text")).toBe("largest");
    expect(root.getAttribute("data-hand")).toBe("left");
    expect(root.getAttribute("data-contrast")).toBe("high");
    expect(JSON.parse(localStorage.getItem(A11Y_KEY) ?? "{}")).toMatchObject({ text: "largest", hand: "left", contrast: true });

    await user.click(screen.getByRole("button", { name: "Normal" }));
    expect(root.hasAttribute("data-text")).toBe(false);
  });

  it("closes on Escape and on Done, and gives focus back", async () => {
    const user = userEvent.setup();
    render(<A11yControl />);
    const opener = screen.getByRole("button", { name: "Display settings" });
    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);

    await user.click(opener);
    await act(async () => { await user.click(screen.getByRole("button", { name: "Done" })); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when the device already asks for what a setting does", async () => {
    device(["prefers-reduced-motion"]);
    const user = userEvent.setup();
    render(<A11yControl />);
    await user.click(screen.getByRole("button", { name: "Display settings" }));
    expect(screen.getByText(/already asks for less movement/i)).toBeTruthy();
  });
});
