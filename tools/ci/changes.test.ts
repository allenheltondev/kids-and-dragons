import { describe, expect, it } from "vitest";
import { classify } from "./changes.mjs";

const all = { build: true, e2e: true, deploy: true };
describe("CI change classification", () => {
  it("skips expensive work for prose", () => {
    expect(classify(["docs/art-pipeline.md", "README.md"])).toEqual({ build: false, e2e: false, deploy: false });
  });
  it.each([
    "packages/client/src/world/scene.ts",
    "assets/manifest.json",
    "assets/characters/unicorn/fledgling/assembled.png",
    "assets/character-rigs/thornguard/sworn/griffin/assembled.png",
    "some/new/thing.yaml",
  ])("checks and deploys game changes in %s", path => {
    expect(classify([path])).toEqual(all);
  });
  it("checks art tooling without deploying it", () => {
    expect(classify(["tools/art/verify.py"])).toEqual({ build: true, e2e: false, deploy: false });
  });
  it("does not deploy tests or the CI workflow", () => {
    expect(classify(["e2e/first-playable.spec.ts"]).deploy).toBe(false);
    expect(classify([".github/workflows/ci.yml"])).toEqual({ build: true, e2e: true, deploy: false });
  });
});

it("treats docs data as documentation", () => {
  expect(classify(["docs/entry-scenes-prompts.json"])).toEqual({ build: false, e2e: false, deploy: false });
});
it.each(["playwright.prod.config.ts", "packages/server/src/dice.test.ts", "e2e/first-playable.spec.ts"])("does not deploy test-only change %s", path => {
  expect(classify([path]).deploy).toBe(false);
});
it("checks and ships entity art", () => {
  expect(classify(["assets/entities/sheeple/assembled.png"])).toEqual(all);
});
