/**
 * Move an open page onto the build the worker has taken over with (#456).
 *
 * On every wake the page asks the worker for updates (`checkForUpdate`). When
 * a new worker takes control, the page is still running the build it loaded,
 * and reloads onto the new one at the next calm moment (`calm.ts`): never with
 * a half-made answer on screen or while the page is out of sync. The room code is in the
 * URL and the session is in storage, so a reload loses nothing.
 */

import { useEffect, useState } from "react";
import { useRoute } from "../router";
import { useGameStore, useSynced } from "../store";
import { useKeepsakeStore } from "../store/keepsake";
import { onWake } from "../sync/wake";
import { shouldReload, type CalmInputs } from "./calm";
import { checkForUpdate } from "./register";

const RELOADED_KEY = "kad-update-reload";

function lastReload(): number | null {
  try {
    const at = Number(sessionStorage.getItem(RELOADED_KEY));
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

/** At most once per controller change: the stamp is read by `shouldReload` and written before the reload. */
function reload(): void {
  try {
    sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
  } catch {
    // Without storage the page cannot be guarded; one more reload is worse than none.
    return;
  }
  location.reload();
}

export function useConvergeOnUpdate(): void {
  const route = useRoute();
  const synced = useSynced();
  const picking = useGameStore((store) => store.myPreview !== null);
  const inFight = useGameStore((store) => store.state?.phase === "encounter");
  const keepsakeOpen = useKeepsakeStore((store) => store.step !== "closed");
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const [pending, setPending] = useState(false);
  const pairing = route.name === "account" && /[?&](?:pair|bring)=/.test(typeof location === "undefined" ? "" : location.search);

  useEffect(() => onWake(() => { void checkForUpdate(); }), []);

  useEffect(() => {
    const onVisibility = (): void => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // The first controller of a page's life (a first visit, claimed by the new
  // worker) is no update: only a change after the page has had one is.
  useEffect(() => {
    const container = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
    if (!container) return;
    let had = container.controller != null;
    const onChange = (): void => {
      if (!had) { had = true; return; }
      setPending(true);
    };
    container.addEventListener("controllerchange", onChange);
    return () => container.removeEventListener("controllerchange", onChange);
  }, []);

  const input: CalmInputs = { visible, synced, picking, inFight, keepsakeOpen, pairing };
  // Scene ends, back to the lobby and the journal opening all change one of the inputs (or the route).
  useEffect(() => {
    if (shouldReload(pending, input, lastReload(), Date.now())) reload();
  });
}
