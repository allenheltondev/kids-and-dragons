/**
 * Everything the cast sheet is built from, read from disk: the chapters, the
 * canon individuals and the narration. Shared by `npm run voice:cast` and the
 * cast pages, which rebuild the sheet after an edit to the canon.
 */

import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { inventory } from "../inventory.ts";
import { buildSheet, type CastSheet, type ChapterLike, type IndividualLike, type Sources } from "./sheet.ts";

export const SHEET_COMMENT =
  "The cast voice sheet (docs/voice-cast.md). Built by `npm run voice:cast` from the chapters' voiceGuide.npcVoices, their scene casts and canon/individuals.yaml; edit voices on the cast page (`npm run voice:bakeoff -- --serve`, then /cast) or here. A person's decisions (status, voice, gender, accent, direction, notes, history) survive every rebuild; everything else is refreshed from the content. `lines` are real quotes from the narration, for auditions.";

const readDir = (dir: string): { file: string; json: Record<string, unknown> }[] =>
  fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ file: path.join(dir, name), json: JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as Record<string, unknown> }));

/** Each chapter's id and the file it lives in. */
export function chapterFiles(root: string): Map<string, string> {
  return new Map(readDir(path.join(root, "content", "chapters")).map(({ file, json }) => [String(json.id), file]));
}

/**
 * `canon: false` leaves the canon individuals out. Who appears in which chapter
 * comes from the chapters alone (canon only adds a canon id and pronouns), so the
 * content gate reads it that way and works on a content tree without `canon/`.
 */
export function loadSources(root: string, options: { canon?: boolean } = {}): Sources {
  const chapters = readDir(path.join(root, "content", "chapters")).map((entry) => entry.json);
  const campaigns = readDir(path.join(root, "content", "campaigns")).map((entry) => entry.json);
  const canon =
    options.canon === false
      ? {}
      : (yaml.load(fs.readFileSync(path.join(root, "canon", "individuals.yaml"), "utf8")) as { individuals?: IndividualLike[] });
  const narration = inventory({ chapters, campaigns }, { facetsMax: 6 })
    .filter((line) => line.kind === "narration" || line.kind === "cue" || line.kind === "prompt")
    .map((line) => ({ address: line.address, chapter: line.chapter, text: line.text }));
  return { chapters: chapters as unknown as ChapterLike[], individuals: canon.individuals ?? [], narration };
}

/** Builds the sheet from the content on disk over the previous one, and writes it. */
export function rebuildSheet(root: string, sheetPath: string): CastSheet {
  const previous = fs.existsSync(sheetPath) ? (JSON.parse(fs.readFileSync(sheetPath, "utf8")) as CastSheet) : null;
  const sheet = buildSheet(loadSources(root), previous);
  const out: CastSheet = { $comment: SHEET_COMMENT, accent: sheet.accent, speakers: sheet.speakers };
  writeSheet(sheetPath, out);
  return out;
}

export function writeSheet(sheetPath: string, sheet: CastSheet): void {
  fs.mkdirSync(path.dirname(sheetPath), { recursive: true });
  fs.writeFileSync(sheetPath, `${JSON.stringify(sheet, null, 2)}\n`);
}
