// @vitest-environment jsdom
/**
 * The story scene's actor lifecycle, and which stage it reports.
 *
 * `scene-actors.test.ts` covers `visualKeyOf` — the *rule* that decides when a
 * figure has to be rebuilt rather than updated. This covers `setParty` acting
 * on it, which is the half that has actually broken: "rebuild an actor when its
 * body changes, and release the bound view model" was a fix commit, and the
 * rule it fixed was already tested at the time.
 *
 * `createScene` takes an `Application`, which is what kept this file from
 * existing. It turns out to read exactly three things off one — `stage`,
 * `ticker`, `canvas` — so `fakeApp()` supplies those and the whole module runs
 * with no renderer. Driving the ticker by hand is the other half of the win:
 * the motion in here is `approach()`-based, so "has it settled" becomes a loop
 * rather than a wait.
 *
 * What this file does NOT claim to cover, so nobody reads the coverage number
 * as more than it is: nothing is rasterised, so glyph shape, texture loading
 * and the depth sort's visual result are still only checked by looking at the
 * running app. The behaviour here is tree structure, lifecycle and geometry.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { Assets, Container, Sprite, Text, Texture } from "pixi.js";
import type { Application } from "pixi.js";
import { beginEncounter, parseBoard } from "@kad/shared";
import type { PartyMember, ResolvedCharacter } from "@kad/shared";
import { makeRules } from "../../../shared/src/test-fixtures";
import { fakeApp, installFakeCanvas2D, type FakeApp } from "../testing/fake-stage";
import { BACKDROP_FLOOR, backdropFit, createScene, packedTapTarget, type PartyScene } from "./scene";
import type { RunState } from "@kad/shared";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { campLayoutFixture } from "../testing/camp-fixture";
import { createLobbyCamp } from "./lobby-camp-stage";
import { packedFriends, packedKits } from "./packed-camp";
import { TAP_GAP_S, WORDS_S, routeFriendTap } from "./camp-taps";
import type { BoardViewState } from "./board";
import { RIFT_SHEET, RIFT_SHEET_MS } from "../screens/riftlight";

beforeAll(installFakeCanvas2D);

describe("illustrated backdrops", () => {
  it("falls back to the biome when an illustration fails to load", async () => {
    // Assets.load's final overload is the multi-asset Record; this test supplies a single texture.
    const texture = Texture.WHITE as unknown as Record<string, unknown>;
    const load = vi.spyOn(Assets, "load").mockRejectedValueOnce(new Error("404")).mockResolvedValue(texture);
    const app = fakeApp();
    const scene = createScene(app as unknown as Application);
    try {
      scene.setBiome("whispering_marsh", "scenes/gemfall/hollow-gate");
      await vi.waitFor(() => expect(load).toHaveBeenCalledWith("/assets/biomes/whispering_marsh/bg.webp"));
      expect(load).toHaveBeenNthCalledWith(1, "/assets/scenes/gemfall/hollow-gate.webp");
      scene.setBiome("whispering_marsh");
      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    } finally { scene.destroy(); load.mockRestore(); }
  });

  it("ignores an illustration arriving after the party has changed scenes", async () => {
    let finish!: (texture: Texture) => void;
    const load = vi.spyOn(Assets, "load")
      .mockImplementationOnce(() => new Promise<Texture>((resolve) => { finish = resolve; }) as unknown as Promise<Record<string, unknown>>)
      .mockResolvedValue(Texture.WHITE as unknown as Record<string, unknown>);
    const app = fakeApp();
    const scene = createScene(app as unknown as Application);
    try {
      scene.setBiome("whispering_marsh", "scenes/gemfall/hollow-gate");
      scene.setBiome("plains");
      await new Promise((resolve) => setTimeout(resolve, 0));
      const backdrop = app.stage.children[0] as Container;
      // [0] is the dark under the painting; [1] the painting (backdropFit).
      const art = backdrop.children[1] as Container;
      const count = art.children.length;
      finish(Texture.WHITE);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(art.children.length).toBe(count);
      expect(load).toHaveBeenCalledTimes(2);
    } finally { scene.destroy(); load.mockRestore(); }
  });
});

describe("letting go of backdrops", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("keeps the one on screen and the one before it, and unloads the rest", async () => {
    const load = vi.spyOn(Assets, "load").mockResolvedValue(Texture.WHITE as unknown as Record<string, unknown>);
    const unload = vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
    const scene = createScene(fakeApp() as unknown as Application);
    try {
      for (const biome of ["plains", "whispering_marsh", "enchanted_woods"]) {
        scene.setBiome(biome);
        await settle();
      }
      expect(unload.mock.calls).toEqual([["/assets/biomes/plains/bg.webp"]]);

      // Back to the room just left: still loaded, so nothing new lets go
      // except what falls off the end.
      scene.setBiome("whispering_marsh");
      await settle();
      expect(unload.mock.calls).toEqual([["/assets/biomes/plains/bg.webp"]]);
      scene.setBiome("plains");
      await settle();
      expect(unload.mock.calls.at(-1)).toEqual(["/assets/biomes/enchanted_woods/bg.webp"]);
    } finally { scene.destroy(); load.mockRestore(); unload.mockRestore(); }
  });

  it("loads again when handed a texture an unload just destroyed", async () => {
    const gone = { destroyed: true } as unknown as Record<string, unknown>;
    const load = vi.spyOn(Assets, "load")
      .mockResolvedValueOnce(gone)
      .mockResolvedValue(Texture.WHITE as unknown as Record<string, unknown>);
    const app = fakeApp();
    const scene = createScene(app as unknown as Application);
    try {
      scene.setBiome("plains");
      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
      await settle();
      const art = (app.stage.children[0] as Container).children[1] as Container;
      const shown = art.children.filter((c): c is Sprite => c instanceof Sprite);
      expect(shown.at(-1)?.texture).toBe(Texture.WHITE);
    } finally { scene.destroy(); load.mockRestore(); }
  });
});

describe("a rift in plain view (#401)", () => {
  /** Every sprite drawing a rift sheet frame, by the sheet it was cut from. */
  const rifts = (app: FakeApp): Sprite[] => {
    const found: Sprite[] = [];
    const walk = (node: Container): void => {
      if (node instanceof Sprite && node.label === "rift") found.push(node);
      for (const child of node.children) walk(child as Container);
    };
    walk(app.stage);
    return found;
  };
  const sheet = () => {
    const canvas = document.createElement("canvas");
    canvas.width = RIFT_SHEET.columns * RIFT_SHEET.size;
    canvas.height = Math.ceil(RIFT_SHEET.frames / RIFT_SHEET.columns) * RIFT_SHEET.size;
    return Texture.from(canvas);
  };

  it("puts the tear on the stage only while a scene has one, and steps through its frames", async () => {
    const load = vi.spyOn(Assets, "load").mockResolvedValue(sheet() as unknown as Record<string, unknown>);
    const app = fakeApp();
    const s = createScene(app as unknown as Application);
    try {
      expect(rifts(app)).toHaveLength(0);
      s.setRift("steady", "c1/quay");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(load).toHaveBeenCalledWith("/assets/effects/rift_neutral.sheet.png");
      app.ticker.frame(16);
      const [tear] = rifts(app);
      expect(tear?.visible).toBe(true);
      const first = tear!.texture.frame.x;
      app.ticker.frame(250);
      expect(tear!.texture.frame.x).not.toBe(first);
      s.setRift(null, "c1/plain");
      expect(rifts(app)).toHaveLength(0);
    } finally { s.destroy(); load.mockRestore(); }
  });

  it("slices the 4K-compatible atlas across rows and wraps after its final frame", async () => {
    const source = sheet();
    expect(source.width).toBeLessThanOrEqual(4096);
    expect(source.height).toBeLessThanOrEqual(4096);
    const load = vi.spyOn(Assets, "load").mockResolvedValue(source as unknown as Record<string, unknown>);
    const app = fakeApp();
    const s = createScene(app as unknown as Application);
    try {
      s.setRift("steady", "c1/grid");
      await new Promise((resolve) => setTimeout(resolve, 0));
      const step = 1000 / RIFT_SHEET.fps;
      const drawn = () => {
        const frame = rifts(app)[0]!.texture.frame;
        expect(frame.right).toBeLessThanOrEqual(source.width);
        expect(frame.bottom).toBeLessThanOrEqual(source.height);
        return [frame.x, frame.y];
      };
      app.ticker.frame((RIFT_SHEET.columns - 0.5) * step);
      expect(drawn()).toEqual([(RIFT_SHEET.columns - 1) * RIFT_SHEET.size, 0]);
      app.ticker.frame(step);
      expect(drawn()).toEqual([0, RIFT_SHEET.size]);
      app.ticker.frame((RIFT_SHEET.frames - RIFT_SHEET.columns - 1) * step);
      expect(drawn()).toEqual([(RIFT_SHEET.columns - 1) * RIFT_SHEET.size, RIFT_SHEET.size]);
      app.ticker.frame(step);
      expect(drawn()).toEqual([0, 0]);
    } finally { s.destroy(); load.mockRestore(); }
  });

  it("plays an opening once its chapter lands, when the scene was set before the chapter loaded (#402)", async () => {
    // One texture per sheet, so the test can tell which sheet the tear is drawing.
    const sheets = new Map<string, Texture>();
    const load = vi.spyOn(Assets, "load").mockImplementation(((url: string) => {
      if (!sheets.has(url)) sheets.set(url, sheet());
      return Promise.resolve(sheets.get(url)!);
    }) as unknown as typeof Assets.load);
    const app = fakeApp();
    const s = createScene(app as unknown as Application);
    const drawing = (): string | undefined => {
      const source = rifts(app)[0]?.texture.source;
      return [...sheets].find(([, texture]) => texture.source === source)?.[0];
    };
    try {
      // The state names the scene; its chapter has not loaded, so it reads as no rift.
      s.setRift(null, "c1/shimmer");
      app.ticker.frame(16);
      expect(rifts(app)).toHaveLength(0);
      // The chapter lands: the same scene, now with its rift. It unfolds.
      s.setRift("open", "c1/shimmer");
      await new Promise((resolve) => setTimeout(resolve, 0));
      app.ticker.frame(16);
      expect(rifts(app)[0]?.visible).toBe(true);
      expect(drawing()).toBe("/assets/effects/rift_open.sheet.png");
      // Hold the opening until its final frame, then hand off to the shimmer.
      app.ticker.frame(RIFT_SHEET_MS - 32);
      expect(drawing()).toBe("/assets/effects/rift_open.sheet.png");
      app.ticker.frame(32);
      expect(drawing()).toBe("/assets/effects/rift_neutral.sheet.png");
      // ...and the same scene and rift again is a re-render, which does not unfold it a second time.
      s.setRift("open", "c1/shimmer");
      app.ticker.frame(16);
      expect(drawing()).toBe("/assets/effects/rift_neutral.sheet.png");
    } finally { s.destroy(); load.mockRestore(); }
  });

  it("plays a collapse once and leaves nothing behind, and does not replay it for the same scene", async () => {
    const load = vi.spyOn(Assets, "load").mockResolvedValue(sheet() as unknown as Record<string, unknown>);
    const app = fakeApp();
    const s = createScene(app as unknown as Application);
    try {
      s.setRift("collapse", "c1/through");
      await new Promise((resolve) => setTimeout(resolve, 0));
      app.ticker.frame(16);
      expect(load).toHaveBeenCalledWith("/assets/effects/rift_collapse.sheet.png");
      expect(rifts(app)[0]?.visible).toBe(true);
      app.ticker.frame(RIFT_SHEET_MS - 32);
      expect(rifts(app)[0]?.visible).toBe(true);
      app.ticker.frame(32);
      expect(rifts(app)).toHaveLength(0);
      s.setRift("collapse", "c1/through");
      app.ticker.frame(16);
      expect(rifts(app)).toHaveLength(0);
    } finally { s.destroy(); load.mockRestore(); }
  });
});

