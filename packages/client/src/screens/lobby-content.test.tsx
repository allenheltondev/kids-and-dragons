// @vitest-environment jsdom
/**
 * LobbyContent — when the shared screen tells the campaign's premise.
 *
 * Only in an empty lobby before chapter 1: that is when the room is reading
 * the TV, and once the lineup starts a full party has to fit a 720p screen
 * nobody can scroll. A table back in the lobby after finishing the campaign
 * is never told it again (campaign-copy `campaignPremise`).
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CampaignView, RunState } from "@kad/shared";
import { makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
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
