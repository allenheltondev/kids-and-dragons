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
 *   - **One visit, one purchase.** A shop belongs to one chapter-end visit
 *     (`CampShopView.visit`); a vote naming another (a shop the table has
 *     left, an earlier chapter's) is refused as stale, and a decided shop
 *     takes no more votes. Leaving the summary drops the shop (engine
 *     `returnToLobby`), so a vote never resumes and nothing is spent.
 *   - **Rechecked and written at once.** On resolution the camp is re-read and
 *     the piece's eligibility, the crew's ownership and its balance are checked
 *     again inside `mutateCamp`, which debits and grants in one write
 *     conditional on the revision it read. The piece records the visit that
 *     bought it, so a retried resolution (a lost seq race, a resent tap) finds
 *     it and charges nothing; a second table that spent first makes this one's
 *     check fail on the fresh read, and the offer and balance are refreshed for
 *     the table to vote again, with nothing spent.
 */

import { SAVE_DASH_CASH, campPieceLabel, campVoteWellFormed, campView, shopEligible, shopOffer, shopPrice, tallyVotes } from "@kad/shared";
import type { CampCatalog, CampPieceId, CampRecord, CampShopView, ClientIntent, RunState } from "@kad/shared";
import type { ActionResponse } from "@kad/shared";
import type { RunRecord } from "../store/repository.ts";
import { mutateCamp, type CampDeps } from "./camp.ts";
import { iso } from "./deps.ts";
import { discoveryHousehold } from "./field-guide.ts";

type VoteError = NonNullable<ActionResponse["error"]>;
export type CampVoteResult = { ok: true; state: RunState } | { ok: false; error: VoteError };

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
  if (intent.option !== SAVE_DASH_CASH && !shop.options.some((o) => o.pieceId === intent.option)) {
    // An option from an offer since refreshed, or never made.
    return { ok: false, error: STALE };
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

  const bought = await buyPiece(householdId, state.crew, shop.visit, winner, catalog, deps);
  if (bought.kind === "failed") {
    return { ok: false, error: { code: "ILLEGAL", message: "The camp could not be reached. Vote again." } };
  }
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
  return { ok: true, state: { ...withShop(state, next), camp: campView(camp) } };
}

type Purchase =
  | { kind: "bought"; pieceId: CampPieceId; camp: CampRecord }
  | { kind: "refresh"; camp: CampRecord }
  | { kind: "failed" };

/**
 * Debit and grant in one conditional write, once per visit (§12.4). `fn`
 * runs on each fresh read, so it decides only from the camp it is given.
 */
export async function buyPiece(
  householdId: string,
  crew: string | null | undefined,
  visit: string,
  pieceId: CampPieceId,
  catalog: Pick<CampCatalog, "crewPieces" | "shops">,
  deps: CampDeps,
): Promise<Purchase> {
  const at = iso(deps.now());
  const seen: { outcome: "bought" | "refresh"; already: CampPieceId | null } = { outcome: "refresh", already: null };
  const written = await mutateCamp(
    householdId,
    crew,
    (camp) => {
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
    },
    deps,
  );
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
