/**
 * What the table plays in Gemfall besides voting (#496's Riftlight pass, applied to Gemfall).
 *
 * Every chapter has a fight every success ending walks, four or more story
 * interactions on every success route in at least three kinds, two or more
 * whole-party rolls, a class moment beside an ungated way, and things to earn
 * (items, coins). Setback endings may skip the fight: a lost fight is a rescue
 * that rejoins the spine, and the setbacks that exist were authored first.
 * `content:pacing` reports the same numbers; this is the gate.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pacingReport, shortestSuccessPath } from "@kad/shared";
import type { Campaign, Chapter, Scene } from "@kad/shared";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")) as T;
const campaign = read<Campaign>("content/campaigns/gemfall.json");
const chapters = campaign.chapters.map((id) => read<Chapter>(`content/chapters/${id}.json`));

/** `grantXp` effects that shipped before this pass; no chapter may add one. */
const EXISTING_GRANT_XP: Record<string, number> = { "gemfall-07h": 1 };

/** Chapters that, by design, have no fight on the spine. Each needs a reason. */
const NO_SPINE_FIGHT: Record<string, string> = {};

function exits(scene: Scene): string[] {
  const out: string[] = [];
  for (const choice of "choices" in scene ? (scene.choices ?? []) : []) out.push(choice.goto);
  for (const key of ["onSuccess", "onFailure", "onAssisted", "onVictory", "onDefeat", "onEscape", "onTimeout"] as const) {
    const branch = (scene as unknown as Record<string, { goto?: string } | undefined>)[key];
    if (branch?.goto) out.push(branch.goto);
  }
  return out;
}

const isSuccessEnding = (scene: Scene): boolean => exits(scene).length === 0 && !("outcome" in scene && scene.outcome === "setback");

/** Whether some success ending is reachable from the entry without passing through `blocked`. */
function reachesEndingWithout(chapter: Chapter, blocked: string): boolean {
  const seen = new Set<string>([chapter.entry]);
  const queue = [chapter.entry];
  while (queue.length) {
    const id = queue.shift()!;
    const scene = chapter.scenes[id]!;
    if (isSuccessEnding(scene)) return true;
    for (const to of exits(scene)) if (to !== blocked && !seen.has(to) && chapter.scenes[to]) { seen.add(to); queue.push(to); }
  }
  return false;
}

// These gates inspect shortest paths only. Do not compute 500 typical-path
// walks per scenario on each assertion: they are unused and can time out CI.
const shortestReport = (chapter: Chapter) => pacingReport(chapter, undefined, 0);

const text = (chapter: Chapter): string => JSON.stringify(chapter.scenes);
const count = (chapter: Chapter, re: RegExp): number => (text(chapter).match(re) ?? []).length;

/** Explore every edge, including gated choices and missed checks. This
 * over-approximates playable routes, proving coverage without assuming a party
 * or flag history. Capped counts and kind sets keep loops finite. */
function interactionCoverageGaps(chapter: Chapter): string[][] {
  const queue = [{ id: chapter.entry, count: 0, kinds: [] as string[], route: [] as string[] }];
  const seen = new Set<string>();
  const gaps: string[][] = [];
  for (let i = 0; i < queue.length; i++) {
    const state = queue[i]!;
    const scene = chapter.scenes[state.id]!;
    const count = Math.min(4, state.count + Number(scene.type === "interaction"));
    const kinds = [...new Set([...state.kinds, ...(scene.type === "interaction" ? [scene.interaction.kind] : [])])].sort();
    const key = JSON.stringify([state.id, count, kinds]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (count >= 4 && kinds.length >= 3) continue;
    const route = [...state.route, state.id];
    if (isSuccessEnding(scene)) gaps.push(route);
    for (const id of exits(scene)) queue.push({ id, count, kinds, route });
  }
  return gaps;
}

describe.each(chapters)("$id", (chapter) => {
  it("puts four interactions in three kinds on every success route, including alternate choices", () => {
    expect(interactionCoverageGaps(chapter)).toEqual([]);
  });

  it("has a fight that every success ending walks", () => {
    if (NO_SPINE_FIGHT[chapter.id]) return;
    const fights = Object.entries(chapter.scenes).filter(([, s]) => s.type === "encounter").map(([id]) => id);
    const spine = fights.filter((id) => !reachesEndingWithout(chapter, id));
    expect(spine.length, `${chapter.id}: no encounter is on every road to a success ending`).toBeGreaterThan(0);
    for (const { shortest } of shortestReport(chapter).scenarios) expect(shortest!.encounters).toBeGreaterThanOrEqual(1);
  });

  it("keeps the standard length: 30 scenes and 14 votes and checks on the shortest path", () => {
    for (const { shortest } of shortestReport(chapter).scenarios) {
      expect(shortest!.scenes).toBeGreaterThanOrEqual(30);
      expect(shortest!.decisions + shortest!.checks).toBeGreaterThanOrEqual(14);
    }
  });

  it("puts four story interactions in three kinds on the shortest path", () => {
    for (const { scenario } of shortestReport(chapter).scenarios) {
      const onPath = (shortestSuccessPath(chapter, scenario) ?? []).map((id) => chapter.scenes[id]!).filter((s) => s.type === "interaction");
      expect(onPath.length, `${chapter.id} (${scenario.id})`).toBeGreaterThanOrEqual(4);
      const kinds = new Set(onPath.map((s) => (s.type === "interaction" ? s.interaction.kind : "")));
      expect(kinds.size, `${chapter.id} (${scenario.id}): ${[...kinds].join(", ")}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("asks the whole table to roll twice or more, and gives a class a moment beside an ungated way", () => {
    expect(count(chapter, /"roller":"all"/g)).toBeGreaterThanOrEqual(2);
    for (const [id, scene] of Object.entries(chapter.scenes)) {
      const choices = "choices" in scene ? (scene.choices ?? []) : [];
      if (choices.some((c) => c.requiresClass)) expect(choices.some((c) => !c.requiresClass && !c.requiresSpecies && !c.requiresItem && !c.requiresFlag && !c.when), `${id} has only gated choices`).toBe(true);
    }
    expect(count(chapter, /"requiresClass"/g)).toBeGreaterThanOrEqual(1);
  });

  it("hands out items and coins, and takes coins somewhere", () => {
    expect(count(chapter, /"type":"grantItem"/g)).toBeGreaterThanOrEqual(2);
    expect(count(chapter, /"type":"grantCoins"/g)).toBeGreaterThanOrEqual(1);
    expect(count(chapter, /"type":"grantXp"/g)).toBeLessThanOrEqual(EXISTING_GRANT_XP[chapter.id] ?? 0);
    expect(count(chapter, /"type":"spendCoins"/g)).toBeGreaterThanOrEqual(1);
  });

  it("never lets one ordinary lost fight be a setback ending of the spine fight", () => {
    for (const [id, scene] of Object.entries(chapter.scenes)) {
      if (scene.type !== "encounter" || reachesEndingWithout(chapter, id)) continue;
      const lost = chapter.scenes[scene.onDefeat.goto]!;
      expect("outcome" in lost && lost.outcome === "setback", `${id}: onDefeat is a setback`).toBe(false);
    }
  });
});
