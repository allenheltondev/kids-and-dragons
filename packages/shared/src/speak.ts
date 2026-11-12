/**
 * The TTS seam — spec §11.
 *
 * "All narration and choice text flows through a `speak()` seam that is a no-op
 * in v1 and can be wired to a TTS engine later without touching game code."
 *
 * That is the entire contract. The value of writing it now is that every call
 * site exists by the time a speaker is plugged in; retrofitting the call sites
 * later is the expensive half.
 *
 * The **render layer** calls this — never the engine. `engine.ts` runs in Lambda
 * (architecture §4.1), and narration read aloud in a Lambda helps nobody.
 *
 * What it is handed is the **composed** text: `RunState.narration` and the
 * prompt's option labels already have their narration variants applied and
 * `{facets}` / `{party}` tokens filled by the engine (narration.ts, #159), so
 * read-aloud says exactly what the screen shows and never a raw `{token}`.
 *
 * With one exception: a player's name is shown, never spoken (#552). Every
 * line is reworded through `withoutNames` with the party's names before a
 * speaker hears it, so a name never reaches the device voice or a provider.
 */

import type { NarrationPart } from "./narration.js";
import { withoutNames } from "./spoken-names.js";

export interface SpeakOptions {
  /** What is being spoken. A speaker may want a different voice per source. */
  source?: "narration" | "choice" | "prompt" | "ui";
  /** Cancel anything currently speaking. Defaults to false — don't stomp. */
  interrupt?: boolean;
  /** Speaker-defined voice id. */
  voice?: string;
  /** 1 is normal. */
  rate?: number;
  /**
   * The authored pieces `text` was composed from (`RunState.narrationParts`), when it is
   * exactly a scene's narration. A recorded-voice speaker plays their clips instead of reading
   * the text (docs/voice-narration-plan.md §7); every other speaker ignores them. Absent on
   * live lines (turns, decisions, the fight log), which only ever reach the device voice.
   */
  parts?: readonly NarrationPart[];
}

/** How soon a prefetch wants its clips: `near` is the next scenes, `background` the rest of the chapter. */
export interface PrefetchOptions {
  background?: boolean;
}

export type Speaker = ((text: string, opts?: SpeakOptions) => void) & {
  /** Silence whatever is being said or queued. Optional: a speaker that cannot is simply left to finish. */
  cancel?: () => void;
  /**
   * Fetch the recordings for the lines at these addresses (or under these address prefixes,
   * `<chapter>/<scene>/`) before they are spoken. Optional: only a recorded voice has anything to
   * fetch (speech/clip-speaker.ts).
   */
  prefetch?: (prefixes: readonly string[], opts?: PrefetchOptions) => void;
  /**
   * Drop every prefetch not yet started, and any still working out what to fetch. A clip already
   * on its way finishes, and nothing being spoken is touched: this retires guesses, not speech.
   */
  stopPrefetch?: () => void;
};

let current: Speaker | null = null;
let unspoken: readonly string[] = [];

/**
 * The names no speaker may say: the party's hero names, set by the client
 * whenever the party changes. They are said as "hero" (spoken-names.ts).
 */
export function setUnspokenNames(names: readonly string[]): void {
  unspoken = [...names];
}

/** `text` as a speaker may hear it: no party name in it. For a path that calls a speaker directly. */
export function spokenText(text: string): string {
  return withoutNames(text, unspoken);
}

/**
 * Installs a speaker. Pass `null` to go back to silence — the accessibility
 * toggle turns TTS off by uninstalling, so no call site needs a conditional.
 * The speaker being replaced is cut off mid-sentence, so switching it off
 * is immediate.
 */
export function setSpeaker(speaker: Speaker | null): void {
  if (current !== speaker) stopSpeaking();
  current = speaker;
  // A prefetch asked for while the speaker was still loading is made now it is here.
  if (speaker?.prefetch) for (const [prefixes, opts] of asked) callPrefetch(speaker, prefixes, opts);
}

/** The latest prefetch requests, kept for a speaker that arrives after them (the read-aloud engine loads lazily). */
const asked: [readonly string[], PrefetchOptions | undefined][] = [];
const ASKED_KEPT = 8;

function callPrefetch(speaker: Speaker, prefixes: readonly string[], opts: PrefetchOptions | undefined): void {
  try {
    speaker.prefetch?.(prefixes, opts);
  } catch {
    // A prefetch is a favour; failing at it must never reach the scene.
  }
}

/**
 * Asks the speaker to fetch the recordings for lines it is about to be given, so a slow
 * connection has them by the time they are spoken. Nothing without a recorded speaker, and a
 * request made before one is installed waits for it (the last few are kept).
 */
export function prefetchNarration(prefixes: readonly string[], opts?: PrefetchOptions): void {
  if (prefixes.length === 0) return;
  asked.push([prefixes, opts]);
  if (asked.length > ASKED_KEPT) asked.shift();
  if (current?.prefetch) callPrefetch(current, prefixes, opts);
}

/**
 * Retires the guessing ahead: what is queued is dropped, and what was asked for before a speaker
 * existed is forgotten. For a world that leaves the screen, a page that is hidden, a chapter that
 * is over; the lines being spoken are not touched.
 */
export function stopPrefetchNarration(): void {
  asked.length = 0;
  try {
    current?.stopPrefetch?.();
  } catch {
    // As prefetchNarration: a favour, never a failure.
  }
}

/** Tests: forget what was asked for. */
export function resetPrefetchRequests(): void {
  asked.length = 0;
}

/** Stops the current line and anything queued behind it. Never throws. */
export function stopSpeaking(): void {
  try {
    current?.cancel?.();
  } catch {
    // Same principle as speak(): silence must not be able to break a scene.
  }
}

export function getSpeaker(): Speaker | null {
  return current;
}

/**
 * Speaks, or does nothing. Never throws: a broken speaker must not be able to
 * take down the scene it was only narrating.
 */
export function speak(text: string, opts?: SpeakOptions): void {
  const speaker = current;
  if (!speaker || !text) return;
  try {
    speaker(spokenText(text), opts);
  } catch {
    // Flavor, never load-bearing (spec §10.3, same principle).
  }
}
