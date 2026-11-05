/**
 * The crew's camp record and each hero's kit (docs/camp.md §9, §12): their
 * empty shapes, the read-path migration both stores run (architecture §3.2),
 * and the pure rules every writer shares: how the frame grows, how milestone
 * kit pieces are granted, and what the run state may show.
 *
 * Storage and the conditional writes are the server's (`handlers/camp.ts`);
 * nothing here reads or writes a store.
 */

import { CLASS_RANKS, TIER_IDS } from "./types/domain.js";
import type { Character, ClassId, ClassRank, TierId } from "./types/domain.js";
import type {
  CampFriend,
  CampReceipt,
  CampReceipts,
  CampRecord,
  CampView,
  FrameStage,
  HeroKit,
  KitPieceId,
  KitUnlock,
  LuckyDropReceipt,
  OwnedCampPiece,
} from "./types/camp.js";

/** Bump together with a new step in `CAMP_STEPS`; a bump without a step throws on read. */
export const CAMP_VERSION = 1;
/** Bump together with a new step in `KIT_STEPS`. */
export const KIT_VERSION = 1;

/** The grand camp (§4.1). Finished campaigns past it are trophies. */
export const MAX_FRAME_STAGE: FrameStage = 4;
/** The chapter-end shop opens once the crew has been paid for this many chapters (§5.3). */
export const SHOP_OPENS_AT = 2;
/** At most this many lucky drops in one chapter (§5.2). */
export const LUCKY_DROPS_PER_CHAPTER = 2;
/** Personal decoration slots a new kit has (§4.5: two or three). */
export const KIT_SLOTS = 2;

/**
 * The kit pieces a hero's own milestones unlock (§5.4): a tent style per
 * appearance tier reached, a decoration per class distinction earned.
 *
 * **Placeholder ids** until the kit catalog exists (`content/camp.json`, #618),
 * which will own them; that issue replaces this constant with the catalog's
 * lookup and keeps these ids or migrates them. Only tiers whose art is painted
 * are listed (spec §8.1 draws Ascendant and above as Mythic until it is): a
 * tier added here later is granted to every hero who holds it at their next
 * kit read (`readKit`), so nobody misses one for being early.
 */
export const MILESTONE_KIT_PIECES: {
  tiers: Partial<Record<TierId, KitPieceId>>;
  distinctions: Record<ClassId, Record<Exclude<ClassRank, "none">, KitPieceId>>;
} = {
  tiers: {
    sworn: "kit_tent_sworn",
    radiant: "kit_tent_radiant",
    mythic: "kit_tent_mythic",
  },
  distinctions: {
    thornguard: { apprentice: "kit_deco_thornguard_apprentice", expert: "kit_deco_thornguard_expert", master: "kit_deco_thornguard_master" },
    duskrunner: { apprentice: "kit_deco_duskrunner_apprentice", expert: "kit_deco_duskrunner_expert", master: "kit_deco_duskrunner_master" },
    starweaver: { apprentice: "kit_deco_starweaver_apprentice", expert: "kit_deco_starweaver_expert", master: "kit_deco_starweaver_master" },
    songkeeper: { apprentice: "kit_deco_songkeeper_apprentice", expert: "kit_deco_songkeeper_expert", master: "kit_deco_songkeeper_master" },
  },
};

export class StoredCampError extends Error {
  override name = "StoredCampError";
}

// ---------------------------------------------------------------------------
// Empty shapes
// ---------------------------------------------------------------------------

/** A crew's camp before anything is written: stage 1, no Dash Cash, nothing owned. */
export function emptyCamp(): CampRecord {
  return {
    v: CAMP_VERSION,
    revision: 0,
    frameStage: 1,
    grownBy: [],
    dashCash: 0,
    owned: {},
    placed: {},
    friends: {},
    buddies: {},
    paidChapterCount: 0,
    receipts: { rewards: {}, chapters: {}, drops: {} },
  };
}

/** A hero's kit before her kid has chosen anything (§5.3). */
export function emptyKit(): HeroKit {
  return {
    v: KIT_VERSION,
    revision: 0,
    style: null,
    color: null,
    slots: Array.from({ length: KIT_SLOTS }, () => null),
    unlocked: {},
  };
}

// ---------------------------------------------------------------------------
// The frame (§4.1, §12.3)
// ---------------------------------------------------------------------------

/** The frame a crew with `grown` finished `growsCamp` campaigns stands at. */
export function frameStageFor(grown: number): FrameStage {
  return Math.min(MAX_FRAME_STAGE, 1 + Math.max(0, Math.floor(grown))) as FrameStage;
}

/**
 * The camp with each of `finished` counted once (§12.3): ids it has already
 * are skipped, so a replayed campaign never grows it again, and the frame
 * stops at stage 4. Only ever adds: a failed or abandoned attempt is simply
 * not in `finished`, and nothing is taken away. Returns `camp` itself when
 * nothing is new, so a caller can tell a no-op.
 */
