/**
 * A character's profile (docs/voice-cast.md): their picture, what the game
 * says about them, and where their voice notes live, gathered from the art
 * manifest, the cast art brief, the chapters and canon. Read fresh for each
 * page, so an edit to the canon shows at once.
 */

import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { INDIVIDUAL_FIELDS, isPinned } from "./canon-edit.ts";
import type { CastEntry, CastSheet } from "./sheet.ts";
import { chapterFiles } from "./sources.ts";

export interface Profile {
  /** A served path under /art/, or null when nobody has painted them. */
  image: string | null;
  /** The figure stands for one of a people, not this person: "a faun", drawn as any faun. */
  imageIsGeneric: boolean;
  facts: { basis?: string; scale?: string; heightCm?: number; stance?: string; look?: string };
  canon: null | { id: string; home?: string; role?: string; people?: string; fields: Record<string, string> };
  voiceNotes: { chapter: string; campaign: string; key: string; text: string; pinned: boolean }[];
}

/** What /art/ serves: paintings under assets/, nothing else. */
export const ART = /^(cast|entities|characters)\/[a-z0-9_]+(\/[a-z0-9_]+)?\/(assembled\.png|portrait\.webp)$/;

interface Figure {
  id: string;
  name?: string;
  basis?: string;
  scale?: string;
  heightCm?: number;
  stance?: string;
}

/** The art brief's "look" column for each cast figure, by id. */
export function looksFromBrief(markdown: string): Map<string, string> {
  const looks = new Map<string, string>();
  for (const line of markdown.split("\n")) {
    const match = /^\|\s*`([a-z0-9_]+)`\s*\|.*\|\s*([^|]+?)\s*\|\s*$/.exec(line);
    if (match && /[a-z]{3,}\s[a-z]/.test(match[2]!)) looks.set(match[1]!, match[2]!);
  }
  return looks;
}

/** The painting for a figure ("cast/pellam", "entities/faun", "characters/dragonling"), if there is one. */
export function imageOf(root: string, figure: string | undefined): string | null {
  if (!figure || !/^(cast|entities|characters)\/[a-z0-9_]+$/.test(figure)) return null;
  const candidates = figure.startsWith("characters/")
    ? [`${figure}/fledgling/portrait.webp`, `${figure}/fledgling/assembled.png`]
    : figure.startsWith("entities/")
      ? [`${figure}/portrait.webp`, `${figure}/assembled.png`]
      : [`${figure}/assembled.png`, `${figure}/portrait.webp`];
  return candidates.find((candidate) => fs.existsSync(path.join(root, "assets", candidate))) ?? null;
}

export function loadProfiles(root: string, sheet: CastSheet): Record<string, Profile> {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets", "manifest.json"), "utf8")) as { castFigures?: Figure[]; stageFigures?: Figure[] };
  const figures = new Map<string, Figure>();
  for (const figure of manifest.castFigures ?? []) figures.set(`cast/${figure.id}`, figure);
  const briefFile = path.join(root, "docs", "briefs", "story-cast-art.md");
  const looks = fs.existsSync(briefFile) ? looksFromBrief(fs.readFileSync(briefFile, "utf8")) : new Map<string, string>();
  const byName = new Map((manifest.castFigures ?? []).map((figure) => [figure.name?.toLowerCase(), `cast/${figure.id}`]));

  const canonDoc = yaml.load(fs.readFileSync(path.join(root, "canon", "individuals.yaml"), "utf8")) as { individuals?: Record<string, unknown>[] };
  const individuals = new Map((canonDoc.individuals ?? []).map((person) => [String(person.id), person]));
  const files = chapterFiles(root);
  const chapters = new Map<string, { campaignId?: string; voiceGuide?: { npcVoices?: Record<string, string> } }>();
  const chapter = (id: string) => {
    if (!chapters.has(id) && files.has(id)) chapters.set(id, JSON.parse(fs.readFileSync(files.get(id)!, "utf8")));
    return chapters.get(id);
  };

  const profiles: Record<string, Profile> = {};
  for (const [id, entry] of Object.entries(sheet.speakers)) profiles[id] = profileOf(root, id, entry, { figures, looks, byName, individuals, chapter });
  return profiles;
}

function profileOf(
  root: string,
  id: string,
  entry: CastEntry,
  sources: {
    figures: Map<string, Figure>;
    looks: Map<string, string>;
    byName: Map<string | undefined, string>;
    individuals: Map<string, Record<string, unknown>>;
    chapter: (id: string) => { campaignId?: string; voiceGuide?: { npcVoices?: Record<string, string> } } | undefined;
  },
): Profile {
  // The scenes' own figure first; then a cast painting under their id or name, for those the scenes draw as someone else.
  const figure = entry.figure ?? (fs.existsSync(path.join(root, "assets", "cast", id)) ? `cast/${id}` : sources.byName.get(entry.name.toLowerCase()));
  const image = imageOf(root, figure);
  const facts = figure ? sources.figures.get(figure) : undefined;
  const castId = figure?.startsWith("cast/") ? figure.slice(5) : undefined;
  const person = entry.canon ? sources.individuals.get(entry.canon) : undefined;
  return {
    image,
    imageIsGeneric: !!figure && !figure.startsWith("cast/"),
    facts: {
      ...(facts?.basis ? { basis: facts.basis.replace(/_/g, " ") } : figure && !figure.startsWith("cast/") ? { basis: figure.split("/")[1]!.replace(/_/g, " ") } : {}),
      ...(facts?.scale ? { scale: facts.scale } : {}),
      ...(facts?.heightCm ? { heightCm: facts.heightCm } : person?.height_cm ? { heightCm: Number(person.height_cm) } : {}),
      ...(facts?.stance ? { stance: facts.stance } : {}),
      ...(castId && sources.looks.has(castId) ? { look: sources.looks.get(castId)! } : {}),
    },
    canon: person
      ? {
          id: String(person.id),
          ...(person.home ? { home: String(person.home).replace(/^location\./, "").replace(/_/g, " ") } : {}),
          ...(person.role ? { role: String(person.role).replace(/_/g, " ") } : {}),
          ...(person.people ? { people: String(person.people).replace(/^npc\./, "").replace(/_/g, " ") } : {}),
          fields: Object.fromEntries(INDIVIDUAL_FIELDS.map((field) => [field, typeof person[field] === "string" ? (person[field] as string).replace(/\s+/g, " ").trim() : ""])),
        }
      : null,
    voiceNotes: (entry.voiceNotes ?? []).flatMap(({ chapter: chapterId, key }) => {
      const chapter = sources.chapter(chapterId);
      const text = chapter?.voiceGuide?.npcVoices?.[key];
      if (text === undefined) return [];
      return [{ chapter: chapterId, campaign: chapter?.campaignId ?? "none", key, text, pinned: isPinned({ id: chapterId, ...(chapter?.campaignId ? { campaignId: chapter.campaignId } : {}) }) }];
    }),
  };
}
