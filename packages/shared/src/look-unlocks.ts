/**
 * Earned looks (docs/hero-looks.md §6; #669): the pure rules for which looks
 * a hero has earned beyond the starters, and for writing their receipts.
 *
 * Looks are earned the ways the camp's things are (docs/camp.md §5.1, §5.4,
 * §12.3):
 *
 *   - **Finds** in chapters, as a content effect (`findLook`): every seated
 *     hero gets her own copy of each look it names that is for her (a coat
 *     only for its species), once per reward (`foundLookGrants`).
 *   - **Milestones**: a tier reached, a class rank held, a campaign finished
 *     (`earnedLooks`, off her own row: `committed`, `provisional` and
 *     `finished`). Backfilled on read (`readEarnedLook`), so a hero who held
 *     one before looks could be earned has it the first time anything reads
 *     her, and written the moment it lands (server look-unlocks.ts), so a
 *     failed campaign that puts her tier back cannot take it away.
 *   - **The camp**: her crew's first friend, one friend by name, and a grand
 *     camp (frame stage 4). A crew's, not a row's, so they are read off the
 *     crew's camp (`LookCampStanding`) and written to each seated hero.
 *
 * Every grant is a receipt on her look (`LookUnlock`): where it came from
 * (`source`, as the book says it), the reward a find came from, and when.
 * Receipts are only ever added (`withLookGrants`): nothing that happens to a
 * run, a lost fight, a setback ending, a replayed chapter, takes one back.
 * Looks are cosmetic: none of this is read by the engine.
 */

import { MAX_FRAME_STAGE } from "./camp-record.js";
import type { MilestoneStanding } from "./camp-record.js";
import { emptyLook } from "./hero-look.js";
import { CLASS_RANKS, TIER_IDS } from "./types/domain.js";
import type { Character, ClassId, ClassRank, SpeciesId, TierId } from "./types/domain.js";
import type { HeroLook, LookCatalog, LookId, LookUnlockNews, LookUnlockRule } from "./types/look.js";

/** Which shelf a look sits on. */
export type LookKind = LookUnlockNews["kind"];

/** One catalog entry, whichever shelf it is on. */
export interface CatalogLookEntry {
  id: LookId;
  kind: LookKind;
  unlock: LookUnlockRule;
  /** A coat's species; absent for a frame or a title, which are every hero's. */
  species?: readonly SpeciesId[];
  /** As a shelf names it: a coat's or a frame's name, a title's words. */
  name: string;
}

/** Every look in the catalog, coats then frames then titles. */
export function catalogLooks(catalog: LookCatalog): CatalogLookEntry[] {
  return [
    ...catalog.coats.map((c) => ({ id: c.id, kind: "coat" as const, unlock: c.unlock, species: c.species, name: c.name })),
    ...catalog.nameplates.map((n) => ({ id: n.id, kind: "nameplate" as const, unlock: n.unlock, name: n.name })),
    ...catalog.titles.map((t) => ({ id: t.id, kind: "title" as const, unlock: t.unlock, name: t.text })),
  ];
}

/** One look in the catalog, or null. */
export function catalogLook(catalog: LookCatalog, id: string): CatalogLookEntry | null {
  return catalogLooks(catalog).find((entry) => entry.id === id) ?? null;
}

/** Whether a look is one a hero of `species` can wear: every frame and title, and a coat of her species. */
export function lookIsFor(entry: Pick<CatalogLookEntry, "species">, species: SpeciesId | undefined): boolean {
  return entry.species === undefined || (species !== undefined && entry.species.includes(species));
}

/** The crew's camp, as far as a camp milestone reads it. */
export interface LookCampStanding {
  friends: readonly string[];
  frameStage: number;
}

/** Everything a milestone is read off. */
export interface LookStanding {
  species?: SpeciesId;
  /** Her progress halves, and what the run shows of her (camp-record.ts `resolvedStanding`). */
  standings: readonly MilestoneStanding[];
  /** The campaigns she has finished, on any ending. */
  finished: readonly string[];
  /** Her crew's camp; absent when the reader has none to hand (camp looks are then not read). */
  camp?: LookCampStanding | null;
}

/** A hero's own standing, off her row: both progress halves, her finished campaigns, and `also`. */
export function heroLookStanding(
  character: Partial<Pick<Character, "species" | "committed" | "provisional" | "finished">>,
  also: readonly MilestoneStanding[] = [],
  camp?: LookCampStanding | null,
): LookStanding {
  return {
    ...(character.species ? { species: character.species } : {}),
    standings: [character.committed, character.provisional, ...also].filter((s): s is NonNullable<typeof s> => Boolean(s)),
    finished: (character.finished ?? []).map((f) => f.campaignId),
    ...(camp ? { camp } : {}),
  };
}

/** How the book names a campaign or a friend in a receipt; ids stand in where it cannot. */
export interface LookNames {
  campaign?: (id: string) => string | undefined;
  friend?: (id: string) => string | undefined;
}

/** A look a milestone has earned: which, why, and as the book says it. */
export interface EarnedLook {
  id: LookId;
  kind: LookKind;
  cause: Exclude<LookUnlockNews["cause"], "found">;
  source: string;
}

const capital = (word: string): string => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;

function reachedTier(standings: readonly MilestoneStanding[]): number {
  let reached = -1;
  for (const s of standings) reached = Math.max(reached, TIER_IDS.indexOf(s.tier as TierId));
  return reached;
}

function heldRank(standings: readonly MilestoneStanding[], classId: ClassId): number {
  let held = 0;
  for (const s of standings) {
    const mastery = (s.mastery ?? {}) as Partial<Record<ClassId, { rank?: unknown }>>;
    held = Math.max(held, CLASS_RANKS.indexOf(mastery[classId]?.rank as ClassRank));
  }
  return held;
}

