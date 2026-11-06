// @vitest-environment jsdom
/**
 * The lobby's camp on the stage (#614), against the fake stage: it is up only
 * in the lobby, it acts out what the state says, it never holds Begin up, and
 * it is gone cleanly once the lobby is.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { Application, Texture } from "pixi.js";
import type { PartyMember, RunState } from "@kad/shared";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { campLayoutFixture } from "../testing/camp-fixture";
import { fakeApp, installFakeCanvas2D, type FakeApp } from "../testing/fake-stage";
import { LEAVE_FADE_S, createLobbyCamp, type LobbyCamp } from "./lobby-camp-stage";
import { EDGE_MARGIN } from "./camp-framing";
import { NOMINAL_PAINT, paintAspect } from "./figure-scale";
import { bunSettlePose, ducklingSettlePose, mosshornLeafDrop } from "./camp-motion";

beforeAll(installFakeCanvas2D);

const layout = campLayoutFixture();
const noArt = (): Promise<Texture> => Promise.reject(new Error("no art in tests"));

function member(n: number, overrides: Partial<PartyMember> = {}): PartyMember {
  return makeMember({
    character: makeCharacter({ id: `c_${n}`, ownerPlayerId: `p_${n}`, species: "unicorn" }),
    playerId: `p_${n}`,
    ...overrides,
  });
}

function table(options: { still?: boolean } = {}): { lobby: LobbyCamp; app: FakeApp; covered: boolean[] } {
  const app = fakeApp();
  const covered: boolean[] = [];
  const lobby = createLobbyCamp(app as unknown as Application, layout, {
    cover: (on) => covered.push(on),
    still: options.still ?? false,
    loadTexture: noArt,
  });
  lobby.resize(1600, 900);
  return { lobby, app, covered };
}

const run = (app: FakeApp, seconds: number, each?: () => void): void => {
  for (let i = 0; i < Math.round((seconds * 1000) / 16); i++) {
    app.ticker.frame(16);
    each?.();
  }
};

const lobbyWith = (party: PartyMember[], phase: RunState["phase"] = "lobby"): RunState => makeState({ phase, party });

describe("the lobby's camp on the stage", () => {
  it("brings the friends out (#624) with their fireside habits (#651), each at its own friend spot across state updates", () => {
    const { lobby, app } = table();
    const state = lobbyWith([]);
    lobby.sync(state);
    expect(lobby.camp()!.figures()).toEqual([]);

    const cards = [
      { id: "bun", name: "Bun", figure: "cast/bun" },
      { id: "duckling", name: "Duckling", figure: "entities/duckling" },
      { id: "mosshorn", name: "Mosshorn", figure: "entities/mosshorn", size: "small" as const },
    ];
    const out = ["bun", "duckling", "mosshorn"];
    const withFriends: RunState = {
      ...state,
      camp: { revision: 1, frameStage: 1, grownBy: [], dashCash: 0, owned: [], placed: {}, friends: out, shopOpen: false },
      campMoment: { id: "lobby|r:-:0", kind: "lobby", outdoor: true, changes: {}, friends: { rotation: out, out, cards } },
    };
    lobby.sync(withFriends);
    run(app, 2);
    const friends = () => lobby.camp()!.figures().filter((figure) => figure.id.startsWith("friend:"));
    expect(friends().map((f) => f.id).sort()).toEqual(["friend:bun", "friend:duckling", "friend:mosshorn"]);
    const xs = friends().map((f) => Math.round(f.x));
    expect(new Set(xs).size).toBe(3);

    // A later reading of the same moment keeps everybody out; nobody is doubled or dropped.
    lobby.sync({ ...withFriends, visited: ["next"] });
    run(app, 30);
    expect(friends().map((f) => f.id).sort()).toEqual(["friend:bun", "friend:duckling", "friend:mosshorn"]);
    lobby.destroy();
  });

  it("shakes only on arrival and settles immediately with reduced motion", () => {
    expect(bunSettlePose(0.42, false).lean).toBeGreaterThan(0);
    expect(bunSettlePose(0.55, false).lean).toBeLessThan(0);
    expect(bunSettlePose(20, false)).toMatchObject({ lean: 0, low: 0.09 });
    expect(bunSettlePose(0.42, true)).toMatchObject({ lean: 0, low: 0.09 });
  });

  it("gives the duckling two opposing waddles and a settled pose", () => {
    expect(ducklingSettlePose(0.4, false).lean).toBeGreaterThan(0);
    expect(ducklingSettlePose(0.75, false).lean).toBeLessThan(0);
    expect(ducklingSettlePose(20, false)).toMatchObject({ lean: 0, lift: 0, low: 0.2 });
    expect(ducklingSettlePose(0.4, true)).toMatchObject({ lean: 0, lift: 0, low: 0.2 });
  });

  it("lets the mosshorn carry its leaf before dropping it once", () => {
    expect(mosshornLeafDrop(0.5, false)).toBe(0);
    expect(mosshornLeafDrop(1.075, false)).toBeCloseTo(0.5);
    expect(mosshornLeafDrop(10, false)).toBe(1);
    expect(mosshornLeafDrop(0, true)).toBe(1);
  });

  it("does not mount outside the lobby, nor before there is a state", () => {
    const { lobby, app, covered } = table();
    lobby.sync(null);
    for (const phase of ["scene", "check", "encounter", "chapter_complete"] as const) {
      lobby.sync(lobbyWith([member(1)], phase));
      expect(lobby.camp()).toBeNull();
    }
    expect(app.stage.children).toHaveLength(0);
    expect(covered).toEqual([]);
    lobby.destroy();
  });

  it("mounts in the lobby and in creation, over the scene, with every seated hero", () => {
    const { lobby, app, covered } = table();
    lobby.sync(lobbyWith([member(1), member(2)], "creation"));
    const camp = lobby.camp()!;
    expect(camp).not.toBeNull();
    expect(app.stage.children.at(-1)).toBe(camp.view);
    expect(covered).toEqual([true]);
    expect(camp.figures().map((f) => f.id).sort()).toEqual(["c_1", "c_2"]);
    lobby.destroy();
  });

  it("acts out the moments the state says: arrive, ready, away, back", () => {
    const { lobby, app } = table();
    lobby.sync(lobbyWith([member(1)]));
    run(app, 1);
    lobby.sync(lobbyWith([member(1), member(2)]));
    const camp = lobby.camp()!;
    expect(camp.figures().map((f) => f.id)).toContain("c_2");
    lobby.sync(lobbyWith([member(1, { ready: true }), member(2)]));
    run(app, 40);
    const t = layout.frame.trailhead;
    // At the trailhead, moved in from the screen's edge far enough to be seen whole.
    const hero = camp.figures().find((f) => f.id === "c_1")!;
    const half = (hero.heightPx * paintAspect(NOMINAL_PAINT)) / 2 / layout.canvas.width;
    expect(hero.x).toBeCloseTo(Math.min(t.x, 1 - half - EDGE_MARGIN) * layout.canvas.width);
    lobby.sync(lobbyWith([member(1, { ready: true }), member(2, { connected: false })]));
    run(app, 20);
    expect(camp.figures().find((f) => f.id === "c_2")!.alpha).toBeCloseTo(0.5, 1);
    lobby.sync(lobbyWith([member(1, { ready: true }), member(2)]));
    run(app, 3);
    expect(camp.figures().find((f) => f.id === "c_2")!.alpha).toBeGreaterThan(0.95);
    lobby.destroy();
  });

  it("never holds Begin up: the scene is uncovered in the same call, while the crew walks off and fades", () => {
    const { lobby, app, covered } = table();
    const party = [member(1, { ready: true }), member(2, { ready: true })];
    lobby.sync(lobbyWith(party));
    run(app, 2);
    const camp = lobby.camp()!;
    lobby.sync(lobbyWith(party, "scene"));
    // Synchronously: the story is drawn from this frame on, and the camp is no longer the lobby's.
    expect(covered.at(-1)).toBe(false);
    expect(lobby.camp()).toBeNull();
    expect(lobby.leaving()).toBe(camp);
    // The crew sets off down the trail as it fades.
    let walked = false;
    run(app, LEAVE_FADE_S * 0.9, () => {
      if (camp.figures().some((f) => f.walking)) walked = true;
    });
    expect(walked).toBe(true);
    expect(camp.view.alpha).toBeLessThan(0.2);
    run(app, LEAVE_FADE_S * 0.2);
    // Gone, and its ticker with it: only the controller's own is left.
    expect(lobby.leaving()).toBeNull();
    expect(camp.view.destroyed).toBe(true);
    expect(app.ticker.count).toBe(1);
    lobby.destroy();
    expect(app.ticker.count).toBe(0);
  });

  it("drops a fading camp at once when the lobby comes back", () => {
    const { lobby, app } = table();
    lobby.sync(lobbyWith([member(1)]));
    const first = lobby.camp()!;
    lobby.sync(lobbyWith([member(1)], "scene"));
    run(app, 0.2);
    lobby.sync(lobbyWith([member(1)]));
    expect(first.view.destroyed).toBe(true);
    expect(lobby.camp()).not.toBe(first);
    expect(lobby.leaving()).toBeNull();
    lobby.destroy();
  });

  it("in reduced motion, nobody hops, a Ready is a fade into the line, and Begin is a fade", () => {
    const { lobby, app } = table({ still: true });
    lobby.sync(lobbyWith([member(1), member(2)]));
    const camp = lobby.camp()!;
    const check = () => {
      for (const f of camp.figures()) {
        expect(f.airborne).toBe(false);
        expect(f.walking).toBe(false);
      }
    };
    run(app, 10, check);
    lobby.sync(lobbyWith([member(1, { ready: true }), member(2)]));
    run(app, 5, check);
    lobby.sync(lobbyWith([member(1, { ready: true }), member(2)], "scene"));
    run(app, LEAVE_FADE_S + 0.2, check);
    expect(lobby.leaving()).toBeNull();
    lobby.destroy();
  });

  it("follows reduced motion turning on while the lobby is up", () => {
    const { lobby, app } = table();
    lobby.sync(lobbyWith([member(1)]));
    lobby.setStill(true);
    lobby.sync(lobbyWith([member(1, { ready: true })]));
    run(app, 5, () => {
      for (const f of lobby.camp()!.figures()) expect(f.airborne).toBe(false);
    });
    lobby.destroy();
  });

  it("keeps its frame when the lobby's panels report nothing, as they do going", () => {
    const { lobby, app } = table();
    lobby.sync(lobbyWith([member(1)]));
    const camp = lobby.camp()!;
    const full = camp.view.y;
    lobby.setInset(300, 80);
    run(app, 3);
    const before = { x: camp.view.x, y: camp.view.y, k: camp.view.scale.x };
    // Slid up to stand the camp in the window above the panels.
    expect(before.y).toBeLessThan(full);
    lobby.setInset(0, 0);
    run(app, 3);
    expect({ x: camp.view.x, y: camp.view.y, k: camp.view.scale.x }).toEqual(before);
    lobby.destroy();
  });
});

describe("the camp at a rest scene (docs/camp.md §3.2, #625)", () => {
  const rest = (outdoor: boolean | null, party: PartyMember[] = [member(1), member(2, { ready: true })]): RunState =>
    makeState({
      phase: "scene",
      sceneType: "rest",
      sceneId: "camp",
      party,
      ...(outdoor === null ? {} : { campMoment: { id: "rest:camp|r:c:4", kind: "rest", outdoor, changes: {} } }),
    });

  it("never pitches at an indoor rest, nor at a rest nobody has said is outdoors", () => {
    const { lobby, app, covered } = table();
    lobby.sync(rest(false));
    expect(lobby.camp()).toBeNull();
    lobby.sync(rest(null));
    expect(lobby.camp()).toBeNull();
    expect(app.stage.children).toHaveLength(0);
    expect(covered).toEqual([]);
    lobby.destroy();
  });

  it("crossfades the full camp in over the scene at an outdoor rest, covering it only once it is up", () => {
    const { lobby, app, covered } = table();
    lobby.sync(rest(true));
    const camp = lobby.camp()!;
    expect(camp).not.toBeNull();
    expect(camp.view.alpha).toBe(0);
    // The scene's own picture stays drawn under the camp as it comes up.
    expect(covered).toEqual([false]);
    run(app, 0.5);
    expect(camp.view.alpha).toBeGreaterThan(0);
    expect(camp.view.alpha).toBeLessThan(1);
    run(app, 1.5);
    expect(camp.view.alpha).toBe(1);
    expect(covered).toEqual([false, true]);
    expect(camp.figures().map((f) => f.id).sort()).toEqual(["c_1", "c_2"]);
    lobby.destroy();
  });

  it("does not line a resting hero up at the trailhead: Ready is the lobby's", () => {
    const { lobby, app } = table({ still: true });
    lobby.sync(rest(true));
    run(app, 3);
    const t = layout.frame.trailhead;
    // Member 2 is still marked ready from the lobby; at a rest she stays at her bedroll.
    const hero = lobby.camp()!.figures().find((f) => f.id === "c_2")!;
    expect(Math.abs(hero.x / layout.canvas.width - t.x)).toBeGreaterThan(0.1);
    lobby.destroy();
  });

  it("is up at once under reduced motion", () => {
    const { lobby, covered } = table({ still: true });
    lobby.sync(rest(true));
    expect(lobby.camp()!.view.alpha).toBe(1);
    expect(covered).toEqual([true]);
    lobby.destroy();
  });

  it("stands above the narration plate, not under the lobby's panels", () => {
    const { lobby, app } = table();
    lobby.setInset(120, 40);
    lobby.sync(rest(true));
    const camp = lobby.camp()!;
    run(app, 2);
    const atLobbyPanels = camp.view.y;
    lobby.setStageInset(420, 0);
    run(app, 3);
    // A taller plate than the lobby's panels: the camp slides up to stand above it.
    expect(camp.view.y).toBeLessThan(atLobbyPanels);
    lobby.destroy();
  });

  it("stands below the goal card, shrinking whole rather than reaching under it, where the lobby's camp keeps its feet in (#625)", () => {
    // A 1280 × 720 TV: the plate's 317px, and the goal card's foot 176px down, as measured there.
    const at = (lobby: LobbyCamp) => {
      const { window, fit } = lobby.camp()!.fitted()!;
      const H = layout.canvas.height;
      const { scale, x, y } = fit.framing;
      return { window, scale, x, top: y + fit.band.top * H * scale, bottom: y + fit.band.bottom * H * scale };
    };
    const { lobby, app } = table({ still: true });
    lobby.resize(1280, 720);
    lobby.sync(rest(true, [member(1), member(2), member(3), member(4)]));
    lobby.setStageInset(317, 176);
    run(app, 0.1);
    const rested = at(lobby);
    expect(rested.window).toEqual({ top: 176, bottom: 403 });
    // Every hero, tent and tall piece (the band) stands in the window: none under the card.
    expect(rested.top).toBeGreaterThanOrEqual(176 - 1e-6);
    expect(rested.bottom).toBeLessThanOrEqual(403 + 1e-6);
    // Drawn smaller than the pane's width to do it, centered, with the sides filled.
    expect(rested.scale).toBeLessThan(1280 / layout.canvas.width);
    expect(rested.x).toBeGreaterThan(0);
    expect(rested.x + layout.canvas.width * rested.scale).toBeCloseTo(1280 - rested.x);
    // A card that grows a line moves the window down with it.
    lobby.setStageInset(317, 206);
    run(app, 0.1);
    expect(at(lobby).window.top).toBe(206);
    expect(at(lobby).top).toBeGreaterThanOrEqual(206 - 1e-6);
    lobby.destroy();

    // The lobby's camp in the same window keeps covering the pane, its feet in and the heads past the top.
    const other = table({ still: true });
    other.lobby.resize(1280, 720);
    other.lobby.sync(lobbyWith([member(1), member(2), member(3), member(4)]));
    other.lobby.setInset(317, 176);
    const lobbied = at(other.lobby);
    expect(lobbied.scale).toBeCloseTo(1280 / layout.canvas.width);
    expect(lobbied.bottom).toBeCloseTo(403);
    expect(lobbied.top).toBeLessThan(176);
    other.lobby.destroy();
  });

  it("fades away on Go on, the next scene drawn under it, with nobody setting off", () => {
    const { lobby, app, covered } = table();
    lobby.sync(rest(true));
    run(app, 2);
    const camp = lobby.camp()!;
    lobby.sync(makeState({ phase: "scene", sceneType: "story", sceneId: "road", party: [member(1), member(2)] }));
    expect(lobby.camp()).toBeNull();
    expect(lobby.leaving()).toBe(camp);
    expect(covered.at(-1)).toBe(false);
    run(app, LEAVE_FADE_S + 0.5);
    expect(lobby.leaving()).toBeNull();
    lobby.destroy();
  });

  it("is pitched in the chapter's terrain, and anew when that chapter loads", () => {
    const families: string[] = [];
    const app = fakeApp();
    const lobby = createLobbyCamp(app as unknown as Application, layout, {
      still: true,
      loadTexture: noArt,
      layoutFor: (_stage, family) => {
        families.push(family);
        return family === "frozen_north" ? campLayoutFixture() : layout;
      },
    });
    const state = { ...rest(true), chapterId: "riftlight-wyrm-nest" };
    lobby.sync(state, null);
    const first = lobby.camp();
    expect(families.at(-1)).toBe("open_plains");
    lobby.sync(state, { id: "riftlight-wyrm-nest", biome: "glacier_of_origins" });
    expect(families.at(-1)).toBe("frozen_north");
    expect(lobby.camp()).not.toBe(first);
    lobby.destroy();
  });
});
