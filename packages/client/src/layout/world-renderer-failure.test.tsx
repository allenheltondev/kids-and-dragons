// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const action = vi.hoisted(() => vi.fn());
vi.mock("../world/PixiStage", () => { throw new Error("Failed to fetch dynamically imported module"); });
vi.mock("../store", () => ({
  useChapter: () => null,
  useRunState: () => ({ phase: "scene" }),
  useMe: () => null,
  useSession: () => null,
  useGameStore: { getState: () => ({ registerPresentationPlayer: () => () => undefined }) },
}));
vi.mock("../screens", () => ({
  ChapterCompletePanel: () => null,
  CreationPreview: () => null,
  DiceOverlay: () => null,
  LobbyContent: () => null,
  NarrationPanel: () => <button onClick={action}>Continue the story</button>,
  TransformCutscene: () => null,
}));

import { WorldView } from "./WorldView";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("contains a rejected renderer chunk and keeps the story controls interactive", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  render(<WorldView />);
  expect((await screen.findByRole("status")).textContent).toContain("world view couldn’t load");
  fireEvent.click(screen.getByRole("button", { name: "Continue the story" }));
  expect(action).toHaveBeenCalledOnce();
});
