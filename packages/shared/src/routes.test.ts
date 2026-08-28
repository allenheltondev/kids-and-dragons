/**
 * Which chapter a party enters at a routed beat.
 *
 * The rule three things have to agree about — the server picking a member,
 * the validator checking a beat is complete, the tools drawing the graph — so
 * it is tested once, here, where all three read it from.
 */

import { describe, expect, it } from "vitest";
import type { Chapter } from "./types/chapter.js";
import { beatCount, chapterFor, chaptersByIndex, routeFlagsAt } from "./routes.js";

function chapter(id: string, index: number, route?: { set: string; flag: string }): Chapter {
  return {
    id,
    campaignId: "gemfall",
    index,
    title: id,
    biome: "forest",
    estimatedMinutes: 30,
    xpAward: 100,
    entry: "start",
    scenes: {},
    ...(route ? { route } : {}),
  };
}

/** Two plain beats, then a routed triple — Gemfall's shape in miniature. */
const CORPUS: Chapter[] = [
  chapter("gemfall-01", 1),
  chapter("gemfall-02", 2),
  chapter("gemfall-03a", 3, { set: "road", flag: "route_river" }),
  chapter("gemfall-03b", 3, { set: "road", flag: "route_wild" }),
  chapter("gemfall-03c", 3, { set: "road", flag: "route_rush" }),
];

describe("beats and files", () => {
  it("counts beats, not files — a playthrough is shorter than the corpus", () => {
    expect(CORPUS).toHaveLength(5);
    expect(beatCount(CORPUS)).toBe(3);
  });

  it("groups the members of a routed beat together", () => {
    expect(chaptersByIndex(CORPUS).get(3)?.map((each) => each.id)).toEqual([
      "gemfall-03a",
      "gemfall-03b",
      "gemfall-03c",
    ]);
  });

  it("lists what a party may choose from at a beat", () => {
    expect(routeFlagsAt(CORPUS, 3).sort()).toEqual(["route_river", "route_rush", "route_wild"]);
    // An unrouted beat offers no choice, which is not the same as offering none.
    expect(routeFlagsAt(CORPUS, 1)).toEqual([]);
  });
});

describe("choosing a chapter", () => {
  it("takes the only chapter at an unrouted beat, flags or no flags", () => {
    // Every chapter authored before routing existed is this case.
    expect(chapterFor(CORPUS, 1, {})?.id).toBe("gemfall-01");
    expect(chapterFor(CORPUS, 1, { route_wild: true })?.id).toBe("gemfall-01");
  });

  it("follows the road the party took", () => {
    expect(chapterFor(CORPUS, 3, { route_wild: true })?.id).toBe("gemfall-03b");
    expect(chapterFor(CORPUS, 3, { route_rush: true })?.id).toBe("gemfall-03c");
  });

  it("ignores flags that are set false, not merely absent", () => {
    expect(chapterFor(CORPUS, 3, { route_wild: false, route_river: true })?.id).toBe("gemfall-03a");
  });

  it("has nothing to offer a party that has not chosen yet", () => {
    /*
     * Not an error at authoring time — a party is *supposed* to finish
     * chapter 2 without a road. It is only a problem at the moment they try to
     * enter the beat, which is the caller's to report.
     */
    expect(chapterFor(CORPUS, 3, {})).toBeNull();
  });

  it("refuses rather than guesses when two roads are somehow set", () => {
    /*
     * Flags are set by scenes at runtime, so `content:validate` cannot see
     * this one. Sending a party down a road they did not pick would be worse
     * than stopping: the whole point of the branch is that it was theirs.
     */
    expect(chapterFor(CORPUS, 3, { route_wild: true, route_river: true })).toBeNull();
  });

  it("has nothing at a beat the campaign does not have", () => {
    expect(chapterFor(CORPUS, 9, { route_wild: true })).toBeNull();
  });

  it("keeps two axes apart, so a pursuit triple does not answer a road", () => {
    // Gemfall's chapter 7 is a triple keyed on the pursuit, not the road.
    const withPursuit = [
      ...CORPUS,
      chapter("gemfall-07r", 4, { set: "pursuit", flag: "pursuit_reckoning" }),
      chapter("gemfall-07h", 4, { set: "pursuit", flag: "pursuit_collection" }),
    ];
    expect(chapterFor(withPursuit, 4, { route_wild: true })).toBeNull();
    expect(chapterFor(withPursuit, 4, { pursuit_collection: true })?.id).toBe("gemfall-07h");
  });
});
