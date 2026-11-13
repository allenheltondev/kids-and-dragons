import { describe, expect, it } from "vitest";
import { loadSmallArt, smallArtOwed, smallArtSources, type LockFiles } from "../../packages/client/small-art-build.ts";

const entry = (sha256: string) => ({ sha256, bytes: 1 });
const LOCK: LockFiles = {
  "assets/scenes/gemfall/hollow-gate.webp": entry("gate-v1"),
  "assets/entities/river_drake/assembled.png": entry("drake-v1"),
  "assets/entities/river_drake/warning.png": entry("warn"),
  "assets/characters/kitsune/mythic/assembled.png": entry("hero"),
};
const GATE = "assets/scenes/gemfall/hollow-gate@0.5x.webp";
const DRAKE = "assets/entities/river_drake/assembled@0.5x.webp";

describe("small art", () => {
  it("names a copy for backdrops and non-hero figures only, and never for a copy", () => {
    const withCopies = { ...LOCK, [GATE]: entry("g"), [DRAKE]: entry("d") };
    expect(smallArtSources(withCopies).map((s) => s.copy)).toEqual([DRAKE, GATE]);
  });

  it("owes a copy that is not in the lock, not recorded, or made from an older painting", () => {
    expect(smallArtOwed(LOCK, {}).map((o) => o.why)).toEqual(["missing", "missing"]);
    const pushed = { ...LOCK, [GATE]: entry("g"), [DRAKE]: entry("d") };
    expect(smallArtOwed(pushed, { [GATE]: "gate-v1", [DRAKE]: "drake-v1" })).toEqual([]);
    // The gate was repainted and its copy was not made again.
    const repainted = { ...pushed, "assets/scenes/gemfall/hollow-gate.webp": entry("gate-v2") };
    expect(smallArtOwed(repainted, { [GATE]: "gate-v1", [DRAKE]: "drake-v1" })).toEqual([
      { source: "assets/scenes/gemfall/hollow-gate.webp", copy: GATE, why: "stale" },
    ]);
  });

  /*
   * The repo's own lock. With no copies made yet, small art is simply off and there is nothing
   * to hold anyone to. Once any copy is recorded, the set is held whole: a new backdrop or a
   * repaint that has not been through `npm run art:small` fails here, in the PR that adds it,
   * rather than quietly turning small art off for every phone at the next build.
   */
  it("has every copy, current, once any has been made", () => {
    const { files, record } = loadSmallArt();
    if (Object.keys(record).length === 0) return;
    expect(smallArtOwed(files, record), "run `npm run art:small`, then `npm run assets:push`").toEqual([]);
  });
});
