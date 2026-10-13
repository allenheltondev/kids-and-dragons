/**
 * The heroes a player can bring back to the table (spec §5: a character
 * "persists to the player's profile within the household and can be reused
 * across campaigns").
 *
 * Resolved, because the phone shows them as they are — portrait at their
 * tier, their level — and never builds anything from them: bringing one is a
 * SEAT_CHARACTER naming its id, and the server reloads the row for that.
 *
 * Only the asking player's own, the same rule `doSeatCharacter` enforces; a
 * list that offered a sibling's hero would offer a tap that is then refused.
 */

import { resolveCharacter, type ResolvedCharacter } from "@kad/shared";
import { ok, type HandlerDeps, type HandlerResult } from "./deps.ts";

export interface ListHeroesInput {
  householdId: string;
  playerId: string;
}

export async function listHeroes(
  input: ListHeroesInput,
  deps: HandlerDeps,
): Promise<HandlerResult<{ heroes: ResolvedCharacter[] }>> {
  const rules = deps.content.rules();
  const items = deps.content.items();
  const heroes = (await deps.repo.listCharacters(input.householdId))
    .filter((character) => character.ownerPlayerId === input.playerId)
    .map((character) => resolveCharacter(character, rules, items))
    // The one you have taken furthest first; ties by name so the order holds.
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  return ok({ heroes });
}
