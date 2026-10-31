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

import { claimOf, CREW_NAMES, FIRST_CREW_NAME, lobbyCampaign, memberHome, parseClaim, type Character, type RunState } from "@kad/shared";
import type { CommitInput, CrewRecord } from "../store/repository.ts";
import { claimIsLive } from "./claim.ts";
import { fail, iso, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { commitRoomChange, hostedRoom, type HostPrincipal } from "./host.ts";
import { seatedParty, UNDER_WAY } from "./progression.ts";
import { offerCampaigns } from "./room.ts";

export { CREW_NAMES };

/** Enough for every group a household plays with, and a bound on the rows a host can make: one slot per name. */
export const MAX_CREWS = CREW_NAMES.length;

export interface SwitchCrewInput {
  code: string;
  principal: HostPrincipal;
  /**
   * The crew this lobby plays: a crew's id, null for the household's first, or
   * "new" to start a crew with no saves and play it.
   */
  crew: string | null | "new";
  /**
   * With "new": the id of this one tap. A request carrying the id of a crew
   * already made is a retry, and gets that crew rather than another.
   */
  request?: string;
}

/**
 * Point the lobby at another of the household's crews, or a brand-new one.
 * One committed change, like every host control, and the lobby is rebuilt in
 * it: the crew's campaigns, its saved game, and votes cast on the old list go.
 *
 * A new crew's row rides that same commit (`CommitInput.crew`), so it exists
 * exactly when a lobby switched to it: a start that won the race, or retries
 * that ran out, leave nothing behind. Its id is the first free slot,
 * `cw_1` to `cw_<MAX_CREWS>`, written only if nobody holds it, so two rooms
 * starting a crew at once take different slots (the loser's commit fails and
 * its retry reads again), and the cap is the slots themselves. And a "new"
 * request carries its tap's id (`request`), kept on the crew it makes: the
 * same request again, a retry after a lost answer, gets that crew, not a
 * second, while a fresh tap always makes one.
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
  const run = await deps.repo.getRun(room.runId);
  if (!run) return fail("NOT_FOUND", `no run ${room.runId}`);

  // Decided afresh on every attempt, from the crews as they stand then.
  let target: string | null = null;
  let made: CrewRecord | undefined;
  // The crew-names version a new crew's name was picked from (`CommitInput.crewNames`).
  let namesRead = 0;
  // Asserted rather than annotated: set in the change below, which TypeScript cannot see.
  let refusal = null as { code: "ILLEGAL" | "NOT_FOUND"; message: string } | null;

  const result = await commitRoomChange(
    room,
    input.principal.playerId,
    async (state) => {
      made = undefined;
      refusal = null;
      namesRead = await deps.repo.getCrewNamesVersion(room.householdId);
      if (!betweenGames(state)) {
        refusal = { code: "ILLEGAL", message: "Change crews before the adventure starts." };
        return null;
      }
      const crews = await deps.repo.listCrews(room.householdId);
      const retried = input.crew === "new" && input.request ? crews.find((c) => c.request === input.request) : undefined;
      if (retried) {
        target = retried.id;
      } else if (input.crew === "new") {
        // The slot is the id, the name the first one no crew holds: the first
        // crew's own name included, since a rename may have given it one of
        // the list's. One name per crew, so the list is the cap, the first
        // crew's name counted when it holds one.
        const taken = new Set(crews.map((c) => c.id));
        const slot = CREW_NAMES.findIndex((_, i) => !taken.has(crewSlot(i)));
        const held = await heldNames(room.householdId, crews, undefined, deps);
        const name = CREW_NAMES.find((n) => !held.includes(n));
        if (slot < 0 || name === undefined) {
          refusal = { code: "ILLEGAL", message: "This game already has as many crews as it can keep." };
          return null;
        }
        made = {
          householdId: room.householdId,
          id: crewSlot(slot),
          name,
          createdAt: iso(deps.now()),
          ...(input.request ? { request: input.request } : {}),
        };
        target = made.id;
      } else if (input.crew === null) {
        target = null;
      } else {
        if (!crews.some((c) => c.id === input.crew)) {
          refusal = { code: "NOT_FOUND", message: "There is no crew like that in this game." };
          return null;
        }
        target = input.crew;
      }
      if ((state.crew ?? null) === target) return null;
      const { crew: _crew, ...rest } = state;
      const next: RunState = target === null ? (rest as RunState) : { ...rest, crew: target };
      delete next.crewSetup;
      delete next.crewCheck;
      delete next.crewConfirmed;
      // A deliberate crew choice also chooses a different lineup. The phones
      // stay connected and can bring that crew's saved heroes or make new ones.
      next.party = [];
      next.phase = "lobby";
      if (made) {
        // Keep the phones and household hero rows, but begin a new lineup.
        // This rides the crew's atomic commit, so retries cannot unseat newly
        // created heroes after the original response was lost.
        next.crewSetup = true;
      }
      await offerCampaigns(next, room.householdId, run.campaignId, deps);
      // The lobby read the crews before this one's row exists: it lands with this commit.
      if (made) next.crews = [...(next.crews ?? []), { id: made.id, name: made.name }];
      return next;
    },
    deps,
    {
      crew: () => made,
      // A new crew's name was picked from the names as they stood: gated on them.
      crewNames: () => (made ? { householdId: room.householdId, expectedVersion: namesRead, names: [] } : undefined),
    },
  );
  if (!result.ok) return result;
  if (refusal) return fail(refusal.code, refusal.message);
  return ok({ seq: result.value.seq, crew: target });
}

/**
 * Every name the household's crews go by, but `except`'s (a crew's id, or null
 * for the first): the first crew's when it was given one, and every other crew's.
 */
async function heldNames(
  householdId: string,
  crews: CrewRecord[],
  except: string | null | undefined,
  deps: HandlerDeps,
): Promise<string[]> {
  const first = await deps.repo.getFirstCrewName(householdId);
  return [
    ...crews.filter((c) => c.id !== except).map((c) => c.name),
    ...(except === null ? [] : [first ?? FIRST_CREW_NAME]),
  ];
}

export interface RenameCrewInput {
  code: string;
  principal: HostPrincipal;
  /** The crew to rename: its id, or null for the household's first. */
  crew: string | null;
  /** One of `CREW_NAMES`: no typing on a TV remote. */
  name: string;
}

/** What a rename body asks for, or undefined when it cannot be read. */
export const RENAME_BODY = 'expected { crew: "<crew id>" | null, name: "<one of the offered names>" }';

export function parseCrewRename(body: Record<string, unknown>): Pick<RenameCrewInput, "crew" | "name"> | undefined {
  const { crew, name } = body;
  if (typeof name !== "string" || !(CREW_NAMES as readonly string[]).includes(name)) return undefined;
  if (crew === null) return { crew, name };
  return typeof crew === "string" && /^cw_[a-z0-9]{1,20}$/.test(crew) ? { crew, name } : undefined;
}

/**
 * Give one of the household's crews another of the offered names. The names are
 * a fixed list, so a kid's crew never carries anything typed at the TV, and no
 * two crews share one. The lobby is rebuilt in the same commit so the Room panel
 * and the lobby screen show it at once.
 */
export async function renameCrew(
  input: RenameCrewInput,
  deps: HandlerDeps,
): Promise<HandlerResult<{ seq: number }>> {
  const hosted = await hostedRoom(input.code, input.principal, deps);
  if (!hosted.ok) return hosted;
  const room = hosted.value;
  if (room.claimable === true) {
    return fail("ILLEGAL", "Let somebody join first, so the game knows whose crews these are.");
  }
  const run = await deps.repo.getRun(room.runId);
  if (!run) return fail("NOT_FOUND", `no run ${room.runId}`);

  let refusal = null as { code: "ILLEGAL" | "NOT_FOUND"; message: string } | null;
  // The rename this attempt chose, and the crew-names version it chose it from:
  // it lands with the run's commit, and only on that version, so a lost race
  // writes nothing and its retry reads the names again (`CommitInput.crewNames`).
  let naming: NonNullable<CommitInput["crewNames"]> | undefined;
  const result = await commitRoomChange(
    room,
    input.principal.playerId,
    async (state) => {
      refusal = null;
      naming = undefined;
      if (!betweenGames(state)) {
        refusal = { code: "ILLEGAL", message: "Rename a crew before the adventure starts." };
        return null;
      }
      const version = await deps.repo.getCrewNamesVersion(room.householdId);
      const crews = await deps.repo.listCrews(room.householdId);
      if (input.crew !== null && !crews.some((c) => c.id === input.crew)) {
        refusal = { code: "NOT_FOUND", message: "There is no crew like that in this game." };
        return null;
      }
      if ((await heldNames(room.householdId, crews, input.crew, deps)).includes(input.name)) {
        refusal = { code: "ILLEGAL", message: "Another crew already has that name." };
        return null;
      }
      naming = { householdId: room.householdId, expectedVersion: version, names: [{ crew: input.crew, name: input.name }] };
      // The screens show the new name with the commit that sets it.
      const next: RunState = { ...state };
      if (input.crew === null) next.firstCrewName = input.name;
      else next.crews = (state.crews ?? []).map((c) => (c.id === input.crew ? { ...c, name: input.name } : c));
      return next;
    },
    deps,
    { crewNames: () => naming },
  );
  if (!result.ok) return result;
  if (refusal) return fail(refusal.code, refusal.message);
  return ok({ seq: result.value.seq });
}

/**
 * Whether the heroes seated are all new to the adventure this crew has under
 * way in `campaignId`: the crew is partway through it (a chapter finished, or
 * a journey begun), other heroes of the household are on it, and no seated
 * hero is. Then it is somebody else's story, and the lobby must not quietly
 * resume it for them; the host chooses (`confirmCrew`, or a new crew). An
 * attempt no hero is on asks nothing. False whenever anything cannot be read,
 * so a failed lookup never stands between a returning crew and its game.
 */
export async function newcomersTo(
  state: RunState,
  householdId: string,
  campaignId: string,
  deps: Pick<HandlerDeps, "repo">,
): Promise<boolean> {
  if (!betweenGames(state) || state.crewSetup || state.crewConfirmed === campaignId) return false;
  const party = seatedParty(state);
  if (party.length === 0) return false;
  const attempt = await deps.repo.getCampaignProgress(householdId, campaignId, state.crew);
  if (!attempt || attempt.status !== "active") return false;
  if (attempt.lastIndex === undefined && attempt.journey === undefined) return false;
  const onIt = (hero: Character): boolean => {
    const held = claimOf(hero);
    if (held === null) return false;
    const claim = parseClaim(held, hero);
    return claim.campaignId === campaignId && claim.table === householdId && (claim.crew ?? null) === (state.crew ?? null);
  };
  let household: Character[];
  try {
    household = await deps.repo.listCharacters(householdId);
  } catch (err) {
    console.error(`crews: could not list ${householdId}'s heroes:`, err);
    return false;
  }
  const seated = new Set(party.map((member) => member.character.id));
  if (!household.some((hero) => !seated.has(hero.id) && onIt(hero))) return false;
  for (const member of party) {
    let hero;
    try {
      hero = await deps.repo.getCharacter(memberHome(member, householdId), member.character.id);
    } catch (err) {
      console.error(`crews: could not read ${member.character.id}:`, err);
      return false;
    }
    if (hero && onIt(hero)) return false;
  }
  return true;
}

/**
 * Keeps `RunState.crewCheck` true to who is seated and which adventure the
 * lobby rests on. Called whenever the party or the votes in the lobby change.
 * Returns the state unchanged (the same object) when nothing moved.
 */
export async function checkNewcomers(state: RunState, householdId: string, deps: Pick<HandlerDeps, "repo">): Promise<RunState> {
  const leader = lobbyCampaign(state).leader;
  const found =
    leader && leader.locked === undefined && (await newcomersTo(state, householdId, leader.id, deps))
      ? { campaignId: leader.id, title: leader.title }
      : null;
  const same = found
    ? state.crewCheck?.campaignId === found.campaignId && state.crewCheck.title === found.title
    : state.crewCheck === undefined;
  if (same) return state;
  const next: RunState = { ...state };
  if (found) next.crewCheck = found;
  else delete next.crewCheck;
  return next;
}

/** Who the host's keep-going was for: the heroes seated, and the crew whose adventure it is. */
function lineup(state: RunState): string {
  const heroes = seatedParty(state).map((m) => m.character.id).sort().join(" ");
  return `${state.crew ?? ""}|${heroes}`;
}

/**
 * The lobby moved from `before` to `after`: when the heroes seated (somebody
 * sat down, got up, or was taken out) or the crew changed, the host's
 * keep-going was for a lineup that is not this one, so it is dropped
 * (`crewConfirmed`) and the question asked again for these heroes. A change of
 * the adventure the lobby rests on asks again too. Anything else leaves the
 * state as it is (the same object). Lobby-only.
 */
export async function rethinkNewcomers(
  before: RunState,
  after: RunState,
  householdId: string,
  deps: Pick<HandlerDeps, "repo">,
): Promise<RunState> {
  if (after.phase !== "lobby" && after.phase !== "creation") return after;
  const moved = lineup(before) !== lineup(after);
  if (!moved && before.campaignVotes === after.campaignVotes) return after;
  let next = after;
  if (moved && next.crewConfirmed !== undefined) {
    next = { ...next };
    delete next.crewConfirmed;
  }
  return checkNewcomers(next, householdId, deps);
}

export interface ConfirmCrewInput {
  code: string;
  principal: HostPrincipal;
  /** The adventure the host chose to keep going with (`crewCheck.campaignId`). */
  campaignId: string;
}

/** What a keep-going body asks for, or undefined when it cannot be read. */
export const KEEP_BODY = 'expected { campaignId: "<campaign id>" }';

export function parseCrewKeep(body: Record<string, unknown>): Pick<ConfirmCrewInput, "campaignId"> | undefined {
  const { campaignId } = body;
  return typeof campaignId === "string" && /^[a-z0-9-]{1,64}$/.test(campaignId) ? { campaignId } : undefined;
}

/**
 * The host's answer to `crewCheck`: these heroes join the crew's adventure
 * where it stands. Starting fresh instead is `switchCrew("new")`.
 */
export async function confirmCrew(
  input: ConfirmCrewInput,
  deps: HandlerDeps,
): Promise<HandlerResult<{ seq: number }>> {
  const hosted = await hostedRoom(input.code, input.principal, deps);
  if (!hosted.ok) return hosted;
  const room = hosted.value;
  let refusal = null as string | null;
  const result = await commitRoomChange(
    room,
    input.principal.playerId,
    async (state) => {
      refusal = null;
      if (!betweenGames(state)) {
        refusal = "Choose before the adventure starts.";
        return null;
      }
      // A repeat of the answer already given is fine; an answer to a question
      // the lobby no longer asks (the vote moved to another adventure) is not.
      if (state.crewConfirmed === input.campaignId && state.crewCheck === undefined) return null;
      if (state.crewCheck?.campaignId !== input.campaignId) {
        refusal = "The lobby is asking about another adventure now. Choose again.";
        return null;
      }
      const next: RunState = { ...state, crewConfirmed: input.campaignId };
      delete next.crewCheck;
      return next;
    },
    deps,
  );
  if (!result.ok) return result;
  if (refusal) return fail("ILLEGAL", refusal);
  return ok({ seq: result.value.seq });
}

/** A crew's id by slot: `cw_1` for the first slot. Never the claim's separators. */
function crewSlot(index: number): string {
  return `cw_${index + 1}`;
}

/**
 * The lobby follows the kids: when the heroes seated in it are already on one
 * crew's adventure at this household, it switches to that crew, so a crew that
 * comes back every week never has to open the Room panel. Called whenever the
 * party in the lobby changes, beside `relockLobby`.
 *
 * Only a clear answer moves it. A new hero, or one whose adventure is over or
 * at another table, says nothing. Heroes on two different crews' adventures
 * leave the lobby where it is, and the start says who is playing with whom
 * (`crewBusyMessage`). A household that has never made a crew reads nothing
 * and returns the state unchanged (the same object), so the first crew's
 * lobbies, Gemfall's pinned ones among them, are exactly as before.
 */
export async function followCrew(
  state: RunState,
  householdId: string,
  featuredId: string | null,
  deps: HandlerDeps,
): Promise<RunState> {
  if (state.crews === undefined && state.crew === undefined) return state;
  if (!betweenGames(state)) return state;
  if (state.crewSetup) return state;
  const known = new Set((state.crews ?? []).map((c) => c.id));
  const crews = new Set<string | null>();
  for (const member of seatedParty(state)) {
    let hero;
    try {
      hero = await deps.repo.getCharacter(memberHome(member, householdId), member.character.id);
    } catch (err) {
      // A hero who cannot be read cannot say which crew: leave the lobby be.
      console.error(`crews: could not read ${member.character.id}:`, err);
      return state;
    }
    const held = hero ? claimOf(hero) : null;
    if (!hero || held === null) continue;
    const { table, crew } = parseClaim(held, hero);
    if (table !== householdId || (crew !== undefined && !known.has(crew))) continue;
    if (!(await claimIsLive(held, hero, deps))) continue;
    crews.add(crew ?? null);
  }
  if (crews.size !== 1) return state;
  const [target] = [...crews];
  if ((state.crew ?? null) === target) return state;
  const { crew: _crew, ...rest } = state;
  const next: RunState = target ? { ...rest, crew: target } : (rest as RunState);
  await offerCampaigns(next, householdId, featuredId, deps);
  return next;
}

/** In the lobby, with no chapter started and none to finish. */
function betweenGames(state: RunState): boolean {
  return state.chapterId === null && !UNDER_WAY.has(state.phase) && state.phase !== "chapter_complete";
}

/** What a crew route answers a body it cannot read. */
export const CREW_BODY = 'expected { crew: "<crew id>" | null | "new", request?: "<tap id>" }';

/**
 * What a crew request body asks for (`SwitchCrewInput`), or undefined when it
 * cannot be read: a crew id, null or "new", and for "new" an optional tap id.
 */
export function parseCrewChoice(
  body: Record<string, unknown>,
): Pick<SwitchCrewInput, "crew" | "request"> | undefined {
  const { crew, request } = body;
  if (request !== undefined && (typeof request !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(request))) {
    return undefined;
  }
  const tap = typeof request === "string" ? { request } : {};
  if (crew === null) return { crew };
  if (crew === "new") return { crew, ...tap };
  // A crew id is ours (`crewSlot`): never the claim's separators, never anything long.
  return typeof crew === "string" && /^cw_[a-z0-9]{1,20}$/.test(crew) ? { crew } : undefined;
}
