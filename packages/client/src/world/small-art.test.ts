import { describe, expect, it } from "vitest";
import { biomeBackdropUrl, castArtUrl, enemyArtUrl, fitArt, sceneBackdropUrl, smallArtUrl, wantsSmallArt } from "./art-paths";

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

  it("names a half-size copy for backdrops and for figures that are not heroes, and nothing else", () => {
    expect(smallArtUrl("/assets/scenes/gemfall/canal-bridge.webp")).toBe("/assets/scenes/gemfall/canal-bridge@0.5x.webp");
    expect(smallArtUrl("/assets/biomes/enchanted_woods/bg.webp")).toBe("/assets/biomes/enchanted_woods/bg@0.5x.webp");
    expect(smallArtUrl("/assets/entities/river_drake/assembled.png")).toBe("/assets/entities/river_drake/assembled@0.5x.webp");
    expect(smallArtUrl("/assets/cast/keeper/assembled.png")).toBe("/assets/cast/keeper/assembled@0.5x.webp");
    for (const whole of [
      "/assets/characters/kitsune/mythic/assembled.png", // tinted from her mask, pixel for pixel
      "/assets/biomes/enchanted_woods/tiles.png", // cut into tiles by pixel
      "/assets/entities/river_drake/warning.png",
      "/assets/scenes/gemfall/canal-bridge@0.5x.webp", // a copy has no copy
    ]) expect(smallArtUrl(whole)).toBeNull();
  });

  it("leaves every URL as it was off a phone, which is every test and tool", () => {
    expect(biomeBackdropUrl("enchanted_woods")).toBe("/assets/biomes/enchanted_woods/bg.webp");
    expect(sceneBackdropUrl("scenes/gemfall/hollow-gate")).toBe("/assets/scenes/gemfall/hollow-gate.webp");
    expect(enemyArtUrl("enemies/will_o_wisp")).toBe("/assets/entities/will_o_wisp/assembled.png");
    expect(castArtUrl("characters/kitsune")).toBe("/assets/characters/kitsune/fledgling/assembled.png");
    expect(fitArt("/assets/entities/will_o_wisp/assembled.png", true)).toBe("/assets/entities/will_o_wisp/assembled@0.5x.webp");
    expect(fitArt("/assets/characters/kitsune/fledgling/assembled.png", true)).toBe("/assets/characters/kitsune/fledgling/assembled.png");
  });

  it("uses the name Pixi reads a half resolution from, so a sprite's size does not change", async () => {
    const { getResolutionOfUrl } = await import("pixi.js");
    expect(getResolutionOfUrl("/assets/scenes/gemfall/canal-bridge@0.5x.webp")).toBe(0.5);
  });
});
