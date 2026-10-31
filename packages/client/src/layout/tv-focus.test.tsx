// @vitest-environment jsdom
/**
 * TV focus (Display settings): on a Party Mode phone the TV tells the story and the phone shows only
 * what to tap. With nothing to do, one card says look up instead of a long bag page; with a turn,
 * the turn alone, with no scene paragraph, goal card or picture to read past. Off by default, and
 * only where the shell has a TV.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Prompt } from "@kad/shared";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { resetFieldGuideCache } from "../screens/content";
import { dismissPlayerSheet } from "../store/player-navigation";
import { applyPrefs, DEFAULT_PREFS, loadPrefs, A11Y_KEY } from "../a11y/prefs";
import { A11yControl } from "../a11y/A11yControl";
import { useA11y } from "../a11y/store";
import { PartyLayout } from "./PartyLayout";
import { TravelLayout } from "./TravelLayout";

const choice: Prompt = {
  kind: "choice",
  sceneId: "scene_hedge_wall",
  options: [{ id: "squeeze", label: "Look for a gap", icon: "eye" }],
  forPlayerIds: ["p_1"],
  vote: false,
};

function seat(prompt: Prompt | null = null, mode: "party" | "travel" = "party", cls?: "starweaver"): void {
  localStorage.setItem("kad.device", JSON.stringify({ deviceToken: "dev_1" }));
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode, sessionToken: "t" },
    state: makeState({
      mode,
      phase: "scene",
      chapterId: "bramblewood-01",
      sceneId: "scene_hedge_wall",
      narration: "A wall of thorns twice your height blocks the path.",
      party: [makeMember({ playerId: "p_1", ...(cls ? { character: makeCharacter({ class: cls }) } : {}) })],
      prompt,
    }),
    chapter: null,
    progression: null,
    presentation: null,
    loadContent: async () => undefined,
    loadChapter: async () => undefined,
  });
}

function focus(on: boolean): void {
  act(() => applyPrefs({ ...DEFAULT_PREFS, focus: on }));
}

function tabs(): (string | null)[] {
  const nav = screen.getByRole("navigation", { name: "What to look at" });
  return [...nav.querySelectorAll("button")].map((b) => b.textContent);
}

function ask(prompt: Prompt | null): void {
  act(() => {
    const state = useGameStore.getState().state!;
    useGameStore.setState({ state: { ...state, seq: state.seq + 1, prompt } });
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  resetFieldGuideCache();
  dismissPlayerSheet();
  applyPrefs(DEFAULT_PREFS);
});

describe("TV focus, the setting", () => {
  it("is off unless saved, and puts its attribute on the root", () => {
    expect(loadPrefs().focus).toBe(false);
    localStorage.setItem(A11Y_KEY, JSON.stringify({ focus: true }));
    expect(loadPrefs().focus).toBe(true);
    applyPrefs(loadPrefs());
    expect(document.documentElement.getAttribute("data-focus")).toBe("tv");
    applyPrefs(DEFAULT_PREFS);
    expect(document.documentElement.hasAttribute("data-focus")).toBe(false);
  });

  it("is switched on and off in Display settings", () => {
    useA11y.setState({ prefs: DEFAULT_PREFS, open: true });
    render(<A11yControl />);
    act(() => screen.getByRole("button", { name: "TV focus on" }).click());
    expect(document.documentElement.getAttribute("data-focus")).toBe("tv");
    expect(loadPrefs().focus).toBe(true);
    act(() => screen.getByRole("button", { name: "TV focus off" }).click());
    expect(document.documentElement.hasAttribute("data-focus")).toBe(false);
    useA11y.setState({ prefs: DEFAULT_PREFS, open: false });
  });
});

describe("TV focus on a Party Mode phone", () => {
  it("changes nothing while it is off", () => {
    seat();
    render(<PartyLayout surface="player" />);
    expect(tabs()).toEqual(["World", "You", "Map", "Guide"]);
    expect(screen.queryByTestId("tv-rest")).toBeNull();
    expect(screen.getByText("Your stats")).not.toBeNull();
  });

  it("with nothing to do, shows one card that points at the TV, the bag a tap away and back", () => {
    seat();
    render(<PartyLayout surface="player" />);
    focus(true);
    expect(tabs()).toEqual(["You"]);
    expect(screen.getByTestId("tv-rest").textContent).toContain("Look at the TV");
    expect(screen.getByText("Your stats").closest("[hidden]")).not.toBeNull();

    act(() => screen.getByRole("button", { name: "Look in my bag" }).click());
    expect(screen.queryByTestId("tv-rest")).toBeNull();
    expect(screen.getByText("Your stats").closest("[hidden]")).toBeNull();
    act(() => screen.getByRole("button", { name: "Back to the TV" }).click());
    expect(screen.getByTestId("tv-rest")).not.toBeNull();
  });

  it("puts a turn up alone: the answers, a line pointing at the TV, and no scene paragraph or picture", () => {
    seat();
    const { container } = render(<PartyLayout surface="player" />);
    focus(true);
    act(() => screen.getByRole("button", { name: "Look in my bag" }).click());
    ask(choice);
    expect(screen.queryByTestId("tv-rest")).toBeNull();
    expect(screen.getByRole("button", { name: /Look for a gap/ })).not.toBeNull();
    expect(screen.getByTestId("tv-cue").textContent).toContain("Listen to the TV");
    expect(container.querySelector(".player__echo")).toBeNull();
    expect(container.querySelector(".player--scene")).toBeNull();

    // The turn taken, the card is back: peeking at the bag lasted one wait.
    ask(null);
    expect(screen.getByTestId("tv-rest")).not.toBeNull();
  });

  it("brings her controls back from the map when it goes on", () => {
    seat();
    const { container } = render(<PartyLayout surface="player" />);
    act(() => screen.getByRole("button", { name: "Map" }).click());
    focus(true);
    expect(container.querySelector('.kad-party__pane[data-showing="true"]')?.getAttribute("data-pane")).toBe("player");
  });

  it("keeps the World tab for a Starweaver, whose phone alone shows the Riftlight", () => {
    seat(null, "party", "starweaver");
    render(<PartyLayout surface="player" />);
    focus(true);
    expect(tabs()).toEqual(["World", "You"]);
  });
});

describe("TV focus where there is no TV", () => {
  it("does nothing in Travel Mode: the phone is the world there", () => {
    seat(null, "travel");
    render(<TravelLayout />);
    focus(true);
    expect(screen.queryByTestId("tv-rest")).toBeNull();
  });
});

describe("TV focus on a tablet held sideways", () => {
  it("shows the controls alone, not the world beside them", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("orientation: landscape") && query.includes("min-width: 900px"),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    seat();
    const { container } = render(<PartyLayout surface="player" />);
    const layout = container.querySelector(".kad-party--player")!;
    const showing = (): (string | null)[] =>
      [...container.querySelectorAll('.kad-party__pane[data-showing="true"]')].map((pane) => pane.getAttribute("data-pane"));
    expect(layout.hasAttribute("data-side-by-side")).toBe(true);
    expect(showing()).toEqual(["player", "world"]);

    focus(true);
    expect(layout.hasAttribute("data-side-by-side")).toBe(false);
    expect(showing()).toEqual(["player"]);
    expect(screen.getByTestId("tv-rest")).not.toBeNull();

    focus(false);
    expect(showing()).toEqual(["player", "world"]);
  });
});
