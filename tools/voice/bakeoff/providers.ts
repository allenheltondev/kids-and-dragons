/**
 * How each engine turns a sample into requests, and requests into audio
 * (docs/voice-bakeoff.md).
 *
 * Split in two on purpose. `plan()` is pure: sample + engine + cast in, a list
 * of jobs out, each with the exact request it will send and a cache key that
 * is a hash of that request. `send()` is the only part that touches the
 * network, and takes `fetch` as an argument so tests never do. A request that
 * has been sent before is never sent again: the key is the cache.
 *
 * The request shapes follow the providers' public REST APIs as documented when
 * this was written. If a provider has moved a field, the cell fails with the
 * provider's own error message, and the fix is here.
 */

import { createHash } from "node:crypto";
import type { Sample, ScriptLine } from "./samples.ts";

export type Provider = "elevenlabs" | "gemini" | "fake";

export interface Engine {
  id: string;
  label: string;
  provider: Provider;
  model: string;
  mode: "lines" | "dialogue";
  /** A model id in ../pricing.json, for the estimate. */
  pricing?: string;
  /** ElevenLabs: prefix lines with the delivery's audio tag (v3). */
  tags?: boolean;
  /** ElevenLabs: send the neighboring lines as previous_text/next_text. */
  context?: boolean;
  settings?: Record<string, number | boolean>;
  seed?: number;
  /** Gemini: the style prompt around each line. `{describe}`, `{delivery}`, `{text}`. */
  prompt?: string;
  /** False keeps an engine out of the default selection (it runs when named). */
  default?: boolean;
}

export interface CastFile {
  speakers: Record<string, { describe: string; elevenlabs?: { voiceId: string; name?: string }; gemini?: { voice: string } }>;
  delivery: Record<string, { elevenlabsTag?: string; gemini?: string }>;
}

export interface HttpRequest {
  url: string;
  /** Without the API key, which `send()` adds, so a key never lands in a cache file. */
  headers: Record<string, string>;
  body: unknown;
}

export interface Job {
  key: string;
  engine: string;
  sample: string;
  take: number;
  /** Which script lines this job speaks: one in `lines` mode, all of them in `dialogue`. */
  lines: number[];
  provider: Provider;
  request: HttpRequest;
  /** What the provider bills on: characters sent. */
  chars: number;
}

/** A sample an engine cannot render, and why: shown in its cell. */
export interface Unsupported {
  engine: string;
  sample: string;
  reason: string;
}

const ELEVENLABS = "https://api.elevenlabs.io/v1";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";
const OUTPUT = "mp3_44100_128";
const DEFAULT_PROMPT = "Read the words below aloud, and say only those words. Voice: {describe} {delivery}\n\n{text}";

function keyOf(provider: Provider, request: HttpRequest, take: number): string {
  return createHash("sha256").update(JSON.stringify({ provider, url: request.url, body: request.body, take })).digest("hex").slice(0, 24);
}

function speaker(cast: CastFile, id: string): CastFile["speakers"][string] {
  const found = cast.speakers[id];
  if (found === undefined) throw new Error(`"${id}" is not in cast.json`);
  return found;
}

function elevenVoice(cast: CastFile, id: string): string {
  const voice = speaker(cast, id).elevenlabs?.voiceId;
  if (voice === undefined) throw new Error(`"${id}" has no ElevenLabs voice in cast.json`);
  return voice;
}

function geminiVoice(cast: CastFile, id: string): string {
  const voice = speaker(cast, id).gemini?.voice;
  if (voice === undefined) throw new Error(`"${id}" has no Gemini voice in cast.json`);
  return voice;
}

function tagged(engine: Engine, cast: CastFile, line: ScriptLine): string {
  const tag = engine.tags && line.delivery ? cast.delivery[line.delivery]?.elevenlabsTag : undefined;
  return tag ? `${tag} ${line.text}` : line.text;
}

function geminiDelivery(cast: CastFile, line: ScriptLine): string {
  const words = line.delivery ? cast.delivery[line.delivery]?.gemini : undefined;
  return words ? `${words}.` : "";
}

/** Gemini's multi-speaker mode names speakers in the transcript: `seal_keeper` → `SealKeeper`. */
export function speakerName(id: string): string {
  return id.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}

