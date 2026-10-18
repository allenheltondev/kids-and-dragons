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
 *     her seat, her nickname and her heroes' names come out of every run
 *     there, its event log included, and its Field Guide credits her finds to
 *     `FORGOTTEN_FINDER` (`forgetEverywhere`).
 *
 * Delete wins (#252, the owner's decision): a hero in the middle of an
 * adventure at another table is deleted all the same, and that table plays
 * on without her. Her profile is gone, so every room door turns her phone
 * away (`isOut`), and a chapter's settlement skips a party member whose hero
 * row is gone, so nothing at that table is left waiting on her.
 *
 * Every delete goes through the sweeper's path and its `sweeping` mark
 * (`repo.deleteHousehold`, `repo.deleteProfile`), never a second one.
 */

import { claimOf, FORGOTTEN_NAME, parseClaim, RETENTION_CHOICES, settleChapterEndVote } from "@kad/shared";
import type { Character, Household, OrganizerHouseholdDeleted, RoomChannel, RunState } from "@kad/shared";
import { diff } from "../json-patch.ts";
import type { EventRecord, ForgetJob } from "../store/repository.ts";
import { summaries } from "./account.ts";
import { fail, iso, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export { FORGOTTEN_NAME };

/** Lost seq races per run before the tidy-up moves on, as host controls allow. */
const FORGET_ATTEMPTS = 3;

/** Retention sweeps per invocation; the schedule catches up, as the guest sweep's does. */
const IDLE_BATCH = 25;

/** What forgetting needs: a channel only when there are screens to tell. */
export type ForgetDeps = Pick<HandlerDeps, "repo" | "now"> & { channel?: RoomChannel };

type Owned = Pick<HandlerDeps, "repo" | "now"> & { channel?: RoomChannel };

/** One kid to forget: the names she went by, and the tables that may have kept them. */
export type Forgetting = Pick<ForgetJob, "playerId" | "nicknames" | "heroes" | "tables">;

/** Forget jobs the sweep retries per invocation. */
const FORGET_BATCH = 25;

// ---------------------------------------------------------------------------
// Deleting one kid
// ---------------------------------------------------------------------------

/**
 * Delete a kid from her home (#252): her profile, heroes, phones and visits,
 * and her names from every save that has them. The caller has proved an owner
 * of `household`, her home. A hero mid-adventure does not stop it.
 */
export async function deleteKid(
  household: Household,
  playerId: string,
  deps: Owned,
): Promise<HandlerResult<{ cleanupPending: boolean }>> {
  // Read before the delete takes her rows with it, and written down before
  // anything goes, so an interrupted delete or a failed scrub is finished by
  // the sweep (`retryForgets`). Forgotten after, so a delete that is refused
  // never touches another table's save.
  const job = await forgetJob(playerId, household.id, "kid", deps);
  await deps.repo.putForget(job);
  if (!(await deps.repo.deleteProfile(household.id, playerId))) {
    await deps.repo.deleteForget(playerId);
    return fail("NOT_FOUND", `no player ${playerId}`);
  }
  const { owed } = await forgetEverywhere([job], deps);
  return ok({ cleanupPending: owed.length > 0 });
}

// ---------------------------------------------------------------------------
// Deleting a household
// ---------------------------------------------------------------------------

/**
 * Delete a household and everything under it (#252), for one of its owners.
 *
 * Only the last owner left (the owner's decision): a group run by several
 * grown-ups (#248) is not one grown-up's to delete. The others leave it
 * first, or its founder takes them off, which they see. A kid whose home it
 * is and whose hero is mid-adventure at another table goes all the same, as
 * when she alone is deleted. A visiting kid's hero lives at her own home and
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

  const kids = await kidsOf(household.id, "household", deps);
  for (const kid of kids) await deps.repo.putForget(kid);
  await deps.repo.deleteHousehold(household.id);
  const { owed } = await forgetEverywhere(kids, deps);
  return ok({
    householdId: household.id,
    households: await summaries(await deps.repo.listHouseholdsForAccount(cognitoSub), deps),
    ...(owed.length > 0 ? { cleanupPending: true as const } : {}),
  });
}

/**
 * Each kid whose home a household is, and the other tables that may have
 * kept her names: its own saves go with it. For a household about to be
 * deleted, by the owner or the guest sweep.
 */
export async function kidsOf(
  householdId: string,
  reason: "household" | "guest",
  deps: Pick<HandlerDeps, "repo" | "now">,
): Promise<ForgetJob[]> {
  const players = await deps.repo.listPlayers(householdId);
  const kids = await Promise.all(players.map((p) => forgetJob(p.id, householdId, reason, deps)));
  return kids.map((kid) => ({ ...kid, tables: kid.tables.filter((t) => t !== householdId) }));
}

/** What forgetting her takes: her names and her tables, read before her rows go. */
async function forgetJob(
  playerId: string,
  home: string,
  reason: ForgetJob["reason"],
  deps: Pick<HandlerDeps, "repo" | "now">,
): Promise<ForgetJob> {
  const [player, characters] = await Promise.all([deps.repo.getPlayer(home, playerId), deps.repo.listCharacters(home)]);
  const heroes = characters.filter((c) => c.ownerPlayerId === playerId);
  return {
    playerId,
    home,
    reason,
    nicknames: player ? [player.displayName] : [],
    heroes: heroes.map((c) => c.name),
    tables: await tablesOf(playerId, home, heroes, deps),
    createdAt: iso(deps.now()),
    attempts: 0,
  };
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
 * spare her, as it does not stop any delete.
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
      const cutoff = iso(nowMs - (household.retentionDays ?? 0) * DAY_MS);
      const job = { ...(await forgetJob(idle.playerId, idle.householdId, "idle", deps)), idleBefore: cutoff };
      await deps.repo.putForget(job);
      if (!(await deps.repo.deleteProfile(idle.householdId, idle.playerId, cutoff))) {
        await deps.repo.deleteForget(idle.playerId);
        result.kept.push(idle.playerId);
        continue;
      }
      await forgetEverywhere([job], deps);
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
 * Take each kid's names out of every table that kept them: every run there
 * (its state and its event log) and its Field Guide. After her profile is
 * gone, so every room door already treats her as out (`isOut`). Each kid's
 * forget job (`ForgetJob`) is what makes it finish: a table that could not be
 * cleaned is kept on it, and the sweep tries again (`retryForgets`); once
 * every table is clean the job is removed. Returns the runs changed, and the
 * kids some table still names (`owed`), whose jobs stay for the sweep.
 */
export async function forgetEverywhere(
  kids: readonly ForgetJob[],
  deps: ForgetDeps,
): Promise<{ changed: number; owed: string[] }> {
  let changed = 0;
  const pending: string[] = [];
  for (const kid of kids) {
    const owed: string[] = [];
    for (const table of kid.tables) {
      try {
        await deps.repo.forgetFinder(table, kid.playerId);
        for (const run of await deps.repo.listRuns(table)) {
          if (await forgetInRun(run.id, kid, deps)) changed++;
          await forgetInLog(run.id, kid, deps);
        }
      } catch (err) {
        console.error(`forget: could not take ${kid.playerId} out of ${table}; the sweep will try again:`, err);
        owed.push(table);
      }
    }
    if (owed.length === 0) {
      await deps.repo.deleteForget(kid.playerId);
    } else {
      await deps.repo.putForget({ ...kid, tables: owed, attempts: kid.attempts + 1 });
      pending.push(kid.playerId);
    }
  }
  return { changed, owed: pending };
}

export interface ForgetRetryResult {
  finished: string[];
  /** Still here: the delete that wrote the job never happened. Nothing to forget. */
  dropped: string[];
  owed: string[];
}

/**
 * Finish every forget job still owed (#252), from the sweep. First the delete
 * that wrote it, in case it died before or during its rows going: an owner's
 * delete is finished (it was asked for and authorized), a sweep's is asked
 * again under its own gate. Then, if she is gone, the tables still owed. A
 * kid still here (the delete was refused, or a guest household was kept in
 * time) is not forgotten anywhere, and her job is dropped.
 */
export async function retryForgets(deps: ForgetDeps): Promise<ForgetRetryResult> {
  const result: ForgetRetryResult = { finished: [], dropped: [], owed: [] };
  const nowIso = iso(deps.now());
  for (const job of await deps.repo.listForgets(FORGET_BATCH)) {
    try {
      switch (job.reason) {
        case "kid":
          await deps.repo.deleteProfile(job.home, job.playerId);
          break;
        case "household":
          await deps.repo.deleteHousehold(job.home);
          break;
        case "guest":
          await deps.repo.deleteGuestHousehold(job.home, nowIso);
          break;
        case "idle":
          await deps.repo.deleteProfile(job.home, job.playerId, job.idleBefore);
          break;
      }
      if (await deps.repo.getPlayer(job.home, job.playerId)) {
        await deps.repo.deleteForget(job.playerId);
        result.dropped.push(job.playerId);
        continue;
      }
      const { owed } = await forgetEverywhere([job], deps);
      (owed.length > 0 ? result.owed : result.finished).push(job.playerId);
    } catch (err) {
      console.error(`[sweep] could not finish forgetting ${job.playerId}:`, err);
      result.owed.push(job.playerId);
    }
  }
  return result;
}

/** `forgetPlayer` on one run, committed as a turn of its own. False when there was nothing to forget. */
async function forgetInRun(runId: string, kid: Forgetting, deps: ForgetDeps): Promise<boolean> {
  for (let attempt = 1; attempt <= FORGET_ATTEMPTS; attempt++) {
    const state = await deps.repo.getState(runId);
    if (!state) return false;
    const changed = forgetPlayer(state, kid);
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

/** Events read per page while the log is rewritten. */
const LOG_PAGE = 200;

/**
 * Her names out of a run's event log: every event that carries one is put
 * back, same seq, without it. Her player id stays where an event names its
 * author: an id that names nobody once she is gone.
 */
async function forgetInLog(runId: string, kid: Forgetting, deps: Pick<HandlerDeps, "repo">): Promise<void> {
  for (let since = 0; ; ) {
    const page = await deps.repo.listEvents(runId, since, LOG_PAGE);
    for (const event of page) {
      const names = namesIn(kid, null);
      const clean = scrubNames(event, names);
      if (clean !== event) await deps.repo.rewriteEvent(clean);
    }
    if (page.length < LOG_PAGE) return;
    since = page[page.length - 1]!.seq;
  }
}

/**
 * A save that no longer names her: her seat (her nickname and color) is gone,
 * and her hero, if she had one here, is out of the party before play has
 * begun (the lobby, making heroes), or kept in it as `FORGOTTEN_NAME` once
 * play has begun, because an encounter's turn order and the table's votes
 * point at party members (remove.ts). She is on `removed`, away, and out of
 * any vote, as a host's Remove leaves her. Her heroes' names are taken out
 * of everything else the save says (the narration, a recap), and her
 * nickname out of every name field. `null` when the save already does not
 * name her.
 */
export function forgetPlayer(state: RunState, kid: Pick<Forgetting, "playerId" | "nicknames" | "heroes">): RunState | null {
  const { playerId } = kid;
  const names = namesIn(kid, state);
  const { [playerId]: _gone, ...seats } = state.seats ?? {};
  const party =
    state.phase === "lobby" || state.phase === "creation"
      ? state.party.filter((m) => m.playerId !== playerId)
      : state.party.map((m) =>
          m.playerId === playerId
            ? { ...m, connected: false, ready: false, character: { ...m.character, name: FORGOTTEN_NAME } }
            : m,
        );
  const named = state.seats?.[playerId] !== undefined || party !== state.party && party.length !== state.party.length;
  const scrubbed = scrubNames({ ...state, party, ...(state.seats ? { seats } : {}) }, names);
  const renamed = JSON.stringify(scrubbed) !== JSON.stringify(state);
  if (!named && !renamed) return null;
  const removed = state.removed?.includes(playerId) ? state.removed : [...(state.removed ?? []), playerId];
  return settleChapterEndVote({ ...scrubbed, removed });
}

/** The names to take out: hers, and whatever this save calls her. */
function namesIn(kid: Pick<Forgetting, "playerId" | "nicknames" | "heroes">, state: RunState | null): Names {
  const member = state?.party.find((m) => m.playerId === kid.playerId);
  const seat = state?.seats?.[kid.playerId];
  const heroes = [...kid.heroes, ...(member && member.character.name !== FORGOTTEN_NAME ? [member.character.name] : [])];
  const nicknames = [...kid.nicknames, ...(seat ? [seat.name] : [])];
  return { heroes: unique(heroes), nicknames: unique(nicknames) };
}

interface Names {
  /** Taken out of every sentence: a hero's name is what the story calls her. */
  heroes: string[];
  /** Taken out of name fields only: a nickname may be a word the story uses too. */
  nicknames: string[];
}

/** Fields that hold a person's name, wherever they are in a save. */
const NAME_KEYS = new Set(["name", "displayName", "playerName"]);

/**
 * `value` with every hero name in its sentences, and every nickname in a
 * name field, replaced by `FORGOTTEN_NAME`. The same object back when there
 * was nothing to replace. An id-shaped string (lower case, no spaces) is
 * never touched, so a hero who shares a word with a scene's id cannot break
 * the save.
 */
export function scrubNames<T>(value: T, names: Names): T {
  if (names.heroes.length === 0 && names.nicknames.length === 0) return value;
  const pattern =
    names.heroes.length > 0
      ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.heroes.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "gu")
      : null;
  const nick = new Set(names.nicknames);
  const walk = (v: unknown, key: string | null): unknown => {
    if (typeof v === "string") {
      if (key !== null && NAME_KEYS.has(key) && nick.has(v)) return FORGOTTEN_NAME;
      if (!pattern || /^[a-z0-9_.:@#/-]*$/.test(v)) return v;
      const out = v.replace(pattern, FORGOTTEN_NAME);
      return out === v ? v : out;
    }
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((item) => {
        const next = walk(item, null);
        if (next !== item) changed = true;
        return next;
      });
      return changed ? out : v;
    }
    if (v !== null && typeof v === "object") {
      let changed = false;
      const out: Record<string, unknown> = {};
      for (const [k, item] of Object.entries(v)) {
        const next = walk(item, k);
        if (next !== item) changed = true;
        out[k] = next;
      }
      return changed ? out : v;
    }
    return v;
  };
  return walk(value, null) as T;
}

function escape(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(names: string[]): string[] {
  return [...new Set(names.filter((n) => n.trim().length > 0 && n !== FORGOTTEN_NAME))];
}
