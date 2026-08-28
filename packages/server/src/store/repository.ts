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

/**
 * `HH#<householdId>` / `CAMPAIGN#<campaignId>` — the campaign setback counter
 * (roadmap chapter 5, spec §8.3).
 *
 * Household-scoped, not run-scoped, because that is the whole reason it
 * exists: "a campaign fails at three setbacks" counts across the weeks a
 * campaign takes, and every one of those evenings is its own run. Counting
 * off `ChapterProgressRecord`s alone cannot work twice — a second attempt at
 * a failed campaign would inherit the first attempt's setbacks and insta-fail
 * on its next stumble. So the counter carries the attempt: a record whose
 * `status` is `complete` or `failed` is a *finished* attempt, and the next
 * chapter completion for that campaign starts a fresh one at zero.
 */
export interface CampaignProgressRecord {
  householdId: string;
  campaignId: string;
  /** `active` is the attempt in flight; anything else is history. */
  status: "active" | "complete" | "failed";
  setbacks: number;
  /**
   * Where this attempt stands — at most one flag from each route set the
   * campaign declares, carried across the evenings the campaign spans.
   *
   * Here rather than on the run for the same reason the setback count is: a
   * campaign is 4-8 chapters over weeks (spec §8.1) and every one of those
   * evenings is a new run whose `flags` start empty. A road chosen at the end
   * of chapter 2 and read at the start of chapter 3 has to survive a drive
   * home, a new room, and three phones that have never seen it — so it
   * belongs to the attempt, beside the counter that already had to.
   *
   * Only flags a campaign declares in `routeSets` are kept. A chapter's own
   * flags — the door it opened, the objective it paid — die at the chapter
   * boundary exactly as they always have; widening this to every flag would
   * quietly make every chapter's leftovers permanent.
   *
   * A set is a fork, so a later choice from it *replaces* the earlier one
   * rather than joining it (`routesTaken`). Two members of one set standing at
   * once is precisely what `chapterFor` refuses to resolve, so accumulating
   * them would strand a re-routed party at the next beat.
   *
   * Absent on rows written before routing existed, and on every campaign
   * without a routed beat.
   */
  routeFlags?: Record<string, boolean>;
  /** Monotonic optimistic-lock version. Rows written before this field are version 0. */
  version?: number;
  updatedAt: string;
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
  /**
   * The progress rows a chapter completion owes, in the same transaction and
   * for the same reason as `characters`: the seq gate is what makes reading
   * the setback counter, deciding the campaign's fate, and writing all of it
   * back a serialized read-modify-write instead of a race two phones can
   * split.
   */
  chapterProgress?: ChapterProgressRecord;
  campaignProgress?: CampaignProgressRecord;
  /**
   * The version read before deriving `campaignProgress`; null means no row
   * existed. The shared household row must win this condition as well as the
   * run's seq condition, because two different runs have independent seqs.
   */
  campaignProgressExpectedVersion?: number | null;
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
  /**
   * Primary-key lookup, **strongly consistent**. The revocation check reads
   * through this, never the GSI: an index read is eventually consistent, so a
   * just-revoked phone could resolve against a pre-revocation copy — and then
   * write that copy back, erasing the revocation. §4.5's "that token is dead
   * immediately" is only true of a read that cannot be stale.
   */
  getDevice(householdId: string, deviceId: string): Promise<DeviceBinding | null>;
  listDevices(householdId: string): Promise<DeviceBinding[]>;
  /** Revocation is a flag, not a delete: characters must survive it (§4.5). */
  revokeDevice(householdId: string, deviceId: string): Promise<void>;
  /**
   * Updates `lastSeen` and nothing else. A full `putDevice` on every resolve
   * was the other half of the revocation race: whatever the item held between
   * read and write — `revoked` above all — got flattened back to the copy in
   * hand. A single-attribute update cannot clobber a flag it never touches.
   * A missing device is a no-op, not an error.
   */
  touchDevice(householdId: string, deviceId: string, lastSeen: string): Promise<void>;

  // --- characters (household-scoped, never run-scoped — §3) ----------------
  /**
   * Unconditionally persists the complete character snapshot, including both
   * committed and provisional progression. Implementations stamp the row with
   * the current character schema version; this is a replacement, not a patch.
   */
  putCharacter(character: Character): Promise<void>;
  /**
   * Returns the character after applying the shared migration ladder to the
   * stored row, or `null` when the household/id pair does not exist.
   */
  getCharacter(householdId: string, characterId: string): Promise<Character | null>;
  listCharacters(householdId: string): Promise<Character[]>;

  // --- runs, state, event log ----------------------------------------------
  putRun(run: RunRecord): Promise<void>;
  getRun(runId: string): Promise<RunRecord | null>;
  listRuns(householdId: string): Promise<RunRecord[]>;

  putChapterProgress(progress: ChapterProgressRecord): Promise<void>;
  listChapterProgress(runId: string): Promise<ChapterProgressRecord[]>;

  /** The setback counter (see `CampaignProgressRecord`). `null` = no attempt yet. */
  getCampaignProgress(householdId: string, campaignId: string): Promise<CampaignProgressRecord | null>;
  putCampaignProgress(progress: CampaignProgressRecord): Promise<void>;

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
