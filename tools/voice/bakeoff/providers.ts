/**
 * How each engine turns a sample into requests, and requests into audio
 * (docs/voice-bakeoff.md).
 *
 * An engine is a column on the page: a provider, a model, a mode (one request
 * per line, or the provider's own multi-speaker request) and how delivery is
 * asked for (a bracketed audio tag, a sentence of instruction, or not at all).
 *
 * Split in two on purpose. `plan()` is pure: sample + engine + cast in, a list
 * of jobs out, each with the exact request it will send and a cache key that
 * is a hash of that request. `send()` and the model and voice lists are the
 * only parts that touch the network, and take `fetch` as an argument so tests
 * never do. A request that has been sent before is never sent again.
 *
 * The request shapes follow the providers' REST references as of 2026-10-27
 * (sources in the doc). If a provider moves a field, the cell fails with the
 * provider's own error message, and the fix is here.
 */

import { createHash } from "node:crypto";
import type { Sample, ScriptLine } from "./samples.ts";

export type Provider = "elevenlabs" | "gemini" | "fake";
export type Delivery = "tag" | "instruction" | "none";

/** A column as the page and engines.json describe it. */
export interface EngineConfig {
  provider: Provider;
  model: string;
  mode: "lines" | "dialogue";
  delivery: Delivery;
  /** ElevenLabs: send the neighboring lines as previous_text/next_text. */
  context?: boolean;
}

export interface Engine extends EngineConfig {
  id: string;
  label: string;
  settings?: Record<string, number | boolean>;
  seed?: number;
  /** Gemini: the style prompt around each line. `{describe}`, `{delivery}`, `{text}`. */
  prompt?: string;
}

/** A model the picker offers, from engines.json or a provider's live list. */
export interface ModelInfo {
  provider: Provider;
  model: string;
  label: string;
  about?: string;
  tags?: boolean;
  context?: boolean;
  dialogue?: boolean;
}

