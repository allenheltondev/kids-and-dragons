import { describe, expect, it } from "vitest";
import { loadSmallArt, smallArtOwed, smallArtSources, type LockFiles } from "../../packages/client/small-art-build.ts";

const entry = (sha256: string) => ({ sha256, bytes: 1 });
const LOCK: LockFiles = {
  "assets/scenes/gemfall/hollow-gate.webp": entry("gate-v1"),
  "assets/entities/river_drake/assembled.png": entry("drake-v1"),
  "assets/entities/river_drake/warning.png": entry("warn"),
  "assets/characters/kitsune/mythic/assembled.png": entry("hero"),
  "assets/characters/kitsune/mythic/coat-mask.png": entry("mask"),
};
const GATE = "assets/scenes/gemfall/hollow-gate@0.5x.webp";
const DRAKE = "assets/entities/river_drake/assembled@0.5x.webp";
const DRAKE_WHOLE = "assets/entities/river_drake/assembled@1x.webp";
const HERO_WHOLE = "assets/characters/kitsune/mythic/assembled@1x.webp";
const COPIES = { [GATE]: entry("g"), [DRAKE]: entry("d"), [DRAKE_WHOLE]: entry("dw"), [HERO_WHOLE]: entry("hw") };
const RECORD = { [GATE]: "gate-v1", [DRAKE]: "drake-v1", [DRAKE_WHOLE]: "drake-v1", [HERO_WHOLE]: "hero" };

describe("small art", () => {
  it("names a half for backdrops and non-hero figures, a whole for every figure, and never a copy of a copy or of a mask", () => {
    expect(smallArtSources({ ...LOCK, ...COPIES })).toEqual([
      { source: "assets/characters/kitsune/mythic/assembled.png", copy: HERO_WHOLE, kind: "whole" },
      { source: "assets/entities/river_drake/assembled.png", copy: DRAKE, kind: "half" },
      { source: "assets/entities/river_drake/assembled.png", copy: DRAKE_WHOLE, kind: "whole" },
      { source: "assets/scenes/gemfall/hollow-gate.webp", copy: GATE, kind: "half" },
    ]);
  });

  it("owes a copy that is not in the lock, not recorded, or made from an older painting", () => {
    expect(smallArtOwed(LOCK, {}).map((o) => o.why)).toEqual(["missing", "missing", "missing", "missing"]);
    const pushed = { ...LOCK, ...COPIES };
    expect(smallArtOwed(pushed, RECORD)).toEqual([]);
    // The halves alone, as the first set was made: the full-size copies are still owed, so the build stays off.
    expect(smallArtOwed({ ...LOCK, [GATE]: entry("g"), [DRAKE]: entry("d") }, { [GATE]: "gate-v1", [DRAKE]: "drake-v1" }).map((o) => o.copy)).toEqual([HERO_WHOLE, DRAKE_WHOLE]);
    // The gate was repainted and its copy was not made again.
    const repainted = { ...pushed, "assets/scenes/gemfall/hollow-gate.webp": entry("gate-v2") };
    expect(smallArtOwed(repainted, RECORD)).toEqual([
      { source: "assets/scenes/gemfall/hollow-gate.webp", copy: GATE, kind: "half", why: "stale" },
    ]);
    // The drake was repainted: both of its copies are stale.
    const redrawn = { ...pushed, "assets/entities/river_drake/assembled.png": entry("drake-v2") };
    expect(smallArtOwed(redrawn, RECORD).map((o) => [o.copy, o.why])).toEqual([[DRAKE, "stale"], [DRAKE_WHOLE, "stale"]]);
  });

  /*
   * The repo's own lock. With no copies made yet, the copies are simply off and there is nothing
   * to hold anyone to. Once any copy is recorded, the set is held whole: a new backdrop or a
   * repaint that has not been through `npm run art:small` fails here, in the PR that adds it,
   * rather than quietly turning the copies off for every device at the next build.
   */
  it("has every copy, current, once any has been made", () => {
    const { files, record } = loadSmallArt();
    if (Object.keys(record).length === 0) return;
    expect(smallArtOwed(files, record), "run `npm run art:small`, then `npm run assets:push`").toEqual([]);
  });
});
