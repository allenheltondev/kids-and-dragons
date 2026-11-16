// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TentInterior, shelfSlots } from "./TentInterior";
import { CampFriendsLife } from "./CampFriendsLife";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { kitEditProblem } from "@kad/shared";
import { KIT_RULES } from "../world/camp-scene";
const hero = makeCharacter({ id: "hero", name: "Pip" });
const kit = { revision: 1, style: "rolled", tent: null, color: null, slots: ["deco_lantern", "deco_pinwheel"], unlocked: [] };
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("shows her bedroll and shelf keepsake, keeps exterior decorations outside, and dims the lantern", () => {
  const { container } = render(<TentInterior hero={hero} kit={kit} edit={() => undefined} />);
  expect(screen.getByRole("heading", { name: "Pip's tent" })).toBeTruthy();
  expect(container.querySelector('[data-camp-kit="rolled"]')).toBeTruthy();
  const scene = container.querySelector(".tent-room__scene")!;
  expect(scene.querySelector('image[href*="pinwheel"]')).toBeNull();
  expect(scene.querySelector('.tent-room__shelf image[href*="lantern"]')).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Lantern has pride of place");
  fireEvent.click(screen.getByRole("button", { name: "Dim the lantern" }));
  expect(screen.getByRole("button", { name: "Light the lantern" }).getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector(".tent-room__scene.is-dim")).toBeTruthy();
});
it("moves an owned decoration to the shelf without duplicating or losing the other piece", () => {
  const edits: unknown[] = [];
  render(<TentInterior hero={hero} kit={kit} edit={change => edits.push(change)} />);
  fireEvent.click(screen.getByText("Choose your shelf treasure"));
  fireEvent.click(screen.getByRole("button", { name: "Pinwheel" }));
  expect(edits).toEqual([{ slots: ["deco_pinwheel", "deco_lantern"] }]);
  expect(kitEditProblem(KIT_RULES, [], { slots: shelfSlots(kit.slots, "deco_pinwheel") })).toBeNull();
  expect(screen.queryByRole("button", { name: "Gull feather" })).toBeNull();
});
it("can clear the shelf and keeps larger kits intact", () => {
  expect(shelfSlots(["deco_lantern", "deco_pinwheel", "deco_bunting"], null)).toEqual([null, "deco_pinwheel", "deco_bunting"]);
  expect(shelfSlots([], "deco_lantern")).toEqual(["deco_lantern", null]);
});
it("reacts quietly during camp and cancels its next reaction when the story starts", () => {
  vi.useFakeTimers();
  const state = makeState({ phase: "lobby", party: [makeMember({ character: hero })], kits: { hero: kit }, campMoment: { id: "camp:1", kind: "lobby", outdoor: true, changes: {}, friends: { rotation: ["bun"], out: ["bun"], cards: [{ id: "bun", name: "Bun", figure: "cast/bun" }] } } });
  useGameStore.setState({ state, friendTaps: [] });
  render(<CampFriendsLife />);
  act(() => vi.advanceTimersByTime(8000));
  expect(useGameStore.getState().friendTaps).toHaveLength(1);
  expect(useGameStore.getState().friendTaps[0]?.words).toContain("Pip's lantern");
  act(() => useGameStore.setState({ state: { ...state, phase: "scene", sceneType: "story", campMoment: undefined }, friendTaps: [] }));
  act(() => vi.advanceTimersByTime(60000));
  expect(useGameStore.getState().friendTaps).toEqual([]);
});


it("keeps the shelf usable when one painting fails and draws the next treasure normally", () => {
  const view = render(<TentInterior hero={hero} kit={kit} edit={() => undefined} />);
  const painting = view.container.querySelector(".tent-room__shelf image")!;
  fireEvent.error(painting);
  expect(view.container.querySelector(".tent-room__shelf image")).toBeNull();
  view.rerender(<TentInterior hero={hero} kit={{ ...kit, slots: ["deco_flower_pot", null] }} edit={() => undefined} />);
  expect(view.container.querySelector(".tent-room__shelf image")?.getAttribute("href")).toContain("flower-pot.png");
});
