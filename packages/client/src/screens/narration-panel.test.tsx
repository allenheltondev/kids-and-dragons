// @vitest-environment jsdom
/**
 * NarrationPanel — the shared surface, and the one voice.
 *
 * `speak()` is called here and only here (spec §11). WorldView exists exactly
 * once per player in both modes — a TV in Party Mode, the top pane in Travel
 * Mode — so a line spoken from PlayerPanel as well would be said twice on a
 * Travel Mode phone, which renders both.
 *
 * This file exists for the trading announcement. Everything else about a
 * hand-off happens on two phones, and in Party Mode the table is looking at
 * the television: without a line here, Dad taps "give it to her" and the only
 * thing that happens anywhere in the room is a card appearing on a phone she
 * may not be holding. §9.4 calls trading "the point in the session where the
 * three of you talk to each other" — that needs the room to hear it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { setSpeaker } from "@kad/shared";
import type { ItemCatalog, PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { makeItems } from "../../../shared/src/test-fixtures";
import { useGameStore } from "../store";
import { NarrationPanel } from "./NarrationPanel";

const ITEMS: ItemCatalog = makeItems();

function character(overrides: Partial<ResolvedCharacter> = {}): ResolvedCharacter {
  return {
    id: "c_1",
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 1,
    xp: 0,
    tier: "fledgling",
    stats: { might: 2, quick: 3, clever: 3, heart: 5 },
    unspentPoints: 0,
    spendableStats: ["might", "quick", "clever", "heart"],
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
    isProvisional: false,
    ...overrides,
  };
}

function member(playerId: string, name: string): PartyMember {
  const char = character({ id: `c_${playerId}`, ownerPlayerId: playerId, name });
  return { character: char, playerId, hp: 10, down: false, connected: true, ready: true };
}

const PARTY = [member("p_1", "Sparklehoof"), member("p_2", "Thistle")];

function mount(overrides: Partial<RunState> = {}, itemsLoaded: ItemCatalog | null = ITEMS) {
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "party", sessionToken: "t" },
    state: {
      runId: "r_1",
      roomCode: "ABCD",
      mode: "party",
      seq: 3,
      phase: "scene",
      campaignId: "c",
      chapterId: "bramblewood-01",
      sceneId: "rest_mossbank",
      sceneType: "rest",
      narration: "The moss on the bank is warm.",
      art: null,
      party: PARTY,
      prompt: null,
      lastRoll: null,
      flags: {},
      xpEarned: 0,
      updatedAt: "2026-08-16T12:00:00.000Z",
      ...overrides,
    },
    items: itemsLoaded,
    loadContent: async () => undefined,
    loadChapter: async () => undefined,
  });
  return render(<NarrationPanel />);
}

const OFFER = {
  id: "t1",
  fromPlayerId: "p_1",
  toPlayerId: "p_2",
  itemId: "sunbloom_draught",
};

let spoken: string[] = [];

beforeEach(() => {
  spoken = [];
  setSpeaker((text) => spoken.push(text));
});

afterEach(() => {
  cleanup();
  setSpeaker(null);
  vi.restoreAllMocks();
});

describe("announcing a hand-off (spec §9.4)", () => {
  it("says who is giving what to whom, out loud", () => {
    mount({ trades: [OFFER] });
    expect(spoken).toContain("Sparklehoof wants to give Thistle a Sunbloom Draught.");
  });

  it("names it in the third person, so it works on a television", () => {
    // The shared surface has no "you" — it is the same screen for all three of
    // them, and in Party Mode it is across the room from every phone.
    mount({ trades: [OFFER] });
    const line = spoken.find((t) => t.includes("Sunbloom"))!;
    expect(line).not.toMatch(/\byou\b/i);
  });

  it("shows it on the shared screen as well as saying it", () => {
    mount({ trades: [OFFER] });
    expect(screen.getByText(/offers/)).toBeTruthy();
    expect(screen.getAllByText("Sparklehoof").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Thistle").length).toBeGreaterThan(0);
  });

  it("says nothing at all when nothing is being passed around", () => {
    mount({ trades: [] });
    expect(spoken.some((t) => t.includes("wants to give"))).toBe(false);
    expect(screen.queryByText(/offers/)).toBeNull();
  });

  it("does not say it twice for the same offer", () => {
    // Re-rendering is not re-announcing. The scene's narration follows the
    // same rule, for the same reason: this is a table, not a notification bar.
    const { rerender } = mount({ trades: [OFFER] });
    rerender(<NarrationPanel />);
    rerender(<NarrationPanel />);
    expect(spoken.filter((t) => t.includes("Sunbloom Draught"))).toHaveLength(1);
  });

  it("still reads the scene's own narration first", () => {
    // An offer is an aside; the scene outranks it and must not be stomped.
    mount({ trades: [OFFER] });
    expect(spoken[0]).toBe("The moss on the bank is warm.");
  });

  it("renders a run persisted before trading existed", () => {
    const legacy: Partial<RunState> = {};
    expect(() => mount(legacy)).not.toThrow();
    expect(screen.queryByText(/offers/)).toBeNull();
  });

  it("falls back rather than throwing when the item catalog has not loaded", () => {
    // Content is fetched separately from the bundle; the TV can be refreshed
    // into a scene before it lands.
    expect(() => mount({ trades: [OFFER] }, null)).not.toThrow();
    expect(spoken.some((t) => t.includes("wants to give"))).toBe(true);
  });
});

/**
 * Announcing is per *offer*, not per rendering of the list.
 *
 * Keying the dedup on the joined sentence made every change of shape a reason
 * to say everything again: a second offer turned "A" into "A B" and repeated A,
 * resolving A turned "A B" into "B" and repeated B, and the item catalog
 * arriving late turned "a thing" into "a Sunbloom Draught" and said the lot.
 * Three people around a television get interrupted by every one of those.
 */
