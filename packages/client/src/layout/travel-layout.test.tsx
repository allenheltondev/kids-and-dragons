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
function showing(container: HTMLElement): "world" | "player" | "neither" {
  const panes = [...container.querySelectorAll(".kad-travel__pane")];
  const world = panes[0]?.getAttribute("data-showing") === "true";
  const player = panes[1]?.getAttribute("data-showing") === "true";
  if (world) return "world";
  if (player) return "player";
  return "neither";
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
      (container.querySelectorAll(".kad-travel__tab")[1] as HTMLElement).click();
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
      (container.querySelectorAll(".kad-travel__tab")[1] as HTMLElement).click();
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
      (container.querySelectorAll(".kad-travel__tab")[1] as HTMLElement).click();
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
      (container.querySelectorAll(".kad-travel__tab")[1] as HTMLElement).click();
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
