/**
 * Dash Cash during play and at the chapter's end (docs/camp.md §5.2, §5.3,
 * §12.2; #619): lucky drops saved as they land, and the chapter's pay with
 * its tally and its shop.
 *
 * The same shape as the camp's finds (camp-finds.ts), for the same reason:
 * the engine is pure and replayable and a camp is a permanent row outside
 * the run, so the engine only records (`RunState.campLuck`) and this claims
 * after the step's commit, beside the finds:
 *
 *   - **A lucky drop is saved when it lands.** The step that rolled it claims
 *     it (`claimLuckyDrop`), with its receipt (run plus scene), so a retry, a
 *     replay or a reconnect pays nothing again; a chapter already paid for and
 *     one past its cap of 2 (counted across every attempt) are refused there.
 *     Only drops the store accepted ride the broadcast (`campDrops`), so the
 *     TV never sparkles for one that did not pay.
 *   - **The chapter's pay** is 2 for finishing, any ending, and 1 per optional
 *     objective met, snapshotted from the engine's `bonuses` as the chapter
 *     ends (`chapterPay`). Goal steps pay nothing. `payChapter` writes it with
 *     the paid-chapter receipt, so a replay of a paid chapter pays nothing,
 *     objectives missed the first time included. It is outside the commitment
 *     rule: never provisional, kept on a failed campaign.
 *   - **What the summary shows is worked out before the commit** (`prepare`),
 *     so the tally, the balance and the shop ride the patch that shows the
 *     chapter's end; the write is made after it (`settle`), so a step that
 *     loses its seq race pays nothing. Both use the same rule (`claimRefusal`),
 *     so they agree unless another table paid this crew for the same chapter in
 *     between, when the store's receipt wins and this one pays nothing.
 *   - **The sweep.** At the chapter's end every find the chapter recorded is
 *     claimed again (`claimCampFinds`): one whose claim failed when it was
 *     found lands now, and every other finds its receipt and gives nothing.
 *   - **Never fails the turn.** A camp that cannot be read or written is
 *     logged; the story has already happened.
 */

import { CHAPTER_FINISH_PAY, campView, chapterPay, dropKey, shopIsOpen, shopOffer } from "@kad/shared";
import type { CampClaimResult, CampFind, CampRecord, CampShopView, CampTally, CampView, LuckyDrop, RunState } from "@kad/shared";
import type { RunRecord } from "../store/repository.ts";
import { claimLuckyDrop, claimRefusal, payChapter, readCamp, withClaimReceipt, type CampDeps } from "./camp.ts";
import { claimCampFinds } from "./camp-finds.ts";
import { iso } from "./deps.ts";
import { discoveryHousehold } from "./field-guide.ts";

/** One Dash Cash, the drop's whole worth. */
const withDrop = (camp: CampRecord): CampRecord => ({ ...camp, dashCash: camp.dashCash + 1 });

/**
 * The drops `after` rolled that `before` had not, as `stepCampFinds` reads
 * finds: within one chapter the list only grows, and a step that changes
 * chapter rolled nothing.
 */
export function stepCampDrops(before: RunState, after: RunState, chapterStarted: boolean): LuckyDrop[] {
  const rolled = after.campLuck?.drops ?? [];
  if (rolled.length === 0) return [];
  if (chapterStarted) return [...rolled];
  if (before.chapterId !== after.chapterId) return [];
  const had = new Set((before.campLuck?.drops ?? []).map((d) => d.sceneId));
  return rolled.filter((d) => !had.has(d.sceneId));
}

/**
 * Claim the step's lucky drops, once each, and say which paid. The camp is
 * the run's household's and crew's, once that household is settled (a room no
 * phone has claimed yet pays nothing), as for a find.
 */
export async function claimCampDrops(
  drops: readonly LuckyDrop[],
  input: { run: Pick<RunRecord, "id" | "householdId">; state: RunState },
  deps: CampDeps,
): Promise<LuckyDrop[]> {
  const { run, state } = input;
  if (drops.length === 0 || state.chapterId === null) return [];
  const householdId = await settledHousehold(run, state, deps);
  if (!householdId) return [];
  const paid: LuckyDrop[] = [];
  for (const drop of drops) {
    try {
      const claimed = await claimLuckyDrop(
        householdId,
        state.crew,
        { runId: state.runId, sceneId: drop.sceneId, chapterId: state.chapterId },
        withDrop,
        deps,
      );
      if (claimed.ok && claimed.value.claimed) paid.push(drop);
      else if (!claimed.ok) console.error(`camp: lucky drop at ${drop.sceneId} for run ${run.id} was not claimed (${claimed.reason})`);
    } catch (err) {
      console.error(`camp: lucky drop at ${drop.sceneId} for run ${run.id} failed:`, err);
    }
  }
  return paid;
}

/** What the chapter's end owes the crew's camp once its step has committed. */
export interface ChapterEndCamp {
  householdId: string;
  chapterId: string;
  /** The Dash Cash to pay, or null for a chapter this crew was already paid for. */
  pay: number | null;
}

/** What the chapter's summary shows of the camp, and what `settleChapterEndCamp` then writes. */
export interface PreparedChapterEnd {
  view: { camp: CampView; campTally: CampTally; campShop?: CampShopView };
  settle: ChapterEndCamp;
}

