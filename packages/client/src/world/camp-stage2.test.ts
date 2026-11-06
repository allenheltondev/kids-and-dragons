// @vitest-environment jsdom
/**
 * Frame stage 2 on the stage (#620, docs/camp.md §4.1, §4.5, §12.6): the
 * crew's stored stage pitches a tent for each seat, each in its hero's color
 * and named while its painting is owed; the crew's pieces stand at their
 * hotspots; and the stage-up moment is short (never longer than the
 * transformation's beat) and holds nothing up, least of all "back to the lobby".
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Texture, type Application, type Container, type Sprite } from "pixi.js";
import type { CampView, PartyMember, RunState } from "@kad/shared";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { fakeApp, installFakeCanvas2D, type FakeApp } from "../testing/fake-stage";
import { PITCH_S, createCamp } from "./camp";
import { createLobbyCamp } from "./lobby-camp-stage";
import { campDressing, campLayoutFor, lobbyCampLayout } from "./lobby-camp";
import { setCampBeat } from "./camp-beat";
import { TRANSFORM_BEAT_MS } from "../screens/TransformCutscene";

beforeAll(installFakeCanvas2D);
afterEach(() => setCampBeat(false));

const noArt = (): Promise<Texture> => Promise.reject(new Error("not painted yet"));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function member(n: number): PartyMember {
  return makeMember({
    character: makeCharacter({ id: `c_${n}`, ownerPlayerId: `p_${n}`, species: "unicorn", name: `Hero ${String(n)}` }),
    playerId: `p_${n}`,
  });
}

const view = (over: Partial<CampView> = {}): CampView => ({
  revision: 1,
  frameStage: 2,
  grownBy: ["gemfall"],
  dashCash: 0,
  owned: ["shop_striped_awning"],
  placed: { awning: "shop_striped_awning" },
  friends: [],
  buddies: {},
  shopOpen: false,
  ...over,
});

const labels = (root: Container): string[] => {
  const out: string[] = [];
  const walk = (c: Container): void => {
    out.push(c.label);
    for (const child of c.children) walk(child as Container);
  };
  walk(root);
  return out;
};
const texts = (root: Container): string[] => {
  const out: string[] = [];
  const walk = (c: Container): void => {
    const text = (c as unknown as { text?: unknown }).text;
    if (typeof text === "string") out.push(text);
    for (const child of c.children) walk(child as Container);
  };
  walk(root);
  return out;
};

describe("frame stage 2", () => {
  it("pitches a tent for each seat, in its hero's color and named over it, while the tents are unpainted", async () => {
    const layout = campLayoutFor(2)!;
    expect(layout.frame.stage).toBe(2);
    const app = fakeApp();
    const camp = createCamp(app as unknown as Application, layout, { still: true, loadTexture: noArt });
    camp.resize(1600, 900);
    const state = makeState({ phase: "lobby", party: [member(1), member(2)] }) as RunState;
    camp.setFigures([
      { id: "c_1", url: null, heightCm: 160, stance: "standing", seat: 0, accent: "#E0C470", name: "Hero 1", tent: "quilted", slots: ["deco_bunting", null] },
      { id: "c_2", url: null, heightCm: 160, stance: "standing", seat: 1, accent: "#709FE0", name: "Hero 2" },
    ]);
    camp.setDressing(campDressing({ ...state, camp: view() }, layout));
    await settle();
    app.ticker.frame(16);
    const all = labels(camp.view);
    for (const seat of [0, 1, 2, 3]) expect(all).toContain(`piece:tent_${String(seat)}`);
    expect(all.filter((l) => l === "camp-stand-in:tent")).toHaveLength(4);
    // Her name over her tent; an empty seat's tent is pale and says nothing.
    expect(texts(camp.view)).toEqual(expect.arrayContaining(["Hero 1", "Hero 2"]));
    expect(texts(camp.view)).not.toContain("Tent");
    // Her one decoration hangs on her tent.
    expect(all.filter((l) => l === "camp-stand-in:decoration")).toHaveLength(1);
    // The crew's pieces at their spots, and its name on the banner.
    expect(all).toEqual(expect.arrayContaining(["dress:spot:awning", "dress:spot:cookfire", "dress:spot:banner_pole", "dress:spot:trophy_1"]));
    expect(texts(camp.view)).toEqual(expect.arrayContaining(["Striped awning", "Cookfire", "Gemfall trophy"]));
    camp.destroy();
  });

  it("is what the lobby pitches for a crew whose record says stage 2, and stage 1 otherwise", () => {
    const app = fakeApp();
    const lobby = createLobbyCamp(app as unknown as Application, lobbyCampLayout()!, { still: true, loadTexture: noArt, layoutFor: campLayoutFor });
    lobby.resize(1600, 900);
    lobby.sync({ ...makeState({ phase: "lobby", party: [member(1)] }), camp: view({ frameStage: 1, grownBy: [], placed: {} }) } as RunState);
    expect(labels(lobby.camp()!.view)).toContain("piece:bedroll_0");
    lobby.sync({ ...makeState({ phase: "lobby", party: [member(1)] }), camp: view() } as RunState);
    expect(labels(lobby.camp()!.view)).toContain("piece:tent_0");
    expect(labels(lobby.camp()!.view)).not.toContain("piece:bedroll_0");
    lobby.destroy();
  });
});

describe("the stage-up moment (§4.1)", () => {
  it.each([
    ["whispering_marsh", "whispering_marsh", "alpha"],
    ["exchange", "cliffside_exchange", "height"],
    ["sky_islands", "sky_islands", "angle"],
    ["stone_crossing", "great_river", "alpha"],
    ["enchanted_woods", "enchanted_forest", "x"],
    ["bone_yard", "bone_yard", "angle"],
  ] as const)("animates the %s chapter-end accent and holds it still on request", async (biome, family, property) => {
    const app = fakeApp();
    const loaded: string[] = [];
    const lobby = createLobbyCamp(app as unknown as Application, lobbyCampLayout()!, {
      layoutFor: campLayoutFor,
      loadTexture: async (url) => {
        loaded.push(url);
        return Texture.WHITE;
      },
    });
    lobby.resize(1600, 900);
    lobby.sync(makeState({ phase: "chapter_complete" }), biome);
    setCampBeat(true);
    await settle();
    const stage = lobby.camp()!.view;
    const accent = stage.getChildByLabel("camp-terrain-accent", true) as Sprite;
    const backdropLayer = accent.parent!;
    expect(loaded).toContain(`/assets/camp/backdrops/${family}.webp`);
    expect(backdropLayer.getChildIndex(accent)).toBeGreaterThan(
      backdropLayer.getChildIndex(stage.getChildByLabel("camp-backdrop", true)!),
    );
    const initial = accent[property];
    for (let i = 0; i < 20; i++) app.ticker.frame(16);
    expect(accent[property]).not.toBeCloseTo(initial);

    lobby.setStill(true);
    const resting = accent[property];
    for (let i = 0; i < 20; i++) app.ticker.frame(16);
    expect(accent[property]).toBe(resting);

    lobby.sync(makeState({ phase: "lobby" }), biome);
    await settle();
    expect(lobby.camp()!.view.getChildByLabel("camp-terrain-accent", true)).toBeFalsy();
    lobby.destroy();
  });

  it("is never longer than the transformation's beat", () => {
    expect(PITCH_S * 1000).toBeLessThanOrEqual(TRANSFORM_BEAT_MS);
  });

  it("plays once at the chapter's end, and never holds up back to the lobby or Begin", async () => {
    const app: FakeApp = fakeApp();
    const covered: boolean[] = [];
    const lobby = createLobbyCamp(app as unknown as Application, lobbyCampLayout()!, {
      still: false,
      loadTexture: noArt,
      layoutFor: campLayoutFor,
      cover: (on) => covered.push(on),
    });
    lobby.resize(1600, 900);
    const end = {
      ...makeState({ phase: "chapter_complete", party: [member(1)] }),
      camp: view({ grew: true }),
      campMoment: { id: "chapterEnd|r:ch:9", kind: "chapterEnd", outdoor: true, changes: {} },
    } as RunState;
    lobby.sync(end);
    // Not until the summary turns to its camp beat.
    expect(lobby.camp()).toBeNull();
    setCampBeat(true);
    await settle();
    const camp = lobby.camp()!;
    expect(camp).not.toBeNull();
    expect(camp.pitching()).toBe(true);
    // Half way through, everybody taps back to the lobby: it is there at once.
    for (let i = 0; i < Math.round((PITCH_S * 1000) / 2 / 16); i++) app.ticker.frame(16);
    setCampBeat(false);
    lobby.sync({ ...end, phase: "lobby", campMoment: { id: "lobby|r:ch:9", kind: "lobby", outdoor: true, changes: {} }, camp: view() } as RunState);
    await settle();
    expect(lobby.camp()).toBe(camp);
    // It finishes on its own, within its time, and does not replay.
    for (let i = 0; i < Math.round((PITCH_S * 1000) / 16) + 2; i++) app.ticker.frame(16);
    expect(camp.pitching()).toBe(false);
    lobby.sync({ ...end, phase: "lobby", camp: view() } as RunState);
    expect(camp.pitching()).toBe(false);
    // Begin: the camp leaves in the same call, pitch or no pitch.
    lobby.sync({ ...end, phase: "scene" } as RunState);
    expect(lobby.camp()).toBeNull();
    expect(covered.at(-1)).toBe(false);
    lobby.destroy();
  });
});
