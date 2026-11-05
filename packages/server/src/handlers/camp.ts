/**
 * The crew's camp and each hero's kit, on the server (docs/camp.md §9, §12):
 * reading them, changing them safely, and claiming a reward once. The storage
 * under everything the camp does (#618 to #620); the gameplay is elsewhere:
 * finds in camp-finds.ts, Dash Cash in camp-pay.ts, the shop in camp-shop.ts.
 *
 * **Outside the commitment rule.** Nothing here is a provisional gain: a camp
 * is its own row, and a kit rides on the hero beside `committed` and
 * `provisional`, never inside either. `failCampaign()` and `commitCampaign()`
 * (character.ts) spread the hero they are given, so a kit survives both
 * untouched, and neither ever reads a camp.
 *
 * **Safe writes.** Two rooms can reach one crew (architecture §4.5, "Crews"),
 * and a book and a table can reach one hero (§7). So every write is
 * conditional on what was read: a camp on its `revision` (`CampWrite`), a kit
 * on its hero's row version and claim (`writeCharacter`). A lost race re-reads
 * and applies the change again to what is there now; it never overwrites. A
 * caller acting on what a screen showed names the revision it showed
 * (`expectedRevision`), and once the record has moved on, that change is
 * refused as stale rather than applied to something nobody saw.
 *
 * **Migration** (§12.3) is on read, as every permanent record's is
 * (architecture §3.2), and so idempotent by construction:
 *
 *   - a crew with no camp row reads as an empty stage-1 camp with no Dash Cash
 *     (no back-pay), and every camp, stored or not, reads with each
 *     `growsCamp` campaign the crew has finished counted once (`growCamp`);
 *     the next write stores what was read;
 *   - a hero reads with the milestone kit pieces for the tiers and
 *     distinctions she holds (`readKit`; the character ladder's v8 → v9 step
 *     puts them on the row, so her next write keeps them).
 */

import {
  campView,
  emptyCamp,
  growCamp,
  KIT_VERSION,
  LUCKY_DROPS_PER_CHAPTER,
  readKit,
  dropKey,
} from "@kad/shared";
import type { CampRecord, CampView, Character, HeroKit, RewardId } from "@kad/shared";
import type { ContentStore } from "../content/loader.ts";
import type { CampaignProgressRecord } from "../store/repository.ts";
import { rewrite } from "./claim.ts";
import { iso, type HandlerDeps } from "./deps.ts";
import { hasCompleted } from "./progression.ts";

export { readKit };

/** What reading and writing a camp needs: the store, the campaigns (which grow it), the clock. */
export type CampDeps = Pick<HandlerDeps, "repo" | "content" | "now">;

/**
 * Lost races a write retries before giving up. Each retry re-reads, so this
 * only runs out when the record is changing faster than a write can land,
 * which no table does.
 */
export const CAMP_WRITE_ATTEMPTS = 5;

/**
 * What a change did. `stale`: the caller named a revision the record has
 * since left. `conflict`: every attempt lost its race. `missing`: no such hero.
 * Nothing was written in any of those.
 */
export type CampWriteResult<T> =
  | { ok: true; value: T; changed: boolean }
  | { ok: false; reason: "stale" | "conflict" | "missing"; value?: T };

export interface WriteOptions {
  /** The revision the caller's screen showed; a record that has moved on refuses the change. */
  expectedRevision?: number;
}

// ---------------------------------------------------------------------------
// The crew's camp
// ---------------------------------------------------------------------------

/**
 * One crew's camp: `crew` names one of the household's other crews, and
 * absent (or null) is its first, which has no id. Never null: a crew nothing
 * has been written for yet reads as its derived camp.
 */
export async function readCamp(householdId: string, crew: string | null | undefined, deps: CampDeps): Promise<CampRecord> {
  return (await readStanding(householdId, crew ?? undefined, deps)).camp;
}

/** The camp as `RunState.camp` shows it, or null when the store cannot say: a failed read costs the lobby its camp, never the room. */
export async function readCampView(
  householdId: string,
  crew: string | null | undefined,
  deps: CampDeps,
): Promise<CampView | null> {
  try {
    return campView(await readCamp(householdId, crew, deps));
  } catch (err) {
    console.error(`camp: could not read ${householdId}'s camp${crew ? ` for ${crew}` : ""}:`, err);
    return null;
  }
}

