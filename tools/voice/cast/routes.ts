/**
 * The cast pages' half of the bake-off server (docs/voice-cast.md): show the
 * whole cast sheet or one character's profile, render auditions and typed
 * lines in each character's voice, save the voices and genders people pick
 * back to content/voice/cast.json, and write their edits to the canon.
 *
 * It reuses the bake-off's machinery whole: an audition line is a one-line
 * sample, rendered by the same planner, cached by the same request hash and
 * charged against the same session cap. Gemini only for now: it is the
 * provider the game is leaning toward, and the sheet's voices are Gemini's.
 *
 * A page can also be in ElevenLabs mode: every route takes a `provider`
 * ("gemini" when absent), and in ElevenLabs mode the voice a character is heard
 * in, picked and approved is their `elevenlabs` voice, from the account's own
 * voices. The Gemini voice stays on the sheet beside it, untouched.
 */

import fs from "node:fs";
import path from "node:path";
import { cellOf, estimate, estimateTake, renderTake, type Workspace } from "../bakeoff/bakeoff.ts";
import type { Cell } from "../bakeoff/page.ts";
import { GEMINI_VOICES, engineOf, familyOf, plan, type CastFile, type Fetch, type Keys, type ModelInfo } from "../bakeoff/providers.ts";
import type { Sample } from "../bakeoff/samples.ts";
import { ACCENTS } from "./accents.ts";
import { CanonEditError, editIndividual, editVoiceNote } from "./canon-edit.ts";
import { loadProfiles } from "./profile.ts";
import { reviewJson, reviewMarkdown } from "./review.ts";
import { GEMINI_VOICE_TRAITS, GENDERS, decide, derivedGender, nextVoice, voiceClashes, voiceGenderOf, voiceOf, type CastEntry, type CastSheet, type Gender, type VoiceProvider } from "./sheet.ts";
import { chapterFiles, rebuildSheet, writeSheet } from "./sources.ts";

export interface Budget {
  spent: number;
  cap: number;
}

export interface CastRouteOptions {
  /** The bake-off workspace: clips, pricing, and the delivery and beat vocabulary in its cast. */
  ws: Workspace;
  sheetPath: string;
  catalog: ModelInfo[];
  fetch: Fetch;
  /** Which campaign each chapter belongs to, for the page's filter. */
  chapterCampaigns: Record<string, string>;
  /** The repository: content, canon and art are read from here, and canon edits written. Defaults to the sheet's. */
  root?: string;
}

const rootOf = (options: CastRouteOptions): string => options.root ?? path.resolve(path.dirname(options.sheetPath), "..", "..");

/** A take number from the page: 1 (the first rendering) to MAX_TAKES. Gemini has no seed, so each take is a fresh call. */
export const MAX_TAKES = 5;
const takeOf = (value: unknown): number => {
  const take = Number(value ?? 1);
  return Number.isInteger(take) && take >= 1 && take <= MAX_TAKES ? take : 1;
};

/** The longest line the page will have someone say. */
const SAY_MAX = 400;

export interface Reply {
  status: number;
  body: unknown;
}

/** Said by someone the game has not given a line yet, so their voice can still be heard. Marked as not from the game. */
export const STAND_IN = "Oh! Hello there. I'm {name}, and you must be the new heroes everybody keeps talking about.";

const MODEL_ID = /^gemini-[A-Za-z0-9._-]{1,70}$/;
const ELEVEN_MODEL_ID = /^eleven_[A-Za-z0-9._-]{1,70}$/;
/** An ElevenLabs voice id: what the API gives each voice (twenty letters and digits today). */
const ELEVEN_VOICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** What a mode starts on when the page does not name a model. */
const DEFAULT_MODEL: Record<VoiceProvider, string> = { gemini: "gemini-3.8-flash-tts", elevenlabs: "eleven_v4" };

/** Which provider's voices a request is about: Gemini's unless it says ElevenLabs. */
export const providerOf = (value: unknown): VoiceProvider => (value === "elevenlabs" ? "elevenlabs" : "gemini");

