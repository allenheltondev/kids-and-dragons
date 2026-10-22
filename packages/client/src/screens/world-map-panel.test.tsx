// @vitest-environment jsdom
/**
 * WorldMapPanel — the realm, with the party on it.
 *
 * The one promise: the party stands on the chapter's place, at canon's
 * anchor for it, and on nothing else. A chapter set somewhere canon has not
 * put on the map says so rather than inventing a spot — a pin in the sea is
 * worse than no pin.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import type { Chapter, WorldMap } from "@kad/shared";
import { makeChapter } from "../../../shared/src/test-fixtures";
import { makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { WorldMapPanel, placeOf, whereLine } from "./WorldMapPanel";
import { setFieldGuideDiscoveries } from "../store/field-guide-discoveries";
import { getAtlasCenter, resetAtlasNavigation } from "../store/atlas-navigation";
import { revealedClouds, resetRevealedClouds } from "../store/atlas-clouds";
import { setAudioSink } from "../audio/cue";

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

function mount(overrides: { chapter?: Chapter | null; world?: WorldMap | null; chapterId?: string | null; onRender?: () => void }) {
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
  return render(<Profiler id="atlas" onRender={overrides.onRender ?? (() => undefined)}><WorldMapPanel /></Profiler>);
}

afterEach(() => {
  cleanup();
  setFieldGuideDiscoveries(null);
  resetAtlasNavigation();
  resetRevealedClouds();
  setAudioSink(null);
  vi.unstubAllGlobals();
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
  it("saves every pan position without re-rendering the atlas at closest zoom", () => {
    let commits = 0;
    const world: WorldMap = { ...WORLD, atlas: { image: { width: 1024, height: 1024 }, levels: [{
      image: { width: 1024, height: 1024 },
      tiles: Array.from({ length: 4 }, (_, index) => ({ src: `/assets/tile-${index}.webp`,
        x: index % 2 * 512, y: Math.floor(index / 2) * 512, width: 512, height: 512 })),
    }] } };
    const { container } = mount({ world, onRender: () => { commits++; } });
    while (!(screen.getByRole("button", { name: "Closer" }) as HTMLButtonElement).disabled) {
      act(() => screen.getByRole("button", { name: "Closer" }).click());
    }
    const view = container.querySelector(".atlas__viewport") as HTMLElement;
    const sheet = screen.getByTestId("atlas-sheet");
    expect(view.getAttribute("data-zoom")).toBe("4");
    Object.defineProperties(view, { clientWidth: { value: 200 }, clientHeight: { value: 300 } });
    Object.defineProperties(sheet, { offsetWidth: { value: 1000 }, offsetHeight: { value: 1000 } });
    const beforePan = commits;
    for (let i = 0; i < 30; i++) {
      view.scrollLeft = i * 5;
      view.scrollTop = i * 10;
      fireEvent.scroll(view);
    }
    expect(getAtlasCenter(JSON.stringify(["r_1", CHAPTER.id]))).toEqual({ x: 245, y: 440 });
    expect(commits).toBe(beforePan);
    // Visual controls still update normally after panning.
    act(() => screen.getByRole("button", { name: "Further away" }).click());
    expect(commits).toBeGreaterThan(beforePan);
    expect(getAtlasCenter(JSON.stringify(["r_1", CHAPTER.id]))).toBeNull();
  });
  it("remembers zoom across map closes but resets for another run", () => {
    const first = mount({});
    act(() => screen.getByRole("button", { name: "Closer" }).click());
    expect(screen.getByTestId("atlas-sheet").style.inlineSize).toBe("200%");
    first.unmount();
    mount({});
    expect(screen.getByTestId("atlas-sheet").style.inlineSize).toBe("200%");
    act(() => useGameStore.setState({ session: { runId: "another-run", roomCode: "EFGH", playerId: "p_1", mode: "travel", sessionToken: "t" } }));
    expect(screen.getByTestId("atlas-sheet").style.inlineSize).toBe("100%");
  });
  it("keeps neighboring terrain and the party on the continuous canvas and shows routes at closest zoom", () => {
    const world: WorldMap = { ...WORLD,
      atlas: { image: { width: 1024, height: 1024 }, levels: [{ image: { width: 1024, height: 1024 }, tiles: [{ src: "/assets/continuous.webp", x: 0, y: 0, width: 1024, height: 1024 }] }],
        patches: [{ id: "northwest", bounds: { x: 0, y: 0, width: 500, height: 500 }, image: { width: 1024, height: 1024 }, tiles: [{ src: "/assets/detail.webp", x: 0, y: 0, width: 1024, height: 1024 }] }] },
      routes: [{ id: "route.road", title: "Exchange Road", kind: "overland_road", connects: ["location.exchange", "biome.sunward_fields"], travelModes: ["foot"], accuracy: "approximate", points: [{ x: 350, y: 855 }, { x: 470, y: 690 }] }],
    };
    const { container } = mount({ world });
    expect(screen.getByText("You are here")).toBeTruthy();
    expect(container.querySelector(".atlas__tile")?.getAttribute("src")).toBe("/assets/continuous.webp");
    act(() => screen.getByRole("button", { name: "Closer" }).click());
    expect(container.querySelector("[data-route]")).toBeNull();
    expect(container.querySelector("[data-patch]")).toBeNull();
    act(() => screen.getByRole("button", { name: "Closer" }).click());
    expect(container.querySelector('[data-patch="northwest"]')).not.toBeNull();
    act(() => screen.getByRole("button", { name: "Closer" }).click());
    expect(container.querySelector("[data-route]")).toBeNull();
    act(() => setFieldGuideDiscoveries({ "location.exchange": { firstFoundBy: "p_1", foundAt: "2026-10-15T12:00:00Z" } }));
    expect(container.querySelector('[data-route="route.road"]')?.getAttribute("data-accuracy")).toBe("approximate");
    act(() => screen.getByRole("checkbox", { name: "Routes" }).click());
    expect(container.querySelector("[data-route]")).toBeNull();
  });
  it("opens a region's card on tap, found or not, and leads on to the Field Guide once found", () => {
    const woods = { id: "biome.woods", title: "Whispering Woods", kind: "biome" as const, anchor: { x: 200, y: 200 }, parent: null };
    const region = (placeId: string, description: string) => ({ placeId, description,
      bounds: { x: 0, y: 0, width: 100, height: 100 }, image: { width: 100, height: 100 }, tiles: [] });
    const { container } = mount({ world: { ...WORLD, places: { ...WORLD.places, woods },
      regions: { woods: region("biome.woods", "Old trees that hum."), sunward_fields: region("biome.sunward_fields", "Sunny grasslands.") } } });
    act(() => screen.getByRole("button", { name: "About Whispering Woods" }).click());
    const card = screen.getByRole("dialog", { name: "Whispering Woods" });
    expect(card.textContent).toContain("Old trees that hum.");
    expect(card.textContent).toContain("Not explored yet.");
    expect(screen.queryByRole("button", { name: "Read in Field Guide" })).toBeNull();
    act(() => screen.getByRole("button", { name: "Close" }).click());
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => setFieldGuideDiscoveries({ "biome.woods": { firstFoundBy: "p_1", foundAt: "2026-10-15T12:00:00Z" } }));
    act(() => screen.getByRole("button", { name: "About Whispering Woods" }).click());
    act(() => screen.getByRole("button", { name: "Read in Field Guide" }).click());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Map discovery" })).toBeTruthy();

    // The party's own region opens from its pin; a tap on the painting or Escape puts it away.
    act(() => screen.getByRole("button", { name: "About The Sunward Fields" }).click());
    expect(screen.getByRole("dialog", { name: "The Sunward Fields" }).textContent).toContain("Sunny grasslands.");
    act(() => { fireEvent.click(container.querySelector(".atlas__viewport") as Element); });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => screen.getByRole("button", { name: "About The Sunward Fields" }).click());
    act(() => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("dresses a region's card as a storybook page: its painting, its danger, and a page-turn", async () => {
    const played: string[] = [];
    setAudioSink({ cue: (id) => played.push(id), music: () => undefined });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ entries: {
      "biome.woods": { id: "biome.woods", category: "places", kind: "biome", title: "Whispering Woods", danger_level: "high", art: "/assets/biomes/woods/portrait.webp" },
    } })));
    const woods = { id: "biome.woods", title: "Whispering Woods", kind: "biome" as const, anchor: { x: 200, y: 200 }, parent: null };
    const { container } = mount({ world: { ...WORLD, places: { ...WORLD.places, woods } } });
    act(() => screen.getByRole("button", { name: "About Whispering Woods" }).click());
    expect(played).toEqual(["page-turn"]);
    // Not found: a misty plate, and the danger kept secret.
    expect(screen.getByTestId("danger").textContent).toContain("Danger: unknown");
    await screen.findByText((_, el) => el?.tagName === "IMG" && el.getAttribute("src") === "/assets/biomes/woods/portrait.webp");
    expect(container.querySelector(".atlas__card-art--mystery")).not.toBeNull();
    act(() => setFieldGuideDiscoveries({ "biome.woods": { firstFoundBy: "p_1", foundAt: "2026-10-15T12:00:00Z" } }));
    expect(screen.getByTestId("danger").textContent).toContain("Here be dragons");
    expect(container.querySelector(".atlas__card-art--mystery")).toBeNull();
  });

  it("hangs clouds over unfound regions and rolls one back, once, when it is found", () => {
    const woods = { id: "biome.woods", title: "Whispering Woods", kind: "biome" as const, anchor: { x: 200, y: 200 }, parent: null };
    const region = (placeId: string) => ({ placeId, description: "", bounds: { x: 100, y: 100, width: 200, height: 200 }, image: { width: 1, height: 1 }, tiles: [] });
    const world: WorldMap = { ...WORLD, places: { ...WORLD.places, woods },
      regions: { woods: region("biome.woods"), sunward_fields: region("biome.sunward_fields") } };
    const { container } = mount({ world });
    // The party's own ground is never clouded; the woods are.
    expect(container.querySelector('[data-cloud="biome.sunward_fields"]')).toBeNull();
    const cloud = container.querySelector('[data-cloud="biome.woods"]') as HTMLElement;
    expect(cloud.className).toBe("atlas__cloud");
    expect(cloud.style.left).toBe("10%");
    act(() => setFieldGuideDiscoveries({ "biome.woods": { firstFoundBy: "p_1", foundAt: "2026-10-15T12:00:00Z" } }));
    expect(container.querySelector('[data-cloud="biome.woods"]')?.className).toContain("atlas__cloud--lifting");
    expect(revealedClouds().has("biome.woods")).toBe(true);
    cleanup();
    const again = mount({ world });
    expect(again.container.querySelector('[data-cloud="biome.woods"]')).toBeNull();
  });

  it("inks the explorer's trail through places in the order they were found", () => {
    const { container } = mount({});
    expect(screen.queryByTestId("explorer-trail")).toBeNull();
    act(() => setFieldGuideDiscoveries({
      "location.exchange": { firstFoundBy: "p_1", foundAt: "2026-10-15T12:00:00Z" },
      "biome.sunward_fields": { firstFoundBy: "p_1", foundAt: "2026-10-14T12:00:00Z" },
    }));
    const ink = container.querySelector(".atlas__trail-ink");
    expect(ink?.getAttribute("d")).toMatch(/^M470 690 Q\S+ \S+ 350 855$/);
  });

  it("reveals household discoveries live once zoomed in", () => {
    mount({});
    act(() => screen.getByRole("button", { name: "Closer" }).click());
    expect(screen.queryByRole("button", { name: "Read about The Exchange" })).toBeNull();
    act(() => setFieldGuideDiscoveries({ "location.exchange": { firstFoundBy: "p_1", foundAt: "2026-10-15T12:00:00Z" } }));
    expect(screen.getByRole("button", { name: "Read about The Exchange" })).toBeTruthy();
  });

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

  describe("pinching", () => {
    const touch = (x: number) => ({ clientX: x, clientY: 200, identifier: x });
    const pinch = (view: Element, from: number, to: number) => {
      fireEvent.touchStart(view, { touches: [touch(200 - from), touch(200 + from)] });
      fireEvent.touchMove(view, { touches: [touch(200 - to), touch(200 + to)] });
      fireEvent.touchEnd(view);
    };
    const sheet = () => screen.getByTestId("atlas-sheet").style.inlineSize;

    it("zooms a step closer when two fingers spread, and a step back when they close", () => {
      const { container } = mount({});
      const view = container.querySelector(".atlas__viewport")!;
      pinch(view, 40, 80);
      expect(sheet()).toBe("200%");
      pinch(view, 80, 40);
      expect(sheet()).toBe("100%");
    });

    it("takes one step per real pinch and leaves a small wobble alone", () => {
      const { container } = mount({});
      const view = container.querySelector(".atlas__viewport")!;
      pinch(view, 40, 44);
      expect(sheet()).toBe("100%");
      // A long spread keeps stepping as the fingers keep going apart.
      fireEvent.touchStart(view, { touches: [touch(160), touch(240)] });
      fireEvent.touchMove(view, { touches: [touch(130), touch(270)] });
      fireEvent.touchMove(view, { touches: [touch(90), touch(310)] });
      expect(sheet()).toBe("300%");
    });

    it("ignores one finger, which is panning", () => {
      const { container } = mount({});
      const view = container.querySelector(".atlas__viewport")!;
      fireEvent.touchStart(view, { touches: [touch(100)] });
      fireEvent.touchMove(view, { touches: [touch(300)] });
      expect(sheet()).toBe("100%");
    });

    it("stops at the ends of the zoom, like the buttons", () => {
      const { container } = mount({});
      const view = container.querySelector(".atlas__viewport")!;
      pinch(view, 40, 20);
      expect(sheet()).toBe("100%");
      for (let i = 0; i < 4; i++) pinch(view, 40, 100);
      expect(sheet()).toBe("300%");
    });

    it("zooms with a trackpad's pinch too", () => {
      const { container } = mount({});
      const view = container.querySelector(".atlas__viewport")!;
      fireEvent.wheel(view, { ctrlKey: true, deltaY: -60 });
      expect(sheet()).toBe("200%");
    });
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
