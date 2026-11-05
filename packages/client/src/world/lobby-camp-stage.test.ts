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
import { bunSettlePose } from "./camp-motion";

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
  it("settles befriended Bun at the same fireside spot across state updates", () => {
    const { lobby, app } = table();
    const state = lobbyWith([]);
    lobby.sync(state);
    expect(lobby.camp()!.figures()).toEqual([]);

    const withBun: RunState = {
      ...state,
      camp: { revision: 1, frameStage: 1, grownBy: [], dashCash: 0, owned: [], placed: {}, friends: ["bun"], buddies: {}, shopOpen: false },
    };
    lobby.sync(withBun);
    run(app, 2);
    const bun = () => lobby.camp()!.figures().find((figure) => figure.id === "friend:bun");
    expect(bun()).toMatchObject({ point: "campfire-w", walking: false });

    lobby.sync({ ...withBun, visited: ["next"] });
    run(app, 30);
    expect(bun()).toMatchObject({ point: "campfire-w", walking: false });
    lobby.destroy();
  });

  it("shakes only on arrival and settles immediately with reduced motion", () => {
    expect(bunSettlePose(0.42, false).lean).toBeGreaterThan(0);
    expect(bunSettlePose(0.55, false).lean).toBeLessThan(0);
    expect(bunSettlePose(20, false)).toMatchObject({ lean: 0, low: 0.09 });
    expect(bunSettlePose(0.42, true)).toMatchObject({ lean: 0, low: 0.09 });
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
