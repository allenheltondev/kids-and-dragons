// @vitest-environment jsdom
/**
 * Her colour wherever she is drawn (docs/hero-looks.md §4.1, §5, §9, §12).
 *
 * Every surface in the §9 inventory draws a player's hero through one of
 * four doors (hero-art.test.tsx holds that line): `HeroImage` and
 * `CharacterPortrait` in the DOM (`useHeroArt` under both), and
 * `loadHeroTexture` on a Pixi stage. Each is shown here wearing her colour,
 * on fixture paintings with fixture masks (no real mask ships yet, #667,
 * #668), tinted by the real sliced tinter:
 *
 *   - the DOM and Pixi doors each show her tinted painting once its pass is
 *     done, and her painting as painted until then;
 *   - a classed hero at Sworn, Radiant and Mythic wears the same colour on
 *     the TV (her world figure), in the book and on a phone (her portrait);
 *   - a painting with no mask draws as painted, with no error and no request
 *     for a mask;
 *   - offline, a hero seen before shows her colour from the files the
 *     prefetch saved: her painting and its mask.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { Texture } from "pixi.js";
import type { ClassId, SpeciesId, TierId } from "@kad/shared";
import { makeChapter } from "../../../shared/src/test-fixtures";
import { characterPortraitArtUrl, characterWorldArtUrl, maskPathBeside } from "./art-paths";
import { setCoatMaskPaintings, coatMaskPaintings } from "./coat-masks";
import { heroCoatOf, heroOfflineArt, type HeroArtSubject } from "./hero-art";
import { HeroImage } from "./hero-art-dom";
import { loadHeroTexture } from "./hero-art-pixi";
import { CoatCache, setHeroCoats } from "./hero-coat-cache";
import { slicedTintRunner, type Pixels } from "./hero-coat-pass";
import { loadHeroCoats } from "./hero-coat-load";
import { hexToOklab, oklabDistance } from "./oklab";
import { CharacterPortrait } from "../screens/CharacterPortrait";
import { chapterAssets } from "../sw/chapter-art";
import { fakeUrls, pixelIO, regionMean, servePainting, syntheticPainting, type ServedIO } from "../testing/coat-fixture";

const SKY = { id: "unicorn_sky", color: "#3EC3FD" };
const GINGER = { id: "bigfoot_ginger", color: "#F57C00" };

let files: Map<string, Pixels>;
let io: ServedIO;
let urls: ReturnType<typeof fakeUrls>;
let cache: CoatCache;

function serve(...paintings: string[]): void {
  for (const url of paintings) servePainting(files, url, "#E2CDEC", 16);
  setCoatMaskPaintings([...coatMaskPaintings(), ...paintings.map((u) => u.slice("/assets/".length))]);
}

beforeEach(async () => {
  await loadHeroCoats();
  files = new Map();
  io = pixelIO(files);
  urls = fakeUrls();
  cache = new CoatCache({ runner: slicedTintRunner(io), urls });
  setHeroCoats(cache);
  setCoatMaskPaintings([]);
});

afterEach(() => {
  cleanup();
  setHeroCoats(null);
  setCoatMaskPaintings(null);
});

const unicorn = (over: Partial<{ tier: TierId; class: ClassId; coat: string | null }> = {}): HeroArtSubject => ({
  species: "unicorn" as SpeciesId,
  tier: over.tier ?? "fledgling",
  class: over.class,
  look: { coat: over.coat === undefined ? SKY.id : over.coat },
});

/** The mean colour of her region in what a blob URL was made of. */
async function blobColor(url: string): Promise<ReturnType<typeof hexToOklab>> {
  const blob = urls.blobs.get(url);
  expect(blob, url).toBeDefined();
  const pixels = new Uint8ClampedArray(await blob!.arrayBuffer());
  return regionMean(pixels, syntheticPainting("#E2CDEC", 16).mask.data);
}

const pixiOptions = (painted: Texture) => ({
  load: () => Promise.resolve(painted),
  texture: {
    make: (source: unknown) => ({ tinted: source }) as unknown as Texture,
    destroy: () => undefined,
  },
});

