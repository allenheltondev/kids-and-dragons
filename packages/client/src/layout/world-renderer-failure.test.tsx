// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const action = vi.hoisted(() => vi.fn());
vi.mock("../world/PixiStage", () => { throw new Error("Failed to fetch dynamically imported module"); });
const scene = vi.hoisted(() => ({
  chapter: null as unknown,
  state: { phase: "scene" } as unknown,
}));
vi.mock("../store", () => ({
  useChapter: () => scene.chapter,
  useRunState: () => scene.state,
  useMe: () => null,
  useSession: () => null,
  useGameStore: Object.assign(
    (select: (store: unknown) => unknown) => select({ state: scene.state, loadChapter: () => Promise.resolve() }),
    { getState: () => ({ registerPresentationPlayer: () => () => undefined }), subscribe: () => () => undefined },
  ),
}));
vi.mock("../screens", () => ({
  ChapterCompletePanel: () => null,
  CreationPreview: () => null,
  DiceOverlay: () => null,
  LobbyContent: () => null,
  NarrationPanel: () => <button onClick={action}>Continue the story</button>,
  TransformCutscene: () => null,
  TurnBanner: () => null,
}));

import { WorldView } from "./WorldView";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  scene.chapter = null;
  scene.state = { phase: "scene" };
});

it("contains a rejected renderer chunk and keeps the story controls interactive", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  render(<WorldView />);
  expect((await screen.findByRole("status")).textContent).toContain("world view couldn’t load");
  fireEvent.click(screen.getByRole("button", { name: "Continue the story" }));
  expect(action).toHaveBeenCalledOnce();
});

it("draws the chapter as still art and a plain board when the renderer is gone", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  scene.chapter = {
    id: "ch1",
    biome: "enchanted_woods",
    scenes: { fight: { type: "encounter", enemies: [{ id: "wisp", art: "enemies/will_o_wisp" }] } },
  };
  scene.state = {
    phase: "encounter",
    chapterId: "ch1",
    sceneId: "fight",
    party: [{
      playerId: "p1", hp: 8, down: false,
      character: { id: "c1", name: "Sparklehoof", species: "unicorn", class: "thornguard", tier: "fledgling" },
    }],
    encounter: {
      combatants: [
        { id: "c1", side: "party", name: "Sparklehoof", hp: 8, maxHp: 10, down: false },
        { id: "wisp#1", side: "enemy", name: "Bramblewisp", hp: 3, maxHp: 4, down: false },
        { id: "wisp#2", side: "enemy", name: "Gone wisp", hp: 0, maxHp: 4, down: true },
      ],
    },
  };
  const { container } = render(<WorldView />);
  expect((await screen.findByRole("status")).textContent).toContain("world view couldn’t load");

  const board = await screen.findByTestId("static-stage");
  expect(board.querySelector("img.kad-static-stage__backdrop")?.getAttribute("src")).toBe("/assets/biomes/enchanted_woods/bg.webp");
  const figures = [...board.querySelectorAll("li")].map((li) => li.textContent);
  expect(figures).toEqual(["Bramblewisp", "Sparklehoof"]);
  expect([...board.querySelectorAll("img:not(.kad-static-stage__backdrop)")].map((img) => img.getAttribute("src"))).toEqual([
    "/assets/entities/will_o_wisp/assembled.png",
    "/assets/characters/unicorn/fledgling/assembled.png",
  ]);
  // The story controls are untouched by any of it.
  fireEvent.click(screen.getByRole("button", { name: "Continue the story" }));
  expect(action).toHaveBeenCalled();
  expect(container.querySelector(".kad-stage")).toBeNull();
});
