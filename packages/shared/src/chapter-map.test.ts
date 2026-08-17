/**
 * The chapter map — layout, not validation.
 *
 * The one relationship worth holding tight is the one against
 * `chapter-graph.ts`: the validator and the picture must agree about which
 * edges exist, or the author is reading a diagram of a different chapter than
 * the one CI is checking. They deliberately do not share a function — the
 * validator's labels are built for error messages and this one's are built to
 * be recognised — so the agreement is asserted here instead.
 */

import { describe, expect, it } from "vitest";
import { chapterMap, depths, edgesOf } from "./chapter-map.js";
import { sceneEdges, validateChapter } from "./chapter-graph.js";
import type { Chapter, Scene } from "./types/chapter.js";
import { makeChapter } from "./test-fixtures.js";

const CHAPTER = makeChapter();

function withScenes(scenes: Record<string, Scene>, entry = "a"): Chapter {
  return { ...CHAPTER, entry, scenes };
}

const story = (...gotos: string[]): Scene => ({
  type: "story",
  narration: "…",
  choices: gotos.map((goto, i) => ({ id: `c${String(i)}`, label: `to ${goto}`, icon: "arrow", goto })),
});

const ending: Scene = { type: "story", narration: "The end.", choices: [] };

describe("agreeing with the validator about what an edge is", () => {
  it("draws exactly the edges `sceneEdges` counts, for every scene in the fixture", () => {
    /*
     * The load-bearing test in this file. `chapter-graph.ts` decides whether a
     * chapter is broken and this decides what an author sees; the day they
     * disagree, the validator is right and this should go red rather than
     * quietly draw a chapter nobody is checking.
     */
    for (const [id, scene] of Object.entries(CHAPTER.scenes)) {
      expect(edgesOf(id, scene).map((edge) => edge.to)).toEqual(
        sceneEdges(scene).map((edge) => edge.to),
      );
    }
  });

  it("draws nothing for a scene type neither of them knows", () => {
    // Authored JSON reaches here with types the union does not have, and the
    // validator is already reporting that. Throwing over the top of its message
    // would replace an explanation with a stack trace.
    const alien = { type: "cutscene", narration: "?" } as unknown as Scene;
    expect(edgesOf("x", alien)).toEqual([]);
    expect(sceneEdges(alien)).toEqual([]);
  });
});

describe("labelling an edge", () => {
  it("uses the choice's own label, not its id", () => {
    const edges = edgesOf("scene_clearing", CHAPTER.scenes["scene_clearing"] as Scene);
    expect(edges.map((edge) => edge.label)).toEqual(["Look for a gap", "Go over it"]);
  });

  it("names a check by the number it is against", () => {
    const edges = edgesOf("check_squeeze", CHAPTER.scenes["check_squeeze"] as Scene);
    expect(edges[0]).toMatchObject({ kind: "success", label: "quick ≥ 12" });
    expect(edges[1]).toMatchObject({ kind: "failure", label: "missed it" });
  });

  it("never says a fight was lost, because there is no losing", () => {
    // spec §7.3 — a wipe branches the story. A diagram that said "lost" would
    // teach an author the wrong shape of chapter to write.
    const edges = edgesOf("encounter_wisps", CHAPTER.scenes["encounter_wisps"] as Scene);
    expect(edges.map((edge) => edge.kind)).toEqual(["victory", "defeat"]);
    expect(edges[1]?.label).toBe("went badly");
  });
});

