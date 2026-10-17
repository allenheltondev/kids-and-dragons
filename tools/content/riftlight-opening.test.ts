import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  applyIntent, createRunState, enterScene, itemCatalog, lintCampaignGraph,
  newCharacter, parseCampaignGraph, resolveCharacter, validateChapter,
  startJourney, completeVisit, takeExit, seedRunBuffs,
} from "@kad/shared";
import type { Campaign, Chapter, ClassId, ClientIntent, EngineContext, ItemCatalog, RulesContent, RunState, SpeciesId } from "@kad/shared";
import { APPEARANCE } from "../../packages/shared/src/test-fixtures.ts";
import { runValidator } from "./generate-gate.ts";
import { chapterFlagsFrom } from "./journey-graph.ts";
import { exploreRoutes, playtest } from "./journey-explore.ts";
import { RIFTLIGHT_DRAFT, stageRiftlightOpening } from "./riftlight-preview.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;
const campaign = read<Campaign>(path.join(RIFTLIGHT_DRAFT, "opening-preview.campaign.json"));
const chapters = new Map(campaign.chapters.map((id) => [id, read<Chapter>(path.join(RIFTLIGHT_DRAFT, "chapters", `${id}.json`))]));
const rules = read<RulesContent>(path.join(ROOT, "content/rules.json"));
const items: ItemCatalog = itemCatalog(read(path.join(ROOT, "content/items.json")));
for (const chapter of chapters.values()) Object.assign(items, chapter.props);
const staged = stageRiftlightOpening();
afterAll(() => fs.rmSync(staged, { recursive: true, force: true }));

interface SceneContinuity {
  requires: string[];
  introduces: Record<string, string>;
  conditional?: { flag?: string; notFlag?: string; requires: string[] }[];
}
const continuity = read<{ chapters: Record<string, { entryFacts: string[]; entryByFlag?: Record<string, string[]>; scenes: Record<string, SceneContinuity> }> }>(
  path.join(RIFTLIGHT_DRAFT, "continuity.json"),
).chapters;

function context(chapter: Chapter, face = 20): EngineContext {
  return { chapter, rules, items, abilities: {}, rng: { next: () => (face - 0.5) / 20 }, now: "2026-10-16T12:00:00.000Z" };
}

function start(chapter: Chapter, species: SpeciesId, cls: ClassId, flags: Record<string, boolean> = {}, partySize = 1) {
  const character = newCharacter({ id: "hero", householdId: "test", ownerPlayerId: "p1", name: "Glimmer",
    species, class: cls, stats: { might: 1, quick: 1, clever: 1, heart: 0 }, appearance: APPEARANCE,
    rules, startingLevel: 4, now: "2026-10-16T12:00:00.000Z" });
  const resolved = resolveCharacter(character, rules, items);
  const state = createRunState({ runId: "preview-test", roomCode: "RIFT", mode: "travel", campaignId: campaign.id, now: "2026-10-16T12:00:00.000Z" });
  state.party = [{ playerId: "p1", character: resolved, hp: resolved.maxHp, down: false, ready: true, connected: true }];
  for (let seat = 2; seat <= partySize; seat++) {
    const friend = structuredClone(state.party[0]!);
    friend.playerId = `p${seat}`;
    friend.character.id = `hero${seat}`;
    friend.character.ownerPlayerId = friend.playerId;
    state.party.push(friend);
  }
  state.chapterId = chapter.id;
  state.flags = { ...flags };
  const result = enterScene(state, chapter.entry, context(chapter));
  expect(result.error).toBeUndefined();
  return result.state;
}

function send(state: RunState, intent: ClientIntent, chapter: Chapter, face = 20) {
  const prompt = state.prompt;
  const players = prompt?.kind === "choice"
    ? prompt.vote ? state.party.map((member) => member.playerId) : [prompt.forPlayerIds[0] ?? "p1"]
    : prompt?.kind === "roll"
      ? [state.party.find((member) => member.character.id === prompt.characterId)!.playerId]
      : ["p1"];
  let current = state;
  for (const playerId of players) {
    const result = applyIntent(current, { playerId, intent }, context(chapter, face));
    expect(result.error, `${chapter.id}/${current.sceneId}: ${JSON.stringify(intent)}`).toBeUndefined();
    current = result.state;
  }
  return current;
}

