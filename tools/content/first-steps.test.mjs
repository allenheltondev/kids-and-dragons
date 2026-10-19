/**
 * The practice (#255), as a test: content/chapters/first-steps-01.json
 * teaches by doing, in the issue's order, one hint per step on every path,
 * and nothing in it can cost anything. content:validate already holds it to
 * the format; this holds it to its job.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => JSON.parse(readFileSync(join(REPO, ...parts), "utf8"));
const raw = readFileSync(join(REPO, "content", "chapters", "first-steps-01.json"), "utf8");
const chapter = JSON.parse(raw);
const campaign = read("content", "campaigns", "first-steps.json");

/** Every way on out of a scene: choices, a check's two branches, a fight's endings. */
function exits(scene) {
  if (scene.choices) return scene.choices.map((c) => c.goto);
  return ["onSuccess", "onFailure", "onVictory", "onDefeat", "onEscape", "onTimeout"]
    .map((key) => scene[key]?.goto)
    .filter(Boolean);
}

/** Every path from the entry to an ending (the practice is small and has no loops). */
function paths(id = chapter.entry, trail = []) {
  const here = [...trail, id];
  const next = exits(chapter.scenes[id]);
  if (next.length === 0) return [here];
  return next.flatMap((to) => paths(to, here));
}

/** What each step is, in the order the issue teaches it: the scene type it happens in. */
const STEPS = [
  ["pick a choice", (s) => s.type === "choice_point" || s.type === "story"],
  ["roll a check", (s) => s.type === "check"],
  ["take a story turn", (s) => s.type === "story"],
  ["move on the board", (s) => s.type === "encounter" && s.environment?.exits],
  ["use a card", (s) => s.type === "encounter" && !s.environment],
  // A real friend on the ground for the Help Up card, and Bun for a table of one.
  ["help a knocked-down friend", (s) => s.type === "encounter" && s.friendDown === true && s.environment?.rescue],
  ["rest", (s) => s.type === "rest" && s.choices.length > 0],
];

describe("the practice (#255)", () => {
  it("is its own one-chapter campaign, never part of Gemfall", () => {
    expect(campaign.chapters).toEqual([chapter.id]);
    expect(chapter.campaignId).toBe(campaign.id);
    expect(read("content", "campaigns", "gemfall.json").chapters).not.toContain(chapter.id);
  });

  it("teaches every step in order, with one hint each, on every path", () => {
    const all = paths();
    expect(all.length).toBeGreaterThan(1);
    for (const path of all) {
      const hinted = path.map((id) => chapter.scenes[id]).filter((scene) => scene.hint !== undefined);
      expect(hinted.map((scene, i) => [STEPS[i]?.[0], Boolean(STEPS[i]?.[1](scene))]), path.join(" > ")).toEqual(
        STEPS.map(([step]) => [step, true]),
      );
    }
  });

  it("can cost nobody anything", () => {
    const COSTLY = new Set(["damage", "takeItem", "spendCoins", "grantItem", "grantQuestItem", "grantXp", "grantCoins"]);
    expect(chapter.xpAward).toBe(0);
    expect(chapter.objectives ?? []).toEqual([]);
    expect(chapter.props ?? {}).toEqual({});
    const effects = [];
    for (const [id, scene] of Object.entries(chapter.scenes)) {
      expect(scene.outcome, id).not.toBe("setback");
      expect(scene.endsCampaign, id).toBeUndefined();
      for (const list of [scene.onEnter, ...(scene.choices ?? []).map((c) => c.effects)]) effects.push(...(list ?? []));
      for (const key of ["onSuccess", "onFailure", "onVictory", "onDefeat", "onEscape"]) effects.push(...(scene[key]?.effects ?? []));
      const rescue = scene.environment?.rescue;
      effects.push(...(rescue?.effects ?? []));
      // A captive nobody can drag away and no clock to lose them to.
      expect(rescue?.byRound, id).toBeUndefined();
      expect(rescue?.hp, id).toBeUndefined();
      expect(scene.environment?.clock, id).toBeUndefined();
      expect(scene.environment?.hazards, id).toBeUndefined();
    }
    expect(effects.filter((e) => COSTLY.has(e.type))).toEqual([]);
  });

  it("goes on to the same next step whether a roll or a fight goes well or badly", () => {
    for (const [id, scene] of Object.entries(chapter.scenes)) {
      if (scene.type === "check") expect(scene.onFailure.goto, id).toBe(scene.onSuccess.goto);
      if (scene.type === "encounter") {
        expect(scene.onDefeat.goto, id).toBe(scene.onVictory.goto);
        if (scene.onEscape) expect(scene.onEscape.goto, id).toBe(scene.onVictory.goto);
        // Everybody back on their feet: a hero knocked down in one fight would
        // otherwise walk into the next one still down (the engine keeps HP).
        for (const key of ["onVictory", "onDefeat", "onEscape"].filter((k) => scene[k])) {
          expect(scene[key].effects, `${id}.${key}`).toContainEqual({ type: "heal", amount: 20, to: "party" });
        }
      }
    }
  });

  it("rests on the way and ends on a rest that puts everybody back on their feet", () => {
    const rests = Object.values(chapter.scenes).filter((s) => s.type === "rest");
    expect(rests.some((s) => s.choices.length > 0)).toBe(true);
    const endings = Object.values(chapter.scenes).filter((s) => s.choices?.length === 0);
    expect(endings.length).toBeGreaterThan(0);
    // HP outlives a chapter on the run, so the practice's bumps must not follow the party out.
    for (const ending of endings) expect(ending.heal).toBe(20);
  });

  it("is written for an 8-year-old at any table: no em dashes, no counting the party", () => {
    expect(raw).not.toMatch(/[–—]/);
    const PARTY_COUNT = [
      /\b(?:two|three|four) of (?:you|us|our|your)\b/i,
      /\b(?:both|each) of you\b/i,
      /\bthe two of you\b/i,
      /\byour (?:two|three|four) (?:names|heads|hands)\b/i,
    ];
    expect(PARTY_COUNT.filter((re) => re.test(raw)).map(String)).toEqual([]);
    for (const [id, scene] of Object.entries(chapter.scenes)) {
      if (scene.hint !== undefined) expect(scene.hint.length, id).toBeLessThanOrEqual(240);
    }
  });

  it("is the only chapter with hints or a friend knocked down on purpose: a real chapter trusts the table", () => {
    const dir = join(REPO, "content", "chapters");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "first-steps-01.json")) {
      const other = read("content", "chapters", file);
      const marked = Object.entries(other.scenes).filter(([, s]) => s.hint !== undefined || s.friendDown !== undefined);
      expect(marked.map(([id]) => id), file).toEqual([]);
    }
  });
});
