import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LAST_TIME_MAX_LINES,
  carriedRouteFlags,
  firstSentence,
  lastTimeLines,
  leftOffLines,
} from "./chapter-preface.js";
import type { Campaign, Chapter } from "./types/chapter.js";

const campaign: Campaign = {
  id: "walk",
  title: "The Walk",
  blurb: "A walk.",
  chapters: ["walk-01"],
  routeSets: {
    road: ["road_hill", "road_lake"],
    snack: ["snack_shared", "snack_kept"],
    hat: ["hat_lost", "hat_found"],
    weather: ["sunny", "rainy"],
    dog: ["dog_followed", "dog_stayed"],
  },
  lastTime: {
    opener: "A walk begins.",
    lines: {
      snack_shared: "You shared your snack.",
      snack_kept: { holding: "facet_snack", text: "You kept your snack. It is in your pack.", otherwise: "You kept your snack, once." },
      road_hill: "You went up the hill.",
      road_lake: "You went round the lake.",
      hat_lost: "A goose took your hat.",
      hat_found: "You found your hat.",
      sunny: "The sun came out.",
      rainy: "It rained on your sandwiches.",
      dog_followed: "A dog followed you.",
      dog_stayed: "The dog stayed home.",
    },
  },
};

function chapter(scenes: Record<string, unknown>, entry = "start"): Chapter {
  return { id: "walk-01", campaignId: "walk", index: 1, title: "Out", entry, scenes } as unknown as Chapter;
}

const plain = chapter({ start: { type: "story", narration: "Off you go.", choices: [] } });

describe("Last time… (#357)", () => {
  it("reads one line per carried flag, in the campaign's story order, not routeSets order", () => {
    const picked = lastTimeLines(campaign, plain, { flags: { road_lake: true, snack_shared: true } });
    expect(picked).toEqual({ recap: true, lines: ["You shared your snack.", "You went round the lake."] });
  });

  it("gives a party that carries nothing the opener", () => {
    expect(lastTimeLines(campaign, plain, { flags: {} })).toEqual({ recap: false, lines: ["A walk begins."] });
    // A chapter-local flag is not a carried one.
    expect(lastTimeLines(campaign, plain, { flags: { opened_gate: true } })).toEqual({ recap: false, lines: ["A walk begins."] });
  });

  it("ignores a flag that is false, and a member the entry scene sets as the chapter opens", () => {
    const opens = chapter({
      start: { type: "story", narration: "Off.", onEnter: [{ type: "setFlag", flag: "sunny" }], choices: [] },
    });
    expect(carriedRouteFlags(campaign, opens, { sunny: true, road_hill: true, hat_lost: false })).toEqual(["road_hill"]);
    expect(lastTimeLines(campaign, opens, { flags: { sunny: true } })).toEqual({ recap: false, lines: ["A walk begins."] });
  });

  it("keeps the newest few, so the table hears the last things it decided", () => {
    const flags = { snack_shared: true, road_hill: true, hat_found: true, rainy: true, dog_followed: true };
    const picked = lastTimeLines(campaign, plain, { flags })!;
    expect(picked.lines).toHaveLength(LAST_TIME_MAX_LINES);
    expect(picked.lines).toEqual(["You went up the hill.", "You found your hat.", "It rained on your sandwiches.", "A dog followed you."]);
  });

  it("reads the inventory for a line that names a great stone", () => {
    const held = new Set(["facet_snack"]);
    expect(lastTimeLines(campaign, plain, { flags: { snack_kept: true }, held })!.lines).toEqual(["You kept your snack. It is in your pack."]);
    expect(lastTimeLines(campaign, plain, { flags: { snack_kept: true }, held: new Set() })!.lines).toEqual(["You kept your snack, once."]);
    expect(lastTimeLines(campaign, plain, { flags: { snack_kept: true } })!.lines).toEqual(["You kept your snack, once."]);
  });

  it("is nothing at all for a campaign without lastTime", () => {
    expect(lastTimeLines({ ...campaign, lastTime: undefined }, plain, { flags: { road_hill: true } })).toBeNull();
  });
});