/** Walk every actual choice and both dice extremes through the real engine. */
function allPaths(chapter: Chapter, species: SpeciesId, cls: ClassId, flags: Record<string, boolean> = {}, partySize = 1) {
  const contract = continuity[chapter.id]!;
  const conditionalEntry = Object.entries(contract.entryByFlag ?? {}).flatMap(([flag, facts]) => flags[flag] ? facts : []);
  const pending = [{ state: start(chapter, species, cls, flags, partySize), known: new Set([...contract.entryFacts, ...conditionalEntry]) }];
  const seen = new Set<string>();
  const visited = new Set<string>();
  const ends: RunState[] = [];
  const endingKnowledge: Set<string>[] = [];
  while (pending.length) {
    const { state, known: before } = pending.pop()!;
    const key = JSON.stringify([state.sceneId, state.flags, state.prompt, state.party.map((p) => [p.hp, p.character.questItems]), state.phase, [...before].sort()]);
    if (seen.has(key)) continue;
    seen.add(key);
    expect(seen.size, "Unexpected loop or path explosion").toBeLessThan(5000);
    visited.add(state.sceneId!);
    const review = contract.scenes[state.sceneId!]!;
    expect(review, `${chapter.id}/${state.sceneId}: new scene needs a continuity review`).toBeDefined();
    const known = new Set(before);
    for (const [fact, evidence] of Object.entries(review.introduces)) {
      expect(state.narration, `${chapter.id}/${state.sceneId}: introduction of ${fact} must be read aloud`).toContain(evidence);
      known.add(fact);
    }
    const conditional = (review.conditional ?? []).filter((rule) =>
      (!rule.flag || state.flags[rule.flag]) && (!rule.notFlag || !state.flags[rule.notFlag]),
    ).flatMap((rule) => rule.requires);
    for (const fact of [...review.requires, ...conditional]) {
      expect(known.has(fact), `${chapter.id}/${state.sceneId}: references ${fact} before this path introduced it`).toBe(true);
    }
    if (state.phase === "chapter_complete") { ends.push(state); endingKnowledge.push(known); continue; }
    if (state.prompt?.kind === "choice") {
      expect(state.prompt.options.length).toBeGreaterThan(0);
      for (const option of state.prompt.options) pending.push({ state: send(state, { type: "CHOOSE", choiceId: option.id }, chapter), known });
    } else if (state.prompt?.kind === "roll") {
      for (const face of [1, 20]) pending.push({ state: send(state, { type: "ROLL" }, chapter, face), known });
    } else {
      pending.push({ state: send(state, { type: "ADVANCE" }, chapter), known });
    }
  }
  expect(ends.length).toBeGreaterThan(0);
  for (const state of ends) expect(state.chapterOutcome).toBe("success");
  return { visited, ends, endingKnowledge };
}

describe("Riftlight's authored opening", () => {
  it("passes the real content gate alongside Gemfall, including props, art and prerequisite", () => {
    const result = runValidator(staged);
    expect(result.ok, result.output).toBe(true);
    expect(campaign.requires).toEqual(["gemfall"]);
    expect(fs.existsSync(path.join(ROOT, "content/campaigns/riftlight.json"))).toBe(false);
    for (const chapter of chapters.values()) expect(validateChapter(chapter), chapter.id).toEqual([]);
  });

  it("has no softlock and crosses the one-use rift with Riftspark through the journey runtime", () => {
    const parsed = parseCampaignGraph(campaign);
    expect(parsed.problems).toEqual([]);
    const graph = parsed.graph!;
    const options = { chapterFlags: chapterFlagsFrom(chapters) };
    expect(lintCampaignGraph(graph, options).findings).toEqual([]);
    const { search, coverage } = exploreRoutes(graph, options);
    expect(coverage.softlocks).toEqual([]);
    expect(coverage.nodes.every((node) => node.entered)).toBe(true);
    expect(coverage.edges.every((edge) => edge.traversable)).toBe(true);
    expect(playtest(graph, campaign, { ...options, random: { seed: 16, runs: 10 }, replay: { search, coverage } }).violations).toEqual([]);
  });

  it.each([
    ["kitsune", "starweaver"], ["bigfoot", "thornguard"],
    ["unicorn", "songkeeper"], ["griffin", "duskrunner"],
    ["dragonling", "duskrunner"], ["manticore", "duskrunner"],
  ] as const)("every choice and failed roll lets a %s %s finish all three nodes", (species, cls) => {
    for (const [index, chapter] of [...chapters.values()].entries()) {
      expect(Object.keys(continuity[chapter.id]!.scenes).sort()).toEqual(Object.keys(chapter.scenes).sort());
      const { ends, endingKnowledge } = allPaths(chapter, species, cls);
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
        for (const end of ends) expect(end.flags.learned_glacier_note).toBe(true);
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
      expect(result.state.narration.includes("One of you can see it")).toBe(read);
      allPaths(chapter, "manticore", "duskrunner", read ? { starweaver_read_first_rift: true } : {});
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
