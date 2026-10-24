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
  ChapterStory,
  Character,
  ClientIntent,
  DeviceBinding,
  FieldGuideDiscovery,
  FieldGuideFind,
  FieldGuideRecord,
  Household,
  JourneyState,
  PersonalDeviceBinding,
  PlayerProfile,
  RoomMode,
  RunState,
  ServerMessage,
} from "@kad/shared";

/**
 * `FORGET#<playerId>` (#252): a kid being deleted, and every table that may
 * still say her names. Written before any of her rows go; rewritten with the
 * tables still owed when a scrub fails part-way; removed when none are. The
 * sweeper finishes whatever is left (`retryForgets`).
 */
export interface ForgetJob {
  playerId: string;
  /** Her home: where her own rows were. */
  home: string;
  /**
   * What deleted her, which says how to finish an interrupted delete: an
   * owner deleting her (`kid`) or her household (`household`), the guest
   * sweep (`guest`), or the retention sweep (`idle`, gated on `idleBefore`).
   */
  reason: "kid" | "household" | "guest" | "idle";
  idleBefore?: string;
  /** The names to take out. */
  nicknames: string[];
  heroes: string[];
  /** Tables still to clean. */
  tables: string[];
  createdAt: string;
  /** Scrubs that have failed so far. */
  attempts: number;
}

/** One kid the retention sweep may forget (#252): where she lives, and when she last played. */
export interface IdlePlayer {
  householdId: string;
  playerId: string;
  lastPlayedAt: string;
}

/** What `extendGuestHousehold` did, and why. */
export type GuestRenewal = "extended" | "kept" | "swept";

