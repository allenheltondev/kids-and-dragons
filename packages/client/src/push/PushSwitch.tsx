/**
 * The Account screen's "It's your turn" switch (#466), on a kid's own phone
 * in the installed app. A grown-up's choice, made here and nowhere else: the
 * browser's permission prompt appears only when the switch is flipped on.
 *
 * Draws nothing where a push cannot reach (a tab, an old browser, a family
 * tablet, a TV, a server that sends none), so there is never a switch that
 * cannot work.
 */

import { useEffect, useState, type ReactElement } from "react";
import type { PushKeyResponse } from "@kad/shared";
import { browserEnv, isStandalone } from "../install/detect";
import { loadPlayerDeviceToken, loadSharedDevice } from "../store/persistence";
import { Icon } from "../screens/icons";
import {
  currentSubscription,
  fetchPushKey,
  pushStatus,
  pushSupported,
  sameKey,
  syncSubscription,
  turnOffPush,
  turnOnPush,
  type PushStatus,
} from "./push";
import "./PushSwitch.css";

type Note = "blocked" | "dismissed" | "failed" | null;

const NOTES: Record<Exclude<Note, null>, string> = {
  blocked: "Notifications are off for Kids & Dragons in this phone's settings. Turn them on there, then come back.",
  dismissed: "No notifications for now. Flip the switch again whenever you like.",
  failed: "That didn't work. Try again in a moment.",
};

export function PushSwitch(): ReactElement | null {
  const [server, setServer] = useState<PushKeyResponse | null>(null);
  const [status, setStatus] = useState<PushStatus>("hidden");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const deviceToken = loadPlayerDeviceToken();

  useEffect(() => {
    let live = true;
    void (async () => {
      const supported = pushSupported();
      const env = {
        supported,
        installed: isStandalone(browserEnv()),
        permission: supported ? Notification.permission : ("default" as NotificationPermission),
        personal: deviceToken !== null && loadSharedDevice() === null,
      };
      // Nothing is asked of the server where the switch could never show.
      if (pushStatus(env, { enabled: true, publicKey: "" }, false) === "hidden") return;
      const key = await fetchPushKey();
      let subscription = key?.enabled ? await currentSubscription() : null;
      if (subscription && key?.enabled && !sameKey(subscription, key.publicKey)) subscription = null;
      // Already on: tell the server again, in case it forgot this phone.
      if (subscription && deviceToken && env.permission === "granted") {
        void syncSubscription(subscription, deviceToken).catch(() => undefined);
      }
      if (!live) return;
      setServer(key);
      setStatus(pushStatus(env, key, subscription !== null));
    })();
    return () => {
      live = false;
    };
  }, [deviceToken]);

  if (status === "hidden" || !server?.enabled || !deviceToken) return null;

  const on = status === "on";
  const flip = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    if (on) {
      await turnOffPush(deviceToken);
      setStatus("off");
    } else {
      const result = await turnOnPush(server.publicKey, deviceToken);
      if (result === "on") setStatus("on");
      else {
        if (result === "blocked") setStatus("blocked");
        setNote(result);
      }
    }
    setBusy(false);
  };

  return (
    <section className="home__card home__account push-switch" aria-labelledby="account-push">
      <h2 className="home__card-title" id="account-push">
        <Icon name="phone" />
        <span>Their turn, in the background</span>
      </h2>
      <p className="home__hint kad-muted">
        When this app is closed or in the background, this phone can buzz when a question is waiting for its player. It
        only ever says “It’s your turn in Kids &amp; Dragons.”
      </p>
      {status === "blocked" ? (
        <p className="home__hint kad-muted" role="status">
          {NOTES.blocked}
        </p>
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className="push-switch__toggle kad-focusable"
          disabled={busy}
          onClick={() => void flip()}
        >
          <span className="push-switch__label">Tell this phone when it’s their turn</span>
          <span className="push-switch__track" aria-hidden="true">
            <span className="push-switch__thumb" />
          </span>
        </button>
      )}
      {note !== null && note !== "blocked" ? (
        <p className="home__hint kad-muted" role="status">
          {NOTES[note]}
        </p>
      ) : null}
    </section>
  );
}

export default PushSwitch;
