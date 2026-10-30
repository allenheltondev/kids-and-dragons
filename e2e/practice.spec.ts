/**
 * The practice (#255) on a real phone against the real server: a brand-new
 * hero is offered it, the hint for each step is on the phone with a button
 * that reads it aloud, and the first steps (a vote, a roll) play the way the
 * hints say. The whole chapter, fights included, is walked by the server suite
 * (handlers/practice.test.ts); this is the part only a browser can show.
 */

import { test, expect, type Page } from "@playwright/test";
import { createCharacter } from "./characters";
import { openPlayerTask } from "./player-navigation";
import { roomState } from "./room-state";
import { guidePicture } from "./guide-pictures";

const TAP = { timeout: 20_000 } as const;

test.describe("the practice", () => {
  const openContexts: { close(): Promise<void> }[] = [];
  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  test("a new hero is offered it, and plays its first steps by the hints alone", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    openContexts.push(context);
    const solo: Page = await context.newPage();

    await solo.goto("/");
    await solo.getByRole("button", { name: /host a game/i }).click(TAP);
    await solo.getByText("Phone Mode").click(TAP);
    await solo.getByLabel("Your adventurer name").fill("Allen", TAP);
    await solo.getByRole("button", { name: /start a game/i }).click(TAP);
    await expect(solo).toHaveURL(/\/p\/[A-Z]{4}$/);
    const code = new URL(solo.url()).pathname.split("/").pop()!;
    await createCharacter(solo, "unicorn", "Sparklehoof");

    // New here: the practice is offered, and Begin is still there, as the skip.
    await expect(solo.getByText(/Sparklehoof is new here/)).toBeVisible();
    await expect(solo.getByRole("button", { name: /skip the practice and begin the adventure/i })).toBeVisible();
    await solo.getByRole("button", { name: /^play the practice$/i }).click(TAP);
    await expect.poll(async () => (await roomState<{ chapterId: string }>(solo, code)).chapterId).toBe("first-steps-01");

    // Step one: the hint says how to vote, where the voting happens.
    await openPlayerTask(solo);
    const hint = solo.getByTestId("player-hint");
    await expect(hint).toContainText("Tap what you want to do on your phone, then tap Do it!");
    await expect(solo.getByRole("button", { name: "Hear the hint" })).toBeVisible();
    await guidePicture(solo, "practice-hint", { mark: solo.getByRole("button", { name: "Hear the hint" }) });
    await solo.locator(".prompt button").filter({ hasText: /open the gate/i }).first().click(TAP);
    // Pressed rather than clicked: at phone width the dev server's Playtest
    // drawer handle sits over the confirm bar, and production has no drawer.
    await solo.getByRole("button", { name: /do it!/i }).press("Enter", TAP);

    // Step two: the roll, and its hint.
    await expect.poll(async () => (await roomState<{ sceneId: string }>(solo, code)).sceneId).toBe("check_latch");
    await openPlayerTask(solo);
    await expect(hint).toContainText("When your phone says Roll, tap it.");
    await solo.getByRole("button", { name: /^roll/i }).first().press("Enter", TAP);
    // Pass or fail, the story goes on to meet Tansy.
    await expect
      .poll(async () => (await roomState<{ sceneId: string }>(solo, code)).sceneId, { timeout: 30_000 })
      .toBe("scene_tansy");

    // The shared screen shows the hint under the story too.
    await solo.getByRole("button", { name: /^World$/i }).click(TAP);
    await expect(solo.getByTestId("scene-hint")).toContainText("story turn");
  });
});
