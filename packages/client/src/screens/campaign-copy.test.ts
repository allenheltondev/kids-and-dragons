import { describe, expect, it } from "vitest";
import { beginLabel, campaignEndHeading, nextChapterLine } from "./campaign-copy";

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
