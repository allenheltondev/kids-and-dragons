/**
 * Stop anytime, pick up where you left off (#259).
 *
 * A chapter is one 30 to 45 minute sitting and a room lasts six hours, but
 * plenty of evenings end early: bedtime, an appointment, attention running
 * out. Two things make that cost nothing.
 *
 * **Stopping** (`stopForToday`) is the host's Close with a promise attached.
 * The run is marked stopped (`RunRecord.stoppedAt`), closed, and its code
 * freed. Its state was never going anywhere: a run's `STATE` carries no TTL,
 * so it lasts exactly as long as the household does (seven days after the last
 * play for a guest household, for good once a grown-up keeps it). Nothing is
 * copied. The stopped run *is* the save.
 *
 * **Resuming** (`resumeGame`) is taking that state into the household's next
 * room. The chapter's scene, flags, purse, fight and trail move across; the
 * room's own things (its code, seq, roster, lock, quiet mode, lobby) stay the
 * new room's. The party comes back as the household's party: everyone who was
 * playing, away until their phone joins this room, on whatever device they
 * bring (a seat belongs to a player, never a device).
 *
 * **The claims are kept, not released.** A stopped table's heroes still hold
 * their adventure (architecture §4.5, "One game at a time per hero"). The
 * claim is what carries the gains of every chapter so far, and releasing it
 * would discard them: "nothing lost" and "released" cannot both be true. It
 * is the same rule a host's Close, a dropped phone or an expired room already
 * follows. A kid is never stuck behind it: a grown-up can end the adventure
 * from the organizer screen at any time, and a hero who has left it is not
 * brought back by a resume (she can sit down mid-chapter like anyone else).
 *
 * Only a stop saves. A plain Close, an idle close or a room that simply
 * expires does not, so "close" still means "done for now, start the chapter
 * fresh" as it always did.
 */

import {
  claimFor,
  claimOf,
  parseClaim,
  memberHome,
  resolveCharacter,
  startCampaign,
  type Character,
  type PartyMember,
  type RunState,
  type SavedGameView,
} from "@kad/shared";
import type { CharacterWrite, EventRecord, RunRecord } from "../store/repository.ts";
import { diff } from "../json-patch.ts";
import { claimIsLive, releaseClaim, standing, rewrite } from "./claim.ts";
import { fail, iso, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { commitRoomChange, hostedRoom, isClosed, type HostPrincipal } from "./host.ts";
import { expectedIndex, UNDER_WAY } from "./progression.ts";

/** Longest recap, in characters: a sentence an adult can read in one breath. */
const RECAP_MAX = 140;

/** Lost seq races a resume retries, as the other room-side writes do. */
const COMMIT_ATTEMPTS = 3;

/**
 * Things that belong to the room being opened rather than to the game being
 * brought into it. Everything else on a saved run is the game.
 */
const ROOM_KEYS = [
  "runId",
  "roomCode",
  "mode",
  "seq",
  "updatedAt",
  "fieldGuide",
  "seats",
  "locked",
  "quiet",
  "visitorCode",
  "visitorsOpened",
  "removed",
  "campaignOptions",
  "campaignVotes",
] as const satisfies readonly (keyof RunState)[];

/** The first sentence of `text`, trimmed to one breath. */
export function firstSentence(text: string, max = RECAP_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const sentence = /^.+?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[,;:\s]+$/, "")}...`;
}

/** Where the party was, for the lobby to say. */
export function recapOf(state: Pick<RunState, "narration" | "chapterInfo">): string {
  const line = firstSentence(state.narration);
  if (line !== "") return line;
  return state.chapterInfo ? `You were in ${state.chapterInfo.title}.` : "You were in the middle of a chapter.";
}

interface Saved {
  record: RunRecord;
  state: RunState;
  view: SavedGameView;
}

/**
 * The household's newest stopped chapter that can still be picked up, or null.
 *
 * "Can still be picked up" is checked against the household's campaign
 * attempt, which another room may have moved on in the meantime: the attempt
 * must still be the one the chapter began under, still active, and still at
 * this chapter (this beat for an ordered campaign, this visit for a graph).
 * A save that fails any of it is simply not offered; the run is left alone.
 */
export async function savedGame(
  householdId: string,
  deps: Pick<HandlerDeps, "repo" | "content">,
): Promise<Saved | null> {
  const stopped = (await deps.repo.listRuns(householdId))
    .filter((run) => run.stoppedAt !== undefined)
    .sort((a, b) => (b.stoppedAt ?? "").localeCompare(a.stoppedAt ?? ""));
  for (const record of stopped) {
    const found = await readSaved(record, householdId, deps);
    if (found) return found;
  }
  return null;
}

async function readSaved(
  record: RunRecord,
  householdId: string,
  deps: Pick<HandlerDeps, "repo" | "content">,
): Promise<Saved | null> {
  const state = await deps.repo.getState(record.id);
  if (!state || !isClosed(state) || !UNDER_WAY.has(state.phase) || !state.campaignId || !state.chapterInfo) {
    return null;
  }
  const campaign = deps.content.campaign(state.campaignId);
  if (!campaign) return null;
  const attempt = await deps.repo.getCampaignProgress(householdId, state.campaignId);
  if (!attempt || attempt.status !== "active") return null;
  if ((attempt.attemptId ?? null) !== (state.campaignAttemptId ?? null)) return null;

  if (deps.content.graph(state.campaignId)) {
    const journey = attempt.journey;
    const visit = state.journeyVisit;
    if (!visit || !journey || journey.status !== "playing") return null;
    if (journey.node !== visit.node || journey.visit !== visit.visit) return null;
  } else {
    // `expectedIndex` takes the whole deps for `finalIndex`; it only reads content.
    if (state.chapterInfo.index !== expectedIndex(campaign, attempt, deps as HandlerDeps)) return null;
  }

  return {
    record,
    state,
    view: {
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      chapter: { index: state.chapterInfo.index, title: state.chapterInfo.title },
      recap: recapOf(state),
      heroes: state.party.map((member) => member.character.name),
      savedAt: record.stoppedAt ?? state.updatedAt,
    },
  };
}

/**
 * The lobby's offer to keep going, or null. A lookup that fails costs the
 * offer, never the room: the lobby is built on every create and every join.
 */
export async function savedGameView(
  householdId: string,
  deps: Pick<HandlerDeps, "repo" | "content">,
): Promise<SavedGameView | null> {
  try {
    return (await savedGame(householdId, deps))?.view ?? null;
  } catch (err) {
    console.error(`save: could not look for ${householdId}'s saved game:`, err);
    return null;
  }
}

