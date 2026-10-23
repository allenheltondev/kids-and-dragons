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
  useCampaign: () => null,
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
  FightLog: () => null,
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

it("contains a rejected renderer chunk, reports it quietly, and keeps the story controls interactive", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const reportError = vi.fn();
  vi.stubGlobal("reportError", reportError);
  render(<WorldView />);
  const warning = await screen.findByRole("status");
  expect(warning.textContent).toContain("Something went wrong");
  expect(warning.getAttribute("title")).toBe("Something went wrong");
  expect(reportError).toHaveBeenCalled();
  vi.unstubAllGlobals();
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
  expect((await screen.findByRole("status")).textContent).toContain("Something went wrong");

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

it("sounds a scene's rift opening or folding shut once as the scene opens, even on the still board (#401)", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { setAudioSink } = await import("../audio/cue");
  const heard: string[] = [];
  setAudioSink({ cue: (id) => heard.push(id), music: () => undefined });
  try {
    scene.chapter = {
      id: "ch1",
      biome: "glacier_of_origins",
      scenes: {
        quay: { type: "story", narration: "A fold.", rift: "steady", choices: [] },
        shimmer: { type: "story", narration: "The fold opens.", rift: "open", choices: [] },
        through: { type: "story", narration: "It pinches shut.", rift: "collapse", choices: [] },
      },
    };
    const at = (sceneId: string) => ({ phase: "scene", chapterId: "ch1", sceneId, party: [] });
    scene.state = at("quay");
    const { rerender } = render(<WorldView />);
    expect(heard.filter((id) => id.startsWith("rift"))).toEqual([]);
    scene.state = at("shimmer");
    rerender(<WorldView />);
    scene.state = { ...at("shimmer") };
    rerender(<WorldView />);
    expect(heard.filter((id) => id.startsWith("rift"))).toEqual(["rift-open"]);
    scene.state = at("through");
    rerender(<WorldView />);
    expect(heard.filter((id) => id.startsWith("rift"))).toEqual(["rift-open", "rift-collapse"]);
  } finally {
    setAudioSink(null);
  }
});

it("sounds a scene's rift once its chapter arrives, when the scene was named first (#401)", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { setAudioSink } = await import("../audio/cue");
  const heard: string[] = [];
  setAudioSink({ cue: (id) => heard.push(id), music: () => undefined });
  try {
    // The run state names the opening scene before useChapter() has resolved.
    scene.chapter = null;
    scene.state = { phase: "scene", chapterId: "ch1", sceneId: "shimmer", party: [] };
    const { rerender } = render(<WorldView />);
    expect(heard.filter((id) => id.startsWith("rift"))).toEqual([]);
    scene.chapter = {
      id: "ch1",
      biome: "glacier_of_origins",
      scenes: { shimmer: { type: "story", narration: "The fold opens.", rift: "open", choices: [] } },
    };
    rerender(<WorldView />);
    expect(heard.filter((id) => id.startsWith("rift"))).toEqual(["rift-open"]);
    // Neither a later patch nor the same chapter again sounds it twice.
    scene.state = { ...(scene.state as object) };
    rerender(<WorldView />);
    expect(heard.filter((id) => id.startsWith("rift"))).toEqual(["rift-open"]);
  } finally {
    setAudioSink(null);
  }
});

it("keeps story guests illustrated on devices without the animated renderer", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  scene.chapter = {
    id: "ch1", biome: "enchanted_woods",
    scenes: { meeting: { type: "story", rift: "steady", choices: [], cast: [{ figure: "cast/marda_thorn", name: "Marda Thorn" }] } },
  };
  scene.state = { phase: "scene", chapterId: "ch1", sceneId: "meeting", party: [] };
  render(<WorldView />);
  const board = await screen.findByTestId("static-stage");
  expect(board.querySelector('img[src="/assets/cast/marda_thorn/assembled.png"]')).not.toBeNull();
  expect(board.textContent).toContain("Marda Thorn");
  expect((board.querySelector(".kad-static-stage__rift") as HTMLElement).style.backgroundImage).toContain("rift_neutral.sheet.png");
});
