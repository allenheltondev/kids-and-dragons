/**
 * What only the shared screen does (#264), in one lazy chunk so no phone's
 * first paint pays for it: keep the screen awake, reconnect and catch up when
 * it wakes anyway, and the "About this screen" report. `?perf` opens the
 * report at once; otherwise a small button does.
 */

import { useEffect, useState } from "react";
import { useGameStore } from "../store";
import { perfRequested } from "../world/frame-stats";
import { onAudioStatus } from "../audio/status";
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

  return (
    <div className="kad-about">
      {open ? <CapabilityReport wake={wake} onClose={() => { setOpen(false); }} /> : (
        <button type="button" className="kad-about__open" onClick={() => { setOpen(true); }}>
          About this screen
        </button>
      )}
    </div>
  );
}

function CapabilityReport({ wake, onClose }: { wake: WakeLockState; onClose: () => void }): React.JSX.Element {
  const [rows, setRows] = useState<Capability[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => onAudioStatus(() => { setTick((n) => n + 1); }), []);
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
