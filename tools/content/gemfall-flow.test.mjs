/**
 * Gemfall's flow — docs/campaigns/gemfall-authoring.md §4, "Every choice
 * lands somewhere that shows its result", as a test.
 *
 * `content:validate` proves a chapter can be played: every goto resolves,
 * every scene is reachable. It cannot tell whether playing it feels like
 * anything. The first Gemfall draft passed validation while a hundred
 * choices went to the same next scene with nothing in between, so a vote at
 * the table changed nothing anyone could see. These checks hold the line
 * that pass drew:
 *
 *  - No em or en dashes anywhere in a chapter file, prose or comment.
 *  - Every `check` branch narrates what happened.
 *  - Two choices in one scene may share a destination only when the
 *    destination is a check (its narration is the result), when they are
 *    the same decision worded twice, or when the pair is listed below with
 *    a reason. Anything else is a funnel and fails.
 *  - A result scene is short on purpose: one way out, so the party is never
 *    asked a second question before the first one has answered.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => readFileSync(join(REPO, ...parts), "utf8");

const campaign = JSON.parse(read("content", "campaigns", "gemfall.json"));
const chapters = campaign.chapters.map((id) => ({ id, raw: read("content", "chapters", `${id}.json`) }));

/**
 * Choices that intentionally converge on a story or rest scene, with why.
 * Add a line here only when the shared destination already answers both
 * choices; otherwise give the choice its own result scene.
 */
const INTENDED = {
  "gemfall-01/scene_tavern": ["saw_it_too", "curious"], // both are "we believe you"; she hugs you either way
  "gemfall-06/scene_ledger": [
    ["medal", "glade_mended", "duty"], // the reading scene names what was shown
    ["sprites_wronged", "glade_finished", "ember", "wealth"],
    ["curious", "prestige", "hessa"],
  ],
  "gemfall-06/scene_who_to_tell": [
    ["wardens", "stay_wardens"], // a new promise and a kept one get the same room
    ["gatherers", "stay_gatherers"],
    ["close", "stay_close"],
  ],
  "gemfall-06/scene_declared_restore": ["record_a", "record_b"], // two flags, one page turned back
  "gemfall-06/scene_declared_hoard": ["record_a", "record_b"],
  "gemfall-06/scene_declared_leash": ["record_a", "record_b"],
  "gemfall-07h/walk_scene_boundary": ["confess", "bells", "stirring"], // three ways to ask about the fuse
  "gemfall-07h/walk_scene_look_back": ["trust", "moths", "happy_ring"], // the ending is the answer
};

function intended(chapterId, sceneId, ids) {
  const entry = INTENDED[`${chapterId}/${sceneId}`];
  if (!entry) return false;
  const groups = Array.isArray(entry[0]) ? entry : [entry];
  return groups.some((g) => ids.every((id) => g.includes(id)));
}

describe("Gemfall reads cleanly", () => {
  for (const { id, raw } of chapters) {
    it(`${id} has no em or en dashes`, () => {
      const lines = raw.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /[–—]/.test(l));
      expect(lines.map(([n, l]) => `${n}: ${l.trim().slice(0, 80)}`)).toEqual([]);
    });
  }
});

describe("every Gemfall choice lands on a scene that shows its result", () => {
  for (const { id, raw } of chapters) {
    const scenes = JSON.parse(raw).scenes;

    it(`${id}: every check branch narrates`, () => {
      const silent = [];
      for (const [sid, s] of Object.entries(scenes)) {
        if (s.type !== "check") continue;
        for (const b of ["onSuccess", "onFailure"]) if (!s[b].narration) silent.push(`${sid}.${b}`);
      }
      expect(silent).toEqual([]);
    });

    it(`${id}: no two choices funnel into the same story or rest scene`, () => {
      const funnels = [];
      for (const [sid, s] of Object.entries(scenes)) {
        const by = new Map();
        for (const c of s.choices ?? []) by.set(c.goto, [...(by.get(c.goto) ?? []), c.id]);
        for (const [goto, ids] of by) {
          if (ids.length < 2) continue;
          if (scenes[goto].type === "check") continue;
          if (intended(id, sid, ids)) continue;
          funnels.push(`${sid} -> ${goto}: ${ids.join(", ")}`);
        }
      }
      expect(funnels, "give each of these choices its own result scene, or list the pair in INTENDED with a reason").toEqual([]);
    });

    it(`${id}: result scenes have one way out`, () => {
      // A scene named <source>_<choice> was made by the flow pass as the
      // answer to one choice. It continues; it never asks again.
      const busy = [];
      for (const [sid, s] of Object.entries(scenes)) {
        const [src] = Object.keys(scenes).filter((o) => o !== sid && sid.startsWith(`${o}_`)).sort((a, b) => b.length - a.length);
        if (!src) continue;
        const choice = (scenes[src].choices ?? []).find((c) => c.goto === sid && sid === `${src}_${c.id}`);
        if (choice && (s.choices ?? []).length !== 1) busy.push(sid);
      }
      expect(busy).toEqual([]);
    });
  }
});

describe("the INTENDED list stays honest", () => {
  it("names only scenes and choices that exist", () => {
    const missing = [];
    for (const [key, entry] of Object.entries(INTENDED)) {
      const [chapterId, sceneId] = key.split("/");
      const chapter = chapters.find((c) => c.id === chapterId);
      const scene = chapter && JSON.parse(chapter.raw).scenes[sceneId];
      if (!scene) {
        missing.push(key);
        continue;
      }
      const groups = Array.isArray(entry[0]) ? entry : [entry];
      for (const g of groups) for (const cid of g) if (!scene.choices?.some((c) => c.id === cid)) missing.push(`${key}#${cid}`);
    }
    expect(missing).toEqual([]);
  });
});
