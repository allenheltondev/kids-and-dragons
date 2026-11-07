// @vitest-environment jsdom
/**
 * Specials wherever she is drawn (docs/hero-looks.md §5.5, §9, §12; owner
 * 2026-11-07): not colours, but whole-figure looks.
 *
 * Every surface in the §9 inventory reaches her through one of the doors
 * hero-art.test.tsx holds it to: `CharacterPortrait` and `HeroImage` in the
 * DOM, `loadHeroTexture` on a Pixi stage. Each is shown here wearing a
 * special, on fixture paintings with fixture masks (no real mask ships yet):
 *
 *   - gold is paint: every door's tint request is gilded, whatever her
 *     colours, by the mask's figure or, on a cut-out with no mask, by the
 *     painting's own alpha; an opaque portrait with no mask draws as painted;
 *   - sparkles show over a gear portrait (laid on top of the opaque painting,
 *     in its own grid cell, never behind it), clipped by her figure made from
 *     its mask, and rest still under reduced motion;
 *   - `HeroImage` lays them in one box with her image, which wears the
 *     image's class and style, so whatever moves her moves them: nothing is
 *     measured or placed by hand;
 *   - on a Pixi stage they are a child of her sprite, clipped by its own
 *     alpha, twinkled by the ticker, or still under reduced motion; they go
 *     when she takes the special off, and with the figure;
 *   - every stage that puts her on a sprite hands that sprite over for them.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { Container, Sprite, Texture } from "pixi.js";
import type { ClassId, SpeciesId, TierId } from "@kad/shared";
import { characterPortraitArtUrl, characterWorldArtUrl, maskPathBeside } from "./art-paths";
import { coatMaskPaintings, setCoatMaskPaintings } from "./coat-masks";
import { SPARKLE, heroCoatOf, heroSparkleOf, sparkleAt, type HeroArtSubject } from "./hero-art";
import { HeroImage } from "./hero-art-dom";
import { loadHeroTexture } from "./hero-art-pixi";
import { CoatCache, setHeroCoats } from "./hero-coat-cache";
import { loadHeroCoats } from "./hero-coat-load";
import { slicedTintRunner } from "./hero-coat-pass";
import { CharacterPortrait } from "../screens/CharacterPortrait";
import { fakeUrls, pixelIO, servePainting } from "../testing/coat-fixture";

const AURORA = "aurora";
const GOLD = "gold";

function masked(...paintings: string[]): void {
  setCoatMaskPaintings([...coatMaskPaintings(), ...paintings.map((u) => u.slice("/assets/".length))]);
}

beforeEach(() => setCoatMaskPaintings([]));
afterEach(() => {
  cleanup();
  setCoatMaskPaintings(null);
  setHeroCoats(null);
  document.documentElement.removeAttribute("data-motion");
});

const unicorn = (special: string | null, over: Partial<{ tier: TierId; class: ClassId; coat: string; accent: string }> = {}): HeroArtSubject => ({
  species: "unicorn" as SpeciesId,
  tier: over.tier ?? "fledgling",
  class: over.class,
  look: { coat: over.coat ?? null, accent: over.accent ?? null, special },
});

/** A classed hero whose portrait is a gear portrait (an opaque painting). */
function gearHero(special: string | null): { hero: HeroArtSubject; portrait: string } {
  for (const cls of ["thornguard", "duskrunner", "starweaver", "songkeeper"] as ClassId[]) {
    for (const tier of ["sworn", "radiant", "mythic"] as TierId[]) {
      const portrait = characterPortraitArtUrl("unicorn", tier, cls);
      if (portrait.includes("gear-portraits/")) return { hero: unicorn(special, { tier, class: cls }), portrait };
    }
  }
  throw new Error("no gear portrait in the manifest");
}