export interface CastFile {
  speakers: Record<string, { describe: string; elevenlabs?: { voiceId: string; name?: string }; gemini?: { voice: string } }>;
  delivery: Record<string, { tag?: string; gemini?: string }>;
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
const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
const OUTPUT = "mp3_44100_128";
const DEFAULT_PROMPT = "Read the words below aloud, and say only those words. Voice: {describe} {delivery}\n\n{text}";
const PROVIDER_NAMES: Record<Provider, string> = { elevenlabs: "ElevenLabs", gemini: "Gemini", fake: "Fake" };

/** Gemini's prebuilt voices and the one word Google uses for each. */
export const GEMINI_VOICES: readonly { id: string; about: string }[] = [
  ["Zephyr", "bright"], ["Puck", "upbeat"], ["Charon", "informative"], ["Kore", "firm"], ["Fenrir", "excitable"],
  ["Leda", "youthful"], ["Orus", "firm"], ["Aoede", "breezy"], ["Callirrhoe", "easy-going"], ["Autonoe", "bright"],
  ["Enceladus", "breathy"], ["Iapetus", "clear"], ["Umbriel", "easy-going"], ["Algieba", "smooth"], ["Despina", "smooth"],
  ["Erinome", "clear"], ["Algenib", "gravelly"], ["Rasalgethi", "informative"], ["Laomedeia", "upbeat"], ["Achernar", "soft"],
  ["Alnilam", "firm"], ["Schedar", "even"], ["Gacrux", "mature"], ["Pulcherrima", "forward"], ["Achird", "friendly"],
  ["Zubenelgenubi", "casual"], ["Vindemiatrix", "gentle"], ["Sadachbia", "lively"], ["Sadaltager", "knowledgeable"], ["Sulafat", "warm"],
].map(([id, about]) => ({ id: id!, about: about! }));

/** ElevenLabs v3 and later: audio tags, no style slider, no previous_text. */
const EXPRESSIVE = /^eleven_v([3-9]|\d{2,})(_|$)/;

/**
 * Voice settings each ElevenLabs family accepts: v3 takes stability only at
 * 0, 0.5 or 1, and v3 and later have no style slider, so they get the short form.
 */
export function elevenSettings(model: string): Record<string, number | boolean> {
  if (EXPRESSIVE.test(model)) return { stability: 0.5, similarity_boost: 0.75 };
  return { stability: 0.55, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true };
}

/** Fills in a column's id, label and per-model defaults. The id is what ratings are kept under. */
export function engineOf(config: EngineConfig, catalog: readonly ModelInfo[] = []): Engine {
  const info = catalog.find((m) => m.provider === config.provider && m.model === config.model);
  const context = config.provider === "elevenlabs" && config.mode === "lines" && config.context === true;
  const id = [config.provider, config.model, config.mode, config.delivery, ...(context ? ["context"] : [])].join(":");
  const how = { tag: "tags", instruction: "instructions", none: "plain" }[config.delivery];
  const label = `${info?.label ?? `${PROVIDER_NAMES[config.provider]} ${config.model}`}${config.mode === "dialogue" ? ", one request" : ""}, ${how}${context ? ", context" : ""}`;
  return {
    ...config,
    context,
    id,
    label,
    ...(config.provider === "elevenlabs" ? { settings: elevenSettings(config.model), seed: 1201 } : {}),
  };
}

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

/** The words as sent: with the delivery's audio tag in front when this column asks with tags. */
function spoken(engine: Engine, cast: CastFile, line: ScriptLine): string {
  const tag = engine.delivery === "tag" && line.delivery ? cast.delivery[line.delivery]?.tag : undefined;
  return tag ? `${tag} ${line.text}` : line.text;
}

function instruction(engine: Engine, cast: CastFile, line: ScriptLine): string {
  const words = engine.delivery === "instruction" && line.delivery ? cast.delivery[line.delivery]?.gemini : undefined;
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
        text: spoken(engine, cast, line),
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
        .replace("{delivery}", () => instruction(engine, cast, line))
        .replace("{text}", () => spoken(engine, cast, line));
      // Gemini has no seed; the take is in the cache key only, so each take is a separate call.
      return {
        url: `${GEMINI}/models/${engine.model}:generateContent`,
        headers: { "content-type": "application/json" },
        body: geminiBody(prompt, { voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice(cast, line.by) } } }),
      };
    }
    case "fake":
      return { url: "fake://tone", headers: {}, body: { text: spoken(engine, cast, line), speaker: line.by, delivery: line.delivery ?? null } };
  }
}

function dialogueRequest(engine: Engine, cast: CastFile, sample: Sample, take: number): HttpRequest | string {
  switch (engine.provider) {
    case "elevenlabs":
      return {
        url: `${ELEVENLABS}/text-to-dialogue?output_format=${OUTPUT}`,
        headers: { "content-type": "application/json" },
        body: {
          inputs: sample.lines.map((line) => ({ text: spoken(engine, cast, line), voice_id: elevenVoice(cast, line.by) })),
          model_id: engine.model,
          ...(engine.settings ? { settings: { stability: engine.settings.stability } } : {}),
          ...(engine.seed !== undefined ? { seed: engine.seed + take - 1 } : {}),
        },
      };
    case "gemini": {
      if (sample.speakers.length > 2) {
        return `Gemini's multi-speaker mode takes two voices, and this sample has ${String(sample.speakers.length)} (${sample.speakers.join(", ")}).`;
      }
      if (sample.speakers.length < 2) return "Only one voice in this sample: the one-request-per-line column covers it.";
      const who = sample.speakers.map((id) => `${speakerName(id)} is ${speaker(cast, id).describe}`).join("\n");
      const transcript = sample.lines
        .map((line) => {
          const how = engine.delivery === "instruction" && line.delivery ? `(${cast.delivery[line.delivery]?.gemini ?? line.delivery}) ` : "";
          return `${speakerName(line.by)}: ${how}${spoken(engine, cast, line)}`;
        })
        .join("\n");
      return {
        url: `${GEMINI}/models/${engine.model}:generateContent`,
        headers: { "content-type": "application/json" },
        body: geminiBody(`Read this scene aloud for children, each speaker in their own voice. Say only the spoken words, never the speaker names.\n${who}\n\n${transcript}`, {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: sample.speakers.map((id) => ({ speaker: speakerName(id), voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice(cast, id) } } })),
          },
        }),
      };
    }
    case "fake":
      return { url: "fake://tone", headers: {}, body: { dialogue: sample.lines.map((line) => ({ text: spoken(engine, cast, line), speaker: line.by })) } };
  }
}

