import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chapter } from "@kad/shared";
import { makeChapter } from "../../../shared/src/test-fixtures";

const memory = vi.hoisted(() => ({
  loads: [] as string[],
  holds: new Map<string, number>(),
  sweeps: [] as number[],
}));

vi.mock("./art-memory", () => ({
  idleArtBudget: (tv: boolean) => (tv ? 1 : 2),
  loadArt: async (url: string) => {
    memory.loads.push(url);
    return {};
  },
  holdArt: (url: string) => {
    memory.holds.set(url, (memory.holds.get(url) ?? 0) + 1);
    return () => memory.holds.set(url, (memory.holds.get(url) ?? 1) - 1);
  },
  sweepArt: (_stage: unknown, budget: number) => {
    memory.sweeps.push(budget);
    return { released: [], idleBytes: 0, drawnBytes: 0 };
  },
}));

import { ART_AHEAD, ART_UPKEEP_DELAY_MS, artAhead, scheduleArtUpkeep } from "./art-upkeep";

/** clearing → (check_squeeze | shrine); shrine → encounter_wisps, with art on the first two. */
function chapter(): Chapter {
  const base = makeChapter();
  const scenes = structuredClone(base.scenes);
  scenes["scene_clearing"] = { ...scenes["scene_clearing"]!, art: "scenes/bramblewood/clearing" } as never;
  scenes["scene_shrine"] = { ...scenes["scene_shrine"]!, art: "scenes/bramblewood/shrine" } as never;
  return { ...base, scenes };
}

beforeEach(() => {
  vi.useFakeTimers();
  memory.loads = [];
  memory.holds.clear();
  memory.sweeps = [];
});
afterEach(() => vi.useRealTimers());

describe("artAhead", () => {
  it("is one step ahead only, without the scene the party is in", () => {
    const ahead = artAhead(chapter(), "scene_clearing", 10);
    expect(ahead).toContain("/assets/scenes/bramblewood/shrine.webp");
    expect(ahead).not.toContain("/assets/scenes/bramblewood/clearing.webp");
    // The fight is two steps away (clearing → shrine → wisps): not decoded yet.
    expect(ahead.some((url) => url.includes("tiles"))).toBe(false);
  });

  it("is capped, and empty without a chapter or a scene", () => {
    expect(artAhead(chapter(), "scene_clearing", 1)).toHaveLength(1);
    expect(artAhead(null, "scene_clearing", 3)).toEqual([]);
    expect(artAhead(chapter(), null, 3)).toEqual([]);
    expect(artAhead(chapter(), "no_such_scene", 3)).toEqual([]);
    expect(ART_AHEAD.tv).toBeLessThan(ART_AHEAD.other);
    expect(ART_AHEAD.phone).toBeLessThan(ART_AHEAD.tv);
  });

  it("puts every choice's backdrop before anything else those scenes draw", () => {
    const base = chapter();
    const scenes = structuredClone(base.scenes);
    // The shrine now has someone standing in it: their figure comes after both backdrops.
    scenes["scene_shrine"] = { ...scenes["scene_shrine"]!, cast: [{ id: "keeper", name: "Keeper", figure: "cast/keeper" }] } as never;
    const ahead = artAhead({ ...base, scenes }, "scene_clearing", 10);
    const shrine = ahead.indexOf("/assets/scenes/bramblewood/shrine.webp");
    const figure = ahead.findIndex((url) => url.includes("keeper"));
    expect(shrine).toBeGreaterThanOrEqual(0);
    if (figure >= 0) expect(figure).toBeGreaterThan(shrine);
    expect(artAhead({ ...base, scenes }, "scene_clearing", 10, true).some((url) => url.includes("keeper"))).toBe(false);
  });
});

describe("scheduleArtUpkeep", () => {
  it("waits, sweeps with the device's budget, then holds and loads what is ahead, one at a time on a TV", async () => {
    scheduleArtUpkeep({}, { ahead: ["a", "b"], tv: true });
    expect(memory.sweeps).toEqual([]);
    await vi.advanceTimersByTimeAsync(ART_UPKEEP_DELAY_MS);
    expect(memory.sweeps).toEqual([1]);
    expect(memory.holds.get("a")).toBe(1);
    expect(memory.holds.get("b")).toBe(1);
    expect(memory.loads).toEqual(["a", "b"]);
  });

  it("lets go of its holds when the scene changes, and loads nothing more", async () => {
    const stop = scheduleArtUpkeep({}, { ahead: ["a", "b", "c"], tv: true });
    await vi.advanceTimersByTimeAsync(ART_UPKEEP_DELAY_MS);
    stop();
    expect([...memory.holds.values()]).toEqual([0, 0, 0]);
  });

  it("does nothing at all when the scene changes before the delay", async () => {
    scheduleArtUpkeep({}, { ahead: ["a"], tv: false })();
    await vi.advanceTimersByTimeAsync(ART_UPKEEP_DELAY_MS * 2);
    expect(memory.sweeps).toEqual([]);
    expect(memory.loads).toEqual([]);
  });

  it("only sweeps when there is nothing to look ahead to (a phone's world pane)", async () => {
    scheduleArtUpkeep({}, { ahead: [], tv: false });
    await vi.advanceTimersByTimeAsync(ART_UPKEEP_DELAY_MS);
    expect(memory.sweeps).toEqual([2]);
    expect(memory.loads).toEqual([]);
  });
});
