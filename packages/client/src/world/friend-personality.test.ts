import catalog from "../../../../content/camp.json";
import { describe, expect, it } from "vitest";
import { campFriendMoment, campMusicReaction, friendTrait } from "./friend-personality";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
const member = makeMember({ character: makeCharacter({ id: "hero", name: "Pip" }) });
const state = makeState({ phase: "lobby", party: [member], kits: { hero: { revision: 1, style: "rolled", tent: null, color: null, slots: ["deco_pinwheel", null], unlocked: [], buddy: "duckling" } }, campMoment: { id: "camp:1", kind: "lobby", outdoor: true, changes: {}, friends: { rotation: ["bun", "duckling"], out: ["bun", "duckling"], cards: [{ id: "bun", name: "Bun", figure: "cast/bun" }, { id: "duckling", name: "Duckling", figure: "entities/duckling" }] } } });
describe("friends with personalities", () => {
  it("notices a hero's actual decoration, follows their buddy, and greets another friend", () => {
    expect(campFriendMoment(state, 0)).toMatchObject({ friendId: "bun", heroId: "hero", words: expect.stringContaining("Pip's pinwheel") });
    expect(campFriendMoment(state, 1)).toMatchObject({ friendId: "duckling", heroId: "hero", words: expect.stringContaining("waddles after Pip") });
    expect(campFriendMoment(state, 2)).toMatchObject({ friendId: "bun", heroId: "friend:duckling", words: expect.stringContaining("Duckling") });
  });
  it("never follows a sleeping, away, removed, or ready hero", () => {
    for (const next of [
      { ...state, campMoment: { ...state.campMoment!, inTent: ["hero"] } },
      { ...state, removed: [member.playerId] },
      { ...state, party: [{ ...member, connected: false }] },
      { ...state, party: [{ ...member, ready: true }] },
    ]) expect(campFriendMoment(next, 1)).toBeNull();
    expect(campFriendMoment({ ...state, campMoment: { ...state.campMoment!, inTent: ["hero"] } }, 2)?.heroId).toBe("friend:duckling");
  });
  it("uses different musical reactions for each friend and instrument", () => {
    const bun = campMusicReaction(state, "bells", "hero", 0);
    const duckling = campMusicReaction(state, "bells", "hero", 1);
    expect(bun?.words).toContain("ribbon");
    expect(duckling?.words).toContain("feet");
    expect(campMusicReaction(state, "pot", "hero", 0)?.words).not.toBe(bun?.words);
    expect(campMusicReaction(state, "log", "missing")).toBeNull();
    expect(friendTrait("unknown")).toBeTruthy();
  });
  it("gives every catalog friend distinct instrument reactions and a personal trait", () => {
    for (const { id, name, figure } of catalog.friends) {
      const card = { id, name, figure };
      const next = { ...state, campMoment: { ...state.campMoment!, friends: { rotation: [card.id], out: [card.id], cards: [card] } } };
      const words = (["log", "pot", "bells"] as const).map(instrument => campMusicReaction(next, instrument, "hero")?.words);
      expect(new Set(words).size, card.id).toBe(3);
      expect(friendTrait(card.id), card.id).not.toBe(friendTrait("unknown"));
    }
    const { id, name, figure } = catalog.friends.find(card => card.id === "harbor_gull")!;
    const gull = { id, name, figure };
    const next = { ...state, campMoment: { ...state.campMoment!, friends: { rotation: [gull.id, "bun"], out: [gull.id, "bun"], cards: [gull, state.campMoment!.friends!.cards[0]!] } } };
    expect(campFriendMoment(next, 2)?.words).toContain("shows a shiny pebble to");
  });
  it("has no ambient activity outside outdoor downtime or with no friends out", () => {
    expect(campFriendMoment({ ...state, phase: "scene", sceneType: "story" }, 0)).toBeNull();
    expect(campFriendMoment({ ...state, campMoment: { ...state.campMoment!, outdoor: false } }, 0)).toBeNull();
    expect(campFriendMoment({ ...state, campMoment: undefined }, 0)).toBeNull();
    expect(campMusicReaction({ ...state, phase: "scene", sceneType: "story" }, "log", "hero")).toBeNull();
  });
});
