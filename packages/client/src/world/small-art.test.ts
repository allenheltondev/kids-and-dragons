import { afterEach, describe, expect, it, vi } from "vitest";
import type { Chapter } from "@kad/shared";
import { chapterAssets } from "../sw/chapter-art";
import { swNextChapterArt } from "../sw/next-chapter";
import { campLayoutFor } from "./lobby-camp";
import { artCopyUrls, biomeBackdropUrl, castArtUrl, characterPortraitArtUrl, characterWorldArtUrl, coatMaskFor, enemyArtUrl, fitArt, maskPathBeside, paintingOfCopy, sceneBackdropUrl, smallArtUrl, wantsSmallArt, wholeArtUrl } from "./art-paths";
import { paintingIsCutOut } from "./coat-masks";

const PIXEL = "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15";
const OLD_IPAD = "Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1";
const SAMSUNG_TV = "Mozilla/5.0 (SMART-TV; Linux; Tizen 8.0) AppleWebKit/537.36 (KHTML, like Gecko) 108.0.5359.1/8.0 TV Safari/537.36";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

describe("small art", () => {
  it("is for phones only", () => {
    expect(wantsSmallArt(PIXEL, true)).toBe(true);
    expect(wantsSmallArt(IPHONE, true)).toBe(true);
    for (const big of [IPAD, OLD_IPAD, SAMSUNG_TV, ANDROID_TABLET, undefined]) expect(wantsSmallArt(big, true)).toBe(false);
  });

  it("is off, even on a phone, in a build that does not have every copy", () => {
    expect(wantsSmallArt(PIXEL, false)).toBe(false);
    // And wherever the build never said: a test, a tool.
    expect(wantsSmallArt(PIXEL)).toBe(false);
  });

  it("names a half-size copy for backdrops, plates and figures that are not heroes, and nothing else", () => {
    expect(smallArtUrl("/assets/scenes/gemfall/canal-bridge.webp")).toBe("/assets/scenes/gemfall/canal-bridge@0.5x.webp");
    expect(smallArtUrl("/assets/biomes/enchanted_woods/bg.webp")).toBe("/assets/biomes/enchanted_woods/bg@0.5x.webp");
    expect(smallArtUrl("/assets/plates/gemfall/03a.webp")).toBe("/assets/plates/gemfall/03a@0.5x.webp");
    expect(smallArtUrl("/assets/camp/backdrops/open_plains.webp")).toBe("/assets/camp/backdrops/open_plains@0.5x.webp");
    expect(smallArtUrl("/assets/entities/river_drake/assembled.png")).toBe("/assets/entities/river_drake/assembled@0.5x.webp");
    expect(smallArtUrl("/assets/cast/keeper/assembled.png")).toBe("/assets/cast/keeper/assembled@0.5x.webp");
    for (const whole of [
      "/assets/characters/kitsune/mythic/assembled.png", // tinted from her mask, pixel for pixel
      "/assets/character-rigs/thornguard/sworn/kitsune/assembled.png",
      "/assets/gear-portraits/thornguard/sworn/kitsune.png",
      "/assets/biomes/enchanted_woods/tiles.png", // cut into tiles by pixel
      "/assets/camp/frames/stage1/campfire.png",
      "/assets/entities/river_drake/warning.png",
      "/assets/scenes/gemfall/canal-bridge@0.5x.webp", // a copy has no copy
    ]) expect(smallArtUrl(whole)).toBeNull();
  });

  it("names a full-size WebP for every figure, a hero's among them, and never for a mask or a copy", () => {
    expect(wholeArtUrl("/assets/entities/river_drake/assembled.png")).toBe("/assets/entities/river_drake/assembled@1x.webp");
    expect(wholeArtUrl("/assets/cast/keeper/assembled.png")).toBe("/assets/cast/keeper/assembled@1x.webp");
    expect(wholeArtUrl("/assets/characters/kitsune/mythic/assembled.png")).toBe("/assets/characters/kitsune/mythic/assembled@1x.webp");
    expect(wholeArtUrl("/assets/character-rigs/thornguard/sworn/kitsune/assembled.png")).toBe("/assets/character-rigs/thornguard/sworn/kitsune/assembled@1x.webp");
    expect(wholeArtUrl("/assets/gear-portraits/thornguard/sworn/kitsune.png")).toBe("/assets/gear-portraits/thornguard/sworn/kitsune@1x.webp");
    for (const none of [
      "/assets/characters/kitsune/mythic/coat-mask.png", // her mask's channels are weights: lossless, as painted
      "/assets/gear-portraits/thornguard/sworn/kitsune.coat-mask.png",
      "/assets/scenes/gemfall/canal-bridge.webp", // a WebP already
      "/assets/biomes/enchanted_woods/tiles.png",
      "/assets/entities/river_drake/warning.png",
      "/assets/entities/river_drake/assembled@1x.webp",
      "/assets/entities/river_drake/assembled@0.5x.webp",
    ]) expect(wholeArtUrl(none)).toBeNull();
    expect(artCopyUrls("/assets/cast/keeper/assembled.png")).toEqual(["/assets/cast/keeper/assembled@0.5x.webp", "/assets/cast/keeper/assembled@1x.webp"]);
    expect(artCopyUrls("/assets/story-props/rope-basket.webp")).toEqual([]);
  });

  it("leaves every URL as it was in a build without the copies, which is every test and tool", () => {
    expect(biomeBackdropUrl("enchanted_woods")).toBe("/assets/biomes/enchanted_woods/bg.webp");
    expect(sceneBackdropUrl("scenes/gemfall/hollow-gate")).toBe("/assets/scenes/gemfall/hollow-gate.webp");
    expect(enemyArtUrl("enemies/will_o_wisp")).toBe("/assets/entities/will_o_wisp/assembled.png");
    expect(castArtUrl("characters/kitsune")).toBe("/assets/characters/kitsune/fledgling/assembled.png");
    expect(characterWorldArtUrl("kitsune", "sworn", "thornguard")).toBe("/assets/character-rigs/thornguard/sworn/kitsune/assembled.png");
    expect(characterPortraitArtUrl("kitsune", "sworn", "thornguard")).toBe("/assets/gear-portraits/thornguard/sworn/kitsune.png");
    expect(fitArt("/assets/plates/gemfall/03a.webp")).toBe("/assets/plates/gemfall/03a.webp");
  });

  it("fits a painting to the device: the half on a phone, the full-size WebP elsewhere, a hero's WebP on both", () => {
    const figure = "/assets/entities/will_o_wisp/assembled.png";
    const hero = "/assets/characters/kitsune/fledgling/assembled.png";
    const scene = "/assets/scenes/gemfall/hollow-gate.webp";
    // A phone, in a build with the copies.
    expect(fitArt(figure, true, true)).toBe("/assets/entities/will_o_wisp/assembled@0.5x.webp");
    expect(fitArt(scene, true, true)).toBe("/assets/scenes/gemfall/hollow-gate@0.5x.webp");
    expect(fitArt(hero, true, true)).toBe("/assets/characters/kitsune/fledgling/assembled@1x.webp");
    // A television, a tablet, a laptop.
    expect(fitArt(figure, false, true)).toBe("/assets/entities/will_o_wisp/assembled@1x.webp");
    expect(fitArt(scene, false, true)).toBe(scene);
    expect(fitArt(hero, false, true)).toBe("/assets/characters/kitsune/fledgling/assembled@1x.webp");
    // A build without them.
    for (const url of [figure, hero, scene]) expect(fitArt(url, false, false)).toBe(url);
  });

  it("finds a hero's mask, and whether she is a cut-out, from her full-size WebP as from her painting", () => {
    const base = "/assets/characters/kitsune/fledgling/assembled.png";
    const gear = "/assets/gear-portraits/thornguard/sworn/kitsune.png";
    const masked = ["characters/kitsune/fledgling/assembled.png", "gear-portraits/thornguard/sworn/kitsune.png"];
    for (const painting of [base, gear]) {
      const drawn = wholeArtUrl(painting)!;
      expect(paintingOfCopy(drawn)).toBe(painting);
      expect(paintingOfCopy(painting)).toBe(painting);
      expect(maskPathBeside(drawn)).toBe(maskPathBeside(painting));
      expect(coatMaskFor(drawn, masked)).toBe(coatMaskFor(painting, masked));
      expect(coatMaskFor(drawn, masked)).not.toBeNull();
      expect(coatMaskFor(drawn, [])).toBeNull();
      expect(paintingIsCutOut(drawn)).toBe(paintingIsCutOut(painting));
    }
    expect(maskPathBeside(wholeArtUrl(base)!)).toBe("/assets/characters/kitsune/fledgling/coat-mask.png");
    expect(maskPathBeside(wholeArtUrl(gear)!)).toBe("/assets/gear-portraits/thornguard/sworn/kitsune.coat-mask.png");
    expect(paintingIsCutOut(wholeArtUrl(base)!)).toBe(true);
    expect(paintingIsCutOut(wholeArtUrl(gear)!)).toBe(false);
  });

  it("uses the names Pixi reads a resolution from, so a sprite's size does not change", async () => {
    const { getResolutionOfUrl } = await import("pixi.js");
    expect(getResolutionOfUrl("/assets/scenes/gemfall/canal-bridge@0.5x.webp")).toBe(0.5);
    expect(getResolutionOfUrl("/assets/cast/keeper/assembled@1x.webp")).toBe(1);
  });

  /*
   * A build that has the copies, as the page and the worker see it: the one switch both read.
   * What the worker warms overnight must be, name for name, what the page then draws.
   */
  describe("in a build with every copy", () => {
    afterEach(() => vi.unstubAllGlobals());
    const on = (agent: string): void => {
      vi.stubGlobal("__KAD_SMALL_ART__", true);
      vi.stubGlobal("navigator", { userAgent: agent });
    };
    const CHAPTER = {
      id: "c-01",
      biome: "enchanted_woods",
      entry: "s_1",
      plate: { art: "plates/c/ch_1", narration: "A wood, very still." },
      scenes: {
        s_1: { type: "story", art: "scenes/c/gate", cast: [{ figure: "cast/keeper" }, { figure: "characters/kitsune" }], choices: [] },
        s_2: { type: "encounter", enemies: [{ creature: "will_o_wisp" }], choices: [] },
      },
    } as unknown as Chapter;
    const HERO = { character: { species: "kitsune", tier: "sworn", class: "thornguard", look: { coat: "moss" } } } as unknown as Parameters<typeof chapterAssets>[1][number];
    const MASKED = ["character-rigs/thornguard/sworn/kitsune/assembled.png", "gear-portraits/thornguard/sworn/kitsune.png"];

    it("warms on a phone the halves it draws, a hero's full-size WebP, and her masks as painted", () => {
      on(PIXEL);
      expect(swNextChapterArt([CHAPTER], [HERO], MASKED)).toEqual([
        "/assets/plates/c/ch_1@0.5x.webp",
        "/assets/character-rigs/thornguard/sworn/kitsune/assembled@1x.webp",
        "/assets/character-rigs/thornguard/sworn/kitsune/coat-mask.png",
        "/assets/gear-portraits/thornguard/sworn/kitsune@1x.webp",
        "/assets/gear-portraits/thornguard/sworn/kitsune.coat-mask.png",
        "/assets/scenes/c/gate@0.5x.webp",
        "/assets/cast/keeper/assembled@0.5x.webp",
        "/assets/characters/kitsune/fledgling/assembled@1x.webp",
        "/assets/biomes/enchanted_woods/bg@0.5x.webp",
        "/assets/biomes/enchanted_woods/tiles.png",
        "/assets/entities/will_o_wisp/assembled@0.5x.webp",
      ]);
      // The same names the page asks for.
      expect(sceneBackdropUrl("scenes/c/gate")).toBe("/assets/scenes/c/gate@0.5x.webp");
      expect(castArtUrl("cast/keeper")).toBe("/assets/cast/keeper/assembled@0.5x.webp");
      expect(enemyArtUrl("enemies/will_o_wisp")).toBe("/assets/entities/will_o_wisp/assembled@0.5x.webp");
      expect(characterWorldArtUrl("kitsune", "sworn", "thornguard")).toBe("/assets/character-rigs/thornguard/sworn/kitsune/assembled@1x.webp");
    });

    it("warms on a television the full-size WebPs of its figures, and its backdrops and plates as painted", () => {
      on(SAMSUNG_TV);
      expect(swNextChapterArt([CHAPTER], [HERO], MASKED)).toEqual([
        "/assets/plates/c/ch_1.webp",
        "/assets/character-rigs/thornguard/sworn/kitsune/assembled@1x.webp",
        "/assets/character-rigs/thornguard/sworn/kitsune/coat-mask.png",
        "/assets/gear-portraits/thornguard/sworn/kitsune@1x.webp",
        "/assets/gear-portraits/thornguard/sworn/kitsune.coat-mask.png",
        "/assets/scenes/c/gate.webp",
        "/assets/cast/keeper/assembled@1x.webp",
        "/assets/characters/kitsune/fledgling/assembled@1x.webp",
        "/assets/biomes/enchanted_woods/bg.webp",
        "/assets/biomes/enchanted_woods/tiles.png",
        "/assets/entities/will_o_wisp/assembled@1x.webp",
      ]);
    });

    it("pitches a phone's camp on the half-size backdrop, and a television's on the painting", () => {
      on(PIXEL);
      // Parsed once per stage and family, so each device is asked for a stage of its own here.
      expect(campLayoutFor(2)?.backdrop.path).toBe("camp/backdrops/open_plains@0.5x.webp");
      on(SAMSUNG_TV);
      expect(campLayoutFor(3)?.backdrop.path).toBe("camp/backdrops/open_plains.webp");
    });
  });
});