/** A model id the page sent, if it is one of this provider's. */
const modelIdOf = (model: unknown, provider: VoiceProvider): string => {
  const ok = provider === "elevenlabs" ? ELEVEN_MODEL_ID : MODEL_ID;
  return typeof model === "string" && ok.test(model) ? model : DEFAULT_MODEL[provider];
};

export function readSheet(file: string): CastSheet {
  return JSON.parse(fs.readFileSync(file, "utf8")) as CastSheet;
}

/** The lines a character is auditioned on: their own from the game, or the stand-in when they have none and speak. */
export function auditionLines(id: string, entry: CastEntry): { text: string; address: string; standIn: boolean }[] {
  if (entry.lines.length > 0) return entry.lines.map((line) => ({ ...line, standIn: false }));
  if (!entry.speaks) return [];
  const first = entry.name.replace(/^(the\s+)/i, "").split(/\s+/)[0] ?? entry.name;
  return [{ text: STAND_IN.replace("{name}", first), address: `cast/${id}/stand-in`, standIn: true }];
}

/** One audition line as a one-line bake-off sample, spoken by the character. */
export function auditionSample(id: string, entry: CastEntry, index: number): Sample | null {
  const line = auditionLines(id, entry)[index];
  if (!line) return null;
  return { id: `cast-${id}-${String(index)}`, tier: "cast", title: entry.name, tests: "", address: line.address, source: line.text, lines: [{ by: id, text: line.text }], speakers: [id] };
}

/** How a character is described to the voice model: name and notes, then a person's direction if they gave one. */
export function describe(entry: CastEntry): string {
  const who = `${entry.name}: ${entry.who}`;
  const stop = (text: string): string => (/[.!?]$/.test(text.trim()) ? text : `${text}.`);
  return entry.direction ? `${stop(who)} Direction: ${stop(entry.direction)}` : who;
}

/** The sheet as the planner's cast: each character described by name and notes, with their voice and accent. */
export function sheetCast(sheet: CastSheet, base: CastFile): CastFile {
  return {
    ...base,
    accent: sheet.accent,
    speakers: Object.fromEntries(
      Object.entries(sheet.speakers).map(([id, entry]) => [
        id,
        {
          describe: describe(entry),
          ...(entry.accent ? { accent: entry.accent } : {}),
          gemini: { voice: entry.gemini.voice },
          ...(entry.elevenlabs?.voiceId ? { elevenlabs: { voiceId: entry.elevenlabs.voiceId, ...(entry.elevenlabs.name ? { name: entry.elevenlabs.name } : {}) } } : {}),
        },
      ]),
    ),
  };
}

function engineFor(model: unknown, catalog: readonly ModelInfo[], provider: VoiceProvider = "gemini"): ReturnType<typeof engineOf> {
  const id = modelIdOf(model, provider);
  if (provider === "elevenlabs") {
    // v3 and later read tags in the text; the older models take the words alone.
    const delivery = familyOf({ provider, model: id }) === "eleven" ? "tag" : "none";
    return engineOf({ provider, model: id, mode: "lines", delivery }, catalog);
  }
  return engineOf({ provider: "gemini", model: id, mode: "lines", delivery: "tag" }, catalog);
}

/** Who shares a voice with this character, chapter by chapter. */
function clashesOf(sheet: CastSheet, id: string, provider: VoiceProvider = "gemini"): { chapter: string; with: string[] }[] {
  return voiceClashes(sheet, provider)
    .filter((clash) => clash.speakers.includes(id))
    .map((clash) => ({ chapter: clash.chapter, with: clash.speakers.filter((other) => other !== id) }));
}

/** The order the profile pages walk the cast in: narrator, party, then whoever has the most lines to speak, then the most chapters. */
export function castOrder(sheet: CastSheet): string[] {
  const rank = (e: CastEntry): number => (e.kind === "narrator" ? 0 : e.kind === "party" ? 1 : 2);
  return Object.entries(sheet.speakers)
    .sort(([a, x], [b, y]) => rank(x) - rank(y) || (y.lineCount ?? 0) - (x.lineCount ?? 0) || y.chapters.length - x.chapters.length || x.name.localeCompare(y.name) || a.localeCompare(b))
    .map(([id]) => id);
}

