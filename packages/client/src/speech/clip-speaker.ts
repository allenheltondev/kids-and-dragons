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
 * Every clip boundary gets a breath of VOICE_GAP_MS (audio/cue.ts): between the clips of a line
 * (the engine schedules it on the audio clock) and between one line and the next (`rest`, here),
 * whichever voice said them, never after the last. A skip, a stop or a new scene clears it.
 *
 * Manifests are fetched the first time a chapter's line is spoken, one file per chapter, never
 * at first paint. Clips are fetched when their line is queued, so a line queued behind the
 * "Last time…" is ready by the time its turn comes, in play order with LINE_WINDOW of them in
 * flight, and a line starts as soon as its **first** clip is decoded: the rest arrive while it
 * plays. All or nothing still holds for everything known before the first clip sounds; a clip
 * that fails after that ends the line where it stands rather than repeating it in the device
 * voice. The URL is the hash and is served immutable for a year, so the browser's HTTP cache
 * keeps a clip too (the service worker passes `/voice/*` through to it untouched).
 *
 * **Prefetch** (`speaker.prefetch`): over a slow connection, a television might not have a
 * line's clips within RESOLVE_MS, and the line would be read by the device voice instead. So the
 * client asks for the scene the party is in and the scenes ahead (and, on the television, the
 * rest of the chapter) as soon as the scene is known. Their bytes are kept in memory, least
 * recently used dropped first past KEPT_CLIPS or KEPT_BYTES, and spoken lines use them; decoded
 * audio is held only by the line playing it, so a scene left behind costs nothing once it ends.
 * Clips are fetched PREFETCH_CONCURRENCY at a time and low priority, nearest scene first, none
 * while a line the table is waiting on has no first clip yet and one at a time while a playing
 * line still fetches its own, so a prefetch can only make the line being spoken faster, never
 * slower. Data Saver turns it off; the lines themselves still play.
 */

import { clipPath, manifestOfAddress, manifestPath, playlistFor, type NarrationPart, type PrefetchOptions, type SpeakOptions, type Speaker, type VoiceManifest } from "@kad/shared";
import { getAudioSink, VOICE_GAP_MS, type VoiceBuffer, type VoiceChannel } from "../audio/cue";
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
  fetch: (url: string, init?: { priority?: "low" }) => Promise<FetchedLike>;
  /** True when this device has asked to save data: no guessing ahead (prefetch) then. */
  saveData?: () => boolean;
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

/** How long a line may wait for its manifest and first clip: long enough over house wifi, short enough that a dead line is not a pause. */
export const RESOLVE_MS = 2500;
/**
 * The longest a device line may hold up a recorded one behind it, when the browser never says the
 * line ended: generous (nine characters a second) because ending it early talks over the device.
 */
const DEVICE_MS_PER_CHAR = 110;
const GRACE_MS = 2000;
/** The most clips whose encoded bytes are kept in memory, least recently used dropped first. */
const KEPT_CLIPS = 600;
/** And the most bytes: a chapter is about 7 MB, so this holds the one being played and the next. */
const KEPT_BYTES = 16 * 1024 * 1024;
/** How many clips the guessing ahead fetches at once, when nothing the table is waiting on needs the line. */
export const PREFETCH_CONCURRENCY = 4;
/**
 * How many clips of the line being spoken are fetched and decoded ahead of the one playing: the
 * first clip is not starved by the rest of the line, and a long line does not decode all at once.
 */
export const LINE_WINDOW = 3;

/**
 * The lines worth fetching ahead: a scene's narration (and its variants and branches), the goal
 * and plate of a chapter, and a campaign's plates. Not choice labels, hints or cues, which no
 * recording plays.
 */
export function isNarratedAddress(address: string): boolean {
  return (
    /(^|\/)(narration|@goal|@plate)$/.test(address) ||
    /\/variants\/\d+$/.test(address) ||
    /\/@(prologue|epilogue)\//.test(address)
  );
}

/** Which manifest an address is filed in: its chapter's, its campaign's or the help sheet's (voice-clips.ts). */
export function manifestOf(address: string | undefined): string | null {
  return manifestOfAddress(address);
}

/** A recorded line ready to start: its first clip is decoded, the rest are on their way, in order. */
interface Line {
  clips: Promise<VoiceBuffer>[];
  /** How long the manifest says the line runs, pauses included. */
  ms: number;
  /** True once any clip of the line has failed. */
  failed(): boolean;
}

