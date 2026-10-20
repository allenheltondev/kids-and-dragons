// @vitest-environment jsdom
/**
 * A lazy chunk that fails to load (#329): an optional one is quietly absent
 * and comes back with the signal, a required one says so and Try again
 * imports it again, the failure is reported, and nothing retries on its own.
 * The reload after a deploy is e2e/chunk-fallback.spec.ts: jsdom cannot.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { ChunkBoundary, lazyChunk } from "./ChunkBoundary";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A chunk whose first `fails` imports reject, the way a blocked request does (no URL named). */
function flaky(fails: number) {
  let calls = 0;
  const load = vi.fn(() => {
    calls++;
    return calls <= fails
      ? Promise.reject(new TypeError("Importing a module script failed."))
      : Promise.resolve({ Sound: () => <button type="button">Sound</button> });
  });
  return { load, Chunk: lazyChunk(load, (module) => module.Sound) };
}

describe("a chunk that fails to load", () => {
  it("leaves an optional control out, keeps the rest, and brings it back when the signal does", async () => {
    vi.stubGlobal("reportError", vi.fn());
    const { load, Chunk } = flaky(1);
    render(
      <>
        <ChunkBoundary quiet><Suspense fallback={null}><Chunk /></Suspense></ChunkBoundary>
        <p>The game</p>
      </>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("The game")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // Rendering again is not a retry: only the boundary asks.
    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => { dispatchEvent(new Event("online")); });
    expect(await screen.findByRole("button", { name: "Sound" })).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shows a required screen's message, reports it, and Try again imports it again", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const { load, Chunk } = flaky(1);
    render(<ChunkBoundary message="The guide couldn’t open."><Suspense fallback={null}><Chunk /></Suspense></ChunkBoundary>);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The guide couldn’t open.");
    expect(reportError).toHaveBeenCalledWith(expect.any(TypeError));

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    expect(await screen.findByRole("button", { name: "Sound" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  /** An error naming a real module that is not the screen: one it imports, now loadable, with no `Sound`. */
  const dependency = `${import.meta.dirname}/Button.tsx`;
  const dependencyFailed = () => new TypeError(`Failed to fetch dynamically imported module: ${dependency}`);
  const pickSound = (module: { Sound?: () => React.JSX.Element }) => module.Sound!;

  it("asks for the screen's own module when the address an error names exports something else", async () => {
    vi.stubGlobal("reportError", vi.fn());
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 200 })));
    let calls = 0;
    const load = vi.fn(() => (++calls === 1
      ? Promise.reject(dependencyFailed())
      : Promise.resolve({ Sound: () => <button type="button">Sound</button> })));
    const Chunk = lazyChunk(load, pickSound);
    render(<ChunkBoundary><Suspense fallback={null}><Chunk /></Suspense></ChunkBoundary>);
    await screen.findByRole("alert");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    expect(await screen.findByRole("button", { name: "Sound" })).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reloads once when the screen's own import stays failed after the chunk it imports is back", async () => {
    vi.stubGlobal("reportError", vi.fn());
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 200 })));
    const reload = vi.fn();
    vi.stubGlobal("location", { ...location, reload });
    sessionStorage.clear();
    // What a browser that caches the failure does: the screen's import never succeeds again in this page.
    const load = vi.fn(() => Promise.reject(dependencyFailed()));
    const Chunk = lazyChunk(load, pickSound);
    render(<ChunkBoundary><Suspense fallback={null}><Chunk /></Suspense></ChunkBoundary>);
    await screen.findByRole("alert");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    await vi.waitFor(() => { expect(reload).toHaveBeenCalledOnce(); });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("says so again, without a second reload, if that reload did not help", async () => {
    vi.stubGlobal("reportError", vi.fn());
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 200 })));
    const reload = vi.fn();
    vi.stubGlobal("location", { ...location, reload });
    sessionStorage.clear();
    sessionStorage.setItem(`kad-chunk-reload:${dependency}`, "1");
    const load = vi.fn(() => Promise.reject(dependencyFailed()));
    const Chunk = lazyChunk(load, pickSound);
    render(<ChunkBoundary><Suspense fallback={null}><Chunk /></Suspense></ChunkBoundary>);
    await screen.findByRole("alert");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps the message, and one import per press, while the chunk stays unreachable", async () => {
    vi.stubGlobal("reportError", vi.fn());
    // Named, and reachable as far as the probe can tell: not a deploy, so no reload.
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    const load = vi.fn(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module: /bundle/guide-x.css")));
    const Chunk = lazyChunk(load, () => () => null);
    render(<ChunkBoundary><Suspense fallback={null}><Chunk /></Suspense></ChunkBoundary>);
    await screen.findByRole("alert");
    for (const presses of [2, 3]) {
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
      await screen.findByRole("alert");
      expect(load).toHaveBeenCalledTimes(presses);
    }
  });
});