function geminiBody(prompt: string, speech: unknown): unknown {
  return { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: speech } };
}

function lineRequest(engine: Engine, cast: CastFile, sample: Sample, index: number, take: number): HttpRequest {
  const line = sample.lines[index]!;
  switch (engine.provider) {
    case "elevenlabs": {
      const body: Record<string, unknown> = {
        text: tagged(engine, cast, line),
        model_id: engine.model,
        ...(engine.settings ? { voice_settings: engine.settings } : {}),
        // A take is a fresh roll: same voice and settings, a different seed.
        ...(engine.seed !== undefined ? { seed: engine.seed + take - 1 } : {}),
      };
      if (engine.context) {
        const before = sample.lines.slice(0, index).map((part) => part.text).join(" ");
        const after = sample.lines.slice(index + 1).map((part) => part.text).join(" ");
        if (before) body.previous_text = before;
        if (after) body.next_text = after;
      }
      return { url: `${ELEVENLABS}/text-to-speech/${elevenVoice(cast, line.by)}?output_format=${OUTPUT}`, headers: { "content-type": "application/json" }, body };
    }
    case "gemini": {
      const prompt = (engine.prompt ?? DEFAULT_PROMPT)
        .replace("{describe}", () => speaker(cast, line.by).describe)
        .replace("{delivery}", () => geminiDelivery(cast, line))
        .replace("{text}", () => line.text);
      // Gemini has no seed; the take is in the cache key only, so each take is a separate call.
      return {
        url: `${GEMINI}/${engine.model}:generateContent`,
        headers: { "content-type": "application/json" },
        body: geminiBody(prompt, { voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice(cast, line.by) } } }),
      };
    }
    case "fake":
      return { url: "fake://tone", headers: {}, body: { text: line.text, speaker: line.by, delivery: line.delivery ?? null } };
  }
}

function dialogueRequest(engine: Engine, cast: CastFile, sample: Sample, take: number): HttpRequest | string {
  switch (engine.provider) {
    case "elevenlabs":
      return {
        url: `${ELEVENLABS}/text-to-dialogue?output_format=${OUTPUT}`,
        headers: { "content-type": "application/json" },
        body: {
          inputs: sample.lines.map((line) => ({ text: tagged(engine, cast, line), voice_id: elevenVoice(cast, line.by) })),
          model_id: engine.model,
          ...(engine.settings ? { settings: engine.settings } : {}),
          ...(engine.seed !== undefined ? { seed: engine.seed + take - 1 } : {}),
        },
      };
    case "gemini": {
      if (sample.speakers.length > 2) {
        return `Gemini's multi-speaker mode takes two voices, and this sample has ${String(sample.speakers.length)} (${sample.speakers.join(", ")}).`;
      }
      if (sample.speakers.length < 2) return "Only one voice in this sample: the lines mode covers it.";
      const who = sample.speakers.map((id) => `${speakerName(id)} is ${speaker(cast, id).describe}`).join("\n");
      const transcript = sample.lines
        .map((line) => {
          const how = line.delivery ? `(${line.delivery}) ` : "";
          return `${speakerName(line.by)}: ${how}${line.text}`;
        })
        .join("\n");
      return {
        url: `${GEMINI}/${engine.model}:generateContent`,
        headers: { "content-type": "application/json" },
        body: geminiBody(`Read this scene aloud for children, each speaker in their own voice. Say only the spoken words, never the speaker names.\n${who}\n\n${transcript}`, {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: sample.speakers.map((id) => ({ speaker: speakerName(id), voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice(cast, id) } } })),
          },
        }),
      };
    }
    case "fake":
      return { url: "fake://tone", headers: {}, body: { dialogue: sample.lines.map((line) => ({ text: line.text, speaker: line.by })) } };
  }
}

/** Characters billed: what is sent to be spoken, including any audio tags. */
function billed(request: HttpRequest, lines: readonly ScriptLine[]): number {
  const body = request.body as { text?: string; inputs?: { text: string }[] };
  if (typeof body.text === "string") return body.text.length;
  if (Array.isArray(body.inputs)) return body.inputs.reduce((sum, input) => sum + input.text.length, 0);
  return lines.reduce((sum, line) => sum + line.text.length, 0);
}

