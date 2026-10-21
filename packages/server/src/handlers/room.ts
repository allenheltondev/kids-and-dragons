/**
 * Room lifecycle — architecture §4.5 ("Joining a session").
 *
 * `POST /room` → a 4-letter code. `POST /room/:code/join` → a room-scoped
 * session token and the current state.
 *
 * The rule this file exists to protect: **there is no "who are you?" step.**
 * `joinRoom` takes an already-resolved device principal. It cannot ask for a
 * name, because it is not given a way to accept one. A device scans the code
 * and its character is already on the board.
 */

import { tableFull, VISITOR_CODE_EXTRA } from "@kad/shared";
import type {
  CreateRoomResponse,
  JoinRoomResponse,
  RoomMode,
  RoomSeat,
  RunState,
} from "@kad/shared";
import type { DeviceIdentity } from "../identity.ts";
import type { EventRecord, RoomRecord } from "../store/repository.ts";
import { diff } from "../json-patch.ts";
import { newId, newSecret } from "../ids.ts";
import { addPlayer, createGuestHousehold, keepGuestHousehold, mayClaim, type BoundDevice } from "./account.ts";
import { notePlayed } from "./retention.ts";
import { lobbyCampaigns, seatedParty } from "./progression.ts";
import { loadBook } from "./field-guide.ts";
import { isRemoved } from "./remove.ts";
import { closeIfIdle, isClosed } from "./host.ts";
import { savedGameView } from "./save.ts";
import { fail, iso, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";

/**
 * No I, O, 0, or 1 (§4.5). Read aloud across a living room, `I`/`1` and `O`/`0`
 * are the same letter; and the code is read aloud far more often than it is
 * typed. Digits are dropped entirely rather than partially — a mixed alphabet
 * makes "is that a letter or a number?" a question again.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;

/** §3: room items carry a 6-hour TTL so abandoned rooms clean themselves up. */
export const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * 24^4 = 331,776 codes. With a handful of live rooms a collision is vanishingly
 * unlikely, but the conditional write is what makes it *impossible* rather than
 * unlikely — two families cannot be handed the same code by a race.
 */
const MAX_CODE_ATTEMPTS = 12;

export function generateRoomCode(random: () => number): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const index = Math.floor(random() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[index] ?? ROOM_CODE_ALPHABET[0];
  }
  return code;
}

export interface CreateRoomInput {
  householdId: string;
  mode: RoomMode;
  campaignId?: string | null;
  /**
   * The TV opened it (`RoomRecord.claimable`): `householdId` is the TV's
   * placeholder, and the first phone to join decides whose room it is.
   */
  claimable?: boolean;
  /** The device asking for the room, which becomes its host (`RoomRecord.hostDeviceId`). */
  hostDeviceId?: string;
  /** A family tablet is the TV (`RoomRecord.display`): nobody seated, not claimable. */
  display?: boolean;
}

