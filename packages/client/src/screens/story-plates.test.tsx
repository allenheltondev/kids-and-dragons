// @vitest-environment jsdom
/**
 * StoryPlates: a campaign's prologue and a chapter's plate, painted before the first scene.
 *
 * What matters at the table: the shared screen turns the pages by itself and has nothing to
 * tap; a remote's OK and Escape work anywhere; a phone's pane gets buttons; it is shown once
 * per device; a painting that has not landed is simply left out; and the story (the recap, the
 * read-aloud) starts only when the pictures are done.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setSpeaker } from "@kad/shared";
import type { Campaign, Chapter, PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { useGameStore } from "../store";
import { markStoryPlatesSeen, resetStoryPlatesSeen, STORY_PLATES_SEEN_KEY } from "../store/story-plates-seen";
import { ChapterPreface, resetPrefaceCampaigns } from "./ChapterPreface";
import { NarrationPanel } from "./NarrationPanel";
import { PrologueReplay, StoryPlates, plateHoldMs } from "./StoryPlates";

const PLATES = [1, 2, 3].map((n) => ({ art: `plates/c/prologue-${String(n)}`, narration: `Plate ${String(n)} is a painting.` }));

const CAMPAIGN = {
  id: "c",
  title: "The Walk",
  blurb: "A walk.",
  chapters: ["ch_1", "ch_2"],
  routeSets: { road: ["road_hill", "road_lake"] },
  lastTime: { opener: "A walk begins.", lines: { road_hill: "Up the hill.", road_lake: "Round the lake." } },
  prologue: { plates: PLATES },
} as Campaign;

const chapter = (id: string, index: number, extra: Partial<Chapter> = {}): Chapter =>
  ({
    id,
    campaignId: "c",
    index,
    title: `Chapter ${String(index)}`,
    biome: "plains",
    estimatedMinutes: 30,
    xpAward: 100,
    entry: "s_1",
    scenes: {
      s_1: { type: "story", narration: `The story of ${id} begins.`, choices: [] },
      s_2: { type: "story", narration: "On it goes.", choices: [] },
    },
    goal: { text: "Get there.", steps: [{ id: "a", label: "Go", flag: "went" }] },
    ...extra,
  }) as unknown as Chapter;

const OPENING = chapter("ch_1", 1);
const LAKE = chapter("ch_2", 2, { plate: { art: "plates/c/ch_2", narration: "A lake lies very still." } });

function hero(playerId: string): PartyMember {
  const character = { id: `c_${playerId}`, ownerPlayerId: playerId, name: "Sam", inventory: [], questItems: [] } as unknown as ResolvedCharacter;
  return { character, playerId, hp: 10, down: false, connected: true, ready: true };
}

function run(chapterId: string, overrides: Partial<RunState> = {}): RunState {
  return {
    runId: "r_1",
    roomCode: "ABCD",
    mode: "party",
    seq: 1,
    phase: "scene",
    campaignId: "c",
    chapterId,
    sceneId: "s_1",
    sceneType: "story",
    narration: `The story of ${chapterId} begins.`,
    art: null,
    party: [hero("p_1")],
    prompt: null,
    lastRoll: null,
    flags: {},
    xpEarned: 0,
    visited: ["s_1"],
    updatedAt: "2026-10-22T18:00:00.000Z",
    ...overrides,
  } as RunState;
}

function seed(state: RunState, ch: Chapter, playerId = ""): void {
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId, mode: "party", sessionToken: "" },
    state,
    chapter: ch,
    campaign: CAMPAIGN,
    loadChapter: async () => undefined,
  });
}

/** An Image that loads on the next tick, unless its URL is in `missing`. */
const missing = new Set<string>();
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(url: string) {
    void Promise.resolve().then(() => (missing.has(url) ? this.onerror?.() : this.onload?.()));
  }
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

