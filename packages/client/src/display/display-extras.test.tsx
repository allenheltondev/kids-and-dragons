// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const reconnect = vi.hoisted(() => vi.fn());
vi.mock("../store", () => ({ useGameStore: { getState: () => ({ reconnect }) } }));

import { DisplayExtras } from "./DisplayExtras";

beforeEach(() => {
  // jsdom has no canvas, and says so noisily; the report treats it as no WebGL.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  reconnect.mockClear();
  window.history.replaceState(null, "", "/");
});

it("keeps quiet until asked, then lists each capability for the owner to record", async () => {
  render(<DisplayExtras />);
  expect(screen.queryByRole("region", { name: "About this screen" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "About this screen" }));
  const panel = await screen.findByRole("region", { name: "About this screen" });
  const rows = await vi.waitFor(() => {
    const found = panel.querySelectorAll("li");
    if (found.length !== 4) throw new Error("still checking");
    return [...found];
  });
  expect(rows.map((row) => row.getAttribute("data-capability"))).toEqual(["webgl", "wakeLock", "audio", "serviceWorker"]);
  // jsdom has none of them, and the report says so rather than throwing.
  expect(rows.every((row) => row.getAttribute("data-ok") === "false")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByRole("button", { name: "About this screen" })).toBeTruthy();
});

it("opens the report straight away on ?perf", async () => {
  window.history.replaceState(null, "", "/?perf");
  render(<DisplayExtras />);
  expect(await screen.findByRole("region", { name: "About this screen" })).toBeTruthy();
});

it("reconnects and catches up when the page comes back on screen", () => {
  render(<DisplayExtras />);
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(reconnect).toHaveBeenCalledTimes(1);
});
