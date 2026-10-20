// @vitest-environment jsdom
/**
 * ChapterGoal (#356): the goal is on screen the whole chapter with nothing to tap, and a step
 * ticks the moment its flag is set. A tick seen happening gets its moment (and, on the shared
 * screen, the chime); a screen that arrives mid-chapter shows what is done without one.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Chapter, RunState } from "@kad/shared";
import { setAudioSink } from "../audio/cue";
import { useGameStore } from "../store";
import { ChapterGoalCard, TICK_MOMENT_MS } from "./ChapterGoal";

const CHAPTER = {
  id: "ch_1",
  campaignId: "c",
  index: 1,
  title: "The Cat",
  biome: "plains",
  estimatedMinutes: 30,
  xpAward: 100,
  entry: "s_1",
  scenes: {},
  goal: {
    text: "Get the cat down from the tree.",
    steps: [
      { id: "ladder", label: "Find a ladder", flag: "found_ladder" },
      { id: "climb", label: "Climb up", flag: ["climbed_left", "climbed_right"] },
      { id: "treat", label: "Bring a treat", flag: "brought_treat", optional: true },
    ],
  },
} as unknown as Chapter;

function seed(flags: Record<string, boolean>, overrides: Partial<RunState> = {}): void {
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "", mode: "party", sessionToken: "" },
    state: {
      runId: "r_1",
      roomCode: "ABCD",
      mode: "party",
      seq: 1,
      phase: "scene",
      campaignId: "c",
      chapterId: "ch_1",
      sceneId: "s_1",
      sceneType: "story",
      narration: "A cat.",
      art: null,
      party: [],
      prompt: null,
      lastRoll: null,
      flags,
      xpEarned: 0,
      updatedAt: "2026-10-20T18:00:00.000Z",
      ...overrides,
    } as RunState,
    chapter: CHAPTER,
    loadChapter: async () => undefined,
  });
}

const ticked = (): boolean[] =>
  [...document.querySelectorAll(".goal__step")].map((step) => step.getAttribute("data-done") === "true");

afterEach(() => {
  cleanup();
  setAudioSink(null);
  vi.useRealTimers();
});

describe("the chapter's goal", () => {
  it("shows the goal and every step, with nothing to open", () => {
    seed({});
    render(<ChapterGoalCard place="world" />);
    expect(screen.getByText("Get the cat down from the tree.")).toBeTruthy();
    for (const label of ["Find a ladder", "Climb up", "Bring a treat"]) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("(if you can)")).toBeTruthy();
    expect(ticked()).toEqual([false, false, false]);
    expect(document.querySelector("button")).toBeNull();
  });

  it("ticks a step when its flag is set, any of a list counting, and says so in words", () => {
    seed({ climbed_right: true });
    render(<ChapterGoalCard place="phone" />);
    expect(ticked()).toEqual([false, true, false]);
    expect(screen.getAllByText(", not yet")).toHaveLength(2);
    expect(screen.getByText(", done")).toBeTruthy();
    expect(document.querySelector(".goal__step[data-next]")?.textContent).toContain("Find a ladder");
  });

  it("gives a tick seen happening its moment and a chime, then lets it go", () => {
    vi.useFakeTimers();
    const played: string[] = [];
    setAudioSink({ cue: (id) => played.push(id), music: () => undefined });
    seed({});
    render(<ChapterGoalCard place="world" />);
    expect(document.querySelectorAll(".goal__step--fresh")).toHaveLength(0);

    act(() => seed({ found_ladder: true }));
    expect(ticked()).toEqual([true, false, false]);
    expect(document.querySelectorAll(".goal__step--fresh")).toHaveLength(1);
    expect(document.querySelectorAll(".goal__sparks")).toHaveLength(1);
    expect(played).toEqual(["gem-pickup"]);

    act(() => vi.advanceTimersByTime(TICK_MOMENT_MS + 10));
    expect(document.querySelectorAll(".goal__step--fresh")).toHaveLength(0);
    expect(ticked()).toEqual([true, false, false]);
  });

  it("celebrates nothing on a screen that arrives with steps already done, and the phone never chimes", () => {
    const played: string[] = [];
    setAudioSink({ cue: (id) => played.push(id), music: () => undefined });
    seed({ found_ladder: true });
    render(<ChapterGoalCard place="phone" />);
    expect(document.querySelectorAll(".goal__step--fresh")).toHaveLength(0);
    act(() => seed({ found_ladder: true, climbed_left: true }));
    expect(document.querySelectorAll(".goal__step--fresh")).toHaveLength(1);
    expect(played).toEqual([]);
  });

  it("ticks a step that watches an item when anybody in the party holds it", () => {
    const withItem = {
      ...CHAPTER,
      goal: { text: "Get the cat down.", steps: [{ id: "cat", label: "Hold the cat", item: "cat_prop" }, CHAPTER.goal!.steps[0]!] },
    } as Chapter;
    const member = (questItems: string[]) => ({ playerId: "p_1", hp: 5, down: false, connected: true, ready: false, character: { questItems, inventory: [] } });
    seed({}, { party: [member([])] as unknown as RunState["party"] });
    useGameStore.setState({ chapter: withItem });
    render(<ChapterGoalCard place="world" />);
    expect(ticked()).toEqual([false, false]);
    act(() => {
      seed({}, { party: [member(["cat_prop"])] as unknown as RunState["party"] });
      useGameStore.setState({ chapter: withItem });
    });
    expect(ticked()).toEqual([true, false]);
  });

  it("folds to the goal and its pips in a fight", () => {
    seed({ found_ladder: true });
    render(<ChapterGoalCard place="world" folded />);
    expect(screen.getByText("Get the cat down from the tree.")).toBeTruthy();
    expect(screen.getByRole("img", { name: "1 of 3 done" })).toBeTruthy();
    expect(document.querySelectorAll(".goal__step")).toHaveLength(0);
  });

  it("draws nothing for a chapter with no goal, or before the chapter has loaded", () => {
    seed({});
    useGameStore.setState({ chapter: null });
    const { container } = render(<ChapterGoalCard place="world" />);
    expect(container.innerHTML).toBe("");
    act(() => useGameStore.setState({ chapter: { ...CHAPTER, goal: undefined } }));
    expect(container.innerHTML).toBe("");
  });
});
