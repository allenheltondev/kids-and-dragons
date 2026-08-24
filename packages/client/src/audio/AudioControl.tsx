/**
 * The speaker button — and, invisibly, the audio system's lifecycle.
 *
 * This component owns the engine because their lives are identical: audio
 * exists exactly where a world surface is mounted (a TV in Party Mode, the top
 * pane in Travel Mode), and the mute control has to live on that surface
 * anyway. Phones that never mount a WorldView therefore never install a sink,
 * which is what keeps the living room down to one speaker without anybody
 * asking what device they are (architecture §4.6 rule 2 — the surface still
 * has no idea; it just *is* the one that makes sound).
 *
 * The window listeners are the browser autoplay gate: a context is only
 * allowed to start inside a user gesture, so the first tap or keypress
 * anywhere unlocks the engine. They stay registered for the surface's whole
 * life because `unlock()` is idempotent and a first *successful* unlock can
 * happen on any gesture after a failed one.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "../ui";
import { Icon } from "../screens/icons";
import { setAudioSink } from "./cue";
import { createAudioEngine, type AudioEngine } from "./engine";

import "./AudioControl.css";

export function AudioControl(): React.JSX.Element {
  const engineRef = useRef<AudioEngine | null>(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const engine = createAudioEngine();
    engineRef.current = engine;
    setMuted(engine.muted());
    setAudioSink(engine.sink);

    const unlock = (): void => engine.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      setAudioSink(null);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const toggle = (): void => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !engine.muted();
    engine.setMuted(next);
    setMuted(next);
  };

  return (
    <div className="kad-audio-control">
      <Button
        variant="ghost"
        size="md"
        aria-label={muted ? "Turn sound on" : "Turn sound off"}
        aria-pressed={muted}
        icon={<Icon name={muted ? "muted" : "sound"} />}
        onClick={toggle}
      />
    </div>
  );
}
