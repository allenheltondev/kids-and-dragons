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

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Chapter, PartyMember, RunState } from "@kad/shared";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { StaticStage } from "./StaticStage";
import { campShownFor, indoorRest, outdoorRest } from "./lobby-camp";
import { PACKED_BEHIND, PACKED_HEIGHT_WIDTH, PACKED_SIDE, PACKED_SLOT_WIDTH, packedCampKey, packedCampSpots, packedKits } from "./packed-camp";
import { CAMP_KIT_STYLES } from "./camp-kit-art";

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

  it("sets each hero's bedroll and pack down beside her, in her own kit", () => {
    const state = { ...rest(false), kits: { c_1: { revision: 1, style: "quilted", tent: null, color: null, slots: [], unlocked: [] } } } as RunState;
    mount(state, chapter("red_sky_foothills", "indoor"));
    const bedrolls = document.querySelectorAll('[data-testid="packed-bedroll"]');
    expect(bedrolls).toHaveLength(2);
    expect(bedrolls[0]!.querySelector("[data-camp-kit]")!.getAttribute("data-camp-kit")).toBe("quilted");
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
    expect(friends[1]!.x).toBeGreaterThan(800 + 400 * (PACKED_SIDE + PACKED_SLOT_WIDTH / 2));
    expect(friends[2]!.x).toBeLessThan(friends[0]!.x);
    expect(packedCampSpots([], 400, [{ id: "f1" }]).friends).toEqual([]);
  });

  it("reads each seated hero's kit, skipping anyone taken out of the table", () => {
    const state = { ...rest(false, [member(1), member(2), member(3)]), removed: ["p_2"] } as RunState;
    const kits = packedKits(state);
    expect(kits.map((k) => k.id)).toEqual(["c_1", "c_3"]);
    for (const kit of kits) expect(Object.keys(CAMP_KIT_STYLES)).toContain(kit.style);
    expect(packedCampKey(state)).not.toBe("");
    expect(packedCampKey(rest(true))).toBe("");
  });
});
