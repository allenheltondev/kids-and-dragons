import { describe, expect, it } from "vitest";

import { reachableScenes, validateChapter, visibleChoices } from "./chapter-graph.js";
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