/**
 * Change one crew's camp. `fn` gets a copy of the camp as it stands and
 * returns it as it should be, or null for "nothing to do" (no write). It may
 * run more than once, on fresher reads, so it must be a pure function of the
 * camp it is given: everything it decides from (an owned piece, a balance, a
 * receipt) is on that camp. The store sets `revision`.
 */
export async function mutateCamp(
  householdId: string,
  crew: string | null | undefined,
  fn: (camp: CampRecord) => CampRecord | null,
  deps: CampDeps,
  options: WriteOptions = {},
): Promise<CampWriteResult<CampRecord>> {
  const crewId = crew ?? undefined;
  let last: CampRecord | undefined;
  for (let attempt = 0; attempt < CAMP_WRITE_ATTEMPTS; attempt++) {
    const { camp, stored } = await readStanding(householdId, crewId, deps);
    last = camp;
    if (options.expectedRevision !== undefined && camp.revision !== options.expectedRevision) {
      return { ok: false, reason: "stale", value: camp };
    }
    const next = fn(structuredClone(camp));
    if (next === null) return { ok: true, value: camp, changed: false };
    const expectedRevision = stored ? stored.revision : null;
    const written = await deps.repo.putCamp({
      householdId,
      ...(crewId ? { crew: crewId } : {}),
      camp: next,
      expectedRevision,
    });
    if (written) return { ok: true, value: { ...next, revision: (expectedRevision ?? 0) + 1 }, changed: true };
  }
  return { ok: false, reason: "conflict", ...(last ? { value: last } : {}) };
}

/** A receipt the crew may hold once (§12.2). */
export type CampClaim =
  /** A find or friend offer, by its stable `rewardId`, shared by every route into the place. */
  | { kind: "reward"; rewardId: RewardId; runId?: string }
  /** A chapter's completion pay (§5.2), once per crew per chapter. */
  | { kind: "chapter"; chapterId: string; runId?: string }
  /** A lucky drop (§5.2), keyed by the run and the scene that dropped it. */
  | { kind: "drop"; runId: string; sceneId: string; chapterId: string };

/**
 * Why a claim gave nothing: already `claimed`, a lucky drop in a chapter
 * already `paid`, or one past the chapter's `cap` (§5.2).
 */
export type ClaimRefusal = "claimed" | "paid" | "cap";

export interface ClaimOutcome {
  /** True when this call applied the reward and wrote its receipt. */
  claimed: boolean;
  refused?: ClaimRefusal;
  camp: CampRecord;
}

/**
 * Apply a reward and write its receipt in the same conditional write, once.
 * A second claim of the same receipt, whether a retry, a replay, a reconnect,
 * another route into the same place or a second room racing this one, finds
 * the receipt on the camp it re-read and applies nothing (§12.2).
 *
 * `apply` changes the camp for the reward (a piece owned, a friend, Dash
 * Cash); the receipt is added after it. Like `mutateCamp`'s `fn`, it may run
 * more than once and must be pure.
 */
export async function claimReceipt(
  householdId: string,
  crew: string | null | undefined,
  claim: CampClaim,
  apply: (camp: CampRecord) => CampRecord,
  deps: CampDeps,
  options: WriteOptions = {},
): Promise<CampWriteResult<ClaimOutcome>> {
  const at = iso(deps.now());
  let refused: ClaimRefusal | undefined;
  const result = await mutateCamp(
    householdId,
    crew,
    (camp) => {
      refused = claimRefusal(camp, claim);
      return refused ? null : withClaimReceipt(apply(camp), claim, at);
    },
    deps,
    options,
  );
  if (!result.ok) {
    return { ok: false, reason: result.reason, ...(result.value ? { value: { claimed: false, camp: result.value } } : {}) };
  }
  return {
    ok: true,
    changed: result.changed,
    value: { claimed: result.changed, ...(refused ? { refused } : {}), camp: result.value },
  };
}

/** Claim a find or friend offer once (§12.2): `claimReceipt` for a `rewardId`. */
export function claimReward(
  householdId: string,
  crew: string | null | undefined,
  rewardId: RewardId,
  apply: (camp: CampRecord) => CampRecord,
  deps: CampDeps,
  options: WriteOptions & { runId?: string } = {},
): Promise<CampWriteResult<ClaimOutcome>> {
  const { runId, ...rest } = options;
  return claimReceipt(householdId, crew, { kind: "reward", rewardId, ...(runId ? { runId } : {}) }, apply, deps, rest);
}

