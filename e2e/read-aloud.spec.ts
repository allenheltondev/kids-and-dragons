import { openPlayerTask } from "./player-navigation";
/**
 * Read-aloud (#261), end to end: a TV and a phone, each with its own switch.
 *
 * SpeechSynthesis is replaced by a recorder in every page, so the test asserts
 * on what each device was asked to say rather than on audio.
 */

import { test, expect, type Browser, type Page } from "@playwright/test";

const TAP = { timeout: 20_000 } as const;

async function createCharacter(page: Page, species: string, name: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(species, "i") }).first().click(TAP);
  await page.getByRole("button", { name: /^next$/i }).click(TAP);

  // Class — take whichever is first; every class is legal with every species.
  await page.locator(".creation-choice, .creation-card, button").filter({ hasText: /thornguard|duskrunner|starweaver|songkeeper/i }).first().click(TAP);
  await page.getByRole("button", { name: /^next$/i }).click(TAP);

  // Stats: spend every creation point. The "+" control is *hidden* once the
  // budget is gone, which is the assertion — nothing greyed out (spec §11).
  // Re-query every iteration: spending a point re-renders the row, so a
  // locator captured before the click can go stale under it.
  for (let i = 0; i < 12; i++) {
    const adds = page.getByRole("button", { name: /add a point to/i });
    if ((await adds.count()) === 0) break;
    await adds.first().click(TAP);
    await expect(page.getByRole("button", { name: /add a point to/i })).toHaveCount(
      i === 2 ? 0 : 4,
      { timeout: 5_000 },
    );
  }
  await expect(page.getByRole("button", { name: /add a point to/i })).toHaveCount(0);
  await page.getByRole("button", { name: /^next$/i }).click(TAP);

  // No appearance step: the server assigns colors (shared player-colors.ts).

  // Name. "Surprise me" has to be there — typing must never be required
  // (spec §5.5) — but the test types, so it can assert on the result later.
  await expect(page.getByRole("button", { name: /surprise me/i })).toBeVisible();
  await page.getByPlaceholder("Tap to type").fill(name, TAP);
  await page.getByRole("button", { name: /that's me/i }).click(TAP);
  await page.getByRole("button", { name: /^Ready to play$/i }).click(TAP);
}


const RECORDER = `
  window.__said = [];
  window.__cancels = 0;
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    speak: (u) => window.__said.push(u.text),
    cancel: () => { window.__cancels += 1; },
    getVoices: () => [],
  } });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
`;

const said = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __said: string[] }).__said);

test.describe("read-aloud", () => {
  const openContexts: Awaited<ReturnType<Browser["newContext"]>>[] = [];
  async function device(browser: Browser, width: number, height: number): Promise<Page> {
    const context = await browser.newContext({ viewport: { width, height } });
    openContexts.push(context);
    await context.addInitScript(RECORDER);
    return context.newPage();
  }
  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  test("the TV speaks the story, the phone speaks its own choices, and each switch is its own", async ({ browser }) => {
    const tv = await device(browser, 1280, 720);
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/);
    const code = new URL(tv.url()).pathname.split("/").pop()!;

    const controller = await device(browser, 390, 844);
    await controller.goto("/");
    await controller.getByLabel(/room code/i).fill(code);
    await controller.getByRole("button", { name: /join a game/i }).click();
    await createCharacter(controller, "unicorn", "Sparklehoof");
    await expect(controller.getByRole("button", { name: /wait, not yet/i })).toBeVisible();

    // The TV is the room's narrator, so it reads aloud with nothing tapped.
    await expect(tv.getByRole("button", { name: "Turn read-aloud off" })).toHaveAttribute("aria-pressed", "true");

    await controller.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await openPlayerTask(controller);

    // The TV reads the narration; this phone's switch is still off, so it says nothing
    // and draws no speaker icons.
    await expect.poll(async () => (await said(tv)).length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(await said(controller)).toEqual([]);
    await expect(controller.getByRole("button", { name: /^Hear:/ })).toHaveCount(0);

    // Turn this phone's on: speaker icons appear, and one reads just its choice.
    await controller.getByRole("button", { name: "Turn read-aloud on" }).click();
    const hearButtons = controller.getByRole("button", { name: /^Hear:/ });
    await expect(hearButtons.first()).toBeVisible();
    const label = (await controller.locator(".prompt .choice__label").first().textContent())!.trim();
    await hearButtons.first().click();
    await expect.poll(async () => (await said(controller)).includes(label), { timeout: 5_000 }).toBe(true);
    // Hearing is not choosing.
    await expect(controller.locator(".choice--on")).toHaveCount(0);

    // And it is remembered on this device.
    await controller.reload();
    await expect(controller.getByRole("button", { name: "Turn read-aloud off" })).toHaveAttribute("aria-pressed", "true");
  });
});
