/**
 * Display settings (#262), end to end: with the largest text, high contrast, less movement
 * and one-handed play all on, the key controls of every player surface are still where a
 * thumb can tap them, and nothing is sitting on top of anything else.
 *
 * "Clickable" means Playwright's own hit-target check passes (a trial click fails when another
 * element would receive the pointer event), plus the control is inside the viewport and does not
 * overlap its neighbours in the corner row. The same flows run at default settings in the
 * atlas, first-playable and read-aloud specs.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";
import { createCharacter } from "./characters";
import { openPlayerTask } from "./player-navigation";
import { guidePicture } from "./guide-pictures";

const TAP = { timeout: 20_000 } as const;

interface Prefs { text: string; contrast: boolean; motion: boolean; hand: string }
const EVERYTHING_ON: Prefs = { text: "largest", contrast: true, motion: true, hand: "right" };

async function withPrefs(page: Page, prefs: Prefs): Promise<void> {
  await page.addInitScript((value) => {
    localStorage.setItem("kad.a11y", JSON.stringify(value));
    // The Playtest drawer is dev-server tooling that production builds do not contain
    // (PlayerView: `import.meta.env.DEV`), and it floats over the foot of the player pane.
    // The tappability checks are about what ships, so it is taken out of the way.
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = ".playtest { display: none !important; }";
      document.head.append(style);
    });
  }, prefs);
}

/** Visible, inside the viewport, and the pointer would reach it rather than something on top. */
async function expectTappable(page: Page, control: Locator, what: string): Promise<void> {
  await expect(control, `${what} is visible`).toBeVisible(TAP);
  const box = await control.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box, `${what} has a box`).not.toBeNull();
  expect(box!.x, `${what} inside the left edge`).toBeGreaterThanOrEqual(-0.5);
  expect(box!.y, `${what} inside the top edge`).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width, `${what} inside the right edge`).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box!.y + box!.height, `${what} inside the bottom edge`).toBeLessThanOrEqual(viewport.height + 0.5);
  expect(box!.width, `${what} is a real target`).toBeGreaterThanOrEqual(43);
  expect(box!.height, `${what} is a real target`).toBeGreaterThanOrEqual(43);
  // Throws if another element would intercept the pointer event.
  await control.click({ trial: true, timeout: 5_000 });
}

/** No two of the boxes overlap. */
async function expectApart(controls: { name: string; locator: Locator }[]): Promise<void> {
  const boxes = [];
  for (const { name, locator } of controls) {
    const box = await locator.boundingBox();
    expect(box, `${name} has a box`).not.toBeNull();
    boxes.push({ name, ...box! });
  }
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const one = boxes[a]!;
      const two = boxes[b]!;
      const overlaps = one.x < two.x + two.width - 0.5 && two.x < one.x + one.width - 0.5
        && one.y < two.y + two.height - 0.5 && two.y < one.y + one.height - 0.5;
      expect(overlaps, `${one.name} overlaps ${two.name}`).toBe(false);
    }
  }
}

/**
 * The corner row's controls. A phone that has joined a Party Mode room has no sound control: the TV is the
 * speaker. Help (#256) is on the phones in a room, and nowhere else: not the TV, not the join screen.
 */
function corner(page: Page, sound = true, help = false): { name: string; locator: Locator }[] {
  return [
    ...(help ? [{ name: "Help", locator: page.getByRole("button", { name: "Help", exact: true }) }] : []),
    { name: "Display settings", locator: page.getByRole("button", { name: "Display settings" }).first() },
    { name: "Read-aloud", locator: page.getByRole("button", { name: /turn read-aloud/i }) },
    ...(sound ? [{ name: "Sound", locator: page.getByRole("button", { name: /turn sound/i }) }] : []),
  ];
}

async function expectCornerClear(page: Page, sound = true, help = false): Promise<void> {
  for (const { name, locator } of corner(page, sound, help)) await expectTappable(page, locator, name);
  await expectApart(corner(page, sound, help));
}

async function expectNoSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page does not scroll sideways").toBeLessThanOrEqual(1);
}

async function expectSettingsApplied(page: Page, prefs: Prefs): Promise<void> {
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-text", prefs.text);
  await expect(root).toHaveAttribute("data-contrast", "high");
  await expect(root).toHaveAttribute("data-motion", "reduced");
  await expect(root).toHaveAttribute("data-hand", prefs.hand);
}

