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

  it("deals longest first onto the lightest shard, test by test, even when tests share a line", () => {
    const timings = {
      "walk.spec.ts › quick": 2,
      "walk.spec.ts › the long walks › long": 200,
      "walk.spec.ts › the long walks › at 320px": 30,
      "walk.spec.ts › the long walks › at 390px": 40,
      "cards.spec.ts › card": 1,
    };
    // The two tests a loop made on line 40 are dealt apart, as any two tests are.
    // 390px (40) goes first, then long (35) to the other shard, then 320px (30) joins long.
    expect(plan(testsOf(report), { ...timings, "walk.spec.ts › the long walks › long": 35 }, 2)).toEqual([
      { tests: ["cards.spec.ts › card", "walk.spec.ts › quick", "walk.spec.ts › the long walks › at 390px"], seconds: 43 },
      { tests: ["walk.spec.ts › the long walks › at 320px", "walk.spec.ts › the long walks › long"], seconds: 65 },
    ]);
    expect(plan(testsOf(report), timings, 2)).toEqual([
      { tests: ["walk.spec.ts › the long walks › long"], seconds: 200 },
      { tests: ["cards.spec.ts › card", "walk.spec.ts › quick", "walk.spec.ts › the long walks › at 320px", "walk.spec.ts › the long walks › at 390px"], seconds: 73 },
    ]);
  });

  it("weighs a test it has never timed at the median, so a new test is still run", () => {
    const shards = plan(testsOf(report), { "walk.spec.ts › the long walks › long": 100, "cards.spec.ts › card": 10, other: 20 }, 3);
    expect(shards.flatMap(s => s.tests).sort()).toEqual(testsOf(report).map(t => t.key).sort());
    // quick, 320px and 390px are unmeasured: 20s each, the median of 10, 20, 100.
    expect(shards.reduce((sum, s) => sum + s.seconds, 0)).toBe(100 + 10 + 20 * 3);
  });

  it("spreads a loop of slow tests across shards instead of piling it on one", () => {
    const loop = {
      suites: [{
        title: "roadside.spec.ts",
        file: "roadside.spec.ts",
        specs: Array.from({ length: 24 }, (_, i) => ({ title: `road fight ${i}`, file: "roadside.spec.ts", line: 232, tests: [] })),
      }],
    };
    const timings = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`roadside.spec.ts › road fight ${i}`, 60]));
    const shards = plan(testsOf(loop), timings, 10);
    expect(Math.max(...shards.map(s => s.seconds))).toBe(180);
    expect(shards.flatMap(s => s.tests)).toHaveLength(24);
  });

  it("keeps two tests with identical titles as one line, which selects both", () => {
    const twins = { suites: [{ title: "a.spec.ts", file: "a.spec.ts", specs: [{ title: "same", file: "a.spec.ts", line: 1, tests: [] }, { title: "same", file: "a.spec.ts", line: 9, tests: [] }] }] };
    const shards = plan(testsOf(twins), { "a.spec.ts › same": 5 }, 2);
    expect(shards.flatMap(s => s.tests)).toEqual(["a.spec.ts › same"]);
    expect(shards[0]!.seconds).toBe(10);
  });

  it("is the same deal every time", () => {
    const tests = testsOf(report);
    expect(plan(tests, {}, 3)).toEqual(plan([...tests].reverse(), {}, 3));
  });
});
