/**
 * Rules helpers — read-only queries over content/rules.json.
 *
 * The *values* live in content (roadmap "content as data"): adding a species or
 * retuning the XP curve must never require a code deploy. Everything here is a
 * pure lookup over a `RulesContent` the caller already loaded.
 *
 * `assertRulesContent()` is the gate between "some JSON" and `RulesContent`. It
 * exists because content is hand-edited: a typo should fail loudly at load with
 * a message that names the field, not silently at the table as `undefined + 1`.
 */

import { STAT_IDS, TIER_IDS } from "./types/domain.js";
import type {
  ClassDef,
  ClassId,
  Difficulty,
  RulesContent,
  SpeciesDef,
  SpeciesId,
  StatId,
  Stats,
  TierId,
} from "./types/domain.js";

const SPECIES_IDS: readonly SpeciesId[] = [
  "unicorn",
  "dragonling",
  "griffin",
  "bigfoot",
  "kitsune",
  "manticore",
];

const CLASS_IDS: readonly ClassId[] = [
  "thornguard",
  "duskrunner",
  "starweaver",
  "songkeeper",
];

const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/**
 * Throws rather than returning undefined: content is schema-validated in CI, so
 * a miss here is a bug in the caller, not a condition to branch on.
 */
export function getSpecies(rules: RulesContent, id: SpeciesId): SpeciesDef {
  const def = rules.species[id] as SpeciesDef | undefined;
  if (!def) throw new Error(`rules: unknown species "${id}"`);
  return def;
}

export function getClass(rules: RulesContent, id: ClassId): ClassDef {
  const def = rules.classes[id] as ClassDef | undefined;
  if (!def) throw new Error(`rules: unknown class "${id}"`);
  return def;
}

/** spec §4.1 — one resolution mechanic, three target numbers. */
export function tnFor(rules: RulesContent, difficulty: Difficulty): number {
  const tn = rules.difficultyTn[difficulty] as number | undefined;
  if (typeof tn !== "number") {
    throw new Error(`rules: no target number for difficulty "${difficulty}"`);
  }
  return tn;
}

/** The highest level this rules content can express. spec §8.1 caps it at 10. */
export function maxLevel(rules: RulesContent): number {
  return rules.levelXp.length + 1;
}

/**
 * `levelXp[n]` is the *total* XP needed to reach level `n + 2`, so a character
 * with 0 XP is level 1 and one that has cleared every threshold is at max.
 */
export function levelForXp(rules: RulesContent, xp: number): number {
  let level = 1;
  for (let i = 0; i < rules.levelXp.length; i++) {
    const threshold = rules.levelXp[i];
    if (threshold === undefined || xp < threshold) break;
    level = i + 2;
  }
  return level;
}

/** spec §8.1 — four of the ten levels are appearance tiers. */
export function tierForLevel(rules: RulesContent, level: number): TierId {
  let tier: TierId = TIER_IDS[0] ?? "fledgling";
  for (const candidate of TIER_IDS) {
    const at = rules.tierLevels[candidate];
    if (typeof at === "number" && level >= at) tier = candidate;
  }
  return tier;
}

/**
 * XP still owed before the next level, or `null` at max level. Null rather than
 * 0 so a progress bar has to decide what "done" looks like instead of rendering
 * a permanently full bar.
 */
export function xpToNextLevel(rules: RulesContent, xp: number): number | null {
  const normalizedXp = Math.max(0, xp);
  const level = levelForXp(rules, normalizedXp);
  const nextThreshold = rules.levelXp[level - 1];
  if (nextThreshold === undefined) return null;
  return nextThreshold - normalizedXp;
}

// ---------------------------------------------------------------------------
// Runtime validation — no external deps, by design (no ajv in the shared bundle)
// ---------------------------------------------------------------------------

function fail(path: string, expected: string, got: unknown): never {
  const actual =
    got === undefined
      ? "undefined"
      : got === null
        ? "null"
        : Array.isArray(got)
          ? "array"
          : typeof got;
  throw new Error(`rules.json: ${path} must be ${expected} (got ${actual})`);
}

function obj(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "an object", value);
  }
  return value as Record<string, unknown>;
}

function num(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "a finite number", value);
  }
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(path, "a non-empty string", value);
  }
  return value;
}

function stats(value: unknown, path: string): Stats {
  const raw = obj(value, path);
  const out = {} as Stats;
  for (const stat of STAT_IDS) {
    out[stat] = num(raw[stat], `${path}.${stat}`);
  }
  return out;
}

function ability(
  value: unknown,
  path: string,
): { id: string; name: string; text: string; icon: string } {
  const raw = obj(value, path);
  return {
    id: str(raw["id"], `${path}.id`),
    name: str(raw["name"], `${path}.name`),
    text: str(raw["text"], `${path}.text`),
    icon: str(raw["icon"], `${path}.icon`),
  };
}

