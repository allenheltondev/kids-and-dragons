// @vitest-environment jsdom
/**
 * TravelLayout — which surface the phone is showing, and who gets to decide.
 *
 * One surface at a time (spec §2.2), and the shell owns every rule about which:
 * your turn pushes your controls forward, the toggle takes you back, a roll
 * takes the world for its ~1.5s. The surfaces are not allowed to know any of it.
 *
 * This file exists for the case that rule set had a hole in. A transformation
 * is drawn by `TransformCutscene` inside `WorldView`, and in Travel Mode the
 * pane it lives in is `display: none` whenever the player is looking at their
 * own controls — which, at the end of a chapter, is whoever just tapped the
 * choice that finished it. spec §8.1's "single most important moment in the
 * game" played invisibly for exactly the person most likely to have earned it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { useGameStore } from "../store";
import { TravelLayout } from "./TravelLayout";
import { rollCardMs } from "../world/presentation";
import { useHelpFocus } from "../help/focus";

function character(): ResolvedCharacter {
  return {
    id: "c_1",
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 4,
    xp: 700,
    tier: "sworn",
    stats: { might: 2, quick: 3, clever: 3, heart: 5 },
    unspentPoints: 1,
    spendableStats: ["might", "quick", "clever", "heart"],
    committedLevel: 4,
    maxHp: 10,
    steps: 4,
    guard: 11,
    attackStat: "heart",
    actions: [],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: true,
  };
}

const MEMBER: PartyMember = {
  character: character(),
  playerId: "p_1",
  hp: 10,
  down: false,
  connected: true,
  ready: true,
};

function state(): RunState {
  return {
    runId: "r_1",
    roomCode: "ABCD",
    mode: "travel",
    seq: 9,
    // Nobody is being asked anything, which is what makes `focus` stick to
    // wherever the player last was — the state this whole file is about.
    phase: "chapter_complete",
    campaignId: "c",
    chapterId: "bramblewood-01",
    sceneId: "rest_lanternfall",
    sceneType: "rest",
    narration: "",
    art: null,
    party: [MEMBER],
    prompt: null,
    lastRoll: null,
    flags: {},
    xpEarned: 300,
    updatedAt: "2026-08-16T12:00:00.000Z",
  };
}

function mount() {
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "travel", sessionToken: "t" },
    state: state(),
    progression: null,
    presentation: null,
    loadContent: async () => undefined,
    loadChapter: async () => undefined,
  });
  return render(<TravelLayout />);
}

/** Which pane the shell is actually showing, read the way the CSS reads it. */
function showing(container: HTMLElement): "world" | "map" | "player" | "neither" {
  const on = [...container.querySelectorAll('.kad-travel__pane[data-showing="true"]')];
  if (on.length !== 1) return "neither";
  const pane = on[0]?.getAttribute("data-pane");
  return pane === "world" || pane === "map" || pane === "player" ? pane : "neither";
}

/** The tab with this label, the way a thumb finds it. */
function tab(container: HTMLElement, label: string): HTMLElement {
  const found = [...container.querySelectorAll(".kad-travel__tab")].find(
    (el) => el.textContent?.includes(label) ?? false,
  );
  if (!found) throw new Error(`no ${label} tab`);
  return found as HTMLElement;
}

