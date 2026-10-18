/**
 * A hero's claim, as data (#282, architecture §4.5, "One game at a time per
 * hero: the claim"). The claim is `provisional.runId`: the campaign attempt
 * her provisional gains belong to. At home it is the bare campaign id, as it
 * has always been stamped; at a table that is not her home it is
 * `<campaignId>@<tableHouseholdId>`.
 *
 * Pure, so anything that must refuse a hero held elsewhere (the server's
 * seats and starts, moving a kid home in #251) parses it the same way.
 * Whether the adventure a claim names is still in flight is the server's
 * question (`handlers/claim.ts`, `claimIsLive`), since it reads the attempt.
 */

import type { Character } from "./types/domain.js";

/** Between a campaign and the table playing it, in a visiting table's claim. */
const AT = "@";

/**
 * The claim a table's adventure stamps on a hero. `adventure` is the campaign
 * id; the hero's home is `hero.householdId`.
 */
export function claimFor(adventure: string, tableHouseholdId: string, hero: Pick<Character, "householdId">): string {
  return hero.householdId === tableHouseholdId ? adventure : `${adventure}${AT}${tableHouseholdId}`;
}

/** The adventure a claim names, and the household whose table plays it. */
export function parseClaim(
  claim: string,
  hero: Pick<Character, "householdId">,
): { campaignId: string; table: string } {
  const at = claim.lastIndexOf(AT);
  return at < 0
    ? { campaignId: claim, table: hero.householdId }
    : { campaignId: claim.slice(0, at), table: claim.slice(at + 1) };
}

/** The claim a hero's row carries, or null when she is free. */
export function claimOf(hero: Pick<Character, "provisional">): string | null {
  return hero.provisional?.runId ?? null;
}
