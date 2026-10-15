import { describe, expect, it } from "vitest";
import type { JourneyExitView, JourneyView } from "@kad/shared";
import {
  beginLabel,
  campaignEndHeading,
  campaignPremise,
  chapterHeading,
  exitArrivalChip,
  exitBlockedLine,
  exitKindLabel,
  exitNeedsConfirm,
  exitWarning,
  journeyBeginLabel,
  journeyLine,
  journeyStuckLine,
  nextChapterLine,
  riftActionIcon,
  riftActionNeedsConfirm,
  riftActionNeedsLine,
  riftActionWarning,
} from "./campaign-copy";

describe("riftActionNeedsLine (#199)", () => {
  it("names the classes and items a way needs, in words", () => {
    expect(riftActionNeedsLine(undefined)).toBeNull();
    expect(riftActionNeedsLine({ anyClass: ["starweaver"] })).toBe("Starweaver");
    expect(riftActionNeedsLine({ anyClass: ["thornguard", "songkeeper"] })).toBe("Thornguard or Songkeeper");
    const names = (id: string) => (id === "mosslight_jar" ? "Mosslight Jar" : undefined);
    expect(riftActionNeedsLine({ anyItem: ["mosslight_jar"] }, names)).toBe("Mosslight Jar");
    expect(riftActionNeedsLine({ anyItem: ["mosslight_jar"] })).toBe("something you carry");
    expect(riftActionNeedsLine({ anyClass: ["duskrunner"], anyItem: ["luckstone"] }, () => "Luckstone")).toBe("Duskrunner with Luckstone");
  });
});

const VIEW = { id: "gemfall", title: "Gemfall", chapters: 8, next: { index: 4, title: "The Pride Roads" } };

describe("what the screens say about the campaign", () => {
  it("names the next chapter and where it sits", () => {
    expect(nextChapterLine(VIEW)).toBe("Chapter 4: The Pride Roads");
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
      "Chapter 1 · The City",
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
    // An unchosen fork is a later beat, not the beginning.
    expect(campaignPremise({ ...VIEW, blurb: PREMISE, next: null })).toBeNull();
    // The table that just finished it has just lived it; a new room starting
    // over carries no `ended` and is told like any first evening.
    expect(
      campaignPremise({ ...VIEW, blurb: PREMISE, next: { index: 1, title: "The City" }, ended: "complete" }),
    ).toBeNull();
    expect(campaignPremise({ ...VIEW, next: { index: 1, title: "The City" } })).toBeNull();
  });
});

describe("the journey's words (#195)", () => {
  const exit = (overrides: Partial<JourneyExitView> = {}): JourneyExitView => ({
    edge: "e",
    to: "x",
    kind: "forward",
    label: "On",
    available: true,
    arrival: "new",
    ...overrides,
  });
  const journey = (overrides: Partial<JourneyView> = {}): JourneyView => ({
    node: "orchard",
    title: "The Orchard",
    visit: 1,
    status: "choosing",
    chapter: "c",
    exits: [],
    ...overrides,
  });

  it("introduces each kind of way in a child's words", () => {
    expect(exitKindLabel("forward")).toBe("Onward");
    expect(exitKindLabel("sideways")).toBe("Side trip");
    expect(exitKindLabel("return")).toBe("Head back");
  });

  it("never gives a raw reason code, or what would unblock the way", () => {
    for (const reason of ["locked", "spent", "closed", "guard", undefined, "rift-sealed" as never] as JourneyExitView["reason"][]) {
      const line = exitBlockedLine(reason);
      expect(line).not.toMatch(/spent|guard|rift/i);
      expect(line.length).toBeGreaterThan(10);
    }
  });

  it("asks before a one-way or one-time crossing, and not before any other", () => {
    expect(exitNeedsConfirm(exit())).toBe(false);
    expect(exitNeedsConfirm(exit({ irreversible: true }))).toBe(true);
    expect(exitNeedsConfirm(exit({ once: true }))).toBe(true);
    expect(exitWarning(exit({ irreversible: true }))).toBe("You won't be able to come back this way.");
    expect(exitWarning(exit({ once: true }))).toBe("You can only go this way one time.");
  });

  it("says what a way leads to, and nothing for a blocked one", () => {
    expect(exitArrivalChip(exit())).toEqual({ icon: "star", text: "Unexplored" });
    expect(exitArrivalChip(exit({ arrival: "replay" }))).toEqual({ icon: "check", text: "Been here" });
    expect(exitArrivalChip(exit({ arrival: "pass" }))?.text).toBe("Been here");
    expect(exitArrivalChip(exit({ arrival: "replay", changed: true }))?.text).toBe("It has changed");
    expect(exitArrivalChip(exit({ available: false, reason: "locked" }))).toBeNull();
  });

  it("names the button for where the party is", () => {
    const played = [{ node: "w", title: "W", visits: 1, completed: true }];
    expect(journeyBeginLabel(journey({ status: "playing" }))).toBe("Begin the adventure");
    expect(journeyBeginLabel(journey({ status: "playing", places: played }))).toBe("Go to The Orchard");
    expect(journeyBeginLabel(journey({ status: "playing", places: played, visit: 2 }))).toBe("Go back to The Orchard");
    expect(journeyBeginLabel(journey({ status: "ended" }))).toBe("Start again");
  });

  it("tells the table where the journey stands, and says nothing for an ordered campaign", () => {
    expect(journeyLine(VIEW)).toBeNull();
    expect(journeyLine(null)).toBeNull();
    expect(journeyLine({ ...VIEW, journey: journey() })).toBe("Deciding where to go from The Orchard");
    expect(
      journeyLine({
        ...VIEW,
        journey: journey({ status: "ended", reachedEnding: { node: "g", title: "The Dawn Gate" } }),
      }),
    ).toBe("Ending found: The Dawn Gate");
  });
});

describe("rifts in a child's words (#196, #197)", () => {
  const RIFT_REASONS = [
    "rift-dormant",
    "rift-faded",
    "rift-closed",
    "rift-consumed",
    "rift-expired",
    "rift-collapsed",
    "fallback",
  ] as const;

  it("gives every rift reason its own plain sentence, never the code and never the generic one", () => {
    const lines = RIFT_REASONS.map((reason) => exitBlockedLine(reason));
    expect(new Set(lines).size).toBe(RIFT_REASONS.length);
    for (const line of lines) {
      expect(line).not.toMatch(/spent|guard|rift|fallback/i);
      expect(line).not.toBe(exitBlockedLine(undefined));
    }
    expect(exitBlockedLine("rift-consumed")).toBe("It's all used up.");
  });

  it("asks before a close nothing can undo, and only then", () => {
    expect(riftActionNeedsConfirm({ irreversible: true })).toBe(true);
    expect(riftActionNeedsConfirm({})).toBe(false);
    expect(riftActionWarning({ action: "close" })).toBe("Once it's shut, it won't open again.");
  });

  it("draws every action with an icon", () => {
    for (const action of ["discover", "open", "close", "stabilize", "redirect"] as const) {
      expect(riftActionIcon(action)).toMatch(/^[a-z]+$/);
    }
  });

  it("says a stuck party is stuck without blaming it", () => {
    expect(journeyStuckLine()).toContain("isn't your fault");
  });
});
