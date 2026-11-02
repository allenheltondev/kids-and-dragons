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

import {
  claimOf,
  parseClaim,
  resolveCharacter,
  type Character,
  type HeroHold,
  type HeroesResponse,
  type RunState,
} from "@kad/shared";
import { claimIsLive, crewNameOf } from "./claim.ts";
import { betweenGames, liveCrewOf, seatedCrews } from "./crew.ts";
import { ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { seatHero } from "./progression.ts";
import { heroSaved } from "./save.ts";

export interface ListHeroesInput {
  householdId: string;
  playerId: string;
  /**
   * The room asking, when there is one: each hero's `held` then says what
   * this room would do with her, by the same rules a seat is decided by.
   */
  runId?: string;
}

export async function listHeroes(
  input: ListHeroesInput,
  deps: HandlerDeps,
): Promise<HandlerResult<HeroesResponse>> {
  const rules = deps.content.rules();
  const items = deps.content.items();
  const own = (await deps.repo.listCharacters(input.householdId)).filter(
    (character) => character.ownerPlayerId === input.playerId,
  );
  const room = input.runId ? await roomOf(input.runId, deps) : null;
  // Where each is saved, if a stopped game holds her (#259), else which
  // adventure does: her own screen says so, so a hero that cannot be seated,
  // or that moves the room, is never a mystery.
  const saved: Record<string, { at?: string }> = {};
  const held: Record<string, HeroHold> = {};
  for (const character of own) {
    const found = await heroSaved(character, deps);
    if (found) saved[character.id] = found.at === null ? {} : { at: found.at };
    const hold = await holdOf(character, room, deps);
    if (hold) held[character.id] = hold;
  }
  const heroes = own
    .map((character) => resolveCharacter(character, rules, items))
    // The one you have taken furthest first; ties by name so the order holds.
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  return ok({
    heroes,
    ...(Object.keys(saved).length > 0 ? { saved } : {}),
    ...(Object.keys(held).length > 0 ? { held } : {}),
  });
}

interface Room {
  state: RunState;
  /** The table's household, which may not be the player's (a visitor). */
  householdId: string;
}

async function roomOf(runId: string, deps: HandlerDeps): Promise<Room | null> {
  try {
    const [run, state] = await Promise.all([deps.repo.getRun(runId), deps.repo.getState(runId)]);
    return run && state ? { state, householdId: run.householdId } : null;
  } catch (err) {
    // The list still answers without the room; it just cannot say what the room would do.
    console.error(`heroes: could not read run ${runId}:`, err);
    return null;
  }
}

/**
 * The adventure holding `hero`, when one is under way, and what `room` would
 * do with her: refuse her (`blocked`, `seatHero`'s own refusal) or move its
 * lobby to her crew (`switches`, `followCrew`'s rule with her seated too).
 */
async function holdOf(hero: Character, room: Room | null, deps: HandlerDeps): Promise<HeroHold | null> {
  const claim = claimOf(hero);
  if (claim === null || !(await claimIsLive(claim, hero, deps))) return null;
  const { campaignId, table, crew } = parseClaim(claim, hero);
  const hold: HeroHold = { campaign: deps.content.campaign(campaignId)?.title ?? "another adventure" };
  const here = room?.householdId ?? hero.householdId;
  if (table !== here) {
    hold.at = (await deps.repo.getHousehold(table))?.displayName ?? "another table";
  } else if ((crew ?? null) !== (room?.state.crew ?? null)) {
    const name = await crewNameOf(table, crew, deps);
    if (name !== null) hold.crew = name;
  }
  if (!room) return hold;
  const seat = await seatHero(room.state, deps, room.householdId, hero);
  if (!seat.ok) {
    hold.blocked = seat.error.message;
  } else if (hold.crew && betweenGames(room.state) && !room.state.crewSetup) {
    const mine = await liveCrewOf(hero, room.state, room.householdId, deps);
    const crews = await seatedCrews(room.state, room.householdId, deps);
    if (mine !== undefined && crews !== null && [...crews].every((c) => c === mine)) hold.switches = true;
  }
  return hold;
}
