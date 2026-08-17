/**
 * The chapter generator's loop and its gate seam.
 *
 * Both halves run here with no API key and no network, which is the whole
 * reason `ask` and `check` are injected rather than imported. What is tested is
 * the part that decides whether the tool is worth running: does it hand the
 * gate's complaints back, does it stop when the gate is happy, and does it give
 * up with something an author can read rather than a stack trace.
 *
 * The gate's own rules are not re-tested here — `tools/content/validate.mjs`
 * owns them and `validate.test.mjs` checks them. What is tested is that this
 * reads its report correctly, because a parser that missed a failure would let
 * the loop declare a broken chapter clean.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_ATTEMPTS, generateChapter, readChapter, repairTurn } from "./generate-core.ts";
import type { Turn } from "./generate-core.ts";
import { chapterIdOf, readFailures } from "./generate-gate.ts";

/** Replies in order, and records what it was asked. */
function scripted(replies: string[]): {
  ask: (turns: Turn[]) => Promise<string>;
  seen: Turn[][];
} {
  const seen: Turn[][] = [];
  let next = 0;
  return {
    seen,
    ask: (turns) => {
      seen.push(turns.map((turn) => ({ ...turn })));
      return Promise.resolve(replies[next++] ?? replies[replies.length - 1] ?? "");
    },
  };
}

const CHAPTER = JSON.stringify({ id: "a-chapter", title: "A Chapter" });

describe("reading a chapter out of a reply", () => {
  it("takes a bare JSON object", () => {
    expect(readChapter(CHAPTER)).toEqual({ chapter: { id: "a-chapter", title: "A Chapter" } });
  });

  it("takes one inside a fence, because models fence about half the time", () => {
    /*
     * Not a nicety. A generator that failed on the fence would spend a repair
     * round — a whole large-model call over an 850-line schema — on formatting
     * rather than on the chapter.
     */
    expect(readChapter("Here you go:\n\n```json\n" + CHAPTER + "\n```\n")).toEqual({
      chapter: { id: "a-chapter", title: "A Chapter" },
    });
    expect(readChapter("```\n" + CHAPTER + "\n```")).toEqual({
      chapter: { id: "a-chapter", title: "A Chapter" },
    });
  });

  it("prefers the fence when the prose around it also has braces", () => {
    /*
     * The case the fence regex actually earns its place on. Without it the
     * brace-to-brace slice starts at the `{}` in the sentence and swallows the
     * fence markers, and the reply fails to parse — costing a repair round on a
     * chapter that was correct.
     */
    const chatty = "The scenes object uses `{}` keyed by id:\n\n```json\n" + CHAPTER + "\n```\n";
    expect(readChapter(chatty)).toEqual({ chapter: { id: "a-chapter", title: "A Chapter" } });
  });

  it("takes one with prose either side of it", () => {
    expect(readChapter(`I wrote this. ${CHAPTER} Hope it helps!`)).toEqual({
      chapter: { id: "a-chapter", title: "A Chapter" },
    });
  });

  it("reports a reply with no JSON in it rather than throwing", () => {
    const result = readChapter("I would rather not.");
    expect(result).toHaveProperty("problem");
    expect("problem" in result && result.problem).toMatch(/no JSON object/);
  });

  it("reports a parse failure with the parser's own message", () => {
    const result = readChapter('{"id": "a-chapter",}');
    expect("problem" in result && result.problem).toMatch(/did not parse/);
  });
});

describe("the repair turn", () => {
  it("hands the gate's complaints back word for word", () => {
    /*
     * `validate.mjs` writes its failures for whoever has to fix the chapter —
     * "did you mean: scene_shrine?", "flags set here: found_shrine" — and those
     * hints are the most useful thing in the loop. Summarising them would throw
     * away the part that does the work.
     */
    const turn = repairTurn([
      'content/chapters/x.json — at: /scenes/a/choices/0/goto — problem: goto "b" is not a scene in this chapter — did you mean: scene_b?',
    ]);
    expect(turn).toContain("did you mean: scene_b?");
    expect(turn).toContain("the whole file");
  });
});

