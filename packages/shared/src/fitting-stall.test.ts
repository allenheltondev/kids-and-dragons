/**
 * The Exchange's fitting stall (#312, docs/class-mastery.md §1): the gate
 * that sets it apart from a class place (#311). The swap itself is
 * `fitClass` (character.test.ts); the stall through the server and the real
 * engine is packages/server/src/handlers/fitting-stall.test.ts.
 */

import { describe, expect, it } from "vitest";
import {
  classAnswerRefusal,
  classPlaceWaitingOn,
  fittingStallAt,
  isNewHero,
  keepClassIntent,
  maySwitchAt,
  openClassPlace,
  owesClassAnswer,
} from "./class-place.js";
import { resolveCharacter } from "./character.js";
import type { Scene } from "./types/chapter.js";
import type { RulesContent } from "./types/domain.js";
import type { ClassPlaceState, PartyMember, RunState } from "./types/state.js";
import { makeCharacter, makeItems, makeRules } from "./test-fixtures.js";

const rules: RulesContent = {
  ...makeRules(),
  fittingStall: {
    stands: [{ chapterId: "ch_1", sceneId: "gate" }],
    keeper: "Madame Tuck",
    narration: "A frogfolk named Madame Tuck.",
  },
};

const story: Scene = { type: "story", narration: "A gate.", choices: [{ id: "on", label: "Go on", icon: "map", goto: "next" }] };

function member(playerId: string, opts: { xp?: number; fitted?: boolean; connected?: boolean; class?: "songkeeper" | "thornguard" } = {}): PartyMember {
  const character = makeCharacter({ id: `c_${playerId}`, ownerPlayerId: playerId, xp: opts.xp ?? 0, class: opts.class ?? "songkeeper" });
  if (opts.fitted) character.committed.fitted = true;
  return {
    playerId,
    character: resolveCharacter(character, rules, makeItems()),
    connected: opts.connected ?? true,
  } as PartyMember;
}

const at = (party: PartyMember[], sceneId = "gate", chapterId = "ch_1") => ({ rules, chapterId, sceneId, party });

describe("who is new (isNewHero)", () => {
  it("is a hero with no chapter finished and the swap unspent", () => {
    expect(isNewHero(member("p_1").character)).toBe(true);
    // A finished chapter is XP; a tier-floor joiner has XP too.
    expect(isNewHero(member("p_1", { xp: 50 }).character)).toBe(false);
    expect(isNewHero(member("p_1", { fitted: true }).character)).toBe(false);
  });
});

describe("where the stall opens (openClassPlace)", () => {
  it("opens where the rules say it stands, while somebody there is new", () => {
    expect(fittingStallAt(rules, "ch_1", "gate")).toBe(true);
    expect(openClassPlace(story, at([member("p_1"), member("p_2", { xp: 50 })]))).toEqual({ stall: true, answers: {} });
  });

  it("stays shut for a table of veterans, anywhere else, and in rules without a stall", () => {
    expect(openClassPlace(story, at([member("p_1", { xp: 50 }), member("p_2", { fitted: true })]))).toBeUndefined();
    expect(openClassPlace(story, at([member("p_1")], "elsewhere"))).toBeUndefined();
    expect(openClassPlace(story, at([member("p_1")], "gate", "ch_2"))).toBeUndefined();
    expect(openClassPlace(story, { ...at([member("p_1")]), rules: makeRules() })).toBeUndefined();
    expect(openClassPlace(story)).toBeUndefined();
  });

  it("leaves a class place a class place", () => {
    expect(openClassPlace({ ...story, classPlace: "thornguard" } as Scene, at([member("p_1")]))).toEqual({ class: "thornguard", answers: {} });
  });
});

describe("who answers at the stall", () => {
  const stall: ClassPlaceState = { stall: true, answers: {} };

  it("waits on every connected new hero, and on nobody else", () => {
    const party = [member("p_1"), member("p_2", { xp: 50 }), member("p_3", { connected: false }), member("p_4")];
    expect(classPlaceWaitingOn({ classPlace: stall, party }).map((m) => m.playerId)).toEqual(["p_1", "p_4"]);
    expect(maySwitchAt(stall, party[1]!)).toBe(false);
    const answered: ClassPlaceState = { stall: true, answers: { p_1: { switched: false } } };
    expect(owesClassAnswer(answered, party[0]!)).toBe(false);
    // A kid who kept may still switch while the stall is open.
    expect(maySwitchAt(answered, party[0]!)).toBe(true);
  });

  it("refuses a tap aimed at the other kind of place, a veteran, and a class that is not a change", () => {
    const party = [member("p_1"), member("p_2", { xp: 50 })];
    const state = { phase: "scene", classPlace: stall, party } as Pick<RunState, "classPlace" | "party" | "phase">;
    expect(classAnswerRefusal(state, "p_1", "starweaver", true, true)).toBeNull();
    expect(classAnswerRefusal(state, "p_1", "songkeeper", false, true)).toBeNull();
    expect(classAnswerRefusal(state, "p_1", "starweaver", true, false)).toMatch(/fitting stall, not a class place/);
    expect(classAnswerRefusal(state, "p_2", "starweaver", true, true)).toMatch(/not new/);
    expect(classAnswerRefusal(state, "p_1", "songkeeper", true, true)).toMatch(/already a songkeeper/);
    expect(classAnswerRefusal(state, "p_1", "thornguard", false, true)).toMatch(/not a thornguard/);
    const room = { ...state, classPlace: { class: "thornguard", answers: {} } } as typeof state;
    expect(classAnswerRefusal(room, "p_1", "thornguard", true, true)).toMatch(/no fitting stall here/);
  });

  it("keeps what each hero wears, as their phone would say it", () => {
    expect(keepClassIntent(stall, member("p_1"))).toEqual({ type: "KEEP_CLASS", classId: "songkeeper", stall: true });
    expect(keepClassIntent({ class: "thornguard", answers: {} }, member("p_1"))).toEqual({ type: "KEEP_CLASS", classId: "thornguard" });
  });
});