describe("the DOM doors (useHeroArt): HeroImage and CharacterPortrait", () => {
  it("HeroImage: as painted, then her tinted painting once its pass is done", async () => {
    const painting = characterWorldArtUrl("unicorn", "fledgling");
    serve(painting);
    const { container } = render(<HeroImage hero={unicorn()} place="world" alt="" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(painting);
    await waitFor(() => expect(img.getAttribute("src")).toMatch(/^blob:tint-/));
    expect(oklabDistance(await blobColor(img.getAttribute("src")!), hexToOklab(SKY.color))).toBeLessThan(0.08);
    expect(io.asked).toEqual([painting, maskPathBeside(painting)]);
  });

  it("CharacterPortrait: her portrait, tinted; and back to as painted when she picks no colour", async () => {
    const portrait = characterPortraitArtUrl("unicorn", "fledgling");
    serve(portrait);
    const { container, rerender } = render(<CharacterPortrait hero={unicorn()} />);
    const src = () => container.querySelector("img")!.getAttribute("src");
    await waitFor(() => expect(src()).toMatch(/^blob:tint-/));
    rerender(<CharacterPortrait hero={unicorn({ coat: null })} />);
    await waitFor(() => expect(src()).toBe(portrait));
  });

  it("holds what it shows while mounted, and lets go on unmount", async () => {
    const painting = characterWorldArtUrl("unicorn", "fledgling");
    serve(painting);
    const { unmount } = render(<HeroImage hero={unicorn()} place="world" alt="" />);
    await waitFor(() => expect(cache.stats().pinned).toBeGreaterThan(0));
    unmount();
    expect(cache.stats().pinned).toBe(0);
  });

  it("shows a colour already tinted on the first render, with no second pass", async () => {
    const painting = characterWorldArtUrl("unicorn", "fledgling");
    serve(painting);
    const first = render(<HeroImage hero={unicorn()} place="world" alt="" />);
    await waitFor(() => expect(first.container.querySelector("img")!.getAttribute("src")).toMatch(/^blob:/));
    const second = render(<HeroImage hero={unicorn()} place="world" alt="" />);
    expect(second.container.querySelector("img")!.getAttribute("src")).toMatch(/^blob:/);
    expect(io.asked.filter((u) => u === painting)).toHaveLength(1);
  });
});

describe("holdUntilTinted (the Style page): hidden until her colour is ready, never for good", () => {
  const visible = (img: Element): boolean => (img as HTMLElement).style.opacity !== "0";

  it("HeroImage: hidden while the pass runs, then shown tinted", async () => {
    const painting = characterWorldArtUrl("unicorn", "fledgling");
    serve(painting);
    const { container } = render(<HeroImage hero={unicorn()} place="world" alt="" holdUntilTinted />);
    const img = container.querySelector("img")!;
    expect(visible(img)).toBe(false);
    await waitFor(() => expect(img.getAttribute("src")).toMatch(/^blob:tint-/));
    expect(visible(img)).toBe(true);
  });

  it("HeroImage: a failed pass shows her painting, not nothing", async () => {
    const painting = characterWorldArtUrl("unicorn", "fledgling");
    serve(painting);
    setHeroCoats(new CoatCache({ runner: () => Promise.reject(new Error("no mask")), urls }));
    const { container } = render(<HeroImage hero={unicorn()} place="world" alt="" holdUntilTinted />);
    const img = container.querySelector("img")!;
    await waitFor(() => expect(visible(img)).toBe(true));
    expect(img.getAttribute("src")).toBe(painting);
  });

  it("HeroImage: a colour that already failed shows her painting at once", async () => {
    const painting = characterWorldArtUrl("unicorn", "fledgling");
    serve(painting);
    setHeroCoats(new CoatCache({ runner: () => Promise.reject(new Error("no mask")), urls }));
    const first = render(<HeroImage hero={unicorn()} place="world" alt="" holdUntilTinted />);
    await waitFor(() => expect(visible(first.container.querySelector("img")!)).toBe(true));
    const second = render(<HeroImage hero={unicorn()} place="world" alt="" holdUntilTinted />);
    await waitFor(() => expect(visible(second.container.querySelector("img")!)).toBe(true));
    expect(second.container.querySelector("img")!.getAttribute("src")).toBe(painting);
  });

  it("CharacterPortrait: a failed pass shows her portrait, not nothing", async () => {
    const portrait = characterPortraitArtUrl("unicorn", "fledgling");
    serve(portrait);
    setHeroCoats(new CoatCache({ runner: () => Promise.reject(new Error("no mask")), urls }));
    const { container } = render(<CharacterPortrait hero={unicorn()} holdUntilTinted />);
    const img = container.querySelector("img")!;
    await waitFor(() => expect(visible(img)).toBe(true));
    expect(img.getAttribute("src")).toBe(portrait);
  });
});

describe("the Pixi door (loadHeroTexture): the lineup, the board, the camp", () => {
  it("puts her painting on the sprite, then her tinted texture; update retints; stop lets go", async () => {
    const painting = characterWorldArtUrl("unicorn", "fledgling");
    serve(painting);
    const painted = { painted: true } as unknown as Texture;
    const used: unknown[] = [];
    const handle = loadHeroTexture(unicorn(), "world", (t) => used.push(t), pixiOptions(painted));
    await waitFor(() => expect(used).toHaveLength(2));
    expect(used[0]).toBe(painted);
    const tinted = (used[1] as unknown as { tinted: Pixels }).tinted;
    expect(oklabDistance(regionMean(tinted.data, syntheticPainting("#E2CDEC", 16).mask.data), hexToOklab(SKY.color))).toBeLessThan(0.08);
    expect(cache.stats().pinned).toBeGreaterThan(0);

    handle.update(unicorn({ coat: "unicorn_midnight" }));
    await waitFor(() => expect(used).toHaveLength(3));
    handle.update(unicorn({ coat: null }));
    expect(used[3]).toBe(painted);

    handle();
    expect(cache.stats().pinned).toBe(0);
  });
});

describe("a classed hero at Sworn, Radiant and Mythic (§4.1, §12)", () => {
  it("wears the same colour on the TV, in the book and on a phone: her world figure and her portrait", async () => {
    for (const tier of ["sworn", "radiant", "mythic"] as const) {
      const hero = unicorn({ tier, class: "thornguard" });
      const world = characterWorldArtUrl("unicorn", tier, "thornguard");
      const portrait = characterPortraitArtUrl("unicorn", tier, "thornguard");
      expect(world).toContain("/character-rigs/");
      expect(portrait).toContain("/gear-portraits/");
      serve(world, portrait);

      // The TV: her world figure on the stage.
      const used: unknown[] = [];
      const stop = loadHeroTexture(hero, "world", (t) => used.push(t), pixiOptions({} as Texture));
      await waitFor(() => expect(used.some((t) => (t as { tinted?: unknown }).tinted)).toBe(true));
      const tv = (used.find((t) => (t as { tinted?: unknown }).tinted) as { tinted: Pixels }).tinted;
      const tvColor = regionMean(tv.data, syntheticPainting("#E2CDEC", 16).mask.data);

      // The book and a phone: her portrait.
      const book = render(<CharacterPortrait hero={hero} backdrop lit />);
      const phone = render(<CharacterPortrait hero={hero} size="3em" />);
      const srcOf = (r: typeof book) => r.container.querySelector("img")!.getAttribute("src")!;
      await waitFor(() => expect(srcOf(book)).toMatch(/^blob:/));
      await waitFor(() => expect(srcOf(phone)).toMatch(/^blob:/));
      expect(srcOf(book)).toBe(srcOf(phone));
      const stillColor = await blobColor(srcOf(book));

      expect(oklabDistance(tvColor, stillColor), tier).toBeLessThan(0.01);
      expect(oklabDistance(tvColor, hexToOklab(SKY.color)), tier).toBeLessThan(0.08);
      stop();
      book.unmount();
      phone.unmount();
    }
  });
});

describe("a painting with no mask (§4.1, §12)", () => {
  it("draws as painted, with no error, and asks for no mask and loads no pass", async () => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.error);
    window.addEventListener("error", onError);
    const hero = unicorn({ tier: "sworn", class: "duskrunner" });
    expect(heroCoatOf(hero, "world")).toBeNull();
    expect(heroCoatOf(hero, "portrait")).toBeNull();
    const { container } = render(<><HeroImage hero={hero} place="world" alt="" /><CharacterPortrait hero={hero} /></>);
    const used: unknown[] = [];
    const asked: string[] = [];
    loadHeroTexture(hero, "world", (t) => used.push(t), { load: (u) => (asked.push(u), Promise.resolve({} as Texture)) });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const srcs = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(srcs).toEqual([characterWorldArtUrl("unicorn", "sworn", "duskrunner"), characterPortraitArtUrl("unicorn", "sworn", "duskrunner")]);
    expect(asked).toEqual([characterWorldArtUrl("unicorn", "sworn", "duskrunner")]);
    expect(used).toHaveLength(1);
    expect(io.asked).toEqual([]);
    expect(cache.stats().entries).toBe(0);
    expect(errors).toEqual([]);
    window.removeEventListener("error", onError);
  });

  it("draws another species' colour as painted too", () => {
    serve(characterWorldArtUrl("unicorn", "fledgling"));
    expect(heroCoatOf({ ...unicorn(), look: { coat: GINGER.id } }, "world")).toBeNull();
    // Nor a colour stored on the other part.
    expect(heroCoatOf({ ...unicorn(), look: { coat: null, accent: SKY.id } }, "world")).toBeNull();
  });
});