export async function createRoom(
  input: CreateRoomInput,
  deps: HandlerDeps,
): Promise<HandlerResult<CreateRoomResponse>> {
  const household = await deps.repo.getHousehold(input.householdId);
  if (!household) {
    return fail("NOT_FOUND", `no household ${input.householdId}`);
  }
  if (input.mode !== "party" && input.mode !== "travel") {
    return fail("ILLEGAL", `unknown room mode ${String(input.mode)}`);
  }

  const nowMs = deps.now();

  /*
   * A guest's week starts again — and it has to start *before* anything is
   * created under the household, not after. On day eight the household can
   * read as an expired guest here while the sweeper is starting on it; renewing
   * first either wins (the sweep's own condition, `expiresAt <= now`, then
   * fails) or reports the sweep, and then nothing is created: a room returned
   * for a household being deleted would be a lie, and a run written after the
   * sweeper listed the runs would be orphaned.
   */
  if (household.guest) {
    const renewal = await keepGuestHousehold(input.householdId, deps);
    if (renewal === "swept") {
      return fail("NOT_FOUND", `household ${input.householdId} has expired`);
    }
    // The store could not say. Harmless while the household has days left —
    // the sweeper cannot touch it — but past its expiry we cannot rule the
    // sweep out, so ask for a retry rather than guess.
    if (renewal === "error" && household.expiresAt !== undefined && household.expiresAt <= iso(nowMs)) {
      return fail("ILLEGAL", "could not open a room just now; try again");
    }
  }

  const runId = newId("r");
  const campaignId = input.campaignId ?? null;

  const reserved = await reserveCode(
    runId,
    input.householdId,
    input.mode,
    input.claimable === true,
    input.hostDeviceId,
    input.display === true,
    nowMs,
    deps,
  );
  if (!reserved) {
    return fail("ILLEGAL", "could not allocate a room code; try again");
  }

  await deps.repo.putRun({
    id: runId,
    householdId: input.householdId,
    roomCode: reserved.code,
    campaignId,
    status: "active",
    createdAt: iso(nowMs),
    lobbyFor: input.householdId,
    diceSecret: newSecret(),
  });

  // The engine owns the initial state's shape; the room owns its identity.
  const state = deps.engine.createRunState({
    runId,
    roomCode: reserved.code,
    mode: input.mode,
    campaignId,
    now: iso(nowMs),
  });
  // Where the household stands in this room's campaign — and in any other it
  // has part-way through — so the lobby can say which chapter is next, and
  // offer the choice, before anybody taps anything.
  await offerCampaigns(state, input.householdId, campaignId, deps);
  // The household's Field Guide, for every screen in the room (#106) — but
  // not on a TV's claimable room, whose household is only a placeholder until
  // a phone joins (§4.5). That room gets its book at the first join instead
  // (`withFieldGuide`).
  if (input.claimable !== true) {
    const book = await readBook(input.householdId, deps);
    if (book) state.fieldGuide = book;
  }
  await deps.repo.putState(state);

  return ok({
    code: reserved.code,
    runId,
    mode: input.mode,
    expiresAt: reserved.expiresAt,
  });
}

/**
 * Fills in the lobby's campaigns for `householdId` (`RunState.campaignOptions`)
 * and points `campaign` at the first of them — the one a Begin tap plays until
 * somebody votes otherwise. Any votes already cast were cast on a different
 * list, so they go.
 *
 * The first *unlocked* one (#221), when the room's own campaign is locked and
 * something else is on offer: the screens show what a Begin would play, and
 * `lobbyCampaign` skips a locked campaign for the same reason. With every
 * option locked it is the first, and its reason is what the screens show.
 */
async function offerCampaigns(
  state: RunState,
  householdId: string,
  featuredId: string | null,
  deps: HandlerDeps,
): Promise<void> {
  const options = await lobbyCampaigns(householdId, featuredId, deps, seatedParty(state));
  state.campaignOptions = options;
  state.campaignVotes = {};
  // A chapter this household stopped partway, if it left one (#259): the
  // lobby offers to keep going from it.
  const saved = await savedGameView(householdId, deps);
  if (saved) state.saved = saved;
  else delete state.saved;
  const shown = options.find((option) => option.locked === undefined) ?? options[0];
  if (shown) state.campaign = shown;
}

async function reserveCode(
  runId: string,
  householdId: string,
  mode: RoomMode,
  claimable: boolean,
  hostDeviceId: string | undefined,
  display: boolean,
  nowMs: number,
  deps: HandlerDeps,
): Promise<RoomRecord | null> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const room: RoomRecord = {
      code: generateRoomCode(deps.random),
      runId,
      householdId,
      mode,
      createdAt: iso(nowMs),
      expiresAt: iso(nowMs + ROOM_TTL_MS),
      ttl: Math.floor((nowMs + ROOM_TTL_MS) / 1000),
      ...(claimable ? { claimable: true } : {}),
      ...(hostDeviceId ? { hostDeviceId } : {}),
      ...(display ? { display: true as const } : {}),
    };
    // Conditional create: whoever writes the code first owns it.
    if (await deps.repo.putRoomIfAbsent(room)) return room;
  }
  return null;
}