async function openAdventure(page: Page, name: string): Promise<void> {
  await createCharacter(page, "unicorn", name);
  await expect(page.getByRole("button", { name: /wait, not yet/i })).toBeVisible(TAP);
  await page.getByRole("button", { name: /begin the adventure/i }).click(TAP);
  await expect(page.locator(".player__scroll:visible .player__task-entry, .player__prompt:visible .prompt__title")
    .filter({ hasText: /Your turn|What do you do/i }).first()).toBeVisible(TAP);
}

/** The roll card is drawn whole, inside the screen, whatever the text size. */
async function expectDiceInside(page: Page): Promise<void> {
  const card = page.locator(".dice__card").first();
  await expect(card, "the roll card shows").toBeVisible(TAP);
  const viewport = page.viewportSize()!;
  const box = (await card.boundingBox())!;
  expect(box.x, "dice card inside the left edge").toBeGreaterThanOrEqual(-0.5);
  expect(box.y, "dice card inside the top edge").toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width, "dice card inside the right edge").toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box.y + box.height, "dice card inside the bottom edge").toBeLessThanOrEqual(viewport.height + 0.5);
}

/** The help sheet: the words for the screen that is up, both buttons reachable, and it closes. */
async function useHelpSheet(page: Page, words: RegExp): Promise<void> {
  await page.getByRole("button", { name: "Help", exact: true }).click(TAP);
  const sheet = page.getByRole("dialog", { name: "Help" });
  await expect(sheet).toBeVisible(TAP);
  await expect(sheet).toContainText(words);
  const viewport = page.viewportSize()!;
  const box = (await sheet.boundingBox())!;
  expect(box.x, "the help sheet sits inside the left edge").toBeGreaterThanOrEqual(-0.5);
  expect(box.y, "the help sheet sits inside the top edge").toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width, "the help sheet sits inside the right edge").toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box.y + box.height, "the help sheet sits inside the screen").toBeLessThanOrEqual(viewport.height + 0.5);
  await expectTappable(page, sheet.getByRole("button", { name: "Hear it again" }), "help: Hear it again");
  await expectTappable(page, sheet.getByRole("button", { name: "Got it" }), "help: Got it");
  await sheet.getByRole("button", { name: "Got it" }).click(TAP);
  await expect(sheet).toHaveCount(0);
}

/** The settings sheet: every option reachable, and the choices land on <html>. */
async function useSettingsSheet(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Display settings" }).first().click(TAP);
  const sheet = page.getByRole("dialog", { name: "Display settings" });
  await expect(sheet).toBeVisible(TAP);
  const viewport = page.viewportSize()!;
  const box = (await sheet.boundingBox())!;
  expect(box.y + box.height, "the sheet sits inside the screen").toBeLessThanOrEqual(viewport.height + 0.5);
  for (const label of ["Normal", "Large", "Largest", "Off", "Right hand", "Left hand", "High contrast", "Less movement", "Done"]) {
    await expectTappable(page, sheet.getByRole("button", { name: label, exact: true }), `settings: ${label}`);
  }
  await sheet.getByRole("button", { name: "Large", exact: true }).click(TAP);
  await expect(page.locator("html")).toHaveAttribute("data-text", "large");
  await sheet.getByRole("button", { name: "Largest", exact: true }).click(TAP);
  await expect(page.locator("html")).toHaveAttribute("data-text", "largest");
  await sheet.getByRole("button", { name: "Done", exact: true }).click(TAP);
  await expect(sheet).toHaveCount(0);
}

test("settings are remembered on the device and applied before anything else", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-text", /.+/);

  await page.getByRole("button", { name: "Display settings" }).first().click(TAP);
  const sheet = page.getByRole("dialog", { name: "Display settings" });
  await expect(sheet).toBeVisible(TAP);
  await guidePicture(page, "display-settings");
  await sheet.getByRole("button", { name: "Largest", exact: true }).click(TAP);
  await sheet.getByRole("button", { name: "High contrast", exact: true }).click(TAP);
  await sheet.getByRole("button", { name: "Less movement", exact: true }).click(TAP);
  await sheet.getByRole("button", { name: "Left hand", exact: true }).click(TAP);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  await page.reload();
  await expectSettingsApplied(page, { ...EVERYTHING_ON, hand: "left" });
});

