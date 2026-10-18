/**
 * The playtest drawer's lock, in the build families actually get (#263).
 *
 * The drawer (warp to a scene, load the next d20) sits behind
 * `import.meta.env.DEV`, which the production build replaces with `false`,
 * so the component is dead code there and should drop out of the bundle.
 * This proves both halves against a real production build: nothing of it
 * shipped, and a room's host, who has every real control, has no cheat.
 *
 * The server's half (the deployed stack never turns the cheats on) is
 * packages/server/src/lambda/runtime.test.ts. Runs under
 * playwright.prod.config.ts, which builds and serves the client.
 */

import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

const BUNDLE = path.resolve(import.meta.dirname, "..", "packages", "client", "dist");

/** Every script the production build emitted. */
function scripts(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return scripts(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

test.describe("production locks", () => {
  test("the playtest drawer is not in the build", () => {
    const files = scripts(BUNDLE);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(fs.readFileSync(file, "utf8"), path.relative(BUNDLE, file)).not.toContain("Playtest tools");
    }
  });

  test("a host has the room's controls, and no cheats", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const host = await context.newPage();
      await host.goto("/");
      await host.getByRole("button", { name: /want to host/i }).click();
      await host.getByText("Phone Mode").click();
      await host.getByLabel(/adventurer name/i).fill("Grown-up");
      await host.getByRole("button", { name: /^start a game$/i }).click();
      await expect(host).toHaveURL(/\/p\/[A-Z]{4}$/, { timeout: 15_000 });

      // The room is up and this phone is its host: the real controls are here...
      await expect(host.getByText("Running this room")).toBeVisible({ timeout: 15_000 });
      // ...and the author's drawer, which the dev build draws on this same screen, is not.
      await expect(host.getByRole("button", { name: /^playtest/i })).toHaveCount(0);
      await expect(host.getByRole("region", { name: "Playtest tools" })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