export interface JoinRoomInput {
  code: string;
  /**
   * Resolved from the device token before the handler runs — in prod by an API
   * Gateway authorizer, in dev by `dev-server.ts`. The handler never sees a raw
   * token and never sees a display name.
   */
  principal: Pick<DeviceIdentity, "deviceId" | "householdId" | "playerId">;
  /**
   * What the player is joining on, for the host's roster (`RunState.seats`):
   * a family tablet (#250) says so; anything else is their own phone.
   */
  device?: RoomSeat["device"];
  /**
   * The six-letter code the phone was given, when it was given one: what lets
   * a phone from another household into a room open to visitors (#249).
   */
  visitorCode?: string;
}

/**
 * Settles a TV-opened room on `householdId` if nobody has yet
 * (`RoomRecord.claimable`), and returns the room as it now stands — which, when
 * another phone got there first, names *their* household rather than this one.
 * A room that was never claimable comes back untouched. Null only when the room
 * has expired in the meantime.
 *
 * When the room changes household, the lobby is re-read for the new one: its
 * campaigns, where it stands in each, and the TV sees that on the next patch.
 */
export async function settleRoom(
  room: RoomRecord,
  householdId: string,
  deps: HandlerDeps,
): Promise<HandlerResult<RoomRecord | null>> {
  if (room.claimable !== true) return ok(room);

  const run = await deps.repo.getRun(room.runId);
  if (!run) return fail("NOT_FOUND", `run ${room.runId} is missing`);

  const moving = householdId !== run.householdId;
  if (moving) {
    // As in `createRoom`, and for its reason: a guest household is renewed
    // before anything lands under it, so a run is never moved into a
    // household the sweeper is part-way through deleting.
    const household = await deps.repo.getHousehold(householdId);
    if (!household) return fail("NOT_FOUND", `no household ${householdId}`);
    if (household.guest && (await keepGuestHousehold(householdId, deps)) === "swept") {
      return fail("NOT_FOUND", `household ${householdId} has expired`);
    }
  }

  if (!(await deps.repo.claimRoom({ code: room.code, run, householdId }))) {
    // Somebody settled it first. Go by what it says now.
    return ok(await deps.repo.getRoom(room.code));
  }

  // The lobby is refreshed for the new household by the join that follows
  // (`refreshLobby`), not here: the claim has landed whatever happens next,
  // so the refresh has to be one any later join can redo.
  const { claimable: _claimable, ...rest } = room;
  return ok({ ...rest, householdId });
}

/**
 * The run's state, with its lobby speaking for the household the room now
 * belongs to.
 *
 * A claim moves the room and refreshes the lobby as separate writes, and only
 * the first is guarded by the room being claimable. So the refresh does not
 * hang off the claim: every join compares the run's `lobbyFor` with the room's
 * household and redoes it on a mismatch. A failed lookup, a lost seq race, or
 * a server that died between the writes is repaired by whoever joins next.
 */
async function refreshLobby(room: RoomRecord, deps: HandlerDeps): Promise<RunState | null> {
  const state = await deps.repo.getState(room.runId);
  if (!state) return null;
  const run = await deps.repo.getRun(room.runId);
  if (!run || run.lobbyFor === undefined || run.lobbyFor === room.householdId) return state;

  const rebuilt = structuredClone(state);
  await offerCampaigns(rebuilt, room.householdId, run.campaignId, deps);
  const lobby: Partial<RunState> = {
    campaignOptions: rebuilt.campaignOptions ?? [],
    campaignVotes: {},
    ...(rebuilt.campaign ? { campaign: rebuilt.campaign } : {}),
    ...(rebuilt.saved ? { saved: rebuilt.saved } : {}),
  };
  let current = state;
  for (let attempt = 0; attempt < 3; attempt++) {
    const refreshed: RunState = { ...current, ...lobby };
    if (!rebuilt.saved) delete refreshed.saved;
    const next = await advanceRoom(current, refreshed, "", deps);
    if (next.campaignOptions === lobby.campaignOptions) {
      // Stamped only once the state has landed. If this write is what fails,
      // the next join rebuilds the same lobby again — a wasted patch, not a
      // wrong one.
      await deps.repo.putRun({ ...run, lobbyFor: room.householdId });
      return next;
    }
    current = next;
  }
  // Still behind after three races: this join goes ahead on what the run says
  // now, and the next one tries again.
  return current;
}

