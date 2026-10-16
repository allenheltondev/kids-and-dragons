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
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ItemCatalog, JournalResponse, WorldMap } from "@kad/shared";
import { makeCharacter } from "../testing/fixtures";
import { useGameStore } from "../store";
import { getFieldGuideDiscoveries } from "../store/field-guide-discoveries";
import { currentRoute, navigate } from "../router";
import { JournalScreen } from "./JournalScreen";

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

function mount(found: JournalResponse | null | Error) {
  const loadJournal = vi.fn(async () => {
    if (found instanceof Error) throw found;
    return found;
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
    expect(Object.keys(getFieldGuideDiscoveries())).toEqual(["biome.sunward_fields"]);
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

  it("offers to try again when the book cannot be fetched", async () => {
    const user = userEvent.setup();
    const { loadJournal } = mount(new Error("offline"));
    expect(await screen.findByText(/would not open/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(loadJournal).toHaveBeenCalledTimes(2);
  });
});
