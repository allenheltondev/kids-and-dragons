/**
 * The prompt's cache layout — architecture §6.3.
 *
 * Two of these tests are about a failure mode with **no error surface at all**:
 * a cached prefix under 4096 tokens does not warn, it just quietly stops
 * caching, and a volatile value at the front of the prefix does not warn, it
 * just quietly stops matching. Both cost real money on every call for however
 * long it takes somebody to notice, and neither shows up in a passing test
 * suite unless a test goes looking. These go looking.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Chapter, RulesContent, Scene } from "@kad/shared";
import {
  CACHE_FLOOR_TOKENS,
  CACHE_MARGIN,
  cachedPrefix,
  castBlock,
  chapterBackground,
  estimateTokens,
  momentBlock,
  partyBlock,
  promptIsStable,
  recapPrompt,
  sceneBlock,
  toneBlock,
} from "./prompt.ts";
import type { NarrationRequest, PartyBrief } from "./port.ts";

/*
 * The **shipped** rules and the **shipped** chapter, not fixtures.
 *
 * The claim under test is that this project's real cached prefix clears 4096
 * tokens. A fixture would answer a different question — one about a chapter
 * nobody plays — and would keep answering it happily while the real prefix sat
 * under the floor paying full price. `balance.test.ts` reads the shipped
 * content for the same reason.
 */
const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "rules.json"), "utf8")) as RulesContent;
const SHIPPED = JSON.parse(
  fs.readFileSync(path.join(ROOT, "content", "chapters", "bramblewood-01.json"), "utf8"),
) as Chapter;

const CHAPTER: Chapter = {
  id: "bramblewood-01",
  campaignId: "the-hollow-crown",
  index: 1,
  title: "The Bramblewood",
  biome: "forest",
  estimatedMinutes: 30,
  xpAward: 100,
  entry: "scene_clearing",
  scenes: {},
  llmHints: {
    tone: "warm, playful, a little spooky but never scary",
    vocabulary: "age-8",
    forbidden: ["death", "blood", "permanent loss"],
    npcVoices: { pib: "a bramble sprite the size of a teapot" },
  },
};

const SCENE: Scene = {
  type: "story",
  narration: "A wall of thorns twice your height blocks the path through the hedge.",
  choices: [],
};

const PARTY: PartyBrief[] = [
  { name: "Sparklehoof", species: "unicorn", class: "songkeeper", level: 2, hp: 10, maxHp: 10, down: false },
  { name: "Windstep", species: "griffin", class: "duskrunner", level: 2, hp: 3, maxHp: 12, down: false },
  { name: "Thistle", species: "bigfoot", class: "warden", level: 1, hp: 0, maxHp: 14, down: true },
];

describe("the cacheable prefix", () => {
  it("clears Haiku 4.5's 4096-token floor with margin", () => {
    /*
     * The test this file exists for. §6.3: "If the cached prefix lands under 4K
     * there is no error — caching silently does nothing and you pay full input
     * price on every call."
     *
     * So the floor is a cliff with nothing on the other side of it to tell you
     * that you went over, which makes it exactly the kind of constraint that
     * survives right up until somebody trims a few-shot example for being
     * wordy. This is what stops that edit.
     */
    const tokens = estimateTokens(cachedPrefix(RULES, SHIPPED));
    expect(tokens).toBeGreaterThan(CACHE_FLOOR_TOKENS * CACHE_MARGIN);
  });

  it("still clears it for a chapter with no hints, which gets the defaults", () => {
    // A chapter without `llmHints` renders the fallback tone and no voices — the
    // shortest this block can ever be. If *that* clears the floor, every
    // chapter does.
    const bare: Chapter = { ...SHIPPED, llmHints: undefined };
    expect(estimateTokens(cachedPrefix(RULES, bare))).toBeGreaterThan(CACHE_FLOOR_TOKENS * CACHE_MARGIN);
  });

  it("puts nothing volatile in front of the cache", () => {
    /*
     * §6.3: "Never interpolate a timestamp, UUID, or request ID into the system
     * prompt. It sits at the front of the prefix and invalidates everything
     * after it."
     *
     * The failure is invisible — every call is a cache miss and the only
     * evidence is the bill — so the rule is checked rather than remembered.
     */
    expect(promptIsStable(cachedPrefix(RULES, SHIPPED))).toEqual({ stable: true });
    expect(promptIsStable(partyBlock(PARTY))).toEqual({ stable: true });
    expect(promptIsStable(sceneBlock(CHAPTER, "scene_hedge", SCENE, { freed_sprite: true }))).toEqual({
      stable: true,
    });
  });

  it("would catch a volatile value if one were added", () => {
    // The stability check has to be able to fail, or the three assertions above
    // are decoration.
    const spoiled = `${cachedPrefix(RULES, SHIPPED)}\n\nGenerated at 2026-08-17T10:20:30Z`;
    const verdict = promptIsStable(spoiled);
    expect(verdict.stable).toBe(false);
    if (!verdict.stable) expect(verdict.found).toMatch(/ISO timestamp/);
  });

  it("is byte-identical across two renders of the same chapter", () => {
    // Prefix matching is on bytes. Any nondeterminism — a Set iterated, a key
    // order, a Date — makes every call a miss while looking completely fine.
    expect(cachedPrefix(RULES, SHIPPED)).toBe(cachedPrefix(RULES, SHIPPED));
    expect(partyBlock(PARTY)).toBe(partyBlock(PARTY));
  });
});

