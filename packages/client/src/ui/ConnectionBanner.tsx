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
 *   colours with a spinner — never red, no dismiss button, because there is
 *   nothing anybody at the table can do and nothing they need to. It removes
 *   itself the moment the channel is back.
 */

import { useEffect, useState } from "react";
import { useGameStore } from "../store";
import { Spinner } from "./Spinner";

/** How long a drop must last before it is worth a banner. */
export const RECONNECT_GRACE_MS = 1500;

export function ConnectionBanner(): React.JSX.Element | null {
  const connection = useGameStore((store) => store.connection);
  const [shown, setShown] = useState(false);

  const dropped = connection === "reconnecting";
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

  if (!shown) return null;

  return (
    // The spinner carries role="status" and the announcement; the visible
    // text is hidden from the reader so "Reconnecting" is said once.
    <div className="kad-connection">
      <Spinner size="sm" label="Reconnecting" />
      <span aria-hidden="true">Reconnecting…</span>
    </div>
  );
}
