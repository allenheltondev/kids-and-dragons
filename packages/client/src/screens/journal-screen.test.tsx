// @vitest-environment jsdom
/**
 * JournalScreen — between games.
 *
 * The promises: with no game running a phone can open its hero, read what
 * is in the bag, see the atlas and the Field Guide, and get from there into a
 * game. And it borrows the household's book only while it is open, so the
 * next room starts from its own.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ItemCatalog, JournalResponse, WorldMap } from "@kad/shared";
import { makeCharacter } from "../testing/fixtures";
import { useGameStore } from "../store";
import { getFieldGuideDiscoveries } from "../store/field-guide-discoveries";
import { currentRoute, navigate } from "../router";
import { JournalScreen, savedWhen } from "./JournalScreen";

const ITEMS: ItemCatalog = {
  honey_cake: { kind: "consumable", name: "Honey Cake", text: "Heals a little. Tastes like summer.", icon: "potion" },
};

const WORLD: WorldMap = {
  title: "The Realm of Red Sky",
  image: { src: "/assets/world/realm_of_red_sky.webp", width: 1400, height: 1243 },
  places: {
    sunward_fields: {
      id: "biome.sunward_fields",
      title: "The Sunward Fields",
      kind: "biome",
      anchor: { x: 470, y: 690 },
      parent: null,
    },
    glimmer_caves: {
      id: "biome.glimmer_caves",
      title: "The Glimmer Caves",
      kind: "biome",
      anchor: { x: 820, y: 410 },
      parent: null,
    },
  },
};

const SPARKLEHOOF = makeCharacter({
  id: "c_1",
  name: "Sparklehoof",
  inventory: [{ itemId: "honey_cake", kind: "consumable" }],
});
const THISTLE = makeCharacter({ id: "c_2", name: "Thistle", level: 2 });

function journal(overrides: Partial<JournalResponse> = {}): JournalResponse {
  return {
    heroes: [SPARKLEHOOF],
    fieldGuide: { "biome.sunward_fields": { firstFoundBy: "p_1", foundAt: "2026-07-04T18:00:00.000Z" } },
    finders: { p_1: "Sparklehoof" },
    whereabouts: { chapterId: "ch_1", biome: "sunward_fields" },
    ...overrides,
  };
}

function mount(found: JournalResponse | null | Error, savedAt: string | null = null) {
  const loadJournal = vi.fn(async () => {
    if (found instanceof Error) throw found;
    return found === null ? null : { journal: found, savedAt };
  });
  useGameStore.setState({
    loadJournal,
    items: ITEMS,
    world: WORLD,
    loadContent: async () => undefined,
    loadWorld: async () => undefined,
  });
  return { loadJournal, ...render(<JournalScreen />) };
}

afterEach(() => {
  cleanup();
});

describe("JournalScreen", () => {
  it("leaves the finished adventures to her own page, so the hero page does not say it twice", async () => {
    mount(
      journal({
        profile: { displayName: "Ada", badges: [], finds: { count: 0, recent: [] }, flair: { v: 1 } },
        finished: { c_1: [{ campaignId: "gemfall", title: "Gemfall", outcome: "setback", at: "2026-07-04T18:00:00.000Z" }] },
      }),
    );
    await screen.findByRole("region", { name: /sparklehoof's character sheet/i });
    expect(screen.queryByRole("region", { name: /adventures finished/i })).toBeNull();
  });

  it("keeps her finished adventures on the hero page when the book has no page of hers to list them", async () => {
    const line = { campaignId: "gemfall", title: "Gemfall", outcome: "success" as const, at: "2026-07-04T18:00:00.000Z" };
    mount(journal({ finished: { c_1: [line] } }));
    const finished = await screen.findByRole("region", { name: /adventures finished/i });
    expect(finished.textContent).toContain("Gemfall");
  });

  it("offers her page and the story even before she has a hero", async () => {
    const user = userEvent.setup();
    mount(journal({
      heroes: [],
      profile: { displayName: "Ada", badges: [], finds: { count: 0, recent: [] }, flair: { v: 1 } },
      story: [],
    }));
    expect(await screen.findByText(/no hero yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "My page" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Story" }));
    expect(await screen.findByRole("heading", { name: "The story so far" })).toBeTruthy();
  });

  it("opens your hero, and the bag says what each thing does", async () => {
    const user = userEvent.setup();
    mount(journal());

    expect(await screen.findByRole("region", { name: /sparklehoof's character sheet/i })).toBeTruthy();
    expect(screen.queryByText(/tastes like summer/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: /honey cake/i }));
    expect(screen.getByText(/tastes like summer/i)).toBeTruthy();
  });

  it("switches between heroes when there is more than one", async () => {
    const user = userEvent.setup();
    mount(journal({ heroes: [THISTLE, SPARKLEHOOF] }));

    expect(await screen.findByRole("region", { name: /thistle's character sheet/i })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Sparklehoof" }));
    expect(screen.getByRole("region", { name: /sparklehoof's character sheet/i })).toBeTruthy();
  });

  it("stands the party where they were last, not where they are", async () => {
    const user = userEvent.setup();
    mount(journal());
    await user.click(await screen.findByRole("button", { name: "Map" }));
    expect(screen.getByText("Last seen in The Sunward Fields.")).toBeTruthy();
    expect(screen.getByText("You were here")).toBeTruthy();
  });

  it("lends the guide the household's book while open, and takes it back on the way out", async () => {
    const { unmount } = mount(journal());
    await screen.findByRole("region", { name: /character sheet/i });
    await waitFor(() => expect(Object.keys(getFieldGuideDiscoveries())).toEqual(["biome.sunward_fields"]));
    unmount();
    expect(getFieldGuideDiscoveries()).toEqual({});
  });

  it("goes home to join or host a game from the tray", async () => {
    const user = userEvent.setup();
    navigate({ name: "journal" });
    mount(journal());
    await user.click(await screen.findByRole("button", { name: "Play" }));
    expect(currentRoute()).toEqual({ name: "home" });
  });

  it("says the book is empty on a phone that has never played, and offers a game", async () => {
    mount(null);
    expect(await screen.findByText(/your adventure book is empty/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /play a game/i })).toBeTruthy();
  });

  it("opens last time's book with no signal, and says so", async () => {
    const user = userEvent.setup();
    const { loadJournal } = mount(journal(), "2026-07-04T18:00:00.000Z");
    expect(await screen.findByRole("region", { name: /sparklehoof's character sheet/i })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/no signal/i);
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(loadJournal).toHaveBeenCalledTimes(2);
  });

  it("says nothing about signal when the book is fresh", async () => {
    mount(journal());
    await screen.findByRole("region", { name: /character sheet/i });
    expect(screen.queryByText(/no signal/i)).toBeNull();
  });

  it("offers to try again when the book cannot be fetched", async () => {
    const user = userEvent.setup();
    const { loadJournal } = mount(new Error("offline"));
    expect(await screen.findByText(/would not open/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(loadJournal).toHaveBeenCalledTimes(2);
  });
});

describe("the book of a household with crews", () => {
  // Fresh hero ids: the picked hero and crew are remembered for the life of the page.
  const OTTER_KID = makeCharacter({ id: "c_otter", name: "Bo" });
  const FAMILY_KID = makeCharacter({ id: "c_family", name: "Pip" });
  const story = (title: string) => [{ campaignId: "gemfall", title, status: "active" as const, chapters: [] }];
  const crews = (heroes = [OTTER_KID, FAMILY_KID]) =>
    journal({
      heroes,
      story: story("The family's Gemfall"),
      crews: [
        { id: null, name: "The first crew", story: story("The family's Gemfall"), whereabouts: { chapterId: "ch_1", biome: "sunward_fields" } },
        { id: "cw_1", name: "The Otter Crew", story: story("The Otter Crew's Gemfall"), whereabouts: { chapterId: "ch_9", biome: "glimmer_caves" } },
      ],
      // Bo plays with the Otter Crew, whichever fresh id a test gives her.
      heroCrews: Object.fromEntries(heroes.filter((h) => h.name === "Bo").map((h) => [h.id, "cw_1"])),
    });

  it("opens the story on the picked hero's crew, and switches to any other", async () => {
    const user = userEvent.setup();
    mount(crews());
    await user.click(await screen.findByRole("button", { name: "Story" }));
    expect(await screen.findByRole("heading", { name: "The Otter Crew's Gemfall" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "The Otter Crew", pressed: true })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "The first crew" }));
    expect(screen.getByRole("heading", { name: "The family's Gemfall" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "The Otter Crew's Gemfall" })).toBeNull();
  });

  it("follows the hero: another hero's book opens on her own crew", async () => {
    const user = userEvent.setup();
    mount(crews([makeCharacter({ id: "c_otter2", name: "Bo" }), makeCharacter({ id: "c_family2", name: "Pip" })]));
    await user.click(await screen.findByRole("button", { name: "Pip" }));
    await user.click(screen.getByRole("button", { name: "Story" }));
    // Pip is nobody's but the first crew's.
    expect(await screen.findByRole("heading", { name: "The family's Gemfall" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "The first crew", pressed: true })).toBeTruthy();
  });

  it("stands the map where the picked crew was last", async () => {
    const user = userEvent.setup();
    mount(crews([makeCharacter({ id: "c_otter3", name: "Bo" })]));
    await user.click(await screen.findByRole("button", { name: "Map" }));
    expect(screen.getByText("Last seen in The Glimmer Caves.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "The first crew" }));
    expect(screen.getByText("Last seen in The Sunward Fields.")).toBeTruthy();
  });

  it("shows no crews at a household that has only its first", async () => {
    const user = userEvent.setup();
    mount(journal({ story: story("The family's Gemfall") }));
    await user.click(await screen.findByRole("button", { name: "Story" }));
    expect(await screen.findByRole("heading", { name: "The family's Gemfall" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Whose story" })).toBeNull();
  });
});

describe("savedWhen", () => {
  const now = new Date(2026, 6, 10, 15, 0);
  it("reads a saved copy's age the way a kid would", () => {
    expect(savedWhen(new Date(2026, 6, 10, 9, 0).toISOString(), now)).toBe("earlier today");
    expect(savedWhen(new Date(2026, 6, 9, 22, 0).toISOString(), now)).toBe("yesterday");
    expect(savedWhen(new Date(2026, 6, 2, 12, 0).toISOString(), now)).toMatch(/2/);
    expect(savedWhen("not a date", now)).toBe("last time");
  });
});
