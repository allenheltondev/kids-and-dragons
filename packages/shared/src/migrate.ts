/**
 * Reading a character back out of storage — architecture §3.2.
 *
 * The store hands back `data` from an item envelope and, until this file
 * existed, the repositories cast it straight to `Character`: every field
 * trusted, nothing defaulted, no version. That is why
 * `CharacterProgress.unspentPoints` is optional — a required field would have
 * TypeScript promising a number where an older row returns `undefined`, and
 * `undefined + 1` corrupts a stat block at the first Rest scene.
 *
 * The failure mode is worth naming, because it decides the design: **nothing
 * but our own Lambda ever writes these items.** There is no hostile producer.
 * What breaks is our own schema changes landing on rows written by an older
 * version — a migration problem, not a validation one. So this is a ladder of
 * small steps keyed by version, not a schema validator.
 *
 * Two tiers of failure, deliberately different:
 *
 *   **missing** → default it. Our own debt; the player should never feel it.
 *   **impossible** → throw. A row with no `committed`, or `stats` missing a
 *   stat, cannot be played correctly, and silently wrong numbers at the table
 *   are worse than an error.
 *
 * Hand-written, in the same style and for the same stated reason as
 * `assertRulesContent()` in rules.ts: no schema library in a bundle that ships
 * to a phone.
 */

import { STAT_IDS, TIER_IDS } from "./types/domain.js";
import type {
  Character,
  CharacterProgress,
  InventoryEntry,
  ProvisionalProgress,
  Souvenir,
  Stats,
  TierId,
} from "./types/domain.js";

/**
 * The version this build writes. Bump it and add a step below in the same
 * commit — a bump without a step is a silent no-op migration, which is the one
 * failure this whole mechanism cannot detect.
 */
export const CHARACTER_VERSION = 1;

/** Thrown for a stored row that cannot be repaired into a playable character. */
export class StoredCharacterError extends Error {
  override name = "StoredCharacterError";
}

/**
 * One rung of the ladder: takes a row at version `n` and returns it at `n + 1`.
 *
 * Steps take and return `unknown` on purpose. A step operates on the shape as
 * it was *then*, and typing it against today's `Character` would silently
 * rewrite history every time the current type changes — the exact bug that
 * makes migration ladders rot.
 */
type Step = (raw: Record<string, unknown>) => Record<string, unknown>;

const STEPS: Record<number, Step> = {
  /*
   * v0 → v1. v0 is anything written before this file existed: no `v` on the
   * envelope, and no `unspentPoints`, because levelling did not bank a point
   * until spec §8.1 said it should. Absent means the character never earned
   * one, which for every v0 row is true — nothing was awarding them.
   */
  0: (raw) => {
    const withPoints = (progress: unknown): unknown => {
      if (progress === null || typeof progress !== "object") return progress;
      const p = progress as Record<string, unknown>;
      return { ...p, unspentPoints: typeof p["unspentPoints"] === "number" ? p["unspentPoints"] : 0 };
    };
    return {
      ...raw,
      committed: withPoints(raw["committed"]),
      provisional: withPoints(raw["provisional"]),
    };
  },
};

/**
 * Storage → domain, in one call: run the ladder from whatever the row claims to
 * be, then narrow the result.
 *
 * `version` is the `v` off the item envelope. `undefined` means a row written
 * before versioning, which is v0 — not "unknown, give up". Treating it as v0 is
 * what makes the mechanism retrofittable onto rows nobody stamped.
 */
export function migrateCharacter(data: unknown, version = 0): Character {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new StoredCharacterError(`character: stored row is ${describe(data)}, not an object`);
  }
  if (version > CHARACTER_VERSION) {
    /*
     * A row from the future: written by a newer deploy, read by an older one
     * mid-rollout. Refusing is the safe answer — a forward step we do not have
     * could have moved a field this build would then misread, and a character
     * that loads wrong is worse than one that does not load.
     */
    throw new StoredCharacterError(
      `character: stored at v${version}, this build understands up to v${CHARACTER_VERSION}`,
    );
  }

  let raw = data as Record<string, unknown>;
  for (let v = version; v < CHARACTER_VERSION; v++) {
    const step = STEPS[v];
    if (!step) {
      throw new StoredCharacterError(`character: no migration step from v${v} to v${v + 1}`);
    }
    raw = step(raw);
  }
  return assertCharacter(raw);
}

