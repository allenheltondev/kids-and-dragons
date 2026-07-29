/**
 * The persistence port — architecture §3.
 *
 * Written in terms of the entities in the single-table model, not in terms of
 * DynamoDB calls, so `MemoryRepository` (dev) and `DynamoRepository` (prod)
 * implement the same surface. Every method here maps to one Query, GetItem,
 * PutItem, or TransactWriteItems; nothing here needs a scan.
 *
 * The only method with real semantics beyond storage is `commit()` — see below.
 */

import type {
  ChapterOutcome,
  Character,
  ClientIntent,
  DeviceBinding,
  Household,
  PlayerProfile,
  RoomMode,
  RunState,
  ServerMessage,
} from "@kad/shared";

/** `RUN#<runId>` / `RUN#<runId>` under the owning household. */
export interface RunRecord {
  id: string;
  householdId: string;
  roomCode: string;
  campaignId: string | null;
  status: "active" | "complete" | "failed";
  createdAt: string;
}

/** `RUN#<runId>` / `CHAPTER#<n>`. */
export interface ChapterProgressRecord {
  runId: string;
  index: number;
  chapterId: string;
  status: "active" | "complete" | "abandoned";
  /**
   * How it ended, once it has (spec §8.2). Orthogonal to `status`: a chapter
   * can be `complete` and still a setback, and the two answer different
   * questions — `status` is lifecycle, this is what happened.
   *
   * Absent means success, matching the scene-level default, so chapters
   * recorded before setbacks existed read correctly rather than needing a
   * migration.
   *
   * This is what §8.3's "a campaign fails at three setbacks" counts. The engine
   * surfaces the outcome on `RunState` and in the CHAPTER_COMPLETE
   * presentation; persisting it here is what lets the count survive a run
   * ending, which it must, because the three chapters are spread across weeks.
   */
  outcome?: ChapterOutcome;
  branch?: string;
  xpEarned: number;
  updatedAt: string;
}

/**
 * `ROOM#<code>` / `META`. **TTL 6 hours** (§3) — abandoned rooms clean
 * themselves up, and `ttl` is the epoch-seconds attribute DynamoDB sweeps on.
 */
export interface RoomRecord {
  code: string;
  runId: string;
  householdId: string;
  mode: RoomMode;
  createdAt: string;
  expiresAt: string;
  /** Epoch **seconds** — DynamoDB TTL attribute. */
  ttl: number;
}

/**
 * `RUN#<runId>` / `EVT#<seq>`. The broadcast payload plus the provenance that
 * makes the log replayable (§4.1): which player's intent produced this seq.
 * `listEvents()` returns these directly as `ServerMessage`s for reconnect.
 */
export interface EventRecord extends ServerMessage {
  at: string;
  playerId?: string;
  intent?: ClientIntent;
}

export interface CommitInput {
  runId: string;
  /** The seq the caller read. The commit fails if the run has moved on. */
  expectedSeq: number;
  state: RunState;
  event: EventRecord;
  /**
   * Character rows this turn owes, written in the **same** conditional
   * transaction as the state and the event.
   *
   * Not a convenience. XP is folded into a character by the same intent that
   * ends a chapter, and writing it separately means a turn that loses the seq
   * race — or hits a transient failure and is retried — can still leave the
   * award on the character. Either the whole turn lands or none of it does.
   */
  characters?: Character[];
}

export interface GameRepository {
  // --- household, players, devices -----------------------------------------
  putHousehold(household: Household): Promise<void>;
  getHousehold(householdId: string): Promise<Household | null>;
  /** `ACCT#<sub>` → households. Sign-in lookup; an adult may own more than one. */
  putAccountPointer(cognitoSub: string, householdId: string): Promise<void>;
  listHouseholdsForAccount(cognitoSub: string): Promise<string[]>;

  /**
   * Claim a guest household for a signed-in account (§4.5). Writes the
   * `ACCT#<sub>` pointer, sets `ownerSub`, clears `guest`/`expiresAt`, and drops
   * the household out of the guest sweep index — so the characters somebody just
   * made anonymously simply stop being scheduled for deletion.
   *
   * Nothing is copied and no id changes: the household the party is *already
   * playing in* becomes the permanent one. Idempotent, and a no-op on a
   * household that is already claimed by this sub.
   *
   * Returns `false` if the household is already claimed by a **different**
   * account — one family's guest session cannot be stolen by the next person to
   * sign in on that phone — or if the sweeper has already begun deleting it.
   */
  claimHousehold(householdId: string, cognitoSub: string): Promise<boolean>;

