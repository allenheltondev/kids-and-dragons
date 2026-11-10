/**
 * "This device": who it plays as, and a way for it to stop.
 *
 * A device that became a kid stayed that kid. On a ward's tablet at discharge,
 * a phone handed down or a borrowed one going back, somebody needs to be able
 * to say "this isn't me", and it may be nobody with a sign-in. So the control
 * needs nothing but the device (`store/leave-device.ts`).
 *
 * It asks twice, in words that say what is kept, because the usual reader is
 * a parent worried about losing a hero. And where leaving *would* lose one (a
 * kid who exists only here, in a household nobody has saved) it offers no
 * button at all and says what to do first.
 */

import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { DeviceStanding } from "@kad/shared";
import { leaveThisDevice, standingOfThisDevice } from "../store/leave-device";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Icon } from "./icons";

export interface LeaveDeviceProps {
  hidden?: boolean;
  /** After the device has left. Defaults to a fresh start: every store in memory still thinks it is her. */
  onLeft?: () => void;
  /** Injected by tests. */
  load?: () => Promise<DeviceStanding | null>;
  leave?: () => Promise<void>;
}

function startAgain(): void {
  window.location.assign("/");
}

export function LeaveDevice({
  hidden = false,
  onLeft = startAgain,
  load = standingOfThisDevice,
  leave = leaveThisDevice,
}: LeaveDeviceProps): ReactElement | null {
  const [standing, setStanding] = useState<DeviceStanding | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void load().then((found) => {
      if (live) setStanding(found);
    });
    return () => {
      live = false;
    };
  }, [load]);

  const go = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await leave();
      onLeft();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "That didn’t work. Try again?");
      setBusy(false);
    }
  }, [leave, onLeft]);

  if (standing === null) return null;
  const name = standing.displayName;

  return (
    <section className="home__card home__account" aria-labelledby="account-leave" hidden={hidden}>
      <h2 className="home__card-title" id="account-leave">
        <Icon name="phone" />
        <span>This device</span>
      </h2>
      <p className="home__hint kad-muted">
        This device plays as <b>{name}</b>.
      </p>

      {!standing.canLeave ? (
        <p className="home__hint kad-muted">
          {name}&rsquo;s heroes are only on this device. Save them to an account first, and then this device can
          leave.
        </p>
      ) : confirming ? (
        <>
          <p className="home__hint" role="status">
            Take {name} off this device? {name}&rsquo;s heroes stay safe.{" "}
            {standing.kept
              ? "A grown-up signing in, or a code from another device, brings them back."
              : `A code from ${name}’s other device brings them back.`}
          </p>
          <Button
            variant="primary"
            block
            disabled={busy}
            icon={busy ? <Spinner /> : <Icon name="check" />}
            onClick={() => void go()}
          >
            {busy ? "Leaving…" : `Yes, take ${name} off this device`}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
            Not now
          </Button>
        </>
      ) : (
        <Button variant="secondary" block icon={<Icon name="back" />} onClick={() => setConfirming(true)}>
          Not {name}? Leave this device
        </Button>
      )}

      {error === null ? null : (
        <p className="home__error kad-chip kad-chip--bad kad-chip--wrap" role="alert">
          <Icon name="close" />
          <span>{error}</span>
        </p>
      )}
    </section>
  );
}
