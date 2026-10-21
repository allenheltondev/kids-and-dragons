import { describe, expect, it } from "vitest";
import { chapterStoryOf, heardWith, storyChapterView, storyChapters } from "./story-so-far.js";
import type { Campaign, Chapter } from "./types/chapter.js";
import type { ResolvedCharacter } from "./types/domain.js";

const campaign: Campaign = {
  id: "walk",
  title: "The Walk",
  blurb: "A walk.",
  chapters: ["walk-01", "walk-02a", "walk-02b"],
  routeSets: { road: ["road_hill", "road_lake"], stone: ["stone_kept", "stone_left"] },
  lastTime: {
    opener: "A walk begins.",
    lines: {
      road_hill: "You went up the hill.",
      road_lake: "You went round the lake.",
      stone_kept: { holding: "facet_moon", text: "You kept the moon stone. It is in your pack.", otherwise: "You kept the moon stone, once." },
      stone_left: "You left the moon stone where it was.",
    },
  },
};

const chapter = {
  id: "walk-01",
  index: 1,
  title: "The Gate",
  entry: "start",
  goal: { text: "Get through the gate.", steps: [] },
  scenes: {
    start: { type: "story", narration: "A gate.", choices: [] },
    reveal: {
      type: "story",
      priority: 1,
      narration: "The gate is a door.",
      variants: [
        { when: { count: { of: "facet_*", max: 0 } }, text: "Your hands are empty, so it is up to {party}." },
        { when: { count: { of: "facet_*", min: 1 } }, text: "The great stones hum at it, {facets} of them." },
        { when: { flag: "door_seen" }, text: "You knew it all along." },
      ],
      choices: [],
    },
    clue: { type: "story", priority: 2, narration: "A clue.", choices: [] },
    end_home: { type: "rest", narration: "Home. You put the kettle on, and it whistles a tune.", choices: [] },
    end_lost: { type: "rest", outcome: "setback", narration: "Lost in the fog for a whole night.", choices: [] },
  },
} as unknown as Chapter;

function hero(items: string[]): ResolvedCharacter {
  return { inventory: [{ itemId: "potion", kind: "consumable" }], questItems: items } as unknown as ResolvedCharacter;
}

describe("what a chapter keeps for the Story page", () => {
  it("keeps the ending, the p1 scenes in order, the roads it decided and only the items its words read", () => {
    const story = chapterStoryOf({
      campaign,
      chapter,
      ending: "end_home",
      visited: ["start", "clue", "reveal", "reveal", "end_home"],
      flags: { road_hill: true, stone_kept: true, door_seen: true },
      before: { road_hill: true },
      party: { members: [hero(["facet_moon", "facet_sun"]), hero(["rope"])] },
      revealHeld: { reveal: ["facet_sun"] },
    });
    expect(story).toEqual({
      chapterId: "walk-01",
      ending: "end_home",
      revealed: ["reveal"],
      // The revelation keeps the bag it was heard with, not the one at the end.
      heard: { reveal: ["facet_sun"] },
      // The hill was carried in; only the stone is this chapter's.
      decided: ["stone_kept"],
      // At the end: only what the ending and the decided lines read (the moon stone's line).
      held: ["facet_moon"],
    });
  });

  it("knows which scenes' words read the bag, and what of it", () => {
    const scenes = chapter.scenes as Record<string, Parameters<typeof heardWith>[0]>;
    expect(heardWith(scenes["reveal"]!, { members: [hero(["facet_moon", "rope"])] })).toEqual(["facet_moon"]);
    expect(heardWith(scenes["reveal"]!, { members: [hero([])] })).toEqual([]);
    expect(heardWith(scenes["clue"]!, { members: [hero(["facet_moon"])] })).toBeNull();
  });

  it("leaves empty keys off", () => {
    const story = chapterStoryOf({
      campaign, chapter, ending: "end_home", visited: ["start", "end_home"], flags: {}, before: undefined, party: { members: [hero([])] },
    });
    expect(story).toEqual({ chapterId: "walk-01", ending: "end_home" });
  });
});