/** Why a milestone rule is met, or null when it is not (a find or a starter never is). */
function milestoneMet(rule: LookUnlockRule, standing: LookStanding, names: LookNames): Omit<EarnedLook, "id" | "kind"> | null {
  if (rule.from !== "milestone") return null;
  if ("tier" in rule) {
    const at = TIER_IDS.indexOf(rule.tier);
    return at >= 0 && at <= reachedTier(standing.standings) ? { cause: "tier", source: `Reached ${capital(rule.tier)}` } : null;
  }
  if ("classRank" in rule) {
    const want = CLASS_RANKS.indexOf(rule.classRank.rank);
    return want > 0 && heldRank(standing.standings, rule.classRank.class) >= want
      ? { cause: "rank", source: `Became a ${capital(rule.classRank.class)} ${capital(rule.classRank.rank)}` }
      : null;
  }
  if ("campaign" in rule) {
    return standing.finished.includes(rule.campaign)
      ? { cause: "campaign", source: `Finished ${names.campaign?.(rule.campaign) ?? rule.campaign}` }
      : null;
  }
  const camp = standing.camp;
  if (!camp) return null;
  if ("friend" in rule) {
    return camp.friends.includes(rule.friend) ? { cause: "camp", source: `Made friends with ${names.friend?.(rule.friend) ?? rule.friend}` } : null;
  }
  if (rule.camp === "firstFriend") return camp.friends.length > 0 ? { cause: "camp", source: "Her crew's first friend" } : null;
  return camp.frameStage >= MAX_FRAME_STAGE ? { cause: "camp", source: "Her crew's grand camp" } : null;
}

/**
 * Every milestone look `standing` has earned, in catalog order: each whose
 * rule it meets and that is for her (a coat of her species). Camp milestones
 * only when the standing carries a camp.
 */
export function earnedLooks(catalog: LookCatalog, standing: LookStanding, names: LookNames = {}): EarnedLook[] {
  const out: EarnedLook[] = [];
  for (const entry of catalogLooks(catalog)) {
    if (!lookIsFor(entry, standing.species)) continue;
    const met = milestoneMet(entry.unlock, standing, names);
    if (met) out.push({ id: entry.id, kind: entry.kind, ...met });
  }
  return out;
}

/** One receipt to write. */
export interface LookGrant {
  id: LookId;
  from: "found" | "milestone";
  source?: string;
  rewardId?: string;
}

/**
 * `look` with every grant it does not hold yet added as a receipt, at `at`
 * when the caller knows when it landed (absent on a backfill). Only ever
 * adds: a look she already holds keeps its first receipt. Never touches her
 * choices or `revision` (the write bumps it), and returns `look` itself when
 * nothing is new, so a caller can tell a no-op.
 */
export function withLookGrants(look: HeroLook, grants: readonly LookGrant[], at?: string): HeroLook {
  const fresh = grants.filter((g, i) => !Object.hasOwn(look.unlocked, g.id) && grants.findIndex((o) => o.id === g.id) === i);
  if (fresh.length === 0) return look;
  const unlocked = { ...look.unlocked };
  for (const g of fresh) {
    unlocked[g.id] = {
      from: g.from,
      ...(g.rewardId ? { rewardId: g.rewardId } : {}),
      ...(at ? { at } : {}),
      ...(g.source ? { source: g.source } : {}),
    };
  }
  return { ...look, unlocked };
}

/** Milestones as grants. */
export function milestoneGrants(earned: readonly EarnedLook[]): LookGrant[] {
  return earned.map((e) => ({ id: e.id, from: "milestone" as const, source: e.source }));
}

/**
 * What a `findLook` gives one hero: each look it names that is in the catalog,
 * earned by a find, and for her (a coat of her species; every frame and title).
 */
export function foundLookGrants(
  catalog: LookCatalog,
  looks: readonly string[],
  species: SpeciesId | undefined,
  rewardId: string,
  source?: string,
): LookGrant[] {
  const out: LookGrant[] = [];
  for (const id of looks) {
    const entry = catalogLook(catalog, id);
    if (!entry || entry.unlock.from !== "found" || !lookIsFor(entry, species)) continue;
    out.push({ id, from: "found", rewardId, ...(source ? { source } : {}) });
  }
  return out;
}

/**
 * Her look as it stands (§6, camp.md §12.3): what is stored, or an empty
 * look, with every milestone her own row says she holds added as a receipt
 * with no `at` (and the camp's, given one). The backfill on read: the next
 * write of her look stores what was read. Returns her stored look itself when
 * nothing is new; a hero with no stored look and nothing earned reads as
 * `emptyLook()`.
 */
export function readEarnedLook(
  catalog: LookCatalog | null | undefined,
  character: Pick<Character, "look"> & Partial<Pick<Character, "species" | "committed" | "provisional" | "finished">>,
  options: { camp?: LookCampStanding | null; names?: LookNames; also?: readonly MilestoneStanding[] } = {},
): HeroLook {
  const stored = character.look ?? emptyLook();
  if (!catalog) return stored;
  return withLookGrants(stored, milestoneGrants(earnedLooks(catalog, heroLookStanding(character, options.also, options.camp), options.names)));
}

/** Whether a look has anything to show or keep: a choice or a receipt. A look with neither is as good as none. */
export function lookHasAnything(look: HeroLook): boolean {
  return look.coat !== null || look.nameplate !== null || look.title !== null || Object.keys(look.unlocked).length > 0 || look.revision > 0;
}
