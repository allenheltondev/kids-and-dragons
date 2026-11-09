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
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beginEncounter, parseBoard, type EncounterState, type ItemCatalog, type JournalResponse, type RunState, type WorldMap } from "@kad/shared";
import { makeRules } from "../../../shared/src/test-fixtures";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { getFieldGuideDiscoveries, setFieldGuideDiscoveries } from "../store/field-guide-discoveries";
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

  describe("seated at a live game (docs/camp.md §7)", () => {
    const reconnect = vi.fn();
    const seat = (prompt: RunState["prompt"] = null, over: Partial<RunState> = {}, synced = true) => {
      const beat = vi.fn();
      reconnect.mockClear();
      useGameStore.setState({
        session: { runId: "r_1", roomCode: "WXYZ", playerId: "p_1", mode: "party", sessionToken: "t" },
        state: makeState({ roomCode: "WXYZ", phase: "scene", party: [makeMember({ playerId: "p_1", character: SPARKLEHOOF })], prompt, ...over }),
        synced,
        beat,
        reconnect,
      });
      return beat;
    };
    /** A fight on Sparklehoof's turn: the game wants her with no prompt at all. */
    const herTurn = (): EncounterState => {
      const encounter = beginEncounter(
        {
          board: parseBoard([".....", ".....", ".....", ".....", "....."]),
          party: [{ character: SPARKLEHOOF, at: { x: 1, y: 1 } }],
          enemies: [{ spec: { id: "wisp", name: "Bramblewisp", count: 1, hp: 6, guard: 11, quick: 3, steps: 5, attack: 3 }, at: { x: 3, y: 2 } }],
        },
        { rules: makeRules(), abilities: {}, rng: { next: () => 0.5 } },
      );
      return { ...encounter, turnIndex: encounter.order.indexOf("c_1") };
    };
    afterEach(() => {
      useGameStore.setState({ session: null, state: null });
      setFieldGuideDiscoveries(null);
    });

    it("leaves the game's own guide as it is, and as it is on the way back to the game", async () => {
      const live = { "biome.mossy_hollow": { firstFoundBy: "p_2", foundAt: "2026-11-08T18:00:00.000Z" } };
      setFieldGuideDiscoveries(live);
      seat();
      const { unmount } = mount(journal());
      expect(await screen.findByRole("button", { name: "Play" })).toBeTruthy();
      expect(getFieldGuideDiscoveries()).toEqual(live);
      // A live patch while the book is open stands; the journal's older copy never replaces it.
      const later = { ...live, "creature.bramblewisp": { firstFoundBy: "p_1", foundAt: "2026-11-08T18:05:00.000Z" } };
      act(() => setFieldGuideDiscoveries(later));
      expect(getFieldGuideDiscoveries()).toEqual(later);
      unmount();
      expect(getFieldGuideDiscoveries()).toEqual(later);
    });

    it("wakes the game's stream when the signal goes, as the game's own pages do", async () => {
      seat();
      mount(journal());
      expect(await screen.findByRole("button", { name: "Play" })).toBeTruthy();
      act(() => { window.dispatchEvent(new Event("offline")); });
      expect(reconnect).toHaveBeenCalled();
    });

    it("says so on her turn in a fight, where there is no prompt", async () => {
      seat(null, { sceneType: "encounter", encounter: herTurn() });
      mount(journal());
      expect((await screen.findByTestId("journal-turn")).textContent).toContain("The game is waiting for you!");
    });

    it("says nothing from a mirror still catching up", async () => {
      seat({ kind: "ready", forPlayerIds: ["p_1"] }, {}, false);
      mount(journal());
      expect(await screen.findByRole("button", { name: "Play" })).toBeTruthy();
      expect(screen.queryByTestId("journal-turn")).toBeNull();
    });

    it("goes back to the game from the tray, and keeps saying she is there", async () => {
      const user = userEvent.setup();
      const beat = seat();
      navigate({ name: "journal" });
      mount(journal());
      expect(beat).toHaveBeenCalled();
      expect(screen.queryByTestId("journal-turn")).toBeNull();
      await user.click(await screen.findByRole("button", { name: "Play" }));
      expect(currentRoute()).toEqual({ name: "player", code: "WXYZ" });
    });

    it("says when the game is waiting for her, with the way back", async () => {
      const user = userEvent.setup();
      seat({ kind: "ready", forPlayerIds: ["p_1"] });
      navigate({ name: "journal" });
      mount(journal());
      expect((await screen.findByTestId("journal-turn")).textContent).toContain("The game is waiting for you!");
      await user.click(screen.getByRole("button", { name: "Back to the game" }));
      expect(currentRoute()).toEqual({ name: "player", code: "WXYZ" });
    });
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

describe("savedWhen", () => {
  const now = new Date(2026, 6, 10, 15, 0);
  it("reads a saved copy's age the way a kid would", () => {
    expect(savedWhen(new Date(2026, 6, 10, 9, 0).toISOString(), now)).toBe("earlier today");
    expect(savedWhen(new Date(2026, 6, 9, 22, 0).toISOString(), now)).toBe("yesterday");
    expect(savedWhen(new Date(2026, 6, 2, 12, 0).toISOString(), now)).toMatch(/2/);
    expect(savedWhen("not a date", now)).toBe("last time");
  });
});