export interface StopRoomInput {
  code: string;
  principal: HostPrincipal;
}

/**
 * Save the chapter and close the room, for the host (the display, or the phone
 * or tablet that opened it). Legal at any point a chapter is under way: a roll
 * is settled in the one action that rolls it, so the run never holds a roll
 * half done, and the host's screen simply waits for the dice on its own.
 *
 * Marked stopped *before* it is closed, and offered only once it is closed
 * (`readSaved`): a stop that dies in between leaves an open room that is not
 * offered, and a second tap finishes it, rather than a save of a game that is
 * still being played.
 */
export async function stopForToday(
  input: StopRoomInput,
  deps: HandlerDeps,
): Promise<HandlerResult<{ seq: number }>> {
  const hosted = await hostedRoom(input.code, input.principal, deps);
  if (!hosted.ok) return hosted;
  const room = hosted.value;
  const state = await deps.repo.getState(room.runId);
  if (!state) return fail("NOT_FOUND", `run ${room.runId} has no state`);
  if (isClosed(state)) return fail("NOT_FOUND", `no open room ${room.code.toUpperCase()}`);
  if (!state.campaignId || !UNDER_WAY.has(state.phase)) {
    return fail(
      "ILLEGAL",
      "There is nothing to save right now. Between chapters the game is already safe, so you can just close the room.",
    );
  }

  const run = await deps.repo.getRun(room.runId);
  if (!run) return fail("NOT_FOUND", `no run ${room.runId}`);
  await deps.repo.putRun({
    ...run,
    stoppedAt: iso(deps.now()),
    ...(room.hostDeviceId ? { stoppedBy: room.hostDeviceId } : {}),
  });

  const result = await commitRoomChange(
    room,
    input.principal.playerId,
    (current) => (current.closed ? null : { ...current, closed: true, stopped: true }),
    deps,
    { closing: true },
  );
  if (!result.ok) return result;
  await deps.repo.deleteRoom(room.code);

  // One save per campaign: an older stop of the same one is the game as it
  // was an evening ago, and must not come back once this one is taken up.
  for (const other of await deps.repo.listRuns(run.householdId)) {
    if (other.id === run.id || other.stoppedAt === undefined || other.campaignId !== run.campaignId) continue;
    const { stoppedAt: _old, stoppedBy: _oldBy, ...cleared } = other;
    await deps.repo.putRun(cleared);
  }
  return ok({ seq: result.value.seq });
}

