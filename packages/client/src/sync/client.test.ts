/**
 * The request funnel's one safety property: no call outlives its bound.
 *
 * Every screen that sends an intent disables its buttons while the send is in
 * flight and re-enables them when the promise settles. So `request()` settling
 * is not a nicety — it is what stands between one dropped connection and a
 * phone whose every control reads "Sending…" until somebody hard-refreshes it.
 * That brick was found live, twice: as the intermittent e2e walk failure (one
 * hung `/action` through the dev proxy froze a phone mid-choice for the rest
 * of the run), and reproduced deterministically by hanging a single response.
 *
 * `AbortSignal.timeout` lives below the JS timer layer, so these tests cannot
 * fake time; they pass a tiny real `timeoutMs` instead. The default constant
 * is asserted separately so it cannot quietly become "no timeout".
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, REQUEST_TIMEOUT_MS, request } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fetch that never answers but honours its abort signal, like a real socket. */
function hangingFetch(): typeof fetch {
  return ((_: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
      });
    })) as typeof fetch;
}

describe("the request bound", () => {
  it("gives up on a hung request instead of hanging the phone", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    await expect(request("/api/action", { timeoutMs: 30 })).rejects.toThrow(ApiError);
  });

  it("tells the player what to do, not what the network did", async () => {
    // The DOMException's own message is written for a developer. The person
    // holding the phone gets the sentence with the recovery in it.
    vi.stubGlobal("fetch", hangingFetch());
    await expect(request("/api/action", { timeoutMs: 30 })).rejects.toThrow(/tap again/i);
  });

  it("has a real default, so no call can opt out by accident", () => {
    /*
     * The constant is the contract: ten seconds clears a Lambda cold start and
     * stays inside the patience of an eight-year-old. Zero or missing would
     * mean "no bound", which is the brick this file exists to prevent.
     */
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it("still delivers a normal answer inside the bound", async () => {
    vi.stubGlobal("fetch", (() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))) as typeof fetch);
    await expect(request("/api/state", { timeoutMs: 1_000 })).resolves.toEqual({ ok: true });
  });
});
