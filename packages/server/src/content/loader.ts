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
import { EFFECT_VERBS, itemCatalog, MAX_PARTY } from "@kad/shared";
import type {
  AbilityCatalog,
  Campaign,
  Chapter,
  CombatAbility,
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
  /**
   * A campaign by id. `null` for an unknown id — which the campaign-boundary
   * logic treats as "this chapter belongs to no campaign we can see the end
   * of": XP still folds provisionally, and nothing commits. That is the safe
   * failure. Committing on a guess would make gains permanent that a failed
   * campaign was supposed to take back.
   */
  campaign(id: string): Campaign | null;
  /**
   * What every ability *does on the board*, by id — handed to the engine as
   * `EngineContext.abilities`.
   *
   * Separate from `rules()`, which owns the same abilities' names, icons and the
   * sentence a child reads at a Rest scene. The split is the one thing worth
   * knowing about this pair: the words are edited by whoever is writing the
   * game, the mechanics by whoever is balancing it, and they are read at
   * different moments by different code.
   *
   * The catalog is deliberately allowed to be *smaller* than the set of
   * abilities `rules.json` names. `resolveCharacter` tolerates an action with no
   * catalog entry and `legalActions` skips it, so an ability awaiting an effect
   * verb is a card that cannot be tapped rather than a crash — and
   * `content:validate` refuses one that is neither authored nor listed in
   * `$deferred`, so the gap can never be an accident.
   */
  abilities(): AbilityCatalog;
}

class LoadedContent implements ContentStore {
  constructor(
    readonly root: string,
    private readonly _rules: RulesContent,
    private readonly _items: ItemCatalog,
    private readonly _chapters: ReadonlyMap<string, Chapter>,
    private readonly _maps: ReadonlyMap<string, EncounterMap>,
    private readonly _abilities: AbilityCatalog,
    private readonly _campaigns: ReadonlyMap<string, Campaign>,
  ) {}

  campaign(id: string): Campaign | null {
    return this._campaigns.get(id) ?? null;
  }

  abilities(): AbilityCatalog {
    return this._abilities;
  }

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
  // `items.json` is generated (D7) and opens with a `$comment` saying so;
  // `itemCatalog` drops it so nothing downstream sees a string where an
  // ItemDef should be.
  const itemsFile = await readJson<Record<string, unknown>>(
    path.join(root, "items.json"),
    problems,
  );
  const items = itemsFile ? itemCatalog(itemsFile) : null;
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

  // Optional on purpose. A content set with no abilities.json is every class
  // signature reduced to Attack, Help Up and Ready — a duller game, but a
  // playable one, and the loader's job is to refuse content that would *break*
  // at the table rather than content that is thin. `content:validate` is what
  // insists the shipped set is complete.
  const abilities = await readAbilities(path.join(root, "abilities.json"), problems);

  // Campaigns are what makes "the last chapter" a fact the server can know —
  // the commitment rule (spec §8.3) turns on it. Optional like maps/: a
  // content set of one-off chapters is legitimate, and a chapter whose
  // campaign is unknown simply never reaches the campaign boundary.
  const campaigns = new Map<string, Campaign>();
  const campaignsDir = path.join(root, "campaigns");
  let campaignFiles: string[] = [];
  try {
    campaignFiles = (await fs.readdir(campaignsDir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    // No campaigns/ at all is fine.
  }
  for (const file of campaignFiles) {
    const campaign = await readJson<Campaign>(path.join(campaignsDir, file), problems);
    if (!campaign) continue;
    const campaignProblems = checkCampaign(campaign, chapters, `campaigns/${file}`);
    if (campaignProblems.length > 0) {
      problems.push(...campaignProblems);
      continue;
    }
    if (campaigns.has(campaign.id)) {
      problems.push(`campaigns/${file}: duplicate campaign id "${campaign.id}"`);
      continue;
    }
    campaigns.set(campaign.id, campaign);
  }

  if (rules) problems.push(...checkRules(rules));
  if (items) problems.push(...checkItems(items));

  if (!rules || !items || problems.length > 0) {
    throw new ContentError(root, problems);
  }
  return new LoadedContent(root, rules, items, chapters, maps, abilities, campaigns);
}

/**
 * The graph-level campaign rules live in `content:validate`; this holds only
 * what the server would crash or silently mis-decide on: a campaign with no
 * chapters has no last chapter, and a chapter list naming files this load did
 * not produce means "is this the end?" would always answer no.
 */
function checkCampaign(
  campaign: Campaign,
  chapters: ReadonlyMap<string, Chapter>,
  label: string,
): string[] {
  const problems: string[] = [];
  if (typeof campaign.id !== "string" || campaign.id === "") {
    problems.push(`${label}: missing id`);
  }
  if (!Array.isArray(campaign.chapters) || campaign.chapters.length === 0) {
    problems.push(`${label}: a campaign with no chapters has no ending to commit at`);
    return problems;
  }
  for (const chapterId of campaign.chapters) {
    if (!chapters.has(chapterId)) {
      problems.push(`${label}: names chapter "${chapterId}", which did not load`);
    }
  }
  return problems;
}

/**
 * Reads `abilities.json` into the flat catalog the engine wants.
 *
 * The file wraps the catalog in `{ version, abilities, $deferred }` because it
 * carries the deferral list with it — the record of which abilities `rules.json`
 * names that the effect verbs cannot yet express. That list is the validator's
 * business and the engine has no use for it, so it is dropped here rather than
 * threaded through `EngineContext` and ignored at the far end.
 */
async function readAbilities(file: string, problems: string[]): Promise<AbilityCatalog> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return {};
  }
  let parsed: { abilities?: unknown };
  try {
    parsed = JSON.parse(raw) as { abilities?: unknown };
  } catch (err) {
    problems.push(`abilities.json is not valid JSON: ${(err as Error).message}`);
    return {};
  }
  const catalog = parsed.abilities;
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    problems.push('abilities.json: expected an "abilities" object keyed by ability id');
    return {};
  }
  problems.push(...checkAbilities(catalog as Record<string, unknown>));
  return catalog as AbilityCatalog;
}

