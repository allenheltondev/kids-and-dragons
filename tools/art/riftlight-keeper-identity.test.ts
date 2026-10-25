import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { Chapter } from "@kad/shared";

function figuresFor(chapterId: string, name: string): Set<string> {
  const chapter = JSON.parse(readFileSync(new URL(`../../content/chapters/riftlight-${chapterId}.json`, import.meta.url), "utf8")) as Chapter;
  return new Set(Object.values(chapter.scenes).flatMap((scene) =>
    scene.type === "encounter" ? [] : (scene.cast ?? []).filter((member) => member.name === name).map((member) => member.figure),
  ));
}

it("keeps the temple keeper consistent across visits and distinct from the lookout keeper", () => {
  const temple = figuresFor("squall-temple", "Temple keeper");
  const earlierVisit = figuresFor("sky-islands-arrival", "Temple keeper");
  const lookout = figuresFor("the-island-due-back", "Lookout keeper");
  expect(temple.size).toBe(1);
  expect(lookout.size).toBe(1);
  expect(earlierVisit).toEqual(temple);
  // Squall Temple's arrival explicitly introduces "a different kitsune keeper".
  expect([...temple].some((figure) => lookout.has(figure))).toBe(false);
});
