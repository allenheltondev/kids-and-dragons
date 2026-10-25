/**
 * Captures the install manifest's `screenshots` (#461): a narrow phone shot and
 * a wide TV shot of the home screen, written over
 * packages/client/public/screenshots/. Starts nothing itself:
 *
 *   npm run pwa:screenshots -- http://localhost:5173 [outDir] [path]
 *
 * against a dev server or production build you already have running. `path`
 * (default "/") is the page to shoot; point it at a richer screen when one is
 * worth showing. Sizes must match `manifest.webmanifest`;
 * packages/client/src/sw/manifest.test.ts checks them.
 */

import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const SHOTS = [
  { file: "narrow.png", width: 390, height: 844, mobile: true },
  { file: "wide.png", width: 1920, height: 1080, mobile: false },
] as const;

const [base, outDir = "packages/client/public/screenshots", path = "/"] = process.argv.slice(2);
if (base === undefined) {
  console.error("usage: pwa:screenshots <baseUrl> [outDir] [path]");
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
// The preinstalled Chromium where Playwright's own is missing, as the e2e configs do.
const executablePath = process.env.KAD_CHROMIUM;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 1,
      isMobile: shot.mobile,
      hasTouch: shot.mobile,
    });
    const page = await context.newPage();
    await page.goto(new URL(path, base).toString(), { waitUntil: "networkidle" });
    await page.screenshot({ path: `${outDir}/${shot.file}`, type: "png" });
    await context.close();
    console.log(`${outDir}/${shot.file} ${shot.width}x${shot.height}`);
  }
} finally {
  await browser.close();
}
