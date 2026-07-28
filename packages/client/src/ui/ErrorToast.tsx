/**
 * The single error surface, bound to `store.error`.
 *
 * Rejections are the server saying "not that, not now" (architecture §4.2), and
 * the answer is always the same: say so briefly, let them tap something else.
 * There is no retry button — retrying a rejected intent is how you spend a turn
 * twice. Anything the store can recover from itself (a stale seq, a dropped
 * connection) never reaches here.
 */

import { useEffect } from "react";
import { useGameStore } from "../store";
import { Button } from "./Button";

const DISMISS_AFTER_MS = 6000;

export function ErrorToast(): React.JSX.Element | null {
  const error = useGameStore((store) => store.error);
  const dismissError = useGameStore((store) => store.dismissError);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(dismissError, DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [error, dismissError]);

  if (!error) return null;

  return (
    <div className="kad-toast" role="alert">
      <span className="kad-toast__icon" aria-hidden="true">
        !
      </span>
      <p className="kad-toast__text">{error}</p>
      <Button variant="ghost" size="md" icon="✕" aria-label="Dismiss" onClick={dismissError} />
    </div>
  );
}
