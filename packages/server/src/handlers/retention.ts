/**
 * Deleting and keeping (#252, architecture §4.5 "Deleting and keeping"): an
 * owner deletes one kid or the whole household, and sets how long a kid who
 * stops playing is kept.
 *
 * The three owners decided in #266 decide what goes:
 *
 *   - **The kid** and **her hero's record** are her grown-up's: deleting her
 *     removes her profile, her heroes, her phones and her visits, from her
 *     home, which is the only place they live.
 *   - **A table's save** is that table's. Deleting a household removes its
 *     own saves. Another table's save is not deleted, but it stops naming her:
 *     her seat and her hero's name come out of every run there that has them
 *     (`forgetPlayer`).
 *
 * A hero still in the middle of an adventure (`claimIsLive`) is never deleted
 * from under the table playing it. The owner ends that adventure first, from
 * the same screen (`leaveAdventure`), exactly as a move refuses (#251).
 *
 * Every delete goes through the sweeper's path and its `sweeping` mark
 * (`repo.deleteHousehold`, `repo.deleteProfile`), never a second one.
 */

import { claimOf, parseClaim, RETENTION_CHOICES, settleChapterEndVote } from "@kad/shared";
import type { Character, Household, OrganizerHouseholdDeleted, RoomChannel, RunState } from "@kad/shared";
import { diff } from "../json-patch.ts";
import type { EventRecord } from "../store/repository.ts";
import { summaries } from "./account.ts";
import { claimIsLive } from "./claim.ts";
import { fail, iso, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a forgotten kid's hero is called in a save that keeps her place (`forgetPlayer`). */
export const FORGOTTEN_NAME = "A friend";

/** Lost seq races per run before the tidy-up moves on, as host controls allow. */
const FORGET_ATTEMPTS = 3;

/** Retention sweeps per invocation; the schedule catches up, as the guest sweep's does. */
const IDLE_BATCH = 25;

/** What forgetting needs: a channel only when there are screens to tell. */
export type ForgetDeps = Pick<HandlerDeps, "repo" | "now"> & { channel?: RoomChannel };

type Owned = Pick<HandlerDeps, "repo" | "content" | "now"> & { channel?: RoomChannel };

// ---------------------------------------------------------------------------
// Deleting one kid
// ---------------------------------------------------------------------------

/**
 * Delete a kid from her home (#252): her profile, heroes, phones and visits,
 * and her name from every save that has it. The caller has proved an owner of
 * `household`, her home. Refused while one of her heroes is mid-adventure.
 */
export async function deleteKid(
  household: Household,
  playerId: string,
  deps: Owned,
): Promise<HandlerResult<{ forgotten: number }>> {
  const heroes = (await deps.repo.listCharacters(household.id)).filter((c) => c.ownerPlayerId === playerId);
  const busy = await busyHero(heroes, () => true, deps);
  if (busy) return fail("ILLEGAL", `${busy.name} is in the middle of an adventure. End it first, then try again.`);

  // Read before the delete takes her visits with it; forgotten after, so a
  // delete that is refused never touches another table's save.
  const tables = await tablesOf(playerId, household.id, heroes, deps);
  if (!(await deps.repo.deleteProfile(household.id, playerId))) return fail("NOT_FOUND", `no player ${playerId}`);
  return ok({ forgotten: await forgetEverywhere([{ playerId, tables }], deps) });
}

// ---------------------------------------------------------------------------
// Deleting a household
// ---------------------------------------------------------------------------

/**
 * Delete a household and everything under it (#252), for one of its owners.
 *
 * Not while somebody else also owns it: a group run by several grown-ups
 * (#248) is not one grown-up's to delete. The others leave it first (or its
 * founder takes them off, which they see). And not while a kid whose home it
 * is has a hero mid-adventure at another table: that table's evening would
 * lose a hero from under it. A visiting kid's hero lives at her own home and
 * is untouched, and her claim on this table's attempt is released by the
 * attempt going with it (`claimIsLive` reads no attempt as over).
 */
export async function deleteOwnedHousehold(
  household: Household,
  cognitoSub: string,
  deps: Owned,
): Promise<HandlerResult<OrganizerHouseholdDeleted>> {
  const owners = new Set((await deps.repo.listOwners(household.id)).map((o) => o.cognitoSub));
  if (household.ownerSub) owners.add(household.ownerSub);
  owners.delete(cognitoSub);
  if (owners.size > 0) {
    return fail("ILLEGAL", "Other grown-ups help run this one. It can be deleted once you are the only one left.");
  }

  const [players, heroes] = await Promise.all([
    deps.repo.listPlayers(household.id),
    deps.repo.listCharacters(household.id),
  ]);
  // Her home's own attempts go with it; only another table's is in the way.
  const away = (hero: Character) => parseClaim(claimOf(hero) ?? "", hero).table !== household.id;
  const busy = await busyHero(heroes, away, deps);
  if (busy) {
    return fail("ILLEGAL", `${busy.name} is in the middle of an adventure at another table. End it first, then try again.`);
  }

  const kids = await Promise.all(
    players.map(async (p) => ({
      playerId: p.id,
      tables: await tablesOf(
        p.id,
        household.id,
        heroes.filter((c) => c.ownerPlayerId === p.id),
        deps,
      ),
    })),
  );
  // Its own saves go with it, so only other tables are left to forget her at.
  const elsewhere = kids.map((k) => ({ ...k, tables: k.tables.filter((t) => t !== household.id) }));
  await deps.repo.deleteHousehold(household.id);
  await forgetEverywhere(elsewhere, deps);
  return ok({
    householdId: household.id,
    households: await summaries(await deps.repo.listHouseholdsForAccount(cognitoSub), deps),
  });
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/** A window an owner may pick, or `null` for "until I delete them". */
export function retentionChoice(raw: unknown): HandlerResult<number | null> {
  if (raw === null) return ok(null);
  if (typeof raw === "number" && (RETENTION_CHOICES as readonly number[]).includes(raw)) return ok(raw);
  return fail("ILLEGAL", `expected { retentionDays: null | ${RETENTION_CHOICES.join(" | ")} }`);
}

/**
 * Set how long a kid who stops playing is kept (#252), and put every kid in
 * the household on that clock. A kid with no `lastPlayedAt` (nobody has
 * joined a room as her since this existed) starts it now, so choosing a
 * window never deletes anybody on the spot.
 */
export async function setRetention(
  household: Household,
  retentionDays: number | null,
  deps: Pick<HandlerDeps, "repo" | "now">,
): Promise<Household> {
  // Re-read for the write, as a rename does, so a claim or founding since is kept.
  const current = (await deps.repo.getHousehold(household.id)) ?? household;
  const { retentionDays: _old, ...rest } = current;
  const next: Household = retentionDays === null ? rest : { ...rest, retentionDays };
  await deps.repo.putHousehold(next);

  const now = iso(deps.now());
  for (const player of await deps.repo.listPlayers(household.id)) {
    const last = (await deps.repo.getLastPlayed(household.id, player.id)) ?? now;
    await deps.repo.touchPlayer(household.id, player.id, last, keepUntil(next, last));
  }
  return next;
}

/** When a kid who last played at `lastPlayedAt` may be forgotten, or `null` if never. */
export function keepUntil(household: Household, lastPlayedAt: string): string | null {
  if (household.guest || household.retentionDays === undefined) return null;
  return iso(Date.parse(lastPlayedAt) + household.retentionDays * DAY_MS);
}

/**
 * A kid just sat down in a room (#252): her retention clock starts again, and
 * a visit to a table that is not her home is written down, so deleting her
 * later can find that table. Never throws: playing never waits on it.
 */
export async function notePlayed(
  home: string,
  playerId: string,
  table: string,
  deps: Pick<HandlerDeps, "repo" | "now">,
): Promise<void> {
  try {
    const now = iso(deps.now());
    const household = await deps.repo.getHousehold(home);
    if (!household) return;
    await Promise.all([
      deps.repo.touchPlayer(home, playerId, now, keepUntil(household, now)),
      table === home ? undefined : deps.repo.putVisit(playerId, table, now),
    ]);
  } catch (err) {
    console.error(`notePlayed: could not note ${playerId} in ${home}:`, err);
  }
}

export interface IdleSweepResult {
  deleted: string[];
  /** Played since the index said so, or the household's window changed: re-filed, not deleted. */
  kept: string[];
  failed: { playerId: string; reason: string }[];
}

/**
 * Forget kids who have not played for their household's window (#252). The
 * index is a list of candidates and nothing more: each household's window is
 * read again here, and the delete itself is gated on `lastPlayedAt`, so a kid
 * who joins a room while this runs is spared. A hero mid-adventure does not
 * spare her: her grown-up chose the window, and she has not sat at any table
 * for all of it, which is the only way a claim is used.
 */
export async function sweepIdleProfiles(deps: ForgetDeps): Promise<IdleSweepResult> {
  const nowMs = deps.now();
  const result: IdleSweepResult = { deleted: [], kept: [], failed: [] };
  for (const idle of await deps.repo.listIdlePlayers(iso(nowMs), IDLE_BATCH)) {
    try {
      const household = await deps.repo.getHousehold(idle.householdId);
      const until = household && idle.lastPlayedAt ? keepUntil(household, idle.lastPlayedAt) : null;
      if (!household || until === null || until > iso(nowMs)) {
        // Re-file under the window the household has now, or none.
        if (household) {
          await deps.repo.touchPlayer(idle.householdId, idle.playerId, idle.lastPlayedAt || iso(nowMs), until);
        }
        result.kept.push(idle.playerId);
        continue;
      }
      const heroes = (await deps.repo.listCharacters(idle.householdId)).filter((c) => c.ownerPlayerId === idle.playerId);
      const tables = await tablesOf(idle.playerId, idle.householdId, heroes, deps);
      const cutoff = iso(nowMs - (household.retentionDays ?? 0) * DAY_MS);
      if (!(await deps.repo.deleteProfile(idle.householdId, idle.playerId, cutoff))) {
        result.kept.push(idle.playerId);
        continue;
      }
      await forgetEverywhere([{ playerId: idle.playerId, tables }], deps);
      result.deleted.push(idle.playerId);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[sweep] could not forget ${idle.playerId}: ${reason}`);
      result.failed.push({ playerId: idle.playerId, reason });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Forgetting her at the tables she played at
// ---------------------------------------------------------------------------

/**
 * Every table whose saves may name her: her home, each table she visited
 * (`putVisit`), and any table one of her heroes is claimed by, which also
 * finds a visit from before visits were written down.
 */
export async function tablesOf(
  playerId: string,
  home: string,
  heroes: readonly Character[],
  deps: Pick<HandlerDeps, "repo">,
): Promise<string[]> {
  const tables = new Set([home, ...(await deps.repo.listVisits(playerId))]);
  for (const hero of heroes) {
    const held = claimOf(hero);
    if (held !== null) tables.add(parseClaim(held, hero).table);
  }
  return [...tables];
}

/**
 * Take each kid's name out of every run at each of her tables. After her
 * profile is gone, so it is tidy-up: every room door already treats a kid
 * with no profile as out (`isOut`). A run it cannot write is logged and left,
 * as a move's tidy-up is (`takeOutEverywhere`). Returns the runs changed.
 */
export async function forgetEverywhere(
  kids: readonly { playerId: string; tables: readonly string[] }[],
  deps: ForgetDeps,
): Promise<number> {
  let changed = 0;
  for (const kid of kids) {
    for (const table of kid.tables) {
      for (const run of await deps.repo.listRuns(table)) {
        try {
          if (await forgetInRun(run.id, kid.playerId, deps)) changed++;
        } catch (err) {
          console.error(`forget: could not take ${kid.playerId} out of run ${run.id}:`, err);
        }
      }
    }
  }
  return changed;
}

/** `forgetPlayer` on one run, committed as a turn of its own. False when there was nothing to forget. */
async function forgetInRun(runId: string, playerId: string, deps: ForgetDeps): Promise<boolean> {
  for (let attempt = 1; attempt <= FORGET_ATTEMPTS; attempt++) {
    const state = await deps.repo.getState(runId);
    if (!state) return false;
    const changed = forgetPlayer(state, playerId);
    if (!changed) return false;
    const nowMs = deps.now();
    const next: RunState = { ...changed, seq: state.seq + 1, updatedAt: iso(nowMs) };
    const event: EventRecord = { seq: next.seq, runId, patch: diff(state, next), at: iso(nowMs) };
    if (await deps.repo.commit({ runId, expectedSeq: state.seq, state: next, event })) {
      // Only screens on this run's own room: codes recycle.
      const room = deps.channel ? await deps.repo.getRoom(next.roomCode) : null;
      if (deps.channel && room?.runId === runId) {
        await deps.channel.publish(next.roomCode, { kind: "patch", seq: event.seq, runId, patch: event.patch });
      }
      return true;
    }
  }
  throw new Error(`run ${runId} kept moving`);
}

/**
 * A save that no longer names her: her seat (her nickname and color) is gone,
 * and her hero, if she had one here, is out of the party before play has
 * begun (the lobby, making heroes), or kept
 * in it as `FORGOTTEN_NAME` once play has begun, because an encounter's turn
 * order and the table's votes point at party members (remove.ts). She is on
 * `removed`, away, and out of any vote, as a host's Remove leaves her. `null`
 * when the save already does not name her.
 */
export function forgetPlayer(state: RunState, playerId: string): RunState | null {
  const seat = state.seats?.[playerId];
  const member = state.party.find((m) => m.playerId === playerId);
  if (seat === undefined && (member === undefined || member.character.name === FORGOTTEN_NAME)) return null;

  const { [playerId]: _gone, ...seats } = state.seats ?? {};
  const party =
    state.phase === "lobby" || state.phase === "creation"
      ? state.party.filter((m) => m.playerId !== playerId)
      : state.party.map((m) =>
          m.playerId === playerId
            ? { ...m, connected: false, ready: false, character: { ...m.character, name: FORGOTTEN_NAME } }
            : m,
        );
  const removed = state.removed?.includes(playerId) ? state.removed : [...(state.removed ?? []), playerId];
  return settleChapterEndVote({ ...state, party, removed, ...(state.seats ? { seats } : {}) });
}

/** The first hero `among` that is still mid-adventure, by her claim. */
async function busyHero(
  heroes: readonly Character[],
  among: (hero: Character) => boolean,
  deps: Pick<HandlerDeps, "repo" | "content">,
): Promise<Character | null> {
  for (const hero of heroes) {
    const held = claimOf(hero);
    if (held !== null && among(hero) && (await claimIsLive(held, hero, deps))) return hero;
  }
  return null;
}
