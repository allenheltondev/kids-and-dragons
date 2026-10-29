// @vitest-environment jsdom
/**
 * ChapterCompletePanel — the end-of-sitting summary, and the two facts about
 * the evening that the engine has always computed and no client ever read.
 *
 * `RunState.chapterOutcome` and `RunState.bonuses` were built with the chapter
 * outcomes work (spec §8.2) and shipped unread: a setback drew the same
 * "Chapter finished!" as a success, and bonus objectives were folded silently
 * into the XP total. Both are things the table is entitled to see — an
 * unaccountable number teaches a child that the number is arbitrary, and an
 * ending that reads as a win when it was not is the game lying to her.
 *
 * The rule this file exists to hold is spec §8.2's other half: **a setback is
 * a different path, not a loss.** It has to be legible as different and must
 * never be dressed as failure — no red, no "you lost", and the XP it did pay
 * still on screen.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { setSpeaker } from "@kad/shared";
import type { Chapter, EarnedBonus, ItemCatalog, PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { makeItems } from "../../../shared/src/test-fixtures";
import { useGameStore } from "../store";
import { ChapterCompletePanel } from "./ChapterCompletePanel";

const ITEMS: ItemCatalog = makeItems();

function character(overrides: Partial<ResolvedCharacter> = {}): ResolvedCharacter {
  return {
    id: "c_1",
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 2,
    xp: 120,
    tier: "fledgling",
    stats: { might: 2, quick: 3, clever: 3, heart: 5 },
    unspentPoints: 1,
    spendableStats: ["might", "quick", "clever", "heart"],
    committedLevel: 2,
    maxHp: 10,
    steps: 4,
    guard: 11,
    attackStat: "heart",
    actions: [],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: true,
    ...overrides,
  };
}

const MEMBER: PartyMember = {
  playerId: "p_1",
  character: character(),
  hp: 10,
  down: false,
  connected: true,
  ready: false,
};

function mount(overrides: Partial<RunState> = {}) {
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "party", sessionToken: "t" },
    state: {
      runId: "r_1",
      roomCode: "ABCD",
      mode: "party",
      seq: 9,
      phase: "chapter_complete",
      campaignId: "c",
      chapterId: "ch_1",
      sceneId: "s_end",
      sceneType: "story",
      narration: "",
      art: null,
      party: [MEMBER],
      prompt: null,
      lastRoll: null,
      flags: {},
      xpEarned: 100,
      updatedAt: "2026-07-04T18:00:00.000Z",
      ...overrides,
    },
    items: ITEMS,
    chapter: null,
    progression: null,
    loadContent: async () => undefined,
    loadChapter: async () => undefined,
  });
  return render(<ChapterCompletePanel />);
}

const bonus = (overrides: Partial<EarnedBonus> = {}): EarnedBonus => ({
  id: "shrine",
  label: "Found the hidden shrine",
  xp: 20,
  ...overrides,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("how the chapter ended (spec §8.2)", () => {
  it("celebrates a success", () => {
    mount({ chapterOutcome: "success" });
    expect(screen.getByText("Chapter finished!")).toBeTruthy();
    expect(screen.queryByText(/took a turn/)).toBeNull();
  });

  it("reads a run with no recorded outcome as a success", () => {
    // The engine's own default: a chapter authored before setbacks existed
    // ends successfully, and a run persisted before the field did must not be
    // demoted by a missing key.
    mount({});
    expect(screen.getByText("Chapter finished!")).toBeTruthy();
  });

  it("says a setback happened, in words rather than in colour", () => {
    mount({ chapterOutcome: "setback", xpEarned: 50 });
    expect(screen.getByText("The story took a turn")).toBeTruthy();
    expect(screen.getByText(/the adventure carries on/i)).toBeTruthy();
  });

  it("still shows the XP a setback paid — half is the point of the number", () => {
    // §8.2: halving rather than zeroing is deliberate. A screen that hid the
    // number would be telling the family the evening was worth nothing.
    mount({ chapterOutcome: "setback", xpEarned: 50 });
    expect(screen.getByText("50")).toBeTruthy();
    expect(screen.getByText(/XP for everyone/)).toBeTruthy();
  });

  it("never renders a setback as a loss", () => {
    const { container } = mount({ chapterOutcome: "setback", xpEarned: 50 });
    expect(container.textContent).not.toMatch(/lost|failed|game over|try again/i);
  });
});

describe("how a fight that fought back ended (#220)", () => {
  it("names each ending, who was freed and what got done", () => {
    mount({ fightEndings: [{ outcome: "escaped", freed: ["Pip"], lost: [], done: [] }] });
    expect(screen.getByText("You got out through the rift. You freed Pip.")).toBeTruthy();
  });

  it("is not there at all for a chapter without one", () => {
    const { container } = mount({});
    expect(container.querySelector(".complete__fight")).toBeNull();
  });
});

describe("bonus objectives (spec §8.2)", () => {
  it("itemises what the party pulled off, so the XP total adds up", () => {
    mount({ xpEarned: 125, bonuses: [bonus(), bonus({ id: "quiet", label: "Nobody went down", xp: 5 })] });

    expect(screen.getByText("Found the hidden shrine")).toBeTruthy();
    expect(screen.getByText("+20")).toBeTruthy();
    expect(screen.getByText("Nobody went down")).toBeTruthy();
    expect(screen.getByText("+5")).toBeTruthy();
  });

  it("shows an objective the shared 25% budget clamped to nothing", () => {
    // The party still did the thing. Dropping it silently would be the screen
    // disagreeing with the evening.
    mount({ bonuses: [bonus({ xp: 0 })] });
    expect(screen.getByText("Found the hidden shrine")).toBeTruthy();
    expect(screen.getByText("+0")).toBeTruthy();
  });

  it("stays off the screen entirely when the chapter had none", () => {
    mount({ bonuses: [] });
    expect(screen.queryByText(/And you did these too/)).toBeNull();
  });

  it("pays on a setback too — objectives are about the way there, not the ending", () => {
    mount({ chapterOutcome: "setback", xpEarned: 70, bonuses: [bonus()] });
    expect(screen.getByText("The story took a turn")).toBeTruthy();
    expect(screen.getByText("Found the hidden shrine")).toBeTruthy();
  });
});

/**
 * Who grew — off the **progression** channel.
 *
 * These chips were wired to `LEVEL_UP` and `TRANSFORM` *presentation* events,
 * which nothing in the codebase has ever constructed, so they never rendered
 * once at a table. The server sends level and tier crossings in
 * `progression.awards`; a test that emits presentations would pass against a
 * panel wired to nothing, which is exactly what the old code was.
 */
