// @vitest-environment jsdom
import { fireEvent, render, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { EntryScene, ENTRY_SCENES, lobbySceneFor } from "./EntryScene";
import manifest from "../../../../assets/manifest.json";
import { makeMember, makeCharacter } from "../testing/fixtures";
afterEach(cleanup);
it("shows occupied camp seats with independent hero colors, and falls back when the camp backdrop is missing", () => {
  const campParty = ["a", "b", "c", "d"].map((id, seat) => makeMember({
    character: makeCharacter({ id, appearance: { palette: "meadow", accent: seat % 2 ? "#ff0000" : "#0000ff" } }),
  }));
  const view = render(<EntryScene scene="lobby-waiting" campParty={campParty} />);
  expect(view.container.querySelectorAll("[data-camp-kit]")).toHaveLength(4);
  expect(view.container.querySelectorAll("feColorMatrix")).toHaveLength(4);
  fireEvent.error(view.container.querySelector('image[href="/assets/camp/backdrops/open_plains.webp"]')!);
  expect(view.container.querySelector(".campfire")).toBeNull();
  expect(view.container.querySelector("img")!.src).toContain("lobby-waiting.webp");
});
it("ships a declared image for every entry step", () => {
  for (const scene of ENTRY_SCENES) {
    expect(manifest.sceneIllustrations).toContain(`scenes/entry/${scene}`);
    expect(existsSync(`assets/scenes/entry/${scene}.webp`)).toBe(true);
    expect(manifest.sceneIllustrations).toContain(`scenes/entry/${scene}-portrait`);
    expect(existsSync(`assets/scenes/entry/${scene}-portrait.webp`)).toBe(true);
  }
});
it("keeps waiting until a nonempty party is fully ready", () => {
  expect(lobbySceneFor([])).toBe("lobby-waiting");
  expect(lobbySceneFor([{ ready: true }, { ready: false }])).toBe("lobby-waiting");
  expect(lobbySceneFor([{ ready: true }])).toBe("lobby-ready");
});
it("moves to the next backdrop even if the previous image failed", () => {
  const view = render(<EntryScene scene="creation-species" />);
  fireEvent.error(view.container.querySelector("img")!);
  expect(view.container.querySelector("img")).toBeNull();
  view.rerender(<EntryScene scene="creation-class" />);
  expect(view.container.querySelector("img")!.src).toContain("creation-class.webp");
});
it("falls back to landscape if a portrait cannot load", () => {
  const view = render(<EntryScene scene="home-market" />);
  const img = view.container.querySelector("img")!;
  Object.defineProperty(img, "currentSrc", { value: "http://localhost/assets/scenes/entry/home-market-portrait.webp" });
  fireEvent.error(img);
  expect(view.container.querySelector("source")).toBeNull();
  expect(view.container.querySelector("img")!.src).toContain("home-market.webp");
});