/**
 * The household's Field Guide, onto a run that has none yet (#106).
 *
 * A run's book is loaded when the room opens — except on a TV's claimable
 * room, whose household is not known until a phone joins, and on runs
 * persisted before the book existed. Either way the first join of a settled
 * room is where it arrives, as an ordinary logged patch, so the TV that has
 * been showing the lobby gets the family's book on the same broadcast every
 * phone does. Every later join finds it there and costs nothing.
 *
 * After that the run keeps its own copy current (action.ts) and a chapter
 * start re-reads the store, so this is a one-time fill, not a refresh.
 */
async function withFieldGuide(state: RunState, room: RoomRecord, deps: HandlerDeps): Promise<RunState> {
  if (room.claimable === true || state.fieldGuide !== undefined) return state;
  const book = await readBook(room.householdId, deps);
  if (!book) return state;
  return advanceRoom(state, { ...state, fieldGuide: book }, "", deps);
}

/**
 * The household's book, or null when the store cannot say — a join or a room
 * must never fail over a page of the Field Guide. The next join tries again.
 */
async function readBook(householdId: string, deps: HandlerDeps): Promise<RunState["fieldGuide"] | null> {
  try {
    return await loadBook(householdId, deps);
  } catch (err) {
    console.error(`field guide: could not read ${householdId}'s book:`, err);
    return null;
  }
}

