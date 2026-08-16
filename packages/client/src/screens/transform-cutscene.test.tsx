// @vitest-environment jsdom
/**
 * TransformCutscene — spec §8.1's "single most important moment in the game".
 *
 * Two things are being held here, and the first is why this file exists at all.
 *
 *  - **It plays off the progression channel, not the presentation one.** The
 *    `TRANSFORM` presentation kind is in the protocol and nothing has ever
 *    constructed one; the previous owner of this beat (a chip on the
 *    completion card) subscribed to it and therefore never rendered once at a
 *    table. A test that mounts this and emits a `TRANSFORM` presentation would
 *    pass against a component that is wired to nothing.
 *
 *  - **A whole party crossing together is the normal case, not the edge one.**
 *    XP is uniform (§8.1), so three characters hit Sworn on the same evening.
 *    They queue as three separate moments rather than one crowd, because the
 *    eight-year-old this game is for should get hers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { setSpeaker } from "@kad/shared";
import type { PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { useGameStore } from "../store";
import { TransformCutscene, previousTier } from "./TransformCutscene";

function character(overrides: Partial<ResolvedCharacter> = {}): ResolvedCharacter {
  return {
    id: "c_1",
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 4,
    xp: 700,
    tier: "sworn",
    stats: { might: 2, quick: 3, clever: 3, heart: 5 },
    unspentPoints: 1,
    spendableStats: ["might", "quick", "clever", "heart"],
    committedLevel: 4,
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

function member(playerId: string, name: string, id: string): PartyMember {
  const char = character({ id, ownerPlayerId: playerId, name });
  return { character: char, playerId, hp: 10, down: false, connected: true, ready: true };
}

const PARTY = [
  member("p_1", "Sparklehoof", "c_1"),
  member("p_2", "Thistle", "c_2"),
];

function baseState(): RunState {
  return {
    runId: "r_1",
    roomCode: "ABCD",
    mode: "party",
    seq: 9,
    phase: "chapter_complete",
    campaignId: "c",
    chapterId: "bramblewood-01",
    sceneId: "rest_lanternfall",
    sceneType: "rest",
    narration: "",
    art: null,
    party: PARTY,
    prompt: null,
    lastRoll: null,
    flags: {},
    xpEarned: 300,
    updatedAt: "2026-08-16T12:00:00.000Z",
  };
}

function mount() {
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "party", sessionToken: "t" },
    state: baseState(),
    progression: null,
    loadContent: async () => undefined,
    loadChapter: async () => undefined,
  });
  return render(<TransformCutscene />);
}

/** A progression update, the way the server actually sends one. */
function awards(seq: number, list: { characterId: string; newTier?: string; leveledTo?: number }[]) {
  act(() => {
    useGameStore.setState({
      progression: {
        seq,
        progression: {
          characters: PARTY.map((m) => m.character),
          awards: list as never,
        },
      },
    });
  });
}

let spoken: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  spoken = [];
  setSpeaker((text) => spoken.push(text));
});

