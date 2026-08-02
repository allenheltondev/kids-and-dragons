/**
 * The deferred-load race, as a test.
 *
 * Found in review on #31: a rig takes a moment to arrive, colours can change
 * while it does, and both surfaces recorded the change as *applied* at the
 * moment it was requested — against a handle that was still null. The figure
 * then installed wearing the palette captured when the load began, with
 * nothing left to disagree, so the stale colour survived until the player
 * happened to tap another swatch.
 *
 * Every case below is that sequence or a corner of it.
 */

import { describe, expect, it } from "vitest";
import type { Appearance } from "@kad/shared";
import { createPaletteLatch, paletteKeyOf } from "./palette-latch";

const ORCHID: Appearance = { palette: "orchid", accent: "#709FE0" };
const MEADOW: Appearance = { palette: "meadow", accent: "#96E070" };
const EMBER: Appearance = { palette: "ember", accent: "#96E070" };

/** A stand-in rig that remembers what it was told to wear. */
function recorder() {
  const seen: Appearance[] = [];
  return { seen, setPalette: (a: Appearance) => void seen.push(a) };
}

describe("createPaletteLatch", () => {
  it("applies the latest palette when the rig finally arrives, not the one it started with", () => {
    // The whole bug, in five lines: build starts on orchid, the player picks
    // meadow while the wasm is still downloading, the rig installs.
    const latch = createPaletteLatch(ORCHID);
    latch.applyTo(null); // the load is in flight; there is nothing to colour
    latch.request(MEADOW);
    latch.applyTo(null); // still nothing — and still not "done"

    const rig = recorder();
    latch.applyTo(rig);
    expect(rig.seen).toEqual([MEADOW]);
    expect(latch.applied()).toBe(paletteKeyOf(MEADOW));
  });

  it("never marks a palette applied against a handle that does not exist", () => {
    // The precise mis-step: a record of "applied" written by a request.
    const latch = createPaletteLatch(ORCHID);
    latch.request(MEADOW);
    latch.applyTo(null);
    expect(latch.applied()).toBeNull();
  });

  it("keeps the last request when several land before the rig installs", () => {
    const latch = createPaletteLatch(ORCHID);
    latch.request(MEADOW);
    latch.request(EMBER);
    const rig = recorder();
    latch.applyTo(rig);
    expect(rig.seen).toEqual([EMBER]);
  });

  it("writes nothing when the rig already wears what was asked for", () => {
    // Party state arrives on nearly every patch; re-binding identical fills
    // sixty times a second is work nobody asked for.
    const latch = createPaletteLatch(ORCHID);
    const rig = recorder();
    latch.applyTo(rig);
    latch.applyTo(rig);
    latch.request({ ...ORCHID });
    latch.applyTo(rig);
    expect(rig.seen).toEqual([ORCHID]);
  });

  it("re-applies after a change, and only for the half that changed", () => {
    const latch = createPaletteLatch(ORCHID);
    const rig = recorder();
    latch.applyTo(rig);
    // Same palette name, different accent — still a change.
    latch.request({ palette: "orchid", accent: "#E0C470" });
    latch.applyTo(rig);
    expect(rig.seen).toHaveLength(2);
    expect(rig.seen[1]?.accent).toBe("#E0C470");
  });

  it("colours a replacement rig without waiting for another change", () => {
    // A tier crossing swaps the handle underneath the same character. The new
    // rig has never been coloured, so it has to be — even though nobody asked
    // for anything new.
    const latch = createPaletteLatch(MEADOW);
    const first = recorder();
    latch.applyTo(first);

    const replacement = createPaletteLatch(latch.wanted());
    const second = recorder();
    replacement.applyTo(second);
    expect(second.seen).toEqual([MEADOW]);
  });
});
