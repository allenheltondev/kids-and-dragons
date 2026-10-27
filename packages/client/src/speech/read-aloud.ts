/**
 * Read-aloud: whether this device speaks, and the engine behind it.
 *
 * The switch is per device and remembered in localStorage, because it belongs to
 * whoever is holding the screen, not to the household or the room: in Party Mode
 * the TV and each phone decide for themselves. The shared screen (the TV) reads
 * aloud by default, because it is the room's narrator; every other device is off
 * by default. Once somebody flips the switch, that choice is remembered and wins
 * over the default on that device. Off means no speaker is installed, so
 * `speak()` is the no-op it always was and nothing else in the game changes.
 *
 * Who speaks what (the Party Mode decision, also in docs/read-aloud.md):
 *  - the TV reads the narration, roll prompts and hand-offs (NarrationPanel);
 *  - a phone reads its own choices (PlayerPanel), and only its own;
 *  - a Travel Mode phone is both surfaces, so it does both, in that order.
 * Each device speaks only when its own switch is on.
 *
 * The engine (synth-speaker.ts) is a dynamic import: a device that never turns
 * this on never downloads it, and the entry chunk only pays for this small file.
 */

import { create } from "zustand";
import { setSpeaker, stopSpeaking, type SpeakOptions } from "@kad/shared";

export const READ_ALOUD_KEY = "kad.readaloud";

/** Browsers without SpeechSynthesis (some in-app webviews) get no switch at all. */
export function readAloudSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

// Straight to localStorage (in try/catch, as private mode throws): importing the store's persistence
// helper would tie this lazy module to the entry chunk and cost first-paint bytes for one string.
// Null when nobody on this device has chosen yet, so the surface's default applies.
function loadStored(): boolean | null {
  try {
    const stored = localStorage.getItem(READ_ALOUD_KEY);
    return stored === "1" ? true : stored === "0" ? false : null;
  } catch {
    return null;
  }
}

interface ReadAloudState {
  on: boolean;
}

const useStore = create<ReadAloudState>(() => ({ on: (loadStored() ?? false) && readAloudSupported() }));

type SpeakerModule = typeof import("./synth-speaker");
let engine: Promise<ReturnType<SpeakerModule["createSynthSpeaker"]>> | null = null;

function loadEngine(): Promise<ReturnType<SpeakerModule["createSynthSpeaker"]>> {
  engine ??= import("./synth-speaker").then((module) =>
    module.createSynthSpeaker({
      synth: window.speechSynthesis,
      createUtterance: (text) => new SpeechSynthesisUtterance(text),
      gestureTarget: window,
    }),
  );
  return engine;
}

/** Installs or removes the speaker to match the switch. Safe to call again. */
function apply(on: boolean): void {
  if (!on) {
    setSpeaker(null);
    return;
  }
  void loadEngine()
    .then((speaker) => {
      // The switch may have gone off while the engine was loading.
      if (useStore.getState().on) setSpeaker(speaker);
    })
    .catch(() => {
      // A chunk that will not load is a device that does not read aloud: flavor, not load-bearing.
      engine = null;
    });
}

export function setReadAloud(on: boolean): void {
  const next = on && readAloudSupported();
  useStore.setState({ on: next });
  try {
    localStorage.setItem(READ_ALOUD_KEY, next ? "1" : "0");
  } catch {
    // Private mode: it holds until the page closes, which is the best it can do.
  }
  apply(next);
}

/**
 * Starts the stored preference, or this surface's default when nobody has chosen:
 * `defaultOn` is true on the shared screen. Called at boot and again when the
 * device becomes (or stops being) the TV. The default is not written down, so
 * only a real flip of the switch is remembered.
 */
export function startReadAloud(defaultOn = false): void {
  const on = (loadStored() ?? defaultOn) && readAloudSupported();
  useStore.setState({ on });
  apply(on);
}

export function useReadAloud(): { supported: boolean; on: boolean; setOn: (on: boolean) => void } {
  const on = useStore((state) => state.on);
  return { supported: readAloudSupported(), on, setOn: setReadAloud };
}

/** True when this device reads aloud. For a surface that adds something only then (a speaker icon). */
export function useReadAloudOn(): boolean {
  return useStore((state) => state.on);
}

/**
 * Say this now, because somebody tapped a button asking to hear it: help text,
 * the tutorial, a "Read aloud" button. Interrupts whatever is being said.
 *
 * Works with the device switch off, since the tap is the request, and leaves the
 * switch alone.
 */
export function hear(text: string, opts: SpeakOptions = {}): void {
  if (!readAloudSupported()) return;
  const options = { ...opts, interrupt: true };
  void loadEngine()
    .then((speaker) => {
      try {
        speaker(text, options);
      } catch {
        // as speak()
      }
    })
    .catch(() => {
      engine = null;
    });
}

export { stopSpeaking };
