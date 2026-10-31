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
import { cleanPcm16, endsOnSound } from "./clean.ts";
import { BEAT, withoutBeats, type Sample, type ScriptLine } from "./samples.ts";

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
  /** Gemini 3.1 and older: takes delivery as director's notes in a prompt. */
  instruction?: boolean;
}

/**
 * How a model wants expression written, from the providers' docs:
 *  - `eleven`: ElevenLabs v3 and later. Free-form bracketed audio tags in the
 *    words ([whispers], [sighs], [long pause]); no SSML.
 *  - `elevenClassic`: ElevenLabs v2 and Flash. No tags; a pause is an SSML break.
 *  - `gemini`: Gemini 3.8 and later. Everything in the text is spoken except
 *    angle-bracket vocal tags (<sigh>, <short pause>), so the character and the
 *    delivery go in each turn's speechMetadata.style, never in the text.
 *  - `geminiPrompt`: Gemini 3.1 and older. Bracketed tags in the transcript,
 *    under an audio profile and director's notes.
 */
export type Family = "eleven" | "elevenClassic" | "gemini" | "geminiPrompt" | "fake";

export interface CastFile {
  /** Everyone's accent, unless a speaker sets their own: written into Gemini's style and audio profile. */
  accent?: string;
  speakers: Record<string, { describe: string; accent?: string; direction?: string; elevenlabs?: { voiceId: string; name?: string }; gemini?: { voice: string } }>;
  delivery: Record<string, { tag?: string; style?: string }>;
  beats: Record<string, Partial<Record<Exclude<Family, "fake">, string | null>>>;
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
/** Where every line is heard, for the models that take a scene (Gemini's audio profile). */
const SCENE = "A storyteller and friends reading a picture book aloud to eight-year-olds in a cozy living room. Warm, a little spooky on the quiet bits, never scary.";
const PROVIDER_NAMES: Record<Provider, string> = { elevenlabs: "ElevenLabs", gemini: "Gemini", fake: "Fake" };

import { GEMINI_VOICES } from "../gemini-voices.ts";
export { GEMINI_VOICES };

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

/** Gemini 3.8 and later take style in speechMetadata; earlier ones take a prompt. */
function geminiTakesStyle(model: string): boolean {
  const version = /gemini-(\d+)(?:\.(\d+))?/.exec(model);
  if (version === null) return true;
  const major = Number(version[1]);
  const minor = Number(version[2] ?? 0);
  return major > 3 || (major === 3 && minor >= 8);
}

export function familyOf(engine: Pick<EngineConfig, "provider" | "model">): Family {
  switch (engine.provider) {
    case "elevenlabs":
      return EXPRESSIVE.test(engine.model) ? "eleven" : "elevenClassic";
    case "gemini":
      return geminiTakesStyle(engine.model) ? "gemini" : "geminiPrompt";
    case "fake":
      return "fake";
  }
}

/** Fills in a column's id, label and per-model defaults. The id is what ratings are kept under. */
export function engineOf(config: EngineConfig, catalog: readonly ModelInfo[] = []): Engine {
  const info = catalog.find((m) => m.provider === config.provider && m.model === config.model);
  const context = config.provider === "elevenlabs" && config.mode === "lines" && config.context === true;
  const id = [config.provider, config.model, config.mode, config.delivery, ...(context ? ["context"] : [])].join(":");
  const how = { tag: "expressive", instruction: "director's notes", none: "plain" }[config.delivery];
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

/**
 * The words as sent. An expressive column writes the line's beats the way its
 * model family takes them (dropping any it has no way to say) and, where the
 * family reads tags in the text, the line's delivery as a tag in front. Plain
 * and director's-notes columns send the words alone.
 */
export function spoken(engine: Engine, cast: CastFile, line: ScriptLine): string {
  const family = familyOf(engine);
  if (engine.delivery !== "tag" || family === "fake") return withoutBeats(line.text);
  let text = line.text.replace(BEAT, (_, name: string) => ` ${cast.beats[name]?.[family] ?? ""} `).replace(/\s+/g, " ").trim();
  const tag = line.delivery && (family === "eleven" || family === "geminiPrompt") ? cast.delivery[line.delivery]?.tag : undefined;
  if (tag) text = `${tag} ${text}`;
  // Gemini 3.1's guide: never two tags side by side. Merge them into one direction instead.
  if (family === "geminiPrompt") {
    let merged = text;
    do {
      text = merged;
      merged = text.replace(/\[([^\]]+)\]\s*\[([^\]]+)\]/, "[$1, then $2]");
    } while (merged !== text);
  }
  return text;
}

