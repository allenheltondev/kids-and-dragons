/**
 * Chapter map — the scene graph, laid out (roadmap chapter 6).
 *
 * `chapter-graph.ts` already answers "is this chapter broken": dead ends,
 * orphans, unresolved `goto`, missing branches, unknown items. Its own header
 * says the authoring tool would run the same function "to draw dead ends and
 * orphans in its editor" — and there was no editor, so nothing ever did.
 *
 * This is the drawing half, and it is a separate module because it answers a
 * different question. A validator asks whether a chapter is *valid*. An author
 * looking at a graph is asking whether it is *good*: does the interesting
 * choice actually branch, or do both roads meet again on the next screen; is
 * the species-gated shortcut the only way to skip the fight; how many scenes
 * deep is the ending. None of those are errors and all of them are why you draw
 * a chapter rather than read it.
 *
 * Pure, and layout-only: it produces coordinates and labels, and `tools/content/
 * graph.ts` turns them into SVG. Nothing here knows what a pixel is — which is
 * what lets the layering be tested without a browser.
 *
 * ---------------------------------------------------------------------------
 * WHY LAYERS, AND WHY THE *LONGEST* PATH
 *
 * A chapter is played forwards, so the layout is layered: layer 0 is the
 * opening scene, endings sit at the bottom, and an edge that runs back *up* the
 * page is visible as one. A force-directed layout would optimise for edge
 * crossings and throw that away.
 *
 * A row is the **longest** path from the entry — the most scenes a party could
 * have played before arriving here — and that is a correction rather than a
 * preference. Shortest-path (BFS) depth is the obvious choice and it makes the
 * picture lie: two scenes one step apart in the story land on the same row
 * whenever both are reachable from the entry in the same number of hops, and
 * the edge between them then reads as "goes back up". On the reference chapter
 * that mislabelled seventeen ordinary forward edges as loops, which is worse
 * than not drawing loops at all.
 *
 * Longest-path layering has the property the picture actually needs: on a DAG
 * every authored edge points downward, so an edge that still points up is a
 * *real* cycle — a scene the party can return to — and worth the amber.
 *
 * Scenes nothing reaches get no row at all rather than a made-up one. They are
 * drawn in their own band, because an orphan's position relative to the story
 * is not a fact — that is the whole problem with it.
 */

import { reachableScenes, sceneEdges } from "./chapter-graph.js";
import type { Chapter, Scene, SceneId } from "./types/chapter.js";

/** Where an edge comes from, which is the same thing as what kind of edge it is. */
export type EdgeKind = "choice" | "success" | "failure" | "victory" | "defeat";

export interface MapEdge {
  from: SceneId;
  to: SceneId;
  kind: EdgeKind;
  /** The choice's own label, or the branch's name. What an author recognises. */
  label: string;
  /**
   * A requirement that *hides* this edge from a party that does not match it
   * (architecture §5 — requirements hide, they never grey out). Drawn dashed,
   * because a gated edge is the one an author most often forgets is optional,
   * and a scene whose every edge is gated is `chapter-graph.ts`'s `DEAD_END`.
   */
  gate: string | null;
  /** True when this edge goes back up the page — a loop, or a scene revisited. */
  backward: boolean;
}

export interface MapNode {
  id: SceneId;
  type: string;
  /**
   * The longest path from `entry` — the most scenes a party could have played
   * before arriving here. Null for a scene nothing reaches.
   */
  depth: number | null;
  /** Row on the page. Unreachable scenes sit in a band below everything else. */
  row: number;
  /** Position within the row, left to right. */
  column: number;
  /** No outgoing edges: this is how a chapter finishes (chapter-graph.ts). */
  terminal: boolean;
  /** `entry`, drawn differently because it is where the evening starts. */
  entry: boolean;
  reachable: boolean;
}

export interface ChapterMap {
  nodes: MapNode[];
  edges: MapEdge[];
  /** How many rows the reachable story occupies, before the orphan band. */
  depth: number;
}