describe("the cast", () => {
  const tidewell = { key: "entities/selkie|Professor Tidewell", url: "/assets/entities/selkie/assembled.png", name: "Professor Tidewell", heightCm: 165, stance: "standing" as const };

  function sprites(app: FakeApp): number {
    let found = 0;
    const walk = (node: Container): void => {
      if (node.destroyed) return;
      if (node instanceof Sprite) found += 1;
      for (const child of node.children) walk(child as Container);
    };
    walk(app.stage);
    return found;
  }

  it("still draws a member called back while their art was loading (A → B → A)", async () => {
    let finish!: (texture: Texture) => void;
    const load = vi.spyOn(Assets, "load").mockImplementation(
      () => new Promise<Texture>((resolve) => { finish = resolve; }) as unknown as Promise<Record<string, unknown>>,
    );
    const { scene: s, app } = scene();
    try {
      s.setCast([tidewell]);
      const before = sprites(app);
      s.setCast([]); // scene B: she starts walking off
      finish(Texture.WHITE); // her art arrives mid-exit
      await new Promise((resolve) => setTimeout(resolve, 0));
      s.setCast([tidewell]); // back to A before she is gone: the same actor, revived
      // Never loaded again, so the one load has to have landed.
      expect(load).toHaveBeenCalledTimes(1);
      expect(sprites(app)).toBe(before + 1);
    } finally { s.destroy(); load.mockRestore(); }
  });

  it("re-packs a figure that stays while its group grows and shrinks (1 → 3 → 1)", async () => {
    const load = vi.spyOn(Assets, "load").mockResolvedValue(Texture.WHITE as unknown as Record<string, unknown>);
    const { scene: s, app } = scene();
    const wolf = { key: "entities/cinder_wolf|", url: "/assets/entities/cinder_wolf/assembled.png", name: null, heightCm: 95, stance: "standing" as const };
    const pack = (size: number) =>
      Array.from({ length: size }, (_, index) => ({
        ...wolf,
        key: index === 0 ? wolf.key : `${wolf.key}#${index}`,
        ...(size > 1 ? { crowd: { index, size } } : {}),
      }));
    // The x of every drawn figure, left to right, once they have settled in.
    const standIn = async (app: FakeApp): Promise<number[]> => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      app.ticker.frame(5_000);
      const xs: number[] = [];
      const walk = (node: Container): void => {
        if (node instanceof Sprite) xs.push(node.parent!.parent!.x);
        for (const child of node.children) walk(child as Container);
      };
      walk(app.stage);
      return xs.sort((a, b) => a - b);
    };
    const stand = (): Promise<number[]> => standIn(app);
    try {
      s.setCast(pack(1));
      const alone = await stand();
      s.setCast(pack(3));
      const group = await stand();
      expect(group).toHaveLength(3);
      // Exactly where a group that began as a group stands.
      const fresh = scene();
      try {
        fresh.scene.setCast(pack(3));
        const expected = await standIn(fresh.app);
        group.forEach((x, i) => expect(x).toBeCloseTo(expected[i]!, 3));
      } finally { fresh.scene.destroy(); }
      const gap = group[2]! - group[0]!;
      s.setCast(pack(1));
      const back = await stand();
      expect(back).toHaveLength(1);
      expect(back[0]).toBeCloseTo(alone[0]!, 3);
      expect(gap).toBeGreaterThan(0);
    } finally { s.destroy(); load.mockRestore(); }
  });

  it("does not draw into a member who finished leaving", async () => {
    let finish!: (texture: Texture) => void;
    const load = vi.spyOn(Assets, "load").mockImplementation(
      () => new Promise<Texture>((resolve) => { finish = resolve; }) as unknown as Promise<Record<string, unknown>>,
    );
    const { scene: s, app } = scene();
    try {
      s.setCast([tidewell]);
      s.setCast([]);
      app.ticker.frame(5_000); // the exit completes; the actor is destroyed
      const before = sprites(app);
      finish(Texture.WHITE);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sprites(app)).toBe(before);
    } finally { s.destroy(); load.mockRestore(); }
  });
});