export function growCamp(camp: CampRecord, finished: Iterable<string>): CampRecord {
  const fresh = [...new Set(finished)].filter((id) => !camp.grownBy.includes(id));
  if (fresh.length === 0 && camp.frameStage === frameStageFor(camp.grownBy.length)) return camp;
  const grownBy = [...camp.grownBy, ...fresh];
  return { ...camp, grownBy, frameStage: frameStageFor(grownBy.length) };
}

/** A lucky drop's receipt key (§12.2): the run and the scene that dropped it. */
export function dropKey(runId: string, sceneId: string): string {
  return `${runId}#${sceneId}`;
}

/** `RunState.camp`: the slim, read-only projection the screens get (§9). */
export function campView(camp: CampRecord): CampView {
  return {
    revision: camp.revision,
    frameStage: camp.frameStage,
    grownBy: [...camp.grownBy],
    dashCash: camp.dashCash,
    owned: Object.keys(camp.owned).sort(),
    placed: { ...camp.placed },
    friends: Object.keys(camp.friends).sort(),
    buddies: { ...camp.buddies },
    shopOpen: camp.paidChapterCount >= SHOP_OPENS_AT,
  };
}

// ---------------------------------------------------------------------------
// Milestone kit pieces (§5.4)
// ---------------------------------------------------------------------------

/**
 * Every milestone piece a hero's progress has earned: each painted tier up to
 * the one she is at, and each class distinction up to the rank she holds.
 * Read off both halves, because a milestone is the hero's own deed and is kept
 * even if a failed campaign later puts the tier back (§5.4): the provisional
 * half is where a tier reached mid-campaign first shows.
 *
 * Tolerant of the raw stored shape, since the character ladder's backfill step
 * calls it on a row as it was stored.
 */
export function milestonePieces(character: Pick<Character, "committed" | "provisional">): KitPieceId[] {
  const out = new Set<KitPieceId>();
  for (const half of [character.committed, character.provisional]) {
    if (!half || typeof half !== "object") continue;
    const reached = TIER_IDS.indexOf(half.tier);
    for (const [i, tier] of TIER_IDS.entries()) {
      const piece = MILESTONE_KIT_PIECES.tiers[tier];
      if (piece && i <= reached) out.add(piece);
    }
    const mastery = (half.mastery ?? {}) as Partial<Record<ClassId, { rank?: unknown }>>;
    for (const [classId, entry] of Object.entries(mastery) as [ClassId, { rank?: unknown } | undefined][]) {
      const pieces = MILESTONE_KIT_PIECES.distinctions[classId];
      const held = CLASS_RANKS.indexOf(entry?.rank as ClassRank);
      if (!pieces || held <= 0) continue;
      for (const rank of CLASS_RANKS.slice(1, held + 1) as Exclude<ClassRank, "none">[]) out.add(pieces[rank]);
    }
  }
  return [...out].sort();
}

/**
 * `kit` with every milestone `character` has earned unlocked. `at` is when it
 * landed, when the caller knows (a tier awarded at a chapter's end); absent on
 * a backfill. Never removes anything, never changes `revision`, and returns
 * `kit` itself when nothing is new.
 */
export function withMilestones(
  kit: HeroKit,
  character: Pick<Character, "committed" | "provisional">,
  at?: string,
): HeroKit {
  const fresh = milestonePieces(character).filter((id) => !Object.hasOwn(kit.unlocked, id));
  if (fresh.length === 0) return kit;
  const unlocked = { ...kit.unlocked };
  for (const id of fresh) unlocked[id] = { from: "milestone", ...(at ? { at } : {}) };
  return { ...kit, unlocked };
}

/**
 * A hero's kit as it stands: what is stored, or an empty kit, with every
 * milestone she holds today unlocked. The only way to read `Character.kit`.
 */
export function readKit(character: Pick<Character, "kit" | "committed" | "provisional">): HeroKit {
  return withMilestones(character.kit ?? emptyKit(), character);
}

// ---------------------------------------------------------------------------
// Reading stored rows (architecture §3.2)
// ---------------------------------------------------------------------------

type Step = (raw: Record<string, unknown>) => Record<string, unknown>;

/** One rung per version; v1 is the first, so v0 (a row with no stamp) has nothing to fix. */
const CAMP_STEPS: Record<number, Step> = {
  0: (raw) => raw,
};

const KIT_STEPS: Record<number, Step> = {
  0: (raw) => raw,
};

/** Storage → domain for a camp row. `version` is the envelope's `v`; `undefined` is v0. */
export function migrateCamp(data: unknown, version = 0): CampRecord {
  const raw = ladder("camp", data, version, CAMP_VERSION, CAMP_STEPS);
  return assertCamp(raw);
}

/** Storage → domain for `Character.kit`, which carries its own `v`. */
export function migrateKit(data: unknown): HeroKit {
  const version = isObject(data) && typeof data["v"] === "number" ? data["v"] : 0;
  return assertKit(ladder("kit", data, version, KIT_VERSION, KIT_STEPS));
}

