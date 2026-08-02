/**
 * The two rules in `nameplate.ts` that can be wrong without anybody noticing.
 *
 * The drawing itself needs a renderer and is exercised by running the app; what
 * is worth failing in CI is the pair of decisions underneath it — when there is
 * no name to draw, and how a long one is made to fit. Both fail *quietly* at the
 * table: an empty label is a smudge under a figure, and an unfitted one is two
 * names overlapping into a third unreadable one, which is the exact failure the
 * nameplate was added to fix.
 */

import { describe, expect, it } from "vitest";
import { nameplateLabel, nameplateScale } from "./nameplate";

describe("nameplateLabel", () => {
  it("keeps a real name, trimmed", () => {
    expect(nameplateLabel("Sparklehoof")).toBe("Sparklehoof");
    expect(nameplateLabel("  Ember  ")).toBe("Ember");
  });

  it("is null for a name with nothing in it", () => {
    // Not reachable through creation, which sanitises and requires a name —
    // reachable through a save written before it did.
    expect(nameplateLabel("")).toBeNull();
    expect(nameplateLabel("   ")).toBeNull();
  });
});

describe("nameplateScale", () => {
  it("shrinks a name that overruns its slot", () => {
    expect(nameplateScale(200, 100)).toBe(0.5);
  });

  it("never grows a short one", () => {
    // A three-letter name blown up to fill a tile would shout, and the size
    // relationship to the figure is what makes the two stages match.
    expect(nameplateScale(50, 100)).toBe(1);
  });

  it("leaves a measurement it cannot use alone", () => {
    // Pixi reports 0 for a text that has not laid out yet; scaling by
    // maxWidth/0 is Infinity, which is how a nameplate becomes a full-screen
    // white bar rather than a missing one.
    expect(nameplateScale(0, 100)).toBe(1);
    expect(nameplateScale(200, 0)).toBe(1);
    expect(nameplateScale(Number.NaN, 100)).toBe(1);
  });
});

/**
 * And the one rule that lives in PixiStage: which phases hide the names.
 *
 * It has to agree with WorldView's mount condition for `LobbyContent`, and
 * nothing structural makes it — they are two lists of phase strings in two
 * files. They drift silently, and the symptom is either the name twice or no
 * name in a fight, so the agreement is asserted rather than assumed.
 */
describe("nameplatesVisibleIn", () => {
  it("hides the names for exactly the phases that put the lobby over the lineup", async () => {
    const { nameplatesVisibleIn } = await import("./PixiStage");
    // WorldView: `(phase === "lobby" || phase === "creation") && <LobbyContent />`
    expect(nameplatesVisibleIn("lobby")).toBe(false);
    expect(nameplatesVisibleIn("creation")).toBe(false);

    for (const phase of ["scene", "check", "encounter", "chapter_complete"]) {
      expect(nameplatesVisibleIn(phase), phase).toBe(true);
    }
    // No state yet resolves to the lobby, exactly as WorldView resolves it
    // (`useRunState()?.phase ?? "lobby"`). Answer it differently and the
    // pairing holds everywhere except at startup.
    expect(nameplatesVisibleIn(null)).toBe(false);
    expect(nameplatesVisibleIn(undefined)).toBe(false);
  });
});
