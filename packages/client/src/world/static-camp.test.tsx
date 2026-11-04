// @vitest-environment jsdom
/**
 * The still board's lobby (#614, docs/camp.md §8.7): with no WebGL, the camp
 * is a still picture, the backdrop (or the plains stand-in) with every seated
 * hero at their bedroll. Outside the lobby the still board is what it was.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PartyMember, RunState } from "@kad/shared";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { StaticStage } from "./StaticStage";
import { setLobbyInsetBottom } from "./stage-inset";

function member(n: number, overrides: Partial<PartyMember> = {}): PartyMember {
  return makeMember({
    character: makeCharacter({ id: `c_${n}`, ownerPlayerId: `p_${n}`, species: "griffin" }),
    playerId: `p_${n}`,
    ...overrides,
  });
}

function mount(state: RunState) {
  useGameStore.setState({ state, chapter: null });
  return render(<StaticStage />);
}

afterEach(() => {
  cleanup();
  setLobbyInsetBottom(0);
});

describe("the still camp", () => {
  it("shows the camp in the lobby, every seated hero at a bedroll, the stepped-away faded", () => {
    mount(makeState({ phase: "creation", party: [member(1), member(2, { connected: false })] }));
    expect(screen.getByTestId("static-camp")).toBeTruthy();
    const heroes = [...document.querySelectorAll<HTMLElement>(".kad-static-camp__hero")];
    expect(heroes.map((h) => h.dataset.hero)).toEqual(["c_1", "c_2"]);
    expect(heroes[1]!.classList.contains("is-away")).toBe(true);
    expect(heroes[0]!.querySelector("img")!.getAttribute("src")).toMatch(/griffin/);
    // At their bedrolls: the manifest's seat 0 and 1 stand points.
    expect(heroes[0]!.style.left).toBe("36%");
    expect(heroes[1]!.style.left).toBe("64%");
  });

  it("falls back to the plains background while the camp's painting is owed", () => {
    mount(makeState({ phase: "lobby", party: [member(1)] }));
    const backdrop = document.querySelector<HTMLImageElement>(".kad-static-camp__backdrop")!;
    expect(backdrop.getAttribute("src")).toBe("/assets/camp/backdrops/open_plains.webp");
    act(() => {
      fireEvent.error(backdrop);
    });
    expect(document.querySelector(".kad-static-camp__backdrop")!.getAttribute("src")).toBe("/assets/biomes/plains/bg.webp");
  });

  it("is the ordinary still board outside the lobby", () => {
    mount(makeState({ phase: "scene", party: [member(1)] }));
    expect(screen.queryByTestId("static-camp")).toBeNull();
    expect(screen.getByTestId("static-stage")).toBeTruthy();
  });
});
