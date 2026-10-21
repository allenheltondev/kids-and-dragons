/**
 * True relative size and stance (#362), on the real shared screen.
 *
 * The owner's rules, checked as geometry through the dev-only `__kadScene()`
 * handle (world/PixiStage.tsx) and its `storyFigureReport()`:
 *
 *   - everybody stands in proportion to how tall canon says they are, the
 *     party line included (a bigfoot is two and a half kitsunes);
 *   - a big thing shrinks the stage a little; a huge one overflows it instead
 *     (the owner's call on #366): a dragon stands on the ground and runs off
 *     the top, a cloud whale runs off the right, with their names pinned on
 *     screen; a floor keeps a teapot-sized sprite from being a speck;
 *   - stance places a figure: hovering and flying are lifted off the ground
 *     with their names under them, swimming sits behind a water line;
 *   - reduced motion stills every idle.
 *
 * At 1280×720 (a TV) and 1024×600 (a small one), with the chapter's opening
 * scene re-cast by route, so no content changes to test it. Screenshots land
 * in the test output for review.
 */

import { test, expect, type Browser, type Page } from "@playwright/test";
import type { CastMember, Chapter } from "../packages/shared/src/index";
import { nameplatesCollide } from "../packages/client/src/world/nameplate";
import { createCharacter } from "./characters";

const TAP = { timeout: 20_000 } as const;

interface Reading {
  name: string | null;
  hero: boolean;
  heightCm: number;
  stance: string;
  paint: { x: number; y: number; width: number; height: number } | null;
  groundY: number;
  labelTop: number | null;
  overflow: "top" | "right" | null;
}

interface Label {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const PARTY = [
  ["kitsune", "Tumblefern"],
  ["bigfoot", "Bramblebeard"],
] as const;

async function report(page: Page): Promise<Reading[]> {
  return page.evaluate(() => {
    const get = (globalThis as Record<string, unknown>).__kadScene as
      | (() => { storyFigureReport?(): Reading[] } | null)
      | undefined;
    return get?.()?.storyFigureReport?.() ?? [];
  });
}

async function labels(page: Page): Promise<Label[]> {
  return page.evaluate(() => {
    const get = (globalThis as Record<string, unknown>).__kadScene as
      | (() => { storyNameplateBoxes?(): Label[] } | null)
      | undefined;
    return get?.()?.storyNameplateBoxes?.() ?? [];
  });
}

test.describe("true size and stance on the story stage", () => {
  const open: { close(): Promise<void> }[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  /** A TV showing the chapter's opening scene with `cast` standing in it. */
  async function stage(browser: Browser, width: number, height: number, cast: CastMember[]): Promise<Page> {
    const tvContext = await browser.newContext({ viewport: { width, height } });
    open.push(tvContext);
    await tvContext.route("**/content/chapters/*.json", async (route) => {
      const response = await route.fetch();
      const chapter = (await response.json()) as Chapter;
      const entry = chapter.scenes[chapter.entry];
      if (entry && entry.type !== "encounter") entry.cast = cast;
      await route.fulfill({ response, json: chapter });
    });
    const tv = await tvContext.newPage();
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/);
    const code = new URL(tv.url()).pathname.split("/").pop()!;

    const phones: Page[] = [];
    for (const [species, name] of PARTY) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      open.push(context);
      const phone = await context.newPage();
      await phone.goto("/");
      await phone.getByLabel(/room code/i).fill(code);
      await phone.getByRole("button", { name: /join a game/i }).click();
      await expect(phone).toHaveURL(new RegExp(`/p/${code}$`), TAP);
      await createCharacter(phone, species, name);
      phones.push(phone);
    }
    await phones[0]!.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect(tv.locator(".narration__body")).toBeVisible({ timeout: 30_000 });
    // Everybody in, art loaded and measured, the entrance walked.
    await expect
      .poll(async () => {
        const figures = await report(tv);
        return figures.length === PARTY.length + cast.length && figures.every((f) => f.paint !== null);
      }, { timeout: 30_000 })
      .toBe(true);
    await tv.waitForTimeout(2_500);
    return tv;
  }

  /** Two readings with motion off must match: every idle is still. */
  async function stillUnderReducedMotion(tv: Page): Promise<void> {
    await tv.evaluate(() => document.documentElement.setAttribute("data-motion", "reduced"));
    await tv.waitForTimeout(400);
    const a = await report(tv);
    await tv.waitForTimeout(900);
    const b = await report(tv);
    expect(b.map((f) => f.paint)).toEqual(a.map((f) => f.paint));
  }

  /**
   * Every name on the stage is on screen, above the narration plate, and
   * clear of the others: an overflowing figure's name is pinned inside the
   * part of it that shows.
   */
  async function namesOnScreen(tv: Page, width: number, required: string[]): Promise<void> {
    const names = await labels(tv);
    for (const name of required) expect(names.map((n) => n.text), name).toContain(name);
    const plate = await tv.locator(".narration__body").first().boundingBox();
    for (const name of names) {
      expect(name.x - name.width / 2, name.text).toBeGreaterThanOrEqual(0);
      expect(name.x + name.width / 2, name.text).toBeLessThanOrEqual(width);
      expect(name.y, name.text).toBeGreaterThanOrEqual(0);
      if (plate) expect(name.y + name.height, `${name.text} is above the narration`).toBeLessThanOrEqual(plate.y);
    }
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      expect(nameplatesCollide(names[i]!, names[j]!), `${names[i]!.text} / ${names[j]!.text}`).toBe(false);
    }
  }