export interface ResumeGameInput {
  /** The new room's run. */
  runId: string;
  playerId: string;
  /** The household the player's session names: the room's, or a visitor's own. */
  householdId: string;
}

/**
 * Take the household's saved chapter into this room, which must still be in
 * its lobby. Anyone seated in the room may, as anyone may tap Begin.
 *
 * One committed change to the run, like every other room-side write: one seq,
 * one logged patch, one broadcast. A hero who needs to claim her adventure
 * again (a newcomer to the party) rides the same transaction, conditioned on
 * the row as read.
 */
export async function resumeGame(
  input: ResumeGameInput,
  deps: HandlerDeps,
): Promise<HandlerResult<{ seq: number }>> {
  const run = await deps.repo.getRun(input.runId);
  if (!run) return fail("NOT_FOUND", `no run ${input.runId}`);

  for (let attempt = 1; ; attempt++) {
    const room = await deps.repo.getState(input.runId);
    if (!room) return fail("NOT_FOUND", `run ${input.runId} has no state`);
    if (isClosed(room)) return fail("NOT_FOUND", "This game was closed.");
    if (room.removed?.includes(input.playerId)) return fail("FORBIDDEN", "This phone was taken out of the game.");
    const seat = room.seats?.[input.playerId];
    const home = input.householdId === run.householdId || seat?.homeHouseholdId === input.householdId;
    if (!home || (!seat && !room.party.some((m) => m.playerId === input.playerId))) {
      return fail("FORBIDDEN", "Join the room first.");
    }
    if (room.chapterId !== null || UNDER_WAY.has(room.phase) || room.phase === "chapter_complete") {
      return fail("ILLEGAL", "This game is already under way.");
    }

    const found = await savedGame(run.householdId, deps);
    if (!found) return fail("NOT_FOUND", "There is no saved game to pick up.");

    const { party, writes } = await restoreParty(room, found.state, run.householdId, deps);
    if (party.length === 0) return fail("ILLEGAL", "Pick a hero first, then keep going.");

    const { closed: _closed, stopped: _stopped, saved: _saved, ...play } = found.state;
    const base: Record<string, unknown> = { ...play };
    for (const key of ROOM_KEYS) {
      if (room[key] === undefined) delete base[key];
      else base[key] = room[key];
    }
    const nowMs = deps.now();
    const turn = found.state.storyTurn;
    const next: RunState = {
      ...(base as unknown as RunState),
      party,
      // Nothing is mid-air in a game being picked up.
      lastRoll: null,
      ...(turn === undefined ? {} : { storyTurn: turn % party.length }),
      seq: room.seq + 1,
      updatedAt: iso(nowMs),
    };
    const event: EventRecord = {
      seq: next.seq,
      runId: next.runId,
      patch: diff(room, next),
      at: iso(nowMs),
      playerId: input.playerId,
    };
    const committed = await deps.repo.commit({
      runId: next.runId,
      expectedSeq: room.seq,
      state: next,
      event,
      ...(writes.length > 0 ? { characters: writes } : {}),
    });
    if (committed) {
      await deps.channel.publish(next.roomCode, {
        kind: "patch",
        seq: event.seq,
        runId: event.runId,
        patch: event.patch,
      });
      await spend(found.record, deps);
      return ok({ seq: next.seq });
    }
    if (attempt >= COMMIT_ATTEMPTS) return fail("STALE_SEQ", "the game moved on just then; try again");
  }
}

/**
 * A save that has been taken up is spent, so no later room offers to rewind to
 * it. A failure here is logged, not raised: the game is already in the room,
 * and the worst case is an offer the attempt's own checks will refuse once the
 * chapter is finished.
 */
async function spend(record: RunRecord, deps: Pick<HandlerDeps, "repo">): Promise<void> {
  try {
    const current = await deps.repo.getRun(record.id);
    if (!current) return;
    const { stoppedAt: _taken, stoppedBy: _by, ...spent } = current;
    await deps.repo.putRun(spent);
  } catch (err) {
    console.error(`save: could not mark ${record.id} as taken up:`, err);
  }
}

/**
 * The household's party as it comes back into `room`.
 *
 * Everyone who was playing, in their seats, with the hp and the downs they
 * stopped with. They count as here only if their phone has joined this room
 * (the away rules, #258, carry the table until the rest arrive). A saved hero
 * who no longer holds this adventure (her grown-up ended it) is left out. A
 * hero already seated in this room who was not in the game joins it, claiming
 * the adventure the way a hero who sits down mid-chapter does; one held by
 * another adventure is left out, as that start would refuse her.
 */
