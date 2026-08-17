/**
 * The narrator's cache — architecture §6.4.
 *
 * The transport is injected, so every rule here is checked without a network,
 * without credentials, and in CI. What is *not* checked here is whether Bedrock
 * answers; that is one thin function (`bedrockSender`) and a live run.
 */

import { describe, expect, it, vi } from "vitest";
import type { Chapter, RulesContent, Scene } from "@kad/shared";
import fs from "node:fs";
import path from "node:path";
import { createNarrator } from "./narrator.ts";
import type { LiveReply, LiveRequest } from "./narrator.ts";
import type { NarrationRequest, PrefetchKey } from "./port.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "rules.json"), "utf8")) as RulesContent;

const SCENE: Scene = {
  type: "story",
  narration: "A wall of thorns twice your height blocks the path through the hedge.",
  choices: [],
};

const CHAPTER: Chapter = {
  id: "bramblewood-01",
  campaignId: "the-hollow-crown",
  index: 1,
  title: "The Bramblewood",
  biome: "forest",
  estimatedMinutes: 30,
  xpAward: 100,
  entry: "scene_hedge",
  scenes: { scene_hedge: SCENE },
  llmHints: {
    tone: "warm",
    vocabulary: "age-8",
    forbidden: ["death", "blood"],
    npcVoices: { pib: "a bramble sprite" },
  },
};

const KEY: PrefetchKey = { runId: "r_1", sceneId: "scene_hedge", choiceId: "Squeeze through", stamp: "c_1:10|" };

const REQUEST: NarrationRequest = {
  runId: "r_1",
  chapter: CHAPTER,
  sceneId: "scene_hedge",
  scene: SCENE,
  authored: SCENE.type === "story" ? SCENE.narration : "",
  via: "Squeeze through",
  party: [],
  flags: {},
};

const GOOD = "The hedge creaks as you get close, in a way hedges are not supposed to creak. Pib pretends not to have noticed.";

/** A transport that answers with whatever it is told to, and counts calls. */
function faker(answers: string[] | (() => string), usage: Partial<LiveReply> = {}) {
  const seen: LiveRequest[] = [];
  let index = 0;
  const send = (request: LiveRequest): Promise<LiveReply> => {
    seen.push(request);
    const text = typeof answers === "function" ? answers() : (answers[index++] ?? answers.at(-1) ?? "");
    return Promise.resolve({ text, cacheRead: 0, cacheWrite: 0, ...usage });
  };
  return { send, seen };
}

function build(answers: string[] | (() => string), extra: Parameters<typeof createNarrator>[0] extends infer T ? Partial<T> : never = {}) {
  const fake = faker(answers);
  const log = vi.fn();
  const narrator = createNarrator({ rules: RULES, awsRegion: "us-east-1", send: fake.send, log, ...extra });
  return { narrator, ...fake, log };
}

