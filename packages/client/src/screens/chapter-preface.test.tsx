// @vitest-environment jsdom
/**
 * ChapterPreface (#357): "Last time…" before a chapter's first scene, and "Where you left off"
 * for a screen that comes back partway. Nothing is tapped: each goes away by itself, or when
 * play moves on.
 *
 * And the order the shared screen reads a chapter's start in, which NarrationPanel owns:
 * "Last time…", then "Your goal: …", then the first scene's story, and the goal never twice.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { setSpeaker } from "@kad/shared";
import type { Campaign, Chapter, PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { useGameStore } from "../store";
import { ChapterPreface, PREFACE_WAIT_MS, prefaceShowMs, resetPrefaceCampaigns } from "./ChapterPreface";
import { NarrationPanel } from "./NarrationPanel";

const CAMPAIGN = {
  id: "c",
  title: "The Walk",
  blurb: "A walk.",
  chapters: ["ch_1", "ch_2"],
  routeSets: { road: ["road_hill", "road_lake"] },
  lastTime: {
    opener: "A walk begins, and the sky is the wrong color.",
    lines: { road_hill: "You went up the hill, puffing.", road_lake: "You went round the lake." },
  },
} as Campaign;

const CHAPTER = {
  id: "ch_2",
  campaignId: "c",
  index: 2,
  title: "The Cat",
  biome: "plains",
  estimatedMinutes: 30,
  xpAward: 100,
  entry: "s_1",
  scenes: {
    s_1: { type: "story", narration: "A cat is up a tree.", choices: [] },
    s_2: { type: "story", narration: "The ladder wobbles. It is a very old ladder.", choices: [] },
    s_3: { type: "story", narration: "A dog barks at the ladder.", choices: [] },
    s_4: { type: "story", narration: "You are nearly there.", choices: [] },
  },
  goal: {
    text: "Get the cat down from the tree.",
    steps: [
      { id: "ladder", label: "Find a ladder", flag: "found_ladder" },
      { id: "climb", label: "Climb up", flag: "climbed" },
    ],
  },
} as unknown as Chapter;

function hero(playerId: string, name: string, connected = true): PartyMember {
  const character = { id: `c_${playerId}`, ownerPlayerId: playerId, name, inventory: [], questItems: [] } as unknown as ResolvedCharacter;
  return { character, playerId, hp: 10, down: false, connected, ready: true };
}

function run(overrides: Partial<RunState> = {}): RunState {
  return {
    runId: "r_1",
    roomCode: "ABCD",
    mode: "party",
    seq: 1,
    phase: "scene",
    campaignId: "c",
    chapterId: "ch_2",
    sceneId: "s_1",
    sceneType: "story",
    narration: "A cat is up a tree.",
    art: null,
    party: [hero("p_1", "Sam")],
    prompt: null,
    lastRoll: null,
    flags: { road_lake: true },
    xpEarned: 0,
    visited: ["s_1"],
    updatedAt: "2026-10-21T18:00:00.000Z",
    ...overrides,
  } as RunState;
}

function seed(state: RunState, content: { chapter?: Chapter | null; campaign?: Campaign | null } = {}): void {
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "", mode: "party", sessionToken: "" },
    state,
    chapter: content.chapter === undefined ? CHAPTER : content.chapter,
    campaign: content.campaign === undefined ? CAMPAIGN : content.campaign,
    loadChapter: async () => undefined,
  });
}

let spoken: string[] = [];
beforeEach(() => {
  spoken = [];
  setSpeaker((text) => spoken.push(text));
  resetPrefaceCampaigns();
});
afterEach(() => {
  cleanup();
  setSpeaker(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Last time…, before a chapter's first scene", () => {
  it("shows the carried road's line and ends with the goal", () => {
    seed(run());
    render(<ChapterPreface />);
    const card = screen.getByTestId("chapter-preface");
    expect(card.dataset.kind).toBe("start");
    expect(card.textContent).toContain("Last time…");
    expect(card.textContent).toContain("You went round the lake.");
    expect(card.textContent).not.toContain("up the hill");
    expect(card.querySelector(".preface__goal")?.textContent).toBe("Your goal: Get the cat down from the tree.");
  });

  it("gives a party carrying nothing the opener", () => {
    seed(run({ flags: {} }));
    render(<ChapterPreface />);
    const card = screen.getByTestId("chapter-preface");
    expect(card.textContent).toContain("Here we go!");
    expect(card.textContent).toContain("A walk begins");
  });

  it("goes away by itself, and at once when the story moves on", () => {
    vi.useFakeTimers();
    seed(run());
    render(<ChapterPreface />);
    expect(screen.queryByTestId("chapter-preface")).not.toBeNull();
    act(() => vi.advanceTimersByTime(prefaceShowMs(40, "start")));
    expect(screen.queryByTestId("chapter-preface")).toBeNull();

    cleanup();
    seed(run());
    render(<ChapterPreface />);
    expect(screen.queryByTestId("chapter-preface")).not.toBeNull();
    act(() => useGameStore.setState({ state: run({ sceneId: "s_2", visited: ["s_1", "s_2"], narration: "The ladder wobbles." }) }));
    expect(screen.queryByTestId("chapter-preface")).toBeNull();
  });

  it("never comes up after the wait has run out, however soon the files land (#378 review)", () => {
    vi.useFakeTimers();
    seed(run(), { chapter: null });
    render(<ChapterPreface />);
    expect(screen.queryByTestId("chapter-preface")).toBeNull();
    act(() => vi.advanceTimersByTime(PREFACE_WAIT_MS));
    act(() => useGameStore.setState({ chapter: CHAPTER }));
    expect(screen.queryByTestId("chapter-preface")).toBeNull();
  });

  it("is not shown for a campaign without one, nor past the first scene", () => {
    seed(run(), { campaign: { ...CAMPAIGN, lastTime: undefined } });
    render(<ChapterPreface />);
    expect(screen.queryByTestId("chapter-preface")).toBeNull();
  });
});

describe("the read-aloud order at a chapter's start", () => {
  it("says Last time, then the goal, then the story, and the goal only once", () => {
    seed(run());
    render(<NarrationPanel />);
    expect(spoken).toEqual(["Last time… You went round the lake.", "Your goal: Get the cat down from the tree.", "A cat is up a tree."]);
  });

  it("waits for the files, never longer than PREFACE_WAIT_MS, so nothing jumps the queue", () => {
    vi.useFakeTimers();
    seed(run(), { chapter: null });
    render(<NarrationPanel />);
    expect(spoken).toEqual([]);
    act(() => useGameStore.setState({ chapter: CHAPTER }));
    expect(spoken).toEqual(["Last time… You went round the lake.", "Your goal: Get the cat down from the tree.", "A cat is up a tree."]);
  });

  it("reads the story alone, then #356's goal after it, when the files are too slow", () => {
    vi.useFakeTimers();
    seed(run(), { chapter: null });
    render(<NarrationPanel />);
    act(() => vi.advanceTimersByTime(PREFACE_WAIT_MS));
    expect(spoken).toEqual(["A cat is up a tree."]);
    act(() => useGameStore.setState({ chapter: CHAPTER }));
    expect(spoken).toEqual(["A cat is up a tree.", "Your goal: Get the cat down from the tree."]);
    // And the files landing late never starts the preface after the story.
    act(() => vi.advanceTimersByTime(1000));
    expect(spoken).toEqual(["A cat is up a tree.", "Your goal: Get the cat down from the tree."]);
  });

  it("keeps #356's order for a campaign with no Last time: the story, then the goal", () => {
    seed(run(), { campaign: { ...CAMPAIGN, lastTime: undefined } });
    render(<NarrationPanel />);
    expect(spoken).toEqual(["A cat is up a tree.", "Your goal: Get the cat down from the tree."]);
  });

  it("says nothing of it mid-chapter", () => {
    seed(run({ sceneId: "s_2", visited: ["s_1", "s_2"], narration: "The ladder wobbles." }));
    render(<NarrationPanel />);
    expect(spoken).toEqual(["The ladder wobbles."]);
  });
});

describe("Where you left off, for a screen that comes back partway", () => {
  const partway = (overrides: Partial<RunState> = {}): RunState =>
    run({ sceneId: "s_4", visited: ["s_1", "s_2", "s_3", "s_4"], narration: "You are nearly there.", flags: { found_ladder: true }, ...overrides });

  it("shows the goal, the steps ticked so far, and a line from each of the last scenes", () => {
    seed(partway());
    render(<ChapterPreface />);
    const card = screen.getByTestId("chapter-preface");
    expect(card.dataset.kind).toBe("back");
    expect(card.textContent).toContain("Where you left off");
    expect(card.textContent).toContain("Get the cat down from the tree.");
    const steps = [...card.querySelectorAll(".goal__step")].map((step) => step.getAttribute("data-done"));
    expect(steps).toEqual(["true", "false"]);
    const trail = [...card.querySelectorAll(".preface__lines--trail li")].map((li) => li.textContent);
    expect(trail).toEqual(["A cat is up a tree.", "The ladder wobbles.", "A dog barks at the ladder."]);
    // Shown, never read: the story the table is in is what the voice is for.
    expect(spoken.join(" ")).not.toContain("Where you left off");
  });

  it("comes up on a screen watching when a seat comes back, and goes when play moves on", () => {
    seed(partway({ party: [hero("p_1", "Sam"), hero("p_2", "Rosie", false)] }));
    render(<ChapterPreface />);
    // The first look already showed it; play moving on puts it away.
    act(() => useGameStore.setState({ state: partway({ sceneId: "s_3", visited: ["s_1", "s_2", "s_3", "s_4", "s_3"], party: [hero("p_1", "Sam"), hero("p_2", "Rosie", false)] }) }));
    expect(screen.queryByTestId("chapter-preface")).toBeNull();
    // Rosie's phone comes back.
    act(() => useGameStore.setState({ state: partway({ sceneId: "s_3", visited: ["s_1", "s_2", "s_3", "s_4", "s_3"], party: [hero("p_1", "Sam"), hero("p_2", "Rosie")] }) }));
    expect(screen.getByTestId("chapter-preface").dataset.kind).toBe("back");
  });

  it("goes away by itself", () => {
    vi.useFakeTimers();
    seed(partway());
    render(<ChapterPreface />);
    expect(screen.queryByTestId("chapter-preface")).not.toBeNull();
    act(() => vi.advanceTimersByTime(32_000));
    expect(screen.queryByTestId("chapter-preface")).toBeNull();
  });

  it("stays out of a fight", () => {
    seed(partway({ phase: "encounter", encounter: { round: 1, turnIndex: 0 } as RunState["encounter"] }));
    render(<ChapterPreface />);
    expect(screen.queryByTestId("chapter-preface")).toBeNull();
  });
});
