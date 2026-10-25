import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { applyEffects, applyIntent, classPlaceWaitingOn, createRunState, enterScene, itemCatalog, keepClassIntent, newCharacter, resolveCharacter, switchClass } from "@kad/shared";
import type { Campaign, Chapter, ClassId, ClientIntent, EngineContext, ItemCatalog, RulesContent, RunState, SpeciesId } from "@kad/shared";
import { APPEARANCE } from "../../packages/shared/src/test-fixtures.ts";
import { RIFTLIGHT_DESIGN } from "./riftlight-preview.ts";
const ROOT = path.resolve(import.meta.dirname, "../..");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;
export const campaign = read<Campaign>(path.join(ROOT, "content/campaigns/riftlight.json"));
export const chapters = new Map(campaign.chapters.map((id) => [id, read<Chapter>(path.join(ROOT, "content/chapters", `${id}.json`))]));
export const rules = read<RulesContent>(path.join(ROOT, "content/rules.json"));
export const items: ItemCatalog = itemCatalog(read(path.join(ROOT, "content/items.json")));
for (const chapter of chapters.values()) Object.assign(items, chapter.props);

interface SceneContinuity {
  requires: string[];
  introduces: Record<string, string>;
  conditional?: { flag?: string; notFlag?: string; requires: string[] }[];
}
const continuity = read<{ chapters: Record<string, { entryFacts: string[]; entryByFlag?: Record<string, string[]>; scenes: Record<string, SceneContinuity> }> }>(
  path.join(RIFTLIGHT_DESIGN, "continuity.json"),
).chapters;


export function context(chapter: Chapter, face = 20): EngineContext {
  return { chapter, rules, items, abilities: {}, rng: { next: () => (face - 0.5) / 20 }, now: "2026-10-16T12:00:00.000Z" };
}

function hero(species: SpeciesId, cls: ClassId) {
  return newCharacter({ id: "hero", householdId: "test", ownerPlayerId: "p1", name: "Glimmer",
    species, class: cls, stats: { might: 1, quick: 1, clever: 1, heart: 0 }, appearance: APPEARANCE,
    rules, startingLevel: 4, now: "2026-10-16T12:00:00.000Z" });
}

export function start(chapter: Chapter, species: SpeciesId, cls: ClassId, flags: Record<string, boolean> = {}, partySize = 1) {
  const resolved = resolveCharacter(hero(species, cls), rules, items);
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
  if (chapter.index >= 4) state.party[0]!.character.questItems.push("listening_chime");
  const result = enterScene(state, chapter.entry, context(chapter));
  expect(result.error).toBeUndefined();
  return result.state;
}