/** A speaker's accent as Gemini is told it, or nothing when the cast names none. */
function accentOf(cast: CastFile, id: string): string {
  const accent = speaker(cast, id).accent ?? cast.accent;
  return accent ? ` Accent: ${accent}.` : "";
}

/**
 * What ElevenLabs can be told about a character beyond the voice itself. Its text to speech has no style prompt, so
 * v3 and later (which read audio tags) get the character's own accent and a short direction as tags in front of each
 * line; older models get nothing, because there is nowhere to put it and the voice carries it. The sheet's default
 * accent is not a tag: it is the voice's own. A direction too long to be a tag is left out rather than risk it being read aloud.
 */
export function elevenTags(engine: Pick<EngineConfig, "provider" | "model">, cast: CastFile, id: string): string {
  if (familyOf(engine) !== "eleven") return "";
  const who = speaker(cast, id);
  const tags: string[] = [];
  const accent = who.accent?.replace(/[()[\]]/g, " ").replace(/\s+/g, " ").trim();
  if (accent && accent !== cast.accent) tags.push(/accent$/i.test(accent) ? accent : `${accent} accent`);
  const direction = who.direction?.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  if (direction && direction.length <= 80 && !/[[\]]/.test(direction)) tags.push(direction);
  return tags.map((tag) => `[${tag}]`).join(" ");
}

const tagged = (tags: string, text: string): string => (tags ? `${tags} ${text}` : text);

/** How a line should sound, in words: the character, their accent, and the delivery when the column asks for it. */
function styleOf(engine: Engine, cast: CastFile, line: ScriptLine): string {
  const delivery = line.delivery ? cast.delivery[line.delivery]?.style : undefined;
  const who = `${speaker(cast, line.by).describe}${accentOf(cast, line.by)}`;
  return delivery ? `${who} Right now: ${delivery}.` : who;
}

/**
 * Gemini 3.1's documented prompt: an audio profile, the scene, director's notes,
 * then a labeled transcript. The preamble and the transcript header keep the
 * model from reading the directions aloud.
 */
function geminiPrompt(engine: Engine, cast: CastFile, lines: readonly ScriptLine[], speakers: readonly string[]): string {
  const profiles = speakers.map((id) => `# AUDIO PROFILE: ${speakerName(id)}\n${speaker(cast, id).describe}${accentOf(cast, id)}`).join("\n\n");
  const notes = engine.delivery === "instruction"
    ? lines.map((line, i) => (line.delivery ? `- ${speakerName(line.by)}, line ${String(i + 1)}: ${cast.delivery[line.delivery]?.style ?? line.delivery}` : null)).filter(Boolean)
    : [];
  const transcript = lines.map((line) => (speakers.length > 1 ? `${speakerName(line.by)}: ` : "") + spoken(engine, cast, line)).join("\n");
  return [
    "Synthesize speech for the transcript below. Speak only the transcript, never these directions or the speaker names.",
    profiles,
    `## THE SCENE\n${SCENE}`,
    `## DIRECTOR'S NOTES\nPace: unhurried, with room for each joke to land.${notes.length ? `\n${notes.join("\n")}` : ""}`,
    `## TRANSCRIPT\n${transcript}`,
  ].join("\n\n");
}

/** Gemini's multi-speaker mode names speakers in the transcript: `seal_keeper` → `SealKeeper`. */
export function speakerName(id: string): string {
  return id.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}

function geminiBody(parts: unknown[], speech: unknown): unknown {
  return { contents: [{ parts }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: speech } };
}