interface Job {
  text: string;
  opts: SpeakOptions | undefined;
  /** The line to play, or null for the device voice. Absent for a line with no parts. */
  clips?: Promise<Line | null>;
  /** Set once `clips` has settled to null: the line is the device voice's, and need not wait. */
  deviceOnly?: boolean;
}

const ignore = (): void => undefined;

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
  /** The pause after a line, before the next one starts (VOICE_GAP_MS). */
  let resting = false;
  let stopClips: (() => void) | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let speaking = false;
  /** Encoded clips already fetched or on their way, by clip key, least recently used first. */
  const kept = new Map<string, Promise<ArrayBuffer>>();
  /** The size of each kept clip that has arrived, and their total. */
  const sizes = new Map<string, number>();
  let keptBytes = 0;
  /** Lines being resolved right now: the table is waiting on their first clip. */
  let urgent = 0;
  /** Lines playing whose later clips are still being fetched: the guessing ahead makes room for them. */
  const streaming = new Set<Line>();
  const prefetchQueue: { near: string[]; background: string[] } = { near: [], background: [] };
  /** Prefetch fetches under way. */
  let active = 0;
  /** Bumped when the guessing ahead is retired, so work that was already under way drops its result. */
  let prefetchEpoch = 0;

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
    // The pause between two lines is part of saying them; the pause after the last one is not.
    const now = recording || deviceLines > 0 || (resting && queue.length > 0);
    if (now === speaking) return;
    speaking = now;
    env.onSpeaking?.(now);
  }

  /** Holds the next line back for VOICE_GAP_MS, so two lines never run on into each other. */
  function rest(): void {
    resting = true;
    after(VOICE_GAP_MS, () => {
      resting = false;
      // The next line first, so the speaking mark does not blink between the two.
      pump();
      mark();
    });
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

  function forget(key: string): void {
    kept.delete(key);
    const size = sizes.get(key);
    if (size !== undefined) {
      keptBytes -= size;
      sizes.delete(key);
    }
  }

  /** Drops the least recently used clips until the memory bound holds; never `keep`, the one just used. */
  function trim(keep: string): void {
    for (const oldest of kept.keys()) {
      if (kept.size <= KEPT_CLIPS && keptBytes <= KEPT_BYTES) return;
      if (oldest !== keep) forget(oldest);
    }
  }

  /** A clip's encoded bytes, fetched once however often it is wanted; a failure is forgotten so it is asked again. */
  function bytesOf(key: string, low: boolean): Promise<ArrayBuffer> {
    const had = kept.get(key);
    if (had !== undefined) {
      // Used again: the most recently used now, the last to go.
      kept.delete(key);
      kept.set(key, had);
      return had;
    }
    const held: Promise<ArrayBuffer> = env
      .fetch(clipPath(key), low ? { priority: "low" } : undefined)
      .then((response) => {
        if (!response.ok) throw new Error(`clip ${key} is not there`);
        return response.arrayBuffer();
      })
      .then(
        (encoded) => {
          if (kept.get(key) === held && !sizes.has(key)) {
            sizes.set(key, encoded.byteLength);
            keptBytes += encoded.byteLength;
            trim(key);
          }
          return encoded;
        },
        (error: unknown) => {
          if (kept.get(key) === held) forget(key);
          throw error;
        },
      );
    kept.set(key, held);
    trim(key);
    return held;
  }

  /**
   * The line for `parts`: null when it cannot be recorded, else its clips, fetched and decoded in
   * play order with LINE_WINDOW of them ahead at a time. Settles as soon as the manifest has
   * been read, without waiting for any clip.
   */
  async function gather(parts: readonly NarrationPart[]): Promise<Line | null> {
    const at = generation;
    const names = parts.map((part) => manifestOf(part.address));
    if (names.includes(null)) return null;
    const loaded = await Promise.all([...new Set(names as string[])].map(manifest));
    if (loaded.includes(null)) return null;
    const playlist = playlistFor(parts, Object.assign({}, ...loaded) as VoiceManifest);
    const channel = env.channel();
    if (playlist === null || channel === null || !channel.ready()) return null;
    let failed = false;
    // One fetch and one decode per clip, however often the line repeats it.
    const decoded = new Map<string, Promise<VoiceBuffer>>();
    const clips: Promise<VoiceBuffer>[] = [];
    for (const [index, entry] of playlist.entries()) {
      let buffer = decoded.get(entry.clip);
      if (buffer === undefined) {
        const ahead = clips[index - LINE_WINDOW];
        const turn = ahead === undefined ? Promise.resolve() : ahead.then(ignore, ignore);
        buffer = turn
          .then(() => {
            // A line cut off stops fetching what it no longer needs.
            if (at !== generation) throw new Error("line dropped");
            return bytesOf(entry.clip, false);
          })
          // Decoding hands the bytes over, so each decode gets its own copy of what is kept.
          .then((encoded) => channel.decode(encoded.slice(0)));
        buffer.catch(() => {
          failed = true;
        });
        decoded.set(entry.clip, buffer);
      }
      clips.push(buffer);
    }
    const ms = playlist.reduce((total, entry) => total + entry.ms, 0) + VOICE_GAP_MS * (playlist.length - 1);
    return { clips, ms, failed: () => failed };
  }

  /** The line for `parts` once its first clip is ready, or null, never later than `resolveMs` and never rejecting. */
  function resolve(parts: readonly NarrationPart[]): Promise<Line | null> {
    urgent += 1;
    return new Promise<Line | null>((settle) => {
      const cancelTimer = after(resolveMs, () => settle(null));
      gather(parts)
        .then((line) => (line === null ? null : line.clips[0]!.then(() => line)))
        .then(
          (line) => {
            cancelTimer();
            settle(line);
          },
          () => {
            cancelTimer();
            settle(null);
          },
        );
    }).finally(() => {
      urgent -= 1;
      drain();
    });
  }

  /**
   * Fetches the clips for the lines under `prefixes` into memory, nearest first, a few at a time
   * (PREFETCH_CONCURRENCY), never while a line is waiting on its first clip and one at a time
   * while a playing line still fetches its own. A near request goes ahead of the near guesses
   * before it (the party has moved on from where they were made); a background one queues
   * behind its own.
   * Never throws and never plays anything.
   */
  function prefetch(prefixes: readonly string[], opts?: PrefetchOptions): void {
    if (env.saveData?.() === true) return;
    const epoch = prefetchEpoch;
    void (async () => {
      const names = [...new Set(prefixes.map(manifestOf).filter((name): name is string => name !== null))];
      const loaded = (await Promise.all(names.map(manifest))).filter((m): m is VoiceManifest => m !== null);
      // Retired while the manifest was on its way: the request is over, whatever it would have asked for.
      if (epoch !== prefetchEpoch) return;
      const wanted = new Set<string>();
      // In the order asked: the scene the party is in, then the nearest scenes, then the rest.
      for (const prefix of prefixes) {
        for (const each of loaded) {
          for (const [address, variants] of Object.entries(each)) {
            if (!address.startsWith(prefix) || !isNarratedAddress(address)) continue;
            for (const clips of Object.values(variants)) {
              for (const clip of clips) if (!kept.has(clip.clip)) wanted.add(clip.clip);
            }
          }
        }
      }
      if (opts?.background) {
        for (const key of wanted) if (!prefetchQueue.background.includes(key)) prefetchQueue.background.push(key);
      } else {
        // The newest request goes first: it is where the party is now. What was asked before
        // follows it rather than being dropped, since another screen (the story plates) may
        // have asked for it.
        prefetchQueue.near = [...wanted, ...prefetchQueue.near.filter((key) => !wanted.has(key))];
      }
      drain();
    })().catch(ignore);
  }

  /** Retires every prefetch not yet started. A clip already on its way finishes; a spoken line is untouched. */
  function stopPrefetch(): void {
    prefetchEpoch += 1;
    prefetchQueue.near = [];
    prefetchQueue.background = [];
  }

  /** How many prefetches may be under way: the table's own line always goes first. */
  function prefetchSlots(): number {
    if (urgent > 0) return 0;
    if (streaming.size > 0) return 1;
    return PREFETCH_CONCURRENCY;
  }

  /** Starts queued prefetches up to the slots free. Called whenever a slot may have opened. */
  function drain(): void {
    while (active < prefetchSlots()) {
      const key = prefetchQueue.near.shift() ?? prefetchQueue.background.shift();
      if (key === undefined) return;
      if (kept.has(key)) continue;
      active += 1;
      void bytesOf(key, true)
        .catch(ignore)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
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
      // A recorded line waiting behind it gets the same pause as between two recorded lines.
      if (deviceLines === 0 && queue.length > 0) rest();
      mark();
      pump();
    };
    cancelWatch = after((job.text.length * DEVICE_MS_PER_CHAR) / (job.opts?.rate ?? 1) + GRACE_MS, done);
    env.device.sayThen(job.text, job.opts, done);
  }

  function playRecorded(job: Job, clips: Promise<Line | null>): void {
    const at = generation;
    recording = true;
    mark();
    void clips.then((line) => {
      if (at !== generation) return;
      const channel = env.channel();
      // All or nothing, as far as can be known before the first clip sounds: a clip already
      // missing sends the whole line to the device voice, now.
      if (line === null || line.failed() || channel === null || !channel.ready()) {
        recording = false;
        deviceSay(job);
        pump();
        return;
      }
      let over = false;
      let cancelWatch = (): void => undefined;
      // While its later clips are still coming, the guessing ahead keeps out of their way.
      streaming.add(line);
      const fetched = (): void => {
        if (streaming.delete(line)) drain();
      };
      void Promise.allSettled(line.clips).then(fetched);
      const done = (): void => {
        if (over || at !== generation) return;
        over = true;
        cancelWatch();
        fetched();
        stopClips = null;
        recording = false;
        rest();
        mark();
        pump();
      };
      // A context the browser suspends mid-line never says the clips ended, and a clip that hangs
      // mid-line never arrives; the scene goes on anyway.
      cancelWatch = after(line.ms + GRACE_MS + resolveMs, () => {
        stopClips?.();
        done();
      });
      const stop = channel.play(line.clips, done);
      if (!over) stopClips = stop;
    });
  }

  function pump(): void {
    while (queue.length > 0 && !recording && !resting) {
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
    resting = false;
    deviceLines = 0;
    // The lines that were playing are gone, and so is their claim on the connection.
    streaming.clear();
    try {
      stop?.();
    } finally {
      env.device.cancel?.();
      mark();
      drain();
    }
  }

  const speaker: Speaker = (text, opts) => {
    if (opts?.interrupt) cancel();
    const { interrupt: _interrupt, parts, ...others } = opts ?? {};
    const job: Job = { text, opts: Object.keys(others).length > 0 ? others : undefined };
    if (parts !== undefined && parts.length > 0) {
      const clips = resolve(parts);
      job.clips = clips;
      const at = generation;
      // Nothing to play: hand it to the browser behind what it already has, now.
      void clips.then((line) => {
        if (line !== null || at !== generation) return;
        job.deviceOnly = true;
        pump();
      });
    }
    queue.push(job);
    pump();
    mark();
  };
  speaker.cancel = cancel;
  speaker.prefetch = prefetch;
  speaker.stopPrefetch = stopPrefetch;
  return speaker;
}

/** The table's speaker, on this browser: the recorded voice over `SpeechSynthesis`. */
export function createTableSpeaker(onSpeaking: (speaking: boolean) => void): Speaker {
  return whileSeen(createClipSpeaker({
    device: createSynthSpeaker({
      synth: window.speechSynthesis,
      createUtterance: (text) => new SpeechSynthesisUtterance(text),
      gestureTarget: window,
    }),
    channel: () => getAudioSink()?.voice ?? null,
    fetch: (url, init) => fetch(url, init as RequestInit | undefined),
    saveData: () => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true,
    onSpeaking,
  }));
}

/**
 * Narration is for whoever is looking. Hidden (`visibilitychange`) or left
 * (`pagehide`, which can come while visibility still says visible) silences
 * what is said or queued, and refuses what is asked for after: a new scene's
 * line that lands while the app is in the background is dropped, not read on
 * into the room. `pageshow` lets it speak again.
 */
export function whileSeen(speaker: Speaker, doc: Document = document, win: Window = window): Speaker {
  let gone = false;
  const away = (): boolean => gone || doc.visibilityState === "hidden";
  // Hidden or left: nothing is said, and nothing more is fetched for a page nobody is looking at.
  // The world asks again when it is seen (speech/voice-prefetch.ts).
  doc.addEventListener("visibilitychange", () => {
    if (away()) {
      speaker.cancel?.();
      speaker.stopPrefetch?.();
    }
  });
  win.addEventListener("pagehide", () => {
    gone = true;
    speaker.cancel?.();
    speaker.stopPrefetch?.();
  });
  win.addEventListener("pageshow", () => {
    gone = false;
  });
  const seen: Speaker = (text, opts) => {
    if (!away()) speaker(text, opts);
  };
  seen.cancel = () => speaker.cancel?.();
  seen.stopPrefetch = () => speaker.stopPrefetch?.();
  // Nothing is fetched for a page nobody is looking at.
  seen.prefetch = (prefixes, opts) => {
    if (!away()) speaker.prefetch?.(prefixes, opts);
  };
  return seen;
}
