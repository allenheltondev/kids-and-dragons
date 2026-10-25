// @vitest-environment jsdom
/**
 * A fifth phone at a table of four (#389): it says the table is full, in
 * words a kid can read, instead of walking them through a hero the engine
 * would refuse. And a seat that opens puts hero creation back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  CHEER_COOLDOWN_MS,
  CHEERS,
  CHOSE_TO_WATCH_MESSAGE,
  MAX_PARTY,
  SPECTATOR_MESSAGE,
  TABLE_FULL_MESSAGE,
  type PartyMember,
  type RunState,
} from "@kad/shared";
import { useGameStore } from "../store";
import { PlayerView } from "./PlayerView";

function member(i: number): PartyMember {
  return {
    character: {
      id: `c_${i}`,
      ownerPlayerId: `p_${i}`,
      name: `Hero ${i}`,
      species: "unicorn",
      class: "songkeeper",
      appearance: { palette: "meadow", accent: "#7FD4C1" },
      level: 1,
      xp: 0,
      tier: "sprout",
      stats: { might: 1, quick: 1, clever: 1, heart: 1 },
      unspentPoints: 0,
      spendableStats: [],
      committedLevel: 1,
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
    } as never,
    playerId: `p_${i}`,
    hp: 10,
    down: false,
    connected: true,
    ready: false,
  };
}

function state(removed?: string[]): RunState {
  return {
    runId: "r_1",
    roomCode: "ABCD",
    mode: "party",
    seq: 4,
    phase: "creation",
    campaignId: null,
    chapterId: null,
    sceneId: null,
    sceneType: null,
    narration: "",
    art: null,
    party: Array.from({ length: MAX_PARTY }, (_, i) => member(i + 1)),
    prompt: null,
    lastRoll: null,
    flags: {},
    xpEarned: 0,
    updatedAt: "2026-10-21T12:00:00.000Z",
    ...(removed ? { removed } : {}),
  };
}

function mount(playerId: string, run: RunState) {
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId, mode: "party", sessionToken: "t" },
    state: run,
    progression: null,
    presentation: null,
    loadContent: async () => undefined,
    loadChapter: async () => undefined,
  });
  return render(<PlayerView />);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a full table (#389)", () => {
  it("tells a fifth phone the table is full, not how to make a hero", () => {
    mount("p_5", state());
    expect(screen.getByTestId("table-full").textContent).toContain(TABLE_FULL_MESSAGE);
    expect(document.querySelector(".player-view__creation")).toBeNull();
  });

  it("puts hero creation back when the host frees a seat", () => {
    mount("p_5", state());
    act(() => {
      useGameStore.setState({ state: state(["p_4"]) });
    });
    expect(screen.queryByTestId("table-full")).toBeNull();
    expect(document.querySelector(".player-view__creation")).not.toBeNull();
  });

  it("lets a spectator cheer, then rests the buttons a moment (#388)", async () => {
    vi.useFakeTimers();
    try {
      const cheer = vi.fn(async () => true);
      mount("p_5", state());
      act(() => useGameStore.setState({ cheer }));
      const buttons = screen.getAllByRole("button", { name: /!$/ });
      expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(CHEERS.map((c) => c.label));

      act(() => buttons[1]!.click());
      expect(cheer).toHaveBeenCalledWith(CHEERS[1]!.id);
      expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
      act(() => buttons[2]!.click());
      expect(cheer).toHaveBeenCalledTimes(1);

      act(() => vi.advanceTimersByTime(CHEER_COOLDOWN_MS));
      expect(buttons.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says what the party is doing once the story has started (#388)", () => {
    mount("p_5", { ...state(), phase: "scene", prompt: { kind: "choice", sceneId: "s", options: [], forPlayerIds: [], vote: true } });
    expect(screen.getByTestId("spectating-doing").textContent).toBe("The party is voting on what to do next.");
  });

  it("reads short and kind, and promises nothing we do not have", () => {
    const sentences = TABLE_FULL_MESSAGE.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(14);
    expect(TABLE_FULL_MESSAGE).not.toMatch(/watch|spectat|error|\(4\)/i);
    // What the spectator can do instead (#388), in the same voice: never counting the party.
    for (const sentence of SPECTATOR_MESSAGE.split(/(?<=[.!?])\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(14);
    expect(SPECTATOR_MESSAGE).not.toMatch(/\b(two|three|four|\d)\b/i);
  });
});

describe("choosing to watch at a table with room (#388)", () => {
  const seated = (watching?: true): RunState => {
    const run = state(["p_4"]);
    return { ...run, seats: { p_5: { name: "Posy", color: "#fff", device: "phone", ...(watching ? { watching } : {}) } } };
  };

  it("offers Just watch above the creation flow, and asks the server for it", () => {
    const spectate = vi.fn(async () => true);
    mount("p_5", seated());
    act(() => useGameStore.setState({ spectate }));
    expect(screen.queryByTestId("table-full")).toBeNull();
    act(() => screen.getByRole("button", { name: "Just watch" }).click());
    expect(spectate).toHaveBeenCalledWith(true);
  });

  it("watches once chosen, says they chose it, and offers the way back while a seat is open", () => {
    const spectate = vi.fn(async () => true);
    mount("p_5", seated(true));
    act(() => useGameStore.setState({ spectate }));
    const panel = screen.getByTestId("table-full");
    expect(panel.textContent).toContain(CHOSE_TO_WATCH_MESSAGE);
    expect(panel.textContent).not.toContain(TABLE_FULL_MESSAGE);
    expect(screen.queryByTestId("just-watch")).toBeNull();
    // The half-made hero waits, hidden, for a change of mind.
    expect(document.querySelector<HTMLElement>(".player-view__creation")?.hidden).toBe(true);
    act(() => screen.getByRole("button", { name: "Make my hero" }).click());
    expect(spectate).toHaveBeenCalledWith(false);
  });

  it("has no way back once the table fills", () => {
    mount("p_5", { ...seated(true), removed: [] });
    expect(screen.getByTestId("table-full").textContent).toContain(TABLE_FULL_MESSAGE);
    expect(screen.queryByRole("button", { name: "Make my hero" })).toBeNull();
  });
});
