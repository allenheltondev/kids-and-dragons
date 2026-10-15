import { describe, expect, it } from "vitest";

import {
  countPartyItems,
  evaluateCondition,
  reachableScenes,
  validateChapter,
  visibleChoices,
} from "./chapter-graph.js";
import { resolveCharacter } from "./character.js";
import type { Chapter, Choice } from "./types/chapter.js";
import type { ResolvedCharacter } from "./types/domain.js";
import { makeChapter, makeCharacter, makeItems, makeRules } from "./test-fixtures.js";

const rules = makeRules();
const items = makeItems();

function codes(issues: { code: string }[]): string[] {
  return issues.map((i) => i.code);
}

describe("validateChapter", () => {
  it("passes a well-formed chapter with no issues at all", () => {
    expect(validateChapter(makeChapter(), items)).toEqual([]);
  });

  it("flags an unknown goto target", () => {
    const chapter = makeChapter();
    const scene = chapter.scenes["scene_shrine"];
    if (scene?.type !== "story") throw new Error("fixture changed");
    scene.choices[0]!.goto = "scene_nowhere";
    const issues = validateChapter(chapter, items);
    expect(codes(issues)).toContain("UNKNOWN_GOTO");
    expect(issues.find((i) => i.code === "UNKNOWN_GOTO")).toMatchObject({
      severity: "error",
      sceneId: "scene_shrine",
    });
  });

  it("flags a missing entry", () => {
    const chapter = { ...makeChapter(), entry: "" };
    expect(codes(validateChapter(chapter, items))).toContain("MISSING_ENTRY");
  });

  it("flags an entry that names a scene that doesn't exist", () => {
    const chapter = { ...makeChapter(), entry: "scene_ghost" };
    expect(codes(validateChapter(chapter, items))).toContain("UNKNOWN_ENTRY");
  });

  it("warns about scenes unreachable from entry", () => {
    const chapter = makeChapter();
    chapter.scenes["scene_orphan"] = {
      type: "story",
      narration: "Nobody comes here.",
      choices: [{ id: "back", label: "Back", icon: "arrow", goto: "scene_ending" }],
    };
    const issue = validateChapter(chapter, items).find((i) => i.code === "UNREACHABLE_SCENE");
    expect(issue).toMatchObject({ severity: "warning", sceneId: "scene_orphan" });
  });

  it("flags a scene whose every choice is gated — some party sees nothing to tap", () => {
    const chapter = makeChapter();
    const scene = chapter.scenes["scene_clearing"];
    if (scene?.type !== "story") throw new Error("fixture changed");
    scene.choices[0]!.requiresFlag = "has_lantern";
    const issue = validateChapter(chapter, items).find((i) => i.code === "DEAD_END");
    expect(issue).toMatchObject({ severity: "error", sceneId: "scene_clearing" });
  });

  it("treats a scene with no exits as the ending, not a dead end", () => {
    const issues = validateChapter(makeChapter(), items);
    expect(codes(issues)).not.toContain("DEAD_END");
    expect(codes(issues)).not.toContain("NO_ENDING");
  });

  it("warns when a chapter can never finish", () => {
    const chapter = makeChapter();
    const ending = chapter.scenes["scene_ending"];
    if (ending?.type !== "story") throw new Error("fixture changed");
    ending.choices = [{ id: "loop", label: "Again", icon: "arrow", goto: "scene_clearing" }];
    expect(codes(validateChapter(chapter, items))).toContain("NO_ENDING");
  });

  it("flags a check missing a branch — failure must continue the story", () => {
    const chapter = makeChapter();
    const scene = chapter.scenes["check_squeeze"];
    if (scene?.type !== "check") throw new Error("fixture changed");
    // @ts-expect-error — simulating a hand-edited chapter with a gap
    delete scene.onFailure;
    const issues = validateChapter(chapter, items);
    expect(codes(issues)).toContain("MISSING_BRANCH");
  });

  it("flags an encounter missing onDefeat — a wipe branches, it never ends the game", () => {
    const chapter = makeChapter();
    const scene = chapter.scenes["encounter_wisps"];
    if (scene?.type !== "encounter") throw new Error("fixture changed");
    // @ts-expect-error — simulating a hand-edited chapter with a gap
    delete scene.onDefeat;
    const issue = validateChapter(chapter, items).find((i) => i.code === "MISSING_BRANCH");
    expect(issue?.message).toMatch(/never ends the game/);
  });

  it("flags duplicate choice ids", () => {
    const chapter = makeChapter();
    const scene = chapter.scenes["scene_ridge"];
    if (scene?.type !== "choice_point") throw new Error("fixture changed");
    scene.choices[1]!.id = "high";
    expect(codes(validateChapter(chapter, items))).toContain("DUPLICATE_CHOICE_ID");
  });

  it("flags an unknown itemId in an effect", () => {
    const chapter = makeChapter();
    const scene = chapter.scenes["check_squeeze"];
    if (scene?.type !== "check") throw new Error("fixture changed");
    scene.onSuccess.effects = [{ type: "grantItem", itemId: "moon_cheese", to: "roller" }];
    expect(codes(validateChapter(chapter, items))).toContain("UNKNOWN_ITEM");
  });

  it("flags an unknown itemId in a choice requirement", () => {
    const chapter = makeChapter();
    const scene = chapter.scenes["scene_shrine"];
    if (scene?.type !== "story") throw new Error("fixture changed");
    scene.choices[0]!.requiresItem = "moon_cheese";
    expect(codes(validateChapter(chapter, items))).toContain("UNKNOWN_ITEM");
  });

  it("flags a quest item granted through the slot-consuming path", () => {
    const chapter = makeChapter();
    const scene = chapter.scenes["check_squeeze"];
    if (scene?.type !== "check") throw new Error("fixture changed");
    scene.onSuccess.effects = [{ type: "grantItem", itemId: "rusted_key", to: "roller" }];
    const issue = validateChapter(chapter, items).find((i) => i.code === "ITEM_KIND_MISMATCH");
    expect(issue?.message).toMatch(/must use grantQuestItem/);
  });

  it("skips item checks entirely when no catalog is supplied", () => {
    const chapter = makeChapter();
    const scene = chapter.scenes["check_squeeze"];
    if (scene?.type !== "check") throw new Error("fixture changed");
    scene.onSuccess.effects = [{ type: "grantItem", itemId: "moon_cheese", to: "roller" }];
    expect(codes(validateChapter(chapter))).not.toContain("UNKNOWN_ITEM");
  });

  it("reports an empty chapter and stops", () => {
    const chapter: Chapter = { ...makeChapter(), scenes: {} };
    expect(codes(validateChapter(chapter, items))).toEqual(["NO_SCENES"]);
  });
});