/** The gate on a choice, phrased the way it reads in the file. */
function gateOf(choice: {
  requiresSpecies?: string | string[];
  requiresFlag?: string;
  requiresItem?: string;
}): string | null {
  const gates: string[] = [];
  if (choice.requiresSpecies !== undefined) {
    const species = Array.isArray(choice.requiresSpecies)
      ? choice.requiresSpecies
      : [choice.requiresSpecies];
    if (species.length > 0) gates.push(species.join(" or "));
  }
  if (choice.requiresFlag !== undefined) gates.push(`flag: ${choice.requiresFlag}`);
  if (choice.requiresItem !== undefined) gates.push(`holds: ${choice.requiresItem}`);
  return gates.length > 0 ? gates.join(", ") : null;
}

/**
 * Every edge out of a scene, with the label and gate a picture needs.
 *
 * Not `sceneEdges`, though it agrees with it about *which* edges exist — that
 * one carries a `via` string built for an error message (`choice "squeeze"`),
 * and an author reading a diagram wants the choice's label ("Look for a gap").
 * The overlap is checked in the tests rather than shared, because the day the
 * two disagree about what an edge is, the validator is the one that is right
 * and this should fail loudly rather than quietly draw a different chapter.
 */
export function edgesOf(sceneId: SceneId, scene: Scene): Omit<MapEdge, "backward">[] {
  switch (scene.type) {
    case "story":
    case "choice_point":
    case "rest":
      return scene.choices.map((choice) => ({
        from: sceneId,
        to: choice.goto,
        kind: "choice" as const,
        label: choice.label,
        gate: gateOf(choice),
      }));
    case "check":
      return [
        ...(scene.onSuccess
          ? [
              {
                from: sceneId,
                to: scene.onSuccess.goto,
                kind: "success" as const,
                label: `${scene.stat} ≥ ${String(scene.tn)}`,
                gate: null,
              },
            ]
          : []),
        ...(scene.onFailure
          ? [
              {
                from: sceneId,
                to: scene.onFailure.goto,
                kind: "failure" as const,
                label: "missed it",
                gate: null,
              },
            ]
          : []),
      ];
    case "encounter":
      return [
        ...(scene.onVictory
          ? [
              {
                from: sceneId,
                to: scene.onVictory.goto,
                kind: "victory" as const,
                label: "won",
                gate: null,
              },
            ]
          : []),
        ...(scene.onDefeat
          ? [
              {
                from: sceneId,
                to: scene.onDefeat.goto,
                kind: "defeat" as const,
                // §7.3 — a wipe branches the story. Never "lost", because
                // there is no losing, and a diagram that said so would teach
                // an author the wrong shape.
                label: "went badly",
                gate: null,
              },
            ]
          : []),
      ];
    default:
      // Authored JSON: an unknown `type` reaches here despite the union, and
      // the validator is already reporting it. Drawing no edges beats throwing
      // over the top of the message that explains the problem.
      return [];
  }
}

/**
 * The row each reachable scene sits on: the longest path from the entry, over
 * the graph with its cycles cut. Absent for anything the entry cannot reach.
 *
 * A chapter is allowed to loop — a scene the party can wander back to is a
 * legitimate thing to author, and `chapter-graph.ts` does not forbid it — and
 * longest path is meaningless on a graph that does. So the cycles come out
 * first, by a depth-first walk from the entry: an edge that points at a scene
 * already on the walk's own stack is the edge that closes a loop, and it is the
 * one dropped. What is left is a DAG, and relaxing over it terminates.
 *
 * Which is also exactly the answer the picture wants. Every edge that survived
 * points down the page; every edge that was cut points up, and gets drawn as
 * the loop it is.
 */
