import type { Locator, Page } from "@playwright/test";

/** Follow visible page controls; never click hidden or unrendered choices. */
export async function revealPagedChoice(scope: Page | Locator, target: Locator): Promise<boolean> {
  if (await target.isVisible()) return true;
  const pager = scope.getByRole("navigation", { name: "Choice pages" });
  if (!(await pager.isVisible())) return false;
  const numbers = (await pager.getByRole("status").textContent())?.match(/\d+/g) ?? [];
  const pages = Number(numbers[1] ?? 1);
  for (let page = 1; page < pages; page++) {
    await pager.getByRole("button", { name: "More choices", exact: true }).click();
    if (await target.isVisible()) return true;
  }
  return false;
}