function lineRequest(engine: Engine, cast: CastFile, sample: Sample, index: number, take: number): HttpRequest {
  const line = sample.lines[index]!;
  switch (engine.provider) {
    case "elevenlabs": {
      const body: Record<string, unknown> = {
        text: tagged(elevenTags(engine, cast, line.by), spoken(engine, cast, line)),
        model_id: engine.model,
        ...(engine.settings ? { voice_settings: engine.settings } : {}),
        // A take is a fresh roll: same voice and settings, a different seed.
        ...(engine.seed !== undefined ? { seed: engine.seed + take - 1 } : {}),
      };
      if (engine.context) {
        const before = sample.lines.slice(0, index).map((part) => withoutBeats(part.text)).join(" ");
        const after = sample.lines.slice(index + 1).map((part) => withoutBeats(part.text)).join(" ");
        if (before) body.previous_text = before;
        if (after) body.next_text = after;
      }
      return { url: `${ELEVENLABS}/text-to-speech/${elevenVoice(cast, line.by)}?output_format=${OUTPUT}`, headers: { "content-type": "application/json" }, body };
    }
    case "gemini": {
      const voice = { voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice(cast, line.by) } } };
      // Gemini 3.8 speaks every word of the text, so the direction rides in speechMetadata.
      const part = familyOf(engine) === "gemini"
        ? { text: spoken(engine, cast, line), ...(engine.delivery === "none" ? {} : { speechMetadata: { style: styleOf(engine, cast, line) } }) }
        : { text: engine.delivery === "none" ? spoken(engine, cast, line) : geminiPrompt(engine, cast, [line], [line.by]) };
      // Gemini has no seed; the take is in the cache key only, so each take is a separate call.
      return { url: `${GEMINI}/models/${engine.model}:generateContent`, headers: { "content-type": "application/json" }, body: geminiBody([part], voice) };
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
          inputs: sample.lines.map((line) => ({ text: tagged(elevenTags(engine, cast, line.by), spoken(engine, cast, line)), voice_id: elevenVoice(cast, line.by) })),
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
      const voices = {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: sample.speakers.map((id) => ({ speaker: speakerName(id), voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice(cast, id) } } })),
        },
      };
      // Gemini 3.8: one part per turn, each naming its speaker and carrying its own style.
      const parts = familyOf(engine) === "gemini"
        ? sample.lines.map((line) => ({
            text: spoken(engine, cast, line),
            speechMetadata: { speaker: speakerName(line.by), ...(engine.delivery === "none" ? {} : { style: styleOf(engine, cast, line) }) },
          }))
        : [{ text: geminiPrompt(engine, cast, sample.lines, sample.speakers) }];
      return { url: `${GEMINI}/models/${engine.model}:generateContent`, headers: { "content-type": "application/json" }, body: geminiBody(parts, voices) };
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
  return lines.reduce((sum, line) => sum + withoutBeats(line.text).length, 0);
}

/** Every request this engine makes for this sample and take, or the reason it cannot. */
export function plan(engine: Engine, cast: CastFile, sample: Sample, take: number): Job[] | Unsupported {
  const base = { engine: engine.id, sample: sample.id, take, provider: engine.provider };
  if (engine.delivery === "instruction" && familyOf(engine) !== "geminiPrompt") {
    return { engine: engine.id, sample: sample.id, reason: "Director's notes are for Gemini 3.1 and older: this model would read them aloud. Use expressive delivery instead." };
  }
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
  /** Gemini: the audio exactly as the API sent it, before cleaning (clean.ts). */
  raw?: Buffer;
  /** Gemini: how much end-of-turn noise the cleaning silenced. */
  removedMs?: number;
  /** Gemini: the audio tokens the response says it billed (usageMetadata), when it says. */
  audioTokens?: number;
}

/** The audio tokens a Gemini response reports: its AUDIO output tokens, else all its output tokens. */
export function audioTokensOf(usage: unknown): number | undefined {
  const u = usage as { candidatesTokenCount?: number; candidatesTokensDetails?: { modality?: string; tokenCount?: number }[] } | undefined;
  const audio = u?.candidatesTokensDetails?.find((d) => d.modality === "AUDIO")?.tokenCount;
  const count = audio ?? u?.candidatesTokenCount;
  return typeof count === "number" && Number.isFinite(count) ? count : undefined;
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

/** Whether the last thing a Gemini job says is a sound (a laugh, a sigh), which the cleaner must keep. */
export function jobEndsOnSound(job: Job): boolean {
  const body = job.request.body as { contents?: { parts?: { text?: string }[] }[] } | undefined;
  const parts = body?.contents?.[0]?.parts ?? [];
  return endsOnSound(parts[parts.length - 1]?.text ?? "");
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
    usageMetadata?: unknown;
  };
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const audio = parts.map((part) => part.inlineData).filter((data) => data?.data);
  if (audio.length === 0) throw new Error(`No audio in the response: ${JSON.stringify(json).slice(0, 300)}`);
  const rate = Number(/rate=(\d+)/.exec(audio[0]?.mimeType ?? "")?.[1] ?? 24000);
  const pcm = Buffer.concat(audio.map((data) => Buffer.from(data!.data!, "base64")));
  // Raw Gemini audio carries a burst of noise where a turn ends; AI Studio's player gates it, so do we.
  const cleaned = cleanPcm16(pcm, rate, { endsOnSound: jobEndsOnSound(job) });
  return {
    bytes: pcmToWav(cleaned.pcm, rate),
    raw: pcmToWav(pcm, rate),
    removedMs: cleaned.removed.reduce((sum, r) => sum + r.endMs - r.startMs, 0),
    ext: "wav",
    ...(audioTokensOf(json.usageMetadata) === undefined ? {} : { audioTokens: audioTokensOf(json.usageMetadata) }),
  };
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
      if (/tts/i.test(model)) found.push({ provider, model, label: m.displayName ?? model, about: m.description, tags: true, dialogue: true, instruction: !geminiTakesStyle(model) });
    }
    page = json.nextPageToken ?? "";
  } while (page);
  return found;
}

