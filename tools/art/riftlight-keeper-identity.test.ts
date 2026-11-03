import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { Chapter } from "@kad/shared";

function figuresFor(chapterId: string, name: string): Set<string> {
  const chapter = JSON.parse(readFileSync(new URL(`../../content/chapters/riftlight-${chapterId}.json`, import.meta.url), "utf8")) as Chapter;
  return new Set(Object.values(chapter.scenes).flatMap((scene) =>
    scene.type === "encounter" ? [] : (scene.cast ?? []).filter((member) => member.name === name).map((member) => member.figure),
  ));
}

it("gives the Squall Temple its own keeper, drawn apart from the Sky's other keepers", () => {
  const clove = figuresFor("squall-temple", "Keeper Clove");
  const juniper = figuresFor("the-island-due-back", "Keeper Juniper");
  expect([...clove]).toEqual(["cast/new_island_keeper"]);
  expect([...juniper]).toEqual(["cast/island_keeper"]);
  // Keeper Sorrel keeps the sky-islands temple in the kitsune temple keeper's figure;
  // neither of the strand's later keepers may borrow it.
  for (const figure of [...clove, ...juniper]) expect(figure).not.toBe("cast/kitsune_temple_keeper");
  const manifest = JSON.parse(readFileSync(new URL("../../assets/manifest.json", import.meta.url), "utf8")) as { castFigures: { id: string; name: string }[] };
  const label = (id: string) => manifest.castFigures.find((f) => f.id === id)?.name;
  expect(label("new_island_keeper")).toBe("Keeper Clove");
  expect(label("island_keeper")).toBe("Keeper Juniper");
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
