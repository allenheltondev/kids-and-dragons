// @vitest-environment jsdom
/**
 * Special coats wherever she is drawn (docs/hero-looks.md §5.5, §9, §12; #669).
 *
 * Every surface in the §9 inventory reaches her through one of the doors
 * hero-art.test.tsx holds it to: `CharacterPortrait` and `HeroImage` in the
 * DOM, `loadHeroTexture` on a Pixi stage. Each is shown here wearing a special
 * coat, on fixture paintings with fixture masks (no real mask ships yet):
 *
 *   - a two-tone coat is still paint: every door's tint request carries both
 *     colours, and the real tinter paints her lit half one, her shaded half
 *     the other;
 *   - a shimmer shows over a gear portrait (laid on top of the opaque
 *     painting, never behind it), clipped by her coat mask so it lights only
 *     her coloured part, and is a still sheen under reduced motion;
 *   - on a Pixi stage the sweep is a child of her sprite, masked by her coat
 *     mask, moving with the ticker, or still under reduced motion; it goes
 *     when she picks another colour, and with the figure;
 *   - every stage that puts her on a sprite hands that sprite over for it.
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
import { SHIMMER, heroCoatOf, heroShimmerOf, shimmerAt, type HeroArtSubject } from "./hero-art";
import { HeroImage } from "./hero-art-dom";
import { loadHeroTexture } from "./hero-art-pixi";
import { CharacterPortrait } from "../screens/CharacterPortrait";

const AURORA = "unicorn_aurora";
const RIPPLE = "unicorn_raspberry_ripple";

function masked(...paintings: string[]): void {
  setCoatMaskPaintings([...coatMaskPaintings(), ...paintings.map((u) => u.slice("/assets/".length))]);
}

beforeEach(() => setCoatMaskPaintings([]));
afterEach(() => {
  cleanup();
  setCoatMaskPaintings(null);
  document.documentElement.removeAttribute("data-motion");
});

const unicorn = (coat: string | null, over: Partial<{ tier: TierId; class: ClassId }> = {}): HeroArtSubject => ({
  species: "unicorn" as SpeciesId,
  tier: over.tier ?? "fledgling",
  class: over.class,
  look: { coat },
});

/** A classed hero whose portrait is a gear portrait (an opaque painting). */
function gearHero(coat: string | null): { hero: HeroArtSubject; portrait: string } {
  for (const cls of ["thornguard", "duskrunner", "starweaver", "songkeeper"] as ClassId[]) {
    for (const tier of ["sworn", "radiant", "mythic"] as TierId[]) {
      const portrait = characterPortraitArtUrl("unicorn", tier, cls);
      if (portrait.includes("gear-portraits/")) return { hero: unicorn(coat, { tier, class: cls }), portrait };
    }
  }
  throw new Error("no gear portrait in the manifest");
}

describe("two-tone coats are paint (§5.5)", () => {
  it("ask every door for both colours, in the world and in a portrait", () => {
    const world = characterWorldArtUrl("unicorn", "fledgling");
    const portrait = characterPortraitArtUrl("unicorn", "fledgling");
    masked(world, portrait);
    for (const place of ["world", "portrait"] as const) {
      const request = heroCoatOf(unicorn(RIPPLE), place)!;
      expect(request.paint).toEqual({ kind: "two-tone", color: "#F89DC9", dark: "#742651" });
      expect(heroShimmerOf(unicorn(RIPPLE), place)).toBeNull();
    }
  });
});

