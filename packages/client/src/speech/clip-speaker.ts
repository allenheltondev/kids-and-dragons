/**
 * Recorded narration behind `speak()` (docs/voice-narration-plan.md §7).
 *
 * A `Speaker` in front of the device voice. A line that arrives with the authored pieces it was
 * composed from (`opts.parts`, the engine's `RunState.narrationParts`) is looked up in its
 * chapter's voice manifest, and when **every** piece has its clips, those clips are fetched,
 * decoded and played through the audio engine's voice bus (audio/engine.ts), with the music
 * ducked. Anything else goes to the device voice, unchanged: live lines (turns, decisions, the
 * fight log) never carry parts, and a narration line whose clips are not all there is read by
 * the device voice **whole**. Half Pib and half robot is worse than consistently robot.
 *
 * Recorded voice is an upgrade, never a requirement. A chapter with no manifest, a line missing
 * from it, a 404, bytes that will not decode, no signal, an engine no gesture has started, or
 * clips slower than RESOLVE_MS all send the line to the device voice, which never waits longer
 * than that to start.
 *
 * `speak()`'s rules are kept: `interrupt` cuts off what is playing and everything queued; any
 * other line waits its turn. Device lines are handed straight to the browser's own queue, as
 * they always were. A recorded line waits for the device lines ahead of it to end, and the
 * device lines behind it wait for it, so the two voices never talk over each other. A line whose
 * clips turn out not to be there is a device line like any other: it joins the browser's queue
 * at once, never waiting on an "ended" a browser may not send (#593's e2e found the wait).
 *
 * Manifests are fetched the first time a chapter's line is spoken, one file per chapter, never
 * at first paint. Clips are fetched when their line is queued, so a line queued behind the
 * "Last time…" is ready by the time its turn comes. Caching them (the service worker, prefetch
 * one scene ahead) is #547's; the URL is the hash, so the browser's HTTP cache already keeps them.
 */

import { clipPath, manifestPath, playlistFor, type NarrationPart, type SpeakOptions, type Speaker, type VoiceManifest } from "@kad/shared";
import { getAudioSink, type VoiceBuffer, type VoiceChannel } from "../audio/cue";
import { createSynthSpeaker, type DeviceVoice } from "./synth-speaker";

