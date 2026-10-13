import { describe, expect, it } from "vitest";
import { classify } from "./changes.mjs";

const all = { build: true, e2e: true, rigs: true, motion: true, deploy: true };

describe("CI change classification", () => {
  it("runs nothing expensive for prose", () => {
    expect(classify(["docs/art-pipeline.md", "README.md", "docs/briefs/part-recut.md"])).toEqual({
      build: false, e2e: false, rigs: false, motion: false, deploy: false,
    });
  });

  it("a docs data file is not prose", () => {
    // docs/ is listed as prose, but only for the build/e2e/deploy decision;
    // a .json there is still docs (nothing loads it at runtime).
    expect(classify(["docs/entry-scenes-prompts.json"]).build).toBe(false);
  });

  it("game code runs build, e2e and deploy, not the rig gates", () => {
    expect(classify(["packages/client/src/main.ts"])).toEqual({ ...all, rigs: false, motion: false });
  });

  it("a manifest edit outside the rig sections does not run the rig gates", () => {
    expect(classify(["assets/manifest.json"], { rigManifestChanged: false })).toEqual({ ...all, rigs: false, motion: false });
  });

  it("a manifest edit inside the rig sections runs them", () => {
    expect(classify(["assets/manifest.json"], { rigManifestChanged: true })).toEqual(all);
  });

  it("recut parts run the rig gates and build, but not e2e or a staging deploy", () => {
    expect(classify(["assets/characters/bigfoot/fledgling/parts/arm_l.png", "assets/characters/bigfoot/fledgling/joints.json"])).toEqual({
      build: true, e2e: false, rigs: true, motion: true, deploy: false,
    });
  });

  it("a rebuilt rig.riv is game content: it ships and the game loads it", () => {
    expect(classify(["assets/characters/bigfoot/fledgling/rig.riv"])).toEqual(all);
  });

  it("a new assembled.png runs the rest gate but not the motion gate", () => {
    const r = classify(["assets/characters/bigfoot/fledgling/assembled.png"]);
    expect(r.rigs).toBe(true);
    expect(r.motion).toBe(false);
  });

  it("entity art is game content, not a rig input", () => {
    expect(classify(["assets/entities/sheeple/assembled.png", "assets/entities/sheeple/parts/body.png"])).toEqual({ ...all, rigs: false, motion: false });
  });

  it("tests alone do not deploy staging", () => {
    expect(classify(["e2e/first-playable.spec.ts", "packages/server/src/dice.test.ts"]).deploy).toBe(false);
    expect(classify(["e2e/first-playable.spec.ts"]).e2e).toBe(true);
  });

  it("the motion gate's own code runs only the motion gate (and build)", () => {
    expect(classify(["tools/art/verify-rig-motion.mjs"])).toEqual({
      build: true, e2e: false, rigs: false, motion: true, deploy: false,
    });
  });

  it("changing the classifier runs every rig gate", () => {
    const r = classify(["tools/ci/changes.mjs"]);
    expect(r.rigs).toBe(true);
    expect(r.motion).toBe(true);
  });

  it("an unlisted kind of file runs everything but the rig gates", () => {
    expect(classify(["some/new/thing.yaml"])).toEqual({ ...all, rigs: false, motion: false });
  });

  it("CI's own workflow runs build and e2e but not a staging deploy", () => {
    expect(classify([".github/workflows/ci.yml"])).toEqual({ build: true, e2e: true, rigs: true, motion: false, deploy: false });
  });
});
