/**
 * The reconnecting banner — roadmap chapter 8's offline handling, the
 * visible half.
 *
 * The sync layer already survives a dropped connection: the channel retries
 * with jittered backoff and the store resyncs on the way back in. What was
 * missing is anybody *saying so*. A family whose wifi hiccups mid-fight saw a
 * game that had simply stopped answering — taps swallowed, dice not rolling —
 * with nothing anywhere naming the reason, which reads as "the game broke"
 * and gets the tab reloaded (losing nothing, but teaching everyone the game
 * is fragile).
 *
 * Two decisions keep it calm:
 *
 * - **A grace period.** The channel's first retry usually lands inside a
 *   second or two; a banner that flashed for every blip would make the
 *   connection *look* worse than it is. Nothing is shown until a drop has
 *   lasted `RECONNECT_GRACE_MS`.
 * - **A wait, not an alarm.** It reads "Reconnecting…" in the panel's own
 *   colours with a spinner — never red, no dismiss button, because nobody
 *   needs to do anything. It does offer "Try again", which skips the backoff
 *   and opens a fresh stream, so a stuck connection never costs a full app
 *   restart. It removes itself the moment the channel is back.
 *
 * With no network at all (`navigator.onLine` false) it says "No signal.
 * Waiting for Wi-Fi…" and drops "Try again", which could only fail. When the
 * network returns, the usual reconnect runs and it reads "Reconnecting…"
 * until the phone has caught up.
 *
 * "Back" means caught up, not just reopened (#413): until the catch-up after
 * a reopen has landed, the phone's answers are held (`GameStore.synced`), and
 * this is what says why. A slow catch-up is still just "Reconnecting".
 */

import { useEffect, useState } from "react";
import { useGameStore } from "../store";
import { navigate } from "../router";
import { Spinner } from "./Spinner";
import { useOnline } from "./useOnline";

/**
 * How long a drop must last before it is worth a banner. The clock covers the
 * whole drop, retries and catch-up included (`dropped` stays true across them),
 * so a rejoin that lands inside it never shows the banner at all.
 */
export const RECONNECT_GRACE_MS = 3000;

/**
 * What the banner says. Offline, the device itself has no network, so waiting
 * on the app is the wrong picture and "Try again" could not help; online, it is
 * the app reconnecting and the button skips the backoff.
 */
export function bannerCopy(
  online: boolean,
  lost = false,
): { words: string; label: string; canRetry: boolean; canLeave: boolean } {
  // The room is gone (#470): the same words whether or not the network is up,
  // and a way home, because waiting will not bring it back.
  if (lost) {
    return {
      words: "This game has ended or the phone was signed out.",
      label: "This game has ended or the phone was signed out",
      canRetry: true,
      canLeave: true,
    };
  }
  const copy = online
    ? { words: "Reconnecting…", label: "Reconnecting", canRetry: true }
    : { words: "No signal. Waiting for Wi-Fi…", label: "No signal. Waiting for Wi-Fi", canRetry: false };
  return { ...copy, canLeave: false };
}

export function ConnectionBanner(): React.JSX.Element | null {
  const connection = useGameStore((store) => store.connection);
  const catchingUp = useGameStore((store) => store.session !== null && !store.synced);
  const online = useOnline();
  const [shown, setShown] = useState(false);

  const dropped = connection === "reconnecting" || catchingUp || !online;
  useEffect(() => {
    if (!dropped) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => {
      setShown(true);
    }, RECONNECT_GRACE_MS);
    return () => clearTimeout(timer);
  }, [dropped]);

  const lost = connection === "lost";
  // A lost room shows at once: there is nothing to wait out.
  if (!lost && !shown) return null;
  const copy = bannerCopy(online, lost);

  if (lost) {
    return (
      <div className="kad-connection kad-connection--lost" role="status">
        <span>{copy.words}</span>
        <button
          type="button"
          className="kad-connection__retry"
          onClick={() => {
            useGameStore.getState().reconnect();
          }}
        >
          Try again
        </button>
        <button
          type="button"
          className="kad-connection__retry"
          onClick={() => {
            useGameStore.getState().leave();
            navigate({ name: "home" });
          }}
        >
          Back to the start
        </button>
      </div>
    );
  }

  return (
    // The spinner carries role="status" and the announcement; the visible
    // text is hidden from the reader so "Reconnecting" is said once.
    <div className="kad-connection">
      <Spinner size="sm" label={copy.label} />
      <span aria-hidden="true">{copy.words}</span>
      {/* The channel retries on its own, backing off up to 15 seconds between
          tries. This is for the table that would rather not wait out the
          backoff, or whose stream is wedged: a fresh stream and a catch-up now,
          so nobody has to close the app to get one. */}
      {copy.canRetry && (
        <button
          type="button"
          className="kad-connection__retry"
          onClick={() => {
            useGameStore.getState().reconnect();
          }}
        >
          Try again
        </button>
      )}
    </div>
  );
}
