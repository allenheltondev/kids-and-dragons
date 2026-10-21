import { enterScene } from "@kad/shared";
import { expect, it } from "vitest";
import { pacingReport } from "../../packages/shared/src/chapter-pacing.ts";
import { allPaths, chapters, context, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-stuttering-flats")!;
it.each([
  ["manticore", "duskrunner"], ["kitsune", "starweaver"], ["unicorn", "songkeeper"],
  ["bigfoot", "thornguard"], ["griffin", "duskrunner"], ["dragonling", "songkeeper"],
] as const)("a %s %s returns the goat on every low/high roll path", (species, cls) => {
  const { ends } = allPaths(chapter, species, cls, {}, 1, 1);
  for (const end of ends) {
    expect(end.flags.goat_returned_home).toBe(true);
    for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
    expect(end.party[0]!.down).toBe(false);
    expect(end.party[0]!.character.questItems).toEqual(["listening_chime"]);
  }
  expect(ends.some(s => s.flags.flats_sling_left)).toBe(true);
  expect(ends.some(s => !s.flags.flats_sling_left)).toBe(true);
});
it("puts the rescue on an interactive spine with a rest and no repeated checks", () => {
  for (const { shortest } of pacingReport(chapter).scenarios) {
    expect(shortest!.scenes).toBeGreaterThanOrEqual(30);
    expect(shortest!.decisions).toBeGreaterThanOrEqual(14);
    expect(shortest!.checks).toBe(6);
  }
});

it("reads back the warning the party actually chose", () => {
  for (const flag of [true, false]) {
    const state = start(chapter, "kitsune", "starweaver", { flats_warning_pictures: flag });
    const next = enterScene(state, "next", context(chapter));
    expect(next.error).toBeUndefined();
    expect(next.state.narration).toContain(flag ? "picture warning" : "safe-bank drawing");
  }
});
