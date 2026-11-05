/**
 * The chapter-end shop's vote (docs/camp.md §6.2, §12.4; #619): `CAMP_VOTE`.
 *
 * Resolved here rather than in the engine because it spends the crew's Dash
 * Cash, a store write the engine never sees, the way SWITCH_CLASS writes a
 * hero. Prepared before the run's commit, like a class switch, so the vote,
 * and what it bought, ride one patch:
 *
 *   - **A choice point's vote.** Every seated player votes; a player who has
 *     stepped away and not voted is not waited on (and a vote they cast still
 *     counts), as `doChoose` does. Most votes wins and a tie goes toward the
 *     story turn marker (`tallyVotes`). "Save our Dash Cash" is always an
 *     option and always free.
 *   - **Only what the crew can afford.** The shop shows pieces out of reach
 *     too (`CampShopOption.needs`); a vote for one is refused as ILLEGAL, and
 *     a shop with nothing affordable takes no vote at all, "Save our Dash
 *     Cash" included (`shopVoting`).
 *   - **One visit, one purchase.** A shop belongs to one chapter-end visit
 *     (`CampShopView.visit`); a vote naming another (a shop the table has
 *     left, an earlier chapter's) is refused as stale, and a decided shop
 *     takes no more votes. Leaving the summary drops the shop (engine
 *     `returnToLobby`), so a vote never resumes and nothing is spent.
 *   - **Rechecked, and written with the vote.** On resolution the camp is
 *     re-read and the piece's eligibility, the crew's ownership and its
 *     balance are checked again (`planPurchase`), and the debit and grant are
 *     one camp write conditional on the revision read, which the run's commit
 *     carries (`CommitInput.camp`, #645): the purchase lands with the vote
 *     that decided it and the shop that shows it, or not at all. A resolution
 *     that loses its seq race spends nothing; one that finds the camp moved on
 *     since its read is tried again from a fresh read (`applyAction`). The
 *     piece records the visit that bought it, so a resolution of a visit that
 *     already bought finds it and charges nothing; a second table that spent
 *     first makes this one's check fail on the fresh read, and the offer and
 *     balance are refreshed for the table to vote again, with nothing spent.
 */

import {
  SAVE_DASH_CASH,
  campPieceLabel,
  campVoteWellFormed,
  campView,
  shopEligible,
  shopOffer,
  shopOptionVotable,
  shopPrice,
  shopVoting,
  tallyVotes,
} from "@kad/shared";
import type { CampCatalog, CampPieceId, CampRecord, CampShopView, ClientIntent, RunState } from "@kad/shared";
import type { ActionResponse } from "@kad/shared";
import type { CampWrite, RunRecord } from "../store/repository.ts";
import { mutateCamp, planCamp, type CampDeps } from "./camp.ts";
import { iso } from "./deps.ts";
import { discoveryHousehold } from "./field-guide.ts";

type VoteError = NonNullable<ActionResponse["error"]>;
/** `camp`: the purchase's write, for the run's commit to carry; never made here (#645). */
export type CampVoteResult = { ok: true; state: RunState; camp?: CampWrite } | { ok: false; error: VoteError };

const STALE: VoteError = { code: "STALE_DECISION", message: "That shop has closed. Look again." };

/**
 * One player's vote in the chapter-end shop, and, when it is the vote that
 * decides, the purchase. The state back is the one to commit; an error leaves
 * the run where it was.
 */
export async function prepareCampVote(
  state: RunState,
  intent: Extract<ClientIntent, { type: "CAMP_VOTE" }>,
  playerId: string,
  run: Pick<RunRecord, "id" | "householdId">,
  deps: CampDeps,
): Promise<CampVoteResult> {
  if (!campVoteWellFormed(intent)) {
    return { ok: false, error: { code: "ILLEGAL", message: "malformed CAMP_VOTE: visit or option" } };
  }
  const shop = state.campShop;
  if (state.phase !== "chapter_complete" || !shop || shop.visit !== intent.visit) return { ok: false, error: STALE };
  if (!state.party.some((m) => m.playerId === playerId)) {
    return { ok: false, error: { code: "FORBIDDEN", message: "only a seated player votes in the shop" } };
  }
  if (shop.result) return { ok: false, error: { code: "ILLEGAL", message: "the shop has already been decided" } };
  const option = shop.options.find((o) => o.pieceId === intent.option);
  if (intent.option !== SAVE_DASH_CASH && !option) {
    // An option from an offer since refreshed, or never made.
    return { ok: false, error: STALE };
  }
  if (option && !shopOptionVotable(option)) {
    // Shown for the crew to look forward to, never bought (§6.2).
    return { ok: false, error: { code: "ILLEGAL", message: "the crew cannot afford that yet" } };
  }
  if (!shopVoting(shop)) {
    // Nothing affordable: the shop shows its pieces and starts no vote (§12.4).
    return { ok: false, error: { code: "ILLEGAL", message: "nothing in the shop is affordable, so there is no vote" } };
  }

  const votes = { ...shop.votes, [playerId]: intent.option };
  const outstanding = state.party.filter((m) => votes[m.playerId] === undefined && m.connected);
  if (outstanding.length > 0) return { ok: true, state: withShop(state, { ...shop, votes }) };

  const winner = tallyVotes(state, votes);
  if (winner === SAVE_DASH_CASH) return { ok: true, state: withShop(state, { ...shop, votes, result: { kind: "saved" } }) };

  const catalog = deps.content.campCatalog();
  if (!catalog) return { ok: false, error: { code: "ILLEGAL", message: "there is no shop in this content" } };
  let householdId: string | null;
  try {
    householdId = await discoveryHousehold(run, state, deps);
  } catch (err) {
    console.error(`camp: could not settle run ${run.id}'s household for the shop:`, err);
    householdId = null;
  }
  if (!householdId) return { ok: false, error: { code: "ILLEGAL", message: "this table has no camp to spend from yet" } };

  const bought = await planPurchase(householdId, state.crew, shop.visit, winner, catalog, deps);
  const camp = bought.camp;
  const next: CampShopView =
    bought.kind === "bought"
      ? {
          ...shop,
          votes,
          balance: camp.dashCash,
          result: { kind: "bought", pieceId: bought.pieceId, label: campPieceLabel(bought.pieceId) },
        }
      : // Another table spent first: what is left, at what the crew now has, to vote on again.
        { visit: shop.visit, balance: camp.dashCash, options: shopOffer(catalog, camp), votes: {}, refreshed: true };
  return { ok: true, state: { ...withShop(state, next), camp: campView(camp) }, ...(bought.write ? { camp: bought.write } : {}) };
}

