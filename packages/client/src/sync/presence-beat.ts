/**
 * The phone's heartbeat (#258): "still here" every `HEARTBEAT_MS` while the
 * page is on screen, once more the moment it comes back on screen, and
 * "leaving" as it closes. The server (handlers/presence.ts) marks a phone
 * away once it has been quiet for a couple of minutes, which in production is
 * the only way a phone that died, lost signal or closed its tab is ever
 * noticed: AppSync Events tells the server nothing when a socket goes.
 *
 * A page that is hidden does not beat. A kid who has switched to another app
 * has stepped away, and their phone says so by going quiet; the first beat
 * on coming back marks them here again, before they have tapped anything.
 */

import { useEffect } from "react";
import { useGameStore, useSession } from "../store";

/** The server's `HEARTBEAT_MS`: well inside its two-minute `AWAY_AFTER_MS`. */
export const HEARTBEAT_MS = 20_000;

export function usePresenceBeat(): void {
  const token = useSession()?.sessionToken ?? "";
  const playerId = useSession()?.playerId ?? "";

  useEffect(() => {
    // A screen with no player (the TV) is nobody's presence.
    if (!token || !playerId) return;
    const beat = useGameStore.getState().beat;
    const onScreen = (): boolean => typeof document === "undefined" || document.visibilityState === "visible";

    if (onScreen()) beat();
    const timer = setInterval(() => {
      if (onScreen()) beat();
    }, HEARTBEAT_MS);
    const onVisibility = (): void => {
      if (onScreen()) beat();
    };
    // Closing the tab, or leaving the game for another page. Not a
    // back/forward cache stash (`persisted`): that page may come straight back.
    const onPageHide = (event: PageTransitionEvent): void => {
      if (!event.persisted) beat(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [token, playerId]);
}
