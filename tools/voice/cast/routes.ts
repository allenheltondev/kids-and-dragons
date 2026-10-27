/**
 * The cast page's half of the bake-off server (docs/voice-cast.md): show the
 * whole cast sheet, render auditions in each character's voice, and save the
 * voices people pick back to content/voice/cast.json.
 *
 * It reuses the bake-off's machinery whole: an audition line is a one-line
 * sample, rendered by the same planner, cached by the same request hash and
 * charged against the same session cap. Gemini only for now: it is the
 * provider the game is leaning toward, and the sheet's voices are Gemini's.
 */

import fs from "node:fs";
import { cellOf, estimate, renderCell, type Workspace } from "../bakeoff/bakeoff.ts";
import type { Cell } from "../bakeoff/page.ts";
import { GEMINI_VOICES, engineOf, type CastFile, type Fetch, type Keys, type ModelInfo } from "../bakeoff/providers.ts";
import type { Sample } from "../bakeoff/samples.ts";
import { GEMINI_VOICE_TRAITS, voiceClashes, type CastEntry, type CastSheet } from "./sheet.ts";

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
}

export interface Reply {
  status: number;
  body: unknown;
}

/** Said by someone the game has not given a line yet, so their voice can still be heard. Marked as not from the game. */
export const STAND_IN = "Oh! Hello there. I'm {name}, and you must be the new heroes everybody keeps talking about.";

const MODEL_ID = /^gemini-[A-Za-z0-9._-]{1,70}$/;

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

/** The sheet as the planner's cast: each character described by name and notes, with their voice and accent. */
export function sheetCast(sheet: CastSheet, base: CastFile): CastFile {
  return {
    ...base,
    accent: sheet.accent,
    speakers: Object.fromEntries(
      Object.entries(sheet.speakers).map(([id, entry]) => [
        id,
        { describe: `${entry.name}: ${entry.who}`, ...(entry.accent ? { accent: entry.accent } : {}), gemini: { voice: entry.gemini.voice } },
      ]),
    ),
  };
}

function engineFor(model: unknown, catalog: readonly ModelInfo[]): ReturnType<typeof engineOf> {
  const id = typeof model === "string" && MODEL_ID.test(model) ? model : "gemini-3.8-flash-tts";
  return engineOf({ provider: "gemini", model: id, mode: "lines", delivery: "tag" }, catalog);
}

/** Who shares a voice with this character, chapter by chapter. */
function clashesOf(sheet: CastSheet, id: string): { chapter: string; with: string[] }[] {
  return voiceClashes(sheet)
    .filter((clash) => clash.speakers.includes(id))
    .map((clash) => ({ chapter: clash.chapter, with: clash.speakers.filter((other) => other !== id) }));
}

export function castPageData(options: CastRouteOptions) {
  const sheet = readSheet(options.sheetPath);
  return {
    accent: sheet.accent,
    speakers: sheet.speakers,
    voices: GEMINI_VOICES.map((voice) => ({ id: voice.id, about: voice.about, gender: GEMINI_VOICE_TRAITS[voice.id]?.gender ?? null })),
    models: options.catalog.filter((model) => model.provider === "gemini"),
    chapterCampaigns: options.chapterCampaigns,
    auditions: Object.fromEntries(Object.entries(sheet.speakers).map(([id, entry]) => [id, auditionLines(id, entry)])),
  };
}

export function createCastRoutes(options: CastRouteOptions, budget: Budget) {
  return async function handle(route: string, body: Record<string, unknown>, keys: Keys): Promise<Reply | null> {
    switch (route) {
      case "/api/cast/state": {
        // Every audition's clip from disk, and what rendering the rest would cost. Sends nothing.
        const sheet = readSheet(options.sheetPath);
        const ws = { ...options.ws, cast: sheetCast(sheet, options.ws.cast) };
        const engine = engineFor(body.model, options.catalog);
        const cells: Record<string, Cell[]> = {};
        const samples: Sample[] = [];
        for (const [id, entry] of Object.entries(sheet.speakers)) {
          const list: Cell[] = [];
          auditionLines(id, entry).forEach((_, i) => {
            const sample = auditionSample(id, entry, i)!;
            samples.push(sample);
            list.push(cellOf(engine, sample, 1, ws));
          });
          cells[id] = list;
        }
        const left = estimate(engine, samples, 1, ws);
        const clashes = Object.fromEntries(Object.keys(sheet.speakers).map((id) => [id, clashesOf(sheet, id)]));
        return { status: 200, body: { cells, clashes, estimate: left, spent: budget.spent, cap: budget.cap } };
      }
      case "/api/cast/render": {
        const sheet = readSheet(options.sheetPath);
        const id = String(body.id);
        const entry = sheet.speakers[id];
        if (!entry) return { status: 400, body: { error: `nobody called ${id} in the sheet` } };
        const sample = auditionSample(id, entry, Number(body.line ?? 0));
        if (!sample) return { status: 400, body: { error: "no such audition line" } };
        const ws = { ...options.ws, cast: sheetCast(sheet, options.ws.cast) };
        const engine = engineFor(body.model, options.catalog);
        const quoted = estimate(engine, [sample], 1, ws);
        if (quoted.dollars === null && quoted.requests > 0) {
          return { status: 409, body: { error: `pricing.json has no price for ${engine.model}, so the cap cannot be kept.`, spent: budget.spent, cap: budget.cap } };
        }
        const price = quoted.dollars ?? 0;
        if (budget.spent + price > budget.cap + 1e-9) {
          return { status: 402, body: { error: `This would take the session past its $${budget.cap.toFixed(2)} cap. Raise the cap on the bake-off page to go on.`, spent: budget.spent, cap: budget.cap } };
        }
        budget.spent += price;
        const cell = await renderCell(engine, sample, 1, ws, keys, options.fetch);
        return { status: 200, body: { cell, spent: budget.spent, cap: budget.cap } };
      }
      case "/api/cast/save": {
        // A voice picked on the page is a person's choice: it is written to the sheet, which a rebuild keeps.
        const sheet = readSheet(options.sheetPath);
        const id = String(body.id);
        const entry = sheet.speakers[id];
        if (!entry) return { status: 400, body: { error: `nobody called ${id} in the sheet` } };
        if (body.voice !== undefined) {
          if (!GEMINI_VOICES.some((voice) => voice.id === body.voice)) return { status: 400, body: { error: `${String(body.voice)} is not a Gemini voice` } };
          entry.gemini = { voice: String(body.voice) };
        }
        if (body.status !== undefined) {
          if (body.status !== "approved" && body.status !== "provisional") return { status: 400, body: { error: "status is approved or provisional" } };
          entry.status = body.status;
        }
        if (body.notes !== undefined) {
          const notes = String(body.notes).slice(0, 2000);
          if (notes) entry.notes = notes;
          else delete entry.notes;
        }
        if (body.accent !== undefined) {
          const accent = String(body.accent).slice(0, 200).trim();
          if (accent && accent !== sheet.accent) entry.accent = accent;
          else delete entry.accent;
        }
        fs.writeFileSync(options.sheetPath, `${JSON.stringify(sheet, null, 2)}\n`);
        const clashes = Object.fromEntries(Object.keys(sheet.speakers).map((other) => [other, clashesOf(sheet, other)]));
        return { status: 200, body: { entry, clashes } };
      }
      default:
        return null;
    }
  };
}