describe("her two colours (§5.2, two parts)", () => {
  const ROSE = { id: "unicorn_accent_rose", color: "#E7379C" };

  it("paints her main part and her accent part, each its own colour, in one pass", async () => {
    const painting = characterWorldArtUrl("unicorn", "fledgling");
    serve(painting);
    const { container } = render(<HeroImage hero={{ ...unicorn(), look: { coat: SKY.id, accent: ROSE.id } }} place="world" alt="" />);
    const img = container.querySelector("img")!;
    await waitFor(() => expect(img.getAttribute("src")).toMatch(/^blob:tint-/));
    const pixels = new Uint8ClampedArray(await urls.blobs.get(img.getAttribute("src")!)!.arrayBuffer());
    const { mask } = syntheticPainting("#E2CDEC", 16);
    expect(oklabDistance(regionMean(pixels, mask.data, 4, 0), hexToOklab(SKY.color))).toBeLessThan(0.08);
    expect(oklabDistance(regionMean(pixels, mask.data, 4, 1), hexToOklab(ROSE.color))).toBeLessThan(0.1);
    expect(cache.stats().entries).toBe(1);
  });

  it("draws an old look with only `coat` (written before her accent) as her main colour", async () => {
    const painting = characterWorldArtUrl("unicorn", "fledgling");
    serve(painting);
    const old = { species: "unicorn" as SpeciesId, tier: "fledgling" as TierId, look: { revision: 2, coat: SKY.id, nameplate: null, title: null, unlocked: [] } };
    expect(heroCoatOf(old, "world")!.paint).toEqual({ kind: "parts", main: SKY.color, accent: null });
    const { container } = render(<HeroImage hero={old} place="world" alt="" />);
    const img = container.querySelector("img")!;
    await waitFor(() => expect(img.getAttribute("src")).toMatch(/^blob:tint-/));
    expect(oklabDistance(await blobColor(img.getAttribute("src")!), hexToOklab(SKY.color))).toBeLessThan(0.08);
  });
});