describe("who grew (progression awards)", () => {
  function progress(seq: number, list: { characterId: string; newTier?: string; leveledTo?: number }[]) {
    act(() => {
      useGameStore.setState({
        progression: {
          seq,
          progression: { characters: [MEMBER.character], awards: list as never },
        },
      });
    });
  }

  it("shows nothing about growing when nobody did", () => {
    mount();
    expect(screen.queryByText("Levelled up!")).toBeNull();
    expect(screen.queryByText(/New look/)).toBeNull();
    expect(screen.queryByText(/next rest stop/)).toBeNull();
  });

  it("marks a level-up and shows the new number", () => {
    mount();
    progress(10, [{ characterId: "c_1", leveledTo: 3 }]);

    expect(screen.getByText("Levelled up!")).toBeTruthy();
    expect(screen.getByText("Level 3")).toBeTruthy();
    expect(screen.getByText(/Spend it on your phone at the next rest stop/)).toBeTruthy();
  });

  it("marks a tier crossing, which is the receipt for the cutscene", () => {
    mount();
    progress(10, [{ characterId: "c_1", leveledTo: 4, newTier: "sworn" }]);

    expect(screen.getByText("New look: sworn")).toBeTruthy();
  });

  it("ignores a progression update it has already handled", () => {
    // Dedupes on server seq, so React strict mode's resubscribe cannot double
    // anything up.
    mount();
    progress(10, [{ characterId: "c_1", leveledTo: 3 }]);
    progress(10, [{ characterId: "c_1", leveledTo: 9 }]);
    expect(screen.getByText("Level 3")).toBeTruthy();
  });
});

