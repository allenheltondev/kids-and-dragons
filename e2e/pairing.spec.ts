/**
 * Pairing a new device to a kid (#281), in a real browser against the real
 * stack: make, scan, play.
 *
 * Ada's phone plays a little and makes a hero. It then shows a code ("Play as
 * me on another device"), and a brand-new browser, which has never been
 * anyone, enters it from the accounts page ("Bring my hero to this device"). That
 * browser lands on her hero and joins a TV's room as her. The same code does
 * nothing the second time.
 */

import { test, expect, type Browser, type Page } from "@playwright/test";
import { createCharacter } from "./characters";
import { guidePicture } from "./guide-pictures";

const TAP = { timeout: 20_000 } as const;

test.describe("pairing a new device", () => {
  const open: { close(): Promise<void> }[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function client(browser: Browser, width = 390, height = 844): Promise<Page> {
    const context = await browser.newContext({ viewport: { width, height } });
    open.push(context);
    return context.newPage();
  }

  test("a bound phone pairs a fresh browser, which joins a room as her with her hero", async ({ browser }) => {
    test.setTimeout(240_000);
    const HERO = "Moonbeam";

    // --- Ada's own phone: a hero, then a code ---
    const phone = await client(browser);
    await phone.goto("/");
    await phone.getByRole("button", { name: /host a game/i }).click();
    await phone.getByText("Phone Mode").click();
    await phone.getByLabel(/adventurer name/i).fill("Ada");
    await phone.getByRole("button", { name: /^start a game$/i }).click();
    await expect(phone).toHaveURL(/\/p\/[A-Z0-9]{4}$/);
    await createCharacter(phone, "unicorn", HERO);
    await phone.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect(phone.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0, TAP);

    await phone.goto("/account");
    await phone.getByRole("button", { name: /play as me on another device/i }).click(TAP);
    const shown = (await phone.locator(".pair__code").textContent(TAP)) ?? "";
    expect(shown).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
    await expect(phone.getByRole("img", { name: /qr code to play as ada/i })).toBeVisible(TAP);
    await guidePicture(phone, "pairing-code");

    // --- A brand-new browser enters it, and lands on her hero ---
    const fresh = await client(browser);
    await fresh.goto("/");
    await expect(fresh.getByRole("button", { name: /open your book/i })).toHaveCount(0);
    await fresh.getByRole("button", { name: /move a hero to another device/i }).click(TAP);
    await expect(fresh).toHaveURL(/\/account$/);
    await fresh.getByRole("button", { name: /bring my hero to this device/i }).click(TAP);
    await fresh.getByLabel("Your code").fill(shown);
    await fresh.getByRole("button", { name: /that.s me/i }).click(TAP);
    await expect(fresh).toHaveURL(/\/journal$/, TAP);
    await expect(fresh.getByRole("region", { name: `${HERO}'s character sheet` })).toBeVisible(TAP);

    // --- The code was single use ---
    const other = await client(browser);
    await other.goto("/account");
    await other.getByRole("button", { name: /bring my hero to this device/i }).click(TAP);
    await other.getByLabel("Your code").fill(shown);
    await other.getByRole("button", { name: /that.s me/i }).click(TAP);
    await expect(other.getByRole("alert")).toContainText(/didn.t work/i, TAP);
    await expect(other).not.toHaveURL(/\/journal$/);

    // --- And the paired browser plays as her: it joins a TV's room ---
    const tv = await client(browser, 1280, 800);
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/, TAP);
    const room = new URL(tv.url()).pathname.split("/").pop() ?? "";

    await fresh.goto("/");
    await fresh.getByLabel("Room code, four letters").fill(room);
    await fresh.getByRole("button", { name: /join a game/i }).click();
    await expect(fresh).toHaveURL(new RegExp(`/p/${room}$`), TAP);
    // It is Ada, not a stranger: the room offers her saved hero, and the TV seats it.
    await expect(fresh.getByText(/welcome back/i)).toBeVisible(TAP);
    await fresh.getByRole("button", { name: new RegExp(HERO) }).click(TAP);
    await fresh.getByRole("button", { name: new RegExp(`play as ${HERO}`, "i") }).click(TAP);
    await fresh.getByRole("button", { name: /^Ready to play$/i }).click(TAP);
    await expect(tv.getByText(HERO)).toBeVisible(TAP);
  });

  test("a scanned link opens the accounts page with the code ready, and spends nothing until tapped", async ({ browser }) => {
    test.setTimeout(120_000);
    const phone = await client(browser);
    await phone.goto("/");
    await phone.getByRole("button", { name: /host a game/i }).click();
    await phone.getByText("Phone Mode").click();
    await phone.getByLabel(/adventurer name/i).fill("Rue");
    await phone.getByRole("button", { name: /^start a game$/i }).click();
    await expect(phone).toHaveURL(/\/p\/[A-Z0-9]{4}$/);
    await phone.goto("/account");
    await phone.getByRole("button", { name: /play as me on another device/i }).click(TAP);
    const shown = (await phone.locator(".pair__code").textContent(TAP)) ?? "";

    const fresh = await client(browser);
    await fresh.goto(`/account?pair=${shown.replace("-", "").toLowerCase()}`);
    await expect(fresh.getByLabel("Your code")).toHaveValue(shown, TAP);
    // The code is out of the address bar, and still unspent.
    await expect(fresh).toHaveURL(/\/account$/);
    await fresh.getByRole("button", { name: /that.s me/i }).click(TAP);
    await expect(fresh).toHaveURL(/\/journal$/, TAP);
  });
});