/** Every request this engine makes for this sample and take, or the reason it cannot. */
export function plan(engine: Engine, cast: CastFile, sample: Sample, take: number): Job[] | Unsupported {
  const base = { engine: engine.id, sample: sample.id, take, provider: engine.provider };
  try {
    if (engine.mode === "dialogue") {
      const request = dialogueRequest(engine, cast, sample, take);
      if (typeof request === "string") return { engine: engine.id, sample: sample.id, reason: request };
      return [{ ...base, key: keyOf(engine.provider, request, take), lines: sample.lines.map((_, i) => i), request, chars: billed(request, sample.lines) }];
    }
    return sample.lines.map((line, index) => {
      const request = lineRequest(engine, cast, sample, index, take);
      return { ...base, key: keyOf(engine.provider, request, take), lines: [index], request, chars: billed(request, [line]) };
    });
  } catch (error) {
    return { engine: engine.id, sample: sample.id, reason: (error as Error).message };
  }
}

export interface Rendered {
  bytes: Buffer;
  ext: "mp3" | "wav";
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}>;

export interface Keys {
  elevenlabs?: string;
  gemini?: string;
}

export function keysFromEnv(env: NodeJS.ProcessEnv = process.env): Keys {
  return { elevenlabs: env.ELEVENLABS_API_KEY, gemini: env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY };
}

/** Wraps 16-bit little-endian mono PCM (what Gemini returns) in a WAV header. */
export function pcmToWav(pcm: Buffer, rate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * A soft tone as long as the words would take to read (14 characters a
 * second), pitched by speaker, so the page can be tried end to end with no key.
 */
export function fakeTone(parts: readonly { text: string; speaker: string }[]): Buffer {
  const rate = 16000;
  const chunks = parts.map((part) => {
    const seconds = Math.max(0.3, part.text.length / 14);
    const hash = [...part.speaker].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 997, 7);
    const pitch = 180 + (hash % 12) * 30;
    const samples = Math.round(seconds * rate);
    const pcm = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i += 1) {
      const fade = Math.min(1, i / 800, (samples - i) / 800);
      pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * pitch * i) / rate) * 6000 * fade), i * 2);
    }
    return Buffer.concat([pcm, Buffer.alloc(rate / 5)]); // a fifth of a second between speakers
  });
  return pcmToWav(Buffer.concat(chunks), rate);
}

async function failure(response: Awaited<ReturnType<Fetch>>): Promise<Error> {
  const text = (await response.text().catch(() => "")).slice(0, 400);
  return new Error(`HTTP ${String(response.status)}: ${text}`);
}

/** Sends one job and returns its audio. Throws with the provider's own words on failure. */
export async function send(job: Job, keys: Keys, fetch: Fetch): Promise<Rendered> {
  if (job.provider === "fake") {
    const body = job.request.body as { text?: string; speaker?: string; dialogue?: { text: string; speaker: string }[] };
    return { bytes: fakeTone(body.dialogue ?? [{ text: body.text ?? "", speaker: body.speaker ?? "narrator" }]), ext: "wav" };
  }
  const key = job.provider === "elevenlabs" ? keys.elevenlabs : keys.gemini;
  if (!key) throw new Error(`No API key for ${job.provider}`);
  const auth: Record<string, string> = job.provider === "elevenlabs" ? { "xi-api-key": key } : { "x-goog-api-key": key };
  const response = await fetch(job.request.url, { method: "POST", headers: { ...job.request.headers, ...auth }, body: JSON.stringify(job.request.body) });
  if (!response.ok) throw await failure(response);
  if (job.provider === "elevenlabs") return { bytes: Buffer.from(await response.arrayBuffer()), ext: "mp3" };

  const json = JSON.parse(await response.text()) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
  };
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const audio = parts.map((part) => part.inlineData).filter((data) => data?.data);
  if (audio.length === 0) throw new Error(`No audio in the response: ${JSON.stringify(json).slice(0, 300)}`);
  const rate = Number(/rate=(\d+)/.exec(audio[0]?.mimeType ?? "")?.[1] ?? 24000);
  return { bytes: pcmToWav(Buffer.concat(audio.map((data) => Buffer.from(data!.data!, "base64"))), rate), ext: "wav" };
}
