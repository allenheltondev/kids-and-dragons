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
import { setLobbyInsetBottom, setStageCoverTop, setStageInsetBottom } from "./stage-inset";
import { CAMP_KIT_STYLES, type CampKitStyle } from "./camp-kit-art";
import { NOMINAL_PAINT, figureSize } from "./figure-scale";
import { BEDROLL_LENGTH_FIT, HERO_PAINT } from "./camp-ownership";
import { ANCHOR_Y } from "./art-paths";
import { lobbyCampLayout } from "./lobby-camp";
import { campFocusBand } from "./camp-framing";

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

describe("the still camp at an outdoor rest, under the goal card (#625)", () => {
  afterEach(() => {
    setStageInsetBottom(0);
    setStageCoverTop(0);
  });

  it("frames below the card's foot, shrinking whole with the painting mirrored at the sides, where the lobby's covers the pane", () => {
    // A 1280 × 720 TV, the plate 317px tall and the card's foot 176px down.
    const sized = (name: "clientWidth" | "clientHeight", px: number) => Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => px });
    sized("clientWidth", 1280);
    sized("clientHeight", 720);
    try {
      const bigfoots = [1, 2, 3, 4].map((n) => member(n, { character: makeCharacter({ id: `b_${n}`, ownerPlayerId: `p_${n}`, species: "bigfoot" }) }));
      setStageInsetBottom(317);
      setStageCoverTop(176);
      mount(makeState({ phase: "scene", sceneType: "rest", sceneId: "camp", party: bigfoots, campMoment: { id: "rest:camp|r:c:4", kind: "rest", outdoor: true, changes: {} } }));
      const frame = document.querySelector<HTMLElement>(".kad-static-camp__frame:not(.kad-static-camp__side)")!;
      const left = parseFloat(frame.style.left);
      const width = parseFloat(frame.style.width);
      expect(left).toBeGreaterThan(0);
      expect(left * 2 + width).toBeCloseTo(1280);
      const sides = [...document.querySelectorAll<HTMLElement>(".kad-static-camp__side")];
      expect(sides.map((side) => side.dataset.side)).toEqual(["left", "right"]);
      expect(parseFloat(sides[0]!.style.left)).toBeCloseTo(left - width);
      expect(parseFloat(sides[1]!.style.left)).toBeCloseTo(left + width);
      // The tallest head stands below the card, and every hero's feet in the window.
      const top = parseFloat(frame.style.top);
      const height = parseFloat(frame.style.height);
      const k = parseFloat(document.querySelector<HTMLElement>("[data-testid='static-camp']")!.dataset.figureScale!);
      const heads = campFocusBand(lobbyCampLayout()!, bigfoots.map(() => figureSize("characters/bigfoot").heightCm), k);
      expect(top + heads.top * height).toBeGreaterThanOrEqual(176 - 0.5);
      for (const hero of document.querySelectorAll<HTMLElement>(".kad-static-camp__hero")) {
        const feet = top + (parseFloat(hero.style.top) / 100) * height;
        expect(feet).toBeGreaterThan(176);
        expect(feet).toBeLessThan(720 - 317);
      }
      cleanup();
      // The lobby's camp in the same window covers the pane edge to edge, as ever.
      mount(makeState({ phase: "lobby", party: bigfoots }));
      expect(parseFloat(document.querySelector<HTMLElement>(".kad-static-camp__frame")!.style.left)).toBeLessThanOrEqual(0);
      expect(document.querySelectorAll(".kad-static-camp__side")).toHaveLength(0);
    } finally {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    }
  });
});
