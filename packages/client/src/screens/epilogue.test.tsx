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
import type { Campaign, SpeakOptions, CampaignView, Chapter, ItemCatalog, PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { makeItems } from "../../../shared/src/test-fixtures";
import { useGameStore } from "../store";
import { STORY_PLATES_SEEN_KEY, markStoryPlatesSeen, resetStoryPlatesSeen } from "../store/story-plates-seen";
import { ChapterCompletePanel } from "./ChapterCompletePanel";
import { CAMPAIGN_WAIT_MS, resetEndPlatesWait } from "./end-plates";
import { resetPrefaceCampaigns } from "./run-campaign";
import { EpiloguePlates, PLATE_LOAD_MS, endingHoldMs } from "./StoryPlates";

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

/** An Image that loads on the next tick; one whose URL is in `missing` fails, and in `hanging` never answers. */
const missing = new Set<string>();
const hanging = new Set<string>();
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(url: string) {
    if (hanging.has(url)) return;
    void Promise.resolve().then(() => (missing.has(url) ? this.onerror?.() : this.onload?.()));
  }
}
const urls = (id: string) => plates(id).map((plate) => `/assets/${plate.art}.webp`);

/**
 * A speaker that behaves like a real one: lines queue, `interrupt` and `cancel` clear the queue.
 * `queue` is what is still to be heard; `said` is everything ever handed over, with its options.
 */
function queueingSpeaker() {
  const out = { queue: [] as string[], said: [] as { text: string; opts?: SpeakOptions }[] };
  const speaker = Object.assign(
    (text: string, opts?: SpeakOptions) => {
      if (opts?.interrupt) out.queue = [];
      out.queue.push(text);
      out.said.push({ text, opts });
    },
    { cancel: () => { out.queue = []; } },
  );
  setSpeaker(speaker);
  return out;
}

const both = () =>
  render(
    <>
      <ChapterCompletePanel />
      <EpiloguePlates />
    </>,
  );

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** A phone says the table has heard the ending (ENDING_READ): the summary turns to the tally. */
const turnThePage = (): void => {
  act(() => {
    useGameStore.setState((s) => ({ state: { ...s.state!, endingRead: true } }));
  });
};

let spoken: string[] = [];
beforeEach(() => {
  spoken = [];
  missing.clear();
  hanging.clear();
  resetPrefaceCampaigns();
  resetEndPlatesWait();
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
  it("have a page of their own, said first, and the tally waits for the page to turn", () => {
    seed({ sceneId: "s_1", narration: "Two roads end here.", campaign: undefined, endingRead: false });
    render(<ChapterCompletePanel />);
    expect(screen.getByTestId("chapter-ending").textContent).toBe("Two roads end here.");
    expect(screen.queryByText(/XP for everyone/)).toBeNull();
    expect(spoken).toEqual(["Two roads end here."]);

    turnThePage();
    expect(screen.queryByTestId("chapter-ending")).toBeNull();
    expect(screen.getByText(/XP for everyone/)).toBeTruthy();
    expect(spoken).toHaveLength(2);
    expect(spoken[1]).toMatch(/^Chapter finished!/);
  });

  it("are left out when the ending had none", () => {
    seed({ sceneId: "s_1", narration: "", campaign: undefined, endingRead: false });
    render(<ChapterCompletePanel />);
    expect(screen.queryByTestId("chapter-ending")).toBeNull();
    expect(spoken).toEqual([]);
    turnThePage();
    expect(spoken[0]).toMatch(/^Chapter finished!/);
  });
});

describe("the epilogue", () => {
  it("comes up for the ending the party reached once the ending has had time to be read", async () => {
    seed({ endingRead: false });
    render(
      <>
        <ChapterCompletePanel />
        <EpiloguePlates />
      </>,
    );
    // The ending is said alone: the tally waits for the paintings, which load meanwhile.
    expect(spoken).toEqual([ENDING]);
    await flush();
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

    // Escape skips the rest: remembered, gone, and back on the ending's page until a phone turns it.
    fireEvent.keyDown(window, { key: "Escape" });
    await flush();
    expect(screen.queryByTestId("story-plates")).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORY_PLATES_SEEN_KEY) ?? "[]")).toContain("epilogue:c:heroes");
    expect(screen.getByTestId("chapter-ending")).toBeTruthy();
    // Then the summary says the rest, without the ending again.
    turnThePage();
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
    seed({ endingRead: false });
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
    turnThePage();
    expect(spoken).toHaveLength(2);
    expect(spoken[1]).toContain("The Walk is complete!");
  });
});

