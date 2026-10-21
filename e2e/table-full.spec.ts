/**
 * A table of four, against the real stack (#389): a fifth phone is told the
 * table is full before it makes a hero, and when the host takes somebody
 * out, the freed seat opens hero creation on that phone.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createCharacter } from "./characters";

const TAP = { timeout: 20_000 } as const;

test.describe("a full table", () => {
  test.setTimeout(240_000);
  const openContexts: BrowserContext[] = [];

  async function phone(browser: Browser): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    openContexts.push(context);
    return context.newPage();
  }

  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function join(page: Page, code: string): Promise<void> {
    await page.goto("/");
    await page.getByLabel(/room code/i).fill(code);
    await page.getByRole("button", { name: /join a game/i }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${code}$`), TAP);
  }

  test("a fifth phone hears the table is full, and gets a seat when one frees", async ({ browser }) => {
    const host = await phone(browser);
    await host.goto("/");
    await host.getByRole("button", { name: /host a game/i }).click();
    await host.getByText("Phone Mode").click();
    await host.getByLabel(/adventurer name/i).fill("Grown-up");
    await host.getByRole("button", { name: /^start a game$/i }).click();
    await expect(host).toHaveURL(/\/p\/[A-Z]{4}$/, TAP);
    const code = new URL(host.url()).pathname.split("/").pop() ?? "";
    await createCharacter(host, "unicorn", "Pip");

    const guests: Page[] = [];
    for (const name of ["Bo", "Cy", "Dee"]) {
      const guest = await phone(browser);
      await join(guest, code);
      await createCharacter(guest, "unicorn", name);
      guests.push(guest);
    }

    // --- The fifth phone: a kind word, and no hero to build ---
    const fifth = await phone(browser);
    await join(fifth, code);
    const full = fifth.getByTestId("table-full");
    await expect(full).toBeVisible(TAP);
    await expect(full).toContainText("This table is full.");
    await expect(fifth.getByText(/party is full/i)).toHaveCount(0);
    await expect(fifth.getByRole("button", { name: /unicorn/i })).toHaveCount(0);

    // --- The host takes Dee out: the seat is free, and creation opens ---
    await host.getByText("Running this room").click();
    const roster = host.getByRole("list", { name: "Who is in this room" });
    const dee = roster.getByRole("listitem").filter({ hasText: "Dee" });
    await dee.getByRole("button", { name: /^Remove .* from this game$/ }).click();
    await expect(guests[2]!.getByText(/took this phone out/i)).toBeVisible(TAP);
    await expect(full).toHaveCount(0, TAP);
    await createCharacter(fifth, "unicorn", "Eve");
    await expect(roster.getByText(/Eve/).first()).toBeVisible(TAP);
  });
});
