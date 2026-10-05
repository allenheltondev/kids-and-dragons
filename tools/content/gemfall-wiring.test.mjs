/**
 * Gemfall's wiring — docs/campaigns/gemfall-authoring.md §2, as a test.
 *
 * `content:validate` checks what holds for any campaign: no path sets two
 * members of one route set. What it cannot know is which forks a particular
 * chapter is *responsible* for. Chapter 02 that can end without a road strands
 * the party at beat 3 with no chapter to start; chapter 06 that can end without
 * a pursuit strands them at beat 7. Those obligations are Gemfall's, so they
 * live here, walked path by path over the shipped files.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { routeOutcomes } from "./route-paths.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => JSON.parse(readFileSync(join(REPO, ...parts), "utf8"));

const campaign = read("content", "campaigns", "gemfall.json");
const chapter = (id) => read("content", "chapters", `${id}.json`);

/** Which route sets each chapter must set on every path to every ending. */
const MUST_SET = {
  "gemfall-01": ["motive", "ember"],
  "gemfall-02": ["road", "sprites"],
  "gemfall-03a": ["crossing"],
  "gemfall-03b": ["west_branch"],
  "gemfall-03c": ["west_branch"],
  "gemfall-04b": ["glade"],
  "gemfall-05a": ["allies"],
  "gemfall-05b": ["allies"],
  "gemfall-05c": ["allies"],
  "gemfall-06": ["pursuit", "seal_clock"],
};

function endingsOf(id) {
  const { endings, truncated } = routeOutcomes(chapter(id), campaign.routeSets);
  expect(truncated, `${id}: too many paths to check`).toBe(false);
  expect(endings.length, `${id}: no reachable ending`).toBeGreaterThan(0);
  return endings;
}

describe("every Gemfall chapter sets the forks it is responsible for", () => {
  for (const [id, sets] of Object.entries(MUST_SET)) {
    it(`${id} sets ${sets.join(" and ")} on every path`, () => {
      for (const { ending, flags } of endingsOf(id)) {
        for (const set of sets) {
          const members = campaign.routeSets[set];
          const held = flags.filter((flag) => members.includes(flag));
          expect(held, `${id}: a path to ${ending} sets ${held.length} member(s) of "${set}"`).toHaveLength(1);
        }
      }
    });
  }
});

describe("the weave re-routes exactly where the story says", () => {
  const road = (flags) => flags.filter((flag) => campaign.routeSets.road.includes(flag));

  it("a Rush Road party the ford sweeps west is put on the Wild Road, and only then", () => {
    for (const { ending, flags } of endingsOf("gemfall-03c")) {
      const swept = flags.includes("marsh_kept_us");
      expect(road(flags), `gemfall-03c → ${ending}`).toEqual(swept ? ["route_wild"] : []);
    }
  });

  it("a Wild Road party that walks over into the rush is put on the Rush Road, and only then", () => {
    for (const { ending, flags } of endingsOf("gemfall-03b")) {
      const walked = flags.includes("walked_over");
      expect(road(flags), `gemfall-03b → ${ending}`).toEqual(walked ? ["route_rush"] : []);
    }
  });

  it("nothing after the fork changes road except those two", () => {
    for (const id of campaign.chapters) {
      if (["gemfall-02", "gemfall-03b", "gemfall-03c"].includes(id)) continue;
      for (const { ending, flags } of endingsOf(id)) {
        expect(road(flags), `${id} → ${ending}`).toEqual([]);
      }
    }
  });

  it("only the Collection may turn south, and turning south ends the campaign there", () => {
    // gemfall.md: the Walk is 7H's exit, and a walking party never enters
    // chapter 8. The engine's word for that is an ending with endsCampaign.
    for (const id of campaign.chapters) {
      const early = Object.entries(chapter(id).scenes).filter(([, scene]) => scene.endsCampaign);
      if (id === "gemfall-07h") {
        expect(early.length, "07h has no ending that finishes the campaign").toBeGreaterThan(0);
        for (const [sceneId] of early) expect(sceneId, "only the Walk ends the campaign early").toMatch(/^walk_/);
      } else {
        expect(early.map(([sceneId]) => sceneId), `${id} ends the campaign early`).toEqual([]);
      }
    }
  });

  it("the finale offers all four philosophies to every party", () => {
    // Pursuits are not walls (gemfall.md): the seal-chamber decision stays the
    // player's. Restore, Destroy, Control and Exploit are all ungated; what a
    // party's pursuit changes is how hard the road to each one is.
    const choices = chapter("gemfall-08").scenes.scene_seal_chamber.choices;
    for (const id of ["restore", "destroy", "leash", "keystone"]) {
      const choice = choices.find((c) => c.id === id);
      expect(choice, `no ${id} choice in the seal chamber`).toBeDefined();
      expect(choice.requiresFlag ?? choice.requiresItem ?? choice.requiresSpecies, `${id} is gated`).toBeUndefined();
    }
  });

  it("chapter 2 can send a party down every road", () => {
    const roads = new Set(endingsOf("gemfall-02").flatMap(({ flags }) => road(flags)));
    expect([...roads].sort()).toEqual(["route_river", "route_rush", "route_wild"]);
  });

  it("chapter 6 can declare every pursuit", () => {
    const pursuits = new Set(
      endingsOf("gemfall-06").flatMap(({ flags }) => flags.filter((f) => campaign.routeSets.pursuit.includes(f))),
    );
    expect([...pursuits].sort()).toEqual(["pursuit_hoard", "pursuit_leash", "pursuit_restore"]);
  });
});
