// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  destroy: vi.fn(),
  stageDestroy: vi.fn(),
  createScene: vi.fn(),
}));
vi.mock("pixi.js", () => ({
  Application: class {
    renderer: object | null = null;
    init = mocks.init;
    destroy = mocks.destroy;
    stage = { destroy: mocks.stageDestroy };
  },
}));
vi.mock("./scene", () => ({
  createScene: mocks.createScene,
  getActiveScene: () => null,
  setActiveScene: vi.fn(),
}));
vi.mock("../screens/content", () => ({ useEnsureChapter: vi.fn() }));
vi.mock("../store", () => ({
  useChapter: () => null,
  useParty: () => [],
  useRunState: () => null,
  useSession: () => null,
  usePresentation: vi.fn(),
  useGameStore: { getState: () => ({}) },
}));

import { PixiStage } from "./PixiStage";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("handles failed WebGL initialization while mounted and releases the partial stage", async () => {
  mocks.init.mockRejectedValue(new Error("WebGL unavailable"));
  render(<PixiStage />);
  expect((await screen.findByRole("status")).textContent).toContain("You can still play");
  expect(mocks.stageDestroy).toHaveBeenCalledOnce();
  expect(mocks.destroy).not.toHaveBeenCalled();
  expect(mocks.createScene).not.toHaveBeenCalled();
});

it("handles late rejected initialization after Strict Mode cleanup and unmount", async () => {
  const rejects: ((reason: Error) => void)[] = [];
  mocks.init.mockImplementation(() => new Promise((_, reject) => rejects.push(reject)));
  const view = render(<StrictMode><PixiStage /></StrictMode>);
  view.unmount();
  await act(async () => {
    for (const reject of rejects) reject(new Error("late startup failure"));
  });
  expect(rejects).toHaveLength(2);
  expect(mocks.stageDestroy).toHaveBeenCalledTimes(2);
  expect(mocks.createScene).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});

it("destroys a renderer that finishes initializing after unmount", async () => {
  let finish!: () => void;
  mocks.init.mockImplementation(function (this: { renderer: object | null }) {
    return new Promise<void>((resolve) => {
      finish = () => { this.renderer = {}; resolve(); };
    });
  });
  const view = render(<PixiStage />);
  view.unmount();
  await act(async () => finish());
  expect(mocks.destroy).toHaveBeenCalledExactlyOnceWith(true, { children: true });
  expect(mocks.stageDestroy).not.toHaveBeenCalled();
  expect(mocks.createScene).not.toHaveBeenCalled();
});
