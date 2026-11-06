// @vitest-environment jsdom
/**
 * The camp at a rest scene (docs/camp.md §3.2, §13.1, #625), both views:
 *
 *   - outdoors, the shared screen shows the full camp, on the chapter's own
 *     terrain's backdrop;
 *   - indoors, it never shows the campsite backdrop, a tent or a campfire:
 *     the scene keeps its own picture, and each hero's bedroll and pack is set
 *     down beside her (packed-camp.ts).
 *
 * Against the still stage (StaticStage), which reads the same state the moving
 * one does, and the pure pieces both stages share.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { Chapter, PartyMember, RunState } from "@kad/shared";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { StaticStage } from "./StaticStage";
import { campShownFor, indoorRest, outdoorRest } from "./lobby-camp";
import { PACKED_BEHIND, PACKED_HEIGHT_WIDTH, PACKED_SIDE, PACKED_SLOT_WIDTH, packedCampKey, packedCampSpots, packedFriends, packedKits } from "./packed-camp";
import { CAMP_KIT_STYLES } from "./camp-kit-art";
import { campFriendFigures, friendHeightCm } from "./camp-friends";
import { TAP_GAP_S, WORDS_S } from "./camp-taps";
import catalog from "../../../../content/camp.json";

const CARDS = (catalog.friends as { id: string; name: string; figure: string; size?: "small" | "medium" | "large" }[]).map(({ id, name, figure, size }) => ({ id, name, figure, ...(size ? { size } : {}) }));
/** A rest with friends out (#624), as the server sends it: buddies first, at most four. */
function withFriends(state: RunState, out: string[]): RunState {
  return { ...state, campMoment: { ...state.campMoment!, friends: { rotation: out, out, cards: CARDS } } } as RunState;
}

function member(n: number, overrides: Partial<PartyMember> = {}): PartyMember {
  return makeMember({
    character: makeCharacter({ id: `c_${n}`, ownerPlayerId: `p_${n}`, species: "griffin", name: `Hero ${String(n)}` }),
    playerId: `p_${n}`,
    ...overrides,
  });
}

const chapter = (biome: string, setting: "indoor" | "outdoor"): Chapter =>
  ({
    id: "ch",
    campaignId: "c",
    index: 1,
    title: "A chapter",
    biome,
    estimatedMinutes: 30,
    xpAward: 100,
    entry: "camp",
    scenes: { camp: { type: "rest", setting, art: "scenes/riftlight/wyrm-nest", narration: "Rest.", choices: [] } },
  }) as unknown as Chapter;

function rest(outdoor: boolean, party: PartyMember[] = [member(1), member(2)]): RunState {
  return makeState({
    phase: "scene",
    sceneType: "rest",
    sceneId: "camp",
    chapterId: "ch",
    party,
    campMoment: { id: "rest:camp|r:ch:3", kind: "rest", outdoor, changes: {} },
    camp: { frameStage: 2, placed: {}, owned: {}, dashCash: 0, trophies: [], revision: 0 } as unknown as RunState["camp"],
  });
}

function mount(state: RunState, ch: Chapter) {
  useGameStore.setState({ state, chapter: ch });
  return render(<StaticStage />);
}

afterEach(cleanup);

describe("which rests show the full camp", () => {
  it("is the outdoor ones, and only once the server has said so", () => {
    expect(outdoorRest(rest(true))).toBe(true);
    expect(campShownFor(rest(true), false)).toBe(true);
    expect(outdoorRest(rest(false))).toBe(false);
    expect(indoorRest(rest(false))).toBe(true);
    expect(campShownFor(rest(false), false)).toBe(false);
    // A rest whose moment has not arrived yet is packed down, never the campsite.
    const unsaid = { ...rest(true), campMoment: undefined };
    expect(campShownFor(unsaid, false)).toBe(false);
    expect(indoorRest(unsaid)).toBe(true);
    // A story scene is neither.
    const story = makeState({ phase: "scene", sceneType: "story" });
    expect(outdoorRest(story)).toBe(false);
    expect(indoorRest(story)).toBe(false);
  });
});