function ladder(
  what: string,
  data: unknown,
  version: number,
  current: number,
  steps: Record<number, Step>,
): Record<string, unknown> {
  if (!isObject(data)) throw new StoredCampError(`${what}: stored row is not an object`);
  if (version > current) {
    // Written by a newer deploy mid-rollout. Refuse rather than misread it.
    throw new StoredCampError(`${what}: stored at v${version}, this build understands up to v${current}`);
  }
  let raw = data;
  for (let v = version; v < current; v++) {
    const step = steps[v];
    if (!step) throw new StoredCampError(`${what}: no migration step from v${v} to v${v + 1}`);
    raw = step(raw);
  }
  return raw;
}

/**
 * Narrows a migrated camp. Missing maps and counters default (our own debt);
 * a wrong type throws, since a camp read wrong could spend Dash Cash it does
 * not have.
 */
function assertCamp(raw: Record<string, unknown>): CampRecord {
  const grownBy = strings(raw["grownBy"] ?? [], "camp.grownBy");
  const receipts = record(raw["receipts"] ?? {}, "camp.receipts");
  return {
    v: CAMP_VERSION,
    revision: count(raw["revision"] ?? 0, "camp.revision"),
    frameStage: frameStageFor(grownBy.length),
    grownBy,
    dashCash: count(raw["dashCash"] ?? 0, "camp.dashCash"),
    owned: entries(raw["owned"], "camp.owned", (e, path): OwnedCampPiece => {
      const from = e["from"];
      if (from !== "found" && from !== "bought" && from !== "kept") throw fail(`${path}.from`, `"found", "bought" or "kept"`);
      return { from, ...optionalString(e, "rewardId"), at: str(e["at"], `${path}.at`) };
    }),
    placed: entries(raw["placed"], "camp.placed", undefined),
    friends: entries(raw["friends"], "camp.friends", (e, path): CampFriend => ({
      rewardId: str(e["rewardId"], `${path}.rewardId`),
      at: str(e["at"], `${path}.at`),
    })),
    buddies: entries(raw["buddies"], "camp.buddies", undefined),
    paidChapterCount: count(raw["paidChapterCount"] ?? 0, "camp.paidChapterCount"),
    receipts: {
      rewards: entries(receipts["rewards"], "camp.receipts.rewards", receipt),
      chapters: entries(receipts["chapters"], "camp.receipts.chapters", receipt),
      drops: entries(receipts["drops"], "camp.receipts.drops", (e, path): LuckyDropReceipt => ({
        ...receipt(e, path),
        chapterId: str(e["chapterId"], `${path}.chapterId`),
      })),
    } satisfies CampReceipts,
  };
}

function assertKit(raw: Record<string, unknown>): HeroKit {
  const slots = raw["slots"] ?? emptyKit().slots;
  if (!Array.isArray(slots)) throw fail("kit.slots", "an array");
  return {
    v: KIT_VERSION,
    revision: count(raw["revision"] ?? 0, "kit.revision"),
    style: nullableString(raw["style"], "kit.style"),
    color: nullableString(raw["color"], "kit.color"),
    slots: slots.map((s, i) => nullableString(s, `kit.slots[${i}]`)),
    unlocked: entries(raw["unlocked"], "kit.unlocked", (e, path): KitUnlock => {
      const from = e["from"];
      if (from !== "catalog" && from !== "found" && from !== "milestone") {
        throw fail(`${path}.from`, `"catalog", "found" or "milestone"`);
      }
      return { from, ...optionalString(e, "rewardId"), ...optionalString(e, "at") };
    }),
  };
}

function receipt(e: Record<string, unknown>, path: string): CampReceipt {
  return { at: str(e["at"], `${path}.at`), ...optionalString(e, "runId") };
}

/**
 * A map of id → value. With `each`, every value is an object narrowed by it;
 * without, every value is a non-empty string.
 */
function entries<T>(
  value: unknown,
  path: string,
  each: ((e: Record<string, unknown>, path: string) => T) | undefined,
): Record<string, T> {
  const raw = record(value ?? {}, path);
  const out: Record<string, T> = {};
  for (const [id, v] of Object.entries(raw)) {
    out[id] = each ? each(record(v, `${path}.${id}`), `${path}.${id}`) : (str(v, `${path}.${id}`) as T);
  }
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isObject(value)) throw fail(path, "an object");
  return value;
}

function count(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw fail(path, "a whole number, 0 or more");
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw fail(path, "a non-empty string");
  return value;
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw fail(path, "an array");
  return value.map((v, i) => str(v, `${path}[${i}]`));
}

function nullableString(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : str(value, path);
}

function optionalString<K extends string>(e: Record<string, unknown>, key: K): { [P in K]?: string } {
  const value = e[key];
  return typeof value === "string" && value.length > 0 ? ({ [key]: value } as { [P in K]?: string }) : {};
}

function fail(path: string, expected: string): StoredCampError {
  return new StoredCampError(`${path} must be ${expected}`);
}