let spoken: string[] = [];
beforeEach(() => {
  spoken = [];
  missing.clear();
  setSpeaker((text) => spoken.push(text));
  resetPrefaceCampaigns();
  resetStoryPlatesSeen();
  vi.stubGlobal("Image", FakeImage);
});
afterEach(() => {
  cleanup();
  setSpeaker(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the prologue", () => {
  it("paints the first plate with the campaign's title, and says both", async () => {
    seed(run("ch_1"), OPENING);
    render(<StoryPlates />);
    await flush();
    const reel = screen.getByTestId("story-plates");
    expect(reel.dataset.kind).toBe("prologue");
    expect(reel.textContent).toContain("The Walk");
    expect(reel.textContent).toContain("Plate 1 is a painting.");
    expect(reel.querySelectorAll("img")).toHaveLength(3);
    expect(spoken).toEqual(["The Walk. Plate 1 is a painting."]);
  });

  it("turns the pages by itself, then lets the story begin, in order", async () => {
    vi.useFakeTimers();
    seed(run("ch_1"), OPENING);
    render(
      <>
        <StoryPlates />
        <ChapterPreface />
        <NarrationPanel />
      </>,
    );
    await flush();
    // The story is held behind the paintings.
    expect(spoken).toEqual(["The Walk. Plate 1 is a painting."]);
    expect(screen.queryByTestId("chapter-preface")).toBeNull();

    await act(async () => void vi.advanceTimersByTime(plateHoldMs(6)));
    expect(screen.getByTestId("story-plates").dataset.index).toBe("1");
    await act(async () => void vi.advanceTimersByTime(plateHoldMs(5)));
    expect(screen.getByTestId("story-plates").dataset.index).toBe("2");
    expect(screen.getByTestId("story-plates").dataset.last).toBe("true");
    await act(async () => void vi.advanceTimersByTime(plateHoldMs(5)));

    expect(screen.queryByTestId("story-plates")).toBeNull();
    expect(spoken).toEqual([
      "The Walk. Plate 1 is a painting.",
      "Plate 2 is a painting.",
      "Plate 3 is a painting.",
      "Here we go! A walk begins.",
      "Your goal: Get there.",
      "The story of ch_1 begins.",
    ]);
    expect(screen.getByTestId("chapter-preface")).toBeTruthy();
  });

  it("is shown once: skipped or watched, it does not come back", async () => {
    seed(run("ch_1"), OPENING);
    const first = render(<StoryPlates />);
    await flush();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("story-plates")).toBeNull();
    expect(localStorage.getItem(STORY_PLATES_SEEN_KEY)).toContain("prologue:c");
    first.unmount();

    render(<StoryPlates />);
    await flush();
    expect(screen.queryByTestId("story-plates")).toBeNull();
  });

  it("is not shown past the first scene, nor for a chapter other than the opening", async () => {
    seed(run("ch_1", { sceneId: "s_2", visited: ["s_1", "s_2"] }), OPENING);
    render(<StoryPlates />);
    await flush();
    expect(screen.queryByTestId("story-plates")).toBeNull();
  });
});

describe("turning the pages", () => {
  it("lets a remote's OK turn a page and Escape skip the rest", async () => {
    seed(run("ch_1"), OPENING);
    render(<StoryPlates />);
    await flush();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByTestId("story-plates").dataset.index).toBe("1");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: " " });
    expect(screen.queryByTestId("story-plates")).toBeNull();
  });

  it("gives the shared screen nothing to tap, and a phone Next and Skip", async () => {
    seed(run("ch_1"), OPENING, "");
    const tv = render(<StoryPlates />);
    await flush();
    expect(screen.getByTestId("story-plates").dataset.display).toBe("true");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    tv.unmount();
    resetStoryPlatesSeen();

    seed(run("ch_1"), OPENING, "p_1");
    render(<StoryPlates />);
    await flush();
    expect(screen.getByTestId("story-plates").dataset.display).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("story-plates").dataset.index).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByTestId("story-plates")).toBeNull();
  });

  it("lets a phone go back to re-read, and then stops turning the pages by itself", async () => {
    vi.useFakeTimers();
    seed(run("ch_1"), OPENING, "p_1");
    render(<StoryPlates />);
    await flush();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("story-plates").dataset.index).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("story-plates").dataset.index).toBe("0");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByTestId("story-plates").dataset.index).toBe("0");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("story-plates").dataset.index).toBe("1");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByTestId("story-plates").dataset.index).toBe("0");
  });

  it("keeps a focused control's own Enter", async () => {
    seed(run("ch_1"), OPENING, "p_1");
    render(<StoryPlates />);
    await flush();
    fireEvent.keyDown(screen.getByRole("button", { name: "Skip" }), { key: "Enter" });
    expect(screen.getByTestId("story-plates").dataset.index).toBe("0");
  });
});

