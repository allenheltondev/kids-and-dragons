/**
 * Loot (`rules.loot`): a won fight drops coins in the campaigns the rules name,
 * and in no other. Gemfall's numbers are pinned, so the same fight there pays
 * nothing.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { applyIntent, createRunState, type EngineContext } from "./engine.js";
import { makeRng } from "./dice.js";
import type { Chapter, EncounterMap, EnemySpec } from "./types/chapter.js";
import type { ItemCatalog, RulesContent } from "./types/domain.js";
import type { ClientIntent } from "./types/protocol.js";
import type { RunState } from "./types/state.js";
import { APPEARANCE } from "./test-fixtures.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const read = <T>(file: string): T => JSON.parse(readFileSync(path.join(ROOT, "content", file), "utf8")) as T;
const RULES = read<RulesContent>("rules.json");
const ROADSIDE = read<EncounterMap>("maps/roadside.json");
const WOLF: EnemySpec = { id: "wolf", name: "Cinder Wolf", count: 1, hp: 6, guard: 11, quick: 3, steps: 5, attack: 3 };
const BRUTE: EnemySpec = { id: "crab", name: "Glassback Crab", count: 1, hp: 14, guard: 12, quick: 1, steps: 3, attack: 4 };

function chapter(campaignId: string, enemies: EnemySpec[]): Chapter {
  return {
    id: `${campaignId}-fight`,
    campaignId,
    index: 1,
    title: "A Fight",
    biome: "enchanted_woods",
    estimatedMinutes: 40,
    xpAward: 100,
    entry: "fight",
    scenes: {
      fight: {
        type: "encounter",
        map: ROADSIDE.id,
        narration: "Trouble on the road.",
        enemies,
        onVictory: { goto: "after", narration: "They are beaten." },
        onDefeat: { goto: "after" },
      },
      after: { type: "story", narration: "Quiet.", choices: [] },
    },
    voiceGuide: { tone: "warm", vocabulary: "age-8", forbidden: ["death"] },
  } as Chapter;
}

function ctxFor(c: Chapter): EngineContext {
  const items: ItemCatalog = {};
  return {
    rules: RULES,
    items,
    chapter: c,
    map: (id) => (id === ROADSIDE.id ? ROADSIDE : null),
    abilities: {},
    rng: makeRng("loot"),
    now: "2026-10-25T12:00:00.000Z",
    householdId: "h_1",
  };
}

function must(state: RunState, intent: ClientIntent, ctx: EngineContext): RunState {
  const result = applyIntent(state, { playerId: "p_0", intent }, ctx);
  if (result.error) throw new Error(`${intent.type}: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Wins the chapter's one fight outright and returns the scene after it. */
function winFight(c: Chapter): RunState {
  const ctx = ctxFor(c);
  let s = createRunState({ runId: "r_loot", roomCode: "LOOT", mode: "travel", now: ctx.now });
  s = must(s, {
    type: "CREATE_CHARACTER",
    name: "Pip",
    species: "unicorn",
    class: "songkeeper",
    stats: { might: 0, quick: 0, clever: 0, heart: RULES.creationPoints },
    appearance: APPEARANCE,
  }, ctx);
  s = must(s, { type: "READY", ready: true }, ctx);
  s = must(s, { type: "START_CHAPTER", chapterId: c.id }, ctx);
  if (s.prompt?.kind === "ready") s = must(s, { type: "READY", ready: true }, ctx);
  expect(s.encounter).toBeTruthy();
  const beaten = { ...s.encounter!, combatants: s.encounter!.combatants.map((m) => (m.side === "enemy" ? { ...m, hp: 0, down: true } : m)) };
  s = { ...s, encounter: beaten };
  return must(s, { type: "ADVANCE" }, ctx);
}

describe("a won fight's loot", () => {
  it("drops a coin for each few hit points of what was beaten, and says so", () => {
    const after = winFight(chapter("riftlight", [WOLF, BRUTE]));
    // 6 hp is 2 coins, 14 hp is 4, at one coin to every 4.
    expect(after.coins).toBe(Math.round(6 / RULES.loot!.hpPerCoin) + Math.round(14 / RULES.loot!.hpPerCoin));
    expect(after.narration).toContain("You find");
    expect(after.narration).toContain("coins");
  });

  it("pays at least a coin for the smallest foe", () => {
    const after = winFight(chapter("riftlight", [{ ...WOLF, hp: 1 }]));
    expect(after.coins).toBe(1);
    expect(after.narration).toContain("You find 1 coin ");
  });

  it("stops at the most one fight can pay", () => {
    const after = winFight(chapter("riftlight", [{ ...BRUTE, count: 4, hp: 40 }]));
    expect(after.coins).toBe(RULES.loot!.maxPerFight);
  });

  it("pays nothing in a campaign the rules do not name", () => {
    const after = winFight(chapter("gemfall", [WOLF, BRUTE]));
    expect(after.coins ?? 0).toBe(0);
    expect(after.narration).not.toContain("You find");
  });
});