describe("offline (§5.4)", () => {
  it("prefetches her mask with each painting, for every seated hero, figure and portrait", () => {
    const world = characterWorldArtUrl("unicorn", "radiant", "songkeeper");
    const portrait = characterPortraitArtUrl("unicorn", "radiant", "songkeeper");
    serve(world, portrait);
    const look = { revision: 1, coat: SKY.id, accent: null, special: null, nameplate: null, title: null, unlocked: [] };
    const party = [{ character: { species: "unicorn" as const, tier: "radiant" as const, class: "songkeeper" as const, look } }];
    const urls = chapterAssets(makeChapter(), party, coatMaskPaintings());
    for (const url of [world, maskPathBeside(world), portrait, maskPathBeside(portrait)]) expect(urls).toContain(url);
    // A hero drawn as painted (no colour, no special) needs no mask, so none is warmed.
    const plain = [{ character: { species: "unicorn" as const, tier: "radiant" as const, class: "songkeeper" as const } }];
    expect(chapterAssets(makeChapter(), plain, coatMaskPaintings()).filter((u) => u.includes("coat-mask"))).toEqual([]);
    // With no mask listed, only the paintings: nothing asks for a mask that is not there.
    expect(chapterAssets(makeChapter(), party, []).filter((u) => u.includes("coat-mask"))).toEqual([]);
    // And the book's warm step saves the same.
    expect(heroOfflineArt({ ...party[0]!.character })).toEqual(expect.arrayContaining([world, maskPathBeside(world), portrait, maskPathBeside(portrait)]));
  });

  it("shows a hero seen before in her colour, from only what the prefetch saved", async () => {
    const hero = unicorn({ tier: "mythic", class: "starweaver" });
    const portrait = characterPortraitArtUrl("unicorn", "mythic", "starweaver");
    const world = characterWorldArtUrl("unicorn", "mythic", "starweaver");
    serve(world, portrait);
    // What the service worker kept: the chapter's art for the seated party.
    const look = { revision: 1, coat: SKY.id, accent: null, special: null, nameplate: null, title: null, unlocked: [] };
    const saved = new Set(chapterAssets(null, [{ character: { species: "unicorn", tier: "mythic", class: "starweaver", look } }], coatMaskPaintings()));
    // No signal now: only saved files load.
    setHeroCoats(new CoatCache({ runner: slicedTintRunner(pixelIO(files, { available: (u) => saved.has(u) })), urls }));
    const { container } = render(<CharacterPortrait hero={hero} />);
    await waitFor(() => expect(container.querySelector("img")!.getAttribute("src")).toMatch(/^blob:/));
    expect(oklabDistance(await blobColor(container.querySelector("img")!.getAttribute("src")!), hexToOklab(SKY.color))).toBeLessThan(0.08);
  });
});