/** A line typed on the profile page, as a one-line sample for the character. */
export function sayingSample(id: string, text: string): Sample {
  return { id: `cast-${id}-say`, tier: "cast", title: id, tests: "", address: `cast/${id}/say`, source: text, lines: [{ by: id, text }], speakers: [id] };
}

/**
 * What a model is told for one line, besides the words. Gemini: the style, or the 3.1 prompt, and the voice.
 * ElevenLabs is told nothing about who they are: the voice and the words (with a tag in front on v3 and later) are all it gets.
 */
export function toldFor(sheet: CastSheet, base: CastFile, id: string, model: unknown, catalog: readonly ModelInfo[], text: string, provider: VoiceProvider = "gemini"): { model: string; voice: string; told: string; text: string } {
  const engine = engineFor(model, catalog, provider);
  const voice = voiceOf(sheet.speakers[id]!, provider);
  if (provider === "elevenlabs") {
    if (voice === "") return { model: engine.model, voice, told: "", text };
    const jobs = plan(engine, sheetCast(sheet, base), sayingSample(id, text), 0);
    const sent = Array.isArray(jobs) ? (jobs[0]?.request.body as { text?: string } | undefined)?.text : undefined;
    return { model: engine.model, voice, told: "", text: sent ?? text };
  }
  const jobs = plan(engine, sheetCast(sheet, base), sayingSample(id, text), 0);
  if (!Array.isArray(jobs) || jobs.length === 0) return { model: engine.model, voice, told: "", text };
  const body = jobs[0]!.request.body as { contents?: { parts?: { text?: string; speechMetadata?: { style?: string } }[] }[] };
  const part = body.contents?.[0]?.parts?.[0];
  const style = part?.speechMetadata?.style;
  return { model: engine.model, voice, told: style ?? part?.text ?? "", text: style ? (part?.text ?? text) : text };
}

export function castPageData(options: CastRouteOptions, include: { profiles?: boolean } = {}) {
  const sheet = readSheet(options.sheetPath);
  return {
    ...(include.profiles ? { profiles: loadProfiles(rootOf(options), sheet), order: castOrder(sheet) } : {}),
    accent: sheet.accent,
    speakers: sheet.speakers,
    voices: GEMINI_VOICES.map((voice) => ({ id: voice.id, about: voice.about, gender: GEMINI_VOICE_TRAITS[voice.id]?.gender ?? null })),
    // Every provider's, each tagged with its own: the page shows the ones for the mode it is in.
    models: options.catalog.filter((model) => model.provider === "gemini" || model.provider === "elevenlabs"),
    defaultModels: DEFAULT_MODEL,
    // Accents to suggest in the accent field, grouped: the sheet's own default is General American, and nobody has to keep it.
    accents: ACCENTS,
    chapterCampaigns: options.chapterCampaigns,
    auditions: Object.fromEntries(Object.entries(sheet.speakers).map(([id, entry]) => [id, auditionLines(id, entry)])),
  };
}

/** Why a sample cannot be heard yet on a provider (someone in it has no voice there), or null. */
function needsVoice(sheet: CastSheet, sample: Sample, provider: VoiceProvider): string | null {
  if (provider === "gemini") return null;
  for (const id of sample.speakers) {
    const entry = sheet.speakers[id];
    if (entry && voiceOf(entry, provider) === "") return `${entry.name} has no ElevenLabs voice yet: pick one for them first.`;
  }
  return null;
}