describe("an outdoor rest on the still stage", () => {
  it("is the full camp, on the chapter's terrain's backdrop", () => {
    mount(rest(true), chapter("glacier_of_origins", "outdoor"));
    const backdrop = document.querySelector<HTMLImageElement>(".kad-static-camp__backdrop")!;
    expect(backdrop.getAttribute("src")).toBe("/assets/camp/backdrops/frozen_north.webp");
    expect(document.querySelectorAll(".kad-static-camp__hero")).toHaveLength(2);
  });

  it("falls back to the plains camp in a terrain not painted yet", () => {
    mount(rest(true), chapter("sallow_wastelands", "outdoor"));
    expect(document.querySelector(".kad-static-camp__backdrop")!.getAttribute("src")).toBe("/assets/camp/backdrops/open_plains.webp");
  });
});

describe("an indoor rest on the still stage", () => {
  it("keeps the scene's own picture, with no campsite backdrop, tent or campfire", () => {
    mount(rest(false), chapter("glacier_of_origins", "indoor"));
    expect(document.querySelector(".kad-static-camp")).toBeNull();
    expect(document.querySelector(".kad-static-camp__backdrop")).toBeNull();
    expect(document.querySelector('[data-piece^="tent"]')).toBeNull();
    expect(document.querySelector('[data-piece="campfire"]')).toBeNull();
    expect(document.querySelector('[data-piece="cookfire"]')).toBeNull();
    const backdrop = document.querySelector<HTMLImageElement>(".kad-static-stage__backdrop")!;
    expect(backdrop.getAttribute("src")).toContain("scenes/riftlight/wyrm-nest");
    expect(backdrop.getAttribute("src")).not.toContain("camp/backdrops");
  });

  it("sets each hero's bedroll down beside her, rolled up whatever style she picked", () => {
    const state = { ...rest(false), kits: { c_1: { revision: 1, style: "quilted", tent: null, color: null, slots: [], unlocked: [] } } } as RunState;
    mount(state, chapter("red_sky_foothills", "indoor"));
    const bedrolls = document.querySelectorAll('[data-testid="packed-bedroll"]');
    expect(bedrolls).toHaveLength(2);
    // Her kit says quilted, but indoors nobody sleeps in it: it stays rolled up beside her pack.
    expect(bedrolls[0]!.querySelector("[data-camp-kit]")!.getAttribute("data-camp-kit")).toBe("rolled");
  });

  it("sits the friends out at the row's two ends, left first, each as tall as it truly is beside the heroes (#624)", () => {
    const out = ["bun", "duckling", "kid_goat"];
    mount(withFriends(rest(false), out), chapter("red_sky_foothills", "indoor"));
    const row = document.querySelector(".kad-static-stage__row--party")!;
    const items = [...row.children];
    const kinds = items.map((li) => (li.getAttribute("data-testid") === "packed-friend" ? "friend" : "hero"));
    // Left end: the third friend outermost, then the first; right end: the second.
    expect(kinds).toEqual(["friend", "friend", "hero", "hero", "friend"]);
    const srcs = items.filter((li) => li.getAttribute("data-testid") === "packed-friend").map((li) => li.querySelector("img")!.getAttribute("src"));
    const url = (id: string) => campFriendFigures(withFriends(rest(false), [id]))[0]!.url;
    expect(srcs).toEqual([url("kid_goat"), url("bun"), url("duckling")]);
    // Turned to face the row on the left; and smaller than the griffins they sit beside.
    expect(items[0]!.className).toContain("is-turned");
    expect(items[4]!.className).not.toContain("is-turned");
    for (const li of [items[0]!, items[1]!, items[4]!]) {
      const size = Number(/calc\(([\d.]+)cqh\)/.exec(li.querySelector("img")!.getAttribute("style") ?? "")?.[1]);
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(26);
    }
  });

  it("draws no friend at an indoor rest when none is out", () => {
    mount(rest(false), chapter("red_sky_foothills", "indoor"));
    expect(document.querySelectorAll('[data-testid="packed-friend"]')).toHaveLength(0);
  });
});

