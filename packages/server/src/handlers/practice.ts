/**
 * The practice (#255, architecture §4.5 "The practice"): the server's half.
 *
 * The practice is a campaign file so the content tools judge it, but it is
 * never played as a campaign. Starting it creates no attempt and acquires no
 * hero's claim, so a hero halfway through Gemfall can play it beside a
 * newcomer. Finishing it awards nothing and folds nothing: the chapter's XP
 * is zero, the bag the party walks out with is the bag it walked in with, and
 * the one thing written is `practiced` on each seated hero, so the lobby
 * stops offering it to her.
 */

import { PRACTICE_CAMPAIGN_ID, isNewcomer, memberHome, resolveCharacter } from "@kad/shared";
import type { PartyMember, RunState } from "@kad/shared";
import type { HandlerDeps } from "./deps.ts";
import { rewrite } from "./claim.ts";
import { seatedParty, type ChapterSettlement } from "./progression.ts";
import type { CharacterWrite } from "../store/repository.ts";

/** The practice's chapter, or null in a content set that does not ship it. */
export function practiceChapterId(deps: Pick<HandlerDeps, "content">): string | null {
  return deps.content.campaign(PRACTICE_CAMPAIGN_ID)?.chapters[0] ?? null;
}

/**
 * Why this party may not start the practice, or null when it may: it runs
 * once per hero, so somebody seated has to be new to it.
 */
export function practiceRefusal(party: readonly PartyMember[]): string | null {
  if (party.some((member) => isNewcomer(member.character))) return null;
  return "everybody here has played already, so there is no practice to play";
}

/**
 * A finished practice: every seated hero marked `practiced`, under the
 * version read, and her snapshot re-resolved so the lobby sees it on the same
 * patch. A hero already marked, or whose row is gone, is left alone. No XP,
 * no chapter record and no attempt.
 */
export async function settlePractice(
  state: RunState,
  deps: HandlerDeps,
  householdId: string,
): Promise<ChapterSettlement> {
  const characters: CharacterWrite[] = [];
  const rules = deps.content.rules();
  const items = deps.content.items();
  for (const member of seatedParty(state)) {
    const home = memberHome(member, householdId);
    const row = await deps.repo.getCharacter(home, member.character.id);
    if (!row || row.practiced) continue;
    const next = { ...row, practiced: true as const };
    characters.push(rewrite(row, next));
    // In place, as `transformParty` does: `state` is this action's own result.
    member.character = resolveCharacter(next, rules, items);
  }
  return { characters, awards: [] };
}