test("the device's own preferences switch the settings on without touching them", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", contrast: "more" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await expect(page.locator("html")).not.toHaveAttribute("data-text", /.+/);
});

for (const hand of ["right", "left"] as const) {
  test(`Travel Mode phone, ${hand}-handed, everything on: controls stay tappable`, async ({ page }) => {
    const prefs = { ...EVERYTHING_ON, hand };
    await withPrefs(page, prefs);
    // The smallest phone we design for, so the compressed layout is the tested one.
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto("/");
    await expectSettingsApplied(page, prefs);
    await expectCornerClear(page);
    await expectNoSideScroll(page);

    await page.getByRole("button", { name: /want to host/i }).click(TAP);
    await page.getByText("Phone Mode", { exact: true }).click(TAP);
    await page.getByPlaceholder("Type your name").fill("Reach Tester", TAP);
    await page.getByRole("button", { name: /start a game/i }).click(TAP);
    await expect(page).toHaveURL(/\/p\/[A-Z]{4}$/);
    await openAdventure(page, "Reach Tester");
    await expectSettingsApplied(page, prefs);

    // One-handed: the corner row is down with the tray, on the thumb's side, not at the top.
    const settings = page.getByRole("button", { name: "Display settings" }).first();
    const settingsBox = (await settings.boundingBox())!;
    expect(settingsBox.y, "the corner row is in the lower half").toBeGreaterThan(640 / 2);
    const tabs = page.getByRole("navigation", { name: "What to look at" });
    const tray = (await tabs.boundingBox())!;
    expect(settingsBox.y, "the corner row is under the tray, not on it").toBeGreaterThanOrEqual(tray.y + tray.height - 1);
    await expectCornerClear(page, true, true);

    // The phone player panel.
    await openPlayerTask(page);
    // "Look for a gap" leads to a check, so this road reaches the dice at the end.
    const choice = page.locator(".prompt .choice").filter({ hasText: /look for a gap/i });
    await expectTappable(page, choice, "a choice");
    await choice.click(TAP);
    await expectTappable(page, page.getByRole("button", { name: /^change$/i }), "Change");
    const commit = page.locator(".confirm__actions .kad-button--primary");
    await expectTappable(page, commit, "Do it");
    const commitBox = (await commit.boundingBox())!;
    // Beside "Change", on a 360px phone: about a third of the screen. The exact width follows the
    // runner's fonts (118px on CI), so the floor is a target, not a measurement.
    expect(commitBox.width, "the commit is a wide thumb target").toBeGreaterThan(100);
    for (const name of ["World", "You", "Map"]) {
      await expectTappable(page, tabs.getByRole("button", { name: new RegExp(`^${name}$`) }), `${name} tab`);
    }
    await expectApart([
      ...corner(page, true, true),
      { name: "tray", locator: tabs },
      { name: "Do it", locator: commit },
    ]);
    await expectNoSideScroll(page);

    // The Map, and its zoom buttons that a corner control once covered.
    await tabs.getByRole("button", { name: /^Map$/ }).click(TAP);
    await expect(page.getByRole("button", { name: /^Atlas$/ })).toHaveAttribute("aria-pressed", "true");
    // "Further away" is disabled until the map is zoomed in; "Closer" is the one a corner control once covered.
    await expectTappable(page, page.getByRole("button", { name: "Closer", exact: true }), "Closer");
    await page.getByRole("button", { name: "Closer", exact: true }).click(TAP);
    await expectTappable(page, page.getByRole("button", { name: "Further away", exact: true }), "Further away");
    await expectTappable(page, page.getByRole("button", { name: "Story trail", exact: true }), "Story trail");
    await expectCornerClear(page, true, true);
    await expectApart([
      ...corner(page, true, true),
      { name: "Closer", locator: page.getByRole("button", { name: "Closer", exact: true }) },
      { name: "Further away", locator: page.getByRole("button", { name: "Further away", exact: true }) },
    ]);
    await expectNoSideScroll(page);

    // The settings sheet, from the corner.
    await useSettingsSheet(page);

    // Help (#256): the "?" opens a sheet that names this screen, its buttons are reachable at the largest
    // text, and it reads the Map's words because the Map is what is up.
    await useHelpSheet(page, /This is the map/);

    await tabs.getByRole("button", { name: /^You$/ }).click(TAP);
    // The settings are also reachable from the bottom of the You tab (Room settings), without
    // reaching for the top of the phone.
    const dock = page.locator(".player__dock");
    if (await dock.isVisible().catch(() => false)) await dock.click(TAP);
    await page.locator(".player__room-settings > summary").click(TAP);
    await page.locator(".player__room-settings").getByRole("button", { name: "Display settings" }).click(TAP);
    await expect(page.getByRole("dialog", { name: "Display settings" })).toBeVisible(TAP);
    await page.keyboard.press("Escape");

    // The roll: the prompt, then the dice card, on this one small screen.
    await openPlayerTask(page);
    await page.locator(".confirm__actions .kad-button--primary").click(TAP);
    const roll = page.getByRole("button", { name: /^roll/i }).first();
    await expectTappable(page, roll, "Roll");
    await roll.click(TAP);
    await expectDiceInside(page);
    await expectNoSideScroll(page);
  });
}

