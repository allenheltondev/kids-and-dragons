/**
 * What only the shared screen does (#264), in one lazy chunk so no phone's
 * first paint pays for it: keep the screen awake, reconnect and catch up when
 * it wakes anyway, and the "About this screen" report. `?perf` opens the
 * report at once; otherwise a small button does.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useGameStore } from "../store";
import { perfRequested } from "../world/frame-stats";
import { getAudioProbe, onAudioProbe } from "../audio/cue";
import { Button } from "../ui/Button";
import { probeCapabilities, type Capability } from "./capabilities";
import { keepAwake, type KeepAwake, type WakeLockState } from "./wake-lock";
import { onWake } from "./wake";
import { installRemoteFocus } from "./remote-focus";

import "./DisplayExtras.css";

/* The wake lock's state, held by DisplayExtras and read by the report wherever it is drawn. */
let wakeNow: WakeLockState = "released";
const wakeListeners = new Set<() => void>();
function setWakeNow(next: WakeLockState): void {
  wakeNow = next;
  for (const listener of wakeListeners) listener();
}
function useWakeState(): WakeLockState {
  return useSyncExternalStore(
    (listener) => { wakeListeners.add(listener); return () => { wakeListeners.delete(listener); }; },
    () => wakeNow,
    () => wakeNow,
  );
}

/**
 * `controls={false}` when App draws the screen's own controls in its corner row
 * (`DisplayCornerControls`, #257); rendered on its own, it draws them where it is.
 */
export function DisplayExtras({ controls = true }: { controls?: boolean } = {}): React.JSX.Element | null {
  useEffect(() => {
    const lock: KeepAwake = keepAwake();
    setWakeNow(lock.state());
    const stopWatching = lock.onChange(() => { setWakeNow(lock.state()); });
    // Asleep and back: a fresh stream, then everything missed from the last seq.
    const stopWake = onWake(() => { useGameStore.getState().reconnect(); });
    // A remote's arrows walk the few controls the screen keeps (remote-focus.ts).
    const stopRemote = installRemoteFocus();
    return () => {
      stopWatching();
      stopWake();
      stopRemote();
      lock.stop();
    };
  }, []);

  if (!controls) return null;
  return (
    <>
      <SoundPrompt inCorner={false} />
      <About inCorner={false} />
    </>
  );
}

/**
 * The shared screen's own controls, as App draws them in its corner row (#257):
 * Tap for sound beside the sound button it is about, and About this screen as a
 * 44px "i" like its neighbours. Top centre and top left, they lay over the
 * lobby's heading and the chapter title at the largest text.
 */
export function DisplayCornerControls(): React.JSX.Element {
  return (
    <>
      <SoundPrompt inCorner />
      <About inCorner />
    </>
  );
}

function About({ inCorner }: { inCorner: boolean }): React.JSX.Element {
  const wake = useWakeState();
  const [open, setOpen] = useState(() => typeof location !== "undefined" && perfRequested(location.search));
  // Opened from its button, focus goes into the report and comes back to the button on Close
  // or Escape, so a remote is never left pointing at nothing. Open from `?perf`, it takes none.
  const pressed = useRef(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open || !pressed.current) return;
    pressed.current = false;
    opener.current?.focus();
  }, [open]);
  const press = (): void => {
    pressed.current = true;
    setOpen(true);
  };
  return (
    <div className={`kad-about${inCorner ? " kad-about--in-corner" : ""}`}>
      {open ? (
        <CapabilityReport wake={wake} takeFocus={pressed.current} onClose={() => { setOpen(false); }} />
      ) : inCorner ? (
        <button
          ref={opener}
          type="button"
          className="kad-about__open kad-about__open--icon kad-focusable"
          aria-label="About this screen"
          title="About this screen"
          onClick={press}
        >
          <span aria-hidden="true">i</span>
        </button>
      ) : (
        <button ref={opener} type="button" className="kad-about__open kad-focusable" onClick={press}>
          About this screen
        </button>
      )}
    </div>
  );
}

/**
 * The one clear ask when the browser is holding sound back (#264). A TV often
 * waits for a tap before it lets a page make a sound, and nobody looks at a
 * small hint. It stands in the screen's corner row, beside the sound button it
 * is about: top centre, it lay over the lobby's heading and the chapter title
 * at the largest text (#257). Shown only while sound is `locked` or `suspended` and not turned
 * off; a browser with no audio at all (`unsupported`) is never asked, since a
 * tap cannot mend it, and the game never waits on the answer.
 */
function SoundPrompt({ inCorner }: { inCorner: boolean }): React.JSX.Element | null {
  const [, refresh] = useState(0);
  useEffect(() => {
    let stopState = (): void => undefined;
    const attach = (): void => {
      stopState();
      stopState = getAudioProbe()?.onStateChange(() => { refresh((n) => n + 1); }) ?? (() => undefined);
      refresh((n) => n + 1);
    };
    attach();
    const stopProbe = onAudioProbe(attach);
    // Turning sound off or on is a tap, not an event: read again after any.
    const reread = (): void => { refresh((n) => n + 1); };
    window.addEventListener("click", reread);
    window.addEventListener("keydown", reread);
    document.addEventListener("visibilitychange", reread);
    return () => {
      stopProbe();
      stopState();
      window.removeEventListener("click", reread);
      window.removeEventListener("keydown", reread);
      document.removeEventListener("visibilitychange", reread);
    };
  }, []);

  const probe = getAudioProbe();
  if (!probe || probe.muted()) return null;
  const state = probe.state();
  if (state !== "locked" && state !== "suspended") return null;
  return (
    <div className={`kad-tap-for-sound${inCorner ? " kad-tap-for-sound--in-corner" : ""}`}>
      <Button size={inCorner ? "md" : "lg"} onClick={() => { probe.unlock(); }}>Tap for sound</Button>
    </div>
  );
}

function CapabilityReport({ wake, takeFocus, onClose }: { wake: WakeLockState; takeFocus: boolean; onClose: () => void }): React.JSX.Element {
  const [rows, setRows] = useState<Capability[] | null>(null);
  const [tick, setTick] = useState(0);
  const close = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (takeFocus) close.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // Once per opening.
  }, []);

  useEffect(() => {
    let stopState = (): void => undefined;
    const attach = (): void => {
      stopState();
      stopState = getAudioProbe()?.onStateChange(() => { setTick((n) => n + 1); }) ?? (() => undefined);
      setTick((n) => n + 1);
    };
    attach();
    const stopProbe = onAudioProbe(attach);
    return () => { stopProbe(); stopState(); };
  }, []);
  useEffect(() => {
    let live = true;
    void probeCapabilities(wake).then((next) => { if (live) setRows(next); });
    return () => { live = false; };
  }, [wake, tick]);

  const screenSize = typeof window === "undefined" ? "" : `${window.innerWidth}×${window.innerHeight} at ${window.devicePixelRatio || 1}x`;
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;

  return (
    <section className="kad-about__panel" aria-label="About this screen">
      <h2>About this screen</h2>
      {rows ? (
        <ul>
          {rows.map((row) => (
            <li key={row.id} data-capability={row.id} data-ok={row.ok}>
              <b>{row.label}</b>
              <span>{row.ok ? "Yes" : "No"}</span>
              <small>{row.detail}</small>
            </li>
          ))}
        </ul>
      ) : <p>Checking…</p>}
      <p className="kad-about__device">{screenSize}<br />{agent}</p>
      <button ref={close} type="button" className="kad-focusable" onClick={onClose}>Close</button>
    </section>
  );
}
