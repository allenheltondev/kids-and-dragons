// @vitest-environment jsdom
/**
 * ChapterMapPanel — where the party is.
 *
 * Two promises worth holding. The map names what the party has seen and keeps
 * quiet about what it has not: a fogged stop is a dot with no words on it, so
 * a child scrolling ahead learns that the road forks and nothing else. And the
 * party stands on exactly one stop — the run's `sceneId` — whatever the
 * `visited` trail does or does not contain, because a run persisted before
 * that field existed still has to put somebody on the map.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Chapter } from "@kad/shared";
import { makeChapter } from "../../../shared/src/test-fixtures";
import { makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { ChapterMapPanel, mapTrail, sceneLabel } from "./ChapterMapPanel";

const CHAPTER: Chapter = makeChapter();

function mount(overrides: {
  sceneId?: string | null;
  visited?: string[];
  chapterId?: string | null;
  chapter?: Chapter | null;
  phase?: "scene" | "chapter_complete" | "lobby";
}) {
  const state = makeState({
    phase: overrides.phase ?? "scene",
    chapterId: overrides.chapterId === undefined ? CHAPTER.id : overrides.chapterId,
    sceneId: overrides.sceneId === undefined ? "scene_shrine" : overrides.sceneId,
    party: [makeMember()],
    ...(overrides.visited === undefined ? {} : { visited: overrides.visited }),
  });
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "travel", sessionToken: "t" },
    state,
    chapter: overrides.chapter === undefined ? CHAPTER : overrides.chapter,
    loadContent: async () => undefined,
    loadChapter: async () => undefined,
  });
  return render(<ChapterMapPanel />);
}

afterEach(() => {
  cleanup();
});

describe("naming a stop", () => {
  it("drops the authoring prefix and makes words of the rest", () => {
    expect(sceneLabel("scene_singing_stream", "story")).toBe("Singing Stream");
    expect(sceneLabel("check_wisps", "check")).toBe("Wisps");
    expect(sceneLabel("rest_mossbank", "rest")).toBe("Mossbank");
    expect(sceneLabel("choice_point_path", "choice_point")).toBe("Path");
    expect(sceneLabel("encounter_bramblewisps", "encounter")).toBe("Bramblewisps");
  });

  it("names a stop for what it is when the id is only its prefix", () => {
    expect(sceneLabel("ending", "rest")).toBe("A rest");
    expect(sceneLabel("end", "story")).toBe("A place");
  });

  it("leaves an id that follows no convention alone, apart from the casing", () => {
    expect(sceneLabel("the-long-way", "story")).toBe("The Long Way");
  });
});

describe("laying the trail", () => {
  it("puts the party on the current scene even when the run has no visited trail", () => {
    const trail = mapTrail(CHAPTER, { sceneId: "scene_shrine" });
    const here = trail.stops.filter((stop) => stop.here);
    expect(here.map((stop) => stop.id)).toEqual(["scene_shrine"]);
    expect(trail.seenCount).toBe(1);
  });

  it("marks the visited scenes as seen and nothing else", () => {
    const visited = ["scene_clearing", "check_squeeze", "scene_scratched"];
    const trail = mapTrail(CHAPTER, { sceneId: "scene_shrine", visited });
    const seen = trail.stops.filter((stop) => stop.seen).map((stop) => stop.id);
    expect(seen.sort()).toEqual([...visited, "scene_shrine"].sort());
    expect(trail.totalCount).toBeGreaterThan(seen.length);
  });

  it("tells a walked road from one leading into the fog", () => {
    const trail = mapTrail(CHAPTER, {
      sceneId: "check_squeeze",
      visited: ["scene_clearing"],
    });
    const walked = trail.roads.filter((road) => road.walked);
    expect(walked.map((road) => `${road.from}>${road.to}`)).toContain("scene_clearing>check_squeeze");
    // The other choice out of the entry has not been taken.
    const ahead = trail.roads.filter((road) => road.ahead);
    expect(ahead.some((road) => road.from === "scene_clearing")).toBe(true);
    // Nothing deeper in the chapter is walked yet.
    expect(walked.every((road) => road.from === "scene_clearing")).toBe(true);
  });

  it("keeps every stop inside the picture", () => {
    const trail = mapTrail(CHAPTER, { sceneId: CHAPTER.entry });
    for (const stop of trail.stops) {
      expect(stop.x).toBeGreaterThan(0);
      expect(stop.x).toBeLessThan(1);
      expect(stop.y).toBeGreaterThan(0);
      expect(stop.y).toBeLessThan(1);
    }
    expect(trail.aspect).toBeGreaterThan(0);
  });
});

describe("the panel", () => {
  it("names what the party has seen and keeps quiet about the rest", () => {
    const { container } = mount({
      sceneId: "scene_shrine",
      visited: ["scene_clearing", "check_squeeze"],
    });

    expect(screen.getByText("Clearing")).toBeTruthy();
    expect(screen.getByText("Squeeze")).toBeTruthy();
    expect(screen.getByText("Shrine")).toBeTruthy();
    // A fogged stop is drawn, and says nothing.
    const fogged = container.querySelector('[data-scene="scene_ending"]');
    expect(fogged).not.toBeNull();
    expect(fogged?.textContent).toBe("");
    expect(screen.queryByText("Ending")).toBeNull();
  });

  it("stands the party on exactly one stop", () => {
    const { container } = mount({ sceneId: "scene_shrine" });
    const here = container.querySelectorAll('[aria-current="location"]');
    expect(here).toHaveLength(1);
    expect(here[0]?.getAttribute("data-scene")).toBe("scene_shrine");
    expect(here[0]?.querySelectorAll(".trail__face")).toHaveLength(1);
    expect(screen.getByText("You are here")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("The party is at Shrine.");
  });

  it("says how far along the chapter is", () => {
    mount({ sceneId: "scene_shrine", visited: ["scene_clearing", "check_squeeze"] });
    const total = Object.keys(CHAPTER.scenes).length;
    expect(screen.getByRole("status").textContent).toContain(`3 of ${String(total)} places seen.`);
  });

  it("says the chapter is finished rather than where the party stands", () => {
    mount({ sceneId: "scene_ending", phase: "chapter_complete" });
    expect(screen.getByRole("status").textContent).toContain("The chapter is finished.");
  });

  it("explains itself before the story has begun", () => {
    mount({ chapterId: null, sceneId: null, phase: "lobby" });
    expect(screen.getByText("The map fills in once the story begins.")).toBeTruthy();
  });

  it("waits for the right chapter rather than drawing the last one", () => {
    // The store still holds the previous chapter while this one is fetched.
    mount({ chapterId: "bramblewood-02", sceneId: "scene_somewhere" });
    expect(screen.getByText("Unrolling the map…")).toBeTruthy();
  });
});