describe("a chapter on the Story page", () => {
  it("reads the revelation and the lines against the bag it kept, and never counts the party", () => {
    const holding = storyChapterView(campaign, chapter, {
      chapterId: "walk-01", ending: "end_home", revealed: ["reveal"], heard: { reveal: ["facet_moon", "facet_sun"] },
      decided: ["stone_kept"], held: ["facet_moon"],
    });
    expect(holding).toEqual({
      chapterId: "walk-01",
      title: "The Gate",
      goal: "Get through the gate.",
      outcome: "success",
      ending: "Home. You put the kettle on, and it whistles a tune.",
      // The flag variant is left out: the page cannot know the chapter's own flags.
      revealed: ["The gate is a door.\n\nThe great stones hum at it, two of them."],
      lastTime: ["You kept the moon stone. It is in your pack."],
    });

    const empty = storyChapterView(campaign, chapter, {
      chapterId: "walk-01", ending: "end_lost", revealed: ["reveal"], heard: { reveal: [] }, decided: ["stone_kept"],
    });
    expect(empty.outcome).toBe("setback");
    expect(empty.revealed).toEqual(["The gate is a door.\n\nYour hands are empty, so it is up to you."]);
    expect(empty.lastTime).toEqual(["You kept the moon stone, once."]);
  });

  it("quotes a revelation as it was heard when the bag changes after it, either way", () => {
    // Empty-handed at the revelation, a stone picked up before the end.
    const gained = storyChapterView(campaign, chapter, {
      chapterId: "walk-01", ending: "end_home", revealed: ["reveal"], heard: { reveal: [] }, decided: ["stone_kept"], held: ["facet_moon"],
    });
    expect(gained.revealed).toEqual(["The gate is a door.\n\nYour hands are empty, so it is up to you."]);
    // The lines are read at the end, against the bag then.
    expect(gained.lastTime).toEqual(["You kept the moon stone. It is in your pack."]);

    // A stone in hand at the revelation, gone by the end.
    const lost = storyChapterView(campaign, chapter, {
      chapterId: "walk-01", ending: "end_home", revealed: ["reveal"], heard: { reveal: ["facet_moon"] }, decided: ["stone_kept"],
    });
    expect(lost.revealed).toEqual(["The gate is a door.\n\nThe great stones hum at it, one of them."]);
    expect(lost.lastTime).toEqual(["You kept the moon stone, once."]);
  });

  it("quotes only the words every party heard when a revelation's bag was never kept", () => {
    const unknown = storyChapterView(campaign, chapter, { chapterId: "walk-01", ending: "end_home", revealed: ["reveal"], held: ["facet_moon"] });
    expect(unknown.revealed).toEqual(["The gate is a door."]);
    // A scene whose words never read the bag needs no record.
    const plain = { ...chapter, scenes: { ...chapter.scenes, reveal: { type: "story", priority: 1, narration: "Plain words.", choices: [] } } } as unknown as Chapter;
    expect(storyChapterView(campaign, plain, { chapterId: "walk-01", ending: "end_home", revealed: ["reveal"] }).revealed).toEqual(["Plain words."]);
  });

  it("lists an older row's chapters by title, choosing a routed beat only by the one road it holds", () => {
    const chapters: Record<string, Chapter> = {
      "walk-01": chapter,
      "walk-02a": { ...chapter, id: "walk-02a", index: 2, title: "Hill", route: { set: "road", flag: "road_hill" } } as Chapter,
      "walk-02b": { ...chapter, id: "walk-02b", index: 2, title: "Lake", route: { set: "road", flag: "road_lake" } } as Chapter,
    };
    const byId = (id: string) => chapters[id];
    expect(storyChapters(campaign, { lastIndex: 2, routeFlags: { road_lake: true } }, byId).map((c) => c.title)).toEqual(["The Gate", "Lake"]);
    expect(storyChapters(campaign, { lastIndex: 2 }, byId).map((c) => c.title)).toEqual(["The Gate"]);
    // A row that started keeping stories partway: the older beats by title, then the kept ones in full.
    const mixed = storyChapters(campaign, { lastIndex: 2, routeFlags: { road_hill: true }, story: [{ chapterId: "walk-02a", ending: "end_home" }] }, byId);
    expect(mixed.map((c) => [c.title, c.outcome])).toEqual([["The Gate", undefined], ["Hill", "success"]]);
    // A graph journey names its own chapters.
    expect(storyChapters(campaign, { journey: { chaptersCompleted: ["walk-02b", "walk-01"] } }, byId).map((c) => c.title)).toEqual(["Lake", "The Gate"]);
  });
});
