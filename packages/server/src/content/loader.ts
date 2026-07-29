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
}

class LoadedContent implements ContentStore {
  constructor(
    readonly root: string,
    private readonly _rules: RulesContent,
    private readonly _items: ItemCatalog,
    private readonly _chapters: ReadonlyMap<string, Chapter>,
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

  if (rules) problems.push(...checkRules(rules));
  if (items) problems.push(...checkItems(items));

  if (!rules || !items || problems.length > 0) {
    throw new ContentError(root, problems);
  }
  return new LoadedContent(root, rules, items, chapters);
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