test("Party Mode: the TV and a left-handed phone at the largest text", async ({ browser }) => {
  const prefs = { ...EVERYTHING_ON, hand: "left" };
  const tvContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const tv = await tvContext.newPage();
  await withPrefs(tv, prefs);
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneContext.newPage();
  await withPrefs(phone, prefs);
  try {
    await tv.goto("/");
    await tv.getByRole("button", { name: /want to host/i }).click(TAP);
    await tv.getByText("Party Mode", { exact: true }).click(TAP);
    await tv.getByRole("button", { name: /open the lobby here/i }).click(TAP);
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/);
    const code = new URL(tv.url()).pathname.split("/").pop()!;

    // The TV keeps the top corner (one-handed play is a phone setting) and its controls clear
    // of the host controls and arrival notices.
    await expectSettingsApplied(tv, prefs);
    await expectCornerClear(tv);
    const tvSettings = (await tv.getByRole("button", { name: "Display settings" }).first().boundingBox())!;
    expect(tvSettings.y, "the TV's corner row stays at the top").toBeLessThan(100);
    await expectNoSideScroll(tv);

    await phone.goto("/");
    await phone.getByLabel(/room code/i).fill(code);
    await phone.getByRole("button", { name: /join a game/i }).click(TAP);
    await expect(phone).toHaveURL(new RegExp(`/p/${code}$`));
    await openAdventure(phone, "Lefty");

    // The TV now shows the story: its narration and its corner still do not collide.
    await expect(tv.locator(".narration__body")).toBeVisible(TAP);
    await expectCornerClear(tv);
    const narration = (await tv.locator(".narration__body").boundingBox())!;
    expect(narration.x + narration.width, "narration fits the TV").toBeLessThanOrEqual(1280);
    await expectNoSideScroll(tv);

    // The left-handed phone: the corner row on the left, the commit on the left.
    const settings = (await phone.getByRole("button", { name: "Display settings" }).first().boundingBox())!;
    expect(settings.x, "the corner row follows the left hand").toBeLessThan(390 / 2);
    await openPlayerTask(phone);
    // "Look for a gap" leads to a check, so this road reaches the dice.
    await phone.locator(".prompt .choice").filter({ hasText: /look for a gap/i }).click(TAP);
    const commit = phone.locator(".confirm__actions .kad-button--primary");
    await expectTappable(phone, commit, "Do it");
    await expectCornerClear(phone, false, true);
    await expectApart([...corner(phone, false, true), { name: "Do it", locator: commit }]);
    await commit.click(TAP);

    // The roll prompt, and then the roll itself on the phone and on the TV: inside the screen,
    // not clipped, and nothing sideways.
    const roll = phone.getByRole("button", { name: /^roll/i }).first();
    await expectTappable(phone, roll, "Roll");
    await expectCornerClear(phone, false);
    await roll.click(TAP);
    // (A Party Mode phone only announces the roll; the dice are drawn on the TV.)
    await expectDiceInside(tv);
    await expectNoSideScroll(tv);
    await expectCornerClear(tv);
  } finally {
    await tvContext.close();
    await phoneContext.close();
  }
});