/** `RUN#<runId>` / `RUN#<runId>` under the owning household. */
export interface RunRecord {
  id: string;
  householdId: string;
  roomCode: string;
  campaignId: string | null;
  status: "active" | "complete" | "failed";
  createdAt: string;
  /**
   * The household the run state's lobby (`RunState.campaignOptions`) was
   * last built for. A phone claiming a TV's room moves the room and this row
   * first and refreshes the lobby second, as separate writes; until the
   * refresh lands this still names the TV's household, and the next join
   * sees the mismatch and refreshes again (`refreshLobby` in room.ts). On the
   * run row rather than the run state because the state goes to every screen,
   * the unauthenticated TV included, and a household id has no business there.
   * Absent on runs created before it existed, which were never claimable.
   */
  lobbyFor?: string;
  /**
   * The secret half of every dice seed in this run (handlers/action.ts). The
   * public half, `runId:seq`, is on every screen; without this, anybody who
   * knew the run id could work out the next roll and stall until it was a 20.
   * Here, not on the run state, for the same reason as `lobbyFor`: the state
   * goes to every screen. Absent on runs created before it existed, which keep
   * rolling from the public seed so their event logs still replay.
   */
  diceSecret?: string;
  /**
   * The host stopped this run partway through a chapter to pick it up another
   * day (#259, handlers/save.ts). With the run's state closed, this is what
   * makes it a saved game the household's next room offers. On the run row
   * for the reason `lobbyFor` is: a household id and a clock have no business
   * on the state every screen receives. Cleared when the game is taken up, or
   * when a later stop of the same campaign replaces it. Absent on every run
   * that was not stopped, which is nearly all of them.
   */
  stoppedAt?: string;
  /**
   * The device that opened the room it was stopped in (`RoomRecord.hostDeviceId`,
   * which is gone with the code). It is how the stopped table's host is still
   * known to be the host, to let a hero go from the game (handlers/save.ts,
   * `releaseSavedHero`). Written and cleared with `stoppedAt`.
   */
  stoppedBy?: string;
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
  /**
   * The party's purse as the last finished chapter left it (`RunState.coins`),
   * seeded back into the next chapter's run. Here for the reason `routeFlags`
   * is: coins earned on one evening are still in the pack on the next, and the
   * next evening is a new run. A fresh attempt starts with an empty purse.
   * Absent on rows written before the purse existed, read as 0.
   */
  coins?: number;
  /**
   * The beat (chapter `index`) this attempt most recently finished — what
   * "continue the campaign" counts from. A campaign spans evenings and every
   * evening is a new run, so where the party got to has to live on the
   * attempt, beside the road it took. Absent means nothing finished yet.
   */
  lastIndex?: number;
  /**
   * Which attempt this is. A fresh one is minted whenever an attempt starts,
   * so a room still playing a chapter of an attempt that has since finished
   * (and been replaced) can be told apart from one playing the current attempt
   * at the same beat. Absent on rows written before it existed.
   */
  attemptId?: string;
  /**
   * An earlier attempt at this campaign was completed (#221). There is one row
   * per household campaign, so a replay overwrites the `complete` row it
   * starts over, and this is what keeps the fact a campaign prerequisite
   * reads ("the household has finished Gemfall") alive through it.
   *
   * Written when a new attempt replaces a `complete` row (or one already
   * carrying it) and carried by every attempt after, whatever they end in. A
   * completing attempt does not write it: its `status` already says so, which
   * keeps a finished row exactly the shape it always was. A failed or
   * abandoned attempt never sets it. Absent on every row written before it
   * existed, which still counts as completed when its `status` is `complete`
   * (`hasCompleted`).
   */
  everCompleted?: true;
  /**
   * Where a **graph** campaign's attempt stands (#194): the node, the visit,
   * whether it is being played or an exit is being chosen, and everything the
   * edges' guards read — visits, completions, outcomes, edges taken, lock
   * overrides, journey flags, the chapters that have paid XP. Moved only by
   * shared `journey.ts` (`completeVisit` at settlement, `takeExit` on
   * CHOOSE_EXIT) and written through the same conditional commit as the rest
   * of this row, under `version` — so two rooms finishing one visit, or two
   * phones taking one exit, cannot both land, and the loser's retry is
   * answered as a duplicate rather than applied twice.
   *
   * On this row, beside the setback counter and the route flags, for the
   * reason they are here: the journey spans evenings, and every evening is a
   * new run.
   *
   * **Absent on every ordered campaign's attempt** — Gemfall's, every row
   * written before graphs existed — which reads exactly as it always did;
   * nothing on the ordered path looks at this field. Absent on a graph
   * campaign's attempt means nothing has been written yet and reads as a fresh
   * start at the entry (`resumeJourney`). Carries its own `version`
   * (`JOURNEY_VERSION`); a row from a newer build is refused, not guessed at
   * (`readJourney`). For a graph campaign `lastIndex` and `routeFlags` are not
   * maintained — the journey is the whole of where the party got to.
   */
  journey?: JourneyState;
  /**
   * What this attempt kept of each chapter it finished, oldest first, for the
   * adventure book's Story page (#358): the ending, the priority-1 scenes, the
   * route-set flags it decided and the items those words read. Ids only
   * (story-so-far.ts). Appended at every chapter settlement, ordered or graph,
   * setback or not; a fresh attempt starts without one. Nothing at play time
   * reads it. Absent on every row written before it existed, which the page
   * still lists by title where the row can say which chapters they were.
   */
  story?: ChapterStory[];
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
  /**
   * A room the TV opened, whose household is not settled yet (architecture
   * §4.5, "The TV, which is nobody"). The TV's own household is only a
   * placeholder: the first phone to join decides whose evening this is, and a
   * phone that already belongs to a household takes the room *into* it — run
   * and all — so its campaigns and heroes come with it whichever screen
   * opened the lobby. Cleared by that first join (`claimRoom`); absent on
   * every other room.
   */
  claimable?: boolean;
  /**
   * The device that opened the room: the TV in Party Mode, the host's phone in
   * Travel Mode. It is the one that may take a player out (#267, `removePlayer`).
   * It stays the host when a phone settles a TV's room on its household. Absent
   * on rooms opened before it existed, which then have no host.
   */
  hostDeviceId?: string;
  /**
   * A Party Mode room whose host is a family tablet acting as the TV (#274):
   * nobody is seated on it, and its household is the tablet's own, so it is
   * never claimable. It is what lets the tablet's shared token alone run the
   * room's host controls (`tabletHost`): there is no seated kid to present a
   * session. A tablet that opened a room to play has a seated kid and no flag.
   */
  display?: true;
}