export function createCastRoutes(options: CastRouteOptions, budget: Budget) {
  /** Renders one sample in the sheet's voices, inside the session's cap. */
  async function render(sheet: CastSheet, sample: Sample, model: unknown, keys: Keys, take = 1, provider: VoiceProvider = "gemini"): Promise<Reply> {
    const nobody = needsVoice(sheet, sample, provider);
    if (nobody) return { status: 400, body: { error: nobody } };
    const ws = { ...options.ws, cast: sheetCast(sheet, options.ws.cast) };
    const engine = engineFor(model, options.catalog, provider);
    const quoted = estimateTake(engine, sample, take, ws);
    if (quoted.dollars === null && quoted.requests > 0) {
      return { status: 409, body: { error: `pricing.json has no price for ${engine.model}, so the cap cannot be kept.`, spent: budget.spent, cap: budget.cap } };
    }
    const price = quoted.dollars ?? 0;
    if (budget.spent + price > budget.cap + 1e-9) {
      return { status: 402, body: { error: `This would take the session past its $${budget.cap.toFixed(2)} cap. Raise the cap on the bake-off page to go on.`, spent: budget.spent, cap: budget.cap } };
    }
    budget.spent += price;
    const cell = await renderTake(engine, sample, take, ws, keys, options.fetch);
    return { status: 200, body: { cell, spent: budget.spent, cap: budget.cap } };
  }

  return async function handle(route: string, body: Record<string, unknown>, keys: Keys): Promise<Reply | null> {
    switch (route) {
      case "/api/cast/state": {
        // Every audition's clip from disk, and what rendering the rest would cost. Sends nothing.
        const sheet = readSheet(options.sheetPath);
        const provider = providerOf(body.provider);
        const ws = { ...options.ws, cast: sheetCast(sheet, options.ws.cast) };
        const engine = engineFor(body.model, options.catalog, provider);
        const cells: Record<string, Cell[]> = {};
        const samples: Sample[] = [];
        // A character on a later take is shown through that take: the cell's last.
        const wanted = typeof body.takes === "object" && body.takes !== null ? (body.takes as Record<string, unknown>) : {};
        for (const [id, entry] of Object.entries(sheet.speakers)) {
          const list: Cell[] = [];
          // Someone with no voice on this provider has nothing to hear, and nothing to price, until one is picked.
          if (voiceOf(entry, provider) !== "") {
            auditionLines(id, entry).forEach((_, i) => {
              const sample = auditionSample(id, entry, i)!;
              samples.push(sample);
              list.push(cellOf(engine, sample, takeOf(wanted[id]), ws));
            });
          }
          cells[id] = list;
        }
        const left = estimate(engine, samples, 1, ws);
        const clashes = Object.fromEntries(Object.keys(sheet.speakers).map((id) => [id, clashesOf(sheet, id, provider)]));
        return { status: 200, body: { cells, clashes, estimate: left, spent: budget.spent, cap: budget.cap } };
      }
      case "/api/cast/render": {
        const sheet = readSheet(options.sheetPath);
        const id = String(body.id);
        const entry = sheet.speakers[id];
        if (!entry) return { status: 400, body: { error: `nobody called ${id} in the sheet` } };
        const sample = auditionSample(id, entry, Number(body.line ?? 0));
        if (!sample) return { status: 400, body: { error: "no such audition line" } };
        return render(sheet, sample, body.model, keys, takeOf(body.take), providerOf(body.provider));
      }
      case "/api/cast/say": {
        // Anything typed on the profile page, said in the character's voice. Rendered once, then cached like any line.
        const sheet = readSheet(options.sheetPath);
        const id = String(body.id);
        if (!sheet.speakers[id]) return { status: 400, body: { error: `nobody called ${id} in the sheet` } };
        const text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
        if (!text) return { status: 400, body: { error: "give them something to say" } };
        if (text.length > SAY_MAX) return { status: 400, body: { error: `keep it under ${String(SAY_MAX)} characters` } };
        const sample = sayingSample(id, text);
        const provider = providerOf(body.provider);
        if (body.render !== true) {
          // Only look: the cell from disk, if this line was said before. Sends nothing. No voice yet on this provider, no cell.
          if (needsVoice(sheet, sample, provider)) return { status: 200, body: { cell: null, spent: budget.spent, cap: budget.cap } };
          const ws = { ...options.ws, cast: sheetCast(sheet, options.ws.cast) };
          return { status: 200, body: { cell: cellOf(engineFor(body.model, options.catalog, provider), sample, 1, ws), spent: budget.spent, cap: budget.cap } };
        }
        return render(sheet, sample, body.model, keys, 1, provider);
      }
      case "/api/cast/told": {
        // What would be sent for a line besides its words, so the page can show the model's whole brief. Sends nothing.
        const sheet = readSheet(options.sheetPath);
        const id = String(body.id);
        if (!sheet.speakers[id]) return { status: 400, body: { error: `nobody called ${id} in the sheet` } };
        const text = typeof body.text === "string" && body.text.trim() ? body.text.trim().slice(0, SAY_MAX) : (auditionLines(id, sheet.speakers[id]!)[0]?.text ?? "Hello.");
        return { status: 200, body: toldFor(sheet, options.ws.cast, id, body.model, options.catalog, text, providerOf(body.provider)) };
      }
      case "/api/cast/canon": {
        // An edit to the canon behind a character: one of their chapters' voice notes, or their canon individual's entry.
        const root = rootOf(options);
        const sheet = readSheet(options.sheetPath);
        const id = String(body.id);
        const entry = sheet.speakers[id];
        if (!entry) return { status: 400, body: { error: `nobody called ${id} in the sheet` } };
        let edit;
        try {
          if (body.kind === "voiceNote") {
            const chapter = String(body.chapter);
            const key = String(body.key);
            // Only a note that is this character's: the page can't reach into anyone else's.
            if (!(entry.voiceNotes ?? []).some((note) => note.chapter === chapter && note.key === key)) return { status: 400, body: { error: `${chapter} has no voice note for ${entry.name} under ${key}` } };
            const file = chapterFiles(root).get(chapter);
            if (!file) return { status: 400, body: { error: `no chapter ${chapter}` } };
            edit = editVoiceNote(root, file, key, body.text);
          } else if (body.kind === "individual") {
            if (!entry.canon) return { status: 400, body: { error: `${entry.name} isn't in canon/individuals.yaml` } };
            edit = editIndividual(root, path.join(root, "canon", "individuals.yaml"), entry.canon, body.field, body.text);
          } else {
            return { status: 400, body: { error: "kind is voiceNote or individual" } };
          }
        } catch (error) {
          if (error instanceof CanonEditError) return { status: 400, body: { error: error.message } };
          throw error;
        }
        // Who they are comes from the canon, so the sheet is rebuilt over itself: every decision stays.
        const next = rebuildSheet(root, options.sheetPath);
        const clashes = Object.fromEntries(Object.keys(next.speakers).map((other) => [other, clashesOf(next, other, providerOf(body.provider))]));
        return { status: 200, body: { edit, entry: next.speakers[id], profile: loadProfiles(root, next)[id], auditions: auditionLines(id, next.speakers[id]!), clashes } };
      }
      case "/api/cast/save": {
        // A voice picked on the page is a person's choice: it is written to the sheet, which a rebuild keeps.
        const sheet = readSheet(options.sheetPath);
        const id = String(body.id);
        const entry = sheet.speakers[id];
        if (!entry) return { status: 400, body: { error: `nobody called ${id} in the sheet` } };
        const provider = providerOf(body.provider);
        if (body.voice !== undefined) {
          if (!GEMINI_VOICES.some((voice) => voice.id === body.voice)) return { status: 400, body: { error: `${String(body.voice)} is not a Gemini voice` } };
          entry.gemini = { voice: String(body.voice) };
        }
        if (body.elevenlabs !== undefined) {
          // A voice from the account's list, picked by ear; null takes the choice back.
          if (body.elevenlabs === null) {
            delete entry.elevenlabs;
          } else {
            const pick = body.elevenlabs as { voiceId?: unknown; name?: unknown };
            if (typeof pick !== "object" || typeof pick.voiceId !== "string" || !ELEVEN_VOICE_ID.test(pick.voiceId)) return { status: 400, body: { error: "that is not an ElevenLabs voice id" } };
            const name = typeof pick.name === "string" ? pick.name.replace(/\s+/g, " ").trim().slice(0, 100) : "";
            // A different voice has not been approved, even if the last one was.
            entry.elevenlabs = { voiceId: pick.voiceId, ...(name ? { name } : {}), ...(entry.elevenlabs?.voiceId === pick.voiceId && entry.elevenlabs.approved ? { approved: true } : {}) };
          }
        }
        if (body.status !== undefined) {
          if (body.status !== "approved" && body.status !== "provisional") return { status: 400, body: { error: "status is approved or provisional" } };
          if (provider === "elevenlabs") {
            if (!entry.elevenlabs) return { status: 400, body: { error: `${entry.name} has no ElevenLabs voice yet` } };
            if (body.status === "approved") entry.elevenlabs.approved = true;
            else delete entry.elevenlabs.approved;
          } else {
            entry.status = body.status;
          }
        }
        if (body.notes !== undefined) {
          const notes = String(body.notes).slice(0, 2000);
          if (notes) entry.notes = notes;
          else delete entry.notes;
        }
        let moved: { from: string; to: string } | undefined;
        if (body.gender !== undefined) {
          if (body.gender === "auto") {
            delete entry.gender;
            delete entry.genderFrom;
            // Back to what the content says, credited to where the pronouns really came from: a canon
            // individual's pronouns can still be the narration's, when canon gives none.
            Object.assign(entry, derivedGender(entry, entry.pronounsFrom ?? "narration"));
          } else if (GENDERS.includes(body.gender as Gender)) {
            entry.gender = body.gender as Gender;
            entry.genderFrom = "person";
          } else {
            return { status: 400, body: { error: `gender is ${GENDERS.join(", ")} or auto` } };
          }
          // A voice that no longer fits moves, unless it was approved or chosen in the same breath.
          const wants = voiceGenderOf(entry);
          const has = GEMINI_VOICE_TRAITS[entry.gemini.voice]?.gender;
          // A woman's or a man's voice is a Gemini voice's trait: in ElevenLabs mode the gender is kept and nothing moves.
          if (provider === "gemini" && entry.status !== "approved" && body.voice === undefined && wants !== null && has !== wants && entry.kind !== "narrator" && entry.kind !== "party") {
            const from = entry.gemini.voice;
            entry.gemini = { voice: nextVoice(sheet.speakers, id) };
            moved = { from, to: entry.gemini.voice };
          }
        }
        if (body.direction !== undefined) {
          const direction = String(body.direction).replace(/\s+/g, " ").trim().slice(0, 600);
          if (direction) entry.direction = direction;
          else delete entry.direction;
        }
        if (body.who !== undefined) {
          // Everyone else's "who" is rebuilt from their chapters and canon: change it there, on their profile.
          if (entry.kind !== "narrator" && entry.kind !== "party") return { status: 400, body: { error: `${entry.name}'s description comes from their voice notes in canon: edit those, or add a direction` } };
          const who = String(body.who).replace(/\s+/g, " ").trim().slice(0, 1200);
          if (!who) return { status: 400, body: { error: "the description can't be blank" } };
          entry.who = who;
        }
        if (body.accent !== undefined) {
          const accent = String(body.accent).slice(0, 200).trim();
          if (accent && accent !== sheet.accent) entry.accent = accent;
          else delete entry.accent;
        }
        writeSheet(options.sheetPath, sheet);
        const clashes = Object.fromEntries(Object.keys(sheet.speakers).map((other) => [other, clashesOf(sheet, other, provider)]));
        return { status: 200, body: { entry, clashes, ...(moved ? { moved } : {}) } };
      }
      case "/api/cast/decide": {
        // Approve pins the voice; reject records why and moves the character to the next best voice.
        const sheet = readSheet(options.sheetPath);
        const id = String(body.id);
        if (!sheet.speakers[id]) return { status: 400, body: { error: `nobody called ${id} in the sheet` } };
        if (body.decision !== "approved" && body.decision !== "rejected") return { status: 400, body: { error: "decision is approved or rejected" } };
        const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000).trim() : "";
        const provider = providerOf(body.provider);
        const model = typeof body.model === "string" && (provider === "elevenlabs" ? ELEVEN_MODEL_ID : MODEL_ID).test(body.model) ? body.model : undefined;
        let entry: CastEntry;
        try {
          entry = decide(sheet, id, body.decision, notes || undefined, model, new Date().toISOString(), provider);
        } catch (error) {
          return { status: 400, body: { error: (error as Error).message } };
        }
        writeSheet(options.sheetPath, sheet);
        const clashes = Object.fromEntries(Object.keys(sheet.speakers).map((other) => [other, clashesOf(sheet, other, provider)]));
        return { status: 200, body: { entry, clashes } };
      }
      case "/api/cast/review": {
        const sheet = readSheet(options.sheetPath);
        return { status: 200, body: { markdown: reviewMarkdown(sheet), json: reviewJson(sheet) } };
      }
      default:
        return null;
    }
  };
}
