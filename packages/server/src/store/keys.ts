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
 * | Character        | HH#<hhId>       | CHAR#<charId>      |
 * | Campaign run     | HH#<hhId>       | RUN#<runId>        |
 * | Chapter progress | RUN#<runId>     | CHAPTER#<n>        |
 * | Game state       | RUN#<runId>     | STATE              |
 * | Event log        | RUN#<runId>     | EVT#<seq>          |
 * | Room             | ROOM#<code>     | META               |
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

export const PLAYER_SK = (playerId: string) => `PLAYER#${playerId}`;
export const DEVICE_SK = (deviceId: string) => `DEVICE#${deviceId}`;
export const CHAR_SK = (characterId: string) => `CHAR#${characterId}`;
export const RUN_SK = (runId: string) => `RUN#${runId}`;
export const CHAPTER_SK = (index: number) => `CHAPTER#${index}`;

/** Sort-key prefixes, for range queries. */
export const PREFIX = {
  player: "PLAYER#",
  device: "DEVICE#",
  character: "CHAR#",
  run: "RUN#",
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

export function seqFromEvtSk(sk: string): number {
  return Number.parseInt(sk.slice(PREFIX.event.length), 10);
}

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