  /**
   * Guest households whose `expiresAt` has passed. One GSI1 query against the
   * `GUEST` partition — never a scan. Drives the sweeper (`lambda/sweep.ts`).
   */
  listExpiredGuestHouseholds(nowIso: string, limit?: number): Promise<Household[]>;

  /**
   * Deletes a household and everything under it — players, devices, characters,
   * runs, and each run's state and event log. Only the sweeper calls this, and
   * only for expired guests; a claimed household has no delete path at all.
   *
   * **The expiry check is part of this call, not the caller's job.** Reading a
   * household, deciding it is an expired guest, and then deleting it is a race
   * with exactly one loser worth caring about: an adult who signs in during the
   * gap gets a successful claim and then has the household deleted out from
   * under them, which is the one failure this whole feature exists to avoid.
   * So the delete is gated on a conditional write proving the household is
   * *still* an unclaimed, expired guest at the moment deletion begins.
   *
   * Returns `false` when that condition fails — somebody claimed it in time.
   *
   * Deletion is ordered so that an interrupted sweep is safe: the household is
   * first marked (which is what makes `claimHousehold` start refusing), then its
   * contents go, and the `META` row — the only thing carrying the `GUEST` index
   * entry — goes last. A sweep that dies halfway leaves a household that is
   * still discoverable by the next one, rather than orphaned rows nothing can
   * find.
   */
  deleteGuestHousehold(householdId: string, nowIso: string): Promise<boolean>;

  putPlayer(player: PlayerProfile): Promise<void>;
  getPlayer(householdId: string, playerId: string): Promise<PlayerProfile | null>;
  listPlayers(householdId: string): Promise<PlayerProfile[]>;

  putDevice(device: DeviceBinding): Promise<void>;
  /** GSI1 lookup — a returning phone resolves without knowing its household. */
  getDeviceById(deviceId: string): Promise<DeviceBinding | null>;
  listDevices(householdId: string): Promise<DeviceBinding[]>;
  /** Revocation is a flag, not a delete: characters must survive it (§4.5). */
  revokeDevice(householdId: string, deviceId: string): Promise<void>;

  // --- characters (household-scoped, never run-scoped — §3) ----------------
  putCharacter(character: Character): Promise<void>;
  getCharacter(householdId: string, characterId: string): Promise<Character | null>;
  listCharacters(householdId: string): Promise<Character[]>;

  // --- runs, state, event log ----------------------------------------------
  putRun(run: RunRecord): Promise<void>;
  getRun(runId: string): Promise<RunRecord | null>;
  listRuns(householdId: string): Promise<RunRecord[]>;

  putChapterProgress(progress: ChapterProgressRecord): Promise<void>;
  listChapterProgress(runId: string): Promise<ChapterProgressRecord[]>;

  getState(runId: string): Promise<RunState | null>;
  /** Unconditional write. Only for run creation; advancing goes through commit. */
  putState(state: RunState): Promise<void>;

  /**
   * Advance a run by exactly one seq: append `EVT#<seq>` and overwrite `STATE`,
   * together or not at all.
   *
   * Returns `false` when another action got there first (the event already
   * exists, or STATE has moved past `expectedSeq`); the caller turns that into
   * `STALE_SEQ` (§4.2) and the client resyncs. In DynamoDB this is one
   * TransactWriteItems with `attribute_not_exists(SK)` on the event and
   * `seq = :expectedSeq` on the state — which is precisely why the two writes
   * are one repository method instead of two.
   */
  commit(input: CommitInput): Promise<boolean>;

  /** Events with `seq > sinceSeq`, ascending. `limit` caps the replay window. */
  listEvents(runId: string, sinceSeq: number, limit?: number): Promise<EventRecord[]>;

  // --- rooms ----------------------------------------------------------------
  /**
   * Create-if-absent. `false` means the 4-letter code was already taken and the
   * caller should roll another one (`attribute_not_exists(PK)` in DynamoDB).
   */
  putRoomIfAbsent(room: RoomRecord): Promise<boolean>;
  /** Expired rooms read as `null` — TTL sweeps are eventual, reads are not. */
  getRoom(code: string): Promise<RoomRecord | null>;
  deleteRoom(code: string): Promise<void>;
}