/**
 * Pay a chapter's completion once per crew (§5.2): its receipt, one more
 * `paidChapterCount`, and its lucky-drop receipts pruned, since a paid chapter
 * drops nothing more. `apply` adds the Dash Cash.
 */
export function payChapter(
  householdId: string,
  crew: string | null | undefined,
  chapterId: string,
  apply: (camp: CampRecord) => CampRecord,
  deps: CampDeps,
  options: WriteOptions & { runId?: string } = {},
): Promise<CampWriteResult<ClaimOutcome>> {
  const { runId, ...rest } = options;
  return claimReceipt(householdId, crew, { kind: "chapter", chapterId, ...(runId ? { runId } : {}) }, apply, deps, rest);
}

/**
 * Pay a lucky drop once (§5.2, §12.2): never in a chapter already paid, at
 * most `LUCKY_DROPS_PER_CHAPTER` in one, and once per run and scene. The roll
 * is the caller's (the engine's seeded rng); this only makes it pay once.
 */
export function claimLuckyDrop(
  householdId: string,
  crew: string | null | undefined,
  drop: { runId: string; sceneId: string; chapterId: string },
  apply: (camp: CampRecord) => CampRecord,
  deps: CampDeps,
  options: WriteOptions = {},
): Promise<CampWriteResult<ClaimOutcome>> {
  return claimReceipt(householdId, crew, { kind: "drop", ...drop }, apply, deps, options);
}

/**
 * Why `claim` would give nothing on this camp, or undefined when it would pay.
 * The rule `claimReceipt` writes by; exported so the chapter's end can say
 * what a claim it is about to make will do (camp-pay.ts) by the same rule.
 */
export function claimRefusal(camp: CampRecord, claim: CampClaim): ClaimRefusal | undefined {
  const { rewards, chapters, drops } = camp.receipts;
  switch (claim.kind) {
    case "reward":
      return Object.hasOwn(rewards, claim.rewardId) ? "claimed" : undefined;
    case "chapter":
      return Object.hasOwn(chapters, claim.chapterId) ? "claimed" : undefined;
    case "drop": {
      if (Object.hasOwn(drops, dropKey(claim.runId, claim.sceneId))) return "claimed";
      if (Object.hasOwn(chapters, claim.chapterId)) return "paid";
      const inChapter = Object.values(drops).filter((d) => d.chapterId === claim.chapterId).length;
      return inChapter >= LUCKY_DROPS_PER_CHAPTER ? "cap" : undefined;
    }
  }
}

/** The camp with `claim`'s receipt written (and, for a chapter, its count and pruned drops), as `claimReceipt` writes it. */
export function withClaimReceipt(camp: CampRecord, claim: CampClaim, at: string): CampRecord {
  const receipts = structuredClone(camp.receipts);
  switch (claim.kind) {
    case "reward":
      receipts.rewards[claim.rewardId] = { at, ...(claim.runId ? { runId: claim.runId } : {}) };
      return { ...camp, receipts };
    case "chapter": {
      receipts.chapters[claim.chapterId] = { at, ...(claim.runId ? { runId: claim.runId } : {}) };
      // What keeps the drops bounded (CampReceipts): a paid chapter drops nothing more.
      for (const [key, drop] of Object.entries(receipts.drops)) {
        if (drop.chapterId === claim.chapterId) delete receipts.drops[key];
      }
      return { ...camp, receipts, paidChapterCount: camp.paidChapterCount + 1 };
    }
    case "drop":
      receipts.drops[dropKey(claim.runId, claim.sceneId)] = { at, runId: claim.runId, chapterId: claim.chapterId };
      return { ...camp, receipts };
  }
}

/** The stored row (or none), and the camp it reads as once every finished `growsCamp` campaign is counted. */
async function readStanding(
  householdId: string,
  crew: string | undefined,
  deps: CampDeps,
): Promise<{ stored: CampRecord | null; camp: CampRecord }> {
  const [stored, attempts] = await Promise.all([
    deps.repo.getCamp(householdId, crew),
    deps.repo.listCampaignProgress(householdId, crew),
  ]);
  return { stored, camp: growCamp(stored ?? emptyCamp(), finishedGrowsCamp(attempts, deps.content)) };
}

