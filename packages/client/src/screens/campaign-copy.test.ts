import { describe, expect, it } from "vitest";
import { beginLabel, campaignEndHeading, campaignPremise, chapterHeading, nextChapterLine } from "./campaign-copy";

const VIEW = { id: "gemfall", title: "Gemfall", chapters: 8, next: { index: 4, title: "The Pride Roads" } };

describe("what the screens say about the campaign", () => {
  it("names the next chapter and where it sits", () => {
    expect(nextChapterLine(VIEW)).toBe("Chapter 4 of 8: The Pride Roads");
    expect(nextChapterLine(null)).toBeNull();
    expect(nextChapterLine({ ...VIEW, next: null })).toBeNull();
  });

  it("begins, continues, or begins again", () => {
    expect(beginLabel(null)).toBe("Begin the adventure");
    expect(beginLabel({ ...VIEW, next: { index: 1, title: "The City" } })).toBe("Begin the adventure");
    expect(beginLabel(VIEW)).toBe("Play chapter 4");
    expect(beginLabel({ ...VIEW, next: { index: 1, title: "The City" }, ended: "complete" })).toBe("Start Gemfall again");
  });

  it("only names a campaign ending when there was one", () => {
    expect(campaignEndHeading(VIEW)).toBeNull();
    expect(campaignEndHeading({ ...VIEW, ended: "complete" })).toBe("Gemfall is complete!");
  });
});

describe("setting the scene for a new table", () => {
  const PREMISE = "Mount Red Sky has erupted.";

  it("heads a scene with the chapter's number and real title", () => {
    expect(chapterHeading({ chapterInfo: { index: 1, title: "The City" }, campaign: VIEW })).toBe(
      "Chapter 1 of 8 · The City",
    );
    // A one-off chapter has no campaign to count against.
    expect(chapterHeading({ chapterInfo: { index: 1, title: "The City" }, campaign: null })).toBe(
      "Chapter 1 · The City",
    );
    // A run persisted before titles rode on the state: the caller falls back.
    expect(chapterHeading({ campaign: VIEW })).toBeNull();
  });

  it("tells the premise before chapter 1, and not to a party halfway through", () => {
    expect(campaignPremise({ ...VIEW, blurb: PREMISE, next: { index: 1, title: "The City" } })).toBe(PREMISE);
    expect(campaignPremise({ ...VIEW, blurb: PREMISE })).toBeNull();
    // The table that just finished it has just lived it; a new room starting
    // over carries no `ended` and is told like any first evening.
    expect(
      campaignPremise({ ...VIEW, blurb: PREMISE, next: { index: 1, title: "The City" }, ended: "complete" }),
    ).toBeNull();
    expect(campaignPremise({ ...VIEW, next: { index: 1, title: "The City" } })).toBeNull();
  });
});