describe("reachableScenes", () => {
  it("walks every branch, including onDefeat", () => {
    const reachable = reachableScenes(makeChapter());
    expect(reachable.has("scene_scratched")).toBe(true);
    expect(reachable.has("scene_camp")).toBe(true);
    expect(reachable.size).toBe(Object.keys(makeChapter().scenes).length);
  });

  it("returns nothing when the entry is broken", () => {
    expect(reachableScenes({ ...makeChapter(), entry: "nope" }).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Species gating — architecture §5
// ---------------------------------------------------------------------------

function resolved(species: Parameters<typeof makeCharacter>[0]): ResolvedCharacter {
  return resolveCharacter(makeCharacter(species), rules, items);
}

const CHOICES: Choice[] = [
  { id: "squeeze", label: "Look for a gap", icon: "eye", goto: "a" },
  { id: "smash", label: "Force through", icon: "fist", requiresSpecies: "bigfoot", goto: "b" },
  {
    id: "over",
    label: "Go over it",
    icon: "wing",
    requiresSpecies: ["dragonling", "griffin"],
    goto: "c",
  },
  { id: "unlock", label: "Use the key", icon: "key", requiresItem: "rusted_key", goto: "d" },
  { id: "recall", label: "Remember the shrine", icon: "eye", requiresFlag: "found_shrine", goto: "e" },
];

describe("visibleChoices", () => {
  it("hides what nobody in the party can do — hidden, never disabled", () => {
    const party = { members: [resolved({ species: "unicorn" })] };
    expect(visibleChoices(CHOICES, party).map((c) => c.id)).toEqual(["squeeze"]);
  });

  it("shows a species choice when *anyone* in the party matches", () => {
    const party = {
      members: [resolved({ species: "unicorn" }), resolved({ id: "c_2", species: "griffin" })],
    };
    expect(visibleChoices(CHOICES, party).map((c) => c.id)).toEqual(["squeeze", "over"]);
  });

  it("accepts a single species as well as a list", () => {
    const party = { members: [resolved({ species: "bigfoot" })] };
    expect(visibleChoices(CHOICES, party).map((c) => c.id)).toEqual(["squeeze", "smash"]);
  });

  it("gates on flags", () => {
    const party = { members: [resolved({ species: "unicorn" })], flags: { found_shrine: true } };
    expect(visibleChoices(CHOICES, party).map((c) => c.id)).toEqual(["squeeze", "recall"]);
    expect(
      visibleChoices(CHOICES, { ...party, flags: { found_shrine: false } }).map((c) => c.id),
    ).toEqual(["squeeze"]);
  });

  it("gates on carried items, slotted or quest", () => {
    const withSlot = resolved({ inventory: [{ itemId: "rusted_key", kind: "trinket" }] });
    expect(visibleChoices(CHOICES, { members: [withSlot] }).map((c) => c.id)).toContain("unlock");

    const questHolder = resolved({});
    questHolder.questItems = ["rusted_key"];
    expect(visibleChoices(CHOICES, { members: [questHolder] }).map((c) => c.id)).toContain(
      "unlock",
    );
  });

  it("never mutates or reorders the authored list", () => {
    const party = { members: [resolved({ species: "unicorn" })] };
    const before = [...CHOICES];
    visibleChoices(CHOICES, party);
    expect(CHOICES).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Conditions — `when` on choices (#158)
// ---------------------------------------------------------------------------

describe("evaluateCondition", () => {
  /** A member carrying exactly these slotted and quest items. */
  function holding(id: string, slotted: string[], quest: string[] = []): ResolvedCharacter {
    const member = resolved({ id });
    member.inventory = slotted.map((itemId) => ({ itemId, kind: "trinket" as const }));
    member.questItems = [...quest];
    return member;
  }

  const solo = (slotted: string[] = [], quest: string[] = [], flags: Record<string, boolean> = {}) => ({
    members: [holding("c_1", slotted, quest)],
    flags,
  });

  const seats = (n: number) => ({
    members: Array.from({ length: n }, (_, i) => holding(`c_${i + 1}`, [])),
  });

  it("coins bounds read the party purse, and no purse is an empty one", () => {
    const purse = (coins: number) => ({ ...solo(), coins });
    expect(evaluateCondition({ coins: { min: 3 } }, purse(3))).toBe(true);
    expect(evaluateCondition({ coins: { min: 3 } }, purse(2))).toBe(false);
    expect(evaluateCondition({ coins: { max: 0 } }, purse(0))).toBe(true);
    expect(evaluateCondition({ coins: { min: 1 } }, solo())).toBe(false);
  });

  it("holds for an absent or empty condition", () => {
    expect(evaluateCondition(undefined, solo())).toBe(true);
    expect(evaluateCondition({}, solo())).toBe(true);
  });

  it("flag holds only when the flag is set true", () => {
    expect(evaluateCondition({ flag: "crossing" }, solo([], [], { crossing: true }))).toBe(true);
    expect(evaluateCondition({ flag: "crossing" }, solo([], [], { crossing: false }))).toBe(false);
    expect(evaluateCondition({ flag: "crossing" }, solo())).toBe(false);
    // No flags record at all is the same as none set.
    expect(evaluateCondition({ flag: "crossing" }, { members: [] })).toBe(false);
  });

  it("notFlag holds when the flag is unset or false", () => {
    expect(evaluateCondition({ notFlag: "crossing" }, solo())).toBe(true);
    expect(evaluateCondition({ notFlag: "crossing" }, solo([], [], { crossing: false }))).toBe(true);
    expect(evaluateCondition({ notFlag: "crossing" }, solo([], [], { crossing: true }))).toBe(false);
  });

  it("item holds when anyone carries it, slotted or quest", () => {
    expect(evaluateCondition({ item: "rusted_key" }, solo(["rusted_key"]))).toBe(true);
    expect(evaluateCondition({ item: "rusted_key" }, solo([], ["rusted_key"]))).toBe(true);
    expect(evaluateCondition({ item: "rusted_key" }, solo(["lantern"]))).toBe(false);
    const pair = { members: [holding("c_1", []), holding("c_2", [], ["rusted_key"])] };
    expect(evaluateCondition({ item: "rusted_key" }, pair)).toBe(true);
  });

  it("notItem holds when nobody carries it", () => {
    expect(evaluateCondition({ notItem: "rusted_key" }, solo())).toBe(true);
    expect(evaluateCondition({ notItem: "rusted_key" }, solo([], ["rusted_key"]))).toBe(false);
    const pair = { members: [holding("c_1", []), holding("c_2", ["rusted_key"])] };
    expect(evaluateCondition({ notItem: "rusted_key" }, pair)).toBe(false);
  });

  describe("count", () => {
    const facets = (n: number) => solo([], Array.from({ length: n }, (_, i) => `facet_${i}`));

    it("min: holds at the bound and above, fails one below", () => {
      const cond = { count: { of: "facet_*", min: 2 } };
      expect(evaluateCondition(cond, facets(1))).toBe(false);
      expect(evaluateCondition(cond, facets(2))).toBe(true);
      expect(evaluateCondition(cond, facets(3))).toBe(true);
    });

    it("max: holds at the bound and below, fails one above", () => {
      const cond = { count: { of: "facet_*", max: 2 } };
      expect(evaluateCondition(cond, facets(1))).toBe(true);
      expect(evaluateCondition(cond, facets(2))).toBe(true);
      expect(evaluateCondition(cond, facets(3))).toBe(false);
    });

    it("min and max together bound a range", () => {
      const cond = { count: { of: "facet_*", min: 2, max: 3 } };
      expect([1, 2, 3, 4].map((n) => evaluateCondition(cond, facets(n)))).toEqual([
        false,
        true,
        true,
        false,
      ]);
    });

    it("max: 0 means has none", () => {
      const cond = { count: { of: "facet_*", max: 0 } };
      expect(evaluateCondition(cond, facets(0))).toBe(true);
      expect(evaluateCondition(cond, facets(1))).toBe(false);
    });

    it("a prefix ending in * matches by prefix only", () => {
      const party = solo(["lantern"], ["facet_ember", "facet_ford", "facetless", "ember_facet"]);
      expect(countPartyItems(party, "facet_*")).toBe(2);
      expect(evaluateCondition({ count: { of: "facet_*", min: 2, max: 2 } }, party)).toBe(true);
    });

    it("an exact id counts 0 or 1", () => {
      expect(countPartyItems(solo([], ["facet_ember"]), "facet_ember")).toBe(1);
      expect(countPartyItems(solo([], ["facet_ember"]), "facet_ford")).toBe(0);
      expect(evaluateCondition({ count: { of: "facet_ember", min: 1 } }, solo(["facet_ember"]))).toBe(true);
    });

    it("a list counts the listed ids the party holds", () => {
      const party = solo(["lantern"], ["facet_ember", "facet_glade"]);
      expect(countPartyItems(party, ["facet_ember", "facet_ford", "lantern"])).toBe(2);
      expect(evaluateCondition({ count: { of: ["facet_ember", "facet_ford"], min: 2 } }, party)).toBe(false);
      expect(evaluateCondition({ count: { of: ["facet_ember", "lantern"], min: 2 } }, party)).toBe(true);
      // A duplicated id in the list is still one item.
      expect(countPartyItems(party, ["facet_ember", "facet_ember"])).toBe(1);
    });

    it("counts an item two members hold, or one member holds twice, once", () => {
      const party = {
        members: [
          holding("c_1", ["lantern", "lantern"], ["facet_ember"]),
          holding("c_2", ["lantern"], ["facet_ember"]),
        ],
      };
      expect(countPartyItems(party, "facet_*")).toBe(1);
      expect(countPartyItems(party, "lantern")).toBe(1);
      expect(countPartyItems(party, "*")).toBe(2);
      expect(evaluateCondition({ count: { of: "facet_*", min: 2 } }, party)).toBe(false);
    });
  });

  describe("partySize", () => {
    it("min: both sides of the bound", () => {
      expect(evaluateCondition({ partySize: { min: 3 } }, seats(2))).toBe(false);
      expect(evaluateCondition({ partySize: { min: 3 } }, seats(3))).toBe(true);
    });

    it("max: both sides of the bound", () => {
      expect(evaluateCondition({ partySize: { max: 1 } }, seats(1))).toBe(true);
      expect(evaluateCondition({ partySize: { max: 1 } }, seats(2))).toBe(false);
    });
  });

  it("ANDs every field present", () => {
    const party = solo([], ["facet_ember"], { crossing: true });
    expect(evaluateCondition({ flag: "crossing", item: "facet_ember", partySize: { max: 1 } }, party)).toBe(true);
    expect(evaluateCondition({ flag: "crossing", item: "facet_ford" }, party)).toBe(false);
    expect(evaluateCondition({ flag: "crossing", notFlag: "crossing" }, party)).toBe(false);
    expect(evaluateCondition({ item: "facet_ember", count: { of: "facet_*", min: 2 } }, party)).toBe(false);
  });
});

describe("visibleChoices with `when`", () => {
  const GATED: Choice[] = [
    { id: "on", label: "Go on", icon: "arrow", goto: "a" },
    { id: "two", label: "Set two stones", icon: "gem", goto: "b", when: { count: { of: "facet_*", min: 2 } } },
    { id: "none", label: "Empty-handed", icon: "hand", goto: "c", when: { count: { of: "facet_*", max: 0 } } },
    // `when` is checked on top of the requires* gates, never instead of them.
    {
      id: "both",
      label: "Both",
      icon: "eye",
      goto: "d",
      requiresFlag: "found_shrine",
      when: { partySize: { min: 2 } },
    },
  ];

  it("hides a choice whose condition fails, and keeps authored order", () => {
    const member = resolved({});
    expect(visibleChoices(GATED, { members: [member] }).map((c) => c.id)).toEqual(["on", "none"]);
    member.questItems = ["facet_ember", "facet_ford"];
    expect(visibleChoices(GATED, { members: [member] }).map((c) => c.id)).toEqual(["on", "two"]);
  });

  it("requires both the requires* gate and the condition", () => {
    const one = { members: [resolved({})], flags: { found_shrine: true } };
    expect(visibleChoices(GATED, one).map((c) => c.id)).not.toContain("both");
    const two = { members: [resolved({}), resolved({ id: "c_2" })], flags: {} };
    expect(visibleChoices(GATED, two).map((c) => c.id)).not.toContain("both");
    expect(visibleChoices(GATED, { ...two, flags: { found_shrine: true } }).map((c) => c.id)).toContain("both");
  });
});