describe("a shimmer in the DOM (§5.5)", () => {
  it("over a gear portrait: laid on top of the painting, clipped by her coat mask, sweeping", () => {
    const { hero, portrait } = gearHero(AURORA);
    masked(portrait);
    const { container } = render(<CharacterPortrait hero={hero} />);
    const box = container.querySelector(".portrait")!;
    expect(box.classList.contains("portrait--gear")).toBe(true);
    const img = box.querySelector("img")!;
    const sheen = box.querySelector<HTMLElement>(".hero-shimmer")!;
    expect(sheen).not.toBeNull();
    // Over, never behind: after the opaque painting, in the same cell.
    expect(img.compareDocumentPosition(sheen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sheen.classList.contains("portrait__img")).toBe(true);
    // Only her coloured part: clipped by the gear portrait's own mask.
    expect(sheen.dataset["shimmerMask"]).toBe(maskPathBeside(portrait));
    expect(sheen.style.getPropertyValue("--hero-shimmer-mask")).toBe(`url("${maskPathBeside(portrait)}")`);
    expect(sheen.getAttribute("aria-hidden")).toBe("true");
    expect(sheen.classList.contains("hero-shimmer--still")).toBe(false);
  });

  it("is a still sheen under reduced motion", () => {
    document.documentElement.setAttribute("data-motion", "reduced");
    const { hero, portrait } = gearHero(AURORA);
    masked(portrait);
    const { container } = render(<CharacterPortrait hero={hero} />);
    expect(container.querySelector(".hero-shimmer")!.classList.contains("hero-shimmer--still")).toBe(true);
    // The stylesheet's own word for it: no sweep, a resting band.
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "hero-shimmer.css"), "utf8");
    expect(css).toMatch(/\.hero-shimmer--still\s*\{[^}]*animation:\s*none !important/);
    expect(css).toMatch(/html\[data-motion="reduced"\] \.hero-shimmer\s*\{[^}]*animation:\s*none !important/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });

  it("is not there for a plain coat, a painting with no mask, or creation's species", () => {
    const { hero, portrait } = gearHero("unicorn_sky");
    masked(portrait);
    expect(render(<CharacterPortrait hero={hero} />).container.querySelector(".hero-shimmer")).toBeNull();
    cleanup();
    setCoatMaskPaintings([]);
    expect(render(<CharacterPortrait hero={gearHero(AURORA).hero} />).container.querySelector(".hero-shimmer")).toBeNull();
    cleanup();
    expect(render(<CharacterPortrait species="unicorn" />).container.querySelector(".hero-shimmer")).toBeNull();
  });

  it("HeroImage (the stages without WebGL, the games): a sibling laid over the image, out of the flow, clipped by its mask", () => {
    const world = characterWorldArtUrl("unicorn", "fledgling");
    masked(world);
    const { container } = render(
      <div>
        <HeroImage hero={unicorn(AURORA)} place="world" alt="" className="figure" />
      </div>,
    );
    const img = container.querySelector("img.figure")!;
    const sheen = img.nextElementSibling as HTMLElement;
    expect(sheen.classList.contains("hero-shimmer--over")).toBe(true);
    expect(sheen.dataset["shimmerMask"]).toBe(maskPathBeside(world));
    // Placed on the image's own box by measurement.
    expect(sheen.style.left).toMatch(/px$/);
    expect(sheen.style.width).toMatch(/px$/);
    // A plain coat draws the one <img> it always did.
    cleanup();
    const plain = render(<div><HeroImage hero={unicorn("unicorn_sky")} place="world" alt="" /></div>).container;
    expect(plain.firstElementChild!.children).toHaveLength(1);
  });
});

describe("a shimmer on a Pixi stage (§5.5)", () => {
  function ticker() {
    const fns = new Set<() => void>();
    return { add: (fn: () => void) => fns.add(fn), remove: (fn: () => void) => fns.delete(fn), fns };
  }

  async function dressed(still: boolean) {
    const world = characterWorldArtUrl("unicorn", "fledgling");
    masked(world);
    const painted = new Texture();
    const maskTexture = new Texture();
    const loads: string[] = [];
    const load = (url: string) => {
      loads.push(url);
      return Promise.resolve(url.endsWith("coat-mask.png") ? maskTexture : painted);
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
    }, { load, shimmer: { still, ticker: t }, texture: { make: () => painted, destroy: () => undefined } });
    await waitFor(() => expect(sprite?.children.length ?? 0).toBeGreaterThan(0));
    return { handle, sprite: sprite!, maskTexture, loads, ticker: t, world };
  }

  it("is a child of her sprite, masked by her coat mask, moved by the ticker; gone with another colour or the figure", async () => {
    const { handle, sprite, maskTexture, loads, ticker: t, world } = await dressed(false);
    expect(loads).toContain(maskPathBeside(world));
    const layer = sprite.children.find((c) => c.label === "hero-shimmer") as Container;
    expect(layer).toBeDefined();
    const clip = layer.mask as Sprite;
    expect(clip).toBeInstanceOf(Sprite);
    expect(clip.texture).toBe(maskTexture);
    expect(t.fns.size).toBe(1);

    handle.update(unicorn("unicorn_sky"));
    expect(sprite.children.find((c) => c.label === "hero-shimmer")).toBeUndefined();
    expect(t.fns.size).toBe(0);
    handle.update(unicorn(AURORA));
    await waitFor(() => expect(sprite.children.find((c) => c.label === "hero-shimmer")).toBeDefined());
    handle();
    expect(sprite.children.find((c) => c.label === "hero-shimmer")).toBeUndefined();
    expect(t.fns.size).toBe(0);
  });

  it("is still under reduced motion: no ticker, the band at rest across her middle", async () => {
    const { sprite, ticker: t } = await dressed(true);
    expect(t.fns.size).toBe(0);
    const layer = sprite.children.find((c) => c.label === "hero-shimmer") as Container;
    const band = layer.children[1] as Container;
    expect(band.visible).toBe(true);
    expect(shimmerAt(0, true)).toBe(0.5);
    expect(shimmerAt(SHIMMER.sweepMs + 10, true)).toBe(0.5);
  });

  it("sweeps every few seconds: across her during the sweep, nothing between", () => {
    expect(shimmerAt(0)).toBeCloseTo(-SHIMMER.band);
    expect(shimmerAt(SHIMMER.sweepMs / 2)).toBeCloseTo(0.5);
    expect(shimmerAt(SHIMMER.sweepMs + 1)).toBeNull();
    expect(shimmerAt(SHIMMER.periodMs + SHIMMER.sweepMs / 2)).toBeCloseTo(0.5);
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
