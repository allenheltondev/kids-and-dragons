/**
 * A waiting indicator. Never a blocker: spec §11 says no timers on decisions,
 * and the corollary is that a slow network shows a heartbeat, not a lock.
 */

import { ScreenReaderOnly } from "./ScreenReaderOnly";

export interface SpinnerProps {
  /** Announced, and shown under the spinner when `showLabel`. */
  label?: string;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
}

export function Spinner({
  label = "Loading",
  showLabel = false,
  size = "md",
}: SpinnerProps): React.JSX.Element {
  return (
    <div className={`kad-spinner kad-spinner--${size}`} role="status">
      <span className="kad-spinner__ring" aria-hidden="true" />
      {showLabel ? <span className="kad-spinner__label">{label}</span> : <ScreenReaderOnly>{label}</ScreenReaderOnly>}
    </div>
  );
}
