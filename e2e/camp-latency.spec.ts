/** Phone-to-TV body texture assignment coverage on a slow TV without canvas filters. */
import { test, expect } from "@playwright/test";
import { kitAccent, type RunState } from "@kad/shared";
import { onAir, openPhone, openTv, seedTable } from "./seed";
import { roomState } from "./room-state";

const TIZEN = "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 Chrome/76.0.3809.146 TV Safari/537.36";

test("phone colors update the TV body texture and reuse a previous color texture", async ({ browser }, info) => {
  const table = await seedTable({
    mode: "party", tv: true,
    camp: { real: true, grownBy: ["gemfall"] },
    heroes: [{ name: "Pip", species: "unicorn" }],
  });
  const tv = await openTv(browser, table, { userAgent: TIZEN }, async context => {
    await context.addInitScript(() => {
      delete (CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>).filter;
    });
  });
  const phone = await openPhone(browser, table.phones[0]!);
  const timings: { color: string; responseMs: number; bodyTextureAssignedMs: number }[] = [];
  try {
    const cdp = await tv.context.newCDPSession(tv.page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await onAir(tv.page);
    await onAir(phone.page);
    await phone.page.getByRole("button", { name: "You", exact: true }).click();
    await phone.page.locator('[data-testid="camp-button"]:visible').first().click();
    await phone.page.getByRole("tab", { name: "My camp", exact: true }).click();

    // Inspect the assigned body texture, rather than counting a state patch.
    // This does not wait for the separate flap or a subsequent Pixi render.
    const texture = () => tv.page.evaluate(`(() => {
      const tent = window.__kadCamp?.()?.camp()?.view?.getChildByLabel("piece:tent_0", true);
      return tent?.children.filter(n => n.texture && !n.label.startsWith("camp-ground-"))
        .map(n => n.texture.uid).join(",") ?? "";
    })()`);
    await expect.poll(texture).not.toBe("");
    const state = await roomState<RunState>(phone.page, table.code);
    const hero = state.party[0]!.character;
    const initialAccent = kitAccent(state.kits?.[hero.id]?.color, hero.appearance.accent);
    // The seeded hero may already be blue. An idempotent pick correctly reuses
    // its texture; start with a different color before measuring real changes.
    const colors = initialAccent === kitAccent("meadow", "")
      ? ["Orange", "Blue", "Orange", "Green", "Blue"] : ["Blue", "Orange", "Green", "Blue"];
    let firstBlue: string | undefined;
    for (const color of colors) {
      const before = await texture();
      const started = Date.now();
      const response = phone.page.waitForResponse(r => r.url().endsWith("/api/action") && r.request().method() === "POST");
      await phone.page.getByRole("dialog").getByRole("button", { name: color, exact: true }).click();
      expect((await response).ok()).toBe(true);
      const responseMs = Date.now() - started;
      await expect.poll(texture).not.toBe(before);
      if (color === "Blue") {
        if (firstBlue === undefined) firstBlue = await texture();
        else expect(await texture()).toBe(firstBlue);
      }
      timings.push({ color, responseMs, bodyTextureAssignedMs: Date.now() - started });
    }
    await info.attach("phone-to-tv-timings", { body: JSON.stringify(timings, null, 2), contentType: "application/json" });
    await tv.page.screenshot({ path: info.outputPath("tv-camp.png") });
  } finally {
    await phone.context.close();
    await tv.context.close();
  }
});
