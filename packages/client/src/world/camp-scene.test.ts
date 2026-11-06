/**
 * What the camp shows, read off the run state (#620, docs/camp.md §4.3, §4.5,
 * §12.5): the frame's own pieces, the crew's picks, trophies and the banner's
 * name; what was found or bought this chapter waiting beside the fire with
 * its spot lit, and never put up over a kid's pick; and each hero's kit as
 * stored, or exactly as before when nothing is.
 */

import { describe, expect, it } from "vitest";
import type { CampMoment, CampView, PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { campBeside, campSpots, kitLook, spotOptions, tentArt, waitingPieces } from "./camp-scene";
import { campDressing, campHeroes, campLayoutFor } from "./lobby-camp";
import { campKitStyle } from "./camp-kit-art";

const stage2 = campLayoutFor(2)!;
const stage1 = campLayoutFor(1)!;

const camp = (over: Partial<CampView> = {}): CampView => ({
  revision: 3,
  frameStage: 2,
  grownBy: ["gemfall"],
  dashCash: 4,
  owned: [],
  placed: {},
  friends: [],
  shopOpen: true,
  ...over,
});

const chapterEnd: CampMoment = { id: "chapterEnd|r:ch:9", kind: "chapterEnd", outdoor: true, changes: {} };

describe("the shared hotspots (§4.2, §4.3)", () => {
  it("show the frame's own pieces, the crew's picks, a trophy per finished campaign and the crew's name", () => {
    const spots = campSpots(stage2, camp({ placed: { awning: "shop_striped_awning" }, owned: ["shop_striped_awning"] }), { crewName: "The Otter Crew" });
    const by = new Map(spots.map((s) => [s.id, s]));
    expect(by.get("cookfire")?.pieceId).toBe("cookfire_pot");
    expect(by.get("banner_pole")).toMatchObject({ pieceId: "kept_crew_banner", banner: "The Otter Crew" });
    expect(by.get("awning")).toMatchObject({ pieceId: "shop_striped_awning", label: "Striped awning", pickable: true });
    expect(by.get("lanterns")?.pieceId).toBeNull();
    expect(by.get("trophy_1")).toMatchObject({ pieceId: "trophy_gemfall", label: "Gemfall trophy", pickable: false });
    expect(by.get("trophy_2")?.pieceId).toBeNull();
  });

  it("offer only owned pieces of the spot's kind, and the frame's own; never a kit piece", () => {
    const view = camp({ owned: ["shop_striped_awning", "shop_lantern_string", "shop_weathervane_pole"] });
    expect(spotOptions({ id: "awning", kind: "awning" }, stage2, view)).toEqual(["shop_striped_awning"]);
    expect(spotOptions({ id: "banner_pole", kind: "banner_pole" }, stage2, view)).toEqual(["kept_crew_banner", "shop_weathervane_pole"]);
    expect(spotOptions({ id: "trophy_1", kind: "trophy" }, stage2, view)).toEqual([]);
    expect(spotOptions({ id: "awning", kind: "awning" }, stage2, camp({ owned: ["deco_bunting"] }))).toEqual([]);
  });

  it("keep what a stage-1 camp owns for later, with the stage that has a spot for it", () => {
    expect(waitingPieces(stage1, camp({ frameStage: 1, owned: ["shop_striped_awning"] }))).toEqual([{ pieceId: "shop_striped_awning", label: "Striped awning", stage: 2 }]);
    expect(waitingPieces(stage2, camp({ owned: ["shop_striped_awning"] }))).toEqual([]);
  });

  it("have a stage-1 spot for the first finds, the crew banner and every starter piece but the awnings", () => {
    const early = ["kept_crew_banner", "find_picnic_blanket", "find_wagon_lantern", "find_noodle_awning", "shop_lantern_string", "shop_striped_awning", "shop_log_bench", "shop_pinwheel_pole"];
    const view = camp({ frameStage: 1, grownBy: [], owned: early });
    // Only an awning waits, with its note: stage 1 has no awning (docs/camp.md §11).
    expect(waitingPieces(stage1, view).map((w) => [w.pieceId, w.stage])).toEqual([["find_noodle_awning", 2], ["shop_striped_awning", 2]]);
    const spots = campSpots(stage1, view, { crewName: "The Otter Crew" });
    expect(spots.map((s) => s.id).sort()).toEqual(["banner_pole", "friends_corner", "lanterns"]);
    expect(spots.find((s) => s.id === "banner_pole")).toMatchObject({ pieceId: "kept_crew_banner", banner: "The Otter Crew" });
    expect(spotOptions({ id: "lanterns", kind: "lanterns" }, stage1, view)).toEqual(["find_wagon_lantern", "shop_lantern_string"]);
    expect(spotOptions({ id: "friends_corner", kind: "friends_corner" }, stage1, view)).toEqual(["find_picnic_blanket", "shop_log_bench"]);
    expect(spotOptions({ id: "banner_pole", kind: "banner_pole" }, stage1, view)).toEqual(["kept_crew_banner", "shop_pinwheel_pole"]);
  });
});

describe("the chapter end's finds beside the campfire (§5.3, §12.5)", () => {
  const state = (over: Partial<RunState>): Pick<RunState, "campMoment" | "campFinds" | "campShop" | "camp"> => ({
    campMoment: chapterEnd,
    campFinds: [{ kind: "camp", pieceId: "find_noodle_awning", rewardId: "riftlight-exchange-rift.noodle_awning", sceneId: "s" }],
    camp: camp({ owned: ["find_noodle_awning", "shop_striped_awning"], placed: { awning: "shop_striped_awning" } }),
    ...over,
  });

  it("lists what was found this chapter, its spot lit, and never puts it up over a kid's pick", () => {
    const s = state({});
    expect(campBeside(s, stage2)).toEqual([
      { pieceId: "find_noodle_awning", label: "Noodle awning", path: "camp/pieces/find-noodle-awning.png", heightCm: 175, widthCm: 207, hotspotId: "awning", waitsForStage: null },
    ]);
    const dressing = campDressing({ ...s, crew: undefined, crews: undefined, firstCrewName: undefined } as RunState, stage2);
    const awning = dressing.spots.find((spot) => spot.id === "awning")!;
    // The kid's striped awning stays up; the find waits beside the fire, its spot lit.
    expect(awning).toMatchObject({ pieceId: "shop_striped_awning", highlighted: true });
    expect(dressing.beside.map((b) => b.pieceId)).toEqual(["find_noodle_awning"]);
  });

  it("lists what the shop bought on this visit, and stops listing a piece once a kid puts it up", () => {
    const bought = state({
      campFinds: [],
      campShop: { visit: "v", balance: 0, options: [], votes: {}, result: { kind: "bought", pieceId: "shop_weathervane_pole", label: "Weathervane pole" } },
      camp: camp({ owned: ["shop_weathervane_pole"] }),
    });
    expect(campBeside(bought, stage2).map((b) => [b.pieceId, b.hotspotId])).toEqual([["shop_weathervane_pole", "banner_pole"]]);
    const placed = { ...bought, camp: camp({ owned: ["shop_weathervane_pole"], placed: { banner_pole: "shop_weathervane_pole" } }) };
    expect(campBeside(placed, stage2)).toEqual([]);
  });

  it("says when a find's spot comes, at a camp that has none yet", () => {
    const s = state({ camp: camp({ frameStage: 1, grownBy: [], owned: ["find_noodle_awning"] }) });
    expect(campBeside(s, stage1)).toMatchObject([{ pieceId: "find_noodle_awning", hotspotId: null, waitsForStage: 2 }]);
  });

  it("lights a first find's own spot at a stage-1 camp", () => {
    const s = state({
      campFinds: [{ kind: "camp", pieceId: "find_wagon_lantern", rewardId: "gemfall-01.wagon_lantern", sceneId: "s" }],
      camp: camp({ frameStage: 1, grownBy: [], owned: ["find_wagon_lantern"] }),
    });
    expect(campBeside(s, stage1)).toMatchObject([{ pieceId: "find_wagon_lantern", hotspotId: "lanterns", waitsForStage: null }]);
    const dressing = campDressing({ ...s, crew: undefined, crews: undefined, firstCrewName: undefined } as RunState, stage1);
    expect(dressing.spots.find((spot) => spot.id === "lanterns")).toMatchObject({ pieceId: null, highlighted: true });
  });

  it("lists nothing outside the chapter's end", () => {
    expect(campBeside(state({ campMoment: { ...chapterEnd, id: "lobby|x", kind: "lobby" } }), stage2)).toEqual([]);
  });
});

describe("each hero's kit as the camp draws it (§4.5)", () => {
  const hero = (id: string): PartyMember => ({
    playerId: `p_${id}`,
    hp: 10,
    down: false,
    connected: true,
    ready: false,
    character: { id, name: id, species: "unicorn", tier: "fledgling", class: "songkeeper", appearance: { palette: "meadow", accent: "#7FD4C1" }, souvenirs: [{ id: "s", fromRun: "r", earnedAt: "t" }] } as unknown as ResolvedCharacter,
  });

  it("feeds her stored style, tent, color and decorations into her figure", () => {
    const [figure] = campHeroes({
      party: [hero("c_1")],
      kits: { c_1: { revision: 2, style: "patched", tent: "quilted", color: "rose", slots: ["deco_bunting", null], unlocked: [] } },
    }).map((h) => h.figure);
    expect(figure).toMatchObject({ kitStyle: "patched", tent: "quilted", accent: "#70E09F", slots: ["deco_bunting", null], souvenirs: 1, name: "c_1" });
    // The stored style beats her id's hash.
    expect(campKitStyle("c_1", figure!.kitStyle)).toBe("patched");
  });

  it("draws a hero with no stored kit exactly as before: her accent, and her id's hash", () => {
    const [figure] = campHeroes({ party: [hero("c_9")] }).map((h) => h.figure);
    expect(figure).toMatchObject({ kitStyle: null, tent: null, accent: "#7FD4C1" });
    expect(campKitStyle("c_9", figure!.kitStyle)).toBe(campKitStyle("c_9"));
    expect(kitLook(undefined, "#123456")).toEqual({ style: null, tent: null, accent: "#123456", slots: [] });
  });

  it("pitches her own tent, or her bedroll style's, or the rolled one", () => {
    expect(tentArt("sworn", "rolled")?.id).toBe("sworn");
    expect(tentArt(null, "quilted")?.id).toBe("quilted");
    expect(tentArt("nonsense", "nonsense")?.id).toBe("rolled");
  });
});