function crossTiers(seq: number, count: number) {
  act(() => {
    useGameStore.setState({
      progression: {
        seq,
        progression: {
          characters: [MEMBER.character],
          awards: Array.from({ length: count }, (_, i) => ({
            characterId: `c_${String(i + 1)}`,
            newTier: "sworn",
          })) as never,
        },
      },
    });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Travel Mode and the transformation", () => {
  it("brings the world forward for a tier crossing, wherever the player was", () => {
    const { container } = mount();

    // Put the player on their own controls, the way tapping anything does.
    act(() => {
      tab(container, "You").click();
    });
    expect(showing(container)).toBe("player");

    crossTiers(10, 1);
    expect(showing(container)).toBe("world");
  });

  it("holds it for the whole queue, not just one beat", () => {
    /*
     * Uniform XP means the whole party can cross on the same evening (§8.1), so
     * the queue is not a fixed duration. A hold sized for one character would
     * drop the pane back in the middle of somebody else's moment.
     */
    const { container } = mount();
    act(() => {
      tab(container, "You").click();
    });

    crossTiers(10, 3);
    expect(showing(container)).toBe("world");

    // One beat in — two still to play.
    act(() => {
      vi.advanceTimersByTime(3300);
    });
    expect(showing(container)).toBe("world");

    // Two beats in.
    act(() => {
      vi.advanceTimersByTime(3300);
    });
    expect(showing(container)).toBe("world");
  });

  it("gives the phone back when the last beat is done", () => {
    const { container } = mount();
    act(() => {
      tab(container, "You").click();
    });

    crossTiers(10, 1);
    act(() => {
      vi.advanceTimersByTime(3300 + 400 + 50);
    });
    expect(showing(container)).toBe("player");
  });

  it("does not take the screen for a level-up that crossed no tier", () => {
    // Most level-ups are not transformations. Grabbing the phone for every one
    // of them would make the toggle feel broken.
    const { container } = mount();
    act(() => {
      tab(container, "You").click();
    });

    act(() => {
      useGameStore.setState({
        progression: {
          seq: 10,
          progression: {
            characters: [MEMBER.character],
            awards: [{ characterId: "c_1", leveledTo: 3 }] as never,
          },
        },
      });
    });

    expect(showing(container)).toBe("player");
  });
});

describe("Travel Mode and the map", () => {
  it("brings the map up on request, and the toggle takes you back", () => {
    const { container } = mount();
    expect(showing(container)).toBe("world");

    act(() => {
      tab(container, "Map").click();
    });
    expect(showing(container)).toBe("map");
    expect(container.querySelector('[data-surface="map"]')).not.toBeNull();

    act(() => {
      tab(container, "World").click();
    });
    expect(showing(container)).toBe("world");
  });

  it("takes the map away the moment the game asks you something", () => {
    // Nobody is being asked anything in `state()`, so the map sticks until the
    // next question — and the next question must reach you through it.
    const { container } = mount();
    act(() => {
      tab(container, "Map").click();
    });
    expect(showing(container)).toBe("map");

    act(() => {
      useGameStore.setState({
        state: {
          ...state(),
          seq: 10,
          phase: "scene",
          prompt: {
            kind: "choice",
            sceneId: "rest_lanternfall",
            options: [{ id: "on", label: "Onward", icon: "arrow" }],
            forPlayerIds: ["p_1"],
            vote: false,
          },
        },
      });
    });
    expect(showing(container)).toBe("player");
  });

  it("shows consecutive questions for the same player without interrupting the current one", () => {
    const { container } = mount();
    act(() => {
      useGameStore.setState({
        state: {
          ...state(),
          seq: 10,
          phase: "scene",
          sceneId: "scene_first",
          prompt: {
            kind: "choice",
            sceneId: "scene_first",
            options: [{ id: "a", label: "First question", icon: "eye" }],
            forPlayerIds: ["p_1"],
            vote: true,
          },
        },
      });
    });
    expect(showing(container)).toBe("player");
    act(() => {
      tab(container, "Map").click();
    });
    expect(showing(container)).toBe("map");

    act(() => {
      const current = useGameStore.getState().state;
      if (!current || current.prompt?.kind !== "choice") throw new Error("no choice");
      useGameStore.setState({
        state: { ...current, seq: current.seq + 1, prompt: { ...current.prompt, votes: { p_1: "a" } } },
      });
    });
    expect(showing(container)).toBe("map");

    act(() => {
      const current = useGameStore.getState().state;
      if (!current) throw new Error("no state");
      useGameStore.setState({
        state: {
          ...current,
          seq: current.seq + 1,
          sceneId: "scene_second",
          prompt: {
            kind: "choice",
            sceneId: "scene_second",
            options: [{ id: "b", label: "Second question", icon: "eye" }],
            forPlayerIds: ["p_1"],
            vote: false,
          },
        },
      });
    });
    expect(showing(container)).toBe("player");
  });

  it("still gives the die the screen while the map is up", () => {
    const { container } = mount();
    act(() => {
      tab(container, "Map").click();
    });
    act(() => {
      useGameStore.setState({
        presentation: {
          seq: 10,
          presentation: { kind: "ROLL", roll: { d20: 14, modifier: 0, total: 14, tn: 10, success: true } },
        } as never,
      });
    });
    expect(showing(container)).toBe("world");
    act(() => {
      vi.advanceTimersByTime(rollCardMs({}) - 100);
    });
    // Still the die: the card is up for its whole read, not a quick flash.
    expect(showing(container)).toBe("world");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(showing(container)).toBe("map");
  });
});

describe("Travel Mode and the Field Guide (#112)", () => {
  it("opens the guide in the player pane from the tray, and You leaves it", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    const { container } = mount();
    expect(showing(container)).toBe("world");
    act(() => {
      tab(container, "Guide").click();
    });
    expect(showing(container)).toBe("player");
    expect(tab(container, "Guide").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-pane="player"] .field-guide')).not.toBeNull();
    act(() => {
      tab(container, "You").click();
    });
    expect(container.querySelector('[data-pane="player"] .field-guide')).toBeNull();
    expect(tab(container, "Guide").getAttribute("aria-pressed")).toBe("false");
    vi.unstubAllGlobals();
  });
});