function speciesDef(value: unknown, id: SpeciesId, path: string): SpeciesDef {
  const raw = obj(value, path);
  const passive = obj(raw["passive"], `${path}.passive`);
  const stat = passive["stat"];
  if (stat !== undefined && !STAT_IDS.includes(stat as StatId)) {
    fail(`${path}.passive.stat`, `one of ${STAT_IDS.join(", ")}`, stat);
  }
  const maxHp = passive["maxHp"];
  // A species grants either a stat or extra max HP (spec §4.2, Bigfoot).
  if (stat === undefined && maxHp === undefined) {
    fail(`${path}.passive`, "either a `stat` or a `maxHp` bonus", passive);
  }
  return {
    id,
    name: str(raw["name"], `${path}.name`),
    blurb: str(raw["blurb"], `${path}.blurb`),
    passive: {
      ...(stat === undefined ? {} : { stat: stat as StatId }),
      amount: num(passive["amount"], `${path}.passive.amount`),
      ...(maxHp === undefined
        ? {}
        : { maxHp: num(maxHp, `${path}.passive.maxHp`) }),
      text: str(passive["text"], `${path}.passive.text`),
    },
    worldAbility: ability(raw["worldAbility"], `${path}.worldAbility`),
    combatAction: ability(raw["combatAction"], `${path}.combatAction`),
  };
}

function classDef(value: unknown, id: ClassId, path: string): ClassDef {
  const raw = obj(value, path);
  const stat = raw["stat"];
  if (!STAT_IDS.includes(stat as StatId)) {
    fail(`${path}.stat`, `one of ${STAT_IDS.join(", ")}`, stat);
  }
  const unlocksRaw = obj(raw["unlocks"] ?? {}, `${path}.unlocks`);
  const unlocks: ClassDef["unlocks"] = {};
  for (const [level, entry] of Object.entries(unlocksRaw)) {
    if (!/^\d+$/.test(level)) {
      fail(`${path}.unlocks`, "keyed by level number", level);
    }
    unlocks[level] = ability(entry, `${path}.unlocks.${level}`);
  }
  return {
    id,
    name: str(raw["name"], `${path}.name`),
    stat: stat as StatId,
    role: str(raw["role"], `${path}.role`),
    blurb: str(raw["blurb"], `${path}.blurb`),
    baseSteps: num(raw["baseSteps"], `${path}.baseSteps`),
    signature: ability(raw["signature"], `${path}.signature`),
    unlocks,
  };
}

/**
 * Narrows unknown JSON to `RulesContent` or throws with a field path. Checks
 * shape and the closed key sets (every species, every class, every difficulty,
 * every tier) — a rules file missing one species would otherwise blow up only
 * when someone picks it.
 */
export function assertRulesContent(json: unknown): RulesContent {
  const raw = obj(json, "root");

  const difficultyTnRaw = obj(raw["difficultyTn"], "difficultyTn");
  const difficultyTn = {} as Record<Difficulty, number>;
  for (const d of DIFFICULTIES) {
    difficultyTn[d] = num(difficultyTnRaw[d], `difficultyTn.${d}`);
  }

  const levelXpRaw = raw["levelXp"];
  if (!Array.isArray(levelXpRaw) || levelXpRaw.length === 0) {
    fail("levelXp", "a non-empty array of XP thresholds", levelXpRaw);
  }
  const levelXp = levelXpRaw.map((v, i) => num(v, `levelXp[${i}]`));
  for (let i = 1; i < levelXp.length; i++) {
    const prev = levelXp[i - 1] ?? 0;
    const cur = levelXp[i] ?? 0;
    if (cur <= prev) {
      fail(`levelXp[${i}]`, `greater than levelXp[${i - 1}] (${prev})`, cur);
    }
  }

  const tierLevelsRaw = obj(raw["tierLevels"], "tierLevels");
  const tierLevels = {} as Record<TierId, number>;
  for (const tier of TIER_IDS) {
    tierLevels[tier] = num(tierLevelsRaw[tier], `tierLevels.${tier}`);
  }
  if (tierLevels.fledgling !== 1) {
    fail("tierLevels.fledgling", "1 — every character starts here", tierLevels.fledgling);
  }

  const speciesRaw = obj(raw["species"], "species");
  const species = {} as Record<SpeciesId, SpeciesDef>;
  for (const id of SPECIES_IDS) {
    species[id] = speciesDef(speciesRaw[id], id, `species.${id}`);
  }

  const classesRaw = obj(raw["classes"], "classes");
  const classes = {} as Record<ClassId, ClassDef>;
  for (const id of CLASS_IDS) {
    classes[id] = classDef(classesRaw[id], id, `classes.${id}`);
  }

  return {
    version: num(raw["version"], "version"),
    baseStats: stats(raw["baseStats"], "baseStats"),
    creationPoints: num(raw["creationPoints"], "creationPoints"),
    baseMaxHp: num(raw["baseMaxHp"], "baseMaxHp"),
    baseGuard: num(raw["baseGuard"], "baseGuard"),
    baseSteps: num(raw["baseSteps"], "baseSteps"),
    difficultyTn,
    levelXp,
    tierLevels,
    species,
    classes,
  };
}