  function byName(figures: Reading[], name: string): Reading {
    const found = figures.find((f) => f.name === name);
    expect(found, `${name} is on the stage`).toBeDefined();
    return found!;
  }

  for (const [width, height] of [[1280, 720], [1024, 600]] as const) {
    test(`a dragon runs off the top beside a teapot-sized sprite, at ${width}x${height}`, async ({ browser }, info) => {
      test.setTimeout(240_000);
      const tv = await stage(browser, width, height, [
        { figure: "cast/pib", name: "Pib" },
        { figure: "entities/legend_dragon", name: "The Old One" },
      ]);
      const figures = await report(tv);
      const dragonReading = byName(figures, "The Old One");
      const dragon = dragonReading.paint!;
      const pib = byName(figures, "Pib").paint!;
      const kitsune = byName(figures, "Tumblefern").paint!;
      const bigfoot = byName(figures, "Bramblebeard").paint!;

      // Too big for the frame: feet on the ground line, head off the top.
      expect(dragonReading.overflow).toBe("top");
      expect(dragon.y).toBeLessThan(0);
      expect(Math.abs(dragon.y + dragon.height - dragonReading.groundY)).toBeLessThan(dragon.height * 0.04);
      // It does not shrink anybody: the heroes stay in true proportion to each
      // other, and it never stands over the party.
      expect(bigfoot.height / kitsune.height).toBeCloseTo(215 / 85, 1);
      expect(dragon.x).toBeGreaterThan(bigfoot.x + bigfoot.width * 0.5);
      // The floor: Pib is a figure, not a speck.
      expect(pib.height).toBeGreaterThan(height * 0.04);
      expect(pib.height).toBeLessThan(kitsune.height);

      await namesOnScreen(tv, width, ["Pib", "The Old One"]);
      await tv.screenshot({ path: info.outputPath(`dragon-off-the-top-${width}x${height}.png`) });
      await stillUnderReducedMotion(tv);
    });

    test(`a cloud whale runs off the right, at ${width}x${height}`, async ({ browser }, info) => {
      test.setTimeout(240_000);
      const tv = await stage(browser, width, height, [{ figure: "entities/cloud_whale", name: "Cloud Whale" }]);
      const figures = await report(tv);
      const whaleReading = byName(figures, "Cloud Whale");
      const whale = whaleReading.paint!;
      const bigfoot = byName(figures, "Bramblebeard").paint!;

      // Wider than tall: anchored at its left, past the party, off the right edge.
      expect(whaleReading.overflow).toBe("right");
      expect(whale.x + whale.width).toBeGreaterThan(width);
      expect(whale.x).toBeGreaterThan(bigfoot.x + bigfoot.width * 0.5);
      expect(whale.x).toBeLessThan(width);
      // Its height fits the frame: in the air, its top on screen.
      expect(whale.y).toBeGreaterThanOrEqual(-2);
      expect(whale.y + whale.height).toBeLessThan(whaleReading.groundY);

      await namesOnScreen(tv, width, ["Cloud Whale"]);
      await tv.screenshot({ path: info.outputPath(`whale-off-the-right-${width}x${height}.png`) });
      await stillUnderReducedMotion(tv);
    });

    test(`every stance, and the party line in proportion, at ${width}x${height}`, async ({ browser }, info) => {
      test.setTimeout(240_000);
      const tv = await stage(browser, width, height, [
        { figure: "entities/will_o_wisp", name: "Flick" },
        { figure: "cast/captain_voss", name: "Captain Voss", stance: "flying" },
        { figure: "entities/merfolk", name: "Merrow" },
      ]);
      const figures = await report(tv);
      const kitsune = byName(figures, "Tumblefern");
      const bigfoot = byName(figures, "Bramblebeard");
      const wisp = byName(figures, "Flick");
      const voss = byName(figures, "Captain Voss");
      const merrow = byName(figures, "Merrow");

      // Hero species in true proportion to each other.
      expect(bigfoot.paint!.height / kitsune.paint!.height).toBeCloseTo(215 / 85, 1);
      // Standing: feet on the ground line.
      for (const hero of [kitsune, bigfoot]) {
        expect(hero.stance).toBe("standing");
        expect(Math.abs(hero.paint!.y + hero.paint!.height - hero.groundY)).toBeLessThan(hero.paint!.height * 0.06);
      }
      // Hovering and flying: lifted clear of the ground, the flyer further.
      expect(wisp.stance).toBe("hovering");
      expect(voss.stance).toBe("flying");
      const gap = (f: Reading) => f.groundY - (f.paint!.y + f.paint!.height);
      expect(gap(wisp)).toBeGreaterThan(0);
      expect(gap(voss)).toBeGreaterThan(voss.paint!.height * 0.25);
      // Their names follow them up: above the ground-level names.
      expect(voss.labelTop!).toBeLessThan(bigfoot.labelTop! - 20);
      expect(voss.labelTop!).toBeGreaterThan(voss.paint!.y + voss.paint!.height * 0.5);
      // Swimming: the lower body is below the water line.
      expect(merrow.stance).toBe("swimming");
      expect(merrow.paint!.y + merrow.paint!.height).toBeGreaterThan(merrow.groundY + merrow.paint!.height * 0.2);
      expect(merrow.paint!.y).toBeLessThan(merrow.groundY);

      // Raised figures move while idle; everybody stays put under reduced motion.
      const later = await (async () => { await tv.waitForTimeout(1_200); return report(tv); })();
      expect(byName(later, "Captain Voss").paint).not.toEqual(voss.paint);

      const names = await labels(tv);
      expect(names.length).toBe(5);
      for (const name of names) {
        expect(name.x - name.width / 2).toBeGreaterThanOrEqual(0);
        expect(name.x + name.width / 2).toBeLessThanOrEqual(width);
      }
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
        expect(nameplatesCollide(names[i]!, names[j]!), `${names[i]!.text} / ${names[j]!.text}`).toBe(false);
      }
      await tv.screenshot({ path: info.outputPath(`stances-${width}x${height}.png`) });
      await stillUnderReducedMotion(tv);
    });
  }
});
