// @vitest-environment jsdom
/**
 * LobbyContent — when the shared screen tells the campaign's premise.
 *
 * Only in an empty lobby before chapter 1: that is when the room is reading
 * the TV, and once the lineup starts a full party has to fit a 720p screen
 * nobody can scroll. A table back in the lobby after finishing the campaign
 * is never told it again (campaign-copy `campaignPremise`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CampaignView, RunState } from "@kad/shared";
import { makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { resetHelpCache } from "../help/content";
import { LobbyContent } from "./LobbyContent";

const PREMISE = "Mount Red Sky has erupted, and gemstones are raining across the realm.";
const FIRST: CampaignView = {
  id: "gemfall",
  title: "Gemfall",
  blurb: PREMISE,
  chapters: 8,
  next: { index: 1, title: "The City That Smelled Opportunity" },
};

function mount(overrides: Partial<RunState>) {
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "", mode: "party", sessionToken: "t" },
    state: makeState({ phase: "lobby", party: [], ...overrides }),
  });
  render(<LobbyContent />);
}

afterEach(() => {
  cleanup();
});

describe("the adventure's crew", () => {
  it("identifies the first crew for saves made before crews existed", () => {
    mount({});
    expect(screen.getByText("The first crew")).toBeTruthy();
  });

  it("identifies the active crew independently of tonight's party", () => {
    mount({ crew: "cw_1", crews: [{ id: "cw_1", name: "The Otter Crew" }], party: [] });
    expect(screen.getByText("The Otter Crew")).toBeTruthy();
    expect(screen.queryByText("The first crew")).toBeNull();
  });
});

describe("what the room should do next", () => {
  it("shows a player making a hero and withholds the start instruction", () => {
    mount({
      party: [makeMember({ ready: true })],
      seats: { p_2: { name: "Sam", color: "#abc", device: "phone" } },
    });
    expect(screen.getByText("Sam")).toBeTruthy();
    expect(screen.getByText("Making a hero")).toBeTruthy();
    expect(screen.getByText("The party (1/2 ready)")).toBeTruthy();
    expect(screen.queryByText(/Start the adventure on a phone/)).toBeNull();
  });

  it("says where to start after everyone playing is ready", () => {
    mount({ party: [makeMember({ ready: true })] });
    expect(screen.getByText("Everyone is ready! Start the adventure on a phone.")).toBeTruthy();
    expect(document.querySelector('[data-entry-scene="lobby-ready"]')).not.toBeNull();
  });

  it("does not treat a seated hero who still needs Ready as making a hero", () => {
    mount({ party: [makeMember({ ready: false })] });
    expect(screen.getByText("Tap Ready on your phone")).toBeTruthy();
    expect(screen.queryByText("Making a hero")).toBeNull();
    expect(screen.queryByText(/Everyone is ready!/)).toBeNull();
  });
});

describe("a saved game (#259)", () => {
  const SAVED = {
    campaignId: "gemfall",
    campaignTitle: "Gemfall",
    chapter: { index: 2, title: "The Honey Bridge" },
    recap: "Bees hummed over the water.",
    heroes: ["Pip", "Bo"],
    savedAt: "2026-10-18T18:00:00.000Z",
  };

  it("tells the room where it stopped and who can pick it up", () => {
    mount({ campaign: FIRST, saved: SAVED });
    expect(screen.getByText("You stopped partway through The Honey Bridge.")).toBeTruthy();
    expect(screen.getByText(/Bees hummed over the water\. Pip and Bo can tap Keep going on a phone\./)).toBeTruthy();
  });

  it("says nothing when nothing was stopped", () => {
    mount({ campaign: FIRST });
    expect(screen.queryByText(/You stopped partway/)).toBeNull();
  });
});

describe("the lobby's campaign premise", () => {
  it("tells an empty lobby what it is about to start", () => {
    mount({ campaign: FIRST });
    expect(screen.getByText(PREMISE)).toBeTruthy();
  });

  it("gives way to the lineup once somebody has joined", () => {
    mount({ campaign: FIRST, party: [makeMember()] });
    expect(screen.queryByText(PREMISE)).toBeNull();
  });

  it("is not retold to the table that has just finished the campaign", () => {
    mount({ campaign: { ...FIRST, ended: "complete" }, party: [makeMember()] });
    expect(screen.queryByText(PREMISE)).toBeNull();
    // What that table does see is the way to go again.
    expect(screen.getByText(/Chapter 1:/)).toBeTruthy();
  });

  it("is not told before a later chapter", () => {
    mount({ campaign: { ...FIRST, next: { index: 4, title: "The Pride Roads" } } });
    expect(screen.queryByText(PREMISE)).toBeNull();
  });

  it("is not told at a routed fork nobody has chosen yet", () => {
    // `next: null` only happens past the first beat (CampaignView.next).
    mount({ campaign: { ...FIRST, next: null } });
    expect(screen.queryByText(PREMISE)).toBeNull();
  });
});

describe("a campaign the household has not unlocked (#221)", () => {
  const LOCKED: CampaignView = {
    id: "riftlight",
    title: "Riftlight",
    blurb: "The ground opens.",
    chapters: 6,
    next: { index: 1, title: "The Crack" },
    locked: { requires: ["gemfall"], reason: "Finish Gemfall first" },
  };

  it("says why, instead of the chapter it cannot start", () => {
    mount({ campaign: LOCKED, party: [makeMember()] });
    expect(screen.getByText(/Riftlight: Finish Gemfall first/)).toBeTruthy();
    expect(screen.queryByText(/Chapter 1:/)).toBeNull();
  });

  it("leaves an unlocked campaign's line as it was", () => {
    mount({ campaign: FIRST, party: [makeMember()] });
    expect(screen.getByText(/Chapter 1:/)).toBeTruthy();
    expect(screen.queryByText(/Finish/)).toBeNull();
  });
});

describe("the adventure cards", () => {
  const SEQUEL: CampaignView = {
    id: "riftlight",
    title: "Riftlight",
    blurb: "The ground opens.",
    chapters: 6,
    next: { index: 1, title: "The Crack" },
    locked: { requires: ["gemfall"], reason: "Finish Gemfall first" },
  };

  it("shows each adventure with its painting, a locked sequel asleep with its reason", () => {
    mount({ campaign: FIRST, campaignOptions: [FIRST, SEQUEL], campaignVotes: {}, party: [makeMember()] });
    const cards = screen.getByRole("list", { name: "Which adventure?" }).querySelectorAll("li");
    expect([...cards].map((card) => card.getAttribute("data-locked"))).toEqual(["false", "true"]);
    expect(cards[0]?.className).toContain("lobby__campaign--picked");
    expect(cards[1]?.textContent).toContain("Finish Gemfall first");
    expect(cards[0]?.querySelector("img")?.getAttribute("src")).toBe("/assets/campaigns/gemfall.webp");
  });

  it("leaves the premise to the cards, so the room code still fits a 720p TV", () => {
    mount({ campaign: FIRST, campaignOptions: [FIRST, SEQUEL], campaignVotes: {} });
    expect(screen.getByRole("list", { name: "Which adventure?" })).toBeTruthy();
    expect(screen.queryByText(PREMISE)).toBeNull();
  });

  it("draws no cards for a single adventure", () => {
    mount({ campaign: FIRST, campaignOptions: [FIRST], party: [makeMember()] });
    expect(screen.queryByRole("list", { name: "Which adventure?" })).toBeNull();
    expect(screen.getByText(/Chapter 1:/)).toBeTruthy();
  });
});

describe("the shared screen's line about where a graph campaign stands (#195)", () => {
  const journey = {
    node: "orchard",
    title: "The Orchard",
    visit: 1,
    status: "choosing" as const,
    chapter: "sampler-orchard",
    exits: [],
  };

  it("says where the party is deciding from, instead of a chapter number", () => {
    mount({
      campaign: { ...FIRST, id: "rift-sampler", title: "The Rift Sampler", next: null, journey },
      party: [makeMember()],
    });
    expect(screen.getByText("Deciding where to go from The Orchard")).toBeTruthy();
    expect(screen.queryByText(/Chapter \d/)).toBeNull();
  });

  it("an ordered campaign still gets its chapter line", () => {
    mount({ campaign: FIRST, party: [makeMember()] });
    expect(screen.getByText("Chapter 1: The City That Smelled Opportunity")).toBeTruthy();
    expect(screen.queryByText(/Deciding where to go/)).toBeNull();
  });
});

/*
 * The lineup is what the room watches fill up, so nothing one player does on
 * their phone may reflow anybody's card: readying up and dropping out only
 * change what is visible in seats that are always there.
 */
