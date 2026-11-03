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
  const lookout = figuresFor("the-island-due-back", "Lookout keeper");
  expect(temple.size).toBe(1);
  expect(lookout.size).toBe(1);
  // Squall Temple's arrival explicitly introduces "a different kitsune keeper".
  expect([...temple].some((figure) => lookout.has(figure))).toBe(false);
});

it("draws the Sky's named keepers as one figure each, and never as each other", () => {
  // Keeper Sorrel keeps the temple island the party lands on; Keeper Juniper keeps the
  // whales' turning place and carries the strand's middle. One figure each keeps one voice each.
  const sorrel = figuresFor("sky-islands-arrival", "Keeper Sorrel");
  const juniper = figuresFor("whale-road", "Keeper Juniper");
  expect([...sorrel]).toEqual(["cast/kitsune_temple_keeper"]);
  expect([...juniper]).toEqual(["cast/island_keeper"]);
  const manifest = JSON.parse(readFileSync(new URL("../../assets/manifest.json", import.meta.url), "utf8")) as { castFigures: { id: string; name: string }[] };
  const label = (id: string) => manifest.castFigures.find((figure) => figure.id === id)?.name;
  expect(label("kitsune_temple_keeper")).toBe("Keeper Sorrel");
  expect(label("island_keeper")).toBe("Keeper Juniper");
});