/** Characters billed: what is sent to be spoken, including any audio tags. */
function billed(request: HttpRequest, lines: readonly ScriptLine[]): number {
  const body = request.body as { text?: string; inputs?: { text: string }[]; dialogue?: { text: string }[] };
  if (typeof body.text === "string") return body.text.length;
  if (Array.isArray(body.inputs)) return body.inputs.reduce((sum, input) => sum + input.text.length, 0);
  if (Array.isArray(body.dialogue)) return body.dialogue.reduce((sum, input) => sum + input.text.length, 0);
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

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
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

function authFor(provider: Provider, keys: Keys): Record<string, string> {
  if (provider === "fake") return {};
  const key = provider === "elevenlabs" ? keys.elevenlabs : keys.gemini;
  if (!key) throw new Error(`No API key for ${PROVIDER_NAMES[provider]}`);
  return provider === "elevenlabs" ? { "xi-api-key": key } : { "x-goog-api-key": key };
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
  const auth = authFor(job.provider, keys);
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

async function getJson(url: string, headers: Record<string, string>, fetch: Fetch): Promise<unknown> {
  const response = await fetch(url, { method: "GET", headers });
  if (!response.ok) throw await failure(response);
  return JSON.parse(await response.text()) as unknown;
}

/**
 * The provider's own list of speech models, so the picker offers what this key
 * can use today. ElevenLabs: every model that can do text to speech. Gemini:
 * every model whose name says TTS.
 */
export async function listModels(provider: Provider, keys: Keys, fetch: Fetch): Promise<ModelInfo[]> {
  if (provider === "fake") return [{ provider, model: "tone", label: "Fake tones", dialogue: true }];
  const auth = authFor(provider, keys);
  if (provider === "elevenlabs") {
    const list = (await getJson(`${ELEVENLABS}/models`, auth, fetch)) as { model_id: string; name?: string; description?: string; can_do_text_to_speech?: boolean }[];
    return list
      .filter((m) => m.can_do_text_to_speech !== false)
      .map((m) => {
        const expressive = EXPRESSIVE.test(m.model_id);
        return { provider, model: m.model_id, label: m.name ?? m.model_id, about: m.description, tags: expressive, context: !expressive, dialogue: m.model_id === "eleven_v3" };
      });
  }
  const found: ModelInfo[] = [];
  let page = "";
  do {
    const json = (await getJson(`${GEMINI}/models?pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`, auth, fetch)) as {
      models?: { name: string; displayName?: string; description?: string }[];
      nextPageToken?: string;
    };
    for (const m of json.models ?? []) {
      const model = m.name.replace(/^models\//, "");
      if (/tts/i.test(model)) found.push({ provider, model, label: m.displayName ?? model, about: m.description, tags: true, dialogue: true });
    }
    page = json.nextPageToken ?? "";
  } while (page);
  return found;
}

export interface VoiceInfo {
  id: string;
  name: string;
  about?: string;
}

/** The voices this key can use: an ElevenLabs account's voices, or Gemini's prebuilt set. */
export async function listVoices(provider: Provider, keys: Keys, fetch: Fetch): Promise<VoiceInfo[]> {
  if (provider === "gemini") return GEMINI_VOICES.map((v) => ({ id: v.id, name: v.id, about: v.about }));
  if (provider === "fake") return [];
  const json = (await getJson(`${ELEVENLABS}/voices`, authFor(provider, keys), fetch)) as {
    voices?: { voice_id: string; name: string; category?: string; labels?: Record<string, string> }[];
  };
  return (json.voices ?? []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    about: [v.category, ...Object.values(v.labels ?? {})].filter(Boolean).join(", "),
  }));
}
