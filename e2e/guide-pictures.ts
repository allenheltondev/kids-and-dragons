/**
 * Pictures for the grown-up's guide (#257), taken by the specs that already
 * walk each flow, so the guide shows the screens as they are today.
 *
 * Does nothing in an ordinary run. `npm run guide:pictures` runs every spec
 * that calls it with `KAD_GUIDE_PICTURES=1`, and then each call writes
 * `packages/client/public/guide-pictures/<name>.jpg`. The guide's test
 * (packages/client/src/guide/guide.test.ts) checks that every picture the
 * guide shows is taken by a spec and is on disk. Not a spec itself (no
 * `.spec.`), so Playwright does not collect it.
 */

import path from "node:path";
import type { Locator, Page } from "@playwright/test";

const OUT = path.resolve(import.meta.dirname, "..", "packages", "client", "public", "guide-pictures");

/** Whether this run takes the guide's pictures. */
export const takingGuidePictures = process.env.KAD_GUIDE_PICTURES === "1";

/**
 * Photograph a page, or one part of it, for the guide. `name` is the file
 * name without `.jpg`, as guide.md uses it. `mark` rings the button or buttons
 * the guide's words tell a grown-up to tap, so the eye finds it on the picture.
 */
export async function guidePicture(target: Page | Locator, name: string, options: { mark?: Locator | Locator[] } = {}): Promise<void> {
  if (!takingGuidePictures) return;
  const page = "page" in target && typeof target.page === "function" ? target.page() : (target as Page);
  // The dev drawer is a developer's tool, never part of what a grown-up sees.
  await page.addStyleTag({ content: ".playtest { display: none !important; }" }).catch(() => undefined);
  // Fonts and the picture behind the home screen, so a shot is never half drawn.
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  // The button the words name gets a gold ring, inside its own edge so a part of the screen never clips it.
  const wanted = options.mark === undefined ? [] : Array.isArray(options.mark) ? options.mark : [options.mark];
  // A button that is not on this screen is not ringed, rather than failing the picture.
  const marks: Locator[] = [];
  for (const mark of wanted) if ((await mark.count()) > 0) marks.push(mark.first());
  for (const mark of marks) {
    // On screen first: a ring below the fold is a ring nobody sees.
    await mark.scrollIntoViewIfNeeded().catch(() => undefined);
    await mark.evaluate((element) => {
      element.setAttribute("data-guide-mark", "");
    });
  }
  if (marks.length > 0) {
    await page.addStyleTag({
      content: `[data-guide-mark] { outline: 0.22em solid #f5c86c !important; outline-offset: -0.12em !important;
        box-shadow: 0 0 0 0.35em rgba(245, 200, 108, 0.35) inset !important; }`,
    });
  }
  await target.screenshot({
    path: path.join(OUT, `${name}.jpg`),
    type: "jpeg",
    quality: 70,
    animations: "disabled",
    caret: "hide",
    scale: "css",
  });
  for (const mark of marks) {
    await mark.evaluate((element) => {
      element.removeAttribute("data-guide-mark");
    });
  }
}