describe("gold is paint (§5.5)", () => {
  it("is gilded on every door, whatever her colours, and keyed apart from them", () => {
    const world = characterWorldArtUrl("unicorn", "fledgling");
    const portrait = characterPortraitArtUrl("unicorn", "fledgling");
    masked(world, portrait);
    for (const place of ["world", "portrait"] as const) {
      const gold = heroCoatOf(unicorn(GOLD, { coat: "unicorn_sky", accent: "unicorn_accent_rose" }), place)!;
      expect(gold.paint).toEqual({ kind: "gilded", color: "#E2B13C" });
      expect(gold.mask).toBe(maskPathBeside(heroCoatOf(unicorn(GOLD), place)!.painting));
      expect(heroSparkleOf(unicorn(GOLD), place)).toBeNull();
    }
    // The cache's key covers both colours and the special.
    const keys = [
      heroCoatOf(unicorn(null, { coat: "unicorn_sky" }), "world")!.key,
      heroCoatOf(unicorn(null, { coat: "unicorn_sky", accent: "unicorn_accent_rose" }), "world")!.key,
      heroCoatOf(unicorn(null, { accent: "unicorn_accent_rose" }), "world")!.key,
      heroCoatOf(unicorn(GOLD, { coat: "unicorn_sky" }), "world")!.key,
    ];
    expect(new Set(keys).size).toBe(4);
    // Gold over any colours is one tint.
    expect(heroCoatOf(unicorn(GOLD, { coat: "unicorn_midnight" }), "world")!.key).toBe(keys[3]);
  });

  it("needs no mask on a cut-out painting (its alpha is her figure), and draws an opaque portrait with no mask as painted", () => {
    const request = heroCoatOf(unicorn(GOLD), "world")!;
    expect(request).toMatchObject({ mask: null, paint: { kind: "gilded" } });
    expect(heroCoatOf(gearHero(GOLD).hero, "portrait")).toBeNull();
    // Her colours still need the mask.
    expect(heroCoatOf(unicorn(null, { coat: "unicorn_sky" }), "world")).toBeNull();
  });
});

