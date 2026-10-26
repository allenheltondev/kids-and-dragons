import type { Page } from "@playwright/test";

/** Follow the same explicit entry into turn controls as a player. */
export async function openPlayerTask(page: Page): Promise<void> {
  // Never a choice or a combat card: a card named "Help up" matches "Help .+"
  // too, and tapping it from here is not opening the task.
  const entry = page
    .getByRole("button", {
      name: /^(Your turn|Ready to play|Chapter rewards|A gift for you|View the fight|Help .+|Spend your stat points?)$/i,
    })
    .and(page.locator("button:not(.choice)"));
  if (await entry.isVisible().catch(() => false)) {
    // A refreshed phone can still be settling its scroll container while the
    // other live surfaces render. Use Playwright's normal action timeout so
    // it can finish scrolling and checking stability before tapping.
    await entry.click();
  }
}
