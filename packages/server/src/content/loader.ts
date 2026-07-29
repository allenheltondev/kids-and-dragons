/**
 * Content loader — `content/rules.json`, `content/items.json`,
 * `content/chapters/*.json`.
 *
 * Content is data, not code (architecture §5): chapters are authored offline,
 * validated in CI against `schemas/`, and served as static assets. This loader
 * is the server's copy of that same guarantee at runtime:
 *
 *   **A missing or malformed content file kills startup, never a play session.**
 *
 * That is why `loadContent()` throws a `ContentError` listing every problem it
 * found rather than returning partial content — the failure has to be
 * impossible to miss on a laptop and impossible to hit at the table.
 *
 * The deeper validation (scene graph reachability, unknown `itemId` references)
 * belongs to the CI validator, which fails the build. Here we check the shape
 * plus the two cross-references that would strand a party mid-chapter: a
 * chapter whose `entry` scene does not exist, and a `goto` pointing nowhere.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type {
  Chapter,
  EncounterMap,
  ItemCatalog,
  ItemDef,
  RulesContent,
  Scene,
  SceneId,
} from "@kad/shared";
import { contentDir } from "../paths.ts";

/** Thrown at startup. Carries every problem, not just the first. */
export class ContentError extends Error {
  readonly problems: string[];
  constructor(root: string, problems: string[]) {
    super(
      [
        `Content failed to load from ${root}`,
        ...problems.map((p) => `  • ${p}`),
        "",
        "Fix the files (or set KAD_CONTENT_DIR) and restart. Content is validated",
        "at startup on purpose: a bad chapter must never reach a play session.",
      ].join("\n"),
    );
    this.name = "ContentError";
    this.problems = problems;
  }
}

/**
 * The read side, handed to every handler as `deps.content`. Deliberately not a
 * bag of raw JSON: handlers ask for the chapter they need and get a loud error
 * if it is not there.
 */
export interface ContentStore {
  readonly root: string;
  rules(): RulesContent;
  items(): ItemCatalog;
  /** `null` for an unknown id — the caller decides whether that is fatal. */
  chapter(id: string): Chapter | null;
  chapterIds(): string[];
  /**
   * A battle map by id, as referenced by `EncounterScene.map`. `null` for an
   * unknown id; `content:validate` already refuses a chapter that names one, so
   * a miss at runtime means the deployed bundle and the deployed content
   * disagree — which the engine reports as NOT_FOUND rather than guessing a
   * board.
   */
  map(id: string): EncounterMap | null;
}

class LoadedContent implements ContentStore {
  constructor(
    readonly root: string,
    private readonly _rules: RulesContent,
    private readonly _items: ItemCatalog,
    private readonly _chapters: ReadonlyMap<string, Chapter>,
    private readonly _maps: ReadonlyMap<string, EncounterMap>,
  ) {}

  rules(): RulesContent {
    return this._rules;
  }

  items(): ItemCatalog {
    return this._items;
  }

  chapter(id: string): Chapter | null {
    return this._chapters.get(id) ?? null;
  }

  map(id: string): EncounterMap | null {
    return this._maps.get(id) ?? null;
  }

  chapterIds(): string[] {
    return [...this._chapters.keys()].sort();
  }
}

/**
 * Cached per root. The dev server loads once at startup; tests load fixtures
 * from a temp dir and are unaffected by each other because the cache is keyed
 * by the resolved path.
 */
const cache = new Map<string, Promise<ContentStore>>();

export function loadContent(root: string = contentDir()): Promise<ContentStore> {
  const key = path.resolve(root);
  const hit = cache.get(key);
  if (hit) return hit;
  // Cache the promise, not the result, so concurrent callers share one read —
  // but drop it on failure so a fixed file can be retried without a restart.
  const pending = readAll(key).catch((err: unknown) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, pending);
  return pending;
}

/** Drops the cache. Used by tests and by a future content hot-reload. */
export function clearContentCache(): void {
  cache.clear();
}