/**
 * `RUN#<runId>` / `EVT#<seq>`. The broadcast payload plus the provenance that
 * makes the log replayable (§4.1): which player's intent produced this seq.
 * `listEvents()` returns these directly as `ServerMessage`s for reconnect.
 */
export interface EventRecord extends Omit<ServerMessage, "discovered"> {
  // `discovered` is excluded on purpose: it is the live-only "new entry"
  // signal, and anything in the log is replayed by a reconnect (§4.3).
  at: string;
  playerId?: string;
  intent?: ClientIntent;
}

/**
 * One write to a hero's row under her claim (#282, architecture §4.5, "One
 * game at a time per hero: the claim"). The row lands only if it still stands
 * as it was read: its `version` is `expectedVersion` and its claim
 * (`provisional.runId`) is `expectedClaim`. A different table, a run that lost
 * the claim, or a worker holding an old read fails, and re-reads.
 *
 * Acquiring the claim, holding it and releasing it are all this one shape: the
 * row written names the new claim (or none), and the conditions name the one
 * read. Because every write bumps the version, two runs that read the same free
 * or finished hero cannot both win her.
 */
export interface CharacterWrite {
  /**
   * The row as it should stand. Its `version` is ignored: the store writes
   * `expectedVersion + 1`, or 1 for a new hero.
   */
  character: Character;
  /** The version read; absent on the row is 0. Null: a new hero, whose row must not exist. */
  expectedVersion: number | null;
  /** The claim read (`provisional.runId`), null for none. Not checked for a new hero. */
  expectedClaim: string | null;
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
   *
   * Each one is conditioned on the hero's claim and the version read
   * (`CharacterWrite`), so a hero another table has since claimed, or written,
   * fails the whole transaction exactly as a lost seq race does.
   */
  characters?: CharacterWrite[];
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
  /**
   * Make `deviceId` the household's founder, in the same transaction as the
   * state and the event (#272): the host handing the keeper role to a phone in
   * the room, which the run records as `keeperPlayerId`. One write, so the
   * household and the screens can never disagree about who may keep it, with
   * nothing to roll back when two hand-overs overlap or the run loses its
   * seq race. Whoever it was or was not until now (dropped, awaiting, from
   * before founders). Conditional on a guest household nobody has kept and the
   * sweeper has not begun on, as the claim is: when it does not hold the whole
   * commit is refused, exactly as a lost seq race is.
   */
  founder?: { householdId: string; deviceId: string };
  /**
   * Take `deviceId` off the household as its founder, in the same transaction
   * as the state and the event (#272): a host's Remove of the phone that kept
   * the game. Leaves nobody (`founderDeviceId: ""`, never absent, which would
   * read as a household from before founders), as `dropFounder` does.
   * Conditional on `deviceId` still being the founder: when it is not, the
   * whole commit is refused as a lost seq race is, and the caller reads the
   * household again. Never together with `founder`, which writes the same row.
   */
  unfound?: { householdId: string; deviceId: string };
}

/** `HH#<hhId>` / `OWNER#<sub>`: one grown-up who may manage the household (#248). */
export interface HouseholdOwnerRecord {
  householdId: string;
  cognitoSub: string;
  /** As they signed in, so the other owners can tell who is who. */
  email?: string;
  addedAt: string;
}

/**
 * `INVITE#<code>` / `META`: a single-use code that makes whoever signs in
 * with it an owner of `householdId` (#248). TTL'd like a room.
 */
export interface OrganizerInviteRecord {
  code: string;
  householdId: string;
  /** The owner who asked for it. */
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  /** Epoch seconds. DynamoDB deletes it some time after; reads check `expiresAt`. */
  ttl: number;
}

/**
 * `TRANSFER#<code>` / `META`: a single-use code that moves one kid, her heroes
 * and her finds out of `householdId` and into whichever home redeems it (#251).
 * TTL'd like an invite.
 */
