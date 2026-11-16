/** Phone-to-TV repaint coverage on a slow TV without canvas filters. */
import { test, expect } from "@playwright/test";
import { onAir, openPhone, openTv, seedTable } from "./seed";

const TIZEN = "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 Chrome/76.0.3809.146 TV Safari/537.36";

test("phone colors repaint the TV and reuse a previous color texture", async ({ browser }, info) => {
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
  const timings: { color: string; responseMs: number; repaintMs: number }[] = [];
  try {
    const cdp = await tv.context.newCDPSession(tv.page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await onAir(tv.page);
    await onAir(phone.page);
    await phone.page.getByRole("button", { name: "You", exact: true }).click();
    await phone.page.locator('[data-testid="camp-button"]:visible').first().click();
    await phone.page.getByRole("tab", { name: "My camp", exact: true }).click();

    // Inspect the painted tent, rather than counting a state patch as a repaint.
    const texture = () => tv.page.evaluate(`(() => {
      const tent = window.__kadCamp?.()?.camp()?.view?.getChildByLabel("piece:tent_0", true);
      return tent?.children.filter(n => n.texture && !n.label.startsWith("camp-ground-"))
        .map(n => n.texture.uid).join(",") ?? "";
    })()`);
    await expect.poll(texture).not.toBe("");
    let firstBlue: string | undefined;
    for (const color of ["Blue", "Orange", "Green", "Blue"]) {
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
      timings.push({ color, responseMs, repaintMs: Date.now() - started });
    }
    await info.attach("phone-to-tv-timings", { body: JSON.stringify(timings, null, 2), contentType: "application/json" });
    await tv.page.screenshot({ path: info.outputPath("tv-camp.png") });
  } finally {
    await phone.context.close();
    await tv.context.close();
  }
});