async function readAll(root: string): Promise<ContentStore> {
  const problems: string[] = [];

  const rules = await readJson<RulesContent>(path.join(root, "rules.json"), problems);
  const items = await readJson<ItemCatalog>(path.join(root, "items.json"), problems);
  const chapters = new Map<string, Chapter>();

  const chaptersDir = path.join(root, "chapters");
  let chapterFiles: string[] = [];
  let chaptersDirExists = true;
  try {
    chapterFiles = (await fs.readdir(chaptersDir))
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    chaptersDirExists = false;
    problems.push(`chapters/ is missing (expected ${chaptersDir})`);
  }
  if (chaptersDirExists && chapterFiles.length === 0) {
    problems.push(`chapters/ contains no .json files (${chaptersDir})`);
  }

  for (const file of chapterFiles) {
    const full = path.join(chaptersDir, file);
    const chapter = await readJson<Chapter>(full, problems);
    if (!chapter) continue;
    const chapterProblems = checkChapter(chapter, `chapters/${file}`);
    if (chapterProblems.length > 0) {
      problems.push(...chapterProblems);
      continue;
    }
    const existing = chapters.get(chapter.id);
    if (existing) {
      problems.push(`chapters/${file}: duplicate chapter id "${chapter.id}"`);
      continue;
    }
    chapters.set(chapter.id, chapter);
  }

  const maps = new Map<string, EncounterMap>();
  const mapsDir = path.join(root, "maps");
  let mapFiles: string[] = [];
  try {
    mapFiles = (await fs.readdir(mapsDir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    // No maps/ at all is fine — a content set with no encounters in it is a
    // legitimate thing to load, and `checkChapter` is what catches an encounter
    // that names a map nothing provides.
  }
  for (const file of mapFiles) {
    const map = await readJson<EncounterMap>(path.join(mapsDir, file), problems);
    if (!map) continue;
    const mapProblems = checkMap(map, `maps/${file}`);
    if (mapProblems.length > 0) {
      problems.push(...mapProblems);
      continue;
    }
    if (maps.has(map.id)) {
      problems.push(`maps/${file}: duplicate map id "${map.id}"`);
      continue;
    }
    maps.set(map.id, map);
  }

  // Every encounter's map has to exist, and only now can we know. A missing
  // board is a chapter that cannot be played past its first fight, so it fails
  // the load rather than the session.
  for (const chapter of chapters.values()) {
    for (const [sceneId, scene] of Object.entries(chapter.scenes)) {
      if (scene.type !== "encounter") continue;
      if (!maps.has(scene.map)) {
        problems.push(
          `chapters/${chapter.id}.json: scene "${sceneId}" names map "${scene.map}", which is not in maps/`,
        );
      }
    }
  }

  if (rules) problems.push(...checkRules(rules));
  if (items) problems.push(...checkItems(items));

  if (!rules || !items || problems.length > 0) {
    throw new ContentError(root, problems);
  }
  return new LoadedContent(root, rules, items, chapters, maps);
}

async function readJson<T>(file: string, problems: string[]): Promise<T | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    problems.push(`${path.basename(file)} is missing (expected ${file})`);
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    problems.push(`${path.basename(file)} is not valid JSON: ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Shape checks. Cheap, and they run exactly once — at startup.
// ---------------------------------------------------------------------------

function checkRules(rules: RulesContent): string[] {
  const problems: string[] = [];
  const need: (keyof RulesContent)[] = [
    "baseStats",
    "creationPoints",
    "baseMaxHp",
    "baseGuard",
    "baseSteps",
    "difficultyTn",
    "levelXp",
    "tierLevels",
    "species",
    "classes",
  ];
  for (const key of need) {
    if (rules[key] === undefined || rules[key] === null) {
      problems.push(`rules.json: missing "${String(key)}"`);
    }
  }
  if (rules.species && Object.keys(rules.species).length === 0) {
    problems.push("rules.json: species is empty");
  }
  if (rules.classes && Object.keys(rules.classes).length === 0) {
    problems.push("rules.json: classes is empty");
  }
  return problems;
}

function checkItems(items: ItemCatalog): string[] {
  const problems: string[] = [];
  if (typeof items !== "object" || Array.isArray(items)) {
    return ["items.json: expected an object keyed by itemId"];
  }
  for (const [id, def] of Object.entries(items)) {
    const item = def as Partial<ItemDef> | null;
    if (!item || typeof item !== "object") {
      problems.push(`items.json: "${id}" is not an object`);
      continue;
    }
    if (item.kind !== "consumable" && item.kind !== "trinket" && item.kind !== "quest") {
      problems.push(`items.json: "${id}" has an invalid kind (${String(item.kind)})`);
    }
    if (typeof item.name !== "string") problems.push(`items.json: "${id}" has no name`);
  }
  return problems;
}

/**
 * The map invariants a JSON Schema cannot state.
 *
 * The schema already fixes the board at 10×8 and the alphabet at `.`/`#`. What
 * it cannot see is whether the map is *playable*: a spawn on a bramble tile
 * would throw out of `placeActor` at the moment the fight starts, which is a
 * crash at the table for a mistake visible in the file.
 */
function checkMap(map: EncounterMap, label: string): string[] {
  const problems: string[] = [];
  if (typeof map.id !== "string" || map.id === "") problems.push(`${label}: missing id`);
  if (!Array.isArray(map.rows) || map.rows.length === 0) {
    problems.push(`${label}: missing rows`);
    return problems;
  }

  const height = map.rows.length;
  const width = map.rows[0]?.length ?? 0;
  for (const [y, row] of map.rows.entries()) {
    if (typeof row !== "string" || row.length !== width) {
      problems.push(`${label}: row ${y} is ${String(row?.length)} tiles wide, expected ${width}`);
    } else if (/[^.#]/.test(row)) {
      problems.push(`${label}: row ${y} has characters other than "." and "#"`);
    }
  }

  const seen = new Set<string>();
  for (const [kind, spawns] of [
    ["partySpawns", map.partySpawns],
    ["enemySpawns", map.enemySpawns],
  ] as const) {
    if (!Array.isArray(spawns)) {
      problems.push(`${label}: missing ${kind}`);
      continue;
    }
    for (const [i, at] of spawns.entries()) {
      const where = `${label}: ${kind}[${i}]`;
      if (at?.x === undefined || at?.y === undefined) {
        problems.push(`${where} needs an x and a y`);
        continue;
      }
      if (at.x < 0 || at.x >= width || at.y < 0 || at.y >= height) {
        problems.push(`${where} at (${at.x}, ${at.y}) is off a ${width}×${height} board`);
        continue;
      }
      if (map.rows[at.y]?.[at.x] !== ".") {
        problems.push(`${where} at (${at.x}, ${at.y}) stands on a blocked tile`);
      }
      // Two figures cannot share a tile (grid.ts), and a duplicate spawn would
      // only fail once a fight had that many bodies in it — which is to say on
      // the map with four enemies and not on the one with two.
      const key = `${at.x},${at.y}`;
      if (seen.has(key)) problems.push(`${where} at (${at.x}, ${at.y}) repeats an earlier spawn`);
      seen.add(key);
    }
  }
  return problems;
}

function checkChapter(chapter: Chapter, label: string): string[] {
  const problems: string[] = [];
  if (typeof chapter.id !== "string" || chapter.id === "") {
    problems.push(`${label}: missing id`);
  }
  if (!chapter.scenes || typeof chapter.scenes !== "object") {
    problems.push(`${label}: missing scenes`);
    return problems;
  }
  if (typeof chapter.entry !== "string" || !chapter.scenes[chapter.entry]) {
    problems.push(`${label}: entry scene "${String(chapter.entry)}" is not in scenes`);
  }
  for (const [sceneId, scene] of Object.entries(chapter.scenes)) {
    for (const target of gotoTargets(scene)) {
      if (!chapter.scenes[target]) {
        problems.push(`${label}: scene "${sceneId}" goes to unknown scene "${target}"`);
      }
    }
  }
  return problems;
}

/** Every scene id this scene can hand control to. */
function gotoTargets(scene: Scene): SceneId[] {
  switch (scene.type) {
    case "story":
    case "choice_point":
    case "rest":
      return scene.choices.map((c) => c.goto);
    case "check":
      return [scene.onSuccess.goto, scene.onFailure.goto];
    case "encounter":
      return [scene.onVictory.goto, scene.onDefeat.goto];
  }
}
