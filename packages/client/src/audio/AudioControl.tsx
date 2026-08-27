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
 *
 * ---------------------------------------------------------------------------
 * AND SOMETHING HAS TO *ASK* FOR THAT GESTURE
 *
 * On a phone the gesture is free: you cannot play without tapping. The screen
 * everybody is actually looking at is the one where it is not — a display
 * client (`/tv/:code`) is opened on a laptop wired to the television and then
 * left alone all evening. Nothing about the game asks it for a click, so the
 * context never opens, every cue is dropped, and the sound nobody hears looks
 * exactly like sound that was never built.
 *
 * So while the engine is still locked and unmuted, the surface says so, once,
 * quietly. It costs a click on the machine driving the TV and disappears for
 * good — including if somebody simply presses a key, which is what a remote's
 * D-pad sends if the television is running the page itself.
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
  const [locked, setLocked] = useState(true);

  useEffect(() => {
    const engine = createAudioEngine();
    engineRef.current = engine;
    setMuted(engine.muted());
    setLocked(!engine.unlocked());
    setAudioSink(engine.sink);

    const unlock = (): void => {
      engine.unlock();
      // Asking the engine rather than assuming: a browser that refuses a
      // context leaves this locked, and the prompt stays honest rather than
      // vanishing on a gesture that achieved nothing.
      setLocked(!engine.unlocked());
    };
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
      {locked && !muted ? (
        <p className="kad-audio-control__hint">Click or press a key for sound</p>
      ) : null}
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