describe("watching the prologue again", () => {
  it("plays the intro over any screen, asks nothing of the run, and is not remembered", async () => {
    const onClose = vi.fn();
    render(<PrologueReplay campaign={CAMPAIGN} onClose={onClose} />);
    await flush();
    const reel = screen.getByTestId("story-plates");
    expect(reel.dataset.replay).toBe("true");
    expect(reel.dataset.kind).toBe("prologue");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(STORY_PLATES_SEEN_KEY)).toBeNull();
  });
});

describe("paintings that have not landed", () => {
  it("leaves a missing plate out and plays the rest", async () => {
    missing.add("/assets/plates/c/prologue-2.webp");
    seed(run("ch_1"), OPENING);
    render(<StoryPlates />);
    await flush();
    expect(screen.getByTestId("story-plates").querySelectorAll("img")).toHaveLength(2);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByTestId("story-plates").textContent).toContain("Plate 3 is a painting.");
  });

  it("passes over a reel with no paintings, unmarked, and the story is not held", async () => {
    PLATES.forEach((p) => missing.add(`/assets/${p.art}.webp`));
    seed(run("ch_1"), OPENING);
    render(
      <>
        <StoryPlates />
        <NarrationPanel />
      </>,
    );
    // Held while the paintings are fetched...
    expect(spoken).toEqual([]);
    await flush();
    // ...and said as usual once they are known not to be coming.
    expect(screen.queryByTestId("story-plates")).toBeNull();
    expect(spoken).toEqual(["Here we go! A walk begins.", "Your goal: Get there.", "The story of ch_1 begins."]);
    expect(localStorage.getItem(STORY_PLATES_SEEN_KEY)).toBeNull();
  });
});

describe("a chapter's plate", () => {
  it("paints one plate wearing the chapter's title, for a chapter that is not the opening", async () => {
    seed(run("ch_2", { flags: { road_lake: true } }), LAKE);
    render(<StoryPlates />);
    await flush();
    const reel = screen.getByTestId("story-plates");
    expect(reel.dataset.kind).toBe("chapter");
    expect(reel.textContent).toContain("Chapter 2");
    expect(reel.textContent).toContain("A lake lies very still.");
    expect(reel.querySelectorAll(".plates__dot")).toHaveLength(0);
    expect(spoken).toEqual(["Chapter 2. A lake lies very still."]);
  });

  it("is remembered per chapter, not per campaign", async () => {
    markStoryPlatesSeen("prologue:c");
    seed(run("ch_2"), LAKE);
    render(<StoryPlates />);
    await flush();
    expect(screen.getByTestId("story-plates").dataset.kind).toBe("chapter");
  });

  it("goes away, unmarked, when play moves on", async () => {
    seed(run("ch_2"), LAKE);
    render(<StoryPlates />);
    await flush();
    act(() => useGameStore.setState({ state: run("ch_2", { sceneId: "s_2", visited: ["s_1", "s_2"] }) }));
    expect(screen.queryByTestId("story-plates")).toBeNull();
    expect(localStorage.getItem(STORY_PLATES_SEEN_KEY)).toBeNull();
  });
});

describe("how long a plate stays up", () => {
  it("is long enough to say its words, and never absurd", () => {
    expect(plateHoldMs(3)).toBe(6500);
    expect(plateHoldMs(40)).toBe(2000 + 40 * 420);
    expect(plateHoldMs(500)).toBe(22_000);
  });
});