export function send(state: RunState, intent: ClientIntent, chapter: Chapter, face = 20) {
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

/**
 * How the walker's heroes answer a class place (#311, #315): every hero who
 * could switch says no (`KEEP_CLASS`), or every one puts the room's class on.
 * The engine holds a room's way on until each has answered.
 */
export type ClassAnswer = "keep" | "switch";

/**
 * Answers a class place for every hero it is waiting on. A switch goes through
 * the server in play (`prepareClassSwitch`), which the walker has no row for,
 * so it is written here the same way: the worn class, re-resolved, and the answer.
 */
export function answerClassPlace(state: RunState, chapter: Chapter, answer: ClassAnswer = "keep"): RunState {
  let current = state;
  for (const member of classPlaceWaitingOn(state)) {
    const place = current.classPlace!;
    // The fitting stall (#312) stands only in Gemfall; met anywhere, the walker keeps.
    if (answer === "keep" || place.stall) {
      const result = applyIntent(current, { playerId: member.playerId, intent: keepClassIntent(place, member) }, context(chapter));
      expect(result.error, `${chapter.id}/${current.sceneId}: KEEP_CLASS`).toBeUndefined();
      current = result.state;
      continue;
    }
    const next = structuredClone(current);
    const seat = next.party.find((m) => m.playerId === member.playerId)!;
    const worn = resolveCharacter(switchClass(hero(seat.character.species, seat.character.class), rules, place.class), rules, items);
    const { id, ownerPlayerId, name, inventory, questItems, souvenirs } = seat.character;
    seat.character = { ...worn, id, ownerPlayerId, name, inventory, questItems, souvenirs };
    next.classPlace!.answers = { ...next.classPlace!.answers, [member.playerId]: { switched: true, from: member.character.class } };
    current = next;
  }
  return current;
}

/** Walk every actual choice and both dice extremes through the real engine. */
function walkAllPaths(chapter: Chapter, species: SpeciesId, cls: ClassId, flags: Record<string, boolean> = {}, partySize = 1, initialHp?: number, classAnswer: ClassAnswer = "keep") {
  const contract = continuity[chapter.id]!;
  const conditionalEntry = Object.entries(contract.entryByFlag ?? {}).flatMap(([flag, facts]) => flags[flag] ? facts : []);
  const initial = start(chapter, species, cls, flags, partySize);
  if (initialHp !== undefined) for (const member of initial.party) member.hp = initialHp;
  const pending = [{ state: initial, known: new Set([...contract.entryFacts, ...conditionalEntry]), introduced: new Set<string>() }];
  const seen = new Set<string>();
  const visited = new Set<string>();
  const ends: RunState[] = [];
  const endingKnowledge: Set<string>[] = [];
  const endingIntroductions: Set<string>[] = [];
  while (pending.length) {
    const { state: arrived, known: before, introduced: priorIntroductions } = pending.pop()!;
    const state = answerClassPlace(arrived, chapter, classAnswer);
    const key = JSON.stringify([state.sceneId, state.flags, state.prompt, state.party.map((p) => [p.hp, p.character.class, p.character.questItems]), state.phase, [...before].sort(), [...priorIntroductions].sort()]);
    if (seen.has(key)) continue;
    seen.add(key);
    expect(seen.size, "Unexpected loop or path explosion").toBeLessThan(5000);
    visited.add(state.sceneId!);
    const review = contract.scenes[state.sceneId!]!;
    expect(review, `${chapter.id}/${state.sceneId}: new scene needs a continuity review`).toBeDefined();
    const known = new Set(before);
    const introduced = new Set(priorIntroductions);
    for (const [fact, evidence] of Object.entries(review.introduces)) {
      expect(state.narration, `${chapter.id}/${state.sceneId}: introduction of ${fact} must be read aloud`).toContain(evidence);
      known.add(fact);
      introduced.add(fact);
    }
    const conditional = (review.conditional ?? []).filter((rule) =>
      (!rule.flag || state.flags[rule.flag]) && (!rule.notFlag || !state.flags[rule.notFlag]),
    ).flatMap((rule) => rule.requires);
    for (const fact of [...review.requires, ...conditional]) {
      expect(known.has(fact), `${chapter.id}/${state.sceneId}: references ${fact} before this path introduced it`).toBe(true);
    }
    if (state.phase === "chapter_complete") { ends.push(state); endingKnowledge.push(known); endingIntroductions.push(introduced); continue; }
    if (chapter.scenes[state.sceneId!]!.type === "encounter") {
      // Story coverage enumerates the encounter's declared outcomes. This is
      // deliberately not a combat simulation: board mechanics are exercised
      // separately through READY/END_TURN in the strand encounter tests.
      const scene = chapter.scenes[state.sceneId!]!;
      if (scene.type !== "encounter") throw new Error("Expected encounter");
      for (const branch of [scene.onVictory, scene.onDefeat, scene.onEscape, scene.onTimeout].filter(Boolean)) {
        const outcomes = branch === scene.onVictory
          ? [[], ...(scene.environment?.objectives ?? []).filter(o => o.endsFight).map(o => o.effects ?? [])]
          : [[]];
        for (const effects of outcomes) {
          const settled = applyEffects(state, [...effects, ...(branch!.effects ?? [])], context(chapter));
          const result = enterScene(settled, branch!.goto, context(chapter));
          expect(result.error).toBeUndefined();
          pending.push({ state: result.state, known, introduced });
        }
      }
    } else if (chapter.scenes[state.sceneId!]!.type === "interaction") {
      // Like an encounter, an interaction is a mechanic the engine tests cover. Story coverage
      // enumerates its declared outcomes: success, the gentle failure and the helping hand.
      const scene = chapter.scenes[state.sceneId!]!;
      if (scene.type !== "interaction") throw new Error("Expected interaction");
      for (const branch of [scene.onSuccess, scene.onFailure, scene.onAssisted].filter(Boolean)) {
        const settled = applyEffects(state, branch!.effects ?? [], context(chapter));
        const result = enterScene(settled, branch!.goto, context(chapter));
        expect(result.error).toBeUndefined();
        pending.push({ state: result.state, known, introduced });
      }
    } else if (state.prompt?.kind === "choice") {
      expect(state.prompt.options.length).toBeGreaterThan(0);
      for (const option of state.prompt.options) pending.push({ state: send(state, { type: "CHOOSE", choiceId: option.id }, chapter), known, introduced });
    } else if (state.prompt?.kind === "roll") {
      for (const face of [1, 20]) pending.push({ state: send(state, { type: "ROLL" }, chapter, face), known, introduced });
    } else {
      pending.push({ state: send(state, { type: "ADVANCE" }, chapter), known, introduced });
    }
  }
  expect(ends.length).toBeGreaterThan(0);
  for (const state of ends) {
    // The finale's late whole-party battle loss is a completing setback;
    // ordinary missed checks and strand losses still finish successfully.
    expect(state.chapterOutcome).toBe(chapter.id === "riftlight-finale" && state.sceneId === "loss_epilogue" ? "setback" : "success");
  }
  return { visited, ends, endingKnowledge, endingIntroductions };
}

// Cache identical scenarios, including chapter content so negative fixtures
// and callers that edit a cloned chapter always get an independent walk.
const pathCache = new Map<string, ReturnType<typeof walkAllPaths>>();
export function allPaths(...args: Parameters<typeof walkAllPaths>): ReturnType<typeof walkAllPaths> {
  const key = JSON.stringify(args);
  let result = pathCache.get(key);
  if (!result) { result = walkAllPaths(...args); pathCache.set(key, result); }
  return structuredClone(result);
}
