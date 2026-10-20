import { describe, expect, it } from "vitest";
import { readFailures } from "./run-validator.ts";

describe("reading the validator's report", () => {
  /** A real `validate.mjs` failure block, colour codes and all. */
  const REPORT = [
    "Kids & Dragons - content validate",
    "",
    "chapters",
    "  \x1b[31mFAIL\x1b[0m  content/chapters/mire-01.json",
    "        at:      /scenes/scene_bog/choices/0/goto",
    '        problem: goto "scene_fen" is not a scene in this chapter',
    "        \x1b[2mdid you mean: scene_fern?\x1b[0m",
    "  \x1b[31mFAIL\x1b[0m  content/chapters/mire-01.json",
    "        at:      /objectives/0/flag",
    '        problem: flag "found_it" is never set to true by any effect in this chapter',
    "",
    // The summary line, at column zero — the validator's own, verbatim.
    "\x1b[31m\x1b[1mFAILED\x1b[0m - content is broken. A malformed chapter fails the build, never the play session.",
  ].join("\n");

  it("keeps every line of a failure, hints included", () => {
    const problems = readFailures(REPORT);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("content/chapters/mire-01.json");
    expect(problems[0]).toContain("/scenes/scene_bog/choices/0/goto");
    expect(problems[0]).toContain("did you mean: scene_fern?");
    expect(problems[1]).toContain("never set to true");
  });

  it("reads a report with no colour in it, which is the one CI produces", () => {
    /*
     * The validator only emits escape codes on a TTY, and the tests always run
     * it through a pipe. A parser that matched around the colours would work in
     * a terminal and silently find nothing anywhere else.
     */
    // eslint-disable-next-line no-control-regex -- stripping the codes is the point
    const plain = REPORT.replace(/\x1b\[[0-9;]*m/g, "");
    expect(readFailures(plain)).toEqual(readFailures(REPORT));
    expect(readFailures(plain)).toHaveLength(2);
  });

  it("finds nothing in a clean report", () => {
    expect(readFailures("Kids & Dragons - content validate\n\n13 passed\n\nPASS")).toEqual([]);
  });
});
