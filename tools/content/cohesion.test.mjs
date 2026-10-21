/**
 * The chapter-cohesion helpers (tools/content/cohesion.mjs) on small synthetic
 * chapters, plus one pass over every shipped chapter to show they read real
 * content without throwing. They report and never gate, so nothing here
 * asserts on a real chapter's findings.
 */

import { describe, expect, it } from "vitest";

import { conceptSweep, idioms, loadChapters, main, mergePoints, opening, reachable, setbackRoutes } from "./cohesion.mjs";

const go = (id, goto, label = "On") => ({ id, label, icon: "arrow", goto });
const story = (narration, ...choices) => ({ type: "story", narration, choices });
const check = (prompt, success, failure, tn = 12) => ({
  type: "check",
  stat: "might",
  tn,
  prompt,
  onSuccess: { goto: success, narration: "It works." },
  onFailure: { goto: failure, narration: "It does not." },
});
const end = (outcome) => ({ type: "rest", narration: "The end.", choices: [], ...(outcome ? { outcome } : {}) });

/**
 *   start ─┬─ intro (introduces the masks) ─┐
 *          └─ detour ───────────────────────┴─ merge (mentions the masks) ─ done
 */
const masks = {
  id: "fixture-masks",
  entry: "start",
  goal: { text: "Find out who the masks are.", steps: [] },
  scenes: {
    start: story("Two paths.", go("a", "intro"), go("b", "detour")),
    intro: story("Hessa's friends wear bark masks to sing.", go("on", "merge")),
    detour: story("A muddy shortcut.", go("on", "merge")),
    merge: story("The masked choir hums.", go("on", "done")),
    orphan: story("A mask nobody can reach.", go("on", "done")),
    done: end(),
  },
};

describe("the concept sweep", () => {
  it("finds the leak a path that skipped the introduction opens", () => {
    const r = conceptSweep(masks, /\bmask(s|ed)?\b/i, ["intro"]);
    expect(r.mentions.map((m) => m.id)).toEqual(["intro", "merge"]);
    expect(r.unreachable).toEqual(["orphan"]);
    expect(r.firstMentions).toEqual(["intro", "merge"]);
    expect(r.leaks).toEqual(["merge"]);
  });

  it("is clean once every way in passes an introduction", () => {
    const fixed = { ...masks, scenes: { ...masks.scenes, detour: story("The masks wave you past the mud.", go("on", "merge")) } };
    expect(conceptSweep(fixed, /\bmask(s|ed)?\b/i, ["intro", "detour"]).leaks).toEqual([]);
  });

  it("reads branch narration, labels and variants, and leaves leaks null with no introducer", () => {
    const c = {
      id: "fixture-text",
      entry: "roll",
      scenes: {
        roll: { ...check("Lift it.", "pick", "pick"), onFailure: { goto: "pick", narration: "The seal cracks." } },
        pick: { ...story("Choose.", go("x", "done", "Touch the seal")), variants: [{ when: { flag: "f" }, text: "The seal glows." }] },
        done: end(),
      },
    };
    const r = conceptSweep(c, /\bseal\b/i);
    expect(r.mentions.flatMap((m) => m.hits.map((h) => `${m.id}:${h.field}`))).toEqual(["roll:onFailure", "pick:variants[0]", "pick:choice x"]);
    // The party that lifted it never heard about the seal, so pick is a first mention too.
    expect(r.firstMentions).toEqual(["roll", "pick"]);
    expect(r.leaks).toBeNull();
  });

  it("counts a result's narration as an introduction only on that result's way out", () => {
    // start -> roll; only a failed roll hears about the masks; both results reach merge.
    const c = {
      id: "fixture-branch",
      entry: "start",
      scenes: {
        start: story("Go.", go("on", "roll")),
        roll: { ...check("Climb.", "merge", "merge"), onFailure: { goto: "merge", narration: "The masks arrive and pull you up." } },
        merge: story("The masks hum.", go("on", "done")),
        done: end(),
      },
    };
    const r = conceptSweep(c, /\bmasks\b/i, ["roll"]);
    expect(r.firstMentions).toEqual(["roll", "merge"]);
    expect(r.unproven).toEqual([]);
    expect(r.leaks).toEqual(["merge"]);
  });

  it("counts a choice label only on its own way out, gated or not", () => {
    const c = {
      id: "fixture-label",
      entry: "start",
      scenes: {
        start: story("A fork.", { ...go("follow", "merge", "Follow the masks"), requiresFlag: "met_hessa" }, go("walk", "merge", "Walk on")),
        merge: story("The masks hum.", go("on", "done")),
        done: end(),
      },
    };
    expect(conceptSweep(c, /\bmasks\b/i, ["start"]).leaks).toEqual(["merge"]);
  });

  it("never lets a variant prove an introduction", () => {
    const c = {
      id: "fixture-variant",
      entry: "start",
      scenes: {
        start: { ...story("A quiet road.", go("on", "merge")), variants: [{ when: { flag: "met_hessa" }, text: "Hessa's masks wave." }] },
        merge: story("The masks hum.", go("on", "done")),
        done: end(),
      },
    };
    const r = conceptSweep(c, /\bmasks\b/i, ["start"]);
    expect(r.variantOnly).toEqual(["start"]);
    expect(r.unproven).toEqual(["start"]);
    expect(r.leaks).toEqual(["merge"]);
  });

  it("names the merge points, ignoring scenes no party reaches", () => {
    expect(mergePoints(masks)).toEqual([{ scene: "merge", from: ["intro", "detour"] }]);
  });

  it("reaches nothing when the entry itself is removed", () => {
    expect(reachable(masks, new Set(["start"])).size).toBe(0);
  });
});

