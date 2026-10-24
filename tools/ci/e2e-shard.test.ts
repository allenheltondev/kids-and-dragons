import { describe, expect, it } from "vitest";
import { plan, testsOf } from "./e2e-shard.mjs";

// The shape `playwright test --list --reporter=json` and the json reporter
// share: file suites, describe suites inside them, specs with a line.
const report = {
  suites: [
    {
      title: "walk.spec.ts",
      file: "walk.spec.ts",
      specs: [{ title: "quick", file: "walk.spec.ts", line: 5, tests: [{ results: [{ duration: 2000, status: "passed" }] }] }],
      suites: [
        {
          title: "the long walks",
          specs: [
            { title: "long", file: "walk.spec.ts", line: 20, tests: [{ results: [] }] },
            { title: "at 320px", file: "walk.spec.ts", line: 40, tests: [] },
            { title: "at 390px", file: "walk.spec.ts", line: 40, tests: [] },
          ],
        },
      ],
    },
    { title: "cards.spec.ts", file: "cards.spec.ts", specs: [{ title: "card", file: "cards.spec.ts", line: 3, tests: [] }] },
  ],
};

describe("the e2e shard deal", () => {
  it("keys a test by its file and title path, and keeps a measured duration", () => {
    const tests = testsOf(report);
    expect(tests.map(t => t.key)).toEqual([
      "walk.spec.ts › quick",
      "walk.spec.ts › the long walks › long",
      "walk.spec.ts › the long walks › at 320px",
      "walk.spec.ts › the long walks › at 390px",
      "cards.spec.ts › card",
    ]);
    expect(tests.map(t => t.seconds)).toEqual([2, undefined, undefined, undefined, undefined]);
  });

  it("deals longest first onto the lightest shard, and keeps a shared line together", () => {
    const timings = {
      "walk.spec.ts › quick": 2,
      "walk.spec.ts › the long walks › long": 200,
      "walk.spec.ts › the long walks › at 320px": 30,
      "walk.spec.ts › the long walks › at 390px": 40,
      "cards.spec.ts › card": 1,
    };
    expect(plan(testsOf(report), timings, 2)).toEqual([
      { locations: ["walk.spec.ts:20"], seconds: 200 },
      { locations: ["cards.spec.ts:3", "walk.spec.ts:40", "walk.spec.ts:5"], seconds: 73 },
    ]);
  });

  it("weighs a test it has never timed at the median, so a new test is still run", () => {
    const shards = plan(testsOf(report), { "walk.spec.ts › the long walks › long": 100, "cards.spec.ts › card": 10, other: 20 }, 3);
    expect(shards.flatMap(s => s.locations).sort()).toEqual(["cards.spec.ts:3", "walk.spec.ts:20", "walk.spec.ts:40", "walk.spec.ts:5"]);
    // quick, 320px and 390px are unmeasured: 20s each, the median of 10, 20, 100.
    expect(shards.reduce((sum, s) => sum + s.seconds, 0)).toBe(100 + 10 + 20 * 3);
  });

  it("is the same deal every time", () => {
    const tests = testsOf(report);
    expect(plan(tests, {}, 3)).toEqual(plan([...tests].reverse(), {}, 3));
  });
});
