/**
 * The journal — what a phone can study between games.
 *
 * A player who is not in a room can still open their hero, the household's
 * Field Guide and the atlas, and look at it all without anything being at
 * stake. Everything here is read-only and already belongs to them: their own
 * heroes (the same rule as `listHeroes`), and the household's book.
 *
 * Authorised by the device binding rather than a room session, because there
 * is no room — the entry points resolve the principal and hand it in.
 */

import { resolveCharacter, type Character, type JournalResponse } from "@kad/shared";
import { ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { listHeroes } from "./heroes.ts";
import { viewOf } from "./profile.ts";

export interface JournalInput {
  householdId: string;
  playerId: string;
}

/**
 * How many recent runs to look through for one that got past the lobby. A
 * room opened and abandoned is a run too; a few of those in a row should not
 * lose the map its "you were here", and a long history should not cost a read
 * per run to find it.
 */
const WHEREABOUTS_LOOKBACK = 5;

export async function getJournal(
  input: JournalInput,
  deps: HandlerDeps,
): Promise<HandlerResult<JournalResponse>> {
  const [heroes, book, characters, players, whereabouts] = await Promise.all([
    listHeroes(input, deps),
    deps.repo.getFieldGuide(input.householdId),
    deps.repo.listCharacters(input.householdId),
    deps.repo.listPlayers(input.householdId),
    whereaboutsOf(input.householdId, deps),
  ]);
  if (!heroes.ok) return heroes;
  const finders = findersOf(players, characters, deps);
  const finished = finishedOf(characters.filter((c) => c.ownerPlayerId === input.playerId), deps);
  const me = players.find((p) => p.id === input.playerId);
  const profile = me ? viewOf(input, me, characters, book.entries, deps) : undefined;
  return ok({
    heroes: heroes.value.heroes,
    fieldGuide: book.entries,
    finders,
    whereabouts,
    finished,
    ...(profile ? { profile } : {}),
  });
}

/**
 * Each of her heroes' finished campaigns (#283), from the record on the hero
 * herself, so a campaign finished at a friend's table is here too.
 */
function finishedOf(characters: readonly Character[], deps: HandlerDeps): NonNullable<JournalResponse["finished"]> {
  const out: NonNullable<JournalResponse["finished"]> = {};
  for (const character of characters) {
    const lines = [...(character.finished ?? [])]
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((f) => ({
        campaignId: f.campaignId,
        title: deps.content.campaign(f.campaignId)?.title ?? f.campaignId,
        outcome: f.outcome,
        at: f.at,
      }));
    if (lines.length > 0) out[character.id] = lines;
  }
  return out;
}

/**
 * Who each player is, as a Field Guide credit. In play the credit is the
 * finder's character's name, because the party is who is at the table; here
 * there is no party, so it is the name of the hero that player has taken
 * furthest, and their own name when they have none.
 */
function findersOf(
  players: readonly { id: string; displayName: string }[],
  characters: readonly Character[],
  deps: HandlerDeps,
): Record<string, string> {
  const rules = deps.content.rules();
  const items = deps.content.items();
  const best = new Map<string, { name: string; level: number }>();
  for (const character of characters) {
    const { level } = resolveCharacter(character, rules, items);
    const held = best.get(character.ownerPlayerId);
    if (!held || level > held.level) best.set(character.ownerPlayerId, { name: character.name, level });
  }
  const finders: Record<string, string> = {};
  for (const player of players) finders[player.id] = best.get(player.id)?.name ?? player.displayName;
  return finders;
}

async function whereaboutsOf(
  householdId: string,
  deps: HandlerDeps,
): Promise<JournalResponse["whereabouts"]> {
  const runs = (await deps.repo.listRuns(householdId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, WHEREABOUTS_LOOKBACK);
  for (const run of runs) {
    const state = await deps.repo.getState(run.id);
    if (!state?.chapterId) continue;
    const chapter = deps.content.chapter(state.chapterId);
    if (chapter) return { chapterId: chapter.id, biome: chapter.biome };
  }
  return null;
}
