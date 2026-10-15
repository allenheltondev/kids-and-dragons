// @vitest-environment jsdom
/**
 * MapView — two maps, one flip.
 *
 * World first, because it is the picture; Route a tap away, because it is
 * the itinerary. And the choice sticks for the life of the page: a player who
 * keeps checking the trail is not handed the painting every time the pane is
 * reopened.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { makeChapter } from "../../../shared/src/test-fixtures";
import { makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { MapView } from "./MapView";

function mount() {
  const chapter = makeChapter();
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "travel", sessionToken: "t" },
    state: makeState({
      phase: "scene",
      chapterId: chapter.id,
      sceneId: chapter.entry,
      party: [makeMember()],
    }),
    chapter,
    world: {
      title: "The Realm of Red Sky",
      image: { src: "/assets/world/realm_of_red_sky.webp", width: 1400, height: 1243 },
      places: {
        enchanted_woods: {
          id: "biome.enchanted_woods",
          title: "Enchanted Woods",
          kind: "biome",
          anchor: { x: 220, y: 395 },
          parent: null,
        },
      },
    },
    loadContent: async () => undefined,
    loadChapter: async () => undefined,
    loadWorld: async () => undefined,
  });
  return render(<MapView />);
}

function showing(container: HTMLElement): string {
  return container.querySelector(".kad-map__host")?.getAttribute("data-map") ?? "";
}

afterEach(() => {
  cleanup();
});

describe("the map's two faces", () => {
  it("opens on the world, with the route a tap away", () => {
    const { container } = mount();
    expect(showing(container)).toBe("world");
    expect(container.querySelector(".atlas")).not.toBeNull();
    expect(container.querySelector(".trail")).toBeNull();

    act(() => {
      screen.getByRole("button", { name: /story trail/i }).click();
    });
    expect(showing(container)).toBe("route");
    expect(container.querySelector(".trail")).not.toBeNull();
    expect(container.querySelector(".atlas")).toBeNull();
    expect(screen.getByRole("button", { name: /story trail/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^atlas$/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("remembers the last map across a close and reopen", () => {
    const first = mount();
    act(() => {
      screen.getByRole("button", { name: /story trail/i }).click();
    });
    expect(showing(first.container)).toBe("route");
    first.unmount();

    const second = mount();
    expect(showing(second.container)).toBe("route");

    // Leave it the way the next test expects to find it.
    act(() => {
      screen.getByRole("button", { name: /^atlas$/i }).click();
    });
  });
});
