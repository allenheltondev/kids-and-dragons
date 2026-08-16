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
import { cleanup, render, screen } from "@testing-library/react";
import type { EarnedBonus, ItemCatalog, PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
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