describe("gates", () => {
  it("marks a species-gated choice with the species that can take it", () => {
    const edges = edgesOf("scene_clearing", CHAPTER.scenes["scene_clearing"] as Scene);
    expect(edges[0]?.gate).toBeNull();
    expect(edges[1]?.gate).toBe("dragonling or griffin");
  });

  it("names a flag and an item gate too, and both at once", () => {
    const gated = withScenes({
      a: {
        type: "story",
        narration: "…",
        choices: [
          {
            id: "secret",
            label: "Use the key",
            icon: "key",
            goto: "a",
            requiresFlag: "found_shrine",
            requiresItem: "rusted_key",
          },
        ],
      },
    });
    expect(edgesOf("a", gated.scenes["a"] as Scene)[0]?.gate).toBe(
      "flag: found_shrine, holds: rusted_key",
    );
  });

  it("treats an empty species list as no gate rather than as an impossible one", () => {
    const empty = withScenes({
      a: {
        type: "story",
        narration: "…",
        choices: [{ id: "c", label: "Go", icon: "arrow", goto: "a", requiresSpecies: [] }],
      },
    });
    expect(edgesOf("a", empty.scenes["a"] as Scene)[0]?.gate).toBeNull();
  });
});

describe("depth from the entry", () => {
  it("counts the longest way there, not the shortest", () => {
    /*
     * The correction that makes the picture honest. Shortest-path depth would
     * put `d` on row 1, one row under `a` and *level with* `b` — and the edge
     * `c → d` would then run sideways or upward and read as a loop. Longest
     * path puts every scene below everything that can precede it, so an arrow
     * pointing up is a real loop and nothing else.
     */
    const both = withScenes({
      a: story("b", "d"),
      b: story("c"),
      c: story("d"),
      d: ending,
    });
    expect(depths(both).get("d")).toBe(3);
  });

  it("never leaves a forward edge running level or upward", () => {
    // The property the whole layering exists for, stated directly.
    const map = chapterMap(CHAPTER);
    const rows = new Map(map.nodes.map((node) => [node.id, node.row]));
    for (const edge of map.edges) {
      const from = rows.get(edge.from);
      const to = rows.get(edge.to);
      if (from === undefined || to === undefined) continue;
      expect(to, `${edge.from} → ${edge.to}`).toBeGreaterThan(from);
    }
  });

  it("leaves out anything the entry cannot reach", () => {
    const orphaned = withScenes({ a: story("b"), b: ending, lost: ending });
    const found = depths(orphaned);
    expect(found.get("b")).toBe(1);
    expect(found.has("lost")).toBe(false);
  });

  it("cuts a loop rather than being stretched by it", () => {
    /*
     * Longest path is meaningless on a cyclic graph, so the walk drops the edge
     * that closes the loop — the one pointing at a scene still open on its own
     * stack — and lays out what is left. Two scenes in a circle are still two
     * rows, not however many passes it took to notice.
     */
    const loop = withScenes({ a: story("b"), b: story("a") });
    expect([...depths(loop).entries()].sort()).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });

  it("keeps a cross edge, which is not a loop even though it looks like one", () => {
    /*
     * `b → d` reaches a scene the walk has already finished with. That is an
     * ordinary forward edge and it has to keep its say in the layout — cutting
     * every edge into an already-visited scene would collapse every place two
     * paths rejoin, which is most of what a branching chapter is.
     */
    const rejoin = withScenes({ a: story("c", "b"), b: story("d"), c: story("d"), d: ending });
    // d sits below both b and c rather than beside them.
    expect(depths(rejoin).get("d")).toBe(2);
  });

  it("finds nothing when the entry names a scene that is not there", () => {
    // `MISSING_ENTRY` / `UNKNOWN_ENTRY` is the validator's to report. This just
    // has to not invent a story out of it.
    expect(depths(withScenes({ a: ending }, "nowhere")).size).toBe(0);
  });

  it("ignores an edge pointing at a scene that does not exist", () => {
    const dangling = withScenes({ a: story("b", "ghost"), b: ending });
    const found = depths(dangling);
    expect(found.has("ghost")).toBe(false);
    expect(found.get("b")).toBe(1);
  });
});

