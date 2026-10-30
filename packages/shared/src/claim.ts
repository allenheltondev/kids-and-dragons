/**
 * A hero's claim, as data (#282, architecture §4.5, "One game at a time per
 * hero: the claim"). The claim is `provisional.runId`: the campaign attempt
 * her provisional gains belong to. At home it is the bare campaign id, as it
 * has always been stamped; at a table that is not her home it is
 * `<campaignId>@<tableHouseholdId>`. A crew's adventure (a second group at
 * the same household, architecture §4.5 "Crews") is `<campaignId>~<crew>`
 * before either: the household's first crew is the bare id, so no claim ever
 * stamped before crews changes meaning.
 *
 * Pure, so anything that must refuse a hero held elsewhere (the server's
 * seats and starts, moving a kid home in #251) parses it the same way.
 * Whether the adventure a claim names is still in flight is the server's
 * question (`handlers/claim.ts`, `claimIsLive`), since it reads the attempt.
 */

import type { Character } from "./types/domain.js";

/** Between a campaign and the table playing it, in a visiting table's claim. */
const AT = "@";

/** Between a campaign and the crew playing it, in a crew's claim. */
const CREW = "~";

/**
 * The adventure a crew's run stamps (`claimFor`'s `adventure`): the bare
 * campaign id for the household's first crew, `<campaignId>~<crew>` for any
 * other.
 */
export function adventureKey(campaignId: string, crew?: string | null): string {
  return crew ? `${campaignId}${CREW}${crew}` : campaignId;
}

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
): { campaignId: string; table: string; crew?: string } {
  const at = claim.lastIndexOf(AT);
  const adventure = at < 0 ? claim : claim.slice(0, at);
  const table = at < 0 ? hero.householdId : claim.slice(at + 1);
  const tilde = adventure.indexOf(CREW);
  return tilde < 0
    ? { campaignId: adventure, table }
    : { campaignId: adventure.slice(0, tilde), table, crew: adventure.slice(tilde + 1) };
}

/** The claim a hero's row carries, or null when she is free. */
export function claimOf(hero: Pick<Character, "provisional">): string | null {
  return hero.provisional?.runId ?? null;
}