describe("the recap (priority-1 scenes, in their own words)", () => {
  const TRUTH = "The gemstones are a seal, and the seal holds a titan under the mountain.";
  const CHAPTER = {
    id: "ch_1",
    scenes: {
      s_start: { type: "story", narration: "A road.", choices: [] },
      s_truth: { type: "story", priority: 1, narration: TRUTH, choices: [] },
      s_clue: { type: "story", priority: 2, narration: "A clue.", choices: [] },
      s_end: { type: "story", narration: "Home.", choices: [] },
    },
  } as unknown as Chapter;

  function withChapter(chapter: Chapter | null, overrides: Partial<RunState> = {}) {
    const view = mount(overrides);
    act(() => {
      useGameStore.setState({ chapter });
    });
    return view;
  }

  it("retells each p1 scene the party walked through", () => {
    withChapter(CHAPTER, { visited: ["s_start", "s_truth", "s_clue", "s_end"] });
    expect(screen.getByText(TRUTH)).toBeTruthy();
    expect(screen.queryByText("A clue.")).toBeNull();
    expect(document.querySelectorAll(".complete__recap")).toHaveLength(1);
  });

  it("shows nothing at all on a road with no revelation", () => {
    withChapter(CHAPTER, { visited: ["s_start", "s_clue", "s_end"] });
    expect(document.querySelector(".complete__recap")).toBeNull();
  });

  it("shows nothing for another chapter's scenes, or before the chapter loads", () => {
    withChapter({ ...CHAPTER, id: "ch_other" }, { visited: ["s_truth"] });
    expect(document.querySelector(".complete__recap")).toBeNull();
    cleanup();
    withChapter(null, { visited: ["s_truth"] });
    expect(document.querySelector(".complete__recap")).toBeNull();
  });

  it("reads it aloud with the summary rather than after it", () => {
    /*
     * §11 — all narration flows through `speak()`, and a recap that only
     * existed on the television is a recap nobody hears. One utterance rather
     * than two so it cannot interrupt or be interrupted by the summary line.
     */
    const spoken: string[] = [];
    setSpeaker((text) => spoken.push(text));
    try {
      withChapter(CHAPTER, { visited: ["s_start", "s_truth", "s_end"] });
      expect(spoken).toHaveLength(1);
      expect(spoken[0]).toContain("Chapter finished!");
      expect(spoken[0]).toContain(TRUTH);
    } finally {
      setSpeaker(null);
    }
  });

  it("does not hold the summary forever for a chapter that never loads", () => {
    vi.useFakeTimers();
    const spoken: string[] = [];
    setSpeaker((text) => spoken.push(text));
    try {
      mount({ visited: ["s_truth"] });
      expect(spoken).toHaveLength(0);
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(spoken).toHaveLength(1);
      expect(spoken[0]).toContain("Chapter finished!");
    } finally {
      setSpeaker(null);
      vi.useRealTimers();
    }
  });
});

describe("the chapter that ends the whole campaign", () => {
  const VIEW = { id: "gemfall", title: "Gemfall", chapters: 8, next: { index: 1, title: "The City" } };

  it("says the campaign is complete, not just the chapter", () => {
    mount({ campaign: { ...VIEW, ended: "complete" } });
    expect(screen.getByRole("heading", { name: /Gemfall is complete!/ })).toBeTruthy();
    expect(screen.getByText(/keep everything they earned, for good/)).toBeTruthy();
    expect(screen.queryByText(/Chapter finished!/)).toBeNull();
  });

  it("gives a failed campaign its own ending, with the souvenir, never a loss screen", () => {
    mount({ chapterOutcome: "setback", campaign: { ...VIEW, ended: "failed" } });
    expect(screen.getByRole("heading", { name: /The end of Gemfall/ })).toBeTruthy();
    expect(screen.getByText(/keeps a souvenir/)).toBeTruthy();
    // The campaign's ending replaces the ordinary setback line, not adds to it.
    expect(screen.queryByText(/the adventure carries on from here/)).toBeNull();
  });

  it("leaves an ordinary chapter's ending alone", () => {
    mount({ campaign: VIEW });
    expect(screen.getByRole("heading", { name: /Chapter finished!/ })).toBeTruthy();
  });
});

