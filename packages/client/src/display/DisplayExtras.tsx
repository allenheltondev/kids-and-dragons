/**
 * What only the shared screen does (#264), in one lazy chunk so no phone's
 * first paint pays for it: keep the screen awake, reconnect and catch up when
 * it wakes anyway, and the "About this screen" report. `?perf` opens the
 * report at once; otherwise a small button does.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useGameStore } from "../store";
import { perfRequested } from "../world/frame-stats";
import { getAudioProbe, onAudioProbe } from "../audio/cue";
import { Button } from "../ui/Button";
import { probeCapabilities, type Capability } from "./capabilities";
import { keepAwake, type KeepAwake, type WakeLockState } from "./wake-lock";
import { onWake } from "./wake";

import "./DisplayExtras.css";

export function DisplayExtras(): React.JSX.Element {
  const [wake, setWake] = useState<WakeLockState>("released");
  const [open, setOpen] = useState(() => typeof location !== "undefined" && perfRequested(location.search));

  useEffect(() => {
    const lock: KeepAwake = keepAwake();
    setWake(lock.state());
    const stopWatching = lock.onChange(() => { setWake(lock.state()); });
    // Asleep and back: a fresh stream, then everything missed from the last seq.
    const stopWake = onWake(() => { useGameStore.getState().reconnect(); });
    return () => {
      stopWake();
      stopWatching();
      lock.stop();
    };
  }, []);

  /*
   * The button sits in the screen's corner row (App.tsx), first in it, so it
   * takes its place beside the other controls instead of lying over the
   * screen's own top-left heading (#257). Without a row (a test rendering this
   * alone) it stands where it is.
   */
  const [corner] = useState(() => (typeof document === "undefined" ? null : document.querySelector(".kad-corner")));
  const about = (
    <div className={`kad-about${corner ? " kad-about--in-corner" : ""}`}>
      {open ? <CapabilityReport wake={wake} onClose={() => { setOpen(false); }} /> : (
        <button type="button" className="kad-about__open" onClick={() => { setOpen(true); }}>
          About this screen
        </button>
      )}
    </div>
  );

  return (
    <>
      <SoundPrompt />
      {corner ? createPortal(about, corner) : about}
    </>
  );
}

/**
 * The one clear ask when the browser is holding sound back (#264). A TV often
 * waits for a tap before it lets a page make a sound, and nobody looks at a
 * small hint. Shown only while sound is `locked` or `suspended` and not turned
 * off; a browser with no audio at all (`unsupported`) is never asked, since a
 * tap cannot mend it, and the game never waits on the answer.
 */
function SoundPrompt(): React.JSX.Element | null {
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
    <div className="kad-tap-for-sound">
      <Button size="lg" onClick={() => { probe.unlock(); }}>Tap for sound</Button>
    </div>
  );
}

function CapabilityReport({ wake, onClose }: { wake: WakeLockState; onClose: () => void }): React.JSX.Element {
  const [rows, setRows] = useState<Capability[] | null>(null);
  const [tick, setTick] = useState(0);

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
      <button type="button" onClick={onClose}>Close</button>
    </section>
  );
}