export async function joinRoom(
  input: JoinRoomInput,
  deps: HandlerDeps,
): Promise<HandlerResult<JoinRoomResponse>> {
  const found = await deps.repo.getRoom(input.code);
  // Expired rooms read as absent, so a stale code and an unknown code are the
  // same answer — there is nothing useful to tell a phone about either.
  if (!found) return fail("NOT_FOUND", `no open room ${input.code.toUpperCase()}`);

  // On a claimable room the player is checked before anything is claimed: a
  // device whose player is gone must not take a TV's room into its household
  // on the way to being refused. Every other room keeps the household check
  // first, as it always had.
  const claiming = found.claimable === true;
  const early = claiming
    ? await deps.repo.getPlayer(input.principal.householdId, input.principal.playerId)
    : null;
  if (claiming && !early) return fail("NOT_FOUND", `no player ${input.principal.playerId}`);

  // The TV opened this room and nobody has joined yet: this phone's household
  // is the one whose evening it is (`RoomRecord.claimable`).
  const settled = await settleRoom(found, input.principal.householdId, deps);
  if (!settled.ok) return settled;
  const room = settled.value;
  if (!room) return fail("NOT_FOUND", `no open room ${input.code.toUpperCase()}`);

  // The device resolves to a household; that household must own this run
  // (§4.5), unless the room is open to visitors and this phone is one (#249).
  const visiting = room.householdId !== input.principal.householdId;
  const visit: Visit = visiting ? { householdId: input.principal.householdId, visitorCode: input.visitorCode } : null;
  if (visit && !(await mayVisit(room, input.principal.playerId, visit, deps))) {
    return fail("FORBIDDEN", "this device belongs to a different household");
  }

  const player =
    early ?? (await deps.repo.getPlayer(input.principal.householdId, input.principal.playerId));
  if (!player) return fail("NOT_FOUND", `no player ${input.principal.playerId}`);
  // Retired by an organizer (#248): no seat anywhere, whatever this run's
  // `removed` list says yet.
  if (player.retired) return fail("FORBIDDEN", "This player was taken off the list. Ask a grown-up to bring them back.");

  const lobby = await refreshLobby(room, deps);
  if (!lobby) return fail("NOT_FOUND", `run ${room.runId} has no state`);
  // An open room nobody has touched for a while closes rather than let one
  // more phone in (#249), and its code reads as unknown from then on.
  if (await closeIfIdle(room, lobby, deps)) return fail("NOT_FOUND", `no open room ${room.code.toUpperCase()}`);
  // Checked here so a refused join writes nothing, and again on every write
  // that seats them (`seatAndConnect`), so a host's lock or close landing in
  // between is never missed.
  const refused = admission(lobby, player.id, room.code, visit);
  if (refused) return refused;
  const state = await withFieldGuide(lobby, room, deps);

  const seat: RoomSeat = {
    name: player.displayName,
    color: player.color,
    device: input.device ?? "phone",
    ...(visiting ? { homeHouseholdId: input.principal.householdId } : {}),
  };
  const seated = await seatAndConnect(state, player.id, seat, room.code, visit, deps);
  if (!seated.ok) return seated;
  const joined = seated.value;
  // Her retention clock starts again, and a table that is not her home is
  // written down so deleting her later can find it (#252).
  await notePlayed(input.principal.householdId, player.id, room.householdId, deps);
  const host = room.hostDeviceId !== undefined && room.hostDeviceId === input.principal.deviceId;
  if (!host) await announceArrival(joined, player, deps);
  // Which phone may keep this guest household by signing in (#265), so the
  // offer is drawn on that one and no other.
  const household = await deps.repo.getHousehold(room.householdId);
  // A visitor never is: the household is somebody else's.
  const keeper = !visiting && household?.guest === true && mayClaim(household, input.principal.deviceId);

  const sessionToken = await deps.identity.issueSessionToken({
    runId: room.runId,
    roomCode: room.code,
    // The player's own household, which is the room's for everybody but a
    // visitor (#249). A visitor's session names their home, so it reaches
    // their own heroes and, in the room's household, nothing at all.
    householdId: input.principal.householdId,
    playerId: player.id,
    // A session can never outlive its room.
    expiresAt: Date.parse(room.expiresAt),
  });

  return ok({
    runId: room.runId,
    playerId: player.id,
    mode: room.mode,
    sessionToken,
    state: joined,
    ...(host ? { host: true } : {}),
    ...(keeper ? { keeper: true } : {}),
    ...(tableFull(joined, player.id) ? { full: true } : {}),
  });
}

/** A join from another household (#249): whose, and the code it came with. Null for the room's own. */
type Visit = { householdId: string; visitorCode?: string | undefined } | null;

/**
 * Whether a phone from another household may join this run (#249): it is a
 * visitor already on the roster, coming back, or the room is open and the
 * phone has its visitor code. Read from the run, which is where the switch
 * lives, so turning it off stops new visitors at once and leaves the ones
 * already playing in the game.
 */
function visitorAdmitted(state: RunState, playerId: string, visit: NonNullable<Visit>): boolean {
  if (state.seats?.[playerId]?.homeHouseholdId === visit.householdId) return true;
  return (
    state.visitorCode !== undefined &&
    visit.visitorCode !== undefined &&
    visit.visitorCode.toUpperCase() === state.visitorCode
  );
}

/** `visitorAdmitted`, against the run as it stands before anything is read for the join. */
async function mayVisit(room: RoomRecord, playerId: string, visit: NonNullable<Visit>, deps: HandlerDeps): Promise<boolean> {
  const state = await deps.repo.getState(room.runId);
  return state !== null && visitorAdmitted(state, playerId, visit);
}

/**
 * Tells the room who just arrived (`ArrivalMessage`, #267), so a stranger with
 * the code is seen the moment they are in, not after they have made a hero.
 * The host's own join is not news. A failed publish costs the notice, never
 * the join: the phone is already seated by the time this runs.
 */
