/** The shell keeps one engine through home, creation and play. Party controllers
 * disable it after joining, leaving the display as the room's only speaker.
 * Pointer and keyboard gestures unlock (or resume) audio; mute survives sessions.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "../ui";
import { Icon } from "../screens/icons";
import { setAudioSink } from "./cue";
import { createAudioEngine, type AudioEngine } from "./engine";

import "./AudioControl.css";

export function AudioControl({ enabled = true, soundtrack = null, ready = false, readinessKey = "" }: { enabled?: boolean; soundtrack?: string | null; ready?: boolean; readinessKey?: string }): React.JSX.Element | null {
  const wasReady = useRef(ready);
  const previousKey = useRef(readinessKey);
  const engineRef = useRef<AudioEngine | null>(null);
  const [muted, setMuted] = useState(false);
  const [locked, setLocked] = useState(true);

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);

  useEffect(() => {
    engineRef.current?.sink.music(soundtrack);
  }, [enabled, soundtrack]);

  useEffect(() => {
    if (enabled && readinessKey === previousKey.current && ready && !wasReady.current) engineRef.current?.sink.cue("party-ready");
    wasReady.current = ready;
    previousKey.current = readinessKey;
  }, [enabled, ready, readinessKey]);

  const toggle = (): void => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !engine.muted();
    engine.setMuted(next);
    setMuted(next);
  };

  if (!enabled) return null;

  return (
    <div className="kad-audio-control">
      {locked && !muted ? (
        <p className="kad-audio-control__hint">Click or press a key for sound</p>
      ) : null}
      <Button
        className="kad-audio-control__button"
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