describe("graph campaigns (#195) leave the summary alone", () => {
  const ORDERED = { id: "gemfall", title: "Gemfall", chapters: 8, next: { index: 2, title: "The Road" } };

  it("an ordered campaign's summary carries no journey panel", () => {
    const { container } = mount({ campaign: ORDERED });
    expect(container.querySelector(".journey")).toBeNull();
    expect(screen.getByText(/Tap “Keep going” on your phone/)).toBeTruthy();
  });

  it("a graph campaign's summary is the same summary - the map is on the phones, after 'Back to the lobby'", () => {
    const { container } = mount({
      campaign: {
        ...ORDERED,
        id: "rift-sampler",
        next: null,
        journey: {
          node: "orchard",
          title: "The Orchard",
          visit: 1,
          status: "choosing",
          chapter: "sampler-orchard",
          exits: [],
        },
      },
    });
    expect(screen.getByRole("heading", { name: "Chapter finished!" })).toBeTruthy();
    expect(container.querySelector(".journey")).toBeNull();
  });
});

describe("the chapter's goal on the summary (#356)", () => {
  // 07l's shape: three optional extras (quest items) and one required step.
  const TETHER = {
    id: "ch_1",
    entry: "s_end",
    scenes: { s_end: { type: "story", narration: "Home.", choices: [] } },
    goal: {
      text: "Gather the ledger, the chord and a true answer, then hold the stone's hum at the bend.",
      steps: [
        { id: "ledger", label: "Borrow the wardens' ledger", item: "tether_ledger", optional: true },
        { id: "chord", label: "Learn the choir's three notes", item: "tether_chord", optional: true },
        { id: "answer", label: "Find a true answer", item: "tether_question", optional: true },
        { id: "bend", label: "Face the stone's hum at the bend", flag: "faced_the_bend" },
      ],
    },
  } as unknown as Chapter;

  it("shows the goal done on a success that skipped every extra, and counts the extras apart", () => {
    mount({ chapterOutcome: "success", flags: { faced_the_bend: true } });
    act(() => {
      useGameStore.setState({ chapter: TETHER });
    });
    const goal = document.querySelector(".complete .goal")!;
    expect(goal.classList.contains("goal--all")).toBe(true);
    expect(screen.getByRole("img", { name: "1 of 1 done, 0 of 3 extras" })).toBeTruthy();
    expect([...goal.querySelectorAll(".goal__step")].map((s) => s.getAttribute("data-done"))).toEqual(["false", "false", "false", "true"]);
  });
});

describe("a hero the chapter has paid before (#408)", () => {
  const VETERAN = MEMBER;
  const NEWCOMER: PartyMember = { ...MEMBER, playerId: "p_2", character: character({ id: "c_2", name: "Bramble" }) };

  it("leaves the line alone when the chapter paid everyone", () => {
    mount({ party: [VETERAN, NEWCOMER] });
    expect(screen.getByText(/XP for everyone/)).toBeTruthy();
    expect(screen.queryByText("XP earned here before")).toBeNull();
  });

  it("says who the XP was for, and marks the hero it skipped", () => {
    mount({ party: [VETERAN, NEWCOMER], xpAlreadyPaid: ["c_1"] });
    expect(screen.getByText("100")).toBeTruthy();
    expect(screen.getByText(/XP for each hero new to this chapter/)).toBeTruthy();
    expect(screen.queryByText(/XP for everyone/)).toBeNull();
    expect(screen.getAllByText("XP earned here before")).toHaveLength(1);
  });

  it("says plainly when nobody earned it this time, and the story still finished", () => {
    vi.useFakeTimers();
    const spoken: string[] = [];
    setSpeaker((text) => spoken.push(text));
    try {
      mount({ party: [VETERAN, NEWCOMER], xpAlreadyPaid: ["c_1", "c_2"] });
      expect(screen.getByText("Chapter finished!")).toBeTruthy();
      expect(screen.getByText("Everyone here has earned this chapter's XP before.")).toBeTruthy();
      expect(screen.queryByText("100")).toBeNull();
      expect(screen.getAllByText("XP earned here before")).toHaveLength(2);
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(spoken[0]).toContain("Chapter finished! Everyone here has earned this chapter's XP before.");
      expect(spoken[0]).not.toContain("The party earned");
    } finally {
      setSpeaker(null);
      vi.useRealTimers();
    }
  });
});