describe("waiting on what the epilogue needs", () => {
  it("holds the summary's words while the campaign is still being fetched, then plays the epilogue first", async () => {
    let answer: (value: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
    seed({ endingRead: false });
    useGameStore.setState({ campaign: null });
    both();
    // Nothing is said yet: an epilogue may still turn up, and the tally must not go first.
    expect(spoken).toEqual([]);
    expect(screen.queryByText(/XP for everyone/)).toBeNull();

    await act(async () => {
      answer({ ok: true, json: async () => CAMPAIGN } as Response);
    });
    await flush();
    expect(spoken).toEqual([ENDING]);
    await act(async () => {
      vi.advanceTimersByTime(endingHoldMs(ENDING.split(" ").length));
    });
    await flush();
    expect(screen.getByTestId("story-plates").dataset.kind).toBe("epilogue");
    expect(spoken.some((line) => line.includes("is complete!"))).toBe(false);
  });

  it("gives up on a campaign that never arrives, and says everything", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    seed({ endingRead: false });
    useGameStore.setState({ campaign: null });
    both();
    expect(spoken).toEqual([]);
    await act(async () => {
      vi.advanceTimersByTime(CAMPAIGN_WAIT_MS);
    });
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toMatch(/^You walk out of the mountain/);
    turnThePage();
    expect(spoken[1]).toContain("The Walk is complete!");
  });

  it("lets no epilogue follow once it gave up waiting and spoke, even if the campaign lands just after", async () => {
    let answer: (value: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
    seed();
    useGameStore.setState({ campaign: null });
    both();
    await act(async () => {
      vi.advanceTimersByTime(CAMPAIGN_WAIT_MS);
    });
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toContain("The Walk is complete!");

    // The file arrives a moment too late: this completion has had its summary, and keeps it.
    await act(async () => {
      answer({ ok: true, json: async () => CAMPAIGN } as Response);
    });
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flush();
    expect(screen.queryByTestId("story-plates")).toBeNull();
    expect(spoken).toHaveLength(1);
    expect(screen.getByText(/XP for everyone/)).toBeTruthy();
    // Not remembered as seen: the next device, or the next time, still gets it.
    expect(JSON.parse(localStorage.getItem(STORY_PLATES_SEEN_KEY) ?? "[]")).not.toContain("epilogue:c:heroes");
  });

  it("drops an epilogue with no paintings as soon as they fail, without cutting the ending off", async () => {
    for (const url of urls("heroes")) missing.add(url);
    const speaker = queueingSpeaker();
    seed({ endingRead: false });
    both();
    await flush();
    expect(speaker.queue).toEqual([ENDING]);
    expect(screen.queryByTestId("story-plates")).toBeNull();
    // A phone turns the page well inside the ending's hold: the tally follows the ending in the queue.
    turnThePage();
    expect(speaker.queue).toHaveLength(2);
    expect(speaker.queue[0]).toBe(ENDING);
    expect(speaker.queue[1]).toMatch(/^The Walk is complete!/);
    expect(screen.queryByTestId("story-plates")).toBeNull();
    expect(screen.getByText(/XP for everyone/)).toBeTruthy();
  });

  it("drops an epilogue whose paintings never answer once they time out, inside the ending's hold", async () => {
    for (const url of urls("heroes")) hanging.add(url);
    seed({ endingRead: false });
    both();
    expect(PLATE_LOAD_MS).toBeLessThan(endingHoldMs(ENDING.split(" ").length));
    await act(async () => {
      vi.advanceTimersByTime(PLATE_LOAD_MS);
    });
    await flush();
    expect(spoken).toEqual([ENDING]);
    turnThePage();
    expect(spoken).toHaveLength(2);
    expect(spoken[1]).toMatch(/^The Walk is complete!/);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByTestId("story-plates")).toBeNull();
  });
});

describe("skipping the epilogue", () => {
  it("silences the plate being read, so the summary is heard at once", async () => {
    const speaker = queueingSpeaker();
    seed();
    both();
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(endingHoldMs(ENDING.split(" ").length));
    });
    await flush();
    expect(speaker.queue).toEqual(["The Heroes. After heroes, plate 1."]);

    fireEvent.keyDown(window, { key: "Escape" });
    await flush();
    expect(speaker.queue).toHaveLength(1);
    expect(speaker.queue[0]).toMatch(/^The Walk is complete!/);
  });

  it("shows only the ending until the epilogue is done, then the tally", async () => {
    seed();
    both();
    await flush();
    expect(screen.getByTestId("chapter-ending")).toBeTruthy();
    expect(screen.queryByText(/XP for everyone/)).toBeNull();
    expect(screen.queryByText(/Keep going/)).toBeNull();
    fireEvent.keyDown(window, { key: "Enter" });
    await flush();
    fireEvent.keyDown(window, { key: "Escape" });
    await flush();
    expect(screen.getByText(/XP for everyone/)).toBeTruthy();
  });
});
