// @vitest-environment jsdom
/**
 * ChapterGoal (#356): the goal is on screen the whole chapter with nothing to tap, and a step
 * ticks the moment its flag is set. A tick seen happening gets its moment (and, on the shared
 * screen, the chime); a screen that arrives mid-chapter shows what is done without one.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { FOLDS_KEY } from "../ui/Collapsible";
import type { Chapter, RunState } from "@kad/shared";
import { setAudioSink } from "../audio/cue";
import { useGameStore } from "../store";
import { ChapterGoalCard, TICK_MOMENT_MS } from "./ChapterGoal";
import { PlayerShell } from "../layout/landscape";

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
  localStorage.removeItem(FOLDS_KEY);
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
    render(<ChapterGoalCard place="world" />);
    expect(ticked()).toEqual([false, true, false]);
    expect(screen.getAllByRole("img", { name: "Not yet" })).toHaveLength(2);
    expect(screen.getByRole("img", { name: "Done" })).toBeTruthy();
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

  describe("optional steps (07l's ledger, chord and true answer)", () => {
    const TETHER = {
      ...CHAPTER,
      goal: {
        text: "Gather the ledger, the chord and a true answer, then hold the stone's hum at the bend.",
        steps: [
          { id: "ledger", label: "Borrow the wardens' ledger", item: "tether_ledger", optional: true },
          { id: "chord", label: "Learn the choir's three notes", item: "tether_chord", optional: true },
          { id: "answer", label: "Find a true answer", item: "tether_question", optional: true },
          { id: "bend", label: "Face the stone's hum at the bend", flag: "faced_the_bend" },
        ],
      },
    } as Chapter;

    it("names the next required step, never an extra the party may be long past", () => {
      // The ledger was missed and the party has moved on: what a short pane names is the bend.
      seed({});
      useGameStore.setState({ chapter: TETHER });
      render(<ChapterGoalCard place="world" />);
      const next = document.querySelector(".goal__step[data-next]");
      expect(next?.textContent).toContain("Face the stone's hum at the bend");
      expect(document.querySelectorAll(".goal__step[data-next]")).toHaveLength(1);
    });

    it("is done when the required step is, with every extra missed, and counts the extras apart", () => {
      seed({ faced_the_bend: true }, { phase: "chapter_complete" });
      useGameStore.setState({ chapter: TETHER });
      render(<ChapterGoalCard place="world" />);
      expect(document.querySelector(".goal")?.classList.contains("goal--all")).toBe(true);
      expect(screen.getByRole("img", { name: "1 of 1 done, 0 of 3 extras" })).toBeTruthy();
      // Nothing is left to name as next.
      expect(document.querySelector(".goal__step[data-next]")).toBeNull();
      expect(document.querySelectorAll(".goal__pip--optional")).toHaveLength(3);
    });
  });

  it("folds to the goal and its pips in a fight", () => {
    seed({ found_ladder: true });
    render(<ChapterGoalCard place="world" folded />);
    expect(screen.getByText("Get the cat down from the tree.")).toBeTruthy();
    expect(screen.getByRole("img", { name: "1 of 2 done, 0 of 1 extras" })).toBeTruthy();
    expect(document.querySelectorAll(".goal__step")).toHaveLength(0);
  });

  describe("on a phone (playtest: the card in full took too much of the screen)", () => {
    const toggle = () => screen.getByRole("button", { name: /Get the cat down from the tree\./ });

    it("is one line, the goal and how much is done, until the kid opens it", () => {
      seed({ found_ladder: true });
      render(<ChapterGoalCard place="phone" />);
      // Still on screen with nothing tapped: the goal's words and its progress are the line.
      expect(screen.getByText("Get the cat down from the tree.")).toBeTruthy();
      expect(screen.getByRole("img", { name: "1 of 2 done, 0 of 1 extras" })).toBeTruthy();
      expect(document.querySelector(".goal")?.classList.contains("goal--closed")).toBe(true);
      expect(toggle().getAttribute("aria-expanded")).toBe("false");
      // The steps are there, ticked as they are, and folded away.
      const steps = document.getElementById(toggle().getAttribute("aria-controls") ?? "");
      expect(steps?.classList.contains("goal__steps")).toBe(true);
      expect(steps?.hidden).toBe(true);
      expect(ticked()).toEqual([true, false, false]);
      expect(screen.queryByRole("img", { name: "Not yet" })).toBeNull();

      act(() => toggle().click());
      expect(toggle().getAttribute("aria-expanded")).toBe("true");
      expect(steps?.hidden).toBe(false);
      expect(screen.getAllByRole("img", { name: "Not yet" })).toHaveLength(2);
      expect(document.querySelector(".goal")?.classList.contains("goal--open")).toBe(true);
    });

    it("remembers on this device whether it was left open", () => {
      seed({});
      const { unmount } = render(<ChapterGoalCard place="phone" />);
      act(() => toggle().click());
      unmount();
      render(<ChapterGoalCard place="phone" />);
      expect(toggle().getAttribute("aria-expanded")).toBe("true");
    });

    it("has nothing to tap in a fight, and the TV never folds", () => {
      seed({});
      render(<ChapterGoalCard place="phone" folded />);
      expect(document.querySelector("button")).toBeNull();
      cleanup();
      localStorage.setItem(FOLDS_KEY, JSON.stringify({ goal: false }));
      render(<ChapterGoalCard place="world" />);
      expect(document.querySelector("button")).toBeNull();
      expect(document.querySelector(".goal__steps")?.hasAttribute("hidden")).toBe(false);
    });
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

describe("the chapter's goal on a phone held sideways", () => {
  function sideways(): void {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query.includes("max-height: 559px"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })));
  }
  afterEach(() => vi.unstubAllGlobals());

  it("is an icon with the steps done, and a tap opens the steps over the world", () => {
    sideways();
    seed({ found_ladder: true });
    render(<PlayerShell.Provider value><ChapterGoalCard place="world" /></PlayerShell.Provider>);
    const icon = screen.getByRole("button", { name: /your goal, 1 of 2 done/i });
    expect(icon.textContent).toBe("1/2");
    expect(icon.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Find a ladder")).toBeNull();
    act(() => icon.click());
    expect(screen.getByText("Get the cat down from the tree.")).toBeTruthy();
    expect(screen.getByText("Find a ladder")).toBeTruthy();
    expect(icon.getAttribute("aria-expanded")).toBe("true");
    act(() => icon.click());
    expect(screen.queryByText("Find a ladder")).toBeNull();
  });

  it("follows a phone turning, in the same mounted card", () => {
    // A matchMedia that can turn: upright first, then sideways, then upright again.
    let turned = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      get matches() { return turned && query.includes("max-height: 559px"); },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })));
    const turn = (to: boolean): void => {
      act(() => {
        turned = to;
        for (const fn of listeners) fn();
      });
    };
    seed({});
    render(<PlayerShell.Provider value><ChapterGoalCard place="world" /></PlayerShell.Provider>);
    expect(screen.queryByRole("button", { name: /your goal/i })).toBeNull();
    expect(screen.getByText("Find a ladder")).toBeTruthy();
    turn(true);
    expect(screen.getByRole("button", { name: /your goal, 0 of 2 done/i })).toBeTruthy();
    expect(screen.queryByText("Find a ladder")).toBeNull();
    turn(false);
    expect(screen.queryByRole("button", { name: /your goal/i })).toBeNull();
    expect(screen.getByText("Find a ladder")).toBeTruthy();
  });

  it("gives the hero's own pane its line back", () => {
    sideways();
    seed({});
    const { container } = render(<PlayerShell.Provider value><ChapterGoalCard place="phone" /></PlayerShell.Provider>);
    expect(container.textContent).toBe("");
  });

  it("stays the plain card, with nothing to tap, on the shared screen at the same size", () => {
    sideways();
    seed({});
    const { container } = render(<ChapterGoalCard place="world" />);
    expect(container.querySelector("button")).toBeNull();
    expect(screen.getByText("Find a ladder")).toBeTruthy();
  });
});