export interface TransferCodeRecord {
  code: string;
  /** The home she is moving out of. */
  householdId: string;
  playerId: string;
  /** The owner of that home who asked for it. */
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  /** Epoch seconds. DynamoDB deletes it some time after; reads check `expiresAt`. */
  ttl: number;
}

/**
 * `PAIR#<code>` / `META`: a single-use code that makes whoever redeems it a
 * device bound to one kid (#281). TTL'd like an invite, but minutes, not days.
 */
export interface PairingCodeRecord {
  code: string;
  householdId: string;
  playerId: string;
  /** `device:<deviceId>` for her own phone, `owner:<cognitoSub>` for a grown-up. */
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  /** Epoch seconds. DynamoDB deletes it some time after; reads check `expiresAt`. */
  ttl: number;
}

/**
 * Everything that moves with one kid, as `readProfileMove` found it: what a
 * handler needs to judge the move, and (`rows`) what the store needs to carry
 * it out exactly as read.
 */
export interface ProfileMove {
  householdId: string;
  player: PlayerProfile;
  /** Her heroes that read cleanly. A row that does not still moves, as it is. */
  characters: Character[];
  /** Her own phones, revoked ones included: those are dropped, not moved. */
  devices: PersonalDeviceBinding[];
  /** The entries in the household's Field Guide she found first. */
  finds: Record<string, FieldGuideFind>;
  /** The rows as stored. The store's own; nothing above it reads this. */
  readonly rows: unknown;
}

export interface MoveProfileInput {
  move: ProfileMove;
  /** Spent by the same transaction. It must name this kid in this household. */
  code: string;
  nowIso: string;
  /** A home the redeemer owns, or a new one made for her with them as its owner. */
  to: { householdId: string } | { household: Household; owner: HouseholdOwnerRecord };
  /**
   * Epoch seconds the forwarding rows for her phones live until
   * (`getMovedDevice`): past the life of any token naming her old home.
   */
  forwardTtl: number;
}

/**
 * What `moveProfile` did. `spent`: the code is gone, expired, or names
 * somebody else. `changed`: a row was written since `readProfileMove`, or the
 * new home went, and nothing moved (read again and retry). `too-big`: more
 * rows than one transaction holds (`MOVE_ITEM_LIMIT`), and nothing moved.
 */
export type MoveOutcome = "moved" | "spent" | "changed" | "too-big";

/**
 * A kid's own phone's Web Push subscription (#466): where the push service
 * delivers "It's your turn" while the app is in the background. What the
 * browser's `PushSubscription.toJSON()` gives, and whose phone it is.
 *
 * Nothing about the kid but her id: the endpoint is the push service's
 * address for this browser, and the keys encrypt a payload that only ever
 * says the one fixed sentence (#320).
 */
export interface PushSubscriptionRecord {
  playerId: string;
  /** Her household when she subscribed. The send reads her device binding, not this. */
  householdId: string;
  deviceId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: string;
}

export interface GameRepository {
  // --- household, players, devices -----------------------------------------
  putHousehold(household: Household): Promise<void>;
  getHousehold(householdId: string): Promise<Household | null>;
  /** `ACCT#<sub>` → households. Sign-in lookup; an account may own more than one. */
  putAccountPointer(cognitoSub: string, householdId: string): Promise<void>;
  listHouseholdsForAccount(cognitoSub: string): Promise<string[]>;

  /**
   * Make `owner.cognitoSub` an owner of the household (#248): its `ACCT#`
   * pointer, which is the authority every guard reads, and an `OWNER#` row in
   * the household, which is how the household lists its owners. One
   * transaction, so neither exists without the other. Idempotent; a second
   * call refreshes the row (an email learned later).
   */
  putOwner(owner: HouseholdOwnerRecord): Promise<void>;
  /** The household's `OWNER#` rows. A founding owner from before #248 has none. */
  listOwners(householdId: string): Promise<HouseholdOwnerRecord[]>;
  /** Both halves of `putOwner`, together. A no-op for somebody who is not an owner. */
  removeOwner(householdId: string, cognitoSub: string): Promise<void>;

