/**
 * The single error surface, bound to `store.error`.
 *
 * Rejections are the server saying "not that, not now" (architecture §4.2), and
 * the answer is always the same: say so briefly, let them tap something else.
 * There is no retry button — retrying a rejected intent is how you spend a turn
 * twice. Anything the store can recover from itself (a stale seq, a dropped
 * connection) never reaches here.
 *
 * On the shared screen (`placement="dock"`, in its column, App.tsx) it has no
 * close box: a remote is a clumsy mouse, so it goes by itself once read
 * (`noticeMs`), and stands under the chapter's goal, off the story plate.
 */

import { useEffect } from "react";
import { cue } from "../audio/cue";
import { useGameStore } from "../store";
import { Button } from "./Button";
import { noticeMs } from "./notice-timing";

const DISMISS_AFTER_MS = 6000;

export function ErrorToast({ placement = "toast" }: { placement?: "toast" | "dock" } = {}): React.JSX.Element | null {
  const error = useGameStore((store) => store.error);
  const dismissError = useGameStore((store) => store.dismissError);

  useEffect(() => {
    if (!error) return;
    // A gentle "no" for eyes that are on the board rather than the toast.
    cue("error");
    const timer = setTimeout(dismissError, placement === "dock" ? noticeMs(error) : DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [error, dismissError, placement]);

  if (!error) return null;

  return (
    <div className={`kad-toast${placement === "dock" ? " kad-toast--dock" : ""}`} role="alert">
      <span className="kad-toast__icon" aria-hidden="true">
        !
      </span>
      <p className="kad-toast__text">{error}</p>
      {placement === "dock" ? null : <Button variant="ghost" size="md" icon="✕" aria-label="Dismiss" onClick={dismissError} />}
    </div>
  );
}
