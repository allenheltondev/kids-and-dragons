/**
 * A badge on the installed app's icon while a question waits (#466).
 *
 * When the phone is in the background and a question is open for this player,
 * the icon shows a "1". It clears when the question is answered, when the page
 * comes back to the front, and when the player leaves the room. It is an
 * enhancement: where `navigator.setAppBadge` is missing, nothing happens.
 *
 * Never on the TV or a shared tablet that is only watching (no player there).
 * No installed-app check: in a plain tab the API simply does nothing.
 */

import { useEffect } from "react";
import { isPromptForPlayer, useGameStore } from "../store";
import { loadSharedDevice } from "../store/persistence";

export interface BadgeInput {
  /** A question is open for this player (`isPromptForPlayer`). */
  waiting: boolean;
  /** The signed-in player's id; "" on the TV and on a shared tablet. */
  playerId: string;
  /** This device is a shared household tablet (`loadSharedDevice`). */
  sharedDevice: boolean;
  /** `document.visibilityState === "hidden"`. */
  hidden: boolean;
}

/** The decision: set the badge, clear it, or leave it alone. Pure. */
export function badgeFor(input: BadgeInput): "set" | "clear" {
  const mine = input.playerId !== "" && !input.sharedDevice;
  return mine && input.waiting && input.hidden ? "set" : "clear";
}

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Calls the badge API where it exists. A refusal is not an error. */
function apply(action: "set" | "clear"): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as BadgeNavigator;
  try {
    const call = action === "set" ? nav.setAppBadge?.(1) : nav.clearAppBadge?.();
    call?.catch(() => { /* Optional: a refusal is silent. */ });
  } catch {
    /* Optional: a refusal is silent. */
  }
}

/** Badges the app icon while a question waits in the background. Mount it on the player's phone. */
export function useAppBadge(): void {
  const waiting = useGameStore((store) => {
    const state = store.state;
    return !!state && isPromptForPlayer(state.prompt, store.session?.playerId ?? "", state.party);
  });

  // A stale badge from a killed app should not linger.
  useEffect(() => {
    apply("clear");
  }, []);

  useEffect(() => {
    const update = (): void => {
      apply(badgeFor({
        waiting,
        playerId: useGameStore.getState().session?.playerId ?? "",
        sharedDevice: loadSharedDevice() !== null,
        hidden: typeof document !== "undefined" && document.visibilityState === "hidden",
      }));
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      apply("clear");
    };
  }, [waiting]);
}
