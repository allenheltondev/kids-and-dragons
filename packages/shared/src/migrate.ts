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

import { CLASS_RANKS, STAT_IDS, TIER_IDS } from "./types/domain.js";
import type {
  Character,
  CharacterProgress,
  ClassId,
  ClassMastery,
  ClassRank,
  FinishedCampaign,
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
export const CHARACTER_VERSION = 8;

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
  /*
   * v1 → v2. The hero's claim (#282, architecture §4.5) conditions every write
   * on a monotonic `version`. Rows from before it never had one, and they are
   * version 0: nothing has written them under the claim yet.
   */
  1: (raw) => ({ ...raw, version: typeof raw["version"] === "number" ? raw["version"] : 0 }),
  /*
   * v2 → v3. Her own record of finished campaigns (#283, architecture §4.5).
   * A row from before it has finished nothing on record, and absent says so,
   * so there is nothing to fill. The bump is still load-bearing: a build at
   * v2 drops fields it does not know when it narrows a row, so a v2 Lambda
   * mid-rollout must refuse a v3 row rather than read it and write it back
   * without her record.
   */
  2: (raw) => raw,
  /*
   * v3 → v4. The practice (#255): `practiced` once she has played it. A row
   * from before it has not, and absent says so, so again nothing to fill. The
   * bump is for the same reason as v3's: a v3 build would narrow the flag
   * away and offer her the practice again.
   */
  3: (raw) => raw,
  /*
   * v4 → v5. Class mastery (#308, docs/class-mastery.md §5). The class moves
   * on the phone come from the worn class's rank, not level, and the worn
   * class moves into each half of progress so a failed campaign puts it back.
   *
   * No hero loses a move, and none gains one. Each half's class gets the rank
   * matching the moves that half resolved with at v4, which read two records:
   * the level its XP reached, and the class moves in its `unlockedActions`
   * (what levelling wrote). Whichever shows more wins. The stored `level`
   * beside them is not read, because v4's resolve never read it either.
   *
   * `unlockedActions` goes: class moves are derived now, and a stored list
   * would be a second, stale answer. Only the worn class gets an entry; at v4
   * no hero had worn any other.
   *
   * One deliberate exception to "no hero loses a move": a move of *another*
   * class in `unlockedActions` is dropped, because only the worn class's
   * moves can resolve now. v4's resolve would have kept it, but no writer ever
   * stored one. `newCharacter` wrote the signature and the own class's level
   * unlocks, `awardXp` the own class's unlocks, and class never changed. The
   * only other writer, progression.ts between 7b6d66c5 and 678b7bc9 (one hour
   * on 2026-07-29), stored the resolved list, which was own-class moves and
   * the species combat action, and species still grants that. The
   * Rally-on-every-class shape exists only in old test fixtures
   * (ordered-campaigns.test.ts). migrate.test.ts pins both. A half that already carries its own class was
   * written in this shape by a path that did not stamp `v`, and is left as is.
   */
  4: (raw) => {
    const worn = raw["class"];
    const toV5 = (half: unknown): unknown => {
      if (half === null || typeof half !== "object") return half;
      if (typeof (half as Record<string, unknown>)["class"] === "string") return half;
      const { unlockedActions, ...p } = half as Record<string, unknown>;
      const rank = typeof worn === "string" ? v4Rank(worn, p, unlockedActions) : "none";
      return { ...p, class: worn, mastery: typeof worn === "string" ? { [worn]: { rank, deeds: {} } } : {} };
    };
    const { class: _class, ...rest } = raw;
    return { ...rest, committed: toV5(raw["committed"]), provisional: toV5(raw["provisional"]) };
  },
  /*
   * v5 → v6. The fitting stall (#312, docs/class-mastery.md §1): `fitted` on
   * a progress half once she has spent its one swap. A row from before it has
   * not, and absent says so, so nothing to fill. The bump is v3's and v4's
   * reason again: a v5 build narrows the flag away (`progress` below) and
   * would offer her the swap a second time.
   */
  5: (raw) => raw,
  /*
   * v6 → v7. The paid-chapter ledger (#408): `paidChapters` on a progress
   * half, the chapters that have paid her XP. Nothing to fill, and nothing
   * the row could fill it from: which chapters she played is not on the row,
   * and the table's records do not say who was seated. So an older hero reads
   * as nothing paid yet, and may earn once more a chapter she played before
   * the ledger, but never loses XP she has. The bump is v6's reason: a v6
   * build narrows the ledger away (`progress` below), and its next write would
   * let every chapter pay her again.
   */
  6: (raw) => raw,
  /*
   * v7 → v8. The ladder grows from level 10 to level 30 (spec §8.1, "Beyond
   * level 10"). XP past 6,300 kept accruing at v7 with nothing to spend it on,
   * and `resolveCharacter` derives level from XP, so without this step a hero
   * holding 8,100 XP would load as level 11 having been paid the stat points
   * of level 10, and `awardXp` (which measures levels gained from XP) would
   * never make up the difference.
   *
   * The decision: that XP counts. It was earned, and erasing or capping it
   * would take something from a hero. So each half is brought to the level
   * its XP now reaches, once, and the points the extra levels owed are banked
   * as unspent. Both halves are paid on their own XP: the provisional half
   * has earned more than the committed one, and a failed campaign reverts to
   * the committed half's own account. Tier follows level. A hero whose XP
   * crosses 15, 20 or 30 changes body on her next load with no cutscene,
   * because nothing is being awarded; the cutscene is for XP earned at the
   * table.
   *
   * Idempotent because the version stamp is: a v8 row never runs this again,
   * and a hero already paid for her level has nothing owed. The curves are
   * frozen below, as at v4, rather than read from today's rules.
   */
  7: (raw) => {
    const toV8 = (half: unknown): unknown => {
      if (half === null || typeof half !== "object") return half;
      const p = half as Record<string, unknown>;
      if (typeof p["xp"] !== "number") return half;
      const was = levelAt(V7_LEVEL_XP, p["xp"]);
      const now = levelAt(V8_LEVEL_XP, p["xp"]);
      if (now <= was) return half;
      return {
        ...p,
        level: now,
        tier: V8_TIER_LEVELS.reduce<string>((tier, [id, at]) => (now >= at ? id : tier), "fledgling"),
        unspentPoints: (typeof p["unspentPoints"] === "number" ? p["unspentPoints"] : 0) + (now - was),
      };
    };
    return { ...raw, committed: toV8(raw["committed"]), provisional: toV8(raw["provisional"]) };
  },
};

