// @vitest-environment jsdom
/**
 * The story so far (#358), in the adventure book: what a chapter shows, the
 * older chapter that kept only its title, and the empty book.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JournalResponse } from "@kad/shared";
import { makeCharacter } from "../testing/fixtures";
import { useGameStore } from "../store";
import { JournalScreen } from "./JournalScreen";

function journal(over: Partial<JournalResponse> = {}): JournalResponse {
  return {
    heroes: [makeCharacter({ id: "c_1", name: "Sparklehoof" })],
    fieldGuide: {},
    finders: {},
    whereabouts: null,
    story: [
      {
        campaignId: "gemfall",
        title: "Gemfall",
        status: "active",
        chapters: [
          { chapterId: "gemfall-01", title: "The City That Smelled Opportunity", goal: "Get ready for the long trip north.", revealed: [], lastTime: [] },
          {
            chapterId: "gemfall-02",
            title: "Green Roads North",
            goal: "Travel the Sunward Fields and choose your road north.",
            outcome: "success",
            ending: "East, then.",
            revealed: ["The stones are pieces of one big thing.\n\nIt hums."],
            lastTime: ["You picked the River Road, east toward the crossing."],
          },
          { chapterId: "gemfall-03a", title: "The Long Mile", outcome: "setback", ending: "The crawlers carry off the snacks.", revealed: [], lastTime: [] },
        ],
      },
    ],
    ...over,
  };
}

async function open(found: JournalResponse) {
  useGameStore.setState({
    loadJournal: async () => ({ journal: found, savedAt: null }),
    items: {},
    loadContent: async () => undefined,
    loadWorld: async () => undefined,
  });
  render(<JournalScreen />);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Story" }));
  await screen.findByRole("heading", { name: "The story so far" });
}

afterEach(() => cleanup());

describe("the story so far", () => {
  it("lists each chapter in order with its goal, what it found out, what it chose and how it ended", async () => {
    await open(journal());
    const campaign = screen.getByRole("article", { name: "Gemfall" });
    expect(within(campaign).getByText("Still going")).toBeTruthy();
    const chapters = within(campaign).getAllByRole("listitem").filter((li) => li.classList.contains("story__chapter"));
    expect(chapters.map((li) => within(li).getByRole("heading").textContent)).toEqual([
      "The City That Smelled Opportunity",
      "Green Roads North",
      "The Long Mile",
    ]);

    const [older, played, turned] = chapters as [HTMLElement, HTMLElement, HTMLElement];
    // An older chapter kept only its title and goal: nothing else is made up for it.
    expect(older.textContent).toContain("Your goal: Get ready for the long trip north.");
    expect(older.querySelector(".story__ending, .story__revealed, .story__chose")).toBeNull();

    expect(played.querySelectorAll(".story__revealed p")).toHaveLength(3);
    expect(played.textContent).toContain("You picked the River Road");
    expect(played.textContent).toContain("How it ended: East, then.");
    expect(turned.textContent).toContain("The story took a turn. The crawlers carry off the snacks.");

    // A chapter is never ticked off.
    expect(campaign.textContent).not.toMatch(/\bdone\b/i);
  });

  it("says so when there is no story yet, and when this phone's copy is from before the page", async () => {
    await open(journal({ story: [] }));
    expect(screen.getByText(/no story yet/i)).toBeTruthy();
    cleanup();
    const { story: _story, ...old } = journal();
    await open(old);
    expect(screen.getByText(/not on this phone yet/i)).toBeTruthy();
  });
});
