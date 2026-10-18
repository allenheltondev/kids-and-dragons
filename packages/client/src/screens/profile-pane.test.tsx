// @vitest-environment jsdom
/**
 * A kid's own page (#299), in the adventure book: what it shows, and that a
 * pick is saved as the whole choice and put back if it could not be.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JournalResponse, KidProfileView } from "@kad/shared";
import { makeCharacter } from "../testing/fixtures";
import { useGameStore } from "../store";
import { JournalScreen } from "./JournalScreen";

const SPARKLEHOOF = makeCharacter({ id: "c_1", name: "Sparklehoof", level: 3 });
const THISTLE = makeCharacter({ id: "c_2", name: "Thistle" });

const PROFILE: KidProfileView = {
  displayName: "Ada",
  badges: [
    { id: "finished:gemfall", name: "Gemfall Finisher", blurb: "You saw this adventure all the way to the end." },
    { id: "finds-1", name: "Sharp Eyes", blurb: "You spotted something new." },
  ],
  finds: { count: 4, recent: ["bramblewood", "moth"] },
  flair: { v: 1 },
};

function journal(over: Partial<JournalResponse> = {}): JournalResponse {
  return {
    heroes: [SPARKLEHOOF, THISTLE],
    fieldGuide: {},
    finders: {},
    whereabouts: null,
    finished: { c_1: [{ campaignId: "gemfall", title: "Gemfall", outcome: "setback", at: "2026-07-04T18:00:00.000Z" }] },
    profile: PROFILE,
    ...over,
  };
}

function mount(found: JournalResponse, saveFlair = vi.fn(async (c: Record<string, unknown>): Promise<KidProfileView> => ({
  ...PROFILE, flair: { v: 1, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null)) } as never,
}))) {
  useGameStore.setState({
    loadJournal: async () => ({ journal: found, savedAt: null }),
    saveFlair: saveFlair as never,
    items: {},
    loadContent: async () => undefined,
    loadWorld: async () => undefined,
  });
  render(<JournalScreen />);
  return saveFlair;
}

async function openPage() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Me" }));
  await screen.findByRole("heading", { name: "Ada" });
  return user;
}

afterEach(() => cleanup());

describe("her page", () => {
  it("shows her heroes with level and stats, her finished adventures, her finds and her badges", async () => {
    mount(journal());
    await openPage();

    const heroes = screen.getByRole("region", { name: /your heroes/i }).querySelectorAll(".profile__hero");
    expect(heroes).toHaveLength(2);
    expect(within(heroes[0] as HTMLElement).getByText("Sparklehoof")).toBeTruthy();
    expect(within(heroes[0] as HTMLElement).getByText("Level 3")).toBeTruthy();
    expect(within(heroes[0] as HTMLElement).getByRole("list", { name: /sparklehoof's stats/i })).toBeTruthy();

    expect(within(screen.getByRole("region", { name: /adventures finished/i })).getByText("Gemfall")).toBeTruthy();
    expect(screen.getByText(/you found/i).textContent).toContain("4 things");
    const badges = screen.getByRole("region", { name: /your badges/i });
    expect(within(badges).getByText("Gemfall Finisher")).toBeTruthy();
    expect(within(badges).getByText("Sharp Eyes")).toBeTruthy();
    // Nobody is ranked, and nothing is shared.
    expect(document.body.textContent).not.toMatch(/rank|leaderboard|share/i);
  });

  it("has a welcoming page for a kid with nothing yet", async () => {
    mount(journal({ heroes: [SPARKLEHOOF], finished: {}, profile: { ...PROFILE, badges: [], finds: { count: 0, recent: [] } } }));
    await openPage();
    expect(screen.getByText(/hiding behind a bush/i)).toBeTruthy();
    expect(screen.getByText(/none yet/i)).toBeTruthy();
    // No badge, no title to pick.
    expect(screen.queryByRole("radiogroup", { name: /pick a title/i })).toBeNull();
  });

  it("offers no page from a server that sends none", async () => {
    const { profile: _none, ...old } = journal();
    mount(old);
    await screen.findByRole("button", { name: "Guide" });
    expect(screen.queryByRole("button", { name: "Me" })).toBeNull();
  });

  it("saves a color as the whole choice, and says so", async () => {
    const save = mount(journal());
    const user = await openPage();
    await user.click(screen.getByRole("radio", { name: /berry/i }));
    expect(save).toHaveBeenCalledWith({ color: "berry", frames: null, title: null });
    await screen.findByText(/saved/i);
    expect(document.querySelector(".profile")?.getAttribute("data-profile-color")).toBe("berry");
    expect((screen.getByRole("radio", { name: /berry/i }) as HTMLInputElement).checked).toBe(true);
  });

  it("frames each hero on her own, and picks a title only from her badges", async () => {
    const save = mount(journal());
    const user = await openPage();
    const frames = screen.getByRole("radiogroup", { name: /frame for sparklehoof/i });
    await user.click(within(frames).getByRole("radio", { name: /ivy/i }));
    expect(save).toHaveBeenLastCalledWith({ color: null, frames: { c_1: "ivy" }, title: null });

    const titles = screen.getByRole("radiogroup", { name: /pick a title/i });
    expect(within(titles).getAllByRole("radio").map((r) => (r as HTMLInputElement).labels?.[0]?.textContent?.replace("Selected", ""))).toEqual([
      "No title", "Gemfall Finisher", "Sharp Eyes",
    ]);
    await user.click(within(titles).getByRole("radio", { name: /gemfall finisher/i }));
    expect(save).toHaveBeenLastCalledWith({ color: null, frames: { c_1: "ivy" }, title: "finished:gemfall" });
    await waitFor(() => expect(screen.getByText("Gemfall Finisher", { selector: ".profile__title" })).toBeTruthy());
  });

  it("puts a pick back and says so when it could not be saved", async () => {
    const save = vi.fn(async () => { throw new Error("offline"); });
    mount(journal(), save as never);
    const user = await openPage();
    await user.click(screen.getByRole("radio", { name: /plum/i }));
    expect(await screen.findByText(/could not save that/i)).toBeTruthy();
    expect(document.querySelector(".profile")?.getAttribute("data-profile-color")).toBe("meadow");
    expect((screen.getByRole("radio", { name: /plum/i }) as HTMLInputElement).checked).toBe(false);
  });
});