type Purchase =
  | { kind: "bought"; pieceId: CampPieceId; camp: CampRecord }
  | { kind: "refresh"; camp: CampRecord }
  | { kind: "failed" };

interface PurchaseSeen {
  outcome: "bought" | "refresh";
  already: CampPieceId | null;
}

/**
 * The purchase, decided on one camp: debit and grant, once per visit (§12.4).
 * It may run on each fresh read, so it decides only from the camp it is given
 * and records what it decided in `seen`.
 */
function purchase(
  visit: string,
  pieceId: CampPieceId,
  catalog: Pick<CampCatalog, "crewPieces" | "shops">,
  at: string,
  seen: PurchaseSeen,
): (camp: CampRecord) => CampRecord | null {
  return (camp) => {
    // This visit already bought (a retry): it stands, and nothing more is charged.
    seen.already = Object.entries(camp.owned).find(([, o]) => o.from === "bought" && o.visit === visit)?.[0] ?? null;
    if (seen.already !== null) {
      seen.outcome = "bought";
      return null;
    }
    const price = shopPrice(catalog, pieceId);
    if (price === null || price > camp.dashCash || !shopEligible(catalog, camp, pieceId)) {
      seen.outcome = "refresh";
      return null;
    }
    seen.outcome = "bought";
    return {
      ...camp,
      dashCash: camp.dashCash - price,
      owned: { ...camp.owned, [pieceId]: { from: "bought", visit, at } },
    };
  };
}

/**
 * The purchase planned on the camp as it stands, written by nothing here: the
 * debit and grant (`write`, conditional on the revision read) ride the vote's
 * commit (#645). `write` is null when nothing is to be written: the visit had
 * already bought (charged once, whatever is retried), or the crew can no
 * longer have the piece (a refresh). `camp` is the camp as it would stand.
 */
export async function planPurchase(
  householdId: string,
  crew: string | null | undefined,
  visit: string,
  pieceId: CampPieceId,
  catalog: Pick<CampCatalog, "crewPieces" | "shops">,
  deps: CampDeps,
): Promise<Exclude<Purchase, { kind: "failed" }> & { write: CampWrite | null }> {
  const seen: PurchaseSeen = { outcome: "refresh", already: null };
  const plan = await planCamp(householdId, crew, purchase(visit, pieceId, catalog, iso(deps.now()), seen), deps);
  // No revision is named, so a plan is never stale.
  if (!plan.ok) throw new Error(`camp: a purchase plan for ${householdId} was refused as stale`);
  return seen.outcome === "bought"
    ? { kind: "bought", pieceId: seen.already ?? pieceId, camp: plan.value, write: plan.write }
    : { kind: "refresh", camp: plan.value, write: null };
}

/**
 * Debit and grant in one conditional write of its own, at once, once per
 * visit (§12.4): `planPurchase`'s decision, retried on a lost race. A vote at
 * the table never calls this (its purchase rides its commit, `planPurchase`);
 * it is the purchase rule under concurrency on its own (camp-shop.test.ts).
 */
export async function buyPiece(
  householdId: string,
  crew: string | null | undefined,
  visit: string,
  pieceId: CampPieceId,
  catalog: Pick<CampCatalog, "crewPieces" | "shops">,
  deps: CampDeps,
): Promise<Purchase> {
  const seen: PurchaseSeen = { outcome: "refresh", already: null };
  const written = await mutateCamp(householdId, crew, purchase(visit, pieceId, catalog, iso(deps.now()), seen), deps);
  if (!written.ok) {
    console.error(`camp: a purchase of ${pieceId} for ${householdId} was not written (${written.reason})`);
    return written.value ? { kind: "refresh", camp: written.value } : { kind: "failed" };
  }
  return seen.outcome === "bought"
    ? { kind: "bought", pieceId: seen.already ?? pieceId, camp: written.value }
    : { kind: "refresh", camp: written.value };
}

function withShop(state: RunState, shop: CampShopView): RunState {
  return { ...state, campShop: shop };
}
