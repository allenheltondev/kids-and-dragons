/**
 * Matching downloads to cues.
 *
 * The filenames here are the real ones: what a browser actually writes when
 * you click download, including the parts nobody chose. The rule under test is
 * that a *word* in the filename names the cue — not a substring, which was the
 * first version and which matched every file in `~/Downloads` against the
 * knocked-down cue.
 */

import { describe, expect, it } from "vitest";
import { audioJobs } from "./specs";
import { fileTokens, matchFile, planImport } from "./match";

const JOBS = audioJobs();
const selectorOf = (fileName: string): string | null => {
  const match = matchFile(fileName, JOBS);
  return match.kind === "matched" ? match.job.selector : null;
};

describe("finding the cue in a filename", () => {
  it("reads the name a generator buried in its own metadata", () => {
    expect(selectorOf("ElevenLabs_2026-08-26T14-02-11_dice_pvc_sp100.mp3")).toBe("dice");
  });

  it("puts a two-word cue back together", () => {
    // `level-up` never appears verbatim once separators are stripped per word.
    expect(selectorOf("level-up final.mp3")).toBe("level-up");
    expect(selectorOf("scene_enter (1).mp3")).toBe("scene-enter");
    expect(selectorOf("SceneEnter.wav")).toBe("scene-enter");
  });

  it("takes a biome loop by its own name", () => {
    expect(selectorOf("forest ambience loop.mp3")).toBe("music:forest");
  });

  it("ignores where the file happens to live", () => {
    /*
     * The bug this exists for: `~/Downloads` contains "down", and substring
     * matching therefore claimed every file in the folder for the
     * knocked-down cue — including files that named a different cue outright.
     */
    expect(selectorOf("/home/allen/Downloads/holiday-photos.mp3")).toBeNull();
    expect(selectorOf("/home/allen/Downloads/victory.mp3")).toBe("victory");
  });

  it("does not find a cue inside a longer word", () => {
    // "tap" is in "tapestry"; "down" is in "download". Neither is the cue.
    expect(selectorOf("tapestry-hall.mp3")).toBeNull();
    expect(selectorOf("downloaded-thing.mp3")).toBeNull();
  });

  it("says nothing rather than guessing when a file names two cues", () => {
    // Naming the wrong sound `down.webm` is worse than importing nothing: the
    // game then chimes cheerfully when somebody is knocked over.
    const match = matchFile("attack-and-down.mp3", JOBS);
    expect(match.kind).toBe("ambiguous");
    if (match.kind === "ambiguous") expect(match.candidates.sort()).toEqual(["attack", "down"]);
  });

  it("tokenizes only the basename, and only up to three words", () => {
    const tokens = fileTokens("/tmp/downloads/a_b_c_d.mp3");
    expect(tokens.has("abc")).toBe(true);
    expect(tokens.has("abcd")).toBe(false);
    expect([...tokens].some((token) => token.includes("tmp"))).toBe(false);
  });
});

describe("planning a folder", () => {
  it("keeps one file per cue and reports the rest", () => {
    const plan = planImport(
      [
        "/d/dice.mp3",
        "/d/tap.mp3",
        "/d/tap (2).mp3",
        "/d/attack-and-down.mp3",
        "/d/holiday.mp3",
      ],
      JOBS,
    );
    expect(plan.imports.map((entry) => entry.job.selector)).toEqual(["dice"]);
    expect(plan.contested.map((entry) => entry.selector)).toEqual(["tap"]);
    expect(plan.ambiguous).toHaveLength(1);
    expect(plan.unmatched).toEqual(["/d/holiday.mp3"]);
  });

  it("refuses to choose between two takes of the same cue", () => {
    /*
     * A Downloads folder accumulates `dice.mp3`, `dice (1).mp3` as somebody
     * tries again, and the newest is not reliably the best — it is the last
     * one they clicked. Picking would silently discard the take they meant.
     */
    const plan = planImport(["/d/dice.mp3", "/d/dice (1).mp3"], JOBS);
    expect(plan.imports).toEqual([]);
    expect(plan.contested[0]?.files).toHaveLength(2);
  });
});