describe("an outdoor rest's friends", () => {
  it("stand at their friend spots in the full camp, as in the lobby (#624)", () => {
    mount(withFriends(rest(true), ["bun", "duckling"]), chapter("glacier_of_origins", "outdoor"));
    const friends = [...document.querySelectorAll(".kad-static-camp [data-friend]")].map((el) => el.getAttribute("data-friend"));
    expect(friends).toEqual(["friend:bun", "friend:duckling"]);
    expect(document.querySelectorAll('[data-testid="packed-friend"]')).toHaveLength(0);
  });
});

describe("the packed camp's one lane (packed-camp.ts)", () => {
  const heroes = [
    { id: "a", x: 400, y: 792, height: 500 },
    { id: "b", x: 800, y: 819, height: 200 },
  ];

  it("lies each bedroll on her side, a step behind her feet, no wider than her slot leaves or she is tall", () => {
    const { bedrolls } = packedCampSpots(heroes, 400);
    expect(bedrolls.map((b) => b.id)).toEqual(["a", "b"]);
    expect(bedrolls[0]).toMatchObject({ x: 400 + 400 * PACKED_SIDE, y: 792 - PACKED_BEHIND, width: 400 * PACKED_SLOT_WIDTH, mirrored: false });
    expect(bedrolls[1]).toMatchObject({ x: 800 + 400 * PACKED_SIDE, y: 819 - PACKED_BEHIND, width: 200 * PACKED_HEIGHT_WIDTH, mirrored: true });
    // Never past the next hero's own middle.
    expect(bedrolls[0]!.x + bedrolls[0]!.width / 2).toBeLessThan(heroes[1]!.x);
  });

  it("keeps a spot for each friend at the ends of the row (the seam for #624)", () => {
    const { friends } = packedCampSpots(heroes, 400, [{ id: "f1" }, { id: "f2" }, { id: "f3" }]);
    expect(friends.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    expect(friends[0]!.x).toBeLessThan(400);
    // Clear of the last bedroll as it is drawn.
    const { bedrolls } = packedCampSpots(heroes, 400);
    expect(friends[1]!.x - friends[1]!.width / 2).toBeGreaterThan(bedrolls[1]!.x + bedrolls[1]!.width / 2);
    expect(friends[2]!.x).toBeLessThan(friends[0]!.x);
    expect(packedCampSpots([], 400, [{ id: "f1" }]).friends).toEqual([]);
    // Turned to face the row from the left end.
    expect(friends.map((f) => f.mirrored)).toEqual([true, false, true]);
  });

  it("keeps each friend wholly inside the shown stage, and the outer ones clear of the inner", () => {
    const four = [{ id: "f1", width: 120 }, { id: "f2", width: 120 }, { id: "f3", width: 120 }, { id: "f4", width: 120 }];
    const bounds = { left: 100, right: 1300 };
    const { friends } = packedCampSpots(heroes, 400, four, bounds);
    for (const f of friends) {
      expect(f.x - f.width / 2).toBeGreaterThanOrEqual(bounds.left);
      expect(f.x + f.width / 2).toBeLessThanOrEqual(bounds.right);
      expect(f.width).toBe(120);
    }
    // With room on both sides, the outer friend on each stands beyond the inner, not over it.
    const roomy = packedCampSpots(heroes, 400, four, { left: 0, right: 1600 }).friends;
    expect(roomy[2]!.x + roomy[2]!.width / 2).toBeLessThanOrEqual(roomy[0]!.x - roomy[0]!.width / 2);
    expect(roomy[3]!.x - roomy[3]!.width / 2).toBeGreaterThanOrEqual(roomy[1]!.x + roomy[1]!.width / 2);
    // A full end sends the next friend to the other: here the right end has room for one.
    const lopsided = packedCampSpots(heroes, 400, four, { left: -400, right: 1290 }).friends;
    expect(lopsided.map((f) => f.mirrored)).toEqual([true, false, true, true]);
    const lefts = lopsided.filter((f) => f.mirrored).sort((a, b) => a.x - b.x);
    for (let i = 1; i < lefts.length; i++) expect(lefts[i - 1]!.x + lefts[i - 1]!.width / 2).toBeLessThanOrEqual(lefts[i]!.x - lefts[i]!.width / 2);
  });

  it("seats the lobby camp's friends out, at their true heights, only at an indoor rest", () => {
    const state = withFriends(rest(false), ["kid_goat", "bun", "mosshorn", "duckling"]);
    const friends = packedFriends(state);
    // In the server's order (buddies first).
    expect(friends.map((f) => f.id)).toEqual(["kid_goat", "bun", "mosshorn", "duckling"]);
    for (const f of friends) expect(f.heightCm).toBe(friendHeightCm(CARDS.find((c) => c.id === f.id)!));
    expect(packedFriends(withFriends(rest(true), ["bun"]))).toEqual([]);
    expect(packedFriends(rest(false))).toEqual([]);
    // A friend coming out redraws the packed camp.
    expect(packedCampKey(state)).not.toBe(packedCampKey(rest(false)));
  });

  it("reads each seated hero's kit, skipping anyone taken out of the table", () => {
    const state = { ...rest(false, [member(1), member(2), member(3)]), removed: ["p_2"] } as RunState;
    const kits = packedKits(state);
    expect(kits.map((k) => k.id)).toEqual(["c_1", "c_3"]);
    // Indoors nobody sleeps in it: every hero's bedroll is rolled up beside her pack, whatever style she picked.
    for (const kit of kits) expect(kit.style).toBe("rolled");
    expect(packedCampKey(state)).not.toBe("");
    expect(packedCampKey(rest(true))).toBe("");
  });
});

describe("a friend tapped on a phone, on the still stage (#624)", () => {
  let key = 0;
  const hear = (friendId: string, words: string, heroId = "c_1"): void =>
    act(() => {
      useGameStore.setState({ friendTaps: [...useGameStore.getState().friendTaps, { key: ++key, friendId, heroId, words }] });
    });
  const said = (): (string | null)[] => [...document.querySelectorAll('[data-testid="friend-words"]')].map((el) => el.textContent);

  it("indoors, says its words over its head in the packed row for WORDS_S, holding one more tap, and takes every tap off the store", () => {
    vi.useFakeTimers();
    try {
      mount(withFriends(rest(false), ["bun", "duckling"]), chapter("red_sky_foothills", "indoor"));
      hear("bun", "Bun nibbles your sleeve. That means hello in goat.");
      hear("bun", "Bun leans on you.", "c_2");
      hear("bun", "Bun again.", "c_1");
      expect(useGameStore.getState().friendTaps).toEqual([]);
      const words = document.querySelector('[data-testid="friend-words"]')!;
      expect(words.closest('[data-testid="packed-friend"]')!.querySelector("img")!.getAttribute("src")).toBe(campFriendFigures(withFriends(rest(false), ["bun"]))[0]!.url);
      expect(said()).toEqual(["Bun nibbles your sleeve. That means hello in goat."]);
      act(() => void vi.advanceTimersByTime(WORDS_S * 1000 + 50));
      expect(said()).toEqual([]);
      // The held one, after the friend's rest; the third was dropped.
      act(() => void vi.advanceTimersByTime(TAP_GAP_S * 1000 + 50));
      expect(said()).toEqual(["Bun leans on you."]);
      act(() => void vi.advanceTimersByTime(WORDS_S * 1000 + TAP_GAP_S * 1000 + 100));
      expect(said()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("outdoors, over the friend in the full still camp", () => {
    mount(withFriends(rest(true), ["bun", "duckling"]), chapter("glacier_of_origins", "outdoor"));
    hear("duckling", "Peep!");
    const words = document.querySelector('[data-testid="friend-words"]')!;
    expect(words.textContent).toBe("Peep!");
    expect(words.closest("[data-friend]")!.getAttribute("data-friend")).toBe("friend:duckling");
  });

  it("drops a tap for a friend it does not show", () => {
    mount(withFriends(rest(false), ["bun"]), chapter("red_sky_foothills", "indoor"));
    hear("mosshorn", "Hm.");
    expect(said()).toEqual([]);
    expect(useGameStore.getState().friendTaps).toEqual([]);
  });
});
