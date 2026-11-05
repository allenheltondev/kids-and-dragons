// @vitest-environment jsdom
/**
 * The chapter end's camp beat on the TV (#620, docs/camp.md §3, §8.5, §12.5):
 * it follows the tally once the shop vote (if any) is done, lists what was
 * found or bought beside the campfire with where it goes, says a grown camp,
 * and is read-only: nothing to press, nothing waited on.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CampView, RunState } from "@kad/shared";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { CampBeat, campBeatDue } from "./CampChapterEnd";
import { campBeatShown, setCampBeat } from "../world/camp-beat";

afterEach(() => {
  cleanup();
  setCampBeat(false);
});

const camp = (over: Partial<CampView> = {}): CampView => ({
  revision: 2,
  frameStage: 2,
  grownBy: ["gemfall"],
  dashCash: 3,
  owned: ["find_noodle_awning", "shop_striped_awning"],
  placed: { awning: "shop_striped_awning" },
  friends: [],
  buddies: {},
  shopOpen: true,
  ...over,
});

const end = (over: Partial<RunState> = {}): RunState =>
  makeState({
    phase: "chapter_complete",
    endingRead: true,
    party: [makeMember({ playerId: "p_1", character: makeCharacter({ id: "c_1", name: "Sparklehoof" }) })],
    camp: camp(),
    campMoment: { id: "chapterEnd|r:c:9", kind: "chapterEnd", outdoor: true, changes: {} },
    campFinds: [{ kind: "camp", pieceId: "find_noodle_awning", rewardId: "riftlight-exchange-rift.noodle_awning", sceneId: "s" }],
    ...over,
  });

describe("when the camp beat comes", () => {
  it("after the tally, and not while the shop vote is under way", () => {
    expect(campBeatDue(end(), false, false)).toBe(false);
    expect(campBeatDue(end(), false, true)).toBe(true);
    const voting = { visit: "v", balance: 9, options: [{ pieceId: "shop_log_bench", label: "Log bench", price: 5, after: 4 }], votes: {} };
    expect(campBeatDue(end({ campShop: voting }), false, true)).toBe(false);
    expect(campBeatDue(end({ campShop: { ...voting, result: { kind: "saved" } } }), false, true)).toBe(true);
    // Not on the ending's own page, and not without a camp to show.
    expect(campBeatDue(end({ endingRead: false }), false, true)).toBe(false);
    expect(campBeatDue(end({ camp: undefined }), false, true)).toBe(false);
  });
});

describe("the camp beat", () => {
  it("lists a find beside the campfire with where it goes, and leaves the kid's pick up", () => {
    render(<CampBeat state={end()} />);
    const beside = screen.getByTestId("camp-beside");
    expect(beside.textContent).toContain("Noodle awning: it goes on the awning. Put it up with Camp on a phone.");
    expect(screen.getByText("Back at camp")).toBeTruthy();
    // Read-only, like the rest of the shared screen.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/Back to the lobby/)).toBeTruthy();
  });

  it("says a grown camp", () => {
    render(<CampBeat state={end({ camp: camp({ grew: true }), campFinds: [] })} />);
    expect(screen.getByRole("heading", { name: "Your camp grew!" })).toBeTruthy();
    expect(screen.queryByTestId("camp-beside")).toBeNull();
  });

  it("is a page turn local to the screen, which the stage hears", () => {
    expect(campBeatShown()).toBe(false);
    setCampBeat(true);
    expect(campBeatShown()).toBe(true);
  });
});
