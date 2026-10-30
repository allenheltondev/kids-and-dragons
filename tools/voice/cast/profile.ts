/**
 * A character's profile (docs/voice-cast.md): their picture, what the game
 * says about them, and where their voice notes live, gathered from the art
 * manifest, the cast art brief, the chapters and canon. Read fresh for each
 * page, so an edit to the canon shows at once.
 */

import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { accentIdeas } from "./accents.ts";
import { INDIVIDUAL_FIELDS, isPinned } from "./canon-edit.ts";
import type { CastEntry, CastSheet } from "./sheet.ts";
import { chapterFiles } from "./sources.ts";

/** A place on the realm's map: a biome or a named location, with its label anchor (0 to 1000 each way, from the top left). */
export interface Place {
  id: string;
  /** The canon name ("The Sallow Wastelands"). */
  title: string;
  /** What the map itself prints there, when it is not the name ("The Bone Yard"). */
  label?: string;
  x: number | null;
  y: number | null;
  /** The biome it is in (its own id for a biome), which is what the accent ideas are keyed by. */
  biome: string;
}

/** Where a character's people live: the places canon gives their people, or failing that the place the character calls home. */
export interface Homeland {
  /** Their people's name ("skupper"), when canon gives one. */
  people: string | null;
  source: "people" | "home";
  places: Place[];
}

export interface Profile {
  /** A served path under /art/, or null when nobody has painted them. */
  image: string | null;
  /** The figure stands for one of a people, not this person: "a faun", drawn as any faun. */
  imageIsGeneric: boolean;
  facts: { basis?: string; scale?: string; heightCm?: number; stance?: string; look?: string };
  canon: null | { id: string; home?: string; role?: string; people?: string; fields: Record<string, string> };
  voiceNotes: { chapter: string; campaign: string; key: string; text: string; pinned: boolean }[];
  /** Which people they are one of ("yeti", "harvest_sprite", "unicorn"), when canon or their figure says: the group casting can share a voice across. */
  people: string | null;
  /** Where their people live on the map, or null when canon has no place for them. */
  homeland: Homeland | null;
  /** Accents that might suit where they live, most-suggested first, each with the reasons. */
  accentIdeas: { label: string; note: string; because: string[] }[];
}

/** The map's places and who lives where, read once from canon. */
export interface PlaceBook {
  biomes: Map<string, { title: string; label?: string; x: number | null; y: number | null }>;
  locations: Map<string, { title: string; label?: string; x: number | null; y: number | null; biome: string }>;
  /** A people's id ("npc.skupper", "character.unicorn") to the places canon puts them. */
  homes: Map<string, string[]>;
}

const anchorOf = (entry: Record<string, unknown>): { x: number | null; y: number | null } => {
  const anchor = entry.map_anchor as { x?: unknown; y?: unknown } | null | undefined;
  return typeof anchor?.x === "number" && typeof anchor.y === "number" ? { x: anchor.x, y: anchor.y } : { x: null, y: null };
};

/** A place's name, and the map's own label for it when that is something else. */
const namesOf = (entry: Record<string, unknown>, id: string): { title: string; label?: string } => {
  const title = String(entry.title ?? entry.map_label ?? id);
  const label = typeof entry.map_label === "string" && entry.map_label !== title ? entry.map_label : undefined;
  return { title, ...(label ? { label } : {}) };
};

/** What canon says about the map: biomes, named locations and which peoples live in which. Empty if a file is missing. */
export function readPlaces(root: string): PlaceBook {
  const list = (file: string, key: string): Record<string, unknown>[] => {
    const full = path.join(root, "canon", file);
    if (!fs.existsSync(full)) return [];
    const doc = yaml.load(fs.readFileSync(full, "utf8")) as Record<string, unknown> | null;
    const found = doc?.[key];
    return Array.isArray(found) ? (found as Record<string, unknown>[]) : [];
  };
  const book: PlaceBook = { biomes: new Map(), locations: new Map(), homes: new Map() };
  const add = (people: string, place: string): void => {
    const known = book.homes.get(people) ?? [];
    if (!known.includes(place)) book.homes.set(people, [...known, place]);
  };
  for (const biome of list("biomes.yaml", "biomes")) {
    const id = String(biome.id);
    book.biomes.set(id, { ...namesOf(biome, id), ...anchorOf(biome) });
    const inhabitants = (biome.inhabitants ?? {}) as { primary_peoples?: unknown; supporting_peoples?: unknown };
    for (const people of [...((inhabitants.primary_peoples as string[] | undefined) ?? []), ...((inhabitants.supporting_peoples as string[] | undefined) ?? [])]) add(String(people), id);
  }
  for (const location of list("locations.yaml", "locations")) {
    book.locations.set(String(location.id), { ...namesOf(location, String(location.id)), ...anchorOf(location), biome: String(location.parent_biome ?? "") });
  }
  for (const people of list("npcs.yaml", "npcs")) {
    const relationships = (people.relationships ?? {}) as { primary_locations?: unknown };
    for (const place of (relationships.primary_locations as string[] | undefined) ?? []) add(String(people.id), String(place));
  }
  return book;
}