describe("what each block says", () => {
  it("carries the chapter's own tone, forbidden list and voices", () => {
    // Allen's half of chapter 7 is `llmHints`. If the block did not read them,
    // authoring them would do nothing.
    const block = toneBlock(CHAPTER);
    expect(block).toContain("a little spooky but never scary");
    expect(block).toContain("death, blood, permanent loss");
    expect(block).toContain("a bramble sprite the size of a teapot");
  });

  it("tells the model it is not the game", () => {
    // The single most important instruction in the prompt: everything the
    // validator rejects, the prompt should have prevented.
    const block = toneBlock(CHAPTER);
    expect(block).toMatch(/No mechanics/);
    expect(block).toMatch(/No choices/);
    expect(block).toMatch(/PASS/);
  });

  it("describes the party by how hurt they are, not by their hit points", () => {
    /*
     * "3 of 12" is a number the model would be tempted to repeat, and the
     * validator forbids narration that names mechanics. Handing it the state as
     * a word is how the prompt stays consistent with the gate.
     */
    const block = partyBlock(PARTY);
    expect(block).toContain("Sparklehoof");
    expect(block).toMatch(/Windstep.*hurt/);
    expect(block).toMatch(/Thistle.*knocked down/);
  });

  it("survives an empty party, which is every lobby", () => {
    expect(partyBlock([])).toContain("Nobody has made a character yet");
  });

  it("gives the scene its authored line and the run's flags", () => {
    const block = sceneBlock(CHAPTER, "scene_hedge", SCENE, { freed_sprite: true, never_happened: false });
    expect(block).toContain("A wall of thorns");
    expect(block).toContain("freed_sprite");
    // A false flag is not a thing that happened, and listing it would tell the
    // model the opposite of the truth.
    expect(block).not.toContain("never_happened");
  });

  it("lists what is in a fight", () => {
    const fight: Scene = {
      type: "encounter",
      map: "map_hollow",
      enemies: [{ id: "wisp", name: "Bramblewisp", count: 2, hp: 6, guard: 11, quick: 3, steps: 4, attack: 3 }],
      onVictory: { goto: "scene_after" },
      onDefeat: { goto: "scene_after" },
    };
    expect(sceneBlock(CHAPTER, "encounter_wisps", fight, {})).toContain("2× Bramblewisp");
  });

  it("names the choice they tapped, which is the whole point of the layer", () => {
    /*
     * The authored line is written once for every way into a scene. How they
     * arrived is the one thing the author could not know, so it is the one
     * thing the live call is actually for.
     */
    const request = { via: "Knock politely" } as NarrationRequest;
    expect(momentBlock(request)).toContain("Knock politely");
    expect(momentBlock({ via: null } as NarrationRequest)).toMatch(/just arrived/);
  });
});

describe("the recap", () => {
  it("names the party, the road they took and how it ended", () => {
    const prompt = recapPrompt({
      runId: "r_1",
      chapter: CHAPTER,
      party: PARTY,
      flags: { freed_sprite: true },
      visited: ["scene_clearing", "scene_hedge", "scene_ending"],
      outcome: "triumph",
    });
    expect(prompt).toContain("The Bramblewood");
    expect(prompt).toContain("Sparklehoof");
    expect(prompt).toContain("scene_clearing → scene_hedge → scene_ending");
    expect(prompt).toContain("triumph");
    expect(prompt).toContain("freed_sprite");
  });

  it("holds itself to the recap cap the validator enforces", () => {
    // The prompt and `validateRecap` have to agree on the number, or the layer
    // spends tokens producing recaps that are thrown away for being too long.
    expect(recapPrompt({
      runId: "r_1",
      chapter: CHAPTER,
      party: PARTY,
      flags: {},
      visited: ["scene_clearing"],
      outcome: null,
    })).toContain("400 characters");
  });
});