/**
 * `warm` used to be fire-and-forget and is now awaited — see the Lambda-freeze
 * note on `Narrator.warm`. Kept as a helper so the tests below read the same
 * either way, and so a regression back to fire-and-forget would show up here
 * rather than as a silent 100% miss rate in production.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("taking a line", () => {
  it("has nothing before anything was warmed", () => {
    // The cold-start case, which on Lambda is every first invocation. It must be
    // a miss and not a wait.
    const { narrator } = build([GOOD]);
    expect(narrator.take(KEY, REQUEST)).toBeNull();
  });

  it("hands back what was warmed", async () => {
    const { narrator } = build([GOOD]);
    await narrator.warm([{ key: KEY, request: REQUEST }]);
    expect(narrator.take(KEY, REQUEST)).toBe(GOOD);
  });

  it("hands it back exactly once", async () => {
    /*
     * A line is written for *this* arrival. Serving it again on the next one
     * would be the single failure a player would actually notice — the same
     * sentence twice is worse than the authored line both times.
     */
    const { narrator } = build([GOOD]);
    await narrator.warm([{ key: KEY, request: REQUEST }]);
    expect(narrator.take(KEY, REQUEST)).toBe(GOOD);
    expect(narrator.take(KEY, REQUEST)).toBeNull();
  });

  it("never returns another run's line", async () => {
    /*
     * §6.4 says "per-run cache" and leaves the run id implicit. One process
     * serves many households at once, so implicit is not good enough: without
     * the run in the key, one family's prefetched line reaches another's
     * television.
     */
    const { narrator } = build([GOOD]);
    await narrator.warm([{ key: KEY, request: REQUEST }]);
    expect(narrator.take({ ...KEY, runId: "r_2" }, REQUEST)).toBeNull();
  });

  it("distinguishes two ways into the same scene", async () => {
    // The choice label is half the key because it is the thing the line is
    // about. Squeezing through and going around arrive in the same place and
    // deserve different sentences.
    const other = "You go the long way round and the hedge does not comment, which somehow feels worse.";
    const { narrator } = build([GOOD, other]);
    await narrator.warm([
      { key: KEY, request: REQUEST },
      { key: { ...KEY, choiceId: "Go around" }, request: { ...REQUEST, via: "Go around" } },
    ]);
    await settle();
    expect(narrator.take({ ...KEY, choiceId: "Go around" }, REQUEST)).toBe(other);
    expect(narrator.take(KEY, REQUEST)).toBe(GOOD);
  });

  it("expires a line that has been sitting too long", async () => {
    // The party moved on; a line prefetched for a scene they left ten minutes
    // ago is about a moment that did not happen.
    vi.useFakeTimers();
    try {
      const { narrator } = build([GOOD]);
      await narrator.warm([{ key: KEY, request: REQUEST }]);
      await vi.advanceTimersByTimeAsync(1);
      vi.advanceTimersByTime(11 * 60 * 1000);
      expect(narrator.take(KEY, REQUEST)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("warming", () => {
  it("does not buy the same line twice", async () => {
    // Two taps in the same scene, or a re-entered scene, must not double the
    // calls. `pending` is what stops the in-flight case, which is the one a
    // simple has-it check would miss.
    const { narrator, seen } = build([GOOD]);
    narrator.warm([{ key: KEY, request: REQUEST }, { key: KEY, request: REQUEST }]);
    await settle();
    expect(seen).toHaveLength(1);
  });

  it("returns before the call finishes", () => {
    /*
     * The promise §6.4 makes. `warm` is called on the action path, after the
     * broadcast; if it awaited anything the tap that triggered it would be
     * waiting on a language model.
     */
    let resolved = false;
    const send = () => new Promise<LiveReply>((resolve) => {
      setTimeout(() => {
        resolved = true;
        resolve({ text: GOOD, cacheRead: 0, cacheWrite: 0 });
      }, 50);
    });
    const narrator = createNarrator({ rules: RULES, awsRegion: "us-east-1", send, log: vi.fn() });
    narrator.warm([{ key: KEY, request: REQUEST }]);
    expect(resolved).toBe(false);
  });

  it("swallows a failed call", async () => {
    /*
     * A prefetch runs after the response has already gone out. A rejection here
     * becoming an unhandled rejection would take down a Lambda that has already
     * answered correctly — the layer would be costing the game the very thing
     * it is supposed to be optional about.
     */
    const send = () => Promise.reject(new Error("bedrock said no"));
    const log = vi.fn();
    const narrator = createNarrator({ rules: RULES, awsRegion: "us-east-1", send, log });
    expect(() => { narrator.warm([{ key: KEY, request: REQUEST }]); }).not.toThrow();
    await settle();
    expect(narrator.take(KEY, REQUEST)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("prefetch failed"));
  });

  it("puts one cache breakpoint at the end of the stable prefix", async () => {
    // The layout §6.3 asks for: everything stable in the cached block, the
    // party and the scene and the moment behind it.
    const { narrator, seen } = build([GOOD]);
    await narrator.warm([{ key: KEY, request: REQUEST }]);
    const request = seen[0];
    expect(request?.cached).toContain("Examples");
    expect(request?.cached).not.toContain("Squeeze through");
    expect(request?.tail).toContain("Squeeze through");
  });

  it("builds a byte-identical prefix on every call for the same chapter", async () => {
    // Prefix matching is on bytes; two renders that differ by a space are two
    // cache entries and zero cache hits.
    const { narrator, seen } = build([GOOD, GOOD]);
    await narrator.warm([{ key: KEY, request: REQUEST }]);
    narrator.warm([{ key: { ...KEY, choiceId: "Go around" }, request: REQUEST }]);
    await settle();
    expect(seen[0]?.cached).toBe(seen[1]?.cached);
  });
});

describe("the validator, from the narrator's side", () => {
  it("stores nothing when the model declines", async () => {
    // PASS is the answer the prompt asks for by name when there is nothing
    // worth adding. It is a good outcome, not a failure, and the authored line
    // stands.
    const { narrator, log } = build(["PASS"]);
    await narrator.warm([{ key: KEY, request: REQUEST }]);
    expect(narrator.take(KEY, REQUEST)).toBeNull();
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("rejected"));
  });

  it("throws away a line that fails the gate, silently", async () => {
    // §6.5: "Anything that fails is discarded and the authored text is used.
    // Silently." The log line is for a developer; nothing reaches the game.
    const { narrator, log } = build(["The hedge is covered in blood and something here has met its death."]);
    await narrator.warm([{ key: KEY, request: REQUEST }]);
    expect(narrator.take(KEY, REQUEST)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("forbidden topic"));
  });

  it("does not retry a rejection", async () => {
    // §6.5: "no retry loop, no waiting". A second attempt would spend the
    // prefetch window that the whole design exists to protect.
    const { narrator, seen } = build(["nope"]);
    await narrator.warm([{ key: KEY, request: REQUEST }]);
    expect(seen).toHaveLength(1);
  });
});

describe("the dev-mode cache assertion", () => {
  it("shouts when the prompt cache never hits", async () => {
    /*
     * §6.3: "Assert on it in dev. Log `usage.cache_read_input_tokens` and fail
     * loudly in development if it's zero across repeated calls."
     *
     * The failure being asserted on has no other symptom — a prefix under the
     * floor works perfectly and costs full price forever.
     */
    const log = vi.fn();
    const send = () => Promise.resolve({ text: GOOD, cacheRead: 0, cacheWrite: 0 });
    const narrator = createNarrator({ rules: RULES, awsRegion: "us-east-1", send, log, assertCache: true });
    for (const choiceId of ["a", "b", "c"]) {
      narrator.warm([{ key: { ...KEY, choiceId }, request: REQUEST }]);
      await settle();
    }
    expect(log).toHaveBeenCalledWith(expect.stringContaining("prompt cache is not hitting"));
  });

  it("stays quiet when the cache is working", async () => {
    const log = vi.fn();
    const send = () => Promise.resolve({ text: GOOD, cacheRead: 4200, cacheWrite: 0 });
    const narrator = createNarrator({ rules: RULES, awsRegion: "us-east-1", send, log, assertCache: true });
    for (const choiceId of ["a", "b", "c", "d"]) {
      narrator.warm([{ key: { ...KEY, choiceId }, request: REQUEST }]);
      await settle();
    }
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("not hitting"));
  });

  it("does not fire on the first call, which legitimately reads nothing", async () => {
    // The first call *writes* the cache. Warning on it would make the assertion
    // fire on every cold start, which is how a warning gets ignored.
    const log = vi.fn();
    const send = () => Promise.resolve({ text: GOOD, cacheRead: 0, cacheWrite: 4200 });
    const narrator = createNarrator({ rules: RULES, awsRegion: "us-east-1", send, log, assertCache: true });
    await narrator.warm([{ key: KEY, request: REQUEST }]);
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("not hitting"));
  });

  it("says nothing at all when the assertion is off", async () => {
    // Production. A table mid-session is not the place to learn about a billing
    // regression.
    const log = vi.fn();
    const send = () => Promise.resolve({ text: GOOD, cacheRead: 0, cacheWrite: 0 });
    const narrator = createNarrator({ rules: RULES, awsRegion: "us-east-1", send, log, assertCache: false });
    for (const choiceId of ["a", "b", "c"]) {
      narrator.warm([{ key: { ...KEY, choiceId }, request: REQUEST }]);
      await settle();
    }
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("not hitting"));
  });
});