describe("the camp packed down at an indoor rest (docs/camp.md §3.2, #625)", () => {
  it("lays each hero's bedroll beside her in the scene's own picture, and nothing else of the camp", async () => {
    const load = vi.spyOn(Assets, "load").mockResolvedValue(Texture.WHITE as unknown as Record<string, unknown>);
    const { scene: s, app } = scene();
    try {
      s.setBiome("glacier_of_origins", "scenes/riftlight/wyrm-nest");
      s.setParty([member(), member({ character: character({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle" }) })]);
      s.setPackedCamp([
        { id: "c_1", style: "rolled", accent: "#7FD4C1" },
        { id: "c_2", style: "patched", accent: "#E8A33D" },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const spots = s.packedCamp();
      expect(spots.map((spot) => spot.id)).toEqual(["c_1", "c_2"]);
      // On her right, a step behind her feet, and each its own.
      const heroes = [figureFor(app, "Sparklehoof")!, figureFor(app, "Thistle")!];
      expect(spots[0]!.x).toBeGreaterThan(heroes[0]!.x);
      expect(spots[0]!.x).toBeLessThan(heroes[1]!.x);
      expect(spots[0]!.width).toBeGreaterThan(0);
      // The kit paintings, and only them: no campsite backdrop, tent or campfire was asked for.
      expect(load).toHaveBeenCalledWith("/assets/camp/kits/rolled.png");
      expect(load).toHaveBeenCalledWith("/assets/camp/kits/patched.png");
      const asked = load.mock.calls.map((call) => String(call[0]));
      expect(asked.some((url) => url.includes("camp/backdrops") || url.includes("tent") || url.includes("campfire"))).toBe(false);
      expect(asked).toContain("/assets/scenes/riftlight/wyrm-nest.webp");
      // Each hero casts a soft shadow in the room's light, on one layer under the lineup (camp-light.ts INDOOR_LIGHT).
      const shadows = app.stage.getChildByLabel("rest-shadows", true) as Container;
      expect(shadows.children.length).toBeGreaterThanOrEqual(2);
      // Gone with the rest.
      s.setPackedCamp(null);
      expect(s.packedCamp()).toEqual([]);
      expect(shadows.children).toHaveLength(0);
    } finally { s.destroy(); load.mockRestore(); }
  });
  it("sits the friends out at the row's two ends, at their true heights, and takes them away with it (#624)", async () => {
    const load = vi.spyOn(Assets, "load").mockResolvedValue(Texture.WHITE as unknown as Record<string, unknown>);
    const { scene: s, app } = scene();
    try {
      s.setBiome("glacier_of_origins", "scenes/riftlight/wyrm-nest");
      s.setParty([member(), member({ character: character({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle" }) })]);
      s.setPackedCamp(
        [
          { id: "c_1", style: "rolled", accent: "#7FD4C1" },
          { id: "c_2", style: "rolled", accent: "#E8A33D" },
        ],
        [
          { id: "bun", url: "/assets/cast/bun.webp", heightCm: 40, stance: "standing", figure: "cast/bun" },
          { id: "duckling", url: "/assets/entities/duckling.webp", heightCm: 20, stance: "standing", figure: "entities/duckling" },
          { id: "nobody", url: null, heightCm: 40, stance: "standing", figure: "cast/none" },
        ],
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const friends = s.packedFriendsShown!();
      // A friend with no painting is not drawn.
      expect(friends.map((f) => f.id)).toEqual(["bun", "duckling"]);
      const heroes = [figureFor(app, "Sparklehoof")!, figureFor(app, "Thistle")!];
      const bedrolls = s.packedCamp();
      // Left of the first hero, turned to face the row; right of the last bedroll.
      expect(friends[0]!.x).toBeLessThan(heroes[0]!.x);
      expect(friends[0]!.mirrored).toBe(true);
      expect(friends[1]!.x - friends[1]!.width / 2).toBeGreaterThan(bedrolls[1]!.x);
      expect(friends[1]!.mirrored).toBe(false);
      // True proportion: the bun twice the duckling, never under the story floor, and inside the design stage.
      expect(friends[0]!.height).toBeGreaterThanOrEqual(80);
      expect(friends[0]!.height).toBeGreaterThanOrEqual(friends[1]!.height);
      for (const f of friends) {
        expect(f.x - f.width / 2).toBeGreaterThanOrEqual(0);
        expect(f.x + f.width / 2).toBeLessThanOrEqual(1600);
      }
      expect(load).toHaveBeenCalledWith("/assets/cast/bun.webp");
      s.setPackedCamp(null, []);
      expect(s.packedFriendsShown!()).toEqual([]);
    } finally { s.destroy(); load.mockRestore(); }
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function character(overrides: Partial<ResolvedCharacter> = {}): ResolvedCharacter {
  return {
    id: "c_1",
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 1,
    xp: 0,
    tier: "fledgling",
    stats: { might: 2, quick: 9, clever: 3, heart: 5 },
    unspentPoints: 0,
    spendableStats: ["might", "quick", "clever", "heart"],
    committedLevel: 1,
    maxHp: 10,
    steps: 4,
    guard: 11,
    attackStat: "heart",
    actions: [],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: false,
    ...overrides,
  };
}

function member(overrides: Partial<PartyMember> = {}): PartyMember {
  const char = overrides.character ?? character();
  return {
    character: char,
    playerId: char.ownerPlayerId,
    hp: char.maxHp,
    down: false,
    connected: true,
    ready: true,
    ...overrides,
  };
}

function scene(): { scene: PartyScene; app: FakeApp } {
  const app = fakeApp();
  const made = createScene(app as unknown as Application);
  made.resize(1600, 900);
  return { scene: made, app };
}

/** Every live `Text` on the stage, by what it says. */
function drawnLabels(app: FakeApp): string[] {
  const found: string[] = [];
  const walk = (node: Container): void => {
    if (node.destroyed) return;
    if (node instanceof Text) found.push(node.text);
    for (const child of node.children) walk(child as Container);
  };
  walk(app.stage);
  return found;
}

/**
 * The containers that hold a figure, identified by the label inside them.
 *
 * A rebuild is only observable as *identity*: the old container is destroyed
 * and a different object takes its place. Holding the object itself is what
 * makes "updated in place" and "rebuilt" different assertions rather than the
 * same one worded twice.
 */
function figureFor(app: FakeApp, name: string): Container | null {
  let found: Container | null = null;
  const walk = (node: Container): void => {
    if (node.destroyed || found) return;
    for (const child of node.children) {
      if (child instanceof Text && child.text === name) {
        found = node;
        return;
      }
    }
    for (const child of node.children) walk(child as Container);
  };
  walk(app.stage);
  return found;
}

function encounterView(): BoardViewState {
  const hero = character();
  const encounter = beginEncounter(
    {
      board: parseBoard(["....", "....", "....", "...."]),
      party: [{ character: hero, at: { x: 0, y: 0 } }],
      enemies: [
        {
          spec: { id: "wisp", name: "Bramblewisp", count: 1, hp: 6, guard: 11, quick: 3, steps: 5, attack: 3 },
          at: { x: 3, y: 3 },
        },
      ],
    },
    { rules: makeRules(), abilities: {}, rng: { next: () => 0.5 } },
  );
  return { encounter, biome: null, enemyArt: {}, party: [member({ character: hero })] };
}

// ---------------------------------------------------------------------------
// setParty
// ---------------------------------------------------------------------------

describe("setParty", () => {
  it("keeps the same figure when only what arrives on a patch changes", () => {
    /*
     * hp, down and connected land on nearly every server patch. Rebuilding on
     * them would tear the rig down and reload it mid-scene — a figure that
     * blinks out for a frame every time it is hit.
     */
    const { scene: s, app } = scene();
    s.setParty([member()]);
    const before = figureFor(app, "Sparklehoof");
    expect(before).toBeTruthy();

    s.setParty([member({ down: true, hp: 0, connected: false })]);

    expect(figureFor(app, "Sparklehoof")).toBe(before);
    expect(before!.destroyed).toBe(false);
  });

  it("rebuilds the figure when the body changes, and drops the old one", () => {
    /*
     * The emotional payload of the whole chapter (roadmap 5): a character who
     * levels into a new tier keeps her id and changes her body. An actor
     * rebuilt only on a new *id* would go on drawing the Fledgling rig for the
     * rest of the session, playing the transformation cutscene over a figure
     * that visibly never transformed.
     */
    const { scene: s, app } = scene();
    s.setParty([member()]);
    const before = figureFor(app, "Sparklehoof")!;

    s.setParty([member({ character: character({ tier: "sworn", level: 4 }) })]);

    const after = figureFor(app, "Sparklehoof");
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
    // The old tree is released rather than left parented and invisible.
    expect(before.destroyed).toBe(true);
    expect(drawnLabels(app).filter((t) => t === "Sparklehoof")).toHaveLength(1);
  });

  it("renames in place rather than rebuilding", () => {
    // A rename is a label edit — the same "write, don't rebuild" split the
    // board makes, and a megabyte of rig is the cost of getting it wrong.
    const { scene: s, app } = scene();
    s.setParty([member()]);
    const before = figureFor(app, "Sparklehoof")!;

    s.setParty([member({ character: character({ name: "Thistlemane" }) })]);

    expect(drawnLabels(app)).toContain("Thistlemane");
    expect(drawnLabels(app)).not.toContain("Sparklehoof");
    expect(figureFor(app, "Thistlemane")).toBe(before);
    expect(before.destroyed).toBe(false);
  });

  it("drops a member who leaves the party", () => {
    const a = character();
    const b = character({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle" });
    const { scene: s, app } = scene();
    s.setParty([member({ character: a }), member({ character: b })]);
    const gone = figureFor(app, "Thistle")!;

    s.setParty([member({ character: a })]);

    expect(gone.destroyed).toBe(true);
    expect(drawnLabels(app)).toEqual(["Sparklehoof"]);
  });

  it("takes a party of nobody without complaint", () => {
    // The lobby before anyone has built a character.
    const { scene: s, app } = scene();
    expect(() => s.setParty([])).not.toThrow();
    expect(drawnLabels(app)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Which stage is being reported
// ---------------------------------------------------------------------------

describe("nameplateBoxes", () => {
  it("reports the story lineup when there is no fight", () => {
    const { scene: s } = scene();
    s.setParty([member()]);

    const reading = s.nameplateBoxes();
    expect(reading.space).toBe("story");
    expect(reading.boxes.map((b) => b.text)).toEqual(["Sparklehoof"]);
  });

  it("reports the board once one is up, not the lineup behind it", () => {
    /*
     * The distinction this seam exists for. Two rounds of an e2e polled for
     * "three names are present", were satisfied by the story lineup that had
     * been on screen the whole time, and asserted board geometry against
     * lineup boxes — passing happily while the board bug sat right there. The
     * space is named so a caller has to say which stage it means.
     */
    const { scene: s } = scene();
    s.setParty([member()]);
    expect(s.nameplateBoxes().space).toBe("story");

    s.setEncounter(encounterView());
    expect(s.nameplateBoxes().space).toBe("board");

    // And back down again when the fight ends.
    s.setEncounter(null);
    expect(s.nameplateBoxes().space).toBe("story");
  });

  it("reports nothing while the names are switched off", () => {
    /*
     * Off for the lobby, where the player cards above the lineup already list
     * every name — the copy nobody needs is the one competing with the art.
     */
    const { scene: s } = scene();
    s.setParty([member()]);
    expect(s.nameplateBoxes().boxes).toHaveLength(1);

    s.setNameplatesVisible(false);
    expect(s.nameplateBoxes().boxes).toEqual([]);

    s.setNameplatesVisible(true);
    expect(s.nameplateBoxes().boxes).toHaveLength(1);
  });

  it("keeps the switch across a rebuild", () => {
    // A tier crossing builds a fresh label, which must not arrive visible on a
    // surface that turned names off.
    const { scene: s } = scene();
    s.setParty([member()]);
    s.setNameplatesVisible(false);

    s.setParty([member({ character: character({ tier: "sworn", level: 4 }) })]);

    expect(s.nameplateBoxes().boxes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("the scene's life", () => {
  it("runs on the host ticker rather than starting one of its own", () => {
    /*
     * PixiStage stops the shared ticker when the surface is hidden, and that
     * discipline only holds for free if nothing in here adds a second one.
     */
    const { scene: s, app } = scene();
    expect(app.ticker.count).toBe(1);

    s.setParty([member()]);
    expect(() => app.ticker.frame(16)).not.toThrow();
    expect(app.ticker.count).toBe(1);
  });

  it("takes its callback off the ticker when it is destroyed", () => {
    // A scene left on the ticker keeps drawing a stage nobody is looking at,
    // and holds its whole tree alive with it.
    const { scene: s, app } = scene();
    s.setParty([member()]);

    s.destroy();

    expect(app.ticker.count).toBe(0);
  });

  it("ignores everything after it is destroyed", () => {
    /*
     * The store does not know the surface is gone, so a late patch is normal.
     * "Does not throw" is the weaker half of this and on its own is close to
     * worthless — a `setParty` that quietly rebuilt the whole lineup onto a
     * torn-down stage would pass it. What is asserted is that nothing came
     * back: the tree stays empty and the figures are not re-parented.
     */
    const { scene: s, app } = scene();
    s.setParty([member()]);
    s.destroy();

    expect(() => s.setParty([member()])).not.toThrow();
    expect(() => s.setEncounter(encounterView())).not.toThrow();
    expect(() => s.setNameplatesVisible(false)).not.toThrow();
    expect(() => s.resize(800, 600)).not.toThrow();
    expect(() => s.destroy()).not.toThrow();

    expect(drawnLabels(app)).toEqual([]);
    expect(s.nameplateBoxes().boxes).toEqual([]);
    expect(app.ticker.count).toBe(0);
  });

  it("settles the figures without a real clock", () => {
    // The lineup animates into place with `approach`, so a test that asserts
    // a resting position has to run frames rather than wait for them.
    const { scene: s, app } = scene();
    s.setParty([member(), member({ character: character({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle" }) })]);

    for (let i = 0; i < 300; i++) app.ticker.frame(16);

    const boxes = s.nameplateBoxes().boxes;
    expect(boxes).toHaveLength(2);
    // Two figures, two distinct slots — not stacked on the same spot.
    expect(boxes[0]!.x).not.toBeCloseTo(boxes[1]!.x, 1);
  });

  it("puts a rift fight's overlay on the stage, plays its beats, and takes it down after (#201)", () => {
    const { scene: s, app } = scene();
    const plain = encounterView();
    const hero = plain.encounter.combatants.find((c) => c.side === "party")!.id;
    const encounter = beginEncounter(
      {
        board: parseBoard(["....", "....", "....", "...."]),
        party: [{ character: plain.party[0]!.character, at: { x: 0, y: 0 } }],
        enemies: [
          {
            spec: { id: "wisp", name: "Bramblewisp", count: 1, hp: 6, guard: 11, quick: 3, steps: 5, attack: 3 },
            at: { x: 3, y: 3 },
          },
        ],
        environment: {
          clock: { rounds: 3, label: "The rift closes", onExpire: "collapse" },
          hazards: [{ id: "fire", kind: "thorns", label: "Thornbank", tiles: [{ x: 1, y: 1 }], damage: 1 }],
          exits: [{ id: "tear", label: "The tear", tiles: [{ x: 3, y: 0 }] }],
          rescue: { name: "Pip", at: { x: 0, y: 3 } },
        },
      },
      { rules: makeRules(), abilities: {}, rng: { next: () => 0.5 } },
    );
    const overlay = (): Container | null => {
      let found: Container | null = null;
      const walk = (node: Container): void => {
        if (node.destroyed || found) return;
        if (node.label === "environment") found = node;
        for (const child of node.children) walk(child as Container);
      };
      walk(app.stage);
      return found;
    };

    s.setEncounter({ ...plain, encounter });
    expect(overlay()).not.toBeNull();
    s.playCombatEvents(
      [
        { type: "freed", byId: hero },
        { type: "relocated", actorId: "wisp#1", to: { x: 2, y: 0 } },
        { type: "escaped", actorId: hero, exitId: "tear" },
        { type: "riftClock", onExpire: "collapse" },
      ],
      1900,
    );
    expect(() => {
      for (let i = 0; i < 180; i++) app.ticker.frame(16);
    }).not.toThrow();

    // The board outlives fights; the next ordinary one has no overlay on it.
    s.setEncounter(null);
    s.setEncounter(plain);
    expect(overlay()).toBeNull();
    s.destroy();
  });
});

describe("backdropFit: nobody floats", () => {
  const tv = { width: 1920, height: 1080 };
  const phone = { width: 390, height: 780 };

  for (const [label, pane, feet, stage] of [
    ["a TV with the plate up", tv, 560, 640],
    ["a TV with no plate", tv, 950, 1080],
    ["a phone with a long paragraph", phone, 200, 220],
  ] as const) {
    it(`puts the painting's floor under the feet on ${label}`, () => {
      const bleed = 20;
      const fit = backdropFit(pane, feet, stage, bleed);
      expect(fit.y + BACKDROP_FLOOR * fit.scale).toBeCloseTo(feet);
      // Still covers the pane across and above, through a jolt.
      expect(fit.x).toBeLessThanOrEqual(-bleed + 0.001);
      expect(fit.x + 1600 * fit.scale).toBeGreaterThanOrEqual(pane.width + bleed - 0.001);
      expect(fit.y).toBeLessThanOrEqual(-bleed + 0.001);
      // And runs on under the top of the plate rather than stopping at it.
      expect(fit.y + 900 * fit.scale).toBeGreaterThan(stage);
    });
  }

  it("just covers the pane when there is no story floor (a fight)", () => {
    const fit = backdropFit(tv, 0, 1080, 0);
    expect(fit.scale).toBeCloseTo(1.2);
    expect(fit.y).toBeCloseTo(0);
  });

  it("keeps midground landmarks below the phone's upper UI without moving the floor", () => {
    const fit = backdropFit({ width: 390, height: 844 }, 300, 380, 0);
    // The records-hall books sit halfway down the painting. They need to
    // appear below the ~135px chapter/goal controls rather than behind them.
    expect(fit.y + 450 * fit.scale).toBeGreaterThan(135);
    expect(fit.y + BACKDROP_FLOOR * fit.scale).toBeCloseTo(300);
    expect(fit.y + 900 * fit.scale).toBeGreaterThan(380);
    expect(fit.x).toBeLessThanOrEqual(0);
    expect(fit.x + 1600 * fit.scale).toBeGreaterThanOrEqual(390);
  });
});

describe("a new pane", () => {
  it("is framed at once, not zoomed into over the next ticks", () => {
    // A phone's World tab: the stage was laid out at the default size while
    // hidden (no ticks), then shown at 390px. The first frame must already
    // fit the whole 16-tile story across it, or the party is cropped.
    const { scene: s, app } = scene(); // 1600×900, ticked never
    s.resize(390, 780);
    const story = app.stage.children[1] as Container;
    expect(story.scale.x).toBeCloseTo(390 / 1600);
    expect(story.x).toBeCloseTo(0);
  });
});

describe("the narration plate changing height", () => {
  const storyOf = (app: FakeApp): Container => app.stage.children[1] as Container;
  const figuresOf = (app: FakeApp): Container[] =>
    (storyOf(app).children[0] as Container).children as Container[];
  const settle = (app: FakeApp): void => {
    for (let i = 0; i < 300; i++) app.ticker.frame(16);
  };
  const two = (): PartyMember[] => [
    member(),
    member({ character: character({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle" }) }),
  ];

  it("frames the first plate at once rather than gliding up into it", () => {
    const { scene: s, app } = scene();
    s.resize(1920, 1080);
    s.setParty(two());
    settle(app);
    s.setStageInset(400);
    const first = { y: storyOf(app).y, scale: storyOf(app).scale.x };
    settle(app);
    expect(storyOf(app).y).toBeCloseTo(first.y, 3);
    expect(storyOf(app).scale.x).toBeCloseTo(first.scale, 5);
  });

  it("eases the stage and the lineup to a plate that grows, instead of snapping", () => {
    /*
     * Somebody leaning on a choice can rewrap the plate by a line. That used
     * to jump the whole stage by half the difference in one frame and
     * teleport every hero sideways to their new slot.
     */
    const { scene: s, app } = scene();
    s.resize(1920, 1080);
    s.setParty(two());
    s.setStageInset(300);
    settle(app);
    const before = { y: storyOf(app).y, xs: figuresOf(app).map((f) => f.x) };

    s.setStageInset(420);
    expect(storyOf(app).y).toBeCloseTo(before.y, 3);
    figuresOf(app).forEach((f, i) => expect(f.x).toBeCloseTo(before.xs[i]!, 3));

    settle(app);
    // And it does get there: the same frame a plate that started at 420 gets.
    const fresh = scene();
    fresh.scene.resize(1920, 1080);
    fresh.scene.setParty(two());
    fresh.scene.setStageInset(420);
    settle(fresh.app);
    expect(storyOf(app).y).toBeCloseTo(storyOf(fresh.app).y, 1);
    figuresOf(app).forEach((f, i) => expect(f.x).toBeCloseTo(figuresOf(fresh.app)[i]!.x, 1));
    fresh.scene.destroy();
    s.destroy();
  });
});

// ---------------------------------------------------------------------------
// A friend tapped at an indoor rest (#624, docs/camp.md §3.2)
// ---------------------------------------------------------------------------

describe("a packed friend tapped at an indoor rest (#624, docs/camp.md §3.2)", () => {
  const BUN = { id: "bun", url: "/assets/cast/bun.webp", heightCm: 40, stance: "standing" as const, figure: "cast/bun" };
  const DUCKLING = { id: "duckling", url: "/assets/entities/duckling.webp", heightCm: 20, stance: "standing" as const, figure: "entities/duckling" };
  const byLabel = (app: FakeApp, label: string): Container | null => {
    let found: Container | null = null;
    const walk = (node: Container): void => {
      if (found || node.destroyed) return;
      if (node.label === label) { found = node; return; }
      for (const child of node.children) walk(child as Container);
    };
    walk(app.stage);
    return found;
  };
  const wordsShown = (app: FakeApp): string[] => {
    const layer = byLabel(app, "packed-friend-words");
    return layer ? layer.children.flatMap((bubble) => (bubble as Container).children.filter((c) => c instanceof Text).map((t) => (t as Text).text)) : [];
  };
  const frames = (app: FakeApp, seconds: number, each?: () => void): void => {
    for (let i = 0; i < Math.round((seconds * 1000) / 16); i++) {
      app.ticker.frame(16);
      each?.();
    }
  };
  async function indoors(): Promise<{ s: PartyScene; app: FakeApp; restore: () => void }> {
    const load = vi.spyOn(Assets, "load").mockResolvedValue(Texture.WHITE as unknown as Record<string, unknown>);
    const { scene: s, app } = scene();
    s.setBiome("glacier_of_origins", "scenes/riftlight/wyrm-nest");
    s.setParty([member(), member({ character: character({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle" }) })]);
    s.setPackedCamp([{ id: "c_1", style: "rolled", accent: "#7FD4C1" }, { id: "c_2", style: "rolled", accent: "#E8A33D" }], [BUN, DUCKLING]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { s, app, restore: () => { s.destroy(); load.mockRestore(); document.documentElement.removeAttribute("data-motion"); } };
  }

  it("shows its words over its head for as long as the full camp does, hops where it sits, and never walks", async () => {
    const { s, app, restore } = await indoors();
    try {
      expect(s.showsPackedFriend("bun")).toBe(true);
      const sprite = byLabel(app, "packed-friend:bun")!;
      const spot = s.packedFriendsShown!().find((f) => f.id === "bun")!;
      expect(s.tapPackedFriend({ friendId: "bun", heroId: "c_1", words: "Bun nibbles your sleeve. That means hello in goat." })).toBe("start");
      // Up at once, over its head: the bubble's tail above the top of its painting, by it.
      expect(s.packedFriendWords()).toEqual([{ id: "bun", words: "Bun nibbles your sleeve. That means hello in goat." }]);
      expect(wordsShown(app)).toEqual(["Bun nibbles your sleeve. That means hello in goat."]);
      const bubble = byLabel(app, "camp-friend-words")!;
      expect(bubble.y).toBeLessThan(spot.y - spot.height);
      expect(Math.abs(bubble.x - spot.x)).toBeLessThan(400);
      // The full camp's hop, off the ground and back, and not a step sideways.
      let highest = 0;
      frames(app, 2.2, () => {
        highest = Math.max(highest, spot.y - sprite.y);
        expect(sprite.x).toBe(spot.x);
      });
      expect(highest).toBeGreaterThan(0);
      expect(sprite.y).toBe(spot.y);
      // Still up until WORDS_S, then gone.
      frames(app, WORDS_S - 2.2 - 0.1);
      expect(s.packedFriendWords()).toHaveLength(1);
      frames(app, 0.3);
      expect(s.packedFriendWords()).toEqual([]);
      expect(wordsShown(app)).toEqual([]);
    } finally { restore(); }
  });

  it("only says its words under reduced motion: no hop", async () => {
    document.documentElement.setAttribute("data-motion", "reduced");
    const { s, app, restore } = await indoors();
    try {
      const sprite = byLabel(app, "packed-friend:duckling")!;
      const spot = s.packedFriendsShown!().find((f) => f.id === "duckling")!;
      expect(s.tapPackedFriend({ friendId: "duckling", heroId: "c_2", words: "Peep!" })).toBe("start");
      frames(app, 2, () => expect(sprite.y).toBe(spot.y));
      expect(s.packedFriendWords()).toEqual([{ id: "duckling", words: "Peep!" }]);
    } finally { restore(); }
  });

  it("keeps the full camp's queue: one tap at a time, one more held, the rest dropped, then the held one says its words", async () => {
    const { s, app, restore } = await indoors();
    try {
      const verdicts = ["Maa 0", "Maa 1", "Maa 2", "Maa 3"].map((words, i) => s.tapPackedFriend({ friendId: "bun", heroId: i % 2 ? "c_1" : "c_2", words }));
      expect(verdicts).toEqual(["start", "waiting", "dropped", "dropped"]);
      // Another friend is its own queue.
      expect(s.tapPackedFriend({ friendId: "duckling", heroId: "c_1", words: "Peep!" })).toBe("start");
      frames(app, WORDS_S + TAP_GAP_S + 0.1);
      expect(s.packedFriendWords()).toEqual([{ id: "bun", words: "Maa 1" }]);
    } finally { restore(); }
  });

  it("drops a tap for a friend it does not show, and forgets a friend's words when it goes in", async () => {
    const { s, app, restore } = await indoors();
    try {
      expect(s.showsPackedFriend("mosshorn")).toBe(false);
      expect(s.tapPackedFriend({ friendId: "mosshorn", heroId: "c_1", words: "Hm." })).toBe("dropped");
      expect(s.tapPackedFriend({ friendId: "bun", heroId: "c_1", words: "Hi!" })).toBe("start");
      s.setPackedCamp([{ id: "c_1", style: "rolled", accent: "#7FD4C1" }, { id: "c_2", style: "rolled", accent: "#E8A33D" }], [DUCKLING]);
      frames(app, 0.1);
      expect(s.packedFriendWords()).toEqual([]);
      expect(s.showsPackedFriend("bun")).toBe(false);
      s.setPackedCamp(null);
      expect(s.tapPackedFriend({ friendId: "duckling", heroId: "c_1", words: "Peep!" })).toBe("dropped");
    } finally { restore(); }
  });
});

describe("a friend tap goes to whichever stage shows the friend (#624)", () => {
  const cards = [
    { id: "bun", name: "Bun", figure: "cast/bun" },
    { id: "duckling", name: "Duckling", figure: "entities/duckling" },
  ];
  const restState = (outdoor: boolean): RunState =>
    makeState({
      phase: "scene",
      sceneType: "rest",
      sceneId: "rest_bell_house",
      party: [makeMember({ character: makeCharacter({ id: "c_1", ownerPlayerId: "p_1", name: "Sparklehoof" }), playerId: "p_1" })],
      campMoment: { id: "rest:rest_bell_house|r:c:4", kind: "rest", outdoor, changes: {}, friends: { rotation: ["bun", "duckling"], out: ["bun", "duckling"], cards } },
    });

  it("indoors, to the scene's packed camp, which shows its words; outdoors, to the full camp; dropped where neither shows it", async () => {
    const load = vi.spyOn(Assets, "load").mockResolvedValue(Texture.WHITE as unknown as Record<string, unknown>);
    const { scene: s, app } = scene();
    const lobby = createLobbyCamp(app as unknown as Application, campLayoutFixture(), { loadTexture: () => Promise.reject(new Error("no art in tests")) });
    lobby.resize(1600, 900);
    try {
      s.setParty([member()]);
      const indoor = restState(false);
      lobby.sync(indoor);
      s.setPackedCamp(packedKits(indoor), packedFriends(indoor));
      await new Promise((resolve) => setTimeout(resolve, 0));
      // The bug (#654 review): the full camp is not up indoors, so it would drop this.
      expect(lobby.camp()).toBeNull();
      expect(lobby.showsFriend("bun")).toBe(false);
      expect(routeFriendTap({ friendId: "bun", heroId: "c_1", words: "Hi!" }, [lobby, packedTapTarget(s)])).toBe("start");
      expect(s.packedFriendWords()).toEqual([{ id: "bun", words: "Hi!" }]);
      // Neither shows the kid goat.
      expect(routeFriendTap({ friendId: "kid_goat", heroId: "c_1", words: "Maa!" }, [lobby, packedTapTarget(s)])).toBe("dropped");

      const outdoor = restState(true);
      lobby.sync(outdoor);
      s.setPackedCamp(null, []);
      expect(lobby.showsFriend("duckling")).toBe(true);
      expect(s.showsPackedFriend("duckling")).toBe(false);
      expect(routeFriendTap({ friendId: "duckling", heroId: "c_1", words: "Peep!" }, [lobby, packedTapTarget(s)])).toBe("start");
      expect(lobby.camp()!.friendWords()).toEqual([{ id: "friend:duckling", words: "Peep!" }]);
      expect(s.packedFriendWords()).toEqual([]);
    } finally { lobby.destroy(); s.destroy(); load.mockRestore(); }
  });
});

describe("art memory (art-memory.ts)", () => {
  /** Every live display object on the stage. */
  const live = (app: FakeApp): number => {
    let n = 0;
    const walk = (node: Container): void => {
      if (node.destroyed) return;
      n += 1;
      for (const child of node.children) walk(child as Container);
    };
    walk(app.stage);
    return n;
  };

  it("lets go of the board, and the fight's figures and tiles with it, once the fight is over", () => {
    const { scene: s, app } = scene();
    const story = live(app);
    s.setEncounter(encounterView());
    const fighting = live(app);
    expect(fighting).toBeGreaterThan(story);
    s.setEncounter(null);
    // Nothing of the board is left on the stage for the art sweep to count as drawn.
    expect(live(app)).toBe(story);
    // The next fight builds its own.
    s.setEncounter(encounterView());
    expect(live(app)).toBe(fighting);
    s.destroy();
  });
});