describe("sparkles in the DOM (§5.5)", () => {
  async function serving(...paintings: string[]) {
    await loadHeroCoats();
    const files = new Map();
    for (const p of paintings) servePainting(files, p, "#E2CDEC", 16);
    setHeroCoats(new CoatCache({ runner: slicedTintRunner(pixelIO(files)), urls: fakeUrls() }));
  }

  it("over a gear portrait: in the painting's own cell, on top of it, clipped by her figure made from its mask", async () => {
    const { hero, portrait } = gearHero(AURORA);
    masked(portrait);
    await serving(portrait);
    const { container } = render(<CharacterPortrait hero={hero} />);
    const box = container.querySelector(".portrait")!;
    expect(box.classList.contains("portrait--gear")).toBe(true);
    // Her figure is the tinter's: nothing shows until it is made.
    await waitFor(() => expect(box.querySelector(".hero-sparkle")).not.toBeNull());
    const img = box.querySelector("img")!;
    const stars = box.querySelector<HTMLElement>(".hero-sparkle")!;
    expect(stars.parentElement).toBe(img.parentElement);
    expect(img.compareDocumentPosition(stars) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stars.classList.contains("portrait__img")).toBe(true);
    expect(stars.dataset["sparkleClip"]).toMatch(/^blob:/);
    expect(stars.style.getPropertyValue("--hero-sparkle-mask")).toBe(`url("${stars.dataset["sparkleClip"]!}")`);
    expect(stars.getAttribute("aria-hidden")).toBe("true");
    expect(stars.classList.contains("hero-sparkle--still")).toBe(false);
    expect(heroSparkleOf(hero, "portrait")!.figure).toMatchObject({ mask: maskPathBeside(portrait), paint: { kind: "figure" } });
  });

  it("are still under reduced motion", async () => {
    document.documentElement.setAttribute("data-motion", "reduced");
    const { container } = render(<CharacterPortrait hero={unicorn(AURORA)} />);
    expect(container.querySelector(".hero-sparkle")!.classList.contains("hero-sparkle--still")).toBe(true);
    // The stylesheet's own word for it: no twinkle, a steady glow.
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "hero-sparkle.css"), "utf8");
    expect(css).toMatch(/\.hero-sparkle--still::after\s*\{[^}]*animation:\s*none !important/);
    expect(css).toMatch(/html\[data-motion="reduced"\] \.hero-sparkle::after\s*\{[^}]*animation:\s*none !important/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });

  it("on a cut-out painting are clipped by the painting itself, mask or none", () => {
    const portrait = characterPortraitArtUrl("unicorn", "fledgling");
    const { container } = render(<CharacterPortrait hero={unicorn(AURORA)} />);
    expect(container.querySelector<HTMLElement>(".hero-sparkle")!.dataset["sparkleClip"]).toBe(portrait);
  });

  it("are not there without the special, on an opaque portrait with no mask, or for creation's species", () => {
    const { hero, portrait } = gearHero(null);
    masked(portrait);
    expect(render(<CharacterPortrait hero={hero} />).container.querySelector(".hero-sparkle")).toBeNull();
    cleanup();
    setCoatMaskPaintings([]);
    expect(render(<CharacterPortrait hero={gearHero(AURORA).hero} />).container.querySelector(".hero-sparkle")).toBeNull();
    cleanup();
    expect(render(<CharacterPortrait species="unicorn" />).container.querySelector(".hero-sparkle")).toBeNull();
  });

  it("HeroImage: one box holds her image and the sparkles, wearing the image's class and style, so they move as one", () => {
    const { container } = render(
      <div>
        <HeroImage hero={unicorn(AURORA)} place="world" alt="" className="figure game-bob" style={{ left: "40%", transform: "translateX(-50%) rotate(-6deg)" }} />
      </div>,
    );
    const host = container.querySelector<HTMLElement>(".hero-sparkle-host")!;
    expect(host.parentElement).toBe(container.firstElementChild);
    // Whatever moves or animates the image (its class, its style) is on the box that holds both.
    expect(host.classList.contains("figure")).toBe(true);
    expect(host.classList.contains("game-bob")).toBe(true);
    expect(host.style.transform).toBe("translateX(-50%) rotate(-6deg)");
    expect(host.style.left).toBe("40%");
    const img = host.querySelector("img")!;
    const stars = host.querySelector<HTMLElement>(".hero-sparkle")!;
    expect(img.parentElement).toBe(host);
    expect(stars.parentElement).toBe(host);
    expect(img.classList.contains("hero-sparkle-host__img")).toBe(true);
    expect(img.classList.contains("figure")).toBe(false);
    // Nothing measured, nothing placed by hand.
    expect(stars.style.left).toBe("");
    expect(stars.style.top).toBe("");
    expect(stars.style.width).toBe("");
    expect(stars.dataset["sparkleClip"]).toBe(characterWorldArtUrl("unicorn", "fledgling"));
    // No special: the one <img> it always drew, with its class.
    cleanup();
    const plain = render(<div><HeroImage hero={unicorn(null)} place="world" alt="" className="figure" /></div>).container;
    expect(plain.firstElementChild!.children).toHaveLength(1);
    expect(plain.querySelector("img.figure")).not.toBeNull();
  });

  it("the stylesheets that reach a hero's image by element reach the box too", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    for (const [file, selector] of [
      ["world/StaticStage.css", ".kad-static-stage__figure > :is(img, .hero-sparkle-host)"],
      ["world/StaticStage.css", ".kad-static-camp__hero > :is(img, .hero-sparkle-host)"],
      ["screens/SkillGame.css", ".skill-scene__heroes > :is(img, .hero-sparkle-host)"],
      ["screens/RelayGame.css", ".relay-world__hero > :is(img, .hero-sparkle-host)"],
      ["screens/StoryInteraction.css", ".game-hero__face > :is(img, .hero-sparkle-host)"],
    ] as const) {
      expect(readFileSync(join(root, file), "utf8"), file).toContain(selector);
    }
  });
});