describe("announcing several hand-offs", () => {
  const SECOND = {
    id: "t2",
    fromPlayerId: "p_2",
    toPlayerId: "p_1",
    itemId: "river_charm",
  };

  function push(trades: RunState["trades"]) {
    act(() => {
      useGameStore.setState((prev) => ({
        state: { ...prev.state!, trades, seq: prev.state!.seq + 1 },
      }));
    });
  }

  it("says only the new one when a second offer arrives", () => {
    const { rerender } = mount({ trades: [OFFER] });
    expect(spoken.filter((t) => t.includes("Sunbloom"))).toHaveLength(1);

    push([OFFER, SECOND]);
    rerender(<NarrationPanel />);

    expect(spoken.filter((t) => t.includes("Sunbloom"))).toHaveLength(1);
    expect(spoken.filter((t) => t.includes("River Charm"))).toHaveLength(1);
  });

  it("does not re-announce the survivor when one is resolved", () => {
    const { rerender } = mount({ trades: [OFFER] });
    push([OFFER, SECOND]);
    rerender(<NarrationPanel />);
    push([SECOND]);
    rerender(<NarrationPanel />);

    expect(spoken.filter((t) => t.includes("River Charm"))).toHaveLength(1);
  });

  it("does not re-announce when the item catalog arrives late", () => {
    // Content is fetched separately from the bundle, so a TV can be in a scene
    // before the names it needs have landed. The sentence then changes from
    // "a thing" to "a Sunbloom Draught" — which must not be a reason to speak.
    const { rerender } = mount({ trades: [OFFER] }, null);
    const saidWhileNameless = spoken.length;
    expect(spoken.some((t) => t.includes("a thing"))).toBe(true);

    act(() => {
      useGameStore.setState({ items: ITEMS });
    });
    rerender(<NarrationPanel />);

    expect(spoken).toHaveLength(saidWhileNameless);
  });
});