/** The slice of `fetch`'s answer in use, so a test can hand in plain objects. */
export interface FetchedLike {
  ok: boolean;
  /** The HTTP status; absent reads as 404. */
  status?: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ClipSpeakerEnv {
  /** Reads every line that is not recorded, and every recorded line whose clips are not all there. */
  device: DeviceVoice;
  /** The audio engine's voice bus, when there is a running engine on this device. */
  channel: () => VoiceChannel | null;
  fetch: (url: string) => Promise<FetchedLike>;
  /** True while something is being said, recorded or not: the narration panel's "speaking" mark. */
  onSpeaking?: (speaking: boolean) => void;
  /** How long a recorded line may take to arrive before the device voice reads it instead. */
  resolveMs?: number;
}

/**
 * Answers that mean a chapter has no manifest yet, kept for the evening. S3 behind CloudFront
 * answers a missing key with 403. Anything else that is not OK is a passing trouble.
 */
const MISSING: ReadonlySet<number> = new Set([403, 404, 410]);

/** Long enough for a few small clips over house wifi; short enough that a dead line is not a pause. */
export const RESOLVE_MS = 2500;
/**
 * The longest a device line may hold up a recorded one behind it, when the browser never says the
 * line ended: generous (nine characters a second) because ending it early talks over the device.
 */
const DEVICE_MS_PER_CHAR = 110;
const GRACE_MS = 2000;

/** Which manifest an address is filed in: a chapter's lines are addressed `<chapter>/…` (voice-clips.ts). */
export function manifestOf(address: string | undefined): string | null {
  const name = address?.split("/")[0] ?? "";
  return name === "" || name.startsWith("@") ? null : name;
}

interface Job {
  text: string;
  opts: SpeakOptions | undefined;
  /** The decoded clips to play, or null for the device voice. Absent for a line with no parts. */
  clips?: Promise<VoiceBuffer[] | null>;
  /** Set once `clips` has settled to null: the line is the device voice's, and need not wait. */
  deviceOnly?: boolean;
}

export function createClipSpeaker(env: ClipSpeakerEnv): Speaker {
  const resolveMs = env.resolveMs ?? RESOLVE_MS;
  const manifests = new Map<string, Promise<VoiceManifest | null>>();
  let queue: Job[] = [];
  /** Bumped by every cancel, so a callback from a line that was cut off changes nothing. */
  let generation = 0;
  /** Device lines handed to the browser and not yet over. */
  let deviceLines = 0;
  /** A recorded line is resolving or playing; everything behind it waits. */
  let recording = false;
  let stopClips: (() => void) | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let speaking = false;

  const after = (ms: number, fn: () => void): (() => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
    return () => {
      clearTimeout(timer);
      timers.delete(timer);
    };
  };

  function mark(): void {
    const now = recording || deviceLines > 0;
    if (now === speaking) return;
    speaking = now;
    env.onSpeaking?.(now);
  }

  function manifest(name: string): Promise<VoiceManifest | null> {
    let loading = manifests.get(name);
    if (loading === undefined) {
      // A 404 is an answer (nothing recorded for this chapter yet) and is kept for the evening;
      // no signal is not, so the next line asks again.
      loading = env
        .fetch(manifestPath(name))
        .then((response) => {
          if (response.ok) return response.json() as Promise<VoiceManifest>;
          // Only "not here" is kept: a 429 or a 503 is asked again on the next line (#593 review).
          if (!MISSING.has(response.status ?? 404)) manifests.delete(name);
          return null;
        })
        .catch(() => {
          manifests.delete(name);
          return null;
        });
      manifests.set(name, loading);
    }
    return loading;
  }

  async function gather(parts: readonly NarrationPart[]): Promise<VoiceBuffer[] | null> {
    const names = parts.map((part) => manifestOf(part.address));
    if (names.includes(null)) return null;
    const loaded = await Promise.all([...new Set(names as string[])].map(manifest));
    if (loaded.includes(null)) return null;
    const playlist = playlistFor(parts, Object.assign({}, ...loaded) as VoiceManifest);
    const channel = env.channel();
    if (playlist === null || channel === null || !channel.ready()) return null;
    // One fetch and one decode per clip, however often the line repeats it.
    const decoded = new Map<string, Promise<VoiceBuffer>>();
    const clip = (key: string): Promise<VoiceBuffer> => {
      let buffer = decoded.get(key);
      if (buffer === undefined) {
        buffer = env.fetch(clipPath(key)).then(async (response) => {
          if (!response.ok) throw new Error(`clip ${key} is not there`);
          return channel.decode(await response.arrayBuffer());
        });
        decoded.set(key, buffer);
      }
      return buffer;
    };
    return Promise.all(playlist.map((entry) => clip(entry.clip)));
  }

  /** The clips for `parts`, or null, never later than `resolveMs` and never rejecting. */
  function resolve(parts: readonly NarrationPart[]): Promise<VoiceBuffer[] | null> {
    return new Promise((settle) => {
      const cancelTimer = after(resolveMs, () => settle(null));
      gather(parts).then(
        (buffers) => {
          cancelTimer();
          settle(buffers);
        },
        () => {
          cancelTimer();
          settle(null);
        },
      );
    });
  }

  /** Hands a line to the device voice and counts it until it is over (or should have been). */
  function deviceSay(job: Job): void {
    const at = generation;
    deviceLines += 1;
    mark();
    let over = false;
    let cancelWatch = (): void => undefined;
    const done = (): void => {
      if (over || at !== generation) return;
      over = true;
      cancelWatch();
      deviceLines -= 1;
      mark();
      pump();
    };
    cancelWatch = after((job.text.length * DEVICE_MS_PER_CHAR) / (job.opts?.rate ?? 1) + GRACE_MS, done);
    env.device.sayThen(job.text, job.opts, done);
  }

  function playRecorded(job: Job, clips: Promise<VoiceBuffer[] | null>): void {
    const at = generation;
    recording = true;
    mark();
    void clips.then((buffers) => {
      if (at !== generation) return;
      const channel = env.channel();
      if (buffers === null || channel === null || !channel.ready()) {
        // All or nothing: the whole line, in the device voice, now.
        recording = false;
        deviceSay(job);
        pump();
        return;
      }
      let over = false;
      let cancelWatch = (): void => undefined;
      const done = (): void => {
        if (over || at !== generation) return;
        over = true;
        cancelWatch();
        stopClips = null;
        recording = false;
        mark();
        pump();
      };
      // A context the browser suspends mid-line never says the clips ended; the scene goes on anyway.
      const ms = buffers.reduce((total, buffer) => total + buffer.duration * 1000, 0);
      cancelWatch = after(ms + GRACE_MS, () => {
        stopClips?.();
        done();
      });
      const stop = channel.play(buffers, done);
      if (!over) stopClips = stop;
    });
  }

  function pump(): void {
    while (queue.length > 0 && !recording) {
      const job = queue[0]!;
      if (job.clips === undefined || job.deviceOnly) {
        queue.shift();
        deviceSay(job);
        continue;
      }
      // A recorded line starts once the device has finished what it was handed before it.
      if (deviceLines > 0) return;
      queue.shift();
      playRecorded(job, job.clips);
    }
  }

  function cancel(): void {
    generation += 1;
    queue = [];
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    const stop = stopClips;
    stopClips = null;
    recording = false;
    deviceLines = 0;
    try {
      stop?.();
    } finally {
      env.device.cancel?.();
      mark();
    }
  }

  const speaker: Speaker = (text, opts) => {
    if (opts?.interrupt) cancel();
    const { interrupt: _interrupt, parts, ...rest } = opts ?? {};
    const job: Job = { text, opts: Object.keys(rest).length > 0 ? rest : undefined };
    if (parts !== undefined && parts.length > 0) {
      const clips = resolve(parts);
      job.clips = clips;
      const at = generation;
      // Nothing to play: hand it to the browser behind what it already has, now.
      void clips.then((buffers) => {
        if (buffers !== null || at !== generation) return;
        job.deviceOnly = true;
        pump();
      });
    }
    queue.push(job);
    pump();
  };
  speaker.cancel = cancel;
  return speaker;
}

/** The table's speaker, on this browser: the recorded voice over `SpeechSynthesis`. */
export function createTableSpeaker(onSpeaking: (speaking: boolean) => void): Speaker {
  return createClipSpeaker({
    device: createSynthSpeaker({
      synth: window.speechSynthesis,
      createUtterance: (text) => new SpeechSynthesisUtterance(text),
      gestureTarget: window,
    }),
    channel: () => getAudioSink()?.voice ?? null,
    fetch: (url) => fetch(url),
    onSpeaking,
  });
}