/**
 * The level curves either side of the v7 → v8 step: `[n]` is the total XP to
 * reach level `n + 2`. v7 stopped at level 10 and v8 runs to 30. Frozen here
 * on purpose; migrate.test.ts holds the v7 curve against the first ten levels
 * of content/rules.json, which a retune must never move.
 */
export const V7_LEVEL_XP: readonly number[] = [100, 300, 700, 1100, 1700, 2600, 3500, 4700, 6300];
export const V8_LEVEL_XP: readonly number[] = [
  ...V7_LEVEL_XP,
  8100, 10100, 12300, 14700, 17300, 20100, 23100, 26300, 29700, 33300, 37100, 41100, 45300, 49700, 54300, 59100,
  64100, 69300, 74700, 80300,
];
const V8_TIER_LEVELS: readonly (readonly [string, number])[] = [
  ["fledgling", 1],
  ["sworn", 4],
  ["radiant", 7],
  ["mythic", 10],
  ["ascendant", 15],
  ["starborn", 20],
  ["legendary", 30],
];

function levelAt(curve: readonly number[], xp: number): number {
  return 1 + curve.filter((at) => xp >= at).length;
}

/**
 * The class ladder as v4 shipped it (content/rules.json then): each class's
 * moves in unlock order (at levels 3, 6 and 9), and the XP that reached
 * those levels. Frozen here on purpose rather than read from today's rules —
 * a step describes the rows as they were *then* — and migrate.test.ts holds
 * it against rules.json so the two cannot drift apart unnoticed.
 */
export const V4_CLASS_LADDER = {
  xp: [300, 1700, 4700],
  moves: {
    thornguard: ["shove", "bramble_wall", "unbreakable"],
    duskrunner: ["vanish", "twin_step", "storm_of_blades"],
    starweaver: ["glimmer", "tanglelight", "starfall"],
    songkeeper: ["soothe", "chorus", "encore"],
  } as Record<string, readonly string[]>,
} as const;

