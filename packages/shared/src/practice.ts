/**
 * The practice (#255): a short chapter that teaches by doing, offered in the
 * lobby while any seated hero is new to the game.
 *
 * It is a campaign file (content/campaigns/first-steps.json) so the content
 * tools judge it like any other chapter, but the server never plays it as a
 * campaign: no attempt, no hero claim, no XP, no items, nothing carried. When
 * it ends, every seated hero is marked `practiced` (architecture §4.5, "The
 * practice"). These are the two facts the engine, the server and the lobby
 * share about it.
 */

import type { ResolvedCharacter } from "./types/domain.js";

/** The practice's campaign id. Its one chapter is the campaign's first. */
export const PRACTICE_CAMPAIGN_ID = "first-steps";

/** True for the practice's campaign id, and only for it. */
export function isPracticeCampaign(campaignId: string | null | undefined): boolean {
  return campaignId === PRACTICE_CAMPAIGN_ID;
}

/**
 * A hero who has never played anything: no practice, no campaign under way,
 * no XP and no souvenir from one that failed. The lobby offers the practice
 * while any seated hero is one, and the server refuses it otherwise, so it
 * runs once per hero.
 *
 * A hero who joined a party mid-campaign at its tier floor (spec §8.4) has
 * XP she did not play for, so she reads as a veteran. She is sitting down
 * with people who are already playing, which is the conservative trade.
 */
export function isNewcomer(
  hero: Pick<ResolvedCharacter, "isProvisional" | "xp" | "souvenirs" | "practiced">,
): boolean {
  return hero.practiced !== true && !hero.isProvisional && hero.xp === 0 && hero.souvenirs.length === 0;
}
