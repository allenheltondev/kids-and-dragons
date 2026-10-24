/**
 * The boot watchdog's rules (#455). The watchdog itself is the inline script in
 * `index.html`, which runs before any bundle and so cannot import this file;
 * `policy.test.ts` reads that script and fails if its constants or key names
 * drift from the ones here.
 *
 * Every page load counts one attempt in sessionStorage (so it is per tab and
 * dies with it). A boot that never marks itself done, by timeout or by an early
 * window error, fails. What a failure does depends on which attempt it was.
 */

/** sessionStorage: loads of this tab that have not yet booted. Cleared on boot. */
export const BOOT_ATTEMPTS_KEY = "kad.boot.attempts";

/** sessionStorage: how many times this tab has healed. Never cleared by a boot. */
export const BOOT_HEALS_KEY = "kad.boot.heals";

/** The page object the inline script leaves for `markBooted`. */
export const BOOT_GLOBAL = "__kadBoot";

/** How long the app has to mark itself booted. */
export const BOOT_TIMEOUT_MS = 8000;

/** The failed attempt on which caches and workers are cleared. */
export const HEAL_AT_ATTEMPT = 2;

/** The failed attempt on which the page stops and says so. */
export const GIVE_UP_AT_ATTEMPT = 3;

/** Plain words for a child to read or be read. */
export const BOOT_GIVE_UP_MESSAGE = "Kids & Dragons could not start. Check the Wi-Fi and open it again.";

export type BootFailureStep = "retry" | "heal" | "give-up";

/** What to do when attempt `attempt` (1 for the first load) has failed. */
export function stepAfterFailure(attempt: number): BootFailureStep {
  if (!Number.isFinite(attempt) || attempt >= GIVE_UP_AT_ATTEMPT) return "give-up";
  if (attempt >= HEAL_AT_ATTEMPT) return "heal";
  return "retry";
}
