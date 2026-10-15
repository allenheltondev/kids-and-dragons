import { describe, expect, it } from "vitest";

import { isGated, validateChapter } from "./chapter-graph.js";
import { mutuallyExclusive, unbackedCosts, unbackedSceneCharges, unknownTokens } from "./condition-lint.js";
import { makeChapter, makeItems } from "./test-fixtures.js";
import type { Chapter, StoryScene } from "./types/chapter.js";

const items = makeItems();

function codes(issues: { code: string }[]): string[] {
  return issues.map((i) => i.code);
}

function withShrine(patch: (scene: StoryScene) => void): Chapter {
  const chapter = makeChapter();
  const scene = chapter.scenes["scene_shrine"];
  if (scene?.type !== "story") throw new Error("fixture changed");
  patch(scene);
  return chapter;
}

describe("a `when` is a gate", () => {
  it("counts as gated, so an all-`when` scene is a dead end", () => {
    expect(isGated({ id: "c", label: "x", icon: "a", goto: "g", when: { notItem: "river_charm" } })).toBe(true);
    const chapter = withShrine((scene) => {
      for (const c of scene.choices) c.when = { partySize: { min: 1 } };
    });
    expect(codes(validateChapter(chapter, items))).toContain("DEAD_END");
  });
});

describe("a cost is a gate", () => {
  const base = { id: "c", label: "x", icon: "a", goto: "g" };

  it("accepts a take backed by requiresItem, when.item, or a matching count", () => {
    expect(unbackedCosts({ ...base, requiresItem: "honeycake", effects: [{ type: "takeItem", itemId: "honeycake" }] })).toEqual([]);
    expect(unbackedCosts({ ...base, when: { item: "honeycake" }, effects: [{ type: "takeItem", itemId: "honeycake" }] })).toEqual([]);
    expect(
      unbackedCosts({
        ...base,
        when: { count: { of: ["supper_bundle", "honeycake"], min: 1 } },
        effects: [{ type: "takeItem", itemId: ["supper_bundle", "honeycake"] }],
      }),
    ).toEqual([]);
  });

  it("names a take or a spend the party is not promised to afford", () => {
    expect(unbackedCosts({ ...base, effects: [{ type: "takeItem", itemId: "honeycake" }] })).toHaveLength(1);
    expect(
      unbackedCosts({
        ...base,
        when: { count: { of: ["honeycake"], min: 1 } },
        effects: [{ type: "takeItem", itemId: ["supper_bundle", "honeycake"] }],
      }),
    ).toHaveLength(1);
    expect(unbackedCosts({ ...base, effects: [{ type: "spendCoins", amount: 2 }] })).toHaveLength(1);
    expect(unbackedCosts({ ...base, when: { coins: { min: 1 } }, effects: [{ type: "spendCoins", amount: 2 }] })).toHaveLength(1);
    expect(unbackedCosts({ ...base, when: { coins: { min: 2 } }, effects: [{ type: "spendCoins", amount: 2 }] })).toEqual([]);
  });

  it("counts a check's dearest outcome as a cost of every choice into it", () => {
    const chapter = makeChapter();
    const check = chapter.scenes["check_squeeze"];
    if (check?.type !== "check") throw new Error("fixture changed");
    check.onSuccess.effects = [{ type: "spendCoins", amount: 1 }];
    check.onFailure.effects = [{ type: "spendCoins", amount: 2 }];
    const entry = chapter.scenes[chapter.entry];
    if (entry?.type !== "story") throw new Error("fixture changed");
    const squeeze = entry.choices.find((c) => c.id === "squeeze")!;

    // Ungated, and gated too low: both are a free roll at the goods.
    expect(unbackedSceneCharges(chapter).map((p) => p.path)).toEqual([`/scenes/${chapter.entry}/choices/0`]);
    squeeze.when = { coins: { min: 1 } };
    expect(unbackedSceneCharges(chapter)).toHaveLength(1);
    squeeze.when = { coins: { min: 2 } };
    expect(unbackedSceneCharges(chapter)).toEqual([]);
    expect(codes(validateChapter(chapter, items))).not.toContain("UNBACKED_COST");
  });

  it("refuses a charging scene reached by a branch, which nothing can gate", () => {
    const chapter = makeChapter();
    const scratched = chapter.scenes["scene_scratched"];
    if (!scratched) throw new Error("fixture changed");
    scratched.onEnter = [{ type: "spendCoins", amount: 1 }];
    expect(unbackedSceneCharges(chapter).map((p) => p.path)).toContain("/scenes/check_squeeze/onFailure");
  });

  it("fails the chapter", () => {
    const chapter = withShrine((scene) => {
      scene.choices[0]!.effects = [{ type: "spendCoins", amount: 3 }];
    });
    expect(codes(validateChapter(chapter, items))).toContain("UNBACKED_COST");
  });
});

