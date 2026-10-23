import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { characterArtUrl, characterWorldArtUrl, characterPortraitArtUrl, enemyArtUrl, biomeBackdropUrl, biomeTilesUrl, sceneBackdropUrl } from "../packages/client/src/world/art-paths";
import { castFigureUrl, ENSEMBLES } from "../packages/client/src/world/cast";
import { createCharacter } from "./characters";
import type { SpeciesId, TierId, ClassId } from "../packages/shared/src/index";

// Check what callers resolve, including references outside the art manifest.
const urls = new Set<string>();
const icons = new Set<string>();
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
function walk(value: unknown): void {
  if (typeof value === "string" && value.startsWith("/assets/") && /\.(png|webp|svg|jpg)$/.test(value)) urls.add(value);
  if (Array.isArray(value)) value.forEach(walk);
  else if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    if (typeof item.icon === "string") icons.add(item.icon);
    if (typeof item.art === "string") {
      const art = item.art;
      if (art.startsWith("enemies/")) urls.add(enemyArtUrl(art));
      else if (art.startsWith("plates/")) urls.add(`/assets/${art}.webp`);
      else { const url = sceneBackdropUrl(art); if (url) urls.add(url); }
    }
    if (typeof item.figure === "string") {
      const url = castFigureUrl(item.figure); if (url) urls.add(url);
      for (const part of ENSEMBLES[item.figure.replace(/^entities\//, "")] ?? []) urls.add(castFigureUrl(part)!);
    }
    Object.values(item).forEach(walk);
  }
}
for (const rel of readdirSync("content", { recursive: true })) {
  const file = String(rel);
  if (file.endsWith(".json") && !file.startsWith("drafts")) walk(json(path.join("content", file)));
}
for (const species of ["unicorn", "dragonling", "griffin", "bigfoot", "kitsune", "manticore"] as SpeciesId[]) {
  for (const tier of ["fledgling", "sworn", "radiant", "mythic"] as TierId[]) {
    urls.add(characterArtUrl(species, tier));
    for (const klass of ["thornguard", "duskrunner", "starweaver", "songkeeper"] as ClassId[]) {
      urls.add(characterWorldArtUrl(species, tier, klass));
      urls.add(characterPortraitArtUrl(species, tier, klass));
    }
  }
}
for (const file of readdirSync("content/chapters")) {
  if (!file.endsWith(".json")) continue;
  const chapter = json(`content/chapters/${file}`);
  if (chapter.biome) urls.add(biomeBackdropUrl(chapter.biome));
  if (Object.values(chapter.scenes).some((s: any) => s.type === "encounter") && chapter.biome) urls.add(biomeTilesUrl(chapter.biome));
}
for (const file of readdirSync("content/campaigns")) if (file.endsWith(".json")) urls.add(`/assets/campaigns/${json(`content/campaigns/${file}`).id}.webp`);
for (const file of readdirSync("assets/effects")) if (file.endsWith(".sheet.png")) urls.add(`/assets/effects/${file}`);
for (const file of readdirSync("assets/scenes/entry")) if (file.endsWith(".webp")) urls.add(`/assets/scenes/entry/${file}`);
for (const rel of readdirSync("packages/client/src", { recursive: true })) {
  const file = String(rel);
  if (!/\.(tsx?|css)$/.test(file) || file.includes(".test.")) continue;
  const full = path.join("packages/client/src", file);
  const source = readFileSync(full, "utf8");
  for (const match of source.matchAll(/(?:from\s+["']|url\(["']?)([^"')]+\.(?:png|webp|svg|jpg))/g)) {
    if (match[1]!.startsWith("/")) urls.add(match[1]!);
    else urls.add("/" + path.relative("packages/client", path.resolve(path.dirname(full), match[1]!)).replaceAll("\\", "/"));
  }
}

test("all runtime content, character and UI image URLs decode in the browser", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const failures: string[] = [];
  const all = [...urls];
  for (let i = 0; i < all.length; i += 8) {
    failures.push(...await page.evaluate(async (batch) => {
      return (await Promise.all(batch.map(async (url) => {
        const image = new Image(); image.src = url;
        try { await image.decode(); return image.naturalWidth ? null : url; }
        catch { return url; }
      }))).filter((v): v is string => v !== null);
    }, all.slice(i, i + 8)));
  }
  console.info(`Decoded ${all.length} runtime image URLs`);
  expect(failures).toEqual([]);
  const unknown = await page.evaluate(async (names) => {
    const modulePath = "/src/screens/icons.tsx";
    const { hasIcon } = await import(modulePath);
    return names.filter((name) => !hasIcon(name));
  }, [...icons]);
  expect(unknown, "content must never silently render the unknown glyph").toEqual([]);
});

