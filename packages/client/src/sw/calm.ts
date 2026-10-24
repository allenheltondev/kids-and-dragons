/**
 * When a page that has been handed a new build may reload onto it (#456).
 *
 * The new worker takes over an open page at once (sw.ts), but the page keeps
 * running the build it loaded until it reloads. A reload loses nothing: the
 * room code is in the URL and the session is in storage, so the page comes
 * back in the same room. It still must not happen under a child's finger, so
 * it waits for a calm moment. Pure, over plain inputs, so every rule is a test
 * case; `converge.ts` reads the store and the browser and feeds it.
 */

export interface CalmInputs {
  /** The page is on screen. */
  visible: boolean;
  /** Caught up with the server (`GameStore.synced`): what is drawn is true. */
  synced: boolean;
  /**
   * This phone has picked something it has not confirmed yet (`GameStore.myPreview`).
   * An open question on its own is not unrest: nearly every scene asks one, and
   * a reload brings the same question straight back from the server. A
   * half-made answer is what a reload would lose.
   */
  picking: boolean;
  /** A fight is on (its animations play on the shared screen). */
  inFight: boolean;
  /** The keepsake (sign-in) flow is open. */
  keepsakeOpen: boolean;
  /** The pairing flow is open. */
  pairing: boolean;
}

export function isCalm(input: CalmInputs): boolean {
  return (
    input.visible &&
    input.synced &&
    !input.picking &&
    !input.inFight &&
    !input.keepsakeOpen &&
    !input.pairing
  );
}

/** Reloads closer together than this are one change answered twice, never two. */
export const RELOAD_GUARD_MS = 30_000;

/** Whether the last reload (a time, or none) leaves room for another. */
export function mayReload(lastReloadAt: number | null, now: number): boolean {
  return lastReloadAt === null || now - lastReloadAt >= RELOAD_GUARD_MS || now < lastReloadAt;
}

/** Ask the worker for an update at most this often, however often the screen wakes. */
export const UPDATE_CHECK_MS = 5 * 60_000;

export function updateDue(lastCheckAt: number | null, now: number): boolean {
  return lastCheckAt === null || now - lastCheckAt >= UPDATE_CHECK_MS || now < lastCheckAt;
}

/** Reload now: a build is waiting, the moment is calm, and this change has not been answered. */
export function shouldReload(pending: boolean, input: CalmInputs, lastReloadAt: number | null, now: number): boolean {
  return pending && isCalm(input) && mayReload(lastReloadAt, now);
}
