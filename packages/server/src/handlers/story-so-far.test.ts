/**
 * The Story page's record (#358), kept by real Gemfall evenings: what each
 * chapter settlement appends to the attempt, and what the journal reads back
 * out of it.
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadContent } from "../content/loader.ts";
import { evening, gemfallHousehold } from "./gemfall-compat-probe.ts";
import { getJournal } from "./journal.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));

describe("the Story page's record", () => {
  it("keeps each chapter's ending, revelation, decided roads and the stones they name, and the journal reads them as authored", async () => {
    const h = await gemfallHousehold(content);

    // Chapter 1: keep the Ember, hear the scholar's theory (its p1), camp.
    const first = await evening(h);
    expect(await first.begin()).toBe("gemfall-01");
    await first.goto("choice_ember");
    await first.choose("keep");
    await first.goto("scene_scholar_theory");
    await first.goto("rest_northbound");

    let attempt = (await h.attempt())!;
    expect(attempt.story).toEqual([
      {
        chapterId: "gemfall-01",
        ending: "rest_northbound",
        revealed: ["scene_scholar_theory"],
        decided: ["ember_kept"],
        held: ["facet_ember"],
      },
    ]);

    // Chapter 2: east at the rumour board. The Ember was carried in, so only the road is this chapter's.
    const second = await evening(h);
    expect(await second.begin()).toBe("gemfall-02");
    await second.goto("choice_rumour_board");
    await second.choose("east");
    attempt = (await h.attempt())!;
    expect(attempt.story).toHaveLength(2);
    expect(attempt.story![1]).toMatchObject({ chapterId: "gemfall-02", ending: "end_river", decided: ["route_river"] });
    expect(attempt.story![1]).not.toHaveProperty("revealed");

    const journal = await getJournal({ householdId: h.householdId, playerId: h.players[0]!.principal.playerId }, h.harness.deps);
    if (!journal.ok) throw new Error(journal.error.message);
    const [gemfall] = journal.value.story!;
    expect(gemfall).toMatchObject({ campaignId: "gemfall", title: "Gemfall", status: "active" });
    const lastTime = content.campaign("gemfall")!.lastTime!.lines;
    const ch1 = content.chapter("gemfall-01")!;
    expect(gemfall!.chapters).toEqual([
      {
        chapterId: "gemfall-01",
        title: ch1.title,
        goal: ch1.goal!.text,
        outcome: "success",
        ending: "That night the caravan camps in the first of the Sunward Fields, where the grass smells of honey and everybody's boots still smell of the city.",
        revealed: [(ch1.scenes["scene_scholar_theory"] as { narration: string }).narration],
        // Read against the bag: the Ember is still in it.
        lastTime: [(lastTime["ember_kept"] as { text: string }).text],
      },
      {
        chapterId: "gemfall-02",
        title: content.chapter("gemfall-02")!.title,
        goal: content.chapter("gemfall-02")!.goal!.text,
        outcome: "success",
        ending: "East, then. Marda chalks your names under EAST, and in the morning you'll take the Sunward road to the Great River, where the trolls want stories instead of coins.",
        revealed: [],
        lastTime: [lastTime["route_river"]],
      },
    ]);
  });

  it("quotes Gemfall's seal chamber as an empty-handed party heard it, though the Keystone is in the bag by the end", async () => {
    const h = await gemfallHousehold(content);
    // The beat before the last, and a hero with no great stone.
    await h.harness.repo.putCampaignProgress({
      householdId: h.householdId,
      campaignId: "gemfall",
      status: "active",
      setbacks: 0,
      lastIndex: 7,
      routeFlags: { route_river: true, pursuit_hoard: true },
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const t = await evening(h);
    expect(await t.begin()).toBe("gemfall-08");
    await t.goto("scene_seal_chamber");
    const run = await t.state();
    expect(run.narration).toContain("then at your empty hands");
    expect(run.revealHeld).toEqual({ scene_seal_chamber: [] });
    // The Keystone goes in the bag after the revelation, on the way to the ending.
    await t.choose("keystone");
    await t.choose("collectors");
    // The Keeper lies down across the seal, and the party carries the stone out.
    await t.choose("on");

    const attempt = (await h.attempt())!;
    const kept = attempt.story!.at(-1)!;
    expect(kept).toMatchObject({ chapterId: "gemfall-08", ending: "ending_collectors", heard: { scene_seal_chamber: [] } });
    // The ending was read with the Keystone in the bag, and keeps that.
    expect(kept.held).toEqual(["facet_keystone"]);

    const journal = await getJournal({ householdId: h.householdId, playerId: h.players[0]!.principal.playerId }, h.harness.deps);
    if (!journal.ok) throw new Error(journal.error.message);
    const chapter = journal.value.story![0]!.chapters.at(-1)!;
    expect(chapter.revealed).toHaveLength(1);
    expect(chapter.revealed[0]).toContain("You look at the gaps in the seal, and then at your empty hands.");
    expect(chapter.revealed[0]).toContain("which is you.");
    expect(chapter.revealed[0]).not.toContain("great stones");
    expect(chapter.revealed[0]).not.toContain("tug");
  });

  it("lists a chapter an older row played, by title and goal, beside the ones it kept", async () => {
    const h = await gemfallHousehold(content);
    // A row from before the page: two beats finished on the River Road, no story.
    await h.harness.repo.putCampaignProgress({
      householdId: h.householdId,
      campaignId: "gemfall",
      status: "active",
      setbacks: 0,
      lastIndex: 3,
      routeFlags: { route_river: true, crossed_dry: true },
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const journal = await getJournal({ householdId: h.householdId, playerId: h.players[0]!.principal.playerId }, h.harness.deps);
    if (!journal.ok) throw new Error(journal.error.message);
    const chapters = journal.value.story![0]!.chapters;
    expect(chapters.map((c) => c.chapterId)).toEqual(["gemfall-01", "gemfall-02", "gemfall-03a"]);
    for (const chapter of chapters) {
      expect(chapter).not.toHaveProperty("outcome");
      expect(chapter.revealed).toEqual([]);
      expect(chapter.lastTime).toEqual([]);
    }
  });
});