describe("setback routes", () => {
  it("flags a setback one ordinary failed roll can reach", () => {
    const c = {
      id: "fixture-roll",
      entry: "start",
      scenes: {
        start: story("Go.", go("on", "roll")),
        roll: check("Climb.", "won", "lost"),
        won: end(),
        lost: end("setback"),
      },
    };
    const [r] = setbackRoutes(c);
    expect(r).toMatchObject({ ending: "lost", scenes: 3, path: ["start", "roll", "lost"] });
    expect(r.failures).toEqual([{ scene: "roll", type: "check", tn: 12 }]);
    expect(r.gated).toBe(false);
    expect(r.ungatedFailures).toBe(1);
    expect(r.lastFailures).toEqual([{ scene: "roll", type: "check", tn: 12, firstFailure: "any" }]);
  });

  it("prefers fewer failures to fewer scenes, and sees a failure that needs another first", () => {
    const fight = (victory, defeat) => ({ type: "encounter", onVictory: { goto: victory }, onDefeat: { goto: defeat } });
    const c = {
      id: "fixture-fight",
      entry: "start",
      scenes: {
        start: story("Go.", go("short", "roll1"), go("long", "walk")),
        roll1: check("Jump.", "won", "roll2"),
        roll2: check("Jump again.", "won", "lost", 16),
        walk: story("A long walk.", go("on", "crabs")),
        crabs: fight("won", "lost"),
        won: end(),
        lost: end("setback"),
      },
    };
    const [r] = setbackRoutes(c);
    expect(r.failures).toEqual([{ scene: "crabs", type: "encounter", tn: null }]);
    expect(r.lastFailures).toEqual([
      { scene: "roll2", type: "check", tn: 16, firstFailure: false },
      { scene: "crabs", type: "encounter", tn: null, firstFailure: "any" },
    ]);
  });

  it("marks a route that needs a gated shortcut, and counts the route without it", () => {
    // Only a dwarf skips the first climb; everyone else must fail twice.
    const c = {
      id: "fixture-gated",
      entry: "start",
      scenes: {
        start: story("Go.", { ...go("tunnel", "roll2", "Take the dwarf tunnel"), requiresSpecies: "dwarf" }, go("climb", "roll1")),
        roll1: check("Climb.", "won", "roll2"),
        roll2: check("Climb again.", "won", "lost"),
        won: end(),
        lost: end("setback"),
      },
    };
    const [r] = setbackRoutes(c);
    expect(r).toMatchObject({ path: ["start", "roll2", "lost"], gated: true, ungatedFailures: 2 });
    expect(r.lastFailures).toEqual([{ scene: "roll2", type: "check", tn: 12, firstFailure: "gated" }]);
  });

  it("reports an unreachable setback", () => {
    const c = { id: "fixture-none", entry: "start", scenes: { start: story("Go.", go("on", "won")), won: end(), lost: end("setback") } };
    expect(setbackRoutes(c)).toEqual([{ ending: "lost", failures: null, scenes: 0, path: [], gated: false, ungatedFailures: null, lastFailures: [] }]);
  });
});

describe("UK idioms", () => {
  it("reads player text, never ids", () => {
    const c = {
      id: "fixture-idioms",
      entry: "scene_biscuit_tin",
      scenes: {
        scene_biscuit_tin: story("Nan turns round with a biscuit. A round table.", go("crisps", "done", "Eat the crisps")),
        done: end(),
      },
    };
    expect(idioms(c).map((h) => `${h.field}:${h.word}`)).toEqual(["narration:turns round", "narration:biscuit", "narration:Nan", "choice crisps:crisps"]);
  });
});

describe("the opening", () => {
  it("puts the goal beside scene 1", () => {
    expect(opening(masks)).toEqual({ goal: "Find out who the masks are.", entry: "start", narration: "Two paths." });
  });
});

describe("every shipped chapter", () => {
  it("runs each mode without throwing", () => {
    const chapters = loadChapters("");
    expect(chapters.length).toBeGreaterThan(0);
    for (const c of chapters) {
      conceptSweep(c, /\bthe\b/i, [c.entry]);
      setbackRoutes(c);
      opening(c);
      idioms(c);
      mergePoints(c);
    }
    const lines = [];
    expect(main(["setbacks", "--chapter", ""], (l) => lines.push(l))).toBe(0);
    expect(main(["concept", "\\bmasks?\\b", "--chapter", "", "--introduced-by", "nowhere"], (l) => lines.push(l))).toBe(0);
    expect(main(["opening", "--chapter", ""], (l) => lines.push(l))).toBe(0);
    expect(main(["idioms", "--chapter", ""], (l) => lines.push(l))).toBe(0);
    expect(main(["merges", "--chapter", ""], (l) => lines.push(l))).toBe(0);
    expect(main([], (l) => lines.push(l))).toBe(1);
  });
});