/**
 * The shape checks worth making at startup.
 *
 * Not the full schema — `content:validate` owns that, and duplicating it here
 * would mean two definitions of a legal ability drifting apart. These are the
 * three that would otherwise surface as something inexplicable *during a fight*:
 * a key that disagrees with the record's own `id` (so `legalActions` offers an
 * ability `performAction` then cannot find), an ability with no effects (a
 * button that consumes a turn and does nothing), and a missing name or icon (a
 * blank tappable square on an eight-year-old's phone, which §7.2 forbids).
 */
function checkAbilities(catalog: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const [id, value] of Object.entries(catalog)) {
    const ability = value as Partial<CombatAbility> | null;
    if (!ability || typeof ability !== "object") {
      problems.push(`abilities.json: "${id}" is not an object`);
      continue;
    }
    if (ability.id !== id) {
      problems.push(`abilities.json: "${id}" carries id "${String(ability.id)}"`);
    }
    if (typeof ability.name !== "string" || ability.name === "") {
      problems.push(`abilities.json: "${id}" has no name`);
    }
    if (typeof ability.icon !== "string" || ability.icon === "") {
      problems.push(`abilities.json: "${id}" has no icon`);
    }
    if (ability.timing !== "action" && ability.timing !== "initiative") {
      problems.push(`abilities.json: "${id}" has an invalid timing (${String(ability.timing)})`);
    }
    if (!ability.target || typeof ability.target !== "object") {
      problems.push(`abilities.json: "${id}" has no target rule`);
    }
    if (!Array.isArray(ability.effects) || ability.effects.length === 0) {
      problems.push(`abilities.json: "${id}" has no effects — it would be a button that does nothing`);
    } else {
      // Every verb must be one the engine implements. An unknown verb used to
      // pass the cast and surface as a TypeError in the middle of somebody's
      // turn; here it is a startup failure with the ability's name on it.
      for (const spec of ability.effects as { effect?: { type?: unknown } }[]) {
        const verb = spec?.effect?.type;
        if (typeof verb !== "string" || !(EFFECT_VERBS as readonly string[]).includes(verb)) {
          problems.push(
            `abilities.json: "${id}" has an effect verb the engine does not implement (${String(verb)})`,
          );
        }
      }
    }
  }
  return problems;
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

  // The engine refuses a fight when the party outnumbers the spawns, so a map
  // that cannot seat a full party is a chapter that works right up until the
  // wrong number of people sit down. Caught here, it is a build failure.
  if (Array.isArray(map.partySpawns) && map.partySpawns.length < MAX_PARTY) {
    problems.push(
      `${label}: ${map.partySpawns.length} partySpawns cannot seat a full party of ${MAX_PARTY}`,
    );
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
    if (!SCENE_TYPES.includes(scene?.type as string)) {
      problems.push(
        `${label}: scene "${sceneId}" has a type the engine does not know (${String(scene?.type)})`,
      );
      continue;
    }
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
    default:
      // An unknown scene type fell out of the switch as `undefined`, and
      // `for (const t of undefined)` threw a raw TypeError out of readAll —
      // bypassing the ContentError message this whole file exists to produce.
      // `checkChapter` reports it by name; returning no edges keeps the walk
      // alive long enough for that report to be the one the author reads.
      return [];
  }
}

const SCENE_TYPES: readonly string[] = ["story", "choice_point", "rest", "check", "encounter"];