/**
 * The chapter's end, as the camp will stand once this step's drops and the
 * chapter's pay land: the tally, the balance, and, once the crew has been paid
 * for two chapters (§5.3), the shop's offer (§12.4). Null when there is no
 * camp to say anything about (an unsettled room, a store that cannot be read):
 * the summary then shows no camp beat at all, and nothing is paid.
 *
 * `objectivesMet` is the engine's snapshot of the optional objectives the
 * party met (`RunState.bonuses`), taken before a replayed chapter's XP line is
 * emptied. `stepDrops` are the drops this very step rolled, claimed after the
 * commit and so not on the camp yet. `visit` names this chapter-end visit.
 */
export async function prepareChapterEndCamp(
  input: {
    run: Pick<RunRecord, "id" | "householdId">;
    state: RunState;
    objectivesMet: number;
    stepDrops: readonly LuckyDrop[];
    visit: string;
  },
  deps: CampDeps,
): Promise<PreparedChapterEnd | null> {
  const { run, state } = input;
  const chapterId = state.chapterId;
  if (chapterId === null) return null;
  const householdId = await settledHousehold(run, state, deps);
  if (!householdId) return null;
  let camp: CampRecord;
  try {
    camp = await readCamp(householdId, state.crew, deps);
  } catch (err) {
    console.error(`camp: could not read ${householdId}'s camp at the end of ${chapterId}:`, err);
    return null;
  }
  const at = iso(deps.now());
  // This step's drops, by the store's own rule, as `claimCampDrops` will claim them.
  for (const drop of input.stepDrops) {
    const claim = { kind: "drop" as const, runId: state.runId, sceneId: drop.sceneId, chapterId };
    if (!claimRefusal(camp, claim)) camp = withClaimReceipt(withDrop(camp), claim, at);
  }
  // Counted before the pay, which prunes the chapter's drop receipts.
  const drops = (state.campLuck?.drops ?? []).filter((d) => Object.hasOwn(camp.receipts.drops, dropKey(state.runId, d.sceneId))).length;
  const replay = claimRefusal(camp, { kind: "chapter", chapterId }) !== undefined;
  const objectives = replay ? 0 : Math.max(0, input.objectivesMet);
  const pay = replay ? null : chapterPay(objectives);
  if (pay !== null) {
    camp = withClaimReceipt({ ...camp, dashCash: camp.dashCash + pay }, { kind: "chapter", chapterId, runId: state.runId }, at);
  }
  const campTally: CampTally = {
    finished: replay ? 0 : CHAPTER_FINISH_PAY,
    objectives,
    drops,
    replay,
    balance: camp.dashCash,
    shopOpen: shopIsOpen(camp),
  };
  const catalog = deps.content.campCatalog();
  const campShop: CampShopView | undefined =
    campTally.shopOpen && catalog
      ? { visit: input.visit, balance: camp.dashCash, options: shopOffer(catalog, camp), votes: {} }
      : undefined;
  return {
    view: { camp: campView(camp), campTally, ...(campShop ? { campShop } : {}) },
    settle: { householdId, chapterId, pay },
  };
}

/**
 * After the chapter's last step has committed: the sweep, then the pay.
 * `stepFinds` were claimed a moment ago by the step itself, so the sweep
 * leaves them alone. Returns what the sweep newly landed, for the broadcast's
 * `campClaims`.
 */
export async function settleChapterEndCamp(
  settle: ChapterEndCamp,
  input: { run: Pick<RunRecord, "id" | "householdId">; state: RunState; stepFinds: readonly CampFind[] },
  deps: CampDeps,
): Promise<CampClaimResult[]> {
  const { run, state } = input;
  const claimedNow = new Set(input.stepFinds.map((f) => f.rewardId));
  const sweep = (state.campFinds ?? []).filter((f) => !claimedNow.has(f.rewardId));
  const swept = (await claimCampFinds(sweep, { run, state }, deps)).filter(
    (r) => r.result !== "none" && (r.result !== "kit" || (r.heroes?.length ?? 0) > 0),
  );
  if (settle.pay !== null) {
    const pay = settle.pay;
    try {
      const paid = await payChapter(
        settle.householdId,
        state.crew,
        settle.chapterId,
        (camp) => ({ ...camp, dashCash: camp.dashCash + pay }),
        deps,
        { runId: state.runId },
      );
      if (!paid.ok) console.error(`camp: ${settle.chapterId} was not paid for run ${run.id} (${paid.reason})`);
      else if (!paid.value.claimed) console.warn(`camp: ${settle.chapterId} had already been paid for this crew; run ${run.id} paid nothing`);
    } catch (err) {
      console.error(`camp: paying ${settle.chapterId} for run ${run.id} failed:`, err);
    }
  }
  return swept;
}

async function settledHousehold(run: Pick<RunRecord, "id" | "householdId">, state: RunState, deps: CampDeps): Promise<string | null> {
  try {
    return await discoveryHousehold(run, state, deps);
  } catch (err) {
    console.error(`camp: could not settle run ${run.id}'s household; its Dash Cash is not claimed:`, err);
    return null;
  }
}
