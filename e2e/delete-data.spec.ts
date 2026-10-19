/**
 * Keeping and deleting (#252), in a real browser against the real stack: a
 * grown-up picks how long a kid who stops playing is kept, deletes one kid,
 * reads what the game stores, and deletes the group and everything in it.
 */

import { test, expect, type Page } from "@playwright/test";
import { guidePicture } from "./guide-pictures";

const TAP = { timeout: 20_000 } as const;

/** The dev sign-in: any eight digits work (`createDevAuthClient`). */
async function signIn(on: Page, email: string): Promise<void> {
  await on.getByLabel("Email").fill(email);
  await on.getByRole("button", { name: /send the code/i }).click();
  await on.getByLabel("The code").fill("12345678");
}

test("a grown-up keeps, then deletes, a group's data", async ({ browser }) => {
  test.setTimeout(120_000);
  const run = Date.now();
  const club = `Club ${run % 100000}`;
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1100 } });
  const page = await ctx.newPage();

  // What the game stores can be read before anybody signs in.
  await page.goto("/");
  await page.getByRole("button", { name: /run a group/i }).click(TAP);
  await page.getByRole("button", { name: /what we store about your family/i }).click(TAP);
  await expect(page.getByRole("heading", { name: "What we store" })).toBeVisible(TAP);
  await expect(page.getByText(/no kid ever has a login/i)).toBeVisible();
  await page.getByRole("button", { name: /^close$/i }).click();

  await signIn(page, `del-${run}@example.com`);
  await page.getByLabel("Start a new group").fill(club);
  await page.getByRole("button", { name: /start it/i }).click();
  await expect(page.getByRole("heading", { name: club })).toBeVisible(TAP);
  for (const kid of ["Posy", "Gullet"]) {
    await page.getByLabel("Add a kid").fill(kid);
    await page.getByRole("button", { name: /^add$/i }).click();
    await expect(page.getByText(kid, { exact: true })).toBeVisible(TAP);
  }

  // Kept for a month without playing, and that sticks.
  const keep = page.getByLabel("Keep a kid who stops playing for");
  await expect(keep).toHaveValue("");
  await keep.selectOption({ label: "A month without playing" });
  await expect(keep).toHaveValue("30", TAP);

  // Deleting a kid asks first, and keeping her changes nothing.
  await page.getByRole("button", { name: "Delete Posy" }).click();
  await page.getByRole("button", { name: "Keep Posy" }).click();
  await expect(page.getByText("Posy", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete Posy" }).click();
  await guidePicture(page.locator(".organizer__row", { hasText: "Posy" }), "delete-kid");
  await page.getByRole("group", { name: "Delete Posy?" }).getByRole("button", { name: "Delete Posy" }).click();
  await expect(page.getByText("Posy", { exact: true })).toHaveCount(0, TAP);
  await expect(page.getByText("Gullet", { exact: true })).toBeVisible();

  // The whole group, after one more question.
  await page.getByRole("button", { name: `Delete ${club} and everything in it` }).click();
  await page.getByRole("button", { name: `Delete ${club}`, exact: true }).click();
  await expect(page.getByRole("heading", { name: /your groups/i })).toBeVisible(TAP);
  await expect(page.getByRole("button", { name: new RegExp(club) })).toHaveCount(0);
  await ctx.close();
});