/** Narrows a fully-migrated row, defaulting what is optional. */
export function assertCharacter(value: unknown): Character {
  const raw = obj(value, "character");
  return {
    id: str(raw["id"], "id"),
    householdId: str(raw["householdId"], "householdId"),
    ownerPlayerId: str(raw["ownerPlayerId"], "ownerPlayerId"),
    name: str(raw["name"], "name"),
    // Species and class are checked as non-empty strings, not against the known
    // sets. A character whose species was retired from content is a content
    // problem, and `getSpecies()` already throws with a better message than
    // anything this layer could produce — failing here would make a rules edit
    // look like data corruption.
    species: str(raw["species"], "species") as Character["species"],
    class: str(raw["class"], "class") as Character["class"],
    appearance: appearance(raw["appearance"]),
    committed: progress(raw["committed"], "committed"),
    provisional: provisional(raw["provisional"]),
    questItems: strings(raw["questItems"] ?? [], "questItems"),
    souvenirs: souvenirs(raw["souvenirs"] ?? []),
    createdAt: str(raw["createdAt"], "createdAt"),
  };
}

function progress(value: unknown, path: string): CharacterProgress {
  const raw = obj(value, path);
  return {
    level: num(raw["level"], `${path}.level`),
    xp: num(raw["xp"], `${path}.xp`),
    stats: stats(raw["stats"], `${path}.stats`),
    tier: tier(raw["tier"], `${path}.tier`),
    unlockedActions: strings(raw["unlockedActions"] ?? [], `${path}.unlockedActions`),
    inventory: inventory(raw["inventory"] ?? [], `${path}.inventory`),
    // Defaulted rather than demanded: the ladder fills this for old rows, and
    // belt-and-braces here costs one `??` against a stat block corrupted by a
    // step that did not run.
    unspentPoints: typeof raw["unspentPoints"] === "number" ? raw["unspentPoints"] : 0,
  };
}

function provisional(value: unknown): ProvisionalProgress | null {
  if (value === null || value === undefined) return null;
  const runId = str(obj(value, "provisional")["runId"], "provisional.runId");
  return { ...progress(value, "provisional"), runId };
}

function stats(value: unknown, path: string): Stats {
  const raw = obj(value, path);
  const out = {} as Stats;
  // Every stat, not just the ones present. A missing stat is impossible rather
  // than merely absent: defaulting one to zero would hand back a character who
  // is quietly worse than the one that was saved, and nobody would notice until
  // a roll came up short weeks later.
  for (const stat of STAT_IDS) out[stat] = num(raw[stat], `${path}.${stat}`);
  return out;
}

function tier(value: unknown, path: string): TierId {
  // Not validated against TIER_IDS as a hard failure — `resolveCharacter()`
  // recomputes tier from level and never trusts the stored value, so a bad one
  // here is cosmetic and already handled. Fall back rather than refuse.
  return TIER_IDS.includes(value as TierId) ? (value as TierId) : (TIER_IDS[0] ?? "fledgling");
}

function inventory(value: unknown, path: string): InventoryEntry[] {
  if (!Array.isArray(value)) fail(path, "an array");
  return value.map((entry, i) => {
    const e = obj(entry, `${path}[${i}]`);
    return {
      itemId: str(e["itemId"], `${path}[${i}].itemId`),
      kind: str(e["kind"], `${path}[${i}].kind`) as InventoryEntry["kind"],
    };
  });
}

function souvenirs(value: unknown): Souvenir[] {
  if (!Array.isArray(value)) fail("souvenirs", "an array");
  return value.map((entry, i) => {
    const s = obj(entry, `souvenirs[${i}]`);
    return {
      id: str(s["id"], `souvenirs[${i}].id`),
      fromRun: typeof s["fromRun"] === "string" ? s["fromRun"] : "",
      earnedAt: typeof s["earnedAt"] === "string" ? s["earnedAt"] : "",
    };
  });
}

function appearance(value: unknown): Character["appearance"] {
  const raw = obj(value, "appearance");
  return {
    ...(raw as Record<string, unknown>),
    palette: str(raw["palette"], "appearance.palette"),
    accent: str(raw["accent"], "appearance.accent"),
  } as Character["appearance"];
}

// --- narrowing helpers, mirroring rules.ts ---------------------------------

function fail(path: string, expected: string): never {
  throw new StoredCharacterError(`character: ${path} must be ${expected}`);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

function obj(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, `an object (got ${describe(value)})`);
  }
  return value as Record<string, unknown>;
}

function num(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, `a finite number (got ${describe(value)})`);
  }
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(path, `a non-empty string (got ${describe(value)})`);
  }
  return value;
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(path, "an array");
  return value.map((v, i) => str(v, `${path}[${i}]`));
}
