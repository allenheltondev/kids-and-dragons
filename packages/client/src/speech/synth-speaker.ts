/**
 * The browser's own voice behind `speak()` (spec §11).
 *
 * Free, offline, and good enough to start with. This file is the only one that
 * knows `SpeechSynthesis` exists, and it is loaded on demand (read-aloud.ts), so
 * a better voice later is another `Speaker` installed in its place and nothing
 * else moves.
 *
 * Two browser habits are handled here so no call site has to know them:
 *  - Chrome silently stops an utterance that runs past ~15 seconds, so a line is
 *    cut into sentence-sized pieces and queued.
 *  - A page that has not had a tap yet may be refused (`not-allowed`). The
 *    refused line is kept and said on the first tap or key press.
 */

import type { SpeakOptions, Speaker } from "@kad/shared";

/** The slice of the Web Speech API in use, so a test can supply a fake. */
export interface SynthLike {
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
  getVoices(): SpeechSynthesisVoice[];
}

export interface SynthSpeakerEnv {
  synth: SynthLike;
  createUtterance: (text: string) => SpeechSynthesisUtterance;
  /** Where to wait for the first gesture. */
  gestureTarget?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
}

/** Kind to a read-aloud listener: a touch slower than conversation. */
const DEFAULT_RATE = 0.92;
const MAX_PIECE = 180;

/** One sentence into pieces within MAX_PIECE: at word boundaries, and mid-word only for a token that is itself too long. */
function splitLong(sentence: string): string[] {
  if (sentence.length <= MAX_PIECE) return [sentence];
  const pieces: string[] = [];
  let line = "";
  const flush = (): void => {
    if (line !== "") pieces.push(line);
    line = "";
  };
  for (const word of sentence.split(" ")) {
    if (word.length > MAX_PIECE) {
      flush();
      for (let at = 0; at < word.length; at += MAX_PIECE) pieces.push(word.slice(at, at + MAX_PIECE));
    } else if (line === "") line = word;
    else if (line.length + 1 + word.length <= MAX_PIECE) line += ` ${word}`;
    else {
      flush();
      line = word;
    }
  }
  flush();
  return pieces;
}

/** "One. Two! Three?" into pieces no longer than MAX_PIECE, kept to sentence ends where a sentence allows. */
export function sentencePieces(text: string): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?…])\s+/).filter((s) => s !== "").flatMap(splitLong);
  const pieces: string[] = [];
  for (const sentence of sentences) {
    const last = pieces[pieces.length - 1];
    if (last !== undefined && last.length + 1 + sentence.length <= MAX_PIECE) pieces[pieces.length - 1] = `${last} ${sentence}`;
    else pieces.push(sentence);
  }
  return pieces;
}

function pickVoice(voices: SpeechSynthesisVoice[], wanted: string | undefined): SpeechSynthesisVoice | null {
  if (wanted === undefined) return null;
  return voices.find((v) => v.voiceURI === wanted || v.name === wanted) ?? null;
}

/**
 * The device voice, plus a way to hear when a line is over: the recorded-voice speaker
 * (clip-speaker.ts) queues clips and device lines in one order, so it waits on each.
 */
export type DeviceVoice = Speaker & {
  /** Says `text` as the speaker would, and calls `done` once when it ends, fails or is cut off. */
  sayThen(text: string, opts: SpeakOptions | undefined, done: () => void): void;
};

export function createSynthSpeaker(env: SynthSpeakerEnv): DeviceVoice {
  const { synth, createUtterance } = env;
  let refused: { text: string; opts?: SpeakOptions } | null = null;
  let waiting = false;

  const retry = (): void => {
    env.gestureTarget?.removeEventListener("pointerdown", retry);
    env.gestureTarget?.removeEventListener("keydown", retry);
    waiting = false;
    const again = refused;
    refused = null;
    if (again) say(again.text, again.opts);
  };

  const holdForGesture = (text: string, opts?: SpeakOptions): void => {
    // Only the newest refused line is worth saying once the tap comes.
    refused = { text, ...(opts ? { opts } : {}) };
    if (waiting || !env.gestureTarget) return;
    waiting = true;
    env.gestureTarget.addEventListener("pointerdown", retry);
    env.gestureTarget.addEventListener("keydown", retry);
  };

  // Utterances still to finish, held so a browser cannot collect one before its `end` fires.
  const live = new Set<SpeechSynthesisUtterance>();

  function say(text: string, opts?: SpeakOptions, done?: () => void): void {
    if (opts?.interrupt) synth.cancel();
    const voice = pickVoice(synth.getVoices(), opts?.voice);
    const pieces = sentencePieces(text);
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      done?.();
    };
    if (pieces.length === 0) finish();
    pieces.forEach((piece, index) => {
      const utterance = createUtterance(piece);
      utterance.rate = opts?.rate ?? DEFAULT_RATE;
      if (voice) utterance.voice = voice;
      else utterance.lang = "en-US";
      live.add(utterance);
      utterance.onend = () => {
        live.delete(utterance);
        if (index === pieces.length - 1) finish();
      };
      utterance.onerror = (event) => {
        live.delete(utterance);
        if (event.error === "not-allowed") holdForGesture(text, opts);
        // Refused, cut off or broken: the line is over either way, and whatever waits on it goes on.
        finish();
      };
      synth.speak(utterance);
    });
  }

  const speaker = ((text, opts) => say(text, opts)) as DeviceVoice;
  speaker.sayThen = (text, opts, done) => say(text, opts, done);
  speaker.cancel = () => {
    refused = null;
    synth.cancel();
  };
  return speaker;
}
