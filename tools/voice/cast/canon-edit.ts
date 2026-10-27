/**
 * Edits to the canon behind a character, from their profile page
 * (docs/voice-cast.md): a chapter's voice note for them, or a field of their
 * entry in canon/individuals.yaml.
 *
 * Each edit replaces one value in place and leaves the rest of the file byte
 * for byte as it was: chapter files are hand-formatted JSON, and the canon
 * file carries comments a parse-and-dump would lose. An edit is read back
 * before it is kept, and refused if the file would not say exactly the new
 * words.
 */

import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

export class CanonEditError extends Error {}

/** The fields of a canon individual a profile page may change. */
export const INDIVIDUAL_FIELDS = ["short_description", "visual_identity", "speech_register", "pronouns"] as const;
export type IndividualField = (typeof INDIVIDUAL_FIELDS)[number];

export interface EditResult {
  /** Repository-relative path of the file that changed. */
  file: string;
  before: string;
  after: string;
  /** Gemfall's files are hashed by gemfall-compat.test.ts: an edit there needs those hashes re-taken. */
  pinned: boolean;
}

const MAX = 1200;

/** One line of plain words: no line breaks, and a sane length. */
function clean(text: unknown): string {
  if (typeof text !== "string") throw new CanonEditError("text must be a string");
  const words = text.replace(/\s+/g, " ").trim();
  if (!words) throw new CanonEditError("say something: canon can't be blank");
  if (words.length > MAX) throw new CanonEditError(`keep it under ${String(MAX)} characters`);
  return words;
}

/** Changes `voiceGuide.npcVoices[key]` in one chapter file. */
export function editVoiceNote(root: string, chapterFile: string, key: string, text: unknown): EditResult {
  const after = clean(text);
  const source = fs.readFileSync(chapterFile, "utf8");
  const chapter = JSON.parse(source) as { id?: string; campaignId?: string; voiceGuide?: { npcVoices?: Record<string, string> } };
  const notes = chapter.voiceGuide?.npcVoices ?? {};
  if (!Object.hasOwn(notes, key)) throw new CanonEditError(`${chapter.id ?? chapterFile} has no voice note for ${key}`);
  const before = notes[key]!;
  const file = path.relative(root, chapterFile);
  if (before === after) return { file, before, after, pinned: isPinned(chapter) };
  // The pair as the file writes it. The same key and words twice in one file would be ambiguous: refuse.
  const pair = new RegExp(`${escape(JSON.stringify(key))}(\\s*:\\s*)${escape(JSON.stringify(before))}`, "g");
  const found = source.match(pair) ?? [];
  if (found.length !== 1) throw new CanonEditError(`couldn't find ${key}'s voice note exactly once in ${file}; edit it by hand`);
  const next = source.replace(pair, (_, colon: string) => `${JSON.stringify(key)}${colon}${JSON.stringify(after)}`);
  const check = JSON.parse(next) as typeof chapter;
  if (check.voiceGuide?.npcVoices?.[key] !== after) throw new CanonEditError(`the edit to ${file} didn't read back; nothing was written`);
  fs.writeFileSync(chapterFile, next);
  return { file, before, after, pinned: isPinned(chapter) };
}

export const isPinned = (chapter: { id?: string; campaignId?: string }): boolean => chapter.campaignId === "gemfall" || /^gemfall-/.test(chapter.id ?? "");

/** Changes one field of one individual in canon/individuals.yaml. */
export function editIndividual(root: string, canonFile: string, id: string, field: unknown, text: unknown): EditResult {
  if (!INDIVIDUAL_FIELDS.includes(field as IndividualField)) throw new CanonEditError(`only ${INDIVIDUAL_FIELDS.join(", ")} can be changed here`);
  const name = field as IndividualField;
  const after = clean(text);
  if (name === "pronouns" && !/^[a-z]+\/[a-z]+$/i.test(after)) throw new CanonEditError('pronouns look like "she/her"');
  const source = fs.readFileSync(canonFile, "utf8");
  const file = path.relative(root, canonFile);
  const lines = source.split("\n");

  // The individual's block: from its `- id:` line to the next one at the same depth.
  const start = lines.findIndex((line) => line === `  - id: ${id}`);
  if (start < 0) throw new CanonEditError(`${file} has no individual ${id}`);
  let end = lines.findIndex((line, i) => i > start && /^ {2}- id: /.test(line));
  if (end < 0) end = lines.length;
  const at = lines.findIndex((line, i) => i > start && i < end && line.startsWith(`    ${name}:`));
  if (at < 0) throw new CanonEditError(`${id} has no ${name} in ${file}`);
  // A folded value's continuation lines are indented deeper than its key.
  let stop = at + 1;
  while (stop < end && (/^ {6,}\S/.test(lines[stop]!) || (lines[stop] === "" && /^ {6,}\S/.test(lines[stop + 1] ?? "")))) stop += 1;

  const before = individualValue(source, id, name);
  if (before === after) return { file, before, after, pinned: false };
  const written = name === "pronouns" ? [`    ${name}: ${JSON.stringify(after)}`] : [`    ${name}: >-`, ...wrap(after, 74).map((line) => `      ${line}`)];
  const next = [...lines.slice(0, at), ...written, ...lines.slice(stop)].join("\n");
  if (individualValue(next, id, name) !== after) throw new CanonEditError(`the edit to ${file} didn't read back; nothing was written`);
  fs.writeFileSync(canonFile, next);
  return { file, before, after, pinned: false };
}

export function individualValue(source: string, id: string, field: string): string {
  const doc = yaml.load(source) as { individuals?: Record<string, unknown>[] };
  const person = (doc.individuals ?? []).find((p) => p.id === id);
  const value = person?.[field];
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Words wrapped at a width, never splitting a word. */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
