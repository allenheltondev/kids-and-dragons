/**
 * Crews: a second group of players at the same household (architecture §4.5,
 * "Crews").
 *
 * A household holds one save per campaign (`CampaignProgressRecord`), which
 * is right for one family at one table and wrong the evening a grown-up sits
 * down at the same TV with different kids: their lobby would offer the
 * family's chapter 4. A crew is another set of saves in the same household.
 * The kids, their heroes and the Field Guide stay the household's, so the
 * grown-up's own phone comes along and makes a new hero, and nobody has to
 * sign in or start a new household for it.
 *
 * The household's first crew has no row and no id: it is the saves as they
 * always were, so no room, save or claim from before crews moves. Every other
 * crew is a `CREW#` row, and its saves are keyed by it (`CAMPAIGN_SK`).
 *
 * Choosing one is a host control, like Lock and Quiet: low stakes and
 * recoverable, since switching only changes which saves this lobby offers and
 * starting a crew only adds an empty one. So it is only between games, in the
 * lobby, before a chapter starts or a save is picked up.
 */

import type { RunState } from "@kad/shared";
import type { CrewRecord } from "../store/repository.ts";
import { newId } from "../ids.ts";
import { fail, iso, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { commitRoomChange, hostedRoom, type HostPrincipal } from "./host.ts";
import { UNDER_WAY } from "./progression.ts";
import { offerCampaigns } from "./room.ts";

/** Enough for every group a household plays with, and a bound on the rows a host can make. */
export const MAX_CREWS = 8;

/** What a new crew is called: no typing on a TV remote, and every name is a kid's. */
export const CREW_NAMES = [
  "The Otter Crew",
  "The Lantern Crew",
  "The Acorn Crew",
  "The Comet Crew",
  "The Puddle Crew",
  "The Kettle Crew",
  "The Thistle Crew",
  "The Pebble Crew",
] as const;

/** The first name no crew of the household has yet. */
export function nextCrewName(taken: readonly string[]): string {
  return CREW_NAMES.find((name) => !taken.includes(name)) ?? `Crew ${taken.length + 2}`;
}

export interface SwitchCrewInput {
  code: string;
  principal: HostPrincipal;
  /**
   * The crew this lobby plays: a crew's id, null for the household's first, or
   * "new" to start a crew with no saves and play it.
   */
  crew: string | null | "new";
}

/**
 * Point the lobby at another of the household's crews, or a brand-new one.
 * One committed change, like every host control, and the lobby is rebuilt in
 * it: the crew's campaigns, its saved game, and votes cast on the old list go.
 */
export async function switchCrew(
  input: SwitchCrewInput,
  deps: HandlerDeps,
): Promise<HandlerResult<{ seq: number; crew: string | null }>> {
  const hosted = await hostedRoom(input.code, input.principal, deps);
  if (!hosted.ok) return hosted;
  const room = hosted.value;
  // A TV's room is nobody's until a phone joins it: there are no crews to choose from.
  if (room.claimable === true) {
    return fail("ILLEGAL", "Let somebody join first, so the game knows whose crews these are.");
  }
  const before = await deps.repo.getState(room.runId);
  if (!before) return fail("NOT_FOUND", `run ${room.runId} has no state`);
  if (!betweenGames(before)) return fail("ILLEGAL", "Change crews before the adventure starts.");

  const run = await deps.repo.getRun(room.runId);
  if (!run) return fail("NOT_FOUND", `no run ${room.runId}`);
  const crews = await deps.repo.listCrews(room.householdId);

  let target: string | null;
  if (input.crew === "new") {
    if (crews.length >= MAX_CREWS) {
      return fail("ILLEGAL", "This game already has as many crews as it can keep.");
    }
    const crew: CrewRecord = {
      householdId: room.householdId,
      id: newId("cw"),
      name: nextCrewName(crews.map((c) => c.name)),
      createdAt: iso(deps.now()),
    };
    await deps.repo.putCrew(crew);
    target = crew.id;
  } else if (input.crew === null) {
    target = null;
  } else {
    if (!crews.some((c) => c.id === input.crew)) return fail("NOT_FOUND", "There is no crew like that in this game.");
    target = input.crew;
  }

  const result = await commitRoomChange(
    room,
    input.principal.playerId,
    async (state) => {
      if (!betweenGames(state)) return null;
      if ((state.crew ?? null) === target && input.crew !== "new") return null;
      const { crew: _crew, ...rest } = state;
      const next: RunState = target === null ? (rest as RunState) : { ...rest, crew: target };
      await offerCampaigns(next, room.householdId, run.campaignId, deps);
      return next;
    },
    deps,
  );
  if (!result.ok) return result;
  // The lobby moved on to a chapter while the change was being made.
  if ((result.value.state.crew ?? null) !== target) return fail("ILLEGAL", "Change crews before the adventure starts.");
  return ok({ seq: result.value.seq, crew: target });
}

/** In the lobby, with no chapter started and none to finish. */
function betweenGames(state: RunState): boolean {
  return state.chapterId === null && !UNDER_WAY.has(state.phase) && state.phase !== "chapter_complete";
}

/** What a crew route answers a body it cannot read. */
export const CREW_BODY = 'expected { crew: "<crew id>" | null | "new" }';

/** The crew a request body names (`SwitchCrewInput.crew`), or undefined when it names none. */
export function parseCrewChoice(body: Record<string, unknown>): string | null | undefined {
  const crew = body.crew;
  if (crew === null || crew === "new") return crew;
  // A crew id is ours (`newId("cw")`): never the claim's separators, never anything long.
  return typeof crew === "string" && /^cw_[a-z0-9]{1,20}$/.test(crew) ? crew : undefined;
}