const placeOf = (book: PlaceBook, id: string): Place | null => {
  const biome = book.biomes.get(id);
  if (biome) return { id, title: biome.title, ...(biome.label ? { label: biome.label } : {}), x: biome.x, y: biome.y, biome: id };
  const location = book.locations.get(id);
  return location ? { id, title: location.title, ...(location.label ? { label: location.label } : {}), x: location.x, y: location.y, biome: location.biome } : null;
};

/**
 * Where a character's people live: the places canon gives their people (a kind, "npc.skupper", or one of the
 * playable species, "character.unicorn"), or failing that the place they themselves call home. Null when canon
 * has neither. A people's homeland is where they are most often found, not a border (canon says so).
 */
export function homelandOf(book: PlaceBook, people: string | undefined, home: string | undefined): Homeland | null {
  const named = people ? [...new Set(book.homes.get(people) ?? [])].flatMap((id) => placeOf(book, id) ?? []) : [];
  const label = people?.replace(/^(npc|character)\./, "").replace(/_/g, " ") ?? null;
  if (named.length > 0) return { people: label, source: "people", places: named };
  const house = home ? placeOf(book, home) : null;
  return house ? { people: label, source: "home", places: [house] } : null;
}

/** The realm's map, the one painting outside the figures that /art/ serves: a profile marks where a character's people live on it. */
export const REALM_MAP = "world/realm_of_red_sky.webp";

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

  const places = readPlaces(root);
  const profiles: Record<string, Profile> = {};
  for (const [id, entry] of Object.entries(sheet.speakers)) profiles[id] = profileOf(root, id, entry, { figures, looks, byName, individuals, chapter, places });
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
    places: PlaceBook;
  },
): Profile {
  // The scenes' own figure first; then a cast painting under their id or name, for those the scenes draw as someone else.
  const figure = entry.figure ?? (fs.existsSync(path.join(root, "assets", "cast", id)) ? `cast/${id}` : sources.byName.get(entry.name.toLowerCase()));
  const image = imageOf(root, figure);
  const facts = figure ? sources.figures.get(figure) : undefined;
  const castId = figure?.startsWith("cast/") ? figure.slice(5) : undefined;
  const person = entry.canon ? sources.individuals.get(entry.canon) : undefined;
  // Their people: canon's word for the individual, or the kind they are drawn as (a faun, a yeti, a unicorn).
  const basis = (facts?.basis ?? (figure && !figure.startsWith("cast/") ? figure.split("/")[1] : undefined))?.toLowerCase().replace(/[ -]/g, "_");
  const people =
    typeof person?.people === "string"
      ? person.people
      : basis
        ? [`npc.${basis}`, `character.${basis}`].find((id) => sources.places.homes.has(id))
        : undefined;
  const homeland = homelandOf(sources.places, people, typeof person?.home === "string" ? person.home : undefined);
  // Canon's word for them, else the kind they are drawn as ("faun", "yeti"): the same key whether or not the map knows the people.
  const peopleKey = (typeof person?.people === "string" ? person.people.replace(/^(npc|character)\./, "") : basis) ?? null;
  const ideas = homeland ? accentIdeas(homeland.places.map((place) => place.biome), (biome) => sources.places.biomes.get(biome)?.title ?? biome) : [];
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
    people: peopleKey,
    homeland,
    accentIdeas: ideas.map((idea) => ({ label: idea.accent.label, note: idea.accent.note, because: idea.because })),
    voiceNotes: (entry.voiceNotes ?? []).flatMap(({ chapter: chapterId, key }) => {
      const chapter = sources.chapter(chapterId);
      const text = chapter?.voiceGuide?.npcVoices?.[key];
      if (text === undefined) return [];
      return [{ chapter: chapterId, campaign: chapter?.campaignId ?? "none", key, text, pinned: isPinned({ id: chapterId, ...(chapter?.campaignId ? { campaignId: chapter.campaignId } : {}) }) }];
    }),
  };
}
