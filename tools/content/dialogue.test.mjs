import { describe, expect, it } from "vitest";
import { dialogueReport, namesFor, speaksIn, spine } from "./dialogue.mjs";

/** entry -> fork (two ways) -> join -> end: entry, join and end are on every path. */
const chapter = {
  id: "ch-01",
  campaignId: "camp",
  entry: "entry",
  scenes: {
    entry: { type: "story", narration: "A dock.", cast: [{ name: "Captain Rook" }], choices: [{ id: "a", goto: "left" }, { id: "b", goto: "right" }] },
    left: { type: "story", narration: "Left.", choices: [{ id: "on", goto: "join" }] },
    right: { type: "story", narration: "Right.", choices: [{ id: "on", goto: "join" }] },
    join: { type: "story", narration: '"Hold the rope," says Rook.', cast: [{ name: "Captain Rook" }, { name: "Gull" }], choices: [{ id: "on", goto: "end" }] },
    end: { type: "story", narration: "Home.", choices: [] },
    lost: { type: "story", narration: "Lost.", outcome: "setback", choices: [] },
  },
};

describe("the spine", () => {
  it("is the scenes on every path to a success ending", () => {
    expect(new Set(spine(chapter))).toEqual(new Set(["entry", "join", "end"]));
  });
});

describe("the dialogue report", () => {
  const report = dialogueReport(chapter);

  it("counts spine scenes with a cast and a quoted line", () => {
    expect(report.spineWithCast).toBe(2);
    expect(report.spokenOnSpine).toBe(1);
    expect(report.share).toBe(0.5);
    expect(report.quietSpineScenes).toEqual(["entry"]);
  });

  it("lists cast members who are never quoted", () => {
    expect(report.silentCast).toEqual(["Gull"]);
  });

  it("leaves out those the cast sheet says do not speak", () => {
    expect(dialogueReport(chapter, new Set(["gull"])).silentCast).toEqual([]);
  });
});

describe("who is speaking", () => {
  it("finds a person by any distinctive word of their name, not a title", () => {
    expect(namesFor({ name: "Madame Coralie Fenn" })).toEqual(["Madame Coralie Fenn", "Coralie", "Fenn"]);
    expect(speaksIn('Fenn frowns. "No," she says.', namesFor({ name: "Madame Coralie Fenn" }))).toBe(true);
    expect(speaksIn("Fenn frowns and leaves.", namesFor({ name: "Madame Coralie Fenn" }))).toBe(false);
  });
});
