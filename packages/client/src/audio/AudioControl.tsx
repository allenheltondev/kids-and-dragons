/** The shell keeps one engine through home, creation and play. Party controllers
 * disable it after joining, leaving the display as the room's only speaker.
 * Pointer and keyboard gestures unlock (or resume) audio; mute survives sessions.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "../ui";
import { Icon } from "../screens/icons";
import { isQuiet, onQuietChange } from "../quiet";
import { setAudioProbe, setAudioSink } from "./cue";
import { createAudioEngine, type AudioEngine } from "./engine";

import "./AudioControl.css";

export function AudioControl({ enabled = true, soundtrack = null, ready = false, readinessKey = "" }: { enabled?: boolean; soundtrack?: string | null; ready?: boolean; readinessKey?: string }): React.JSX.Element | null {
  const wasReady = useRef(ready);
  const previousKey = useRef(readinessKey);
  const engineRef = useRef<AudioEngine | null>(null);
  const [muted, setMuted] = useState(false);
  const [locked, setLocked] = useState(false);
  const [quiet, setQuiet] = useState(isQuiet());
  const [volume, setVolume] = useState(0.8);

  useEffect(() => {
    if (!enabled) return;
    const engine = createAudioEngine();
    engineRef.current = engine;
    setMuted(engine.muted());
    setVolume(engine.volume());
    engine.setQuiet(isQuiet());
    setQuiet(isQuiet());
    const refreshState = (): void => {
      const state = engine.state();
      setLocked(state === "locked" || state === "suspended");
    };
    refreshState();
    const stopState = engine.onStateChange(refreshState);
    setAudioSink(engine.sink);
    setAudioProbe(engine);

    const unlock = (event: Event): void => {
      // This button owns its gesture: unlocking on pointerdown and then
      // toggling on click would immediately mute the sound it just enabled.
      if (event.target instanceof Element && event.target.closest(".kad-audio-control__button")) return;
      engine.unlock();
      refreshState();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    // The room went quiet, or came back: the engine scales and drops, and the
    // slider appears so this device can still go lower than the room's cap.
    const stopQuiet = onQuietChange((next) => {
      engine.setQuiet(next);
      setQuiet(next);
    });
    return () => {
      stopQuiet();
      stopState();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      setAudioSink(null);
      setAudioProbe(null);
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
    const state = engine.state();
    if (!engine.muted() && (state === "locked" || state === "suspended")) {
      engine.unlock();
      return;
    }
    const next = !engine.muted();
    engine.setMuted(next);
    setMuted(next);
    if (!next) engine.unlock();
  };

  const changeVolume = (next: number): void => {
    engineRef.current?.setVolume(next);
    setVolume(next);
  };

  if (!enabled) return null;

  return (
    <div className="kad-audio-control" data-locked={locked && !muted || undefined}>
      {quiet && !muted ? (
        <input
          className="kad-audio-control__volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label="Volume on this device"
          onChange={(event) => changeVolume(Number(event.target.value))}
        />
      ) : null}
      <Button
        className="kad-audio-control__button"
        variant="ghost"
        size="md"
        aria-label={muted ? "Turn sound on" : locked ? "Enable sound" : "Turn sound off"}
        title={muted ? "Turn sound on" : locked ? "Enable sound" : "Turn sound off"}
        aria-pressed={muted}
        icon={<Icon name={muted || locked ? "muted" : "sound"} />}
        onClick={toggle}
      />
    </div>
  );
}