describe("the loop", () => {
  it("stops the moment the gate is happy", async () => {
    const { ask, seen } = scripted([CHAPTER, CHAPTER]);
    const result = await generateChapter({ brief: "a bramble maze", ask, check: () => Promise.resolve([]) });

    expect(result.attempts).toBe(1);
    expect(result.problems).toEqual([]);
    expect(result.chapter).toEqual({ id: "a-chapter", title: "A Chapter" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([{ role: "user", content: "a bramble maze" }]);
  });

  it("repairs, and carries the failed answer and the complaints into the next attempt", async () => {
    // The load-bearing behaviour. A repair that did not include the previous
    // candidate would be a fresh generation with extra instructions, and would
    // reintroduce whatever the last one got right.
    const { ask, seen } = scripted([CHAPTER, CHAPTER]);
    let checks = 0;
    const result = await generateChapter({
      brief: "a bramble maze",
      ask,
      check: () => Promise.resolve(++checks === 1 ? ['goto "b" is not a scene'] : []),
    });

    expect(result.attempts).toBe(2);
    expect(result.problems).toEqual([]);

    const second = seen[1] ?? [];
    expect(second).toHaveLength(3);
    expect(second[0]?.role).toBe("user");
    expect(second[1]).toEqual({ role: "assistant", content: CHAPTER });
    expect(second[2]?.content).toContain('goto "b" is not a scene');
  });

  it("gives up with the last candidate and what was still wrong with it", async () => {
    /*
     * Returns rather than throws. An author who has just spent four rounds of a
     * large model wants to read the near-miss and the complaint; a stack trace
     * is the one thing that helps least.
     */
    const { ask } = scripted([CHAPTER]);
    const result = await generateChapter({
      brief: "a bramble maze",
      ask,
      check: () => Promise.resolve(["still broken"]),
      maxAttempts: 3,
    });

    expect(result.attempts).toBe(3);
    expect(result.problems).toEqual(["still broken"]);
    expect(result.chapter).toEqual({ id: "a-chapter", title: "A Chapter" });
  });

  it("treats a reply that is not a chapter as a problem to repair, not a crash", async () => {
    const { ask, seen } = scripted(["Sorry, I can't do that.", CHAPTER]);
    const result = await generateChapter({ brief: "x", ask, check: () => Promise.resolve([]) });

    expect(result.attempts).toBe(2);
    expect(result.problems).toEqual([]);
    expect(seen[1]?.[2]?.content).toMatch(/no JSON object/);
  });

  it("asks exactly once when told to", async () => {
    const { ask, seen } = scripted([CHAPTER]);
    const result = await generateChapter({
      brief: "x",
      ask,
      check: () => Promise.resolve(["nope"]),
      maxAttempts: 1,
    });
    expect(seen).toHaveLength(1);
    expect(result.attempts).toBe(1);
    // And no repair turn is appended after the last attempt — there is nothing
    // left to answer it.
    expect(result.turns[result.turns.length - 1]?.role).toBe("assistant");
  });

  it("never asks zero times, whatever it is handed", async () => {
    const { ask, seen } = scripted([CHAPTER]);
    await generateChapter({ brief: "x", ask, check: () => Promise.resolve([]), maxAttempts: 0 });
    expect(seen).toHaveLength(1);
  });

  it("defaults to a first attempt plus repairs, not a single shot", async () => {
    // A one-shot generator would be a worse version of pasting the schema into
    // a chat window; the repairs are the product.
    expect(DEFAULT_ATTEMPTS).toBeGreaterThan(1);
  });
});

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
     * The validator only emits escape codes on a TTY, and the generator always
     * runs it through a pipe. A parser that matched around the colours would
     * work in a terminal and silently find nothing anywhere else — which would
     * make the loop declare every broken chapter clean.
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

describe("the id a candidate claims", () => {
  it("is what names the file, so it has to be kebab-case", () => {
    // `validate.mjs` requires `id` to match the filename.
    expect(chapterIdOf({ id: "mire-01" })).toBe("mire-01");
    expect(chapterIdOf({ id: "bramblewood-01" })).toBe("bramblewood-01");
  });

  it("refuses anything that is not, rather than letting it near a path", () => {
    /*
     * Narrower than the filesystem needs, on purpose: this string becomes a
     * filename in `content/chapters/`, and a model-authored `../../etc/passwd`
     * should be caught here rather than by a write. A candidate that got the id
     * wrong hears about it from the schema in the next round.
     */
    expect(chapterIdOf({ id: "../escape" })).toBeNull();
    expect(chapterIdOf({ id: "Mire_01" })).toBeNull();
    expect(chapterIdOf({ id: "trailing-" })).toBeNull();
    expect(chapterIdOf({ id: "" })).toBeNull();
    expect(chapterIdOf({ id: 7 })).toBeNull();
    expect(chapterIdOf({})).toBeNull();
    expect(chapterIdOf(null)).toBeNull();
    expect(chapterIdOf("mire-01")).toBeNull();
  });
});
