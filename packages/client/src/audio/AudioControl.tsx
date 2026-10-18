/** The shell keeps one engine through home, creation and play. Party controllers
 * disable it after joining, leaving the display as the room's only speaker.
 * Pointer and keyboard gestures unlock (or resume) audio; mute survives sessions.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "../ui";
import { Icon } from "../screens/icons";
import { isQuiet, onQuietChange } from "../quiet";
import { setAudioSink } from "./cue";
import { createAudioEngine, type AudioEngine, type AudioState } from "./engine";
import { reportAudioStatus } from "./status";

import "./AudioControl.css";

/**
 * `display` is the shared screen (#264): a TV browser often holds sound back
 * until something is tapped, and nobody is looking at the screen's small hint,
 * so there it is one plain "Tap for sound" button for as long as the browser
 * is still holding sound back. Silent play is untouched: the game never waits
 * on it, and a browser with no audio at all is never asked for a tap.
 */
export function AudioControl({ enabled = true, soundtrack = null, ready = false, readinessKey = "", display = false }: { enabled?: boolean; soundtrack?: string | null; ready?: boolean; readinessKey?: string; display?: boolean }): React.JSX.Element | null {
  const wasReady = useRef(ready);
  const previousKey = useRef(readinessKey);
  const engineRef = useRef<AudioEngine | null>(null);
  const [muted, setMuted] = useState(false);
  const [locked, setLocked] = useState(true);
  const [audio, setAudio] = useState<AudioState>("locked");
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
    setLocked(!engine.unlocked());
    setAudioSink(engine.sink);
    const syncAudio = (): void => {
      const next = engine.state();
      setAudio(next);
      reportAudioStatus(next);
    };
    syncAudio();
    const stopAudioWatch = engine.onStateChange(syncAudio);

    const unlock = (): void => {
      engine.unlock();
      // Asking the engine rather than assuming: a browser that refuses a
      // context leaves this locked, and the prompt stays honest rather than
      // vanishing on a gesture that achieved nothing.
      setLocked(!engine.unlocked());
      syncAudio();
    };
    // A hidden tab can re-suspend a running context; on coming back, say so.
    document.addEventListener("visibilitychange", syncAudio);
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
      stopAudioWatch();
      document.removeEventListener("visibilitychange", syncAudio);
      reportAudioStatus("unknown");
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

  const changeVolume = (next: number): void => {
    engineRef.current?.setVolume(next);
    setVolume(next);
  };

  if (!enabled) return null;

  return (
    <div className="kad-audio-control">
      {display ? (
        !muted && (audio === "locked" || audio === "suspended") ? (
          <Button
            className="kad-audio-control__tap"
            variant="primary"
            size="lg"
            onClick={() => { engineRef.current?.unlock(); }}
          >
            Tap for sound
          </Button>
        ) : null
      ) : locked && !muted ? (
        <p className="kad-audio-control__hint">Click or press a key for sound</p>
      ) : null}
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
        aria-label={muted ? "Turn sound on" : "Turn sound off"}
        aria-pressed={muted}
        icon={<Icon name={muted ? "muted" : "sound"} />}
        onClick={toggle}
      />
    </div>
  );
}
