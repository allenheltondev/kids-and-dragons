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
}

export interface GameRepository {
  // --- household, players, devices -----------------------------------------
  putHousehold(household: Household): Promise<void>;
  getHousehold(householdId: string): Promise<Household | null>;
  /** `ACCT#<sub>` → households. Sign-in lookup; an adult may own more than one. */
  putAccountPointer(cognitoSub: string, householdId: string): Promise<void>;
  listHouseholdsForAccount(cognitoSub: string): Promise<string[]>;

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
