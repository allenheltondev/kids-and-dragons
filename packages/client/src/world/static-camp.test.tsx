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
import { StillCamp } from "./StillCamp";
import { setLobbyInsetBottom } from "./stage-inset";
import { CAMP_KIT_STYLES, type CampKitStyle } from "./camp-kit-art";
import { NOMINAL_PAINT, figureSize } from "./figure-scale";
import { BEDROLL_LENGTH_FIT, HERO_PAINT } from "./camp-ownership";
import { ANCHOR_Y } from "./art-paths";
import { campLayoutFor, lobbyCampLayout } from "./lobby-camp";

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
  it("keeps the accent aligned to the current painting and hides it on fallback", () => {
    const state = makeState({ phase: "chapter_complete" });
    const { container, rerender } = render(<StillCamp state={state} layout={campLayoutFor(1, "exchange")!} />);
    const accent = () => container.querySelector<HTMLImageElement>(".kad-static-camp__accent");
    const backdrop = () => container.querySelector<HTMLImageElement>(".kad-static-camp__backdrop")!;
    expect(accent()?.getAttribute("src")).toContain("cliffside-exchange-awning");
    expect(accent()?.style.transform).toBe("rotate(-5deg)");
    fireEvent.error(backdrop());
    expect(accent()).toBeNull();
    rerender(<StillCamp state={state} layout={campLayoutFor(1, "sky_islands")!} />);
    expect(backdrop().getAttribute("src")).toContain("sky_islands.webp");
    expect(accent()?.getAttribute("src")).toContain("sky-islands-ribbon");
  });

  it("fits the painted bedroll to its owner, longer than she is, rather than the PNG canvas", () => {
    mount(makeState({ party: [
      member(1, { character: makeCharacter({ id: "tiny", species: "dragonling" }) }),
      member(2, { character: makeCharacter({ id: "large", species: "bigfoot" }) }),
    ] }));
    // Each bedroll's drawn length over its hero's drawn body length (camp-ownership.ts).
    const lengths = [0, 1].map(seat => {
      const el = document.querySelector<HTMLElement>(`[data-piece="bedroll_${seat}"]`)!;
      const style = el.querySelector("[data-camp-kit]")!.getAttribute("data-camp-kit") as CampKitStyle;
      return parseFloat(el.style.height) * CAMP_KIT_STYLES[style].paintWidth;
    });
    const bodies = (["dragonling", "bigfoot"] as const).map((species, seat) => {
      const el = document.querySelector<HTMLElement>(`[data-hero="${seat === 0 ? "tiny" : "large"}"]`)!;
      const box = HERO_PAINT[species]!;
      // The hero's square canvas is drawn so her nominal paint is her height.
      return parseFloat(el.style.height) * (ANCHOR_Y - NOMINAL_PAINT.top) * Math.max(box.height, box.width);
    });
    for (const seat of [0, 1]) expect(lengths[seat]! / bodies[seat]!).toBeCloseTo(BEDROLL_LENGTH_FIT, 2);
    // A bigfoot lies down taller than a dragonling is long, judged on one lane (seat 0's bedroll
    // stands nearer than seat 1's, so it is drawn at its lane's larger scale).
    const layout = lobbyCampLayout()!;
    const laneScale = (seat: number) => layout.lanes.get(layout.frame.pieces.find((p) => p.id === `bedroll_${seat}`)!.lane)!.scale;
    expect(lengths[1]! / laneScale(1) / (lengths[0]! / laneScale(0))).toBeGreaterThan(figureSize("characters/bigfoot").heightCm / figureSize("characters/dragonling").heightCm / 1.2);
  });
  it("draws owned kit styles and the fire without motion", () => {
    mount(makeState({ party: [member(1), member(2)] }));
    expect(document.querySelectorAll("[data-camp-kit]")).toHaveLength(2);
    expect(document.querySelector('.campfire[data-flicker="off"]')).not.toBeNull();
    expect(document.querySelector('[data-piece="trailhead_post"] img')).not.toBeNull();
  });
  it("shows the camp in the lobby, every seated hero at a bedroll, the stepped-away faded", () => {
    mount(makeState({ phase: "creation", party: [member(1), member(2, { connected: false })] }));
    expect(screen.getByTestId("static-camp")).toBeTruthy();
    const heroes = [...document.querySelectorAll<HTMLElement>(".kad-static-camp__hero")];
    expect(heroes.map((h) => h.dataset.hero)).toEqual(["c_1", "c_2"]);
    expect(heroes[1]!.classList.contains("is-away")).toBe(true);
    expect(heroes[0]!.querySelector("img")!.getAttribute("src")).toMatch(/griffin/);
    expect(heroes[0]!.querySelector(".kad-static-camp__name")!.textContent).toBe("Sparklehoof");
    // At their bedrolls: the manifest's seat 0 and 1 stand points.
    const rest = (seat: number) => `${String(lobbyCampLayout()!.frame.standPoints.find((p) => p.seat === seat)!.x * 100)}%`;
    expect(heroes[0]!.style.left).toBe(rest(0));
    expect(heroes[1]!.style.left).toBe(rest(1));
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
