/**
 * Single-table key shapes — architecture §3.
 *
 * These live apart from any implementation because both the in-memory dev store
 * and the DynamoDB store must produce *identical* keys: the point of the local
 * store is that swapping in `DynamoRepository` is a wiring change, not a
 * re-modelling exercise.
 *
 * | Entity           | PK              | SK                 |
 * |------------------|-----------------|--------------------|
 * | Account pointer  | ACCT#<sub>      | HH#<hhId>          |
 * | Household        | HH#<hhId>       | META               |
 * | Player profile   | HH#<hhId>       | PLAYER#<playerId>  |
 * | Device binding   | HH#<hhId>       | DEVICE#<deviceId>  |
 * | Co-organizer     | HH#<hhId>       | OWNER#<sub>        |
 * | Character        | HH#<hhId>       | CHAR#<charId>      |
 * | Campaign run     | HH#<hhId>       | RUN#<runId>        |
 * | Field guide      | HH#<hhId>       | FIELDGUIDE         |
 * | Chapter progress | RUN#<runId>     | CHAPTER#<n>        |
 * | Game state       | RUN#<runId>     | STATE              |
 * | Event log        | RUN#<runId>     | EVT#<seq>          |
 * | Room             | ROOM#<code>     | META               |
 * | Code misses      | GUESS#<client>  | WINDOW#<n>         |
 * | Organizer invite | INVITE#<code>   | META               |
 * | Transfer code    | TRANSFER#<code> | META               |
 * | Moved device     | HH#<hhId>       | MOVED#<deviceId>   |
 * | Pairing code     | PAIR#<code>     | META               |
 *
 * GSI1 indexes devices by device id so a returning phone resolves to its
 * household without a scan (§3), and runs by id so `runId` alone is enough to
 * find the household that owns a run.
 */

export const HH = (householdId: string) => `HH#${householdId}`;
export const RUN = (runId: string) => `RUN#${runId}`;
export const ROOM = (code: string) => `ROOM#${code.toUpperCase()}`;
export const ACCT = (sub: string) => `ACCT#${sub}`;

export const META = "META";
export const STATE = "STATE";

/** The household's permanent discovery record — see `FieldGuideRecord`. */
export const FIELDGUIDE = "FIELDGUIDE";

export const PLAYER_SK = (playerId: string) => `PLAYER#${playerId}`;
export const DEVICE_SK = (deviceId: string) => `DEVICE#${deviceId}`;
export const CHAR_SK = (characterId: string) => `CHAR#${characterId}`;
export const RUN_SK = (runId: string) => `RUN#${runId}`;
export const CHAPTER_SK = (index: number) => `CHAPTER#${index}`;
/** One owner of a household (#248), beside the `ACCT#` pointer that is its authority. */
export const OWNER_SK = (cognitoSub: string) => `OWNER#${cognitoSub}`;

/**
 * A single-use code that makes a second grown-up an owner (#248). Carries a
 * `ttl`, like a room: one row, and nothing else points at it.
 */
export const INVITE = (code: string) => `INVITE#${code.toUpperCase()}`;

/**
 * A single-use code that moves one kid to another home (#251). Carries a
 * `ttl`, like an invite: one row, and nothing else points at it.
 */
export const TRANSFER = (code: string) => `TRANSFER#${code.toUpperCase()}`;

/**
 * Where a moved kid's phone went (#251): left in the household she moved
 * out of, naming the one she moved into. Her phone's token names the old
 * household, and this is how it finds her binding by primary key, never by
 * the index. Not under `DEVICE#`, so nothing that lists devices sees it.
 * Carries a `ttl` no shorter than any token it could forward.
 */
export const MOVED_SK = (deviceId: string) => `MOVED#${deviceId}`;

/**
 * A single-use code that makes a new device a kid (#281). Carries a `ttl`,
 * like an invite: one row, and nothing else points at it.
 */
export const PAIR = (code: string) => `PAIR#${code.toUpperCase()}`;

/**
 * Wrong room codes from one client, one row per window (`handlers/code-guard.ts`).
 * Carries a `ttl`, like a room: it is one row, and nothing else points at it.
 */
export const GUESS = (clientKey: string) => `GUESS#${clientKey}`;
export const GUESS_WINDOW_SK = (window: number) => `WINDOW#${window}`;

/** Campaign setback counter, household-scoped — see `CampaignProgressRecord`. */
export const CAMPAIGN_SK = (campaignId: string) => `CAMPAIGN#${campaignId}`;

/** Sort-key prefixes, for range queries. */
export const PREFIX = {
  player: "PLAYER#",
  device: "DEVICE#",
  owner: "OWNER#",
  character: "CHAR#",
  run: "RUN#",
  campaign: "CAMPAIGN#",
  chapter: "CHAPTER#",
  event: "EVT#",
} as const;

/** Seq width for `EVT#<seq>`. */
const SEQ_WIDTH = 12;

/**
 * Zero-padded because DynamoDB sorts sort keys *lexicographically*: without
 * padding `EVT#10` sorts before `EVT#9` and reconnect replay (§4.3) silently
 * returns events out of order. The padding is part of the key contract, not an
 * implementation detail of the local store.
 */
export const EVT_SK = (seq: number) => `EVT#${String(seq).padStart(SEQ_WIDTH, "0")}`;

/**
 * The upper bound of the event range, for `SK BETWEEN :lo AND :hi`.
 *
 * A DynamoDB key condition cannot combine `SK > :lo` with `begins_with(SK, …)`,
 * so replaying "events after N" is expressed as a range whose top is the largest
 * key the padding can produce. Derived from `SEQ_WIDTH` rather than written out,
 * so widening the padding cannot silently truncate a replay.
 */
export const EVT_SK_MAX = `EVT#${"9".repeat(SEQ_WIDTH)}`;

/** GSI1: device id → household. */
export const GSI1_DEVICE = (deviceId: string) => `DEVICE#${deviceId}`;
/** GSI1: run id → household, so a runId alone resolves its owner. */
export const GSI1_RUN = (runId: string) => `RUN#${runId}`;

/**
 * GSI1: every **guest** household, sorted by when it may be swept.
 *
 * Anonymous play has to expire, and the obvious way to do that — a `ttl`
 * attribute on every item — does not work here. DynamoDB TTL is per item, but a
 * household's items span partitions it does not know about at write time
 * (`RUN#<runId>` is a different partition from `HH#<hhId>`), so every writer
 * would have to be told whether the household it is writing under is still a
 * guest. Worse, that decision would be *cached* in a warm Lambda, and a stale
 * "yes, guest" verdict after someone signed in would quietly re-arm the deletion
 * of a household they had just claimed.
 *
 * So expiry is one row's problem instead. Only the household META item carries
 * the index entry, a scheduled sweeper queries this partition for entries whose
 * sort key has passed, and claiming a household is a **single write** that drops
 * the entry (`REMOVE GSI1PK, GSI1SK`). Nothing else in the table has to know
 * anonymous play exists.
 */
export const GSI1_GUEST = "GUEST";

/** ISO first so a lexicographic range query is a chronological one. */
export const GSI1_GUEST_SK = (expiresAt: string, householdId: string) =>
  `${expiresAt}#${householdId}`;
