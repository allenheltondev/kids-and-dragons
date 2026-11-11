// @vitest-environment jsdom
/**
 * The name style on the TV (docs/hero-looks.md §7.2, §12; #664): the
 * nameplate collision rules extended to two rows and the frame.
 *
 *   - Four heroes with 16-character names and the catalog's longest title, at
 *     every party size, on the lineup and on the board: no two plates (names
 *     and titles) run together, and no name is drawn any smaller, or anywhere
 *     else, than the same name with no look.
 *   - A title is drawn at 0.6 of the name, and hidden (never shortened) when it
 *     would draw under 14px at 720p or run into a neighbour.
 *   - A hero with no look draws exactly as before: no title, no frame, the
 *     same boxes.
 *   - A frame whose art is not delivered is the plain plate: nothing drawn and
 *     nothing requested.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { Assets, Container, Text } from "pixi.js";
import type { Application } from "pixi.js";
import { beginEncounter, parseBoard } from "@kad/shared";
import type { HeroLookView, PartyMember, ResolvedCharacter } from "@kad/shared";
import { makeRules } from "../../../shared/src/test-fixtures";
import { fakeApp, installFakeCanvas2D, type FakeApp } from "../testing/fake-stage";
import { makeCharacter, makeMember } from "../testing/fixtures";
import { createScene } from "./scene";
import { createBoardLayer, type BoardViewState } from "./board";
import {
  NAMEPLATE_TITLE_SCALE,
  TITLE_MIN_PX_720,
  crowdedTitles,
  nameplatesCollide,
  titleMinFont,
  type NameplateBox,
} from "./nameplate";
import { heroNameStyle, longestTitle, nameplateFrameArt, LOOKS } from "./hero-name";

beforeAll(installFakeCanvas2D);

const NAMES = ["Moonlightbramble", "Skyclawthunderer", "Thistlewhisperer", "Puddlejumperzzzz"];
const TITLE = LOOKS.titles.find((t) => t.text === longestTitle())!.id;

const look = (over: Partial<HeroLookView> = {}): HeroLookView => ({ revision: 1, coat: null, accent: null, special: null, nameplate: "ribbon", title: TITLE, unlocked: [], ...over });

function party(size: number, styled: boolean): PartyMember[] {
  return NAMES.slice(0, size).map((name, i) =>
    makeMember({ character: makeCharacter({ id: `c_${String(i)}`, ownerPlayerId: `p_${String(i)}`, name, ...(styled ? { look: look() } : {}) }) }),
  );
}

function stage(): { scene: ReturnType<typeof createScene>; app: FakeApp } {
  const app = fakeApp();
  const scene = createScene(app as unknown as Application);
  scene.resize(1600, 900);
  return { scene, app };
}

function settle(app: FakeApp): void {
  for (let i = 0; i < 300; i++) app.ticker.frame(16);
}

function texts(app: FakeApp): string[] {
  const found: string[] = [];
  const walk = (node: Container): void => {
    if (node.destroyed) return;
    if (node instanceof Text) found.push(node.text);
    for (const child of node.children) walk(child as Container);
  };
  walk(app.stage);
  return found;
}

/** No box of one plate comes too close to any box of another. */
function noneCollide(plates: { name: NameplateBox; title: NameplateBox | null }[]): void {
  for (let i = 0; i < plates.length; i++) {
    for (let j = 0; j < plates.length; j++) {
      if (i === j) continue;
      const mine = [plates[i]!.name, ...(plates[i]!.title ? [plates[i]!.title!] : [])];
      const theirs = [plates[j]!.name, ...(plates[j]!.title ? [plates[j]!.title!] : [])];
      for (const a of mine) for (const b of theirs) expect(nameplatesCollide(a, b), `${a.text} against ${b.text}`).toBe(false);
    }
  }
}

describe("the lineup, two rows and the frame (§7.2)", () => {
  for (const size of [1, 2, 3, 4]) {
    it(`keeps ${String(size)} long names and the longest titles apart, every name as big as before`, () => {
      const plain = stage();
      plain.scene.setParty(party(size, false));
      settle(plain.app);
      const before = plain.scene.nameplateBoxes().boxes;

      const styled = stage();
      styled.scene.setParty(party(size, true));
      settle(styled.app);
      const names = styled.scene.nameplateBoxes().boxes;
      const titles = styled.scene.titleBoxes!().boxes;

      // The name exactly as today: same size, same place.
      expect(names).toEqual(before);
      // Titles shown here are under their own names, at 0.6 of them.
      expect(titles.length).toBeGreaterThan(0);
      const plates = names.map((name) => ({ name, title: titles.find((t) => Math.abs(t.x - name.x) < 1e-6) ?? null }));
      for (const plate of plates) if (plate.title) expect(plate.title.y).toBeGreaterThan(plate.name.y);
      noneCollide(plates);
      for (const t of titles) expect(t.y + t.height).toBeLessThanOrEqual(900 + 1e-6);
    });
  }

  it("draws the title at 0.6 of the name's type, and not under 14px at 720p", () => {
    const { scene, app } = stage();
    scene.setParty(party(4, true));
    settle(app);
    const title = (() => {
      let found: Text | null = null;
      const walk = (node: Container): void => {
        if (node instanceof Text && node.label === "nameplate-title" && node.visible) found ??= node;
        for (const child of node.children) walk(child as Container);
      };
      walk(app.stage);
      return found as Text | null;
    })();
    expect(title).not.toBeNull();
    const name = [...texts(app)].includes(NAMES[0]!);
    expect(name).toBe(true);
    expect(Number(title!.style.fontSize) * title!.scale.y * (720 / 900)).toBeGreaterThanOrEqual(TITLE_MIN_PX_720);
    expect(NAMEPLATE_TITLE_SCALE).toBe(0.6);
  });

  it("draws a hero with no look exactly as before: no title, no frame", () => {
    const { scene, app } = stage();
    scene.setParty(party(4, false));
    settle(app);
    expect(texts(app).sort()).toEqual([...NAMES].sort());
    expect(scene.titleBoxes!().boxes).toEqual([]);
  });

  it("takes a title off when her look changes, and hides it with the names", () => {
    const { scene, app } = stage();
    scene.setParty(party(2, true));
    settle(app);
    expect(scene.titleBoxes!().boxes).toHaveLength(2);
    scene.setNameplatesVisible(false);
    expect(scene.titleBoxes!().boxes).toEqual([]);
    scene.setNameplatesVisible(true);
    expect(scene.titleBoxes!().boxes).toHaveLength(2);
    scene.setParty(party(2, false));
    settle(app);
    expect(scene.titleBoxes!().boxes).toEqual([]);
    expect(texts(app).sort()).toEqual(NAMES.slice(0, 2).sort());
  });
});