describe("bonus objectives on a replay (#408)", () => {
  const VETERAN_TWO: PartyMember = { ...MEMBER, playerId: "p_2", character: character({ id: "c_2", name: "Bramble" }) };

  it("shows the objectives as done, not as XP, when nobody earns the chapter again", () => {
    mount({ party: [MEMBER, VETERAN_TWO], xpAlreadyPaid: ["c_1", "c_2"], bonuses: [bonus()] });
    expect(screen.getByText("Found the hidden shrine")).toBeTruthy();
    expect(screen.getByText("Already claimed")).toBeTruthy();
    expect(screen.queryByText("+20")).toBeNull();
    expect(screen.queryByText(/new heroes earn these/)).toBeNull();
  });

  it("qualifies the objectives' XP when only some heroes are new", () => {
    mount({ party: [MEMBER, VETERAN_TWO], xpAlreadyPaid: ["c_1"], bonuses: [bonus()] });
    expect(screen.getByText("+20")).toBeTruthy();
    expect(screen.getByText(/new heroes earn these/)).toBeTruthy();
    expect(screen.queryByText("Already claimed")).toBeNull();
  });
});

describe("each hero's own roll XP (spec §8.2)", () => {
  const PIP: PartyMember = {
    ...MEMBER,
    playerId: "p_2",
    character: character({ id: "c_2", name: "Pip" }),
  };

  it("lists what each hero earned for her own good rolls, under the party's line", () => {
    mount({ party: [MEMBER, PIP], xpEarned: 100, heroRollXp: { c_1: 4, c_2: 2 } });
    expect(screen.getByText(/XP for everyone/)).toBeTruthy();
    expect(screen.getByText("From their own good rolls: Sparklehoof +4, Pip +2")).toBeTruthy();
  });

  it("leaves a hero the chapter already paid off the line", () => {
    mount({ party: [MEMBER, PIP], xpEarned: 100, heroRollXp: { c_1: 4, c_2: 2 }, xpAlreadyPaid: ["c_2"] });
    expect(screen.getByText("From their own good rolls: Sparklehoof +4")).toBeTruthy();
  });

  it("reads each hero's own roll XP aloud with the summary", () => {
    vi.useFakeTimers();
    const spoken: string[] = [];
    setSpeaker((text) => spoken.push(text));
    try {
      mount({ party: [MEMBER, PIP], xpEarned: 100, heroRollXp: { c_1: 4, c_2: 2 } });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(spoken).toHaveLength(1);
      // Heard as "hero", never by name (#552); the screen keeps the names.
      expect(spoken[0]).toContain("Hero earned 4 experience from their own good rolls.");
      expect(spoken[0]).toContain("Hero earned 2 experience from their own good rolls.");
      expect(spoken[0]).not.toMatch(/Sparklehoof|Pip/);
    } finally {
      setSpeaker(null);
      vi.useRealTimers();
    }
  });

  it("shows no line when nobody's rolls paid anything", () => {
    mount({ party: [MEMBER, PIP], xpEarned: 100 });
    expect(screen.queryByText(/own good rolls/)).toBeNull();
  });
});