describe("the recap", () => {
  const RECAP =
    "You went into the Bramblewood after a way through a hedge, and came out with a sprite who " +
    "will not stop following you. Nobody has explained the acorn yet, and nobody is going to.";

  const request = {
    runId: "r_1",
    chapter: CHAPTER,
    party: [],
    flags: { freed_sprite: true },
    visited: ["scene_hedge"],
    outcome: "triumph",
  };

  it("returns a good recap", async () => {
    const { narrator } = build([RECAP]);
    await expect(narrator.recap(request)).resolves.toBe(RECAP);
  });

  it("returns null rather than throwing when the call fails", async () => {
    /*
     * Unlike `warm`, this one is awaited — so a throw would reach a caller. The
     * chapter is over either way, and a completion screen that 500s because a
     * flavour call failed is the layer being load-bearing, which it must never
     * be.
     */
    const send = () => Promise.reject(new Error("timeout"));
    const narrator = createNarrator({ rules: RULES, awsRegion: "us-east-1", send, log: vi.fn() });
    await expect(narrator.recap(request)).resolves.toBeNull();
  });

  it("holds a recap to the recap gate", async () => {
    const { narrator } = build(["Good job!"]);
    await expect(narrator.recap(request)).resolves.toBeNull();
  });
});

describe("finishing before the invocation does", () => {
  it("resolves only once every line it started has landed", async () => {
    /*
     * The P1 a review caught, and the one that would have made the whole layer
     * a no-op in production while passing every test.
     *
     * On Lambda the execution environment is frozen the instant the handler's
     * promise resolves. A request dispatched and not awaited does not continue
     * during the gap it was dispatched into — it thaws on the *next*
     * invocation, which is the tap it was supposed to be ready for, arriving
     * after `take()` has already missed. Every line paid for, none ever read.
     *
     * So `warm` has to be awaitable and has to actually be complete when it
     * resolves.
     *
     * The sender answers on a **timer** rather than a resolved promise, and
     * that detail is the test. A fake that resolves in microtasks lands its
     * entry during the `await` regardless of whether `warm` waited for it, so
     * the obvious version of this test passed against a `warm` that returned
     * immediately — it was measuring the fake, not the code. A macrotask cannot
     * be drained by an early return.
     */
    const narrator = createNarrator({
      rules: RULES,
      awsRegion: "us-east-1",
      send: () =>
        new Promise<LiveReply>((resolve) => {
          setTimeout(() => {
            resolve({ text: GOOD, cacheRead: 0, cacheWrite: 0 });
          }, 25);
        }),
      log: () => undefined,
    });

    await narrator.warm([{ key: KEY, request: REQUEST }]);
    expect(narrator.take(KEY, REQUEST)).toBe(GOOD);
  });

  it("gives up rather than holding the invocation open on a hung request", async () => {
    /*
     * The bound that makes awaiting safe. The turn has already committed and
     * already broadcast by the time this runs, so one stuck socket must not be
     * able to push a healthy turn into the function's own timeout.
     *
     * Fake timers, because the budget is four seconds and a test that waited
     * them out would be four seconds slower for no extra confidence.
     */
    vi.useFakeTimers();
    try {
      const hung = createNarrator({
        rules: RULES,
        awsRegion: "us-east-1",
        send: () => new Promise<never>(() => undefined),
        log: () => undefined,
      });

      let done = false;
      const warming = hung.warm([{ key: KEY, request: REQUEST }]).then(() => {
        done = true;
      });

      await vi.advanceTimersByTimeAsync(3_000);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1_500);
      await warming;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves immediately when there is nothing new to warm", async () => {
    // Every intent that is not an arrival — a READY, a trade, a stat spend —
    // goes through this path. Arming a four-second timer on each of them would
    // add latency to the whole session in exchange for nothing.
    vi.useFakeTimers();
    try {
      const { narrator, seen } = build([GOOD]);
      await narrator.warm([]);
      expect(seen).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