/** The rank one v4 progress half had earned in `classId`; see step 4. */
function v4Rank(classId: string, half: Record<string, unknown>, unlockedActions: unknown): ClassRank {
  const reached = (value: unknown, steps: readonly number[]) =>
    typeof value === "number" ? steps.filter((at) => value >= at).length : 0;
  const moves = V4_CLASS_LADDER.moves[classId] ?? [];
  const held = Array.isArray(unlockedActions)
    ? Math.max(0, ...unlockedActions.map((id) => moves.indexOf(id as string) + 1))
    : 0;
  const count = Math.max(reached(half["xp"], V4_CLASS_LADDER.xp), held);
  return CLASS_RANKS[Math.min(count, CLASS_RANKS.length - 1)] ?? "none";
}

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
    // Species and class (on each half, in `progress` below) are checked as
    // non-empty strings, not against the known sets. A character whose species was retired from content is a content
    // problem, and `getSpecies()` already throws with a better message than
    // anything this layer could produce — failing here would make a rules edit
    // look like data corruption.
    species: str(raw["species"], "species") as Character["species"],
    appearance: appearance(raw["appearance"]),
    committed: progress(raw["committed"], "committed"),
    provisional: provisional(raw["provisional"]),
    questItems: strings(raw["questItems"] ?? [], "questItems"),
    souvenirs: souvenirs(raw["souvenirs"] ?? []),
    // Kept only when present, like `version`: a row that has finished nothing
    // reads back exactly as it was stored.
    ...(raw["finished"] === undefined ? {} : { finished: finished(raw["finished"]) }),
    // The same: only `true` is ever written, and absent means not yet.
    ...(raw["practiced"] === true ? { practiced: true as const } : {}),
    createdAt: str(raw["createdAt"], "createdAt"),
    // Kept only when present, so a row the ladder did not touch reads back as
    // it was stored. Absent reads as 0 wherever it is compared.
    ...(typeof raw["version"] === "number" ? { version: raw["version"] } : {}),
  };
}

function progress(value: unknown, path: string): CharacterProgress {
  const raw = obj(value, path);
  return {
    level: num(raw["level"], `${path}.level`),
    xp: num(raw["xp"], `${path}.xp`),
    stats: stats(raw["stats"], `${path}.stats`),
    tier: tier(raw["tier"], `${path}.tier`),
    class: str(raw["class"], `${path}.class`) as ClassId,
    mastery: mastery(raw["mastery"] ?? {}, `${path}.mastery`),
    inventory: inventory(raw["inventory"] ?? [], `${path}.inventory`),
    // Defaulted rather than demanded: the ladder fills this for old rows, and
    // belt-and-braces here costs one `??` against a stat block corrupted by a
    // step that did not run.
    unspentPoints: typeof raw["unspentPoints"] === "number" ? raw["unspentPoints"] : 0,
    // Only `true` is ever written, and absent means the swap is unspent.
    ...(raw["fitted"] === true ? { fitted: true as const } : {}),
    // Kept only when present, so a hero no chapter has paid reads back as stored.
    ...(raw["paidChapters"] === undefined
      ? {}
      : { paidChapters: strings(raw["paidChapters"], `${path}.paidChapters`) }),
  };
}

function provisional(value: unknown): ProvisionalProgress | null {
  if (value === null || value === undefined) return null;
  const runId = str(obj(value, "provisional")["runId"], "provisional.runId");
  return { ...progress(value, "provisional"), runId };
}

function mastery(value: unknown, path: string): CharacterProgress["mastery"] {
  const raw = obj(value, path);
  const out: Record<string, ClassMastery> = {};
  for (const [classId, entry] of Object.entries(raw)) {
    const e = obj(entry, `${path}.${classId}`);
    const rank = e["rank"];
    // Impossible rather than missing: guessing a rank would hand back a hero
    // with more or fewer moves than they earned.
    if (!CLASS_RANKS.includes(rank as ClassRank)) {
      fail(`${path}.${classId}.rank`, `one of ${CLASS_RANKS.join(", ")}`);
    }
    const deeds = obj(e["deeds"] ?? {}, `${path}.${classId}.deeds`);
    out[classId] = {
      rank: rank as ClassRank,
      deeds: Object.fromEntries(
        Object.entries(deeds).map(([deed, n]) => [deed, num(n, `${path}.${classId}.deeds.${deed}`)]),
      ),
    };
  }
  return out;
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

function finished(value: unknown): FinishedCampaign[] {
  if (!Array.isArray(value)) fail("finished", "an array");
  return value.map((entry, i) => {
    const f = obj(entry, `finished[${i}]`);
    const outcome = f["outcome"];
    if (outcome !== "success" && outcome !== "setback") fail(`finished[${i}].outcome`, `"success" or "setback"`);
    return {
      campaignId: str(f["campaignId"], `finished[${i}].campaignId`),
      outcome,
      at: str(f["at"], `finished[${i}].at`),
      table: str(f["table"], `finished[${i}].table`),
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