async function announceArrival(
  state: RunState,
  player: { id: string; displayName: string; color: string },
  deps: HandlerDeps,
): Promise<void> {
  const hero = state.party.find((m) => m.playerId === player.id)?.character.name;
  try {
    await deps.channel.publish(state.roomCode, {
      kind: "arrival",
      seq: state.seq,
      runId: state.runId,
      playerId: player.id,
      name: hero ?? player.displayName,
      color: player.color,
    });
  } catch (err) {
    console.warn("[room] arrival notice not sent", err);
  }
}

export interface WatchRoomResult {
  runId: string;
  mode: RoomMode;
  expiresAt: string;
  /** Read-only, room-scoped, expires with the room. */
  viewerToken: string;
  state: RunState;
  /** This screen opened the room, so it may take a player out (#267). */
  host?: boolean;
}

/**
 * How a display client attaches — the TV in Party Mode (spec §2.1).
 *
 * It has no player and no session, and that is the design: the TV is a
 * screen, and screens do not sign in. What it does have is the device binding
 * it was given when it opened the room, and that is what lets it watch: only
 * the room's host may (#267). In prod the realtime channel is authorised per
 * subscriber, so it gets *something* to present here: a token naming this
 * room and nothing else.
 *
 * Deliberately not a `joinRoom` variant. A viewer is not a party member — it
 * must not appear in `party`, must not affect presence, and must not satisfy any
 * check that expects a player. Sharing the code path is exactly how it would
 * end up doing one of those by accident.
 */
export async function watchRoom(
  input: {
    code: string;
    /**
     * The screen's own device binding. A TV that opened the room keeps it, and
     * presenting it is what lets the TV watch, after a hard refresh too.
     */
    deviceId?: string | undefined;
    /**
     * A shared tablet's household, when the proof is its shared token (#274):
     * the room must be that household's. The tablet's device id is unique to
     * it already; this is the second lock, on the room-code boundary.
     */
    householdId?: string | undefined;
  },
  deps: HandlerDeps,
): Promise<HandlerResult<WatchRoomResult>> {
  const room = await deps.repo.getRoom(input.code);
  if (!room) return fail("NOT_FOUND", `no open room ${input.code.toUpperCase()}`);

  // Only the screen that opened the room may show it (#267). Otherwise anyone
  // with the code could watch the party, unannounced and beyond the reach of
  // Remove; to see the room, a stranger now has to join it, and be seen. A room
  // opened before rooms had a host keeps the old rule until it expires.
  if (room.hostDeviceId !== undefined && room.hostDeviceId !== input.deviceId) {
    return fail("FORBIDDEN", "Only the screen that opened this room can show it.");
  }
  if (input.householdId !== undefined && room.householdId !== input.householdId) {
    return fail("FORBIDDEN", "Only the screen that opened this room can show it.");
  }

  const state = await deps.repo.getState(room.runId);
  if (!state) return fail("NOT_FOUND", `run ${room.runId} has no state`);
  if (await closeIfIdle(room, state, deps)) return fail("NOT_FOUND", `no open room ${input.code.toUpperCase()}`);

  const viewerToken = await deps.identity.issueViewerToken({
    runId: room.runId,
    roomCode: room.code,
    expiresAt: Date.parse(room.expiresAt),
  });
  const host = input.deviceId !== undefined && room.hostDeviceId === input.deviceId;
  return ok({
    runId: room.runId,
    mode: room.mode,
    expiresAt: room.expiresAt,
    viewerToken,
    state,
    ...(host ? { host: true } : {}),
  });
}

/**
 * Whether the run, as it now stands, lets this player in. `null` when it does.
 *
 *  - taken out by the host (#267): no seat, and no way back in
 *  - closed by the host (#263): its code goes with it, so this is the rare
 *    join that read the room in the moment between the two
 *  - locked by the host (#263): only somebody already in the room comes back.
 *    The party counts as well as the roster, for a hero seated in a run from
 *    before the roster existed.
 *  - a visitor (#249), when the room has stopped letting new ones in and
 *    this one is not on the roster already (`visitorAdmitted`)
 */