describe("unknownTokens", () => {
  it("accepts the engine's tokens and names every other brace", () => {
    expect(unknownTokens("{party} hold {facets} stones")).toEqual([]);
    expect(unknownTokens("{oops} and {oops} and {Party} and {}")).toEqual(["oops", "Party", ""]);
  });
});

describe("mutuallyExclusive", () => {
  it("recognises flag/notFlag, item/notItem, and disjoint ranges", () => {
    expect(mutuallyExclusive({ flag: "f" }, { notFlag: "f" })).toBe(true);
    expect(mutuallyExclusive({ notItem: "k" }, { item: "k" })).toBe(true);
    expect(mutuallyExclusive({ partySize: { max: 1 } }, { partySize: { min: 2 } })).toBe(true);
    expect(
      mutuallyExclusive({ count: { of: "facet_*", max: 0 } }, { count: { of: "facet_*", min: 1 } }),
    ).toBe(true);
  });

  it("refuses to guess otherwise", () => {
    expect(mutuallyExclusive({ flag: "f" }, { flag: "g" })).toBe(false);
    expect(mutuallyExclusive({}, { partySize: { min: 2 } })).toBe(false);
    expect(mutuallyExclusive({ count: { of: "a_*", max: 0 } }, { count: { of: "b_*", min: 1 } })).toBe(false);
    expect(mutuallyExclusive({ count: { of: "a_*", max: 1 } }, { count: { of: "a_*", min: 1 } })).toBe(false);
  });
});

describe("validateChapter on conditions, variants and tokens", () => {
  it("flags min above max on count and partySize", () => {
    const chapter = withShrine((scene) => {
      scene.variants = [
        { when: { count: { of: "river_*", min: 3, max: 1 } }, text: "a" },
        { when: { partySize: { min: 4, max: 2 } }, text: "b" },
      ];
    });
    expect(validateChapter(chapter, items).filter((i) => i.code === "BAD_CONDITION")).toHaveLength(2);
  });

  it("flags unknown tokens in narration, variants and labels, but not known ones", () => {
    const chapter = withShrine((scene) => {
      scene.narration = "{party} see {oops}.";
      scene.variants = [{ when: {}, text: "Holding {facets} stones, {nope}." }];
      scene.choices[0]!.label = "Go {bad}";
    });
    const msgs = validateChapter(chapter, items)
      .filter((i) => i.code === "BAD_CONDITION")
      .map((i) => i.message);
    expect(msgs).toHaveLength(3);
    expect(msgs.some((m) => m.includes("{party}") || m.includes("{facets}"))).toBe(false);
  });

  it("flags overlapping replace variants and allows provably exclusive ones", () => {
    const overlapping = withShrine((scene) => {
      scene.variants = [
        { when: { count: { of: "river_*", max: 1 } }, text: "a", replace: true },
        { when: { count: { of: "river_*", max: 2 } }, text: "b", replace: true },
      ];
    });
    expect(codes(validateChapter(overlapping, items))).toContain("BAD_CONDITION");
    const clean = withShrine((scene) => {
      scene.variants = [
        { when: { count: { of: "river_*", max: 0 } }, text: "a", replace: true },
        { when: { count: { of: "river_*", min: 1 } }, text: "b", replace: true },
      ];
    });
    expect(codes(validateChapter(clean, items))).not.toContain("BAD_CONDITION");
  });

  it("flags unknown items in a condition and a count prefix matching nothing", () => {
    const chapter = withShrine((scene) => {
      scene.variants = [
        { when: { item: "no_such_item" }, text: "a" },
        { when: { count: { of: "zzz_*", min: 1 } }, text: "b" },
        { when: { count: { of: "river_*", min: 1 } }, text: "ok" },
      ];
    });
    expect(validateChapter(chapter, items).filter((i) => i.code === "UNKNOWN_ITEM")).toHaveLength(2);
  });
});
