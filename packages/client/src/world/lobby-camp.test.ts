/**
 * The lobby's camp read off the run state (#614): which phases show it, who is
 * seated where, and the moments between two states. Pure, like victory.ts's
 * test: a table of transitions, no renderer.
 */

import { describe, expect, it } from "vitest";
import type { PartyMember, RunState } from "@kad/shared";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { campLayout, parseCampManifest } from "./camp-layout";
import { campManifestFixture } from "../testing/camp-fixture";
import {
  begun,
  campCues,
  campHeroes,
  campSeed,
  campShownIn,
  lobbyCampLayout,
  stillCampFigures,
  type CampHero,
} from "./lobby-camp";

function member(n: number, overrides: Partial<PartyMember> = {}): PartyMember {
  return makeMember({
    character: makeCharacter({ id: `c_${n}`, ownerPlayerId: `p_${n}`, species: n % 2 ? "griffin" : "unicorn" }),
    playerId: `p_${n}`,
    ...overrides,
  });
}

const heroes = (...members: PartyMember[]): CampHero[] => campHeroes(makeState({ party: members }));

describe("where the camp shows", () => {
  it("is the lobby, and creation, which is the lobby once the first hero is made", () => {
    expect(campShownIn("lobby")).toBe(true);
    expect(campShownIn("creation")).toBe(true);
    // A missing phase is the lobby, as WorldView's own default reads it.
    expect(campShownIn(undefined)).toBe(true);
    for (const phase of ["scene", "check", "encounter", "chapter_complete"]) expect(campShownIn(phase)).toBe(false);
  });

  it("calls the lobby giving way to a scene Begin, and nothing else", () => {
    expect(begun("lobby", "scene")).toBe(true);
    expect(begun("creation", "scene")).toBe(true);
    expect(begun("creation", "encounter")).toBe(true);
    expect(begun("scene", "check")).toBe(false);
    expect(begun("chapter_complete", "lobby")).toBe(false);
    expect(begun("lobby", "lobby")).toBe(false);
  });
});

describe("who is in camp", () => {
  it("draws every seated hero at the seat they sat down in, with the lineup's art and true size", () => {
    const seated = heroes(member(1), member(2), member(3));
    expect(seated.map((h) => [h.figure.id, h.figure.seat])).toEqual([["c_1", 0], ["c_2", 1], ["c_3", 2]]);
    const griffin = seated[0]!.figure;
    expect(griffin.url).toMatch(/griffin/);
    expect(griffin.heightCm).toBe(160);
    expect(griffin.stance).toBe("standing");
  });

  it("leaves out a player still making a hero, and one the host took out, without moving anybody's bedroll", () => {
    const state = makeState({
      party: [member(1), member(2), member(3)],
      removed: ["p_2"],
      seats: { p_9: { name: "Sam", color: "#abc", device: "phone" } },
    });
    expect(campHeroes(state).map((h) => [h.figure.id, h.figure.seat])).toEqual([["c_1", 0], ["c_3", 2]]);
  });

  it("gives a hero past the fourth seat a bedroll nobody holds", () => {
    const state = makeState({ party: [member(1), member(2), member(3), member(4), member(5)], removed: ["p_2"] });
    expect(campHeroes(state).map((h) => h.figure.seat)).toEqual([0, 2, 3, 1]);
  });

  it("is nobody before there is a state", () => {
    expect(campHeroes(null)).toEqual([]);
  });
});

describe("the lobby's moments, from two states", () => {
  it("on a first look, nobody arrives: the away are away and the ready are in line", () => {
    const now = heroes(member(1), member(2, { ready: true }), member(3, { connected: false, ready: true }));
    expect(campCues(null, now)).toEqual([
      { kind: "ready", id: "c_2" },
      { kind: "away", id: "c_3" },
    ]);
  });

  it("a kid sitting down arrives", () => {
    expect(campCues(heroes(member(1)), heroes(member(1), member(2)))).toEqual([{ kind: "arrive", id: "c_2" }]);
  });

  it("Ready on and off", () => {
    const before = heroes(member(1), member(2));
    const ready = heroes(member(1, { ready: true }), member(2));
    expect(campCues(before, ready)).toEqual([{ kind: "ready", id: "c_1" }]);
    expect(campCues(ready, before)).toEqual([{ kind: "unready", id: "c_1" }]);
    expect(campCues(ready, ready)).toEqual([]);
  });

  it("stepping away, and coming back", () => {
    const here = heroes(member(1), member(2));
    const away = heroes(member(1), member(2, { connected: false }));
    expect(campCues(here, away)).toEqual([{ kind: "away", id: "c_2" }]);
    expect(campCues(away, here)).toEqual([{ kind: "arrive", id: "c_2" }]);
  });

  it("a ready hero who steps away leaves the line, and rejoins it on coming back", () => {
    const ready = heroes(member(1, { ready: true }));
    const away = heroes(member(1, { ready: true, connected: false }));
    expect(campCues(ready, away)).toEqual([{ kind: "away", id: "c_1" }]);
    expect(campCues(away, ready)).toEqual([{ kind: "arrive", id: "c_1" }, { kind: "ready", id: "c_1" }]);
  });

  it("a hero who is away says nothing while their ready flag changes", () => {
    expect(campCues(heroes(member(1, { connected: false })), heroes(member(1, { connected: false, ready: true })))).toEqual([]);
  });

  it("a kid who sits down already away does not wave", () => {
    expect(campCues(heroes(member(1)), heroes(member(1), member(2, { connected: false })))).toEqual([{ kind: "away", id: "c_2" }]);
  });
});

describe("the downtime moment's seed", () => {
  const lobby = makeState({ party: [member(1)] });

  it("is the same for every screen on the same lobby, whatever is tapped in it", () => {
    const tapped: RunState = { ...lobby, seq: 9, party: [member(1, { ready: true })], campaignVotes: { p_1: "riftlight" } };
    expect(campSeed(tapped)).toBe(campSeed(lobby));
  });

  it("is a different number for another room, and for the lobby after a chapter", () => {
    expect(campSeed({ ...lobby, roomCode: "WXYZ" })).not.toBe(campSeed(lobby));
    expect(campSeed({ ...lobby, visited: ["arrival", "market", "ending_good"] })).not.toBe(campSeed(lobby));
  });
});

describe("the still camp", () => {
  const layout = campLayout(parseCampManifest(campManifestFixture()), "open_plains", 1);

  it("stands every hero at their own bedroll, faded when away", () => {
    const figures = stillCampFigures(layout, heroes(member(1), member(2, { connected: false })));
    expect(figures.map((f) => [f.id, f.x, f.y, f.away])).toEqual([
      ["c_1", 0.24, 0.7, false],
      ["c_2", 0.38, 0.7, true],
    ]);
    for (const figure of figures) expect(figure.size).toBeGreaterThan(0.2);
  });
});

describe("the lobby's layout", () => {
  it("is the manifest's open_plains camp at stage 1", () => {
    const layout = lobbyCampLayout();
    expect(layout?.backdrop.family).toBe("open_plains");
    expect(layout?.frame.stage).toBe(1);
  });
});
