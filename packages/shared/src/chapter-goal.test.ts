import { describe, expect, it } from "vitest";
import { goalProgress, stepsOffTheSpine } from "./chapter-goal.js";
import type { Chapter, ChapterGoal } from "./types/chapter.js";

const goal: ChapterGoal = {
  text: "Get the cat down.",
  steps: [
    { id: "ladder", label: "Find a ladder", flag: "found_ladder" },
    { id: "climb", label: "Climb up", flag: ["climbed_left", "climbed_right"] },
  ],
};

/** entry → a check (either branch) → a fork → one ending, and a setback off the fork. */
function chapter(patch: (scenes: Record<string, unknown>) => void = () => {}): Chapter {
  const scenes: Record<string, unknown> = {
    start: { type: "story", narration: "A cat.", choices: [{ id: "go", label: "Go", icon: "forward", goto: "shed" }] },
    shed: {
      type: "check",
      prompt: "Search the shed",
      stat: "clever",
      tn: 8,
      onSuccess: { goto: "fork", narration: "A ladder!", effects: [{ type: "setFlag", flag: "found_ladder" }] },
      onFailure: { goto: "fork", narration: "A wobbly ladder.", effects: [{ type: "setFlag", flag: "found_ladder" }] },
    },
    fork: {
      type: "story",
      narration: "Which side?",
      choices: [
        { id: "left", label: "Left", icon: "back", goto: "left", effects: [{ type: "setFlag", flag: "climbed_left" }] },
        { id: "right", label: "Right", icon: "forward", goto: "right" },
        { id: "give_up", label: "Give up", icon: "rest", goto: "gave_up" },
      ],
    },
    left: { type: "story", narration: "Up.", choices: [{ id: "on", label: "On", icon: "forward", goto: "end" }] },
    right: {
      type: "story",
      narration: "Up.",
      onEnter: [{ type: "setFlag", flag: "climbed_right" }],
      choices: [{ id: "on", label: "On", icon: "forward", goto: "end" }],
    },
    end: { type: "rest", narration: "Cat.", choices: [] },
    gave_up: { type: "rest", narration: "No cat.", choices: [], outcome: "setback" },
  };
  patch(scenes);
  return {
    id: "cat",
    campaignId: "c",
    index: 1,
    title: "Cat",
    biome: "plains",
    estimatedMinutes: 30,
    xpAward: 100,
    entry: "start",
    scenes,
    goal,
  } as unknown as Chapter;
}

describe("goalProgress", () => {
  it("ticks a step when its flag, or any of its flags, is set", () => {
    expect(goalProgress(goal, { flags: {} })).toEqual([false, false]);
    expect(goalProgress(goal, { flags: { found_ladder: true } })).toEqual([true, false]);
    expect(goalProgress(goal, { flags: { found_ladder: true, climbed_right: true } })).toEqual([true, true]);
    expect(goalProgress(goal, { flags: { found_ladder: false } })).toEqual([false, false]);
  });

  it("ticks an item step while anybody holds the item", () => {
    const withItem: ChapterGoal = { ...goal, steps: [{ id: "cat", label: "Hold the cat", item: "cat_prop" }] };
    expect(goalProgress(withItem, { flags: {} })).toEqual([false]);
    expect(goalProgress(withItem, { flags: {}, held: new Set(["cat_prop"]) })).toEqual([true]);
  });
});

describe("stepsOffTheSpine", () => {
  it("passes a goal every road to a success ending ticks, one way or another", () => {
    expect(stepsOffTheSpine(chapter())).toEqual([]);
  });

  it("names a step only one branch of a check ticks, with an ending that proves it", () => {
    const off = stepsOffTheSpine(chapter((s) => ((s.shed as { onFailure: { effects: unknown[] } }).onFailure.effects = [])));
    expect(off).toEqual([{ stepId: "ladder", ending: "end" }]);
  });

  it("names a step one road skips, and leaves a setback ending out of it", () => {
    const off = stepsOffTheSpine(chapter((s) => delete (s.right as { onEnter?: unknown }).onEnter));
    expect(off).toEqual([{ stepId: "climb", ending: "end" }]);
  });

  it("counts a flag set false as unticking, and leaves optional steps alone", () => {
    const unset = chapter((s) => {
      (s.left as { onEnter?: unknown }).onEnter = [{ type: "setFlag", flag: "found_ladder", value: false }];
    });
    expect(stepsOffTheSpine(unset)).toEqual([{ stepId: "ladder", ending: "end" }]);
    const optional = { ...unset, goal: { ...goal, steps: [{ ...goal.steps[0]!, optional: true }, goal.steps[1]!] } };
    expect(stepsOffTheSpine(optional)).toEqual([]);
  });

  it("counts a quest item handed over on every road, never a bag item, and loses it to a takeItem", () => {
    const withItem = (patch: (scenes: Record<string, unknown>) => void) => {
      const c = chapter(patch);
      return { ...c, goal: { ...goal, steps: [goal.steps[0]!, { id: "cat", label: "Hold the cat", item: "cat_prop" }] } } as Chapter;
    };
    const grant = (type: string) => (s: Record<string, unknown>) => {
      (s.end as { onEnter?: unknown }).onEnter = undefined;
      (s.fork as { onEnter?: unknown }).onEnter = [{ type, itemId: "cat_prop" }];
    };
    expect(stepsOffTheSpine(withItem(grant("grantQuestItem")))).toEqual([]);
    expect(stepsOffTheSpine(withItem(grant("grantItem")))).toEqual([{ stepId: "cat", ending: "end" }]);
    expect(
      stepsOffTheSpine(withItem((s) => {
        grant("grantQuestItem")(s);
        (s.right as { onEnter: unknown[] }).onEnter.push({ type: "takeItem", itemId: ["cake", "cat_prop"] });
      })),
    ).toEqual([{ stepId: "cat", ending: "end" }]);
  });

  it("keeps a many-flag step ticked when one flag is cleared and another is surely set", () => {
    // The left road sets climbed_left; clearing climbed_right after it leaves the step ticked.
    const cleared = chapter((s) => {
      (s.left as { onEnter?: unknown }).onEnter = [{ type: "setFlag", flag: "climbed_right", value: false }];
    });
    expect(stepsOffTheSpine(cleared)).toEqual([]);
  });

  it("drops a many-flag step whose roads each set a different flag when either is cleared", () => {
    // The two roads tick it by different flags, so no one flag is sure at the end: clearing one may undo it.
    const merged = chapter((s) => {
      (s.end as { onEnter?: unknown }).onEnter = [{ type: "setFlag", flag: "climbed_left", value: false }];
    });
    expect(stepsOffTheSpine(merged)).toEqual([{ stepId: "climb", ending: "end" }]);
  });

  it("follows a loop back to the fork without losing what was ticked on the way", () => {
    const looped = chapter((s) => {
      (s.left as { choices: unknown[] }).choices.push({ id: "back", label: "Back", icon: "back", goto: "fork" });
    });
    expect(stepsOffTheSpine(looped)).toEqual([]);
  });
});
