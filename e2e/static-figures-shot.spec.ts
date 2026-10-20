/** Review the real illustrated scene without creating a saved game. */
import { test, expect } from "@playwright/test";

test("photograph static figures on a TV", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const requests: string[] = [];
  page.on("request", request => requests.push(request.url()));
  await page.goto("/");
  await page.evaluate(async () => {
    // Vite serves these modules for this local review harness.
    const source = await (await fetch("/src/world/scene.ts")).text();
    const pixiUrl = source.match(/from ["']([^"']*pixi[^"']*)["']/)?.[1];
    if (!pixiUrl) throw new Error("Vite did not resolve the Pixi import");
    const { Application, Assets } = await import(pixiUrl);
    // @ts-expect-error browser module URL
    const { createScene } = await import("/src/world/scene.ts");
    // @ts-expect-error browser module URL
    const { makeMember, makeCharacter } = await import("/src/testing/fixtures.ts");
    const app = new Application();
    await app.init({ width: 1920, height: 1080, background: "#171329" });
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:99999";
    host.appendChild(app.canvas);
    document.body.appendChild(host);
    const scene = createScene(app);
    scene.resize(1920, 1080);
    scene.setBiome("enchanted_woods");
    const species = ["unicorn", "manticore", "griffin"];
    await Promise.all(species.map(id => Assets.load(`/assets/characters/${id}/fledgling/assembled.png`)));
    scene.setParty(species.map((id, i) => makeMember({ character: makeCharacter({ species: id, id: `c_${i}`, ownerPlayerId: `p_${i}`, name: id }) })));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect.poll(() => requests.filter(url => url.includes("/assembled.png")).length).toBeGreaterThanOrEqual(3);
  expect(requests.filter(url => /\.riv(?:\?|$)|rive.*\.wasm/.test(url))).toEqual([]);
  await page.screenshot({ path: "art/review/static-figures-tv.png" });
});
