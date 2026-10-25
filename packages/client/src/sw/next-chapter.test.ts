/**
 * Which chapter the overnight refresh gets ready (#467): decided on the phone
 * from the saved journal's Story and the campaign's content, against the real
 * Gemfall and Riftlight files where they show the shape best.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { storyPlateUrl, type Campaign, type Chapter, type JournalStoryCampaign } from "@kad/shared";
import { JOURNAL_DB_NAME, JOURNAL_RECORD_KEY, JOURNAL_STORE } from "../store/journal-db";
import { chapterAssets } from "./chapter-art";
import {
  SW_JOURNAL_DB,
  SW_NEXT_CHAPTERS_MAX,
  swActiveStory,
  swChapterPath,
  swChaptersToRead,
  swHeldFlags,
  swHeroesOf,
  swNextChapterArt,
  swNextChapters,
  type SwChapterFacts,
} from "./next-chapter";

const content = (path: string): unknown => JSON.parse(readFileSync(new URL(`../../../../content/${path}`, import.meta.url), "utf8"));
const gemfall = content("campaigns/gemfall.json") as Campaign;
const riftlight = content("campaigns/riftlight.json") as Campaign;
const chapter = (id: string): Chapter => content(`chapters/${id}.json`) as Chapter;

/** What the worker would have read: every chapter `swChaptersToRead` names. */
function factsFor(campaign: Campaign, played: string[]): SwChapterFacts {
  return Object.fromEntries(swChaptersToRead(campaign, played).map((id) => [id, chapter(id)]));
}

function story(campaignId: string, chapters: { id: string; lastTime?: string[] }[], status: JournalStoryCampaign["status"] = "active"): JournalStoryCampaign {
  return {
    campaignId,
    title: campaignId,
    status,
    chapters: chapters.map(({ id, lastTime = [] }) => ({ chapterId: id, title: id, revealed: [], lastTime })),
  };
}

describe("the campaign the household is in", () => {
  it("is the newest one still going", () => {
    const journal = { story: [story("riftlight", [], "complete"), story("gemfall", [{ id: "gemfall-01" }, { id: "gemfall-02", lastTime: ["a line"] }])] };
    expect(swActiveStory(journal)).toEqual({ campaignId: "gemfall", played: ["gemfall-01", "gemfall-02"], lines: ["a line"] });
  });

  it("is nobody's guess when there is no Story or every campaign is finished", () => {
    expect(swActiveStory(null)).toBeNull();
    expect(swActiveStory({})).toBeNull();
    expect(swActiveStory({ story: [story("gemfall", [{ id: "gemfall-08" }], "complete"), story("riftlight", [], "failed")] })).toBeNull();
  });

  it("reads the page's own journal store", () => {
    expect(SW_JOURNAL_DB).toEqual({ name: JOURNAL_DB_NAME, store: JOURNAL_STORE, key: JOURNAL_RECORD_KEY });
  });
});

describe("the next chapter of an ordered campaign", () => {
  it("is the beat after the last one played", () => {
    const played = ["gemfall-01"];
    expect(swNextChapters(gemfall, { played, lines: [] }, factsFor(gemfall, played))).toEqual(["gemfall-02"]);
  });

  it("is the first beat when the attempt has played nothing yet", () => {
    expect(swChaptersToRead(gemfall, [])[0]).toBe("gemfall-01");
    expect(swNextChapters(gemfall, { played: [], lines: [] }, factsFor(gemfall, []))).toEqual(["gemfall-01"]);
  });

  it("warms every road of a forked beat the journal cannot rule out", () => {
    const played = ["gemfall-01", "gemfall-02"];
    expect(swNextChapters(gemfall, { played, lines: [] }, factsFor(gemfall, played))).toEqual(["gemfall-03a", "gemfall-03b", "gemfall-03c"]);
  });

  it("narrows to the road a \"Last time\" line names", () => {
    const played = ["gemfall-01", "gemfall-02"];
    const lines = [gemfall.lastTime!.lines["route_rush"] as string];
    expect(swHeldFlags(gemfall, lines)).toEqual(new Set(["route_rush"]));
    expect(swNextChapters(gemfall, { played, lines }, factsFor(gemfall, played))).toEqual(["gemfall-03c"]);
  });

  it("reads a line in either wording when it reads the inventory", () => {
    const campaign = { lastTime: { opener: "", lines: { ember_kept: { holding: "facet_ember", text: "You kept it.", otherwise: "You meant to." }, ember_sold: "You sold it." } } };
    expect(swHeldFlags(campaign, ["You meant to."])).toEqual(new Set(["ember_kept"]));
    expect(swHeldFlags(campaign, ["You kept it.", "Something else."])).toEqual(new Set(["ember_kept"]));
    expect(swHeldFlags(campaign, [])).toEqual(new Set());
  });

  it("stays on the road of the chapter just played", () => {
    const played = ["gemfall-01", "gemfall-02", "gemfall-03b"];
    expect(swChaptersToRead(gemfall, played)).toContain("gemfall-04b");
    expect(swNextChapters(gemfall, { played, lines: [] }, factsFor(gemfall, played))).toEqual(["gemfall-04b"]);
  });

  it("joins the roads again where the campaign does, and forks at the next set", () => {
    const after05 = ["gemfall-01", "gemfall-02", "gemfall-03a", "gemfall-04a", "gemfall-05a"];
    expect(swNextChapters(gemfall, { played: after05, lines: [] }, factsFor(gemfall, after05))).toEqual(["gemfall-06"]);
    const after06 = [...after05, "gemfall-06"];
    expect(swNextChapters(gemfall, { played: after06, lines: [] }, factsFor(gemfall, after06))).toEqual(["gemfall-07r", "gemfall-07h", "gemfall-07l"]);
  });

  it("is nothing past the last beat, or when the last chapter could not be read", () => {
    const all = ["gemfall-01", "gemfall-02", "gemfall-03a", "gemfall-04a", "gemfall-05a", "gemfall-06", "gemfall-07r", "gemfall-08"];
    expect(swNextChapters(gemfall, { played: all, lines: [] }, factsFor(gemfall, all))).toEqual([]);
    expect(swNextChapters(gemfall, { played: ["gemfall-02"], lines: [] }, {})).toEqual([]);
  });

  it("ignores chapters of other campaigns in the list", () => {
    const played = ["gemfall-01", "first-steps-01"];
    expect(swNextChapters(gemfall, { played, lines: [] }, factsFor(gemfall, played))).toEqual(["gemfall-02"]);
  });

  it("never gets more than a few chapters ready", () => {
    const wide: Campaign = { ...gemfall, chapters: ["one", "a", "b", "c", "d", "e"] };
    const facts: SwChapterFacts = { one: { index: 1 }, a: { index: 2 }, b: { index: 2 }, c: { index: 2 }, d: { index: 2 }, e: { index: 2 } };
    expect(swNextChapters(wide, { played: ["one"], lines: [] }, facts)).toHaveLength(SW_NEXT_CHAPTERS_MAX);
  });
});

