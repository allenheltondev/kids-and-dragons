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
 */

export interface SpeakOptions {
  /** What is being spoken. A speaker may want a different voice per source. */
  source?: "narration" | "choice" | "prompt" | "ui";
  /** Cancel anything currently speaking. Defaults to false — don't stomp. */
  interrupt?: boolean;
  /** Speaker-defined voice id. */
  voice?: string;
  /** 1 is normal. */
  rate?: number;
}

export type Speaker = (text: string, opts?: SpeakOptions) => void;

let current: Speaker | null = null;

/**
 * Installs a speaker. Pass `null` to go back to silence — the accessibility
 * toggle turns TTS off by uninstalling, so no call site needs a conditional.
 */
export function setSpeaker(speaker: Speaker | null): void {
  current = speaker;
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
    speaker(text, opts);
  } catch {
    // Flavor, never load-bearing (spec §10.3, same principle).
  }
}