describe("Travel Mode on a tablet held sideways", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query.includes("orientation: landscape"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Every pane on screen, the way the CSS reads it. */
  function shown(container: HTMLElement): string[] {
    return [...container.querySelectorAll('.kad-travel__pane[data-showing="true"]')]
      .map((pane) => pane.getAttribute("data-pane") ?? "")
      .sort();
  }

  it("never hides the world or the controls: the map takes the world's place beside them", () => {
    const { container } = mount();
    expect(shown(container)).toEqual(["player", "world"]);
    act(() => {
      tab(container, "Map").click();
    });
    expect(shown(container)).toEqual(["map", "player"]);
    act(() => {
      tab(container, "World").click();
    });
    expect(shown(container)).toEqual(["player", "world"]);
  });

  it("makes your controls a drawer: You shuts it, the world keeps the room, You opens it again", () => {
    const { container } = mount();
    expect(tab(container, "You").getAttribute("aria-pressed")).toBe("true");
    act(() => {
      tab(container, "You").click();
    });
    expect(shown(container)).toEqual(["world"]);
    expect(tab(container, "You").getAttribute("aria-pressed")).toBe("false");
    // The drawer is shut, not unmounted: what was half made in it is still there.
    expect(container.querySelector('[data-pane="player"]')).not.toBeNull();
    // The map takes the picture's place and the drawer stays shut.
    act(() => {
      tab(container, "Map").click();
    });
    expect(shown(container)).toEqual(["map"]);
    act(() => {
      tab(container, "You").click();
    });
    expect(shown(container)).toEqual(["map", "player"]);
  });

  it("opens a shut drawer for a new question, and for the Guide", () => {
    const { container } = mount();
    act(() => {
      tab(container, "You").click();
    });
    expect(shown(container)).toEqual(["world"]);
    act(() => {
      tab(container, "Guide").click();
    });
    expect(shown(container)).toEqual(["player", "world"]);
    act(() => {
      tab(container, "You").click();
    });
    // The guide was in the drawer, so this tap leaves it for the bag rather than shutting it.
    expect(shown(container)).toEqual(["player", "world"]);
    act(() => {
      tab(container, "You").click();
    });
    expect(shown(container)).toEqual(["world"]);
    act(() => {
      useGameStore.setState({
        state: {
          ...state(),
          seq: 11,
          phase: "scene",
          prompt: {
            kind: "choice",
            sceneId: "rest_lanternfall",
            options: [{ id: "on", label: "Onward", icon: "arrow" }],
            forPlayerIds: ["p_1"],
            vote: false,
          },
        },
      });
    });
    expect(shown(container)).toEqual(["player", "world"]);
  });

  it("does the same on a phone held sideways, which matches its own query", () => {
    // Only the phone's query matches: landscape and short, never the tablet's.
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query.includes("max-height: 559px"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })));
    const { container } = mount();
    expect(container.querySelector(".kad-travel[data-side-by-side]")).not.toBeNull();
    expect(shown(container)).toEqual(["player", "world"]);
    act(() => {
      tab(container, "Map").click();
    });
    expect(shown(container)).toEqual(["map", "player"]);
  });

  it("brings an open question forward when the tablet turns upright", () => {
    // A matchMedia that can turn: sideways first, then upright.
    let sideways = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      get matches() { return sideways && query.includes("orientation: landscape"); },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })));
    const { container } = mount();
    act(() => {
      tab(container, "Map").click();
    });
    // The question arrives while the controls are already beside the map: nothing moves.
    act(() => {
      useGameStore.setState({
        state: {
          ...state(),
          seq: 10,
          phase: "scene",
          prompt: {
            kind: "choice",
            sceneId: "rest_lanternfall",
            options: [{ id: "on", label: "Onward", icon: "arrow" }],
            forPlayerIds: ["p_1"],
            vote: false,
          },
        },
      });
    });
    expect(shown(container)).toEqual(["map", "player"]);
    // Upright, one pane at a time: the question, not the map.
    act(() => {
      sideways = false;
      for (const fn of listeners) fn();
    });
    expect(shown(container)).toEqual(["player"]);
  });

  it("explains the pane she last went to: the map, then her controls beside it", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    const { container } = mount();
    act(() => {
      tab(container, "Map").click();
    });
    expect(useHelpFocus.getState().pane).toBe("map");
    // You shuts the drawer, so the "?" stays with the map; tapping it again brings the controls back.
    act(() => {
      tab(container, "You").click();
    });
    expect(shown(container)).toEqual(["map"]);
    expect(useHelpFocus.getState().pane).toBe("map");
    act(() => {
      tab(container, "You").click();
    });
    expect(shown(container)).toEqual(["map", "player"]);
    expect(useHelpFocus.getState().pane).toBe("player");
    act(() => {
      tab(container, "Map").click();
    });
    act(() => {
      tab(container, "Guide").click();
    });
    expect(shown(container)).toEqual(["map", "player"]);
    expect(useHelpFocus.getState().pane).toBe("player");
  });

  it("gives the die the big pane while the map is up, and keeps the controls", () => {
    const { container } = mount();
    act(() => {
      tab(container, "Map").click();
    });
    act(() => {
      useGameStore.setState({
        presentation: {
          seq: 10,
          presentation: { kind: "ROLL", roll: { d20: 14, modifier: 0, total: 14, tn: 10, success: true } },
        } as never,
      });
    });
    expect(shown(container)).toEqual(["player", "world"]);
    act(() => {
      vi.advanceTimersByTime(rollCardMs({}) + 100);
    });
    expect(shown(container)).toEqual(["map", "player"]);
  });
});