  /** A new organizer invite. `false`, and nothing written, if the code is taken. */
  putOrganizerInviteIfAbsent(invite: OrganizerInviteRecord): Promise<boolean>;
  /**
   * Redeem an invite: spend it and make `owner` an owner of its household
   * (both halves of `putOwner`), in **one transaction**, which also checks the
   * household is there and not being deleted (#252), so a code made before a
   * delete never hands out a pointer to nothing. A code is never spent
   * without the membership it pays for, so a failure leaves it redeemable, and
   * of two grown-ups typing one code exactly one gets it. `null`, and nothing
   * written, for a code that was never issued, is spent, or has expired
   * (`nowIso` past `expiresAt`).
   */
  redeemOrganizerInvite(
    code: string,
    nowIso: string,
    owner: Omit<HouseholdOwnerRecord, "householdId">,
  ): Promise<OrganizerInviteRecord | null>;

  /** A new transfer code (#251). `false`, and nothing written, if the code is taken. */
  putTransferCodeIfAbsent(record: TransferCodeRecord): Promise<boolean>;
  /** A transfer code that is still good at `nowIso`, or `null`. Spends nothing. */
  getTransferCode(code: string, nowIso: string): Promise<TransferCodeRecord | null>;
  /**
   * Everything that would move with one kid (`ProfileMove`): her profile,
   * the characters she owns, her personal device bindings, and her first
   * finds in the household's Field Guide. `null` when she is not there.
   */
  readProfileMove(householdId: string, playerId: string): Promise<ProfileMove | null>;
  /**
   * Move a kid to another home (#251), in **one transaction**: the code is
   * spent; her profile, heroes and live personal bindings are deleted from the
   * old home and written under the new one with every id unchanged; each moved
   * binding leaves a forward behind (`getMovedDevice`); her finds are added to
   * the new home's book, first finder wins; and a new home, when that is where
   * she is going, is created with its owner's two rows.
   *
   * Every row deleted is conditioned on being exactly the row read, so a hero
   * written in between (a level, a claim) cancels the move instead of being
   * flattened back. Nothing is copied: she is in one home or the other, never
   * both, and never neither. Table saves (runs, campaign progress) are not
   * hers and do not move. See `MoveOutcome` for the refusals.
   */
  moveProfile(input: MoveProfileInput): Promise<MoveOutcome>;
  /**
   * Where a phone that was moved out of `householdId` went: the household its
   * binding now lives in, or `null`. Strongly consistent, like `getDevice`,
   * because a moved phone's token is resolved through it.
   */
  getMovedDevice(householdId: string, deviceId: string): Promise<string | null>;
  /** A new pairing code. `false`, and nothing written, if the code is taken. */
  putPairingCodeIfAbsent(pairing: PairingCodeRecord): Promise<boolean>;
  /**
   * Spend a pairing code: a conditional delete, so of two devices redeeming
   * one code exactly one gets it. `null`, and nothing written, for a code that
   * was never issued, is spent, or has expired (`nowIso` past `expiresAt`).
   */
  redeemPairingCode(code: string, nowIso: string): Promise<PairingCodeRecord | null>;

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
   * sign in on that phone — if the sweeper has already begun deleting it, or if
   * `deviceId` is not the household's founder (`Household.founderDeviceId`,
   * #265). A household from before founders (neither field) is claimable from
   * any device until it expires. The founder is checked in the same write as the claim, so a founder
   * dropped a moment ago (`dropFounder`) cannot claim on a stale read.
   */
  claimHousehold(householdId: string, cognitoSub: string, deviceId: string): Promise<boolean>;
  /**
   * Make `deviceId` the household's founder, if it is still awaiting one
   * (`Household.awaitingFounder`). One conditional write, so of two phones
   * joining a TV's room at once exactly one founds it. False when the
   * household already has a founder, never had a vacancy, or is being swept.
   */
  takeFounding(householdId: string, deviceId: string): Promise<boolean>;
  /**
   * Take `deviceId` off the household as its founder, and leave nobody in its
   * place (`founderDeviceId: ""`, never absent, which would read as a
   * household from before founders): the household can no longer be claimed by signing in. For a host
   * taking out a phone that founded a TV's household (#267). A no-op when
   * `deviceId` is not the founder.
   */
  dropFounder(householdId: string, deviceId: string): Promise<void>;
  /**
   * Push a guest household's expiry out to `expiresAt` because somebody is
   * playing in it (§4.5): the 7-day window runs from the last time the family
   * played, not from the first, so an eight-evening campaign is never swept
   * out from under them mid-way.
   *
   * Forward only, guests only, and refused once a sweep has begun — the same
   * `sweeping` interlock `claimHousehold` honours, so it can never resurrect a
   * household whose characters are already being deleted. A household that
   * has expired but not yet been swept *is* rescued: the family came back,
   * and the sweep's own condition (`expiresAt <= now`) then leaves it alone.
   *
   * Says why, because a caller about to create something under the household
   * has to tell the cases apart: `extended` (the expiry moved), `kept` (benign
   * — already that late, or claimed and never swept), or `swept` (the sweeper
   * has begun, or the household is gone: nothing should be created under it).
   */
  extendGuestHousehold(householdId: string, expiresAt: string): Promise<GuestRenewal>;

