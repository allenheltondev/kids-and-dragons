import { test, expect } from "@playwright/test";
import type { RunState } from "@kad/shared";
import { seedTable, openPhone, openTv, onAir } from "./seed";
import { createCharacter } from "./characters";
import { roomState } from "./room-state";

test("the TV starts friends night on connected phones, then can return to the usual crew", async ({ browser }) => {
  const table = await seedTable({ mode: "party", tv: true, heroes: [
    { name: "Pip", species: "unicorn" }, { name: "Bo", species: "griffin" },
  ] });
  const tv = await openTv(browser, table);
  const one = await openPhone(browser, table.phones[0]!);
  const two = await openPhone(browser, table.phones[1]!);
  try {
    await Promise.all([tv.page, one.page, two.page].map(page => onAir(page)));
    await expect(tv.page.getByRole("button", { name: "New players? Start a new crew" })).toBeHidden();
    await tv.page.getByRole("button", { name: "Room", exact: true }).click();
    // Crews is open as the panel opens: first, so it is never scrolled past.
    await tv.page.getByRole("button", { name: "New players? Start a new crew" }).click();
    await expect(tv.page.getByText(/Make new heroes on your phones/)).toBeVisible();
    for (const phone of [one.page, two.page]) {
      await expect(phone.getByText(/Make a new hero for The Otter Crew/)).toBeVisible();
      await expect(phone.getByText(/Welcome back/)).toHaveCount(0);
    }
    await tv.page.screenshot({ path: "docs/reviews/crew-identity/friends-tv.png" });
    const firstCard = one.page.locator(".creation-species").first();
    const portrait = await firstCard.locator(".creation-species__art").boundingBox();
    const description = await firstCard.locator(".creation-species__text").boundingBox();
    const details = await firstCard.locator(".creation-species__details").boundingBox();
    expect(description!.x).toBeGreaterThanOrEqual(portrait!.x + portrait!.width);
    expect(details!.y).toBeGreaterThanOrEqual(Math.max(portrait!.y + portrait!.height, description!.y + description!.height) - 1);
    expect(details!.width).toBeGreaterThan(portrait!.width + description!.width);
    await expect.poll(() => one.page.locator(".creation-species .portrait__img").evaluateAll(images =>
      images.length === 6 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0),
    )).toBe(true);
    await one.page.screenshot({ path: "docs/reviews/crew-identity/friends-phone.png" });
    await createCharacter(one.page, "unicorn", "Fern");
    await expect(one.page.getByText("Meet Fern!")).toBeVisible();
    await one.page.screenshot({ path: "docs/reviews/crew-identity/hero-hello.png" });
    await createCharacter(two.page, "griffin", "Moss");
    const state = await roomState<RunState>(one.page, table.code);
    expect(state.party.map(m => m.character.name).sort()).toEqual(["Fern", "Moss"]);
    expect(state.crew).toBe("cw_1");
    await tv.page.getByRole("button", { name: "Room", exact: true }).click();
    // Crews is open as the panel opens: first, so it is never scrolled past.
    await tv.page.getByRole("button", { name: "Play as The first crew" }).click();
    for (const phone of [one.page, two.page]) {
      await expect(phone.getByText(/Welcome back! Who are you bringing/)).toBeVisible();
      await expect(phone.getByText(/Make a new hero for The Otter Crew/)).toHaveCount(0);
    }
    await expect(one.page.getByRole("button", { name: /Pip/ }).first()).toBeVisible();
    await expect(two.page.getByRole("button", { name: /Bo/ }).first()).toBeVisible();
  } finally {
    await Promise.all([tv.context, one.context, two.context].map(context => context.close()));
  }
});