describe("a lobby card", () => {
  const card = (overrides: Parameters<typeof makeMember>[0]) => {
    mount({ party: [makeMember(overrides)] });
    const li = document.querySelector(".lobby-member")!;
    cleanup();
    return li;
  };
  const shape = (li: Element) =>
    [...li.querySelectorAll(".lobby-member__status > *")].map((chip) => chip.textContent);

  it("keeps both readiness words in the cell and only swaps which shows", () => {
    const waiting = card({ ready: false });
    const ready = card({ ready: true });
    expect(shape(waiting)).toEqual(shape(ready));
    expect(waiting.querySelector(".lobby-member__chip--off")?.textContent).toBe("Ready");
    expect(ready.querySelector(".lobby-member__chip--off")?.textContent).toBe("Tap Ready on your phone");
  });

  it("pins Away to the portrait instead of adding a row to the card", () => {
    const away = card({ connected: false });
    expect(away.querySelector(".lobby-member__seat")?.textContent).toContain("Away");
    expect(away.querySelector(".lobby-member__status")?.textContent).not.toContain("Away");
  });
});

// The first lobby render in a cold worker loads the QR encoder and the art table; on a busy CI runner that
// outlasts the default 5s, and it is the render that is slow, not the line.
describe("the join step on the shared screen (#256)", { timeout: 30_000 }, () => {
  const help = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "content", "help.json"), "utf8")) as { join: { text: string } };

  beforeEach(() => {
    resetHelpCache();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(help) })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says how to get in, in one line, under the code", async () => {
    mount({ campaign: FIRST });
    expect(await screen.findByText(help.join.text, {}, { timeout: 10_000 })).toBeTruthy();
  });

  it("is the same line for a family room and a visitor room, whatever the length of the code", async () => {
    cleanup();
    mount({ campaign: FIRST, visitorCode: "ABCDEF" });
    expect(await screen.findByText(help.join.text, {}, { timeout: 10_000 })).toBeTruthy();
    expect(screen.getByLabelText("Room code A B C D E F")).toBeTruthy();
  });

  it("stays while the room fills, because the next kid at the table needs it too", async () => {
    mount({ campaign: FIRST, party: [makeMember()] });
    expect(await screen.findByText(help.join.text, {}, { timeout: 10_000 })).toBeTruthy();
  });
});

describe("heroes new to the crew's adventure", () => {
  const check = { crewCheck: { campaignId: "riftlight", title: "Riftlight" }, party: [makeMember()] };

  it("lets the host keep going or start fresh, and resumes nothing by itself", async () => {
    const keepCrew = vi.fn(async () => true);
    const switchCrew = vi.fn(async () => true);
    useGameStore.setState({
      session: { runId: "r_1", roomCode: "ABCD", playerId: "", mode: "party", sessionToken: "t", host: true },
      state: makeState({ phase: "lobby", ...check }),
      keepCrew,
      switchCrew,
    });
    render(<LobbyContent />);
    expect(screen.getByText(/is partway through Riftlight/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Keep going with Riftlight" }));
    });
    expect(keepCrew).toHaveBeenCalledWith("riftlight");
    fireEvent.click(screen.getByRole("button", { name: "Start fresh as a new crew" }));
    expect(switchCrew).toHaveBeenCalledWith("new");
  });

  it("tells a screen that is not the host's who picks", () => {
    mount(check);
    expect(screen.getByText(/The grown-up running the game picks/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep going with Riftlight" })).toBeNull();
  });
});
