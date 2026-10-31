import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { enterScene, lintCampaignGraph, parseCampaignGraph, newCharacter, resolveCharacter, validateChapter, startJourney, completeVisit, takeExit, seedRunBuffs } from "@kad/shared";
import { APPEARANCE } from "../../packages/shared/src/test-fixtures.ts";
import { runValidator } from "./run-validator.ts";
import { chapterFlagsFrom } from "./journey-graph.ts";
import { exploreRoutes, playtest } from "./journey-explore.ts";
import { stageRiftlightOpening } from "./riftlight-preview.ts";
import { campaign, chapters as allChapters, rules, items, context, start, send, allPaths } from "./riftlight-test-support.ts";
const ROOT = path.resolve(import.meta.dirname, "../..");
const chapters = new Map([...allChapters].filter(([, chapter]) => chapter.index <= 3));
const continuity = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/campaigns/continental-rift/continuity.json"), "utf8")).chapters;
const staged = stageRiftlightOpening();
afterAll(() => fs.rmSync(staged, { recursive: true, force: true }));

describe("Riftlight's authored opening", () => {
  it("stages usable world assets when directory junctions are denied", { timeout: 20_000 }, () => {
    const link = vi.spyOn(fs, "symlinkSync").mockImplementation(() => {
      throw Object.assign(new Error("Junction denied"), { code: "EPERM" });
    });
    let copied: string | undefined;
    try {
      copied = stageRiftlightOpening();
      const world = path.join(copied, "assets/world");
      expect(fs.lstatSync(world).isDirectory()).toBe(true);
      expect(fs.lstatSync(world).isSymbolicLink()).toBe(false);
      expect(fs.readdirSync(world).sort()).toEqual(fs.readdirSync(path.join(ROOT, "assets/world")).sort());
      // Compare the fallback bytes; the next test validates the complete
      // campaign once, without repeating its unrelated graph exploration.
      for (const entry of fs.readdirSync(world, { recursive: true })) {
        const relative = String(entry);
        const file = path.join(world, relative);
        if (fs.statSync(file).isFile()) {
          expect(fs.readFileSync(file).equals(fs.readFileSync(path.join(ROOT, "assets/world", relative))), relative).toBe(true);
        }
      }
    } finally {
      link.mockRestore();
      if (copied) fs.rmSync(copied, { recursive: true, force: true });
    }
  });

  it("passes the real content gate alongside Gemfall, including props, art and prerequisite", { timeout: 20_000 }, () => {
    const result = runValidator(staged);
    expect(result.ok, result.output).toBe(true);
    expect(campaign.requires).toEqual(["gemfall"]);
    // Shipped beside Gemfall, in every lobby, and locked until it is finished.
    expect(campaign).toMatchObject({ id: "riftlight", listed: true });
    expect(campaign.comingSoon).toBeUndefined();
    for (const chapter of allChapters.values()) expect(validateChapter(chapter), chapter.id).toEqual([]);
  });

  it("has no softlock and crosses the one-use rift with Riftspark through the journey runtime", () => {
    const parsed = parseCampaignGraph(campaign);
    expect(parsed.problems).toEqual([]);
    const graph = parsed.graph!;
    const options = { chapterFlags: chapterFlagsFrom(allChapters), routeSets: campaign.routeSets };
    expect(lintCampaignGraph(graph, options).findings).toEqual([]);
    const { search, coverage } = exploreRoutes(graph, options);
    expect(coverage.softlocks).toEqual([]);
    expect(coverage.nodes.every((node) => node.entered)).toBe(true);
    expect(coverage.edges.every((edge) => edge.traversable)).toBe(true);
    expect(playtest(graph, campaign, { ...options, random: { seed: 16, runs: 10 }, replay: { search, coverage } }).violations).toEqual([]);
  }, 60_000); // Full route graph, including strand-end return loops, also runs under V8 coverage.

  it.each([
    ["kitsune", "starweaver"], ["bigfoot", "thornguard"],
    ["unicorn", "songkeeper"], ["griffin", "duskrunner"],
    ["dragonling", "duskrunner"], ["manticore", "duskrunner"],
  ] as const)("every choice and failed roll lets a %s %s finish all three nodes", (species, cls) => {
    for (const [index, chapter] of [...chapters.values()].entries()) {
      expect(Object.keys(continuity[chapter.id]!.scenes).sort()).toEqual(Object.keys(chapter.scenes).sort());
      const { ends, endingKnowledge } = allPaths(chapter, species, cls);
      if (chapter.id.endsWith("exchange-rift")) {
        for (const end of ends) {
          expect([end.flags.saved_barge_supper, end.flags.found_barge_mooring].filter(Boolean)).toHaveLength(1);
        }
      }
      const nextChapter = [...chapters.values()][index + 1];
      if (nextChapter) {
        for (const [endIndex, known] of endingKnowledge.entries()) {
          const nextContract = continuity[nextChapter.id]!;
          const conditionalEntry = Object.entries(nextContract.entryByFlag ?? {}).flatMap(([flag, facts]) => ends[endIndex]!.flags[flag] ? facts : []);
          for (const fact of [...nextContract.entryFacts, ...conditionalEntry]) {
            expect(known.has(fact), `${chapter.id}: every path must introduce ${fact} before ${nextChapter.id}`).toBe(true);
          }
        }
      }
      if (chapter.id.endsWith("glacier-survival")) {
        for (const end of ends) {
          expect(end.flags.learned_glacier_note).toBe(true);
          expect(end.flags.tested_singing_seam).toBe(true);
          expect([end.flags.marked_glacier_drift, end.flags.sheltered_kid_on_detour, end.flags.found_drift_hollow].filter(Boolean)).toHaveLength(1);
        }
      }
      if (chapter.id.endsWith("riftseekers-departure")) {
        for (const end of ends) expect(end.party[0]!.character.questItems).toContain("listening_chime");
      }
    }
  });

  it("covers every scene across the class and species options", () => {
    for (const chapter of chapters.values()) {
      const visited = new Set<string>();
      for (const [species, cls] of [["kitsune", "starweaver"], ["bigfoot", "thornguard"], ["unicorn", "songkeeper"], ["griffin", "duskrunner"]] as const) {
        for (const scene of allPaths(chapter, species, cls).visited) visited.add(scene);
      }
      expect([...visited].sort()).toEqual(Object.keys(chapter.scenes).sort());
    }
  });

  it("a three-phone party without a Starweaver can vote and finish the whole-party melt check", () => {
    const chapter = chapters.get("riftlight-glacier-survival")!;
    const { visited, ends } = allPaths(chapter, "manticore", "duskrunner", {}, 3);
    expect(visited.has("dry_bank")).toBe(true);
    expect(visited.has("wet_bank")).toBe(true);
    for (const end of ends) {
      expect(end.party).toHaveLength(3);
      expect(end.flags.learned_glacier_note).toBe(true);
    }
  });

  it.each([
    ["riftlight-exchange-rift", "pull", "fly", "swoop", "griffin", "duskrunner", "quick", "Skyward or Glide"],
    ["riftlight-exchange-rift", "pull", "crate", "smash", "bigfoot", "duskrunner", "might", "Smash"],
    ["riftlight-exchange-rift", "pull", "brace", "brace", "unicorn", "thornguard", "might", "Brace"],
    ["riftlight-glacier-survival", "channel", "glide", "wing_line", "dragonling", "duskrunner", "quick", "Wings"],
    ["riftlight-glacier-survival", "channel", "song", "song_step", "unicorn", "songkeeper", "heart", "A Songkeeper"],
  ] as const)("%s/%s: %s enables a team check even when the best roller lacks the ability", (id, source, option, check, species, cls, stat, enabling) => {
    const chapter = chapters.get(id)!;
    for (const face of [1, 20]) {
      const state = start(chapter, species, cls);
      const friend = newCharacter({ id: "noneligible", householdId: "test", ownerPlayerId: "p2", name: "Quickpaw",
        species: "kitsune", class: "duskrunner", stats: { might: 0, quick: 0, clever: 0, heart: 0, [stat]: 3 },
        appearance: APPEARANCE, rules, startingLevel: 4, now: "2026-10-17T12:00:00.000Z" });
      const resolved = resolveCharacter(friend, rules, items);
      expect(resolved.stats[stat]).toBeGreaterThan(state.party[0]!.character.stats[stat]);
      state.party.push({ playerId: "p2", character: resolved, hp: resolved.maxHp, down: false, ready: true, connected: true });
      const offered = enterScene(state, source, context(chapter)).state;
      expect(offered.prompt).toMatchObject({ kind: "choice", options: expect.arrayContaining([expect.objectContaining({ id: option })]) });
      const checking = send(offered, { type: "CHOOSE", choiceId: option }, chapter);
      expect(checking.sceneId).toBe(check);
      expect(checking.prompt).toMatchObject({ kind: "roll", characterId: "noneligible", prompt: expect.stringContaining(enabling) });
      const result = send(checking, { type: "ROLL" }, chapter, face);
      expect(result.party[0]!.hp).toBe(state.party[0]!.hp);
      expect(result.party[1]!.hp).toBe(resolved.maxHp - (face === 1 ? 1 : 0));
      expect(result.narration).not.toMatch(/your wings|your song|you plant your feet and hold/i);
      const atExchange = id.endsWith("exchange-rift");
      const success = atExchange ? check === "swoop" ? "caught" : "together" : "dry_bank";
      expect(result.sceneId).toBe(face === 1 ? atExchange ? "tumbled" : "wet_bank" : success);
    }
  });

  it("the first crossing carries a spendable +2 Riftspark into the glacier check", () => {
    const graph = parseCampaignGraph(campaign).graph!;
    const first = startJourney(graph);
    const completed = completeVisit(graph, first, { node: first.node, visit: first.visit, chapterId: first.chapter, outcome: "success", flags: {} });
    expect(completed.ok).toBe(true);
    if (!completed.ok) throw new Error("complete opening visit");
    const crossed = takeExit(graph, completed.journey, { edge: "exchange-to-glacier", visit: first.visit });
    expect(crossed.ok).toBe(true);
    if (!crossed.ok) throw new Error("cross opening rift");
    const chapter = chapters.get("riftlight-glacier-survival")!;
    const state = start(chapter, "manticore", "duskrunner");
    state.buffs = seedRunBuffs(graph.buffs, crossed.journey.buffs);
    const entered = enterScene(state, "step", context(chapter, 8));
    expect(entered.error).toBeUndefined();
    expect(entered.state.prompt).toMatchObject({ kind: "roll", buff: { id: "riftspark", amount: 2 } });
    const saved = send(entered.state, { type: "ROLL" }, chapter, 8);
    expect(saved.lastRoll?.buff).toBeUndefined();
    const spent = send(entered.state, { type: "ROLL", spendBuff: "riftspark" }, chapter, 8);
    expect(spent.lastRoll?.buff).toMatchObject({ id: "riftspark", amount: 2 });
    expect(spent.lastRoll!.total - saved.lastRoll!.total).toBe(2);
    expect(spent.buffs?.find((buff) => buff.id === "riftspark")).toBeUndefined();
  });

  it("Seren recognizes the carried reading flag, without claiming a party read when it did not", () => {
    const chapter = chapters.get("riftlight-riftseekers-departure")!;
    for (const read of [false, true]) {
      const state = start(chapter, "manticore", "duskrunner", read ? { starweaver_read_first_rift: true } : {});
      const result = enterScene(state, "seren", context(chapter));
      expect(result.error).toBeUndefined();
      expect(result.state.narration.includes("Seren turns to the hero who saw it.")).toBe(read);
      allPaths(chapter, "manticore", "duskrunner", read ? { starweaver_read_first_rift: true } : {});
    }
  });

  it("helping the fish seller pays off during the rescue only on the helping route", () => {
    const chapter = chapters.get("riftlight-exchange-rift")!;
    for (const helped of [false, true]) {
      const state = start(chapter, "manticore", "duskrunner", helped ? { helped_fish_seller: true } : {});
      const result = enterScene(state, "pull", context(chapter));
      expect(result.error).toBeUndefined();
      expect(result.state.narration.includes("You saved my fish")).toBe(helped);
      expect(result.state.narration.includes("where you can reach it without stepping into their path")).toBe(helped);
    }
  });

  it("the glacier remembers a windbreak and the singing discovery stays sealed", () => {
    const chapter = chapters.get("riftlight-glacier-survival")!;
    for (const sheltered of [false, true]) {
      const state = start(chapter, "manticore", "duskrunner", sheltered ? { made_glacier_shelter: true } : {});
      expect(enterScene(state, "changing", context(chapter)).state.narration.includes("Your windbreak is useful too")).toBe(sheltered);
    }
    for (const id of ["seam_hum", "seam_touch", "seam_listen"]) {
      const state = start(chapter, "manticore", "duskrunner");
      const result = enterScene(state, id, context(chapter));
      expect(result.state.flags.tested_singing_seam).toBe(true);
      expect(result.state.narration).toMatch(/ice stays shut|seam stays shut/i);
    }
  });

  it("keeps the early prose free of finale secrets, public color readings, and the rejected prose pattern", () => {
    for (const chapter of chapters.values()) {
      const prose = JSON.stringify(chapter.scenes);
      expect(prose).not.toMatch(/Corvane|Pangea|emperor|summer crevasse/i);
      expect(prose).not.toMatch(/\b(amber|violet|green|blue)\b/i);
      expect(prose).not.toMatch(/the (kind|sort|type) of (thing|[a-z]+) that/i);
    }
  });
});
