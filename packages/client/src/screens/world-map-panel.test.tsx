// @vitest-environment jsdom
/**
 * WorldMapPanel — the realm, with the party on it.
 *
 * The one promise: the party stands on the chapter's place, at canon's
 * anchor for it, and on nothing else. A chapter set somewhere canon has not
 * put on the map says so rather than inventing a spot — a pin in the sea is
 * worse than no pin.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Chapter, WorldMap } from "@kad/shared";
import { makeChapter } from "../../../shared/src/test-fixtures";
import { makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { WorldMapPanel, placeOf, whereLine } from "./WorldMapPanel";

const WORLD: WorldMap = {
  title: "The Realm of Red Sky",
  image: { src: "/assets/world/realm_of_red_sky.webp", width: 1400, height: 1243 },
  places: {
    sunward_fields: {
      id: "biome.sunward_fields",
      title: "The Sunward Fields",
      kind: "biome",
      anchor: { x: 470, y: 690 },
      parent: null,
    },
    exchange: {
      id: "location.exchange",
      title: "The Exchange",
      kind: "location",
      anchor: { x: 350, y: 855 },
      parent: "sunward_fields",
    },
  },
};

const CHAPTER: Chapter = { ...makeChapter(), biome: "sunward_fields" };

function mount(overrides: { chapter?: Chapter | null; world?: WorldMap | null; chapterId?: string | null }) {
  const chapter = overrides.chapter === undefined ? CHAPTER : overrides.chapter;
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "travel", sessionToken: "t" },
    state: makeState({
      phase: "scene",
      chapterId: overrides.chapterId === undefined ? CHAPTER.id : overrides.chapterId,
      sceneId: CHAPTER.entry,
      party: [makeMember()],
    }),
    chapter,
    world: overrides.world === undefined ? WORLD : overrides.world,
    loadContent: async () => undefined,
    loadChapter: async () => undefined,
    loadWorld: async () => undefined,
  });
  return render(<WorldMapPanel />);
}

afterEach(() => {
  cleanup();
});

describe("finding the chapter on the map", () => {
  it("looks the chapter's biome up by slug", () => {
    expect(placeOf(WORLD, "exchange")?.id).toBe("location.exchange");
    expect(placeOf(WORLD, "nowhere")).toBeNull();
    expect(placeOf(WORLD, undefined)).toBeNull();
  });

  it("names a settlement's country as well", () => {
    expect(whereLine(WORLD, WORLD.places["exchange"]!)).toBe("The Exchange, in The Sunward Fields");
    expect(whereLine(WORLD, WORLD.places["sunward_fields"]!)).toBe("The Sunward Fields");
  });
});

describe("the panel", () => {
  it("stands the party on the chapter's place, at its anchor", () => {
    const { container } = mount({});
    const pin = container.querySelector('[aria-current="location"]') as HTMLElement | null;
    expect(pin).not.toBeNull();
    expect(pin?.getAttribute("data-place")).toBe("biome.sunward_fields");
    // Canon's 0–1000 frame becomes a percentage of the painting.
    expect(pin?.style.left).toBe("47%");
    expect(pin?.style.top).toBe("69%");
    expect(pin?.querySelectorAll(".atlas__face")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("The party is in The Sunward Fields.");
    expect(screen.getByText("You are here")).toBeTruthy();
  });

  it("shows the painting at the size the data says", () => {
    const { container } = mount({});
    const img = container.querySelector("img.atlas__painting") as HTMLImageElement | null;
    expect(img?.getAttribute("src")).toBe("/assets/world/realm_of_red_sky.webp");
    expect(img?.getAttribute("alt")).toBe("");
    expect(screen.getByTestId("atlas-sheet").style.aspectRatio).toBe("1400 / 1243");
  });

  it("zooms in steps and never past either end", () => {
    mount({});
    const closer = screen.getByRole("button", { name: "Closer" }) as HTMLButtonElement;
    const further = screen.getByRole("button", { name: "Further away" }) as HTMLButtonElement;
    expect(screen.getByTestId("atlas-sheet").style.inlineSize).toBe("100%");
    expect(further.disabled).toBe(true);

    act(() => closer.click());
    expect(screen.getByTestId("atlas-sheet").style.inlineSize).toBe("200%");
    act(() => closer.click());
    expect(screen.getByTestId("atlas-sheet").style.inlineSize).toBe("300%");
    expect(closer.disabled).toBe(true);

    act(() => further.click());
    expect(screen.getByTestId("atlas-sheet").style.inlineSize).toBe("200%");
  });

  it("says so when the chapter is somewhere the map does not show", () => {
    const { container } = mount({ chapter: { ...CHAPTER, biome: "crystal_caverns" } });
    expect(container.querySelector('[aria-current="location"]')).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(
      "This chapter is somewhere the map does not show.",
    );
    // The painting is still there to look at.
    expect(container.querySelector("img.atlas__painting")).not.toBeNull();
  });

  it("explains itself before the story has begun", () => {
    mount({ chapterId: null });
    expect(screen.getByText("The map fills in once the story begins.")).toBeTruthy();
  });

  it("waits for the key rather than drawing without it", () => {
    mount({ world: null });
    expect(screen.getByText("Unrolling the map…")).toBeTruthy();
  });
});
