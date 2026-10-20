/**
 * A lazy chunk that fails to load never blanks the app (#329). Each kind is
 * blocked with `page.route(...).abort()` and then let through:
 *
 *   an optional control (read-aloud, in the corner row): simply absent, the rest of
 *     the page still works, and it comes back when the signal does;
 *   a required screen (the adventure book) and the room itself (the layouts):
 *     a plain message with Try again, and Try again recovers;
 *   a chunk a deploy deleted (a 404): Try again reloads onto the new build
 *     once, and only once.
 *
 * Under the dev server each chunk is its own module (`/src/...`); in a build
 * it is a hashed `/bundle/...` chunk. Both are matched, as in lazy-audio.spec.ts.
 */

import { test, expect, type Page } from "@playwright/test";

const TAP = { timeout: 20_000 } as const;
const READ_ALOUD = /\/(?:src\/speech\/index\.ts|bundle\/speech-[^/]*\.js)(?:\?|$)/;
const JOURNAL = /\/(?:src\/screens\/JournalScreen\.tsx|bundle\/JournalScreen-[^/]*\.js)(?:\?|$)/;
const PARTY = /\/(?:src\/layout\/PartyLayout\.tsx|bundle\/PartyLayout-[^/]*\.js)(?:\?|$)/;
const TRY = { name: "Try again" } as const;

/** Every load of the page itself, counted from here on. */
function loads(page: Page): () => number {
  let count = 0;
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) count++; });
  return () => count;
}

test("an optional control that cannot load is absent, and the page keeps working", async ({ page }) => {
  await page.route(READ_ALOUD, (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("button", { name: /grown-ups: sign in/i })).toBeVisible(TAP);
  // The rest of the row still landed; only read-aloud is missing, and quietly.
  await expect(page.getByRole("button", { name: "Display settings" }).first()).toBeVisible(TAP);
  await expect(page.getByRole("button", { name: "Turn sound off" })).toBeVisible(TAP);
  await expect(page.getByRole("button", { name: /turn read-aloud/i })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);

  // It comes back with the signal.
  await page.unroute(READ_ALOUD);
  await page.evaluate(() => { dispatchEvent(new Event("online")); });
  await expect(page.getByRole("button", { name: "Turn read-aloud on" })).toBeVisible(TAP);
});

test("a required screen that cannot load says so, and Try again opens it", async ({ page }) => {
  await page.route(JOURNAL, (route) => route.abort());
  // Caught, and still reported (#322).
  const reported = page.waitForRequest((request) => request.url().endsWith("/api/client-error") && request.method() === "POST");
  await page.goto("/journal");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Your adventure book couldn’t open.", TAP);
  await reported;
  // The app around it is still up.
  await expect(page.getByRole("button", { name: "Display settings" }).first()).toBeVisible(TAP);

  await page.unroute(JOURNAL);
  await alert.getByRole("button", TRY).click();
  await expect(page.getByRole("heading", { name: /your adventure book is empty/i })).toBeVisible(TAP);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a room whose layout cannot load says so, and Try again brings the room", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route(PARTY, (route) => route.abort());
  await page.goto("/");
  await page.getByRole("button", { name: /host a game/i }).click(TAP);
  await page.getByText("Party Mode").click(TAP);
  await page.getByRole("button", { name: /open the lobby here/i }).click(TAP);
  await expect(page).toHaveURL(/\/tv\/[A-Z0-9]{4}$/);
  const alert = page.getByRole("alert").filter({ hasText: "The game couldn’t load." });
  await expect(alert).toBeVisible(TAP);

  await page.unroute(PARTY);
  await alert.getByRole("button", TRY).click();
  await expect(alert).toHaveCount(0, TAP);
  await expect(page.locator("[data-surface='world']")).toBeVisible(TAP);
});

test("a chunk a deploy deleted reloads the page once, and never loops", async ({ page }) => {
  // What the bucket says after `--delete`: the old hashed chunk is gone.
  await page.route(JOURNAL, (route) => route.fulfill({ status: 404, body: "" }));
  const pageLoads = loads(page);
  await page.goto("/journal");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Your adventure book couldn’t open.", TAP);
  expect(pageLoads()).toBe(1);

  // Try again finds the chunk gone and reloads onto the new build.
  await alert.getByRole("button", TRY).click();
  await expect.poll(pageLoads, TAP).toBe(2);
  await expect(alert).toContainText("Your adventure book couldn’t open.", TAP);

  // Still gone after the reload (a build that is itself broken): Try again
  // retries in place, and the page is not reloaded a second time.
  const probed = page.waitForRequest((request) => JOURNAL.test(request.url()) && request.method() === "HEAD");
  await alert.getByRole("button", TRY).click();
  await probed;
  await expect(alert).toContainText("Your adventure book couldn’t open.", TAP);
  await page.waitForTimeout(500);
  expect(pageLoads()).toBe(2);

  // And once the chunk is there, the same button opens the book.
  await page.unroute(JOURNAL);
  await alert.getByRole("button", TRY).click();
  await expect(page.getByRole("heading", { name: /your adventure book is empty/i })).toBeVisible(TAP);
});