export interface VoiceInfo {
  id: string;
  name: string;
  about?: string;
  /** "f" or "m" when the provider says; the picker filters on it. */
  gender?: "f" | "m" | "other";
  /** A short sample of the voice the provider hosts, free to play (ElevenLabs gives one for most voices). */
  preview?: string;
}

const genderOf = (word: unknown): VoiceInfo["gender"] | undefined => {
  const gender = String(word ?? "").toLowerCase();
  return gender === "female" ? "f" : gender === "male" ? "m" : gender ? "other" : undefined;
};

/** The voices this key can use: an ElevenLabs account's voices, or Gemini's prebuilt set. */
export async function listVoices(provider: Provider, keys: Keys, fetch: Fetch): Promise<VoiceInfo[]> {
  if (provider === "gemini") return GEMINI_VOICES.map((v) => ({ id: v.id, name: v.id, about: v.about }));
  if (provider === "fake") return [];
  const json = (await getJson(`${ELEVENLABS}/voices`, authFor(provider, keys), fetch)) as {
    voices?: { voice_id: string; name: string; category?: string; labels?: Record<string, string>; preview_url?: string | null }[];
  };
  return (json.voices ?? []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    about: [v.category, ...Object.values(v.labels ?? {})].filter(Boolean).join(", "),
    ...(genderOf(v.labels?.gender) ? { gender: genderOf(v.labels?.gender) } : {}),
    ...(v.preview_url ? { preview: v.preview_url } : {}),
  }));
}

/** A voice in ElevenLabs' public Voice Library: not on the account until someone adds it. */
export interface LibraryVoice extends VoiceInfo {
  ownerId: string;
}

export interface LibraryPage {
  voices: LibraryVoice[];
  hasMore: boolean;
  total?: number;
}

/** Searches the public Voice Library (read only: nothing on the account changes). */
export async function searchLibrary(keys: Keys, query: { search?: string; gender?: string; page?: number }, fetch: Fetch): Promise<LibraryPage> {
  const params = new URLSearchParams({ page_size: "30", page: String(query.page ?? 0) });
  if (query.search?.trim()) params.set("search", query.search.trim());
  if (query.gender === "female" || query.gender === "male") params.set("gender", query.gender);
  const json = (await getJson(`${ELEVENLABS}/shared-voices?${params}`, authFor("elevenlabs", keys), fetch)) as {
    voices?: { public_owner_id: string; voice_id: string; name: string; category?: string; gender?: string; age?: string; accent?: string; descriptive?: string; use_case?: string; preview_url?: string | null }[];
    has_more?: boolean;
    total_count?: number;
  };
  return {
    voices: (json.voices ?? []).map((v) => ({
      id: v.voice_id,
      ownerId: v.public_owner_id,
      name: v.name,
      about: [v.category, v.gender, v.age, v.accent, v.descriptive, v.use_case].filter(Boolean).join(", "),
      ...(genderOf(v.gender) ? { gender: genderOf(v.gender) } : {}),
      ...(v.preview_url ? { preview: v.preview_url } : {}),
    })),
    hasMore: json.has_more === true,
    ...(typeof json.total_count === "number" ? { total: json.total_count } : {}),
  };
}

/** Adds a library voice to the account, which is what lets it be used (and may count against the plan's voice slots). */
export async function addLibraryVoice(keys: Keys, voice: { ownerId: string; voiceId: string; name: string }, fetch: Fetch): Promise<string> {
  const url = `${ELEVENLABS}/voices/add/${encodeURIComponent(voice.ownerId)}/${encodeURIComponent(voice.voiceId)}`;
  const response = await fetch(url, { method: "POST", headers: { ...authFor("elevenlabs", keys), "content-type": "application/json" }, body: JSON.stringify({ new_name: voice.name }) });
  if (!response.ok) throw await failure(response);
  const json = JSON.parse(await response.text()) as { voice_id?: string };
  return json.voice_id ?? voice.voiceId;
}