describe("laying the chapter out", () => {
  it("puts the entry alone on the first row", () => {
    const map = chapterMap(CHAPTER);
    const first = map.nodes.filter((node) => node.row === 0);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: CHAPTER.entry, entry: true, depth: 0, column: 0 });
  });

  it("spreads a row left to right in the order the file writes them", () => {
    // Two scenes at the same depth have no natural order, and the file's is the
    // one already in the author's head. Sorting by id would put `check_squeeze`
    // ahead of `scene_clearing` and make the picture disagree with the text.
    const wide = withScenes({ a: story("m", "z", "b"), z: ending, m: ending, b: ending });
    const row1 = chapterMap(wide)
      .nodes.filter((node) => node.row === 1)
      .sort((x, y) => x.column - y.column)
      .map((node) => node.id);
    expect(row1).toEqual(["z", "m", "b"]);
  });

  it("marks a scene with no way out as terminal, because that is how a chapter ends", () => {
    const map = chapterMap(CHAPTER);
    expect(map.nodes.find((node) => node.id === "scene_ending")?.terminal).toBe(true);
    expect(map.nodes.find((node) => node.id === "scene_ridge")?.terminal).toBe(false);
  });

  it("puts every orphan in one band under the story, not scattered through it", () => {
    /*
     * An orphan's distance from the start is not a fact about it — that is the
     * whole problem with an orphan. Giving it a made-up depth would draw it as
     * though it belonged somewhere.
     */
    const orphaned = withScenes({ a: story("b"), b: ending, lost: story("also_lost"), also_lost: ending });
    const map = chapterMap(orphaned);
    const orphans = map.nodes.filter((node) => !node.reachable);

    expect(orphans.map((node) => node.id).sort()).toEqual(["also_lost", "lost"]);
    expect(orphans.every((node) => node.depth === null)).toBe(true);
    expect(new Set(orphans.map((node) => node.row)).size).toBe(1);
    expect(orphans[0]?.row).toBe(map.depth);
  });

  it("agrees with the validator about which scenes are orphans", () => {
    const orphaned = withScenes({ a: story("b"), b: ending, lost: ending });
    const map = chapterMap(orphaned);
    const reported = validateChapter(orphaned)
      .filter((issue) => issue.code === "UNREACHABLE_SCENE")
      .map((issue) => issue.sceneId);
    expect(map.nodes.filter((node) => !node.reachable).map((node) => node.id)).toEqual(reported);
  });

  it("marks an edge that runs back up the page", () => {
    /*
     * The reason to draw a chapter at all. A loop is invisible in JSON — it is
     * one `goto` among a dozen — and completely obvious as an arrow pointing
     * the wrong way.
     */
    const loop = withScenes({ a: story("b"), b: story("c", "a"), c: ending });
    const edges = chapterMap(loop).edges;
    expect(edges.find((edge) => edge.from === "b" && edge.to === "a")?.backward).toBe(true);
    expect(edges.find((edge) => edge.from === "b" && edge.to === "c")?.backward).toBe(false);
  });

  it("does not call an ordinary shortcut a loop", () => {
    /*
     * The bug this layering replaced. Under shortest-path depth, `b` and `c`
     * both sat one hop from `a`, so `b → c` ran level and got marked amber —
     * on the reference chapter that mislabelled seventeen perfectly ordinary
     * edges, which is worse than not marking loops at all.
     */
    const shortcut = withScenes({ a: story("b", "c"), b: story("c"), c: ending });
    const edges = chapterMap(shortcut).edges;
    expect(edges.some((edge) => edge.backward)).toBe(false);
  });

  it("keeps an edge to a scene the chapter does not have", () => {
    // The validator reports it as `UNKNOWN_GOTO`; the picture should show the
    // arrow going nowhere rather than silently drop the choice that is broken.
    const dangling = withScenes({ a: story("ghost"), b: ending });
    const edge = chapterMap(dangling).edges.find((each) => each.to === "ghost");
    expect(edge).toBeTruthy();
    expect(edge?.backward).toBe(false);
  });

  it("draws an empty chapter without inventing anything", () => {
    const map = chapterMap(withScenes({}));
    expect(map).toEqual({ nodes: [], edges: [], depth: 0 });
  });
});