  /**
   * Guest households whose `expiresAt` has passed. One GSI1 query against the
   * `GUEST` partition — never a scan. Drives the sweeper (`lambda/sweep.ts`).
   */
  listExpiredGuestHouseholds(nowIso: string, limit?: number): Promise<Household[]>;

  /**
   * Deletes a household and everything under it — players, devices, characters,
   * runs, and each run's state and event log, and each kid's visits and push
   * subscriptions (#466), which are keyed by her. Only the sweeper calls this, and
   * only for expired guests; a claimed household is deleted only by its owner
   * (`deleteHousehold`), which shares every step below but the gate.
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

  /**
   * An owner's "delete our data" (#252): the household and everything under
   * it, exactly as the sweep deletes an expired guest, by the same path and
   * behind the same `sweeping` mark, so a claim, a renewal, a founding or an
   * organizer invite landing during it is refused. Also every owner's `ACCT#`
   * pointer to it. The only difference from the sweep is the gate: the caller
   * has proved a signed-in owner, so nothing about expiry is checked. A
   * visiting kid's hero is not here (it lives at her own home) and is not
   * touched. `false` when there is no household.
   */
  deleteHousehold(householdId: string): Promise<boolean>;

  /**
   * Delete one kid (#252): her profile, every hero she owns, her own phones'
   * bindings, their push subscriptions (#466) and her visits, all from her
   * home `householdId`. The profile is
   * marked first (`sweeping`, as a household is), and a marked profile reads
   * as gone from then on (`getPlayer`, `listPlayers`), so every room door
   * treats her as out while the rest goes; the profile row goes last, so an
   * interrupted delete is found and finished by the next. Her credit in a
   * Field Guide is an id that names nobody afterwards; the entry is the
   * table's book and stays, as it does when she moves (#251).
   *
   * `idleBefore`: the retention sweep's gate, checked in the marking write.
   * Only a kid whose `lastPlayedAt` is at or before it is deleted, so a kid
   * who played a moment ago is spared. `false` when the gate fails or she is
   * not there.
   */
  deleteProfile(householdId: string, playerId: string, idleBefore?: string): Promise<boolean>;

  /**
   * A kid just played (#252): `lastPlayedAt`, and her place in the retention
   * sweep (`GSI1_IDLE`) at `keepUntil`, or out of it when `null` (her
   * household keeps everybody). Bookkeeping beside the profile, never in it,
   * so it survives a `putPlayer`. A no-op for a profile that is gone or being
   * deleted.
   */
  touchPlayer(householdId: string, playerId: string, lastPlayedAt: string, keepUntil: string | null): Promise<void>;
  /** When she last played, or `null` when no join has said so since #252. */
  getLastPlayed(householdId: string, playerId: string): Promise<string | null>;
  /** Kids whose `keepUntil` has passed: one GSI1 query, like the guest sweep. */
  listIdlePlayers(nowIso: string, limit?: number): Promise<IdlePlayer[]>;