describe("the board, two rows and the frame (§7.2)", () => {
  function boardOf(chars: ResolvedCharacter[]) {
    const encounter = beginEncounter(
      {
        board: parseBoard(["......", "......", "......", "......", "......", "......"]),
        party: chars.map((c, i) => ({ character: c, at: { x: 1 + i, y: 1 + (i % 2) } })),
        enemies: [{ spec: { id: "wisp", name: "Bramblewisp", count: 1, hp: 6, guard: 11, quick: 3, steps: 5, attack: 3 }, at: { x: 5, y: 5 } }],
      },
      { rules: makeRules(), abilities: {}, rng: { next: () => 0.5 } },
    );
    const layer = createBoardLayer();
    const view: BoardViewState = { encounter, biome: null, enemyArt: {}, party: chars.map((c) => makeMember({ character: c })) };
    layer.update(view);
    layer.tick(0.016);
    return layer;
  }

  for (const size of [1, 2, 3, 4]) {
    it(`keeps ${String(size)} long names apart with their titles, every name as big as before`, () => {
      const plain = boardOf(party(size, false).map((m) => m.character));
      const styled = boardOf(party(size, true).map((m) => m.character));
      expect(styled.nameplateBoxes()).toEqual(plain.nameplateBoxes());
      const names = styled.nameplateBoxes();
      const titles = styled.titleBoxes();
      noneCollide(names.map((name) => ({ name, title: titles.find((t) => Math.abs(t.x - name.x) < 1e-6) ?? null })));
    });
  }
});

describe("crowdedTitles", () => {
  const box = (text: string, x: number, y: number, width: number): NameplateBox => ({ text, x, y, width, height: 20 });

  it("hides a title that runs into a neighbour's name, and keeps one that does not", () => {
    const plates = [
      { name: box("Pip", 0, 0, 40), title: box("of the Hollow Crown", 0, 20, 190) },
      { name: box("Mo", 120, 20, 40), title: null },
      { name: box("Bo", 400, 0, 40), title: box("the Bold", 400, 20, 80) },
    ];
    expect(crowdedTitles(plates)).toEqual([true, false, false]);
  });

  it("lets the earlier of two touching titles keep its line", () => {
    const plates = [
      { name: box("Pip", 0, 0, 40), title: box("the Curious", 0, 20, 110) },
      { name: box("Mo", 300, 0, 40), title: box("Keeper of the Fire", 130, 20, 180) },
    ];
    expect(crowdedTitles(plates)).toEqual([false, true]);
  });

  it("turns 14px at 720p into a stage's own units", () => {
    expect(titleMinFont(0.8)).toBeCloseTo(17.5);
    expect(titleMinFont(0)).toBe(Infinity);
  });
});

describe("a frame with no art delivered (§7.2, #665)", () => {
  it("is the plain plate, and nothing is asked for", () => {
    expect(nameplateFrameArt("ribbon", new Set())).toBeNull();
    expect(heroNameStyle(look({ title: null }), LOOKS, new Set()).frame).toBeNull();
    const load = vi.spyOn(Assets, "load");
    const { scene, app } = stage();
    const undelivered = party(4, true);
    for (const member of undelivered) member.character.look!.nameplate = "songbird";
    scene.setParty(undelivered);
    settle(app);
    const asked = load.mock.calls.map((c) => String(c[0]));
    expect(asked.filter((url) => url.includes("nameplates/"))).toEqual([]);
    load.mockRestore();
  });

  it("is drawn from its painting once the manifest lists it", () => {
    expect(nameplateFrameArt("ribbon", new Set(["ribbon"]))).toMatchObject({ id: "ribbon", url: "/assets/nameplates/ribbon.webp" });
    expect(nameplateFrameArt("plain", new Set(["plain"]))).toBeNull();
  });
});

describe("NineSlice", () => {
  it("stretches its middle and keeps its corners", async () => {
    const { NineSlice } = await import("./nameplate");
    const { Texture: PixiTexture } = await import("pixi.js");
    const slice = new NineSlice(PixiTexture.WHITE, { left: 0, top: 0, right: 0, bottom: 0 });
    slice.width = 120;
    slice.height = 40;
    expect(slice.width).toBe(120);
    expect(slice.height).toBe(40);
    expect(slice.children).toHaveLength(9);
    const middle = slice.children[4]!;
    expect(middle.width).toBe(120);
    expect(middle.height).toBe(40);
  });
});
