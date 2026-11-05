// @vitest-environment jsdom
/**
 * The camp's beat at a chapter's end (#619, docs/camp.md §5.2, §6.2): the
 * TV's tally and its read-only shop, the phone's vote, and the "Dash Cash!"
 * sparkle a lucky drop that paid gets.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CampShopView, CampTally as Tally, PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { makeItems } from "../../../shared/src/test-fixtures";
import { useGameStore } from "../store";
import { announceDashCash, clearDashCash } from "../store/dash-cash-news";
import { CampShopVote, CampTally, DashCashSparkle, SPARKLE_MS } from "./CampChapterEnd";
import { ChapterCompletePanel } from "./ChapterCompletePanel";

function member(n: number): PartyMember {
  const character = {
    id: `c_${n}`,
    ownerPlayerId: `p_${n}`,
    name: n === 1 ? "Sparklehoof" : "Thistle",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 2,
    xp: 120,
    tier: "fledgling",
    stats: { might: 2, quick: 3, clever: 3, heart: 5 },
    unspentPoints: 0,
    spendableStats: [],
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
  } as unknown as ResolvedCharacter;
  return { playerId: `p_${n}`, character, hp: 10, down: false, connected: true, ready: false };
}
const PARTY = [member(1), member(2)];

const tally = (over: Partial<Tally> = {}): Tally => ({
  finished: 2,
  objectives: 1,
  drops: 1,
  replay: false,
  balance: 9,
  shopOpen: true,
  ...over,
});

const shop = (over: Partial<CampShopView> = {}): CampShopView => ({
  visit: "r_1:ch_1:9",
  balance: 9,
  options: [
    { pieceId: "shop_lantern_string", label: "Lantern string", price: 5, after: 4 },
    { pieceId: "shop_striped_awning", label: "Striped awning", price: 5, after: 4 },
  ],
  votes: {},
  ...over,
});

afterEach(() => {
  cleanup();
  clearDashCash();
  vi.useRealTimers();
});

describe("the TV's tally (§5.2)", () => {
  it("counts the chapter's Dash Cash in, with the lucky drops and the balance", () => {
    render(<CampTally tally={tally()} party={PARTY} />);
    expect(screen.getByText("+2 for finishing the chapter")).toBeTruthy();
    expect(screen.getByText("+1 for something extra you did")).toBeTruthy();
    expect(screen.getByText("+1 lucky Dash Cash on the way")).toBeTruthy();
    expect(screen.getByTestId("camp-balance").textContent).toContain("9 Dash Cash");
  });

  it("says a replay earned it before, and pays no lines", () => {
    render(<CampTally tally={tally({ replay: true, finished: 0, objectives: 0, drops: 0 })} party={PARTY} />);
    expect(screen.getByText("You earned this chapter's Dash Cash before.")).toBeTruthy();
    expect(screen.queryByText(/for finishing/)).toBeNull();
  });

  it("says when the shop opens, before it has", () => {
    render(<CampTally tally={tally({ shopOpen: false })} party={PARTY} />);
    expect(screen.getByTestId("camp-shop-line").textContent).toBe("The camp shop opens after the next chapter.");
  });

  it("shows the shop's offer and the votes, and nothing to press", () => {
    render(<CampTally tally={tally()} shop={shop({ votes: { p_1: "shop_striped_awning" } })} party={PARTY} />);
    const offer = screen.getByRole("list", { name: "The camp shop" });
    expect(within(offer).getByText("Lantern string")).toBeTruthy();
    expect(within(offer).getAllByText("5 Dash Cash, leaves 4")).toHaveLength(2);
    expect(within(offer).getByText("Save our Dash Cash")).toBeTruthy();
    expect(within(offer).getByText(/Votes: Sparklehoof/)).toBeTruthy();
    // The shared screen is read-only.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByTestId("camp-shop-line").textContent).toMatch(/Vote on your phones/);
  });

  it("shows the balance and starts no vote when nothing is affordable", () => {
    render(<CampTally tally={tally({ balance: 2 })} shop={shop({ balance: 2, options: [] })} party={PARTY} />);
    expect(screen.queryByRole("list", { name: "The camp shop" })).toBeNull();
    expect(screen.getByTestId("camp-shop-line").textContent).toMatch(/Keep saving/);
  });

  it("says what the vote bought", () => {
    render(<CampTally tally={tally()} shop={shop({ result: { kind: "bought", pieceId: "shop_striped_awning", label: "Striped awning" } })} party={PARTY} />);
    expect(screen.getByTestId("camp-shop-line").textContent).toBe("You bought the striped awning!");
  });

  it("sits on the chapter summary, and never beside the story's coins", () => {
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
        party: PARTY,
        prompt: null,
        lastRoll: null,
        flags: {},
        coins: 12,
        xpEarned: 100,
        endingRead: true,
        campTally: tally(),
        campShop: shop(),
        updatedAt: "2026-11-05T18:00:00.000Z",
      } as RunState,
      items: makeItems(),
      chapter: null,
      progression: null,
      loadContent: async () => undefined,
      loadChapter: async () => undefined,
    });
    render(<ChapterCompletePanel />);
    const camp = screen.getByTestId("camp-tally");
    expect(camp.textContent).toContain("Dash Cash for the camp");
    expect(camp.textContent).not.toMatch(/coin/i);
  });
});

describe("the phone's vote (§6.2)", () => {
  it("is a choice point: pick, then confirm, and the vote is sent with its visit", () => {
    const onVote = vi.fn();
    render(<CampShopVote shop={shop()} party={PARTY} playerId="p_1" held={false} onVote={onVote} />);
    expect(screen.getByText("Your crew has 9 Dash Cash. Everyone votes.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Striped awning/ }));
    expect(onVote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Vote: Striped awning" }));
    expect(onVote).toHaveBeenCalledWith("shop_striped_awning");
  });

  it("always offers saving, for free", () => {
    const onVote = vi.fn();
    render(<CampShopVote shop={shop()} party={PARTY} playerId="p_1" held={false} onVote={onVote} />);
    fireEvent.click(screen.getByRole("button", { name: /Save our Dash Cash/ }));
    fireEvent.click(screen.getByRole("button", { name: "Vote: Save our Dash Cash" }));
    expect(onVote).toHaveBeenCalledWith("save");
  });

  it("marks this phone's vote and shows friends' votes as they land", () => {
    render(<CampShopVote shop={shop({ votes: { p_1: "shop_lantern_string", p_2: "save" } })} party={PARTY} playerId="p_1" held={false} onVote={() => undefined} />);
    expect(screen.getByRole("button", { name: /Lantern string/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Your vote")).toBeTruthy();
    expect(screen.getByText(/Votes: Thistle/)).toBeTruthy();
  });

  it("holds every option while a tap is on its way", () => {
    render(<CampShopVote shop={shop()} party={PARTY} playerId="p_1" held onVote={() => undefined} />);
    for (const button of screen.getAllByRole("button")) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("says what was decided, and offers no more votes", () => {
    render(<CampShopVote shop={shop({ result: { kind: "saved" } })} party={PARTY} playerId="p_1" held={false} onVote={() => undefined} />);
    expect(screen.getByTestId("camp-vote-done").textContent).toBe("You are saving your Dash Cash.");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("starts no vote when nothing is affordable", () => {
    render(<CampShopVote shop={shop({ balance: 3, options: [] })} party={PARTY} playerId="p_1" held={false} onVote={() => undefined} />);
    expect(screen.getByTestId("camp-vote-none").textContent).toMatch(/3 Dash Cash/);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("the sparkle (§5.2)", () => {
  it("shows once for a drop that paid, then goes, and never comes back on a duplicate", () => {
    vi.useFakeTimers();
    render(<DashCashSparkle place="tv" />);
    expect(screen.queryByTestId("dash-cash-sparkle")).toBeNull();
    act(() => { announceDashCash("r_1", 12, ["scene_bell"]); });
    expect(screen.getByTestId("dash-cash-sparkle").textContent).toBe("Dash Cash!");
    act(() => { vi.advanceTimersByTime(SPARKLE_MS + 10); });
    expect(screen.queryByTestId("dash-cash-sparkle")).toBeNull();
    // The same message delivered twice sparkles once.
    act(() => { announceDashCash("r_1", 12, ["scene_bell"]); });
    expect(screen.queryByTestId("dash-cash-sparkle")).toBeNull();
  });
});