  /**
   * Put an event back with its contents changed and its seq unchanged: a
   * deleted kid's names taken out of a table's log (#252). Only an event
   * that is there; the log never grows by this.
   */
  rewriteEvent(event: EventRecord): Promise<void>;
  /**
   * Every entry in the household's Field Guide that `playerId` found first
   * now credits `FORGOTTEN_FINDER` instead (#252): the entry is the table's
   * book and stays, and stops naming her. Returns how many changed.
   */
  forgetFinder(householdId: string, playerId: string): Promise<number>;

  /** Write (or rewrite) a forget job (#252). */
  putForget(job: ForgetJob): Promise<void>;
  /** Forget jobs still owed, oldest first: one GSI1 query. */
  listForgets(limit?: number): Promise<ForgetJob[]>;
  deleteForget(playerId: string): Promise<void>;

  /** She sat down at `tableHouseholdId`, a household that is not her home (#249). Idempotent. */
  putVisit(playerId: string, tableHouseholdId: string, at: string): Promise<void>;
  /** Every table she has visited, as households. */
  listVisits(playerId: string): Promise<string[]>;

  /**
   * Write a profile, a new one or over the one there. Never over one being
   * deleted (#252): a profile marked `sweeping` is left as it is. For making
   * a profile; a change to one that exists goes through `updatePlayer`.
   */
  putPlayer(player: PlayerProfile): Promise<void>;
  /**
   * Change a profile that is there and not being deleted (#252): a rename,
   * retiring, bringing back. `false`, and nothing written, otherwise, so a
   * change read before a delete can never bring the kid back after it.
   */
  updatePlayer(player: PlayerProfile): Promise<boolean>;
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
  /**
   * A rotated token's hash and `lastSeen`, and nothing else, onto a binding
   * that is still there and not revoked; false, and no write, otherwise. The
   * sliding expiry's re-issue, for the reason `touchDevice` gives: a full
   * `putDevice` of the copy read at resolve time could land after a
   * revocation and hand the lost phone a fresh 30-day token.
   */
  rotateDevice(householdId: string, deviceId: string, tokenHash: string, lastSeen: string): Promise<boolean>;

  // --- characters (household-scoped, never run-scoped — §3) ----------------
  /**
   * Unconditionally persists the complete character snapshot, including both
   * committed and provisional progression. Implementations stamp the row with
   * the current character schema version; this is a replacement, not a patch.
   *
   * Outside the claim (#282): it writes `version` as given and checks nothing.
   * For fixtures and tools; a run writes heroes only through `commit()`.
   */
  putCharacter(character: Character): Promise<void>;
  /**
   * Returns the character after applying the shared migration ladder to the
   * stored row, or `null` when the household/id pair does not exist.
   */
  getCharacter(householdId: string, characterId: string): Promise<Character | null>;
  listCharacters(householdId: string): Promise<Character[]>;
  /**
   * One conditional write to a hero outside a run's commit, under the same
   * conditions `commit()` puts on its `characters` (`CharacterWrite`). For
   * leaving an adventure (#282), which releases a claim with no run turn to
   * ride. `false`, and nothing written, when the row no longer stands as read.
   */
  writeCharacter(write: CharacterWrite): Promise<boolean>;

  // --- runs, state, event log ----------------------------------------------
  putRun(run: RunRecord): Promise<void>;
  getRun(runId: string): Promise<RunRecord | null>;
  listRuns(householdId: string): Promise<RunRecord[]>;

  putChapterProgress(progress: ChapterProgressRecord): Promise<void>;
  listChapterProgress(runId: string): Promise<ChapterProgressRecord[]>;