/**
 * The crew's finished `growsCamp` campaigns (§12.3), in content order so the
 * same attempts always read the same. Finished is `hasCompleted`: an attempt
 * that reached the campaign's end, on any ending, or one an earlier completion
 * of which a replay is carrying (`everCompleted`). A failed or abandoned
 * attempt is not finished, and the Practice Meadow and The Hollow Crown do not
 * say `growsCamp`, so neither grows anything.
 */
export function finishedGrowsCamp(attempts: readonly CampaignProgressRecord[], content: Pick<ContentStore, "campaign" | "campaignIds">): string[] {
  const done = new Set(attempts.filter((a) => hasCompleted(a)).map((a) => a.campaignId));
  const order = content.campaignIds();
  return [...done]
    .filter((id) => content.campaign(id)?.growsCamp === true)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b) || a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Each hero's kit
// ---------------------------------------------------------------------------

/**
 * Change one hero's kit, at her home (`homeHouseholdId`, which a visitor's
 * party member names). `fn` gets a copy of her kit as it stands (`readKit`)
 * and returns it as it should be, or null for no change; like `mutateCamp`'s,
 * it may run more than once. `hero` is her row as read, whose `kit` is what is
 * stored: a milestone write (camp-milestones.ts) asks it whether a piece the
 * read only derived is on the row yet. Written on her row, conditional on the row's
 * version and claim as read, so it can neither undo a run's write to her nor
 * be undone by one; the claim is kept as it was.
 */
export async function mutateKit(
  homeHouseholdId: string,
  characterId: string,
  fn: (kit: HeroKit, hero: Character) => HeroKit | null,
  deps: Pick<HandlerDeps, "repo">,
  options: WriteOptions = {},
): Promise<CampWriteResult<HeroKit>> {
  let last: HeroKit | undefined;
  for (let attempt = 0; attempt < CAMP_WRITE_ATTEMPTS; attempt++) {
    const hero = await deps.repo.getCharacter(homeHouseholdId, characterId);
    if (!hero) return { ok: false, reason: "missing" };
    const kit = readKit(hero);
    last = kit;
    if (options.expectedRevision !== undefined && kit.revision !== options.expectedRevision) {
      return { ok: false, reason: "stale", value: kit };
    }
    const next = fn(structuredClone(kit), hero);
    if (next === null) return { ok: true, value: kit, changed: false };
    const written: HeroKit = { ...next, v: KIT_VERSION, revision: kit.revision + 1 };
    if (await deps.repo.writeCharacter(rewrite(hero, { ...hero, kit: written }))) {
      return { ok: true, value: written, changed: true };
    }
  }
  return { ok: false, reason: "conflict", ...(last ? { value: last } : {}) };
}

// ---------------------------------------------------------------------------
// Deleting (#252)
// ---------------------------------------------------------------------------

/**
 * Take deleted heroes' buddies out of every camp at one table (§9): its first
 * crew's and each other crew's. A camp goes with its household, and a kit with
 * its hero, so this is all a hero's delete leaves to do. Only stored camps are
 * touched, and a race is retried; a table that still cannot be cleaned throws,
 * so the forget job keeps it for the sweep (retention.ts).
 */
export async function forgetBuddies(
  householdId: string,
  heroIds: readonly string[],
  deps: Pick<HandlerDeps, "repo">,
): Promise<void> {
  if (heroIds.length === 0) return;
  const crews: (string | undefined)[] = [undefined, ...(await deps.repo.listCrews(householdId)).map((c) => c.id)];
  for (const crew of crews) {
    let done = false;
    for (let attempt = 0; attempt < CAMP_WRITE_ATTEMPTS && !done; attempt++) {
      const stored = await deps.repo.getCamp(householdId, crew);
      const gone = stored ? heroIds.filter((id) => Object.hasOwn(stored.buddies, id)) : [];
      if (!stored || gone.length === 0) {
        done = true;
        break;
      }
      const buddies = { ...stored.buddies };
      for (const id of gone) delete buddies[id];
      done = await deps.repo.putCamp({
        householdId,
        ...(crew ? { crew } : {}),
        camp: { ...stored, buddies },
        expectedRevision: stored.revision,
      });
    }
    if (!done) throw new Error(`camp: could not take buddies out of ${householdId}'s camp${crew ? ` for ${crew}` : ""}`);
  }
}
