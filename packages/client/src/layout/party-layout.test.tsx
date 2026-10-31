// @vitest-environment jsdom
/**
 * PartyLayout — the phone's map, and who gets to take it away.
 *
 * In Party Mode the TV is the world and the phone is your controls; the map is
 * the one thing the phone shows on request. The shell owns the rule Travel
 * Mode already has for every surface that is not your controls: the moment
 * the game is waiting on you, your controls come back, whatever you were
 * looking at. A question that sat behind the map would be a turn nobody took.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { Prompt } from "@kad/shared";
import { makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { resetFieldGuideCache } from "../screens/content";
import { dismissPlayerSheet, usePlayerNavigation } from "../store/player-navigation";
import { PartyLayout } from "./PartyLayout";
import { useHelpFocus } from "../help/focus";

function mount(prompt: Prompt | null = null, phone = true) {
  // A phone that plays remembers her (a device token); a family tablet's pick holds only a seat (#299).
  if (phone) localStorage.setItem("kad.device", JSON.stringify({ deviceToken: "dev_1" }));
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "party", sessionToken: "t" },
    state: makeState({
      mode: "party",
      phase: "scene",
      chapterId: "bramblewood-01",
      sceneId: "scene_hedge_wall",
      party: [makeMember({ playerId: "p_1" })],
      prompt,
    }),
    chapter: null,
    progression: null,
    presentation: null,
    loadContent: async () => undefined,
    loadChapter: async () => undefined,
  });
  return render(<PartyLayout surface="player" />);
}

function showing(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.kad-party__pane[data-showing="true"]')].map(
    (pane) => pane.getAttribute("data-pane") ?? "",
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  resetFieldGuideCache();
  dismissPlayerSheet();
});

describe("Party Mode and the map", () => {
  it("adds the adventure book to the tray for a kid seated on a family tablet (#299), and only there", () => {
    mount(null, false);
    const nav = screen.getByRole("navigation", { name: "What to look at" });
    expect([...nav.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["World", "You", "Map", "Guide", "Book"]);
  });

  it("preserves the world subtree across World, You and Map visits", () => {
    const { container } = mount();
    const narration = container.querySelector('[data-pane="world"] .narration');
    expect(narration).not.toBeNull();
    for (const name of ["World", "Map", "You", "World"]) {
      act(() => screen.getByRole("button", { name }).click());
      expect(container.querySelector('[data-pane="world"] .narration')).toBe(narration);
    }
  });

  it("offers live room mode switching in settings, outside the four-tab tray", () => {
    const send = vi.fn(async () => true);
    useGameStore.setState({ send });
    mount();
    const nav = screen.getByRole("navigation", { name: "What to look at" });
    expect(nav.querySelectorAll("button")).toHaveLength(4);
    // Folded at the foot of the You page until it is opened.
    const settings = screen.getByRole("button", { name: "Room settings" });
    expect(settings.getAttribute("aria-expanded")).toBe("false");
    act(() => settings.click());
    expect(settings.getAttribute("aria-expanded")).toBe("true");
    act(() => screen.getByRole("button", { name: "No TV? Show the world on the phones" }).click());
    expect(send).toHaveBeenCalledWith({ type: "SET_MODE", mode: "travel" });
    act(() => {
      const state = useGameStore.getState().state!;
      useGameStore.setState({ state: { ...state, mode: "travel" } });
    });
    act(() => screen.getByRole("button", { name: "Use a TV for the world" }).click());
    expect(send).toHaveBeenLastCalledWith({ type: "SET_MODE", mode: "party" });
  });
  it("dismisses a character sheet when the already-selected You destination is tapped", () => {
    mount();
    act(() => screen.getByRole("button", { name: /Sparklehoof's character sheet/ }).click());
    expect(screen.getByRole("region", { name: "Sparklehoof's character sheet" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^close$/i })).toBeNull();
    act(() => screen.getByRole("button", { name: /^you$/i }).click());
    expect(screen.queryByRole("region", { name: "Sparklehoof's character sheet" })).toBeNull();
    expect(screen.getByRole("button", { name: /Sparklehoof's character sheet/ })).toBeTruthy();
  });
  it("offers four destinations and returns from World to a new turn", () => {
    const { container } = mount();
    const nav = screen.getByRole("navigation", { name: "What to look at" });
    expect([...nav.querySelectorAll("button")].map((button) => button.textContent?.trim())).toEqual(["World", "You", "Map", "Guide"]);
    act(() => screen.getByRole("button", { name: /^world$/i }).click());
    expect(showing(container)).toEqual(["world"]);
    act(() => {
      const state = useGameStore.getState().state;
      if (!state) throw new Error("no state");
      useGameStore.setState({ state: { ...state, prompt: {
        kind: "choice", sceneId: "scene_hedge_wall", vote: false,
        options: [{ id: "gap", label: "Find a gap", icon: "eye" }],
        forPlayerIds: ["p_1"],
      } } });
    });
    expect(showing(container)).toEqual(["player"]);
  });
  it("shows the controls, with the map a tap away", () => {
    const { container } = mount();
    expect(showing(container)).toEqual(["player"]);
    expect(screen.getByRole("button", { name: /^map$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^you$/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("swaps the controls for the map on request, and back", () => {
    const { container } = mount();
    act(() => {
      screen.getByRole("button", { name: /^map$/i }).click();
    });
    expect(showing(container)).toEqual(["map"]);
    // The controller is hidden, not gone: a half-made selection survives.
    expect(container.querySelector('[data-pane="player"]')).not.toBeNull();

    act(() => {
      screen.getByRole("button", { name: /^you$/i }).click();
    });
    expect(showing(container)).toEqual(["player"]);
  });

  it("opens on the turn, not the bag, for a phone that reloads or rejoins mid-turn", () => {
    mount({
      kind: "choice",
      sceneId: "scene_hedge_wall",
      options: [{ id: "squeeze", label: "Look for a gap", icon: "eye" }],
      forPlayerIds: ["p_1"],
      vote: false,
    });
    // Visible: a role query skips anything under `hidden`.
    expect(screen.getByRole("button", { name: /Look for a gap/ })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Your turn" })).toBeNull();
  });

  it("takes the map away the moment the game asks you something", () => {
    const { container } = mount();
    act(() => {
      screen.getByRole("button", { name: /^map$/i }).click();
    });
    expect(showing(container)).toEqual(["map"]);

    act(() => {
      const state = useGameStore.getState().state;
      if (state === null) throw new Error("no state");
      useGameStore.setState({
        state: {
          ...state,
          seq: state.seq + 1,
          prompt: {
            kind: "choice",
            sceneId: "scene_hedge_wall",
            options: [{ id: "squeeze", label: "Look for a gap", icon: "eye" }],
            forPlayerIds: ["p_1"],
            vote: false,
          },
        },
      });
    });
    expect(showing(container)).toEqual(["player"]);
  });

  it("returns to controls for a new prompt even when it is still my turn", () => {
    const { container } = mount({
      kind: "choice",
      sceneId: "scene_hedge_wall",
      options: [{ id: "first", label: "First", icon: "eye" }],
      forPlayerIds: ["p_1"],
      vote: true,
    });
    act(() => {
      screen.getByRole("button", { name: /^map$/i }).click();
    });
    expect(showing(container)).toEqual(["map"]);

    // Another vote updates the same question; it should not steal focus.
    act(() => {
      const state = useGameStore.getState().state;
      if (!state || state.prompt?.kind !== "choice") throw new Error("no choice");
      useGameStore.setState({
        state: {
          ...state,
          seq: state.seq + 1,
          prompt: { ...state.prompt, votes: { p_1: "first" } },
        },
      });
    });
    expect(showing(container)).toEqual(["map"]);

    // Answering A moves directly into another question for p_1: the "my
    // turn" boolean never becomes false between the two state snapshots.
    act(() => {
      const state = useGameStore.getState().state;
      if (!state) throw new Error("no state");
      useGameStore.setState({
        state: {
          ...state,
          seq: state.seq + 1,
          sceneId: "scene_next",
          prompt: {
            kind: "choice",
            sceneId: "scene_next",
            options: [{ id: "second", label: "Second", icon: "eye" }],
            forPlayerIds: ["p_1"],
            vote: false,
          },
        },
      });
    });
    expect(showing(container)).toEqual(["player"]);
  });

  it("never offers the map on the TV", () => {
    useGameStore.setState({
      session: { runId: "r_1", roomCode: "ABCD", playerId: "", mode: "party", sessionToken: "" },
      state: makeState({ mode: "party" }),
      loadContent: async () => undefined,
      loadChapter: async () => undefined,
    });
    render(<PartyLayout surface="world" />);
    expect(screen.queryByRole("button", { name: /map/i })).toBeNull();
  });
});

describe("Party Mode and the Field Guide (#112)", () => {
  const guideJson = { version: 1, entries: { "creature.a": { id: "creature.a", category: "creatures", title: "A" } } };
  function stubGuide() {
    vi.stubGlobal("fetch", vi.fn((url: string) => String(url).includes("field-guide")
      ? Promise.resolve({ ok: true, json: async () => guideJson } as unknown as Response)
      : new Promise<Response>(() => undefined)));
    resetFieldGuideCache();
  }
  const turn: Prompt = {
    kind: "choice", sceneId: "scene_hedge_wall", vote: false,
    options: [{ id: "gap", label: "Find a gap", icon: "eye" }],
    forPlayerIds: ["p_1"],
  };

  it("is a permanent tray destination that opens the guide in the player pane", async () => {
    stubGuide();
    const { container } = mount();
    const guide = screen.getByRole("button", { name: /^guide$/i });
    expect(guide.getAttribute("aria-pressed")).toBe("false");
    act(() => screen.getByRole("button", { name: /^map$/i }).click());
    act(() => guide.click());
    expect(showing(container)).toEqual(["player"]);
    expect(guide.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^you$/i }).getAttribute("aria-pressed")).toBe("false");
    expect(await screen.findByRole("region", { name: "Field Guide" })).toBeTruthy();
    expect(usePlayerNavigation.getState().section).toBe("guide");
  });

  it("never hides the turn: You keeps its badge, and one tap brings the bag back", async () => {
    stubGuide();
    mount(turn);
    act(() => screen.getByRole("button", { name: /^guide$/i }).click());
    await screen.findByRole("region", { name: "Field Guide" });
    const you = screen.getByRole("button", { name: /^you$/i });
    expect(within(you).getByLabelText("Your turn")).toBeTruthy();
    act(() => you.click());
    expect(screen.queryByRole("region", { name: "Field Guide" })).toBeNull();
    expect(screen.getByRole("button", { name: /^your turn$/i })).toBeTruthy();
  });

  it("works before there is a character, without unmounting creation", async () => {
    stubGuide();
    const { container } = mount();
    act(() => {
      const state = useGameStore.getState().state!;
      useGameStore.setState({ state: { ...state, party: [] } });
    });
    const creation = container.querySelector(".player-view__creation");
    expect(creation).not.toBeNull();
    act(() => screen.getByRole("button", { name: /^guide$/i }).click());
    expect(await screen.findByRole("region", { name: "Field Guide" })).toBeTruthy();
    expect(container.querySelector(".player-view__creation")).toBe(creation);
    expect(creation?.hasAttribute("hidden")).toBe(true);
  });
});

describe("Party Mode on a tablet held sideways", () => {
  /** matchMedia as a landscape tablet (layout/landscape.ts). */
  function sideways() {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query.includes("orientation: landscape"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })));
  }

  it("shows the world beside the controls, and the map in its place on request", () => {
    sideways();
    const { container } = mount();
    expect(container.querySelector(".kad-party--player")?.hasAttribute("data-side-by-side")).toBe(true);
    expect(showing(container).sort()).toEqual(["player", "world"]);
    act(() => screen.getByRole("button", { name: /^map$/i }).click());
    expect(showing(container).sort()).toEqual(["map", "player"]);
    expect(screen.getByRole("button", { name: /^map$/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^you$/i }).getAttribute("aria-pressed")).toBe("true");
    act(() => screen.getByRole("button", { name: /^world$/i }).click());
    expect(showing(container).sort()).toEqual(["player", "world"]);
  });

  it("leaves the map up for a new question, since the controls are already in view", () => {
    sideways();
    const { container } = mount();
    act(() => screen.getByRole("button", { name: /^map$/i }).click());
    act(() => {
      const state = useGameStore.getState().state;
      if (!state) throw new Error("no state");
      useGameStore.setState({ state: { ...state, prompt: {
        kind: "choice", sceneId: "scene_hedge_wall", vote: false,
        options: [{ id: "gap", label: "Find a gap", icon: "eye" }],
        forPlayerIds: ["p_1"],
      } } });
    });
    expect(showing(container).sort()).toEqual(["map", "player"]);
    // No ★ to call her back: the question is already on the screen.
    expect(container.querySelector(".kad-tray__badge")).toBeNull();
  });

  it("explains the pane she last went to: the map, then her controls beside it", () => {
    sideways();
    mount();
    act(() => screen.getByRole("button", { name: /^map$/i }).click());
    expect(useHelpFocus.getState().pane).toBe("map");
    // You shuts the drawer, so the "?" stays with the map; tapping it again brings the controls back.
    act(() => screen.getByRole("button", { name: /^you$/i }).click());
    expect(useHelpFocus.getState().pane).toBe("map");
    act(() => screen.getByRole("button", { name: /^you$/i }).click());
    expect(useHelpFocus.getState().pane).toBe("player");
    act(() => screen.getByRole("button", { name: /^map$/i }).click());
    act(() => screen.getByRole("button", { name: /^guide$/i }).click());
    expect(useHelpFocus.getState().pane).toBe("player");
  });

  it("keeps one surface at a time on a phone", () => {
    const { container } = mount();
    expect(container.querySelector(".kad-party--player")?.hasAttribute("data-side-by-side")).toBe(false);
    expect(showing(container)).toEqual(["player"]);
  });
});
