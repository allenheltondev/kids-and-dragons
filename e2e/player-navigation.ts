import type { Page } from "@playwright/test";

/** Follow the same explicit entry into turn controls as a player. */
export async function openPlayerTask(page: Page): Promise<void> {
  const entry = page.getByRole("button", {
    name: /^(Your turn|Ready to play|Chapter rewards|A gift for you|View the fight)$/i,
  });
  if (await entry.isVisible().catch(() => false)) {
    await entry.click({ timeout: 5000 });
  }
}