afterEach(() => {
  cleanup();
  setSpeaker(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Run one beat's timer chain, in the two steps it actually happens in.
 *
 * Advancing straight past both timers in a single flush is not what a table
 * sees — the swap and the end of the hold are 2.4 seconds apart — and it hides
 * whether the swap half did its job at all.
 */
function playBeat() {
  act(() => {
    vi.advanceTimersByTime(900);
  });
  act(() => {
    vi.advanceTimersByTime(2400);
  });
}

describe("the transformation cutscene (spec §8.1)", () => {
  it("draws nothing until somebody crosses a tier", () => {
    const { container } = mount();
    expect(container.querySelector(".transform")).toBeNull();

    // A level-up that crossed no tier is not this beat.
    awards(10, [{ characterId: "c_1", leveledTo: 3 }]);
    expect(container.querySelector(".transform")).toBeNull();
  });

  it("comes up on a tier crossing, naming who and what", () => {
    mount();
    awards(10, [{ characterId: "c_1", newTier: "sworn" }]);

    expect(screen.getByText("Sparklehoof")).toBeTruthy();
    // Before the swap it says something is happening, not what she became.
    expect(screen.getByText(/is changing/)).toBeTruthy();
  });

  it("shows the tier she is leaving, then the one she has become", () => {
    const { container } = mount();
    awards(10, [{ characterId: "c_1", newTier: "sworn" }]);

    // The swap is the information — the picture has to actually change.
    expect(container.querySelector("img")?.getAttribute("src")).toContain("fledgling");

    act(() => {
      vi.advanceTimersByTime(900);
    });

    expect(container.querySelector("img")?.getAttribute("src")).toContain("sworn");
    expect(screen.getByText("Sworn!")).toBeTruthy();
  });

  it("says the word out loud, once, on the swap", () => {
    mount();
    awards(10, [{ characterId: "c_1", newTier: "sworn" }]);
    expect(spoken).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(spoken).toEqual(["Sparklehoof is Sworn!"]);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(spoken).toHaveLength(1);
  });

  it("announces even when a stalled tab fires both of its timers at once", () => {
    /*
     * A backgrounded tab coalesces pending timers on resume. The line is a side
     * effect of the swap rather than of a render watching a flipped flag, so it
     * survives never being rendered in between — which is what a render effect
     * would have needed.
     */
    mount();
    awards(10, [{ characterId: "c_1", newTier: "sworn" }]);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(spoken).toEqual(["Sparklehoof is Sworn!"]);
  });

  it("gets out of the way when the beat is over", () => {
    const { container } = mount();
    awards(10, [{ characterId: "c_1", newTier: "sworn" }]);
    playBeat();
    expect(container.querySelector(".transform")).toBeNull();
  });

  it("gives each of them their own moment when the party crosses together", () => {
    /*
     * The normal case: uniform XP means everybody hits Sworn on the same
     * evening (§8.1). One crowd shot would cost the youngest player the moment
     * this whole screen exists for.
     */
    mount();
    awards(10, [
      { characterId: "c_1", newTier: "sworn" },
      { characterId: "c_2", newTier: "sworn" },
    ]);

    expect(screen.getByText("Sparklehoof")).toBeTruthy();
    expect(screen.queryByText("Thistle")).toBeNull();

    playBeat();

    expect(screen.queryByText("Sparklehoof")).toBeNull();
    expect(screen.getByText("Thistle")).toBeTruthy();

    playBeat();
    expect(screen.queryByText("Thistle")).toBeNull();
    expect(spoken).toEqual(["Sparklehoof is Sworn!", "Thistle is Sworn!"]);
  });

  it("still plays for a character the party list does not have", () => {
    // A missing name is not a reason to swallow the most important moment in
    // the game — the beat runs with a placeholder rather than not at all.
    const { container } = mount();
    awards(10, [{ characterId: "c_missing", newTier: "radiant" }]);

    expect(container.querySelector(".transform")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(screen.getByText("Radiant!")).toBeTruthy();
  });

  it("ignores a progression update it has already played", () => {
    // `watchProgression` dedupes on server seq, so a resubscribe under React
    // strict mode cannot replay a transformation that already happened.
    mount();
    awards(10, [{ characterId: "c_1", newTier: "sworn" }]);
    awards(10, [{ characterId: "c_1", newTier: "sworn" }]);
    playBeat();
    // A second queued beat would still be on screen here.
    expect(screen.queryByText("Sparklehoof")).toBeNull();
  });

  it("replays nothing on a fresh page load", () => {
    // A hard refresh mid-evening must not re-run a cutscene from an hour ago.
    // A fresh store holds no progression, which is what guarantees it.
    const { container } = mount();
    expect(container.querySelector(".transform")).toBeNull();
  });
});

describe("previousTier", () => {
  it("names the step below, which is where a transformation came from", () => {
    expect(previousTier("sworn")).toBe("fledgling");
    expect(previousTier("radiant")).toBe("sworn");
    expect(previousTier("mythic")).toBe("radiant");
  });

  it("has nothing below the starting tier", () => {
    // Unreachable from an award — a character cannot cross *into* fledgling —
    // and the component falls back to showing the new tier throughout.
    expect(previousTier("fledgling")).toBeNull();
  });
});