function admission(state: RunState, playerId: string, code: string, visit: Visit): HandlerResult<never> | null {
  if (isRemoved(state, playerId)) return fail("FORBIDDEN", "This phone was taken out of that game.");
  if (visit && !visitorAdmitted(state, playerId, visit)) {
    return fail("FORBIDDEN", "this device belongs to a different household");
  }
  if (isClosed(state)) return fail("NOT_FOUND", `no open room ${code.toUpperCase()}`);
  const inRoom = state.seats?.[playerId] !== undefined || state.party.some((m) => m.playerId === playerId);
  if (state.locked && !inRoom) {
    return fail("FORBIDDEN", "This game is locked. Ask whoever is running it to unlock it.");
  }
  return null;
}

/**
 * Puts this player on the room's roster (`RunState.seats`, #263), flips
 * `connected` on their party member, and broadcasts the patch: one patch for
 * both, and none when neither changed.
 *
 * A player who has not built a character yet is not in `party` at all, so the
 * roster is the only place the host can see them. When there *is* a member,
 * the rest of the table has to see them come back: this is the reconnect half
 * of "hard-refresh the TV mid-encounter and recover" (§4.3).
 *
 * Admission (`admission`) is checked against every state this writes on top
 * of. The write is conditional on that state's seq, so a lock, close or
 * removal the host commits first makes it lose the race, and the retry reads
 * the run as the host left it and refuses. So does an owner turning visitors
 * off (#249). Checking only the state the join
 * started from let a lock that landed in between seat a newcomer anyway.
 */
async function seatAndConnect(
  state: RunState,
  playerId: string,
  seat: RoomSeat,
  code: string,
  visit: Visit,
  deps: HandlerDeps,
): Promise<HandlerResult<RunState>> {
  // Retried, unlike most of the room's own writes: a seat lost to a race is a
  // kid a locked room would later refuse, so it is worth a second go.
  let current = state;
  for (let attempt = 0; attempt < 3; attempt++) {
    const refused = admission(current, playerId, code, visit);
    if (refused) return refused;
    const member = current.party.find((m) => m.playerId === playerId);
    const reconnecting = member !== undefined && !member.connected;
    const was = current.seats?.[playerId];
    const reseat =
      was === undefined || was.name !== seat.name || was.color !== seat.color || was.device !== seat.device;
    if (!reconnecting && !reseat) return ok(current);

    current = await advanceRoom(
      current,
      {
        ...current,
        seats: { ...current.seats, [playerId]: seat },
        party: reconnecting
          ? current.party.map((m) => (m.playerId === playerId ? { ...m, connected: true } : m))
          : current.party,
      },
      playerId,
      deps,
    );
  }
  // Whatever the last attempt left, it is still checked: three lost races
  // must not end in a seat the run as it now stands would refuse.
  return admission(current, playerId, code, visit) ?? ok(current);
}

/**
 * A change the room makes to its own run, outside any player's intent — a
 * reconnect, or a phone settling the TV's room on its household. One seq, one
 * logged patch, one broadcast, the same as an action.
 */
async function advanceRoom(
  state: RunState,
  changed: RunState,
  playerId: string,
  deps: HandlerDeps,
): Promise<RunState> {
  const nowMs = deps.now();
  const next: RunState = { ...changed, seq: state.seq + 1, updatedAt: iso(nowMs) };
  const patch = diff(state, next);
  const event: EventRecord = {
    seq: next.seq,
    runId: next.runId,
    patch,
    at: iso(nowMs),
    playerId,
  };

  const committed = await deps.repo.commit({
    runId: next.runId,
    expectedSeq: state.seq,
    state: next,
    event,
  });
  // Losing this race is harmless: someone else advanced the run first, so hand
  // the joiner whatever the run says now and let the next action reconcile.
  if (!committed) return (await deps.repo.getState(next.runId)) ?? state;

  await deps.channel.publish(next.roomCode, {
    kind: "patch",
    seq: event.seq,
    runId: event.runId,
    patch: event.patch,
  });
  return next;
}

