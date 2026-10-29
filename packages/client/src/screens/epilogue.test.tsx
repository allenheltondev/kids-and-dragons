// @vitest-environment jsdom
/**
 * The end of a campaign: the ending scene's own words, then the epilogue for that ending, then
 * the summary's tally.
 *
 * An ending scene ends the chapter the moment it opens, so for a long time its words (the
 * authored last page: "History files you as the Heroes of Red Sky…") were composed into the run
 * and shown nowhere. The summary now heads with them and says them first. On the completion that
 * ends the campaign, the campaign's epilogue for the ending the party reached comes up once they
 * have had time to be read, and the summary says the rest only when it is done.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setSpeaker } from "@kad/shared";
import type { Campaign, CampaignView, Chapter, ItemCatalog, PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { makeItems } from "../../../shared/src/test-fixtures";
import { useGameStore } from "../store";
import { STORY_PLATES_SEEN_KEY, markStoryPlatesSeen, resetStoryPlatesSeen } from "../store/story-plates-seen";
import { ChapterCompletePanel } from "./ChapterCompletePanel";
import { EpiloguePlates, endingHoldMs } from "./StoryPlates";

const ENDING = "You walk out of the mountain into morning. History files you as the Heroes.";

const plates = (id: string) => [1, 2].map((n) => ({ art: `plates/c/epilogue-${id}-${String(n)}`, narration: `After ${id}, plate ${String(n)}.` }));

const CAMPAIGN = {
  id: "c",
  title: "The Walk",
  blurb: "A walk.",
  chapters: ["ch_1"],
  epilogues: [
    { id: "heroes", title: "The Heroes", chapter: "ch_1", endings: ["s_heroes"], plates: plates("heroes") },
    { id: "home", title: "Home Again", chapter: "ch_1", endings: ["s_home"], plates: plates("home") },
  ],
} as Campaign;

const CHAPTER = {
  id: "ch_1",
  campaignId: "c",
  index: 1,
  title: "The Last Hill",
  biome: "plains",
  estimatedMinutes: 30,
  xpAward: 100,
  entry: "s_1",
  scenes: {
    s_1: { type: "story", narration: "Two roads.", choices: [] },
    s_heroes: { type: "story", narration: ENDING, choices: [] },
    s_home: { type: "story", narration: "You go home.", choices: [] },
  },
} as unknown as Chapter;

const ENDED: CampaignView = { id: "c", title: "The Walk", chapters: 1, next: null, ended: "complete" };

function hero(): PartyMember {
  const character = {
    id: "c_1",
    ownerPlayerId: "p_1",
    name: "Sam",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 2,
    tier: "fledgling",
    inventory: [],
    questItems: [],
  } as unknown as ResolvedCharacter;
  return { character, playerId: "p_1", hp: 10, down: false, connected: true, ready: false };
}

function seed(overrides: Partial<RunState> = {}): void {
  const items: ItemCatalog = makeItems();
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "", mode: "party", sessionToken: "" },
    state: {
      runId: "r_1",
      roomCode: "ABCD",
      mode: "party",
      seq: 9,
      phase: "chapter_complete",
      campaignId: "c",
      chapterId: "ch_1",
      sceneId: "s_heroes",
      sceneType: "story",
      narration: ENDING,
      art: null,
      party: [hero()],
      prompt: null,
      lastRoll: null,
      flags: {},
      xpEarned: 100,
      campaign: ENDED,
      updatedAt: "2026-10-29T18:00:00.000Z",
      ...overrides,
    } as RunState,
    items,
    chapter: CHAPTER,
    campaign: CAMPAIGN,
    progression: null,
    loadContent: async () => undefined,
    loadChapter: async () => undefined,
  });
}

/** An Image that loads on the next tick. */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_url: string) {
    void Promise.resolve().then(() => this.onload?.());
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
  setSpeaker((text) => spoken.push(text));
  resetStoryPlatesSeen();
  vi.stubGlobal("Image", FakeImage);
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  setSpeaker(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the ending's own words", () => {
  it("head the summary and are said first, with the tally, when no epilogue follows", () => {
    seed({ sceneId: "s_1", narration: "Two roads end here.", campaign: undefined });
    render(<ChapterCompletePanel />);
    expect(screen.getByTestId("chapter-ending").textContent).toBe("Two roads end here.");
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toMatch(/^Two roads end here\. Chapter finished!/);
  });

  it("are left out when the ending had none", () => {
    seed({ sceneId: "s_1", narration: "", campaign: undefined });
    render(<ChapterCompletePanel />);
    expect(screen.queryByTestId("chapter-ending")).toBeNull();
    expect(spoken[0]).toMatch(/^Chapter finished!/);
  });
});

describe("the epilogue", () => {
  it("comes up for the ending the party reached once the ending has had time to be read", async () => {
    seed();
    render(
      <>
        <ChapterCompletePanel />
        <EpiloguePlates />
      </>,
    );
    // The ending is said alone: the tally waits for the paintings.
    expect(spoken).toEqual([ENDING]);
    expect(screen.queryByTestId("story-plates")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(endingHoldMs(ENDING.split(" ").length));
    });
    await flush();
    const reel = screen.getByTestId("story-plates");
    expect(reel.dataset.kind).toBe("epilogue");
    expect(reel.textContent).toContain("The Heroes");
    expect(reel.textContent).toContain("After heroes, plate 1.");
    expect(spoken.at(-1)).toBe("The Heroes. After heroes, plate 1.");

    // Escape skips the rest: remembered, gone, and the summary says the rest, without the ending again.
    fireEvent.keyDown(window, { key: "Escape" });
    await flush();
    expect(screen.queryByTestId("story-plates")).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORY_PLATES_SEEN_KEY) ?? "[]")).toContain("epilogue:c:heroes");
    expect(spoken.at(-1)).toMatch(/^The Walk is complete!/);
    expect(spoken.filter((line) => line.includes(ENDING))).toHaveLength(1);
  });

  it("comes up sooner on a remote's OK, and then OK turns its pages", async () => {
    seed({ sceneId: "s_home", narration: "You go home." });
    render(<EpiloguePlates />);
    fireEvent.keyDown(window, { key: "Enter" });
    await flush();
    expect(screen.getByTestId("story-plates").textContent).toContain("Home Again");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByTestId("story-plates").dataset.index).toBe("1");
  });

  it("plays only on the completion that ends the campaign, and only once on a device", async () => {
    seed({ campaign: { ...ENDED, ended: undefined } });
    const { unmount } = render(<EpiloguePlates />);
    fireEvent.keyDown(window, { key: "Enter" });
    await flush();
    expect(screen.queryByTestId("story-plates")).toBeNull();
    unmount();

    markStoryPlatesSeen("epilogue:c:heroes");
    seed();
    render(
      <>
        <ChapterCompletePanel />
        <EpiloguePlates />
      </>,
    );
    fireEvent.keyDown(window, { key: "Enter" });
    await flush();
    expect(screen.queryByTestId("story-plates")).toBeNull();
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toMatch(/^You walk out of the mountain/);
    expect(spoken[0]).toContain("The Walk is complete!");
  });
});