describe("sparkles on a Pixi stage (§5.5)", () => {
  function ticker() {
    const fns = new Set<() => void>();
    return { add: (fn: () => void) => fns.add(fn), remove: (fn: () => void) => fns.delete(fn), fns };
  }

  async function dressed(still: boolean) {
    const painted = new Texture();
    const loads: string[] = [];
    const load = (url: string) => {
      loads.push(url);
      return Promise.resolve(painted);
    };
    const t = ticker();
    let sprite: Sprite | null = null;
    const handle = loadHeroTexture(unicorn(AURORA), "world", (texture) => {
      if (sprite) {
        sprite.texture = texture;
        return;
      }
      sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 0.9);
      handle.dress(sprite);
    }, { load, sparkle: { still, ticker: t }, texture: { make: () => painted, destroy: () => undefined } });
    await waitFor(() => expect(sprite?.children.length ?? 0).toBeGreaterThan(0));
    return { handle, sprite: sprite!, loads, ticker: t };
  }

  const layerOf = (sprite: Sprite) => sprite.children.find((c) => c.label === "hero-sparkle") as Container | undefined;

  it("is a child of her sprite, clipped by its own alpha, twinkled by the ticker; gone with the special or the figure", async () => {
    const { handle, sprite, loads, ticker: t } = await dressed(false);
    // No mask is asked for: her sprite's own alpha is her figure.
    expect(loads.filter((u) => u.includes("coat-mask"))).toEqual([]);
    const layer = layerOf(sprite)!;
    expect(layer).toBeDefined();
    const clip = layer.mask as Sprite;
    expect(clip).toBeInstanceOf(Sprite);
    expect(clip.texture).toBe(sprite.texture);
    expect((layer as unknown as { _maskOptions: { channel: string } })._maskOptions.channel).toBe("alpha");
    expect(t.fns.size).toBe(1);

    handle.update(unicorn(null));
    expect(layerOf(sprite)).toBeUndefined();
    expect(t.fns.size).toBe(0);
    handle.update(unicorn(AURORA));
    expect(layerOf(sprite)).toBeDefined();
    handle();
    expect(layerOf(sprite)).toBeUndefined();
    expect(t.fns.size).toBe(0);
  });

  it("is still under reduced motion: no ticker, every star at a steady glow", async () => {
    const { sprite, ticker: t } = await dressed(true);
    expect(t.fns.size).toBe(0);
    const stars = layerOf(sprite)!.children[1] as Container;
    expect(stars.children.length).toBe(SPARKLE.count);
    for (const star of stars.children) expect(star.alpha).toBe(SPARKLE.still);
    expect(sparkleAt(0, 3, true)).toBe(SPARKLE.still);
    expect(sparkleAt(1234, 3, true)).toBe(SPARKLE.still);
  });

  it("twinkles: each star on its own beat, so she is never all lit or all dark", () => {
    for (const t of [0, 400, 1200, 2000]) {
      const lit = Array.from({ length: SPARKLE.count }, (_, i) => sparkleAt(t, i));
      expect(Math.max(...lit)).toBeGreaterThan(0.5);
      expect(Math.min(...lit)).toBeLessThan(0.2);
    }
    expect(sparkleAt(0, 1)).toBeCloseTo(sparkleAt(SPARKLE.periodMs, 1));
  });

  it("is handed every stage's sprite: each that puts her on one dresses it", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)));
    for (const file of ["scene.ts", "board.ts", "camp.ts"]) {
      const code = readFileSync(join(root, file), "utf8");
      expect(code, file).toMatch(/loadHeroTexture\(/);
      expect(code, file).toMatch(/heroArt\?\.dress\(sprite\)/);
    }
  });
});