describe("Gemfall's Last time lines", () => {
  const gemfall = JSON.parse(readFileSync(new URL("../../../content/campaigns/gemfall.json", import.meta.url), "utf8")) as Campaign;
  const members = Object.values(gemfall.routeSets ?? {}).flat();

  it("has one for every route-set member", () => {
    expect(Object.keys(gemfall.lastTime?.lines ?? {}).sort()).toEqual([...members].sort());
  });

  it("starts a first chapter with the opener", () => {
    expect(lastTimeLines(gemfall, null, { flags: {} })!.recap).toBe(false);
  });

  it("reads a chapter 3 party its motive, the Ember, the sprites and its road", () => {
    const flags = { motive_duty: true, ember_kept: true, sprites_friends: true, route_river: true };
    const lines = lastTimeLines(gemfall, null, { flags, held: new Set(["facet_ember"]) })!.lines;
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/keep folk safe/);
    expect(lines[1]).toMatch(/still in your pack/);
    expect(lines[3]).toMatch(/River Road/);
    // The same party without the Ember in any pack is not told it has it.
    expect(lastTimeLines(gemfall, null, { flags, held: new Set() })!.lines[1]).not.toMatch(/in your pack, humming/);
  });

  it("reads a chapter 8 party its newest decisions, ending on the mountain", () => {
    const flags = {
      motive_wealth: true, ember_sold: true, sprites_wronged: true, route_rush: true, walked_over: true,
      refused_the_cult: true, told_gatherers: true, pursuit_leash: true, clock_late: true,
    };
    const lines = lastTimeLines(gemfall, null, { flags })!.lines;
    expect(lines).toHaveLength(LAST_TIME_MAX_LINES);
    expect(lines.at(-1)).toMatch(/drum/);
    expect(lines.at(-2)).toMatch(/leash/);
  });

  it("never counts the party, and uses no em or en dashes", () => {
    const texts = [gemfall.lastTime!.opener, ...Object.values(gemfall.lastTime!.lines).flatMap((line) => (typeof line === "string" ? [line] : [line.text, line.otherwise]))];
    for (const text of texts) {
      expect(text, text).not.toMatch(/[–—]/);
      expect(text, text).not.toMatch(/\b(?:two|three|four) of (?:you|us)\b|\b(?:both|each) of you\b|\bthe two of you\b/i);
    }
  });
});

describe("Where you left off (#357)", () => {
  const trail = chapter({
    a: { type: "story", narration: "The gate creaks open. A goose watches.", choices: [] },
    b: { type: "story", narration: "Splash! The bridge is wet. Very wet.", choices: [] },
    c: { type: "story", narration: "You have {facets} stones.", choices: [] },
    d: { type: "story", narration: "A goat eats the map.", variants: [{ when: { flag: "x" }, text: "A goat eats the other map." }], choices: [] },
    e: { type: "story", narration: "The hill is steep and long.", choices: [] },
    now: { type: "story", narration: "Here you are.", choices: [] },
  }, "a");

  it("quotes the first sentence of each of the last scenes before this one, oldest first", () => {
    expect(leftOffLines(trail, ["a", "b", "e", "now"])).toEqual(["The gate creaks open.", "Splash! The bridge is wet.", "The hill is steep and long."]);
  });

  it("passes over a scene whose words differ by party (a token, a variant), and never quotes where you stand", () => {
    expect(leftOffLines(trail, ["a", "c", "d", "now"])).toEqual(["The gate creaks open."]);
    expect(leftOffLines(trail, ["now"])).toEqual([]);
  });

  it("quotes a scene the trail walked twice only once", () => {
    expect(leftOffLines(trail, ["a", "e", "a", "e", "now"], 3)).toEqual(["The gate creaks open.", "The hill is steep and long."]);
  });

  it("splits sentences without losing a closing quote", () => {
    expect(firstSentence('"Hello there, travelers!" says the troll. Then nothing.')).toBe('"Hello there, travelers!" says the troll.');
  });
});