async function restoreParty(
  room: RunState,
  saved: RunState,
  householdId: string,
  deps: HandlerDeps,
): Promise<{ party: PartyMember[]; writes: CharacterWrite[] }> {
  const campaignId = saved.campaignId!;
  const party: PartyMember[] = [];
  const writes: CharacterWrite[] = [];
  const kept = new Set<string>();
  const here = (playerId: string): boolean =>
    room.party.find((m) => m.playerId === playerId)?.connected ?? room.seats?.[playerId] !== undefined;

  for (const member of saved.party) {
    const hero = await deps.repo.getCharacter(memberHome(member, householdId), member.character.id);
    if (!hero) continue;
    if ((await standing(hero, claimFor(campaignId, householdId, hero), deps)) !== "mine") continue;
    kept.add(member.playerId);
    party.push({ ...member, connected: here(member.playerId), ready: false });
  }

  for (const member of room.party) {
    if (kept.has(member.playerId)) continue;
    const hero = await deps.repo.getCharacter(memberHome(member, householdId), member.character.id);
    if (!hero) continue;
    const claim = claimFor(campaignId, householdId, hero);
    const where = await standing(hero, claim, deps);
    if (where === "busy") continue;
    if (where === "mine") {
      party.push({ ...member, ready: false });
      continue;
    }
    const claimed = startCampaign(hero, claim);
    writes.push(rewrite(hero, claimed));
    party.push({
      ...member,
      character: resolveCharacter(claimed, deps.content.rules(), deps.content.items()),
      ready: false,
    });
  }
  return { party, writes };
}

/**
 * Where a hero is saved, when a stopped game is what holds her (#259): the
 * name of the table, when it is not her own home ("Ada is saved in a game at
 * Rue's"), else `at: null`. Null when she is free, or held by a game that is
 * not stopped.
 */
export async function heroSaved(
  hero: Character,
  deps: Pick<HandlerDeps, "repo" | "content">,
): Promise<{ at: string | null } | null> {
  const held = claimOf(hero);
  if (held === null || !(await claimIsLive(held, hero, deps))) return null;
  const { campaignId, table } = parseClaim(held, hero);
  const saved = await savedGame(table, deps);
  if (!saved || saved.state.campaignId !== campaignId) return null;
  if (!saved.state.party.some((member) => member.character.id === hero.id)) return null;
  if (table === hero.householdId) return { at: null };
  return { at: (await deps.repo.getHousehold(table))?.displayName ?? "another table" };
}

export interface ReleaseSavedHeroInput {
  /** The device asking: it must be the one that opened the stopped room. */
  deviceId: string;
  /** The table's household: the asking device's own. */
  householdId: string;
  characterId: string;
  /** Where the hero lives, when it is not the table's (a visitor). */
  homeHouseholdId?: string;
}

/**
 * The stopped table's host lets a hero go (#259): her unfinished gains from
 * the adventure are dropped and her claim is freed at once, exactly as her
 * own grown-up's "end this adventure" does (`releaseClaim`). Only for a hero
 * a stopped game of *this* table holds, and only for the device that stopped
 * it. A resume after that finds her no longer holding the adventure and
 * leaves her out; she is in it again only by sitting down as she is now.
 * There is no timeout: this and her grown-up are the only ways.
 */
export async function releaseSavedHero(
  input: ReleaseSavedHeroInput,
  deps: HandlerDeps,
): Promise<HandlerResult<{ left: string | null }>> {
  const home = input.homeHouseholdId ?? input.householdId;
  const hero = await deps.repo.getCharacter(home, input.characterId);
  if (!hero) return fail("NOT_FOUND", `no hero ${input.characterId}`);
  const held = claimOf(hero);
  const { campaignId, table } = held === null ? { campaignId: "", table: "" } : parseClaim(held, hero);
  const runs = held === null || table !== input.householdId ? [] : await deps.repo.listRuns(table);
  const stopped = runs.find(
    (run) => run.stoppedAt !== undefined && run.stoppedBy === input.deviceId && run.campaignId === campaignId,
  );
  if (!stopped) {
    return fail("FORBIDDEN", "Only the screen or phone that stopped this game can let a hero go from it.");
  }
  const saved = await readSaved(stopped, table, deps);
  if (!saved?.state.party.some((member) => member.character.id === hero.id)) {
    return fail("FORBIDDEN", "Only the screen or phone that stopped this game can let a hero go from it.");
  }
  return releaseClaim(home, hero.id, deps);
}