/**
 * The room a typed code names, and the visitor code when that is what was
 * typed (#249). Four letters are a room's own code. Six are an open room's
 * visitor code, and name the room only while it is open with exactly that
 * code: anything else reads as no room, so a guess at the last two letters
 * is a wrong code like any other, and spends the wrong-code budget.
 */
export async function findRoom(
  code: string,
  deps: Pick<HandlerDeps, "repo">,
): Promise<{ room: RoomRecord; visitorCode?: string } | null> {
  const typed = code.toUpperCase();
  if (typed.length === ROOM_CODE_LENGTH) {
    const room = await deps.repo.getRoom(typed);
    return room ? { room } : null;
  }
  if (typed.length !== ROOM_CODE_LENGTH + VISITOR_CODE_EXTRA) return null;
  const room = await deps.repo.getRoom(typed.slice(0, ROOM_CODE_LENGTH));
  if (!room) return null;
  const state = await deps.repo.getState(room.runId);
  if (state?.visitorCode !== typed || state.closed === true) return null;
  return { room, visitorCode: typed };
}

/**
 * Whether a phone nobody has seen before may come into `room`, and as whom,
 * decided **before** anything is bound to it. Binding first and letting
 * `joinRoom` refuse afterwards would leave a refused phone a member of the
 * room's household anyway, with a month-long token to prove it.
 *
 *  - `family`: a room never opened to visitors, as it always was. Its code is
 *    the family's invitation, and the phone becomes a player in the room's
 *    household. Unless the room is locked (#263): then it is refused, unbound.
 *  - `visitor`: the room is open and the phone brought its visitor code. It
 *    gets a guest household of its own (`bindNewPhone`).
 *  - refused: any other way into a room that has ever been open
 *    (`RunState.visitorsOpened`). The room's four letters were shown to every
 *    visitor, so they no longer prove somebody is family, while the room is
 *    open or after the switch is off. A family's own new phone comes in on the
 *    visitor code while the room is open, and can be moved home later (#251).
 */
export async function admitNewPhone(
  room: RoomRecord,
  visitorCode: string | undefined,
  deps: Pick<HandlerDeps, "repo" | "now" | "channel">,
): Promise<HandlerResult<"family" | "visitor">> {
  const state = await deps.repo.getState(room.runId);
  if (!state) return fail("NOT_FOUND", `run ${room.runId} has no state`);
  // An idle open room is closed by the join that finds it, as `joinRoom`
  // would, and nothing is bound on the way to that.
  if (isClosed(state) || (await closeIfIdle(room, state, deps))) {
    return fail("NOT_FOUND", `no open room ${room.code.toUpperCase()}`);
  }
  if (state.visitorsOpened === true || state.visitorCode !== undefined) {
    if (visitorCode !== undefined && state.visitorCode === visitorCode) return ok("visitor");
    return fail(
      "FORBIDDEN",
      state.visitorCode !== undefined
        ? "New players join this game with its visitor code. Ask whoever is running it."
        : "This game isn't taking new players. Ask whoever is running it.",
    );
  }
  if (state.locked) return fail("FORBIDDEN", "This game is locked. Ask whoever is running it to unlock it.");
  return ok("family");
}

/**
 * A phone nobody has seen before, joining `room`, once `admitNewPhone` has
 * said how: bound on the spot, so it joins in one tap. Into the room's household when it came with the room's
 * own code, as it always was. With a visitor code (#249) it is a visitor, so
 * it gets a guest household of its own instead and joins from there: a
 * friend's new phone must never become a member of the host family, and
 * whatever its hero earns has to go home with it, not stay behind.
 */
export async function bindNewPhone(
  room: RoomRecord,
  admitted: "family" | "visitor",
  input: { displayName: string; userAgent?: string | undefined },
  deps: Pick<HandlerDeps, "repo" | "identity" | "now">,
): Promise<BoundDevice> {
  if (admitted === "visitor") return createGuestHousehold({ displayName: input.displayName, userAgent: input.userAgent }, deps);
  return addPlayer({ householdId: room.householdId, displayName: input.displayName, userAgent: input.userAgent }, deps);
}
