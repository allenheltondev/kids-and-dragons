/**
 * The kill switch — architecture §6.6.
 *
 * Small enough to look not worth testing, which is exactly why it is: the
 * failure mode is a live layer running somewhere nobody meant it to, and the
 * evidence for that arrives as a bill and as unreviewed text on a television.
 */

import { describe, expect, it } from "vitest";
import { assertCacheHits, liveEnabled, liveRegion } from "./enabled.ts";

describe("whether the layer runs", () => {
  it("is off when nothing is set", () => {
    // The default, and the one the whole game is built to work under.
    expect(liveEnabled({})).toBe(false);
  });

  it("is on for exactly the string true", () => {
    expect(liveEnabled({ LIVE_LLM_ENABLED: "true" })).toBe(true);
  });

  it("is off for the string false", () => {
    /*
     * The bug this exists to prevent, and it is a *classic*: `"false"` is a
     * non-empty string, so every `if (process.env.X)` ever written turns
     * `LIVE_LLM_ENABLED=false` into on. Somebody typing the documented way to
     * turn the layer off must not turn it on.
     */
    expect(liveEnabled({ LIVE_LLM_ENABLED: "false" })).toBe(false);
  });

  it("is off for anything else at all", () => {
    // §6.6 phrases this as a switch you turn *off*, implying a default of on.
    // It is read the other way round because the two mistakes do not cost the
    // same: a layer wrongly off is a plainer evening, a layer wrongly on is
    // unreviewed text in a child's living room.
    for (const value of ["1", "yes", "TRUE", "on", "", " true"]) {
      expect(liveEnabled({ LIVE_LLM_ENABLED: value }), value).toBe(false);
    }
  });
});

describe("which region", () => {
  it("prefers an explicit override", () => {
    // So the live layer can be pointed at a region where the model is enabled
    // without moving the whole stack.
    expect(liveRegion({ LIVE_LLM_REGION: "us-west-2", AWS_REGION: "eu-west-1" })).toBe("us-west-2");
  });

  it("falls back to the region the rest of the stack runs in", () => {
    expect(liveRegion({ AWS_REGION: "eu-west-1" })).toBe("eu-west-1");
    expect(liveRegion({ AWS_DEFAULT_REGION: "eu-west-1" })).toBe("eu-west-1");
  });

  it("says so rather than guessing", () => {
    /*
     * Null rather than a default like `us-east-1`. A guessed region is a
     * plausible-looking configuration that fails per call, silently, inside a
     * fire-and-forget prefetch — the hardest possible place to notice it.
     */
    expect(liveRegion({})).toBeNull();
  });
});

describe("the dev-mode cache assertion", () => {
  it("is on everywhere except production", () => {
    // §6.3 wants it loud "in development". A table mid-session is not the place
    // to learn about a billing regression.
    expect(assertCacheHits({})).toBe(true);
    expect(assertCacheHits({ NODE_ENV: "test" })).toBe(true);
    expect(assertCacheHits({ NODE_ENV: "production" })).toBe(false);
  });
});