test("every discovered guide entry renders its own illustration on phone and tablet", async ({ page }) => {
  test.setTimeout(180_000);
  const guide = json("content/field-guide.json");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /host a game/i }).click();
  await page.getByText("Phone Mode", { exact: true }).click();
  await page.getByLabel("Your adventurer name").fill("Art reviewer");
  await page.getByRole("button", { name: /^start a game$/i }).click();
  await createCharacter(page, "unicorn", "Moonbeam");
  await expect(page.getByRole("button", { name: /wait, not yet/i })).toBeVisible();
  await page.getByRole("navigation", { name: "What to look at" }).getByRole("button", { name: /^Guide$/ }).click();
  await page.evaluate(async (ids) => {
    const modulePath = "/src/store/field-guide-discoveries.ts";
    const { setFieldGuideDiscoveries } = await import(modulePath);
    setFieldGuideDiscoveries(Object.fromEntries(ids.map(id => [id, { firstFoundBy: "art-review", foundAt: new Date().toISOString() }])));
  }, Object.keys(guide.entries));
  for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    for (const [id, entry] of Object.entries<any>(guide.entries)) {
      await page.evaluate(async ({ id, ids }) => {
        const discoveriesPath = "/src/store/field-guide-discoveries.ts";
        (await import(discoveriesPath)).setFieldGuideDiscoveries(Object.fromEntries(ids.map(id => [id, { firstFoundBy: "art-review", foundAt: new Date().toISOString() }])));
        const modulePath = "/src/store/player-navigation.ts";
        (await import(modulePath)).openGuide(id);
      }, { id, ids: Object.keys(guide.entries) });
      const art = page.locator(".fgd__art img");
      await expect(art, id).toHaveAttribute("src", entry.art);
      await expect(art).toBeVisible();
      await expect.poll(() => art.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      if (["individual.marda_thorn", "location.exchange", "faction.deep_hollow_cult", "creature.loftmire"].includes(id)) {
        await page.screenshot({ path: test.info().outputPath(`${id}-${viewport.width}.png`) });
      }
    }
  }
});

test("the still-image experience keeps the story's cast and visible rift", async ({ page }) => {
  await page.route("**/src/world/PixiStage.tsx*", route => route.abort());
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await page.getByRole("button", { name: /host a game/i }).click();
  await page.getByText("Phone Mode", { exact: true }).click();
  await page.getByLabel("Your adventurer name").fill("Art reviewer");
  await page.getByRole("button", { name: /^start a game$/i }).click();
  await createCharacter(page, "unicorn", "Moonbeam");
  await expect(page.getByRole("button", { name: /wait, not yet/i })).toBeVisible();
  await page.getByRole("button", { name: /begin the adventure/i }).click();
  await expect(page.locator(".narration__body")).toBeVisible();
  await page.evaluate(async () => {
    const modulePath = "/src/store/index.ts";
    const { useGameStore } = await import(modulePath);
    const state = useGameStore.getState().state;
    await useGameStore.getState().loadChapter(state.chapterId);
    const chapter = useGameStore.getState().chapter;
    useGameStore.setState({
      chapter: { ...chapter, scenes: { ...chapter.scenes, art_review: {
        type: "story", narration: "Marda waits by a shimmering doorway.", choices: [],
        art: "scenes/gemfall/exchange-docks", rift: "steady",
        cast: [{ figure: "cast/marda_thorn", name: "Marda Thorn" }],
      }}},
      state: { ...state, sceneId: "art_review", encounter: null, narration: "Marda waits by a shimmering doorway." },
    });
  });
  const board = page.getByTestId("static-stage");
  await expect(board.locator('img[src="/assets/cast/marda_thorn/assembled.png"]')).toBeVisible();
  await expect(board.locator(".kad-static-stage__rift")).toBeVisible();
  await expect.poll(() => board.locator("img").evaluateAll((images) => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: test.info().outputPath("still-stage-tablet.png") });
});
