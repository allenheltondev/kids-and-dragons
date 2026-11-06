/**
 * Every befriending a chapter authors (#626, docs/camp.md §4.4, §12.6), held
 * to the owner's rules the validator cannot state:
 *
 *  - it is a choice ("Come along"), never an `onEnter`, a branch or a
 *    variant, beside an ungated "Say goodbye" that costs and writes nothing;
 *  - each lands on a scene of its own that shows the result, and the two
 *    meet again right after, so the friend changes nothing that follows;
 *  - the scene that asks stands on every way through the chapter, so every
 *    party is offered the friend once, under one reward id;
 *  - the friend is on stage there, and the words name it, never "your camp".
 *
 * The server side (the crew owns the friend after "Come along") is
 * packages/server/src/handlers/camp-befriend-chapters.test.ts.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => JSON.parse(readFileSync(join(REPO, ...parts), "utf8"));
const CATALOG = read("content", "camp.json");
const CHAPTERS = readdirSync(join(REPO, "content", "chapters"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => read("content", "chapters", f));

const BRANCHES = ["onSuccess", "onFailure", "onAssisted", "onVictory", "onDefeat", "onEscape", "onTimeout"];

/** Every way on out of a scene. */
function exits(scene) {
  const out = (scene.choices ?? []).map((c) => c.goto);
  for (const key of BRANCHES) if (scene[key]?.goto) out.push(scene[key].goto);
  return out;
}

/** The scenes reachable from the entry without passing `avoid`. */
function reachable(chapter, avoid) {
  const seen = new Set();
  const stack = [chapter.entry];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || id === avoid) continue;
    seen.add(id);
    stack.push(...exits(chapter.scenes[id]));
  }
  return seen;
}

/** Every befriend effect in a chapter, with where it is written. */
function befriends(chapter) {
  const out = [];
  const walk = (value, at) => {
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${at}/${i}`));
    if (!value || typeof value !== "object") return;
    if (value.type === "befriend") out.push({ effect: value, at });
    for (const [k, v] of Object.entries(value)) walk(v, `${at}/${k}`);
  };
  walk(chapter.scenes, "");
  return out;
}

const SITES = CHAPTERS.flatMap((chapter) => befriends(chapter).map(({ effect, at }) => ({ chapter, effect, at })));
const friendOf = (id) => CATALOG.friends.find((f) => f.id === id);

describe("befriendings in the chapters (#626)", () => {
  it("offers every catalog friend but the kid goat, whose goat kid goes home to the herder's herd", () => {
    const offered = new Set(SITES.map((s) => s.effect.rewardId));
    const missing = CATALOG.friends.flatMap((f) => f.offers.map((o) => o.rewardId)).filter((r) => !offered.has(r));
    expect(missing).toEqual(["riftlight-exchange-rift.kid_goat"]);
    // One offer, one place to make it.
    expect(SITES.map((s) => s.effect.rewardId)).toEqual([...offered]);
  });

  it.each(SITES.map((s) => [`${s.chapter.id} ${s.effect.friendId}`, s]))("%s: a choice beside an ungated goodbye, each on its own result scene", (_, { chapter, effect, at }) => {
    // Only ever a choice's effect: /<scene>/choices/<i>/effects/<j>.
    const match = /^\/([^/]+)\/choices\/(\d+)\/effects\/\d+$/.exec(at);
    expect(match, `${chapter.id}${at}`).toBeTruthy();
    const [, sceneId, index] = match;
    const ask = chapter.scenes[sceneId];
    const come = ask.choices[Number(index)];
    expect(come.effects).toEqual([effect]);
    for (const gate of ["when", "requiresFlag", "requiresItem", "requiresSpecies", "requiresClass"]) expect(come[gate], gate).toBeUndefined();
    expect(ask.variants ?? []).toEqual([]);

    const goodbyes = ask.choices.filter((c) => c !== come);
    expect(goodbyes).toHaveLength(1);
    const [goodbye] = goodbyes;
    expect(goodbye.label).toMatch(/^Say goodbye/);
    expect(goodbye.effects ?? []).toEqual([]);
    for (const gate of ["when", "requiresFlag", "requiresItem", "requiresSpecies", "requiresClass"]) expect(goodbye[gate], gate).toBeUndefined();

    // Each result is its own scene, which then goes on to one shared scene.
    expect(come.goto).not.toBe(goodbye.goto);
    const results = [chapter.scenes[come.goto], chapter.scenes[goodbye.goto]];
    for (const result of results) {
      expect(result.choices).toHaveLength(1);
      expect(result.onEnter ?? []).toEqual([]);
      expect(result.choices[0].effects ?? []).toEqual([]);
    }
    expect(results[0].choices[0].goto).toBe(results[1].choices[0].goto);
  });

  it.each(SITES.map((s) => [`${s.chapter.id} ${s.effect.friendId}`, s]))("%s: asked on every way through the chapter", (_, { chapter, at }) => {
    const sceneId = at.split("/")[1];
    const endings = Object.entries(chapter.scenes).filter(([, s]) => s.choices?.length === 0).map(([id]) => id);
    expect(endings.length).toBeGreaterThan(0);
    const without = reachable(chapter, sceneId);
    expect(endings.filter((id) => without.has(id)), `endings a party reaches without ${sceneId}`).toEqual([]);
  });

  it.each(SITES.map((s) => [`${s.chapter.id} ${s.effect.friendId}`, s]))("%s: the friend is on stage and named, and the camp is not", (_, { chapter, effect, at }) => {
    const sceneId = at.split("/")[1];
    const ask = chapter.scenes[sceneId];
    const friend = friendOf(effect.friendId);
    const results = ask.choices.map((c) => chapter.scenes[c.goto]);
    const kind = friend.name.split(" ").at(-1).toLowerCase();
    for (const scene of [ask, ...results]) {
      const words = [scene.narration, ...(scene.choices ?? []).map((c) => c.label)].join(" ");
      expect(words, scene.narration).not.toMatch(/\bcamp\b/i);
      expect(scene.cast?.length, `${sceneId} casts the friend`).toBeGreaterThan(0);
    }
    expect([ask.narration, ...ask.choices.map((c) => c.label)].join(" ").toLowerCase()).toContain(kind === "bun" ? "bun" : kind);
    for (const reaction of friend.reactions) expect(reaction).not.toMatch(/\bcamp\b/i);
  });
});