  /** The setback counter (see `CampaignProgressRecord`). `null` = no attempt yet. */
  getCampaignProgress(householdId: string, campaignId: string): Promise<CampaignProgressRecord | null>;
  /** Every attempt the household has, whatever its status — the lobby's list. */
  listCampaignProgress(householdId: string): Promise<CampaignProgressRecord[]>;
  putCampaignProgress(progress: CampaignProgressRecord): Promise<void>;

  // --- field guide (household-scoped, permanent) -----------------------------
  /** `HH#<id>` / `FIELDGUIDE`. An empty book (never `null`) when nothing is found yet. */
  getFieldGuide(householdId: string): Promise<FieldGuideRecord>;
  /**
   * Record discoveries, first finder wins. Idempotent and safe under
   * concurrent writers: an id already in the book is never touched, so
   * `firstFoundBy`/`foundAt`/`runId` are never overwritten. Within one call,
   * the first occurrence of a repeated `canonId` wins.
   *
   * Returns the canon ids this call *actually added* (input order, no
   * duplicates) - exactly the "NEW!" moments to celebrate; a re-report returns
   * `[]`. `foundAt` defaults to the repository clock.
   */
  recordDiscoveries(householdId: string, discoveries: FieldGuideDiscovery[]): Promise<string[]>;

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
  /**
   * Settle a claimable room on a household (`RoomRecord.claimable`): the room
   * now names `householdId` and is no longer claimable, and when that is a
   * different household from the one it was opened under, the run row moves
   * with it — the run belongs to whoever plays it, and the sweeper reaches a
   * run only through its household.
   *
   * Conditional on the room still being claimable and still pointing at `run`
   * under `run.householdId`. `false` means another phone settled it first; the
   * caller re-reads the room and goes by what it says now.
   */
  claimRoom(input: { code: string; run: RunRecord; householdId: string }): Promise<boolean>;

  // --- room-code lookups -----------------------------------------------------
  /**
   * Takes one of `limit` lookups by code for `clientKey` in one fixed window
   * (`handlers/code-guard.ts`), atomically: `false`, and nothing written, when
   * the window already holds `limit`. A window whose `ttl` has passed counts
   * as empty. `ttl` is epoch **seconds**, set by the window's first lookup.
   *
   * One conditional write rather than a read then a write, so a burst of
   * parallel requests cannot all read "below the limit" before any of them
   * is counted.
   *
   * The same counter, under keys of their own, budgets crash reports (#317)
   * and a spectator's cheers (#388).
   */
  reserveCodeLookup(clientKey: string, window: number, limit: number, ttl: number): Promise<boolean>;
  /**
   * Gives one lookup back: the code named an open room, so it was not a guess.
   * Never takes a window below zero.
   */
  refundCodeLookup(clientKey: string, window: number): Promise<void>;

  // --- presence beats (#258) -------------------------------------------------
  /**
   * Records that `playerId`'s phone is here at `at` (ISO), in the run's one
   * presence row, and returns every seated phone's last word, this one's
   * included: player id to ISO time. `ttl` is epoch **seconds**, renewed by
   * every beat. One write, so beats from several phones at once never lose
   * one another's times.
   */
  touchPresence(runId: string, playerId: string, at: string, ttl: number): Promise<Record<string, string>>;
  /**
   * Every seated phone's last word in this run, as `touchPresence` returns it,
   * without beating for anybody. Empty when nobody has beaten (or the row has
   * expired). For the push that tells a quiet phone it is its turn (#466).
   */
  getPresence(runId: string): Promise<Record<string, string>>;

  // --- push subscriptions (#466) ---------------------------------------------
  /**
   * Write (or replace) the subscription for one of a kid's own phones. One per
   * phone: a phone that subscribes again replaces what it had.
   */
  putPushSubscription(subscription: PushSubscriptionRecord): Promise<void>;
  /** Every phone of hers that takes pushes. Empty when none does. */
  listPushSubscriptions(playerId: string): Promise<PushSubscriptionRecord[]>;
  /** The phone stops taking pushes. A missing one is a no-op. */
  deletePushSubscription(playerId: string, deviceId: string): Promise<void>;
}
