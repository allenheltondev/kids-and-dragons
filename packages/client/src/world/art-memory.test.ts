import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A stand-in for Pixi's asset cache: textures by URL, each with its own source. */
const store = vi.hoisted(() => {
  const loaded = new Map<string, { source: { pixelWidth: number; pixelHeight: number }; destroyed: boolean }>();
  const sizes = new Map<string, [number, number]>();
  /** URLs whose load waits until the test lets it finish. */
  const deferred = new Map<string, () => void>();
  return {
    loaded,
    sizes,
    deferred,
    load: async (url: string) => {
      if (deferred.has(url)) await new Promise<void>((resolve) => deferred.set(url, resolve));
      let texture = loaded.get(url);
      if (!texture) {
        const [w, h] = sizes.get(url) ?? [1024, 1024];
        texture = { source: { pixelWidth: w, pixelHeight: h }, destroyed: false };
        loaded.set(url, texture);
      }
      return texture;
    },
    unload: async (url: string) => {
      const texture = loaded.get(url);
      loaded.delete(url);
      if (texture) texture.destroyed = true;
    },
  };
});

vi.mock("pixi.js", () => ({
  Assets: {
    load: (url: string) => store.load(url),
    unload: (url: string) => store.unload(url),
    cache: { has: (url: string) => store.loaded.has(url), get: (url: string) => store.loaded.get(url) },
  },
}));

import { IDLE_ART_BUDGET, artLoaded, drawnSources, holdArt, idleArtBudget, loadArt, resetArtMemory, sweepArt } from "./art-memory";

const MIB = 1024 * 1024;
const FIGURE = 4 * MIB; // a 1024 figure, decoded

/** A stage drawing these URLs' textures, nested as Pixi nests them. */
function stageDrawing(...urls: string[]) {
  return { children: [{ children: urls.map((url) => ({ texture: store.loaded.get(url) })) }] };
}

beforeEach(() => {
  resetArtMemory();
  store.loaded.clear();
  store.sizes.clear();
  store.deferred.clear();
});
afterEach(() => resetArtMemory());

describe("sweepArt", () => {
  it("keeps a load still in flight through a sweep, and can let it go once it lands", async () => {
    store.deferred.set("slow", () => undefined);
    const loading = loadArt("slow");
    await Promise.resolve();
    // The scene-change sweep runs before the slow load finishes: nothing to unload yet.
    expect(sweepArt(stageDrawing(), 0).released).toEqual([]);
    store.deferred.get("slow")!();
    await loading;
    expect(artLoaded("slow")).toBe(true);
    // Landed and undrawn: the next sweep holds it to the idle budget like any other.
    expect(sweepArt(stageDrawing(), 0).released).toEqual(["slow"]);
    expect(artLoaded("slow")).toBe(false);
  });


  it("keeps what the stage draws and unloads the oldest undrawn art past the budget", async () => {
    for (const url of ["a", "b", "c", "d"]) await loadArt(url);
    const result = sweepArt(stageDrawing("d"), 2 * FIGURE);
    // d is drawn; c and b are the newest undrawn and fit; a, the oldest, goes.
    expect(result.released).toEqual(["a"]);
    expect(result.idleBytes).toBe(2 * FIGURE);
    expect(result.drawnBytes).toBe(FIGURE);
    expect(artLoaded("a")).toBe(false);
    expect(["b", "c", "d"].every(artLoaded)).toBe(true);
  });

  it("counts asking again as recent: a URL asked for anew outlives one asked for since", async () => {
    for (const url of ["a", "b", "c"]) await loadArt(url);
    await loadArt("a");
    expect(sweepArt(stageDrawing(), FIGURE).released.sort()).toEqual(["b", "c"]);
  });

  it("never unloads held art, but counts it against the budget first", async () => {
    for (const url of ["held", "x", "y"]) await loadArt(url);
    const release = holdArt("held");
    // Held first: the budget then has room for one more, the newest.
    expect(sweepArt(stageDrawing(), 2 * FIGURE).released).toEqual(["x"]);
    expect(sweepArt(stageDrawing(), 0).released).toEqual(["y"]);
    expect(artLoaded("held")).toBe(true);
    release();
    release(); // twice is harmless
    expect(sweepArt(stageDrawing(), 0).released).toEqual(["held"]);
  });

  it("keeps a texture drawn through a slice of its source, as a tile sheet's frames are", async () => {
    const sheet = await loadArt("sheet");
    const slice = { source: sheet.source };
    expect(sweepArt({ children: [{ texture: slice }] }, 0).released).toEqual([]);
    expect(sweepArt({ children: [] }, 0).released).toEqual(["sheet"]);
  });

  it("counts hidden figures as drawn, and skips destroyed branches", async () => {
    await loadArt("hidden");
    await loadArt("gone");
    const stage = { children: [{ visible: false, texture: store.loaded.get("hidden") }, { destroyed: true, children: [{ texture: store.loaded.get("gone") }] }] };
    expect(sweepArt(stage, 0).released).toEqual(["gone"]);
  });

  it("weighs backdrops by their pixels", async () => {
    store.sizes.set("backdrop", [1920, 1080]);
    await loadArt("backdrop");
    await loadArt("figure");
    // A figure fits a 5 MiB budget; the 8 MiB backdrop, the older, does not.
    expect(sweepArt(stageDrawing(), 5 * MIB).released).toEqual(["backdrop"]);
  });

  it("leaves untracked art alone: only what came through loadArt is swept", async () => {
    await store.load("hero-painting");
    expect(sweepArt(stageDrawing(), 0).released).toEqual([]);
    expect(store.loaded.has("hero-painting")).toBe(true);
  });

  it("forgets a URL that never loaded, so missing files do not pile up", async () => {
    holdArt("missing")();
    expect(sweepArt(stageDrawing(), 0)).toEqual({ released: [], idleBytes: 0, drawnBytes: 0 });
  });
});

describe("loadArt", () => {
  it("loads again when the cache hands back a texture a sweep just destroyed", async () => {
    const stale = { source: { pixelWidth: 1, pixelHeight: 1 }, destroyed: true };
    const load = vi.spyOn(store, "load").mockResolvedValueOnce(stale);
    const texture = await loadArt("a");
    expect(texture).not.toBe(stale);
    expect(texture.destroyed).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
    load.mockRestore();
  });
});

describe("drawnSources", () => {
  it("walks masks and children, without recursion limits on a deep tree", () => {
    const source = {};
    let node: { children: unknown[]; texture?: unknown } = { children: [], texture: { source } };
    for (let i = 0; i < 5000; i++) node = { children: [node] };
    const masked = { children: [], mask: { children: [{ texture: { source: "mask" } }] } };
    const found = drawnSources({ children: [node, masked] } as never);
    expect(found.has(source)).toBe(true);
    expect(found.has("mask")).toBe(true);
  });
});

it("budgets a television tighter than a laptop", () => {
  expect(idleArtBudget(true)).toBe(IDLE_ART_BUDGET.tv);
  expect(idleArtBudget(false)).toBe(IDLE_ART_BUDGET.other);
  expect(IDLE_ART_BUDGET.tv).toBeLessThan(IDLE_ART_BUDGET.other);
});
