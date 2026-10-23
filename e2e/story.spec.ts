/**
 * The story so far (#358), in a real browser against the real stack.
 *
 * Ada plays the reference chapter on her phone, meets Pib (its revelation) and
 * camps at its ending. Her adventure book's Story page then lists the chapter
 * with its goal, Pib's words and how it ended, at two phone widths and on a small
 * tablet and a TV-sized screen, with nothing wider than the screen. Nothing
 * on the page is a control, and no chapter reads as "Done".
 *
 * `KAD_STORY_SHOTS=<dir>` saves the screens for review (the PR's pictures).
 */

import { test, expect, type Browser, type Page } from "@playwright/test";
import { createCharacter } from "./characters";
import { roomState } from "./room-state";

const TAP = { timeout: 20_000 } as const;
const API = "http://localhost:8787";
const SHOTS = process.env.KAD_STORY_SHOTS;
const GOAL = "Follow the humming in the wood all the way to where it comes from.";
const PIB = "\"I'm Pib,\" says the sprite";

const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "small-phone", width: 360, height: 640 },
  { name: "tablet", width: 1024, height: 600 },
  { name: "tv", width: 1280, height: 720 },
] as const;

/** The dev playtest jump, with the phone's own session, retried past a lost seq race. */
async function jumpTo(page: Page, code: string, sceneId: string): Promise<void> {
  const token = await page.evaluate((room) => JSON.parse(localStorage.getItem(`kad.session.${room}`) ?? "{}") as { playerId: string; sessionToken: string }, code);
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await roomState<{ runId: string; seq: number }>(page, code);
    const response = await fetch(`${API}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token.sessionToken}` },
      body: JSON.stringify({ runId: state.runId, playerId: token.playerId, seq: state.seq, intent: { type: "PLAYTEST_GOTO", sceneId } }),
    });
    const answer = (await response.json()) as { ok?: boolean; error?: { code: string } };
    if (answer.ok) return;
    if (answer.error?.code !== "STALE_SEQ") throw new Error(`PLAYTEST_GOTO ${sceneId}: ${JSON.stringify(answer.error)}`);
  }
  throw new Error("PLAYTEST_GOTO kept losing the seq race");
}

test.describe("the story so far", () => {
  const open: { close(): Promise<void> }[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function client(browser: Browser, width: number, height: number): Promise<Page> {
    const context = await browser.newContext({ viewport: { width, height } });
    open.push(context);
    return context.newPage();
  }

  test("a chapter played shows its goal, its revelation and how it ended, at every size", async ({ browser }) => {
    test.setTimeout(240_000);

    // --- Ada plays the chapter through Pib to its camp ---
    const phone = await client(browser, 390, 844);
    await phone.goto("/");
    await phone.getByRole("button", { name: /host a game/i }).click();
    await phone.getByText("Phone Mode").click();
    await phone.getByLabel("Your adventurer name").fill("Ada");
    await phone.getByRole("button", { name: /^start a game$/i }).click();
    await expect(phone).toHaveURL(/\/p\/[A-Z0-9]{4}$/);
    const code = new URL(phone.url()).pathname.split("/").pop()!;
    await createCharacter(phone, "unicorn", "Moonbeam");
    await phone.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect(phone.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0, TAP);
    await jumpTo(phone, code, "scene_pib");
    await jumpTo(phone, code, "rest_lanternfall");
    await expect.poll(async () => (await roomState<{ phase: string }>(phone, code)).phase, TAP).toBe("chapter_complete");

    // --- Her book's Story page, at each size, from the same phone's binding ---
    const storage = await phone.context().storageState();
    for (const size of SIZES) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, storageState: storage });
      open.push(context);
      const page = await context.newPage();
      await page.goto("/journal");
      // The story is the hero's own: it opens from the Hero page.
      await page.getByRole("navigation", { name: "About you" }).getByRole("button", { name: "Story" }).click(TAP);
      await expect(page.getByRole("heading", { name: "The story so far" })).toBeVisible(TAP);

      const campaign = page.getByRole("article", { name: "The Hollow Crown" });
      await expect(campaign).toBeVisible();
      const chapter = campaign.locator(".story__chapter").first();
      await expect(chapter.getByRole("heading", { name: "The Rustling Path" })).toBeVisible();
      await expect(chapter).toContainText(`Your goal: ${GOAL}`);
      await expect(chapter.locator(".story__revealed")).toContainText(PIB);
      await expect(chapter.locator(".story__ending")).toContainText("How it ended: You camp in the doorway");
      await expect(campaign).not.toContainText(/\bdone\b/i);

      // Read-only: nothing on the page itself is a button or a link.
      await expect(page.locator(".story").locator("button, a, input")).toHaveCount(0);
      // Nothing wider than the screen.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, size.name).toBeLessThanOrEqual(0);
      // The tray still fits: every tab is on screen.
      for (const tab of await page.getByRole("navigation", { name: "What to look at" }).getByRole("button").all()) {
        const box = (await tab.boundingBox())!;
        expect(box.x, size.name).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, size.name).toBeLessThanOrEqual(size.width + 0.5);
      }
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/story-${size.name}-${size.width}x${size.height}.png` });
    }
  });
});
