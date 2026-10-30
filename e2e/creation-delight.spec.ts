import { test, expect } from "@playwright/test";
import { seedTable, openPhone, openTv, onAir } from "./seed";

test("a child can peek at details, choose a role, and ask for editable strengths", async ({ browser }) => {
  const table = await seedTable({ mode: "party", tv: true, heroes: [{ name: "Pip", species: "unicorn" }] });
  const tv = await openTv(browser, table);
  const phone = await openPhone(browser, table.phones[0]!, { reducedMotion: "reduce" });
  try {
    await Promise.all([onAir(tv.page), onAir(phone.page)]);
    await tv.page.getByRole("button", { name: "Room", exact: true }).click();
    await tv.page.getByRole("button", { name: "New players? Start a new crew" }).click();
    await expect(phone.page.getByText("Pick your creature to keep going.")).toBeVisible();
    await phone.page.getByText("More about Unicorn", { exact: true }).click();
    await expect(phone.page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    await expect(phone.page.locator(".creation-species").first()).toHaveAttribute("aria-pressed", "false");
    await phone.page.getByText("More about Unicorn", { exact: true }).click();
    await phone.page.locator(".creation-species").first().click();
    await phone.page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(phone.page.getByText("Protect your friends", { exact: true })).toBeVisible();
    await phone.page.screenshot({ path: "docs/reviews/crew-identity/creation-class.png" });
    await phone.page.getByRole("button", { name: /Protect your friends/ }).click();
    await phone.page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(phone.page.getByRole("button", { name: "Help me choose" })).toBeVisible();
    await phone.page.screenshot({ path: "docs/reviews/crew-identity/creation-stats.png" });
    await phone.page.getByRole("button", { name: "Help me choose" }).click();
    await expect(phone.page.getByText("All points spent")).toBeVisible();
    await expect(phone.page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
    await expect(phone.page.getByRole("heading", { name: "What are you best at?" })).toBeVisible();
    await phone.page.getByRole("button", { name: "Next", exact: true }).click();
    await phone.page.getByPlaceholder("Tap to type").fill("Thistle");
    await phone.page.getByRole("button", { name: "That's me!", exact: true }).click();
    await expect(phone.page.getByText("Meet Thistle!")).toBeVisible();
    expect(await phone.page.locator(".hero-arrival").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
    await expect(phone.page.getByText("Meet Thistle!")).toHaveCount(0);
    await phone.page.reload();
    await onAir(phone.page);
    await expect(phone.page.getByText("Meet Thistle!")).toHaveCount(0);
  } finally { await tv.context.close(); await phone.context.close(); }
});