export function depths(chapter: Chapter): Map<SceneId, number> {
  const rows = new Map<SceneId, number>();
  const entry = chapter.entry;
  if (chapter.scenes[entry] === undefined) return rows;

  // Reachability first: an unreachable scene must not be pulled onto the page
  // by an edge out of another unreachable one.
  const reachable = reachableScenes(chapter);
  for (const id of reachable) rows.set(id, 0);

  const out = new Map<SceneId, SceneId[]>();
  for (const id of reachable) {
    const scene = chapter.scenes[id];
    out.set(
      id,
      scene ? sceneEdges(scene).map((edge) => edge.to).filter((to) => reachable.has(to)) : [],
    );
  }

  /*
   * Iterative rather than recursive. Chapters are small enough that it would
   * not matter today, and a generated 40-scene chapter is exactly the kind of
   * input a tool should not fall over on.
   */
  const forward: { from: SceneId; to: SceneId }[] = [];
  const onStack = new Set<SceneId>();
  const done = new Set<SceneId>();
  const stack: { id: SceneId; next: number }[] = [{ id: entry, next: 0 }];
  onStack.add(entry);

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (!frame) break;
    const children = out.get(frame.id) ?? [];
    if (frame.next >= children.length) {
      onStack.delete(frame.id);
      done.add(frame.id);
      stack.pop();
      continue;
    }
    const child = children[frame.next];
    frame.next += 1;
    if (child === undefined) continue;
    // The one edge kind that is dropped: back onto something still open on this
    // walk, which is the definition of closing a loop. A cross edge into an
    // already-finished subtree is a perfectly ordinary forward edge and stays.
    if (onStack.has(child)) continue;
    forward.push({ from: frame.id, to: child });
    if (!done.has(child)) {
      onStack.add(child);
      stack.push({ id: child, next: 0 });
    }
  }

  // Acyclic now, so this converges in at most one pass per scene.
  for (let pass = 0; pass < reachable.size; pass += 1) {
    let moved = false;
    for (const edge of forward) {
      const want = (rows.get(edge.from) ?? 0) + 1;
      if (want > (rows.get(edge.to) ?? 0)) {
        rows.set(edge.to, want);
        moved = true;
      }
    }
    if (!moved) break;
  }

  return rows;
}

/** The whole thing: nodes with rows and columns, edges with labels and gates. */
export function chapterMap(chapter: Chapter): ChapterMap {
  const depth = depths(chapter);
  const reachable = reachableScenes(chapter);
  const storyRows = depth.size === 0 ? 0 : Math.max(...depth.values()) + 1;

  /*
   * Authored order within a row, not sorted. Two scenes at the same depth have
   * no natural order, and the file's is the one the author already has in their
   * head — sorting by id would put `check_squeeze` before `scene_clearing` and
   * make the picture disagree with the text it came from.
   */
  const rows = new Map<number, SceneId[]>();
  const nodes: MapNode[] = [];
  for (const [id, scene] of Object.entries(chapter.scenes)) {
    // Unreachable scenes go in one band under the story, all at the same row:
    // an orphan's distance from the start is not a fact about it.
    const row = depth.get(id) ?? storyRows;
    const bucket = rows.get(row) ?? [];
    bucket.push(id);
    rows.set(row, bucket);
    nodes.push({
      id,
      type: scene.type,
      depth: depth.get(id) ?? null,
      row,
      column: bucket.length - 1,
      terminal: edgesOf(id, scene).length === 0,
      entry: id === chapter.entry,
      reachable: reachable.has(id),
    });
  }

  const edges: MapEdge[] = [];
  for (const [id, scene] of Object.entries(chapter.scenes)) {
    const fromRow = nodes.find((node) => node.id === id)?.row ?? 0;
    for (const edge of edgesOf(id, scene)) {
      const toRow = nodes.find((node) => node.id === edge.to)?.row;
      edges.push({ ...edge, backward: toRow !== undefined && toRow <= fromRow });
    }
  }

  return { nodes, edges, depth: storyRows };
}
