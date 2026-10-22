import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { analyseGraphCampaign } from "./continuity.mjs";

it("Riftlight's opening introduces names before using them across every route", () => {
  const root = path.resolve(import.meta.dirname, "../../content");
  const campaign = JSON.parse(fs.readFileSync(path.join(root, "campaigns", "riftlight.json"), "utf8"));
  const chapters = campaign.chapters.map((id) => JSON.parse(fs.readFileSync(path.join(root, "chapters", `${id}.json`), "utf8")));
  const result = analyseGraphCampaign(campaign, chapters);
  expect(result.settled).toBe(true);
  expect(result.findings).toEqual([]);
  expect(result.stranded).toEqual([]);
  expect(result.unreached).toEqual([]);
});