describe("the next chapter of a graph campaign", () => {
  it("is the entry's chapter before anything is played, and reads no chapter files", () => {
    expect(swChaptersToRead(riftlight, [])).toEqual([]);
    expect(swNextChapters(riftlight, { played: [], lines: [] }, {})).toEqual(["riftlight-exchange-rift"]);
  });

  it("is where the ways out of the last place played lead", () => {
    const played = ["riftlight-exchange-rift", "riftlight-glacier-survival"];
    expect(swNextChapters(riftlight, { played, lines: [] }, {})).toEqual(["riftlight-riftseekers-departure"]);
  });

  it("takes forward ways first, then sideways, never back, locked or to a closed place already played", () => {
    const graph = {
      version: 1,
      entry: "a",
      nodes: {
        a: { chapter: "ch-a", revisit: "closed" },
        b: { chapter: "ch-b" },
        c: { chapter: "ch-c" },
        d: { chapter: "ch-d" },
        e: { chapter: "ch-e" },
      },
      edges: {
        back: { from: "b", to: "a", kind: "return" },
        side: { from: "b", to: "c", kind: "sideways" },
        ahead: { from: "b", to: "d", kind: "forward" },
        shut: { from: "b", to: "e", kind: "forward", locked: true },
        closed: { from: "b", to: "a", kind: "forward" },
      },
    } as unknown as NonNullable<Campaign["graph"]>;
    const campaign = { chapters: ["ch-a", "ch-b", "ch-c", "ch-d", "ch-e"], graph };
    expect(swNextChapters(campaign, { played: ["ch-a", "ch-b"], lines: [] }, {})).toEqual(["ch-d", "ch-c"]);
  });
});

describe("the art it gets ready", () => {
  const heroes = swHeroesOf({
    heroes: [{ species: "unicorn", tier: "fledgling", class: "songkeeper" }, { species: "griffin", tier: "sworn", class: "starweaver" }] as never,
  });

  it("is the chapter's plate first, then everything it can draw, with the heroes' figures", () => {
    const next = chapter("gemfall-03a");
    const urls = swNextChapterArt([next], heroes);
    expect(urls[0]).toBe(storyPlateUrl(next.plate!.art));
    expect(urls.slice(1)).toEqual(chapterAssets(next, heroes));
    expect(urls).toContain("/assets/character-rigs/starweaver/sworn/griffin/assembled.png");
  });

  it("names each file once across several roads", () => {
    const roads = ["gemfall-03a", "gemfall-03b", "gemfall-03c"].map(chapter);
    const urls = swNextChapterArt(roads, heroes);
    expect(new Set(urls).size).toBe(urls.length);
    for (const road of roads) for (const url of chapterAssets(road, heroes)) expect(urls).toContain(url);
  });

  it("takes only a few heroes, and skips anything that is not one", () => {
    const many = Array.from({ length: 6 }, () => ({ species: "kitsune", tier: "fledgling", class: "thornguard" }));
    expect(swHeroesOf({ heroes: [...many, null] as never })).toHaveLength(4);
    expect(swHeroesOf({ heroes: [null, { species: 3 }] as never })).toEqual([]);
    expect(swHeroesOf(null)).toEqual([]);
  });

  it("reads chapters where the page reads them", () => {
    expect(swChapterPath("gemfall-03a")).toBe("/content/chapters/gemfall-03a.json");
  });
});
