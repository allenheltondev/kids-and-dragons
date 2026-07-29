/**
 * `DynamoRepository` — the prod `GameRepository`, architecture §3.
 *
 * The single `kad` table, one GSI, no scans. This is deliberately a mechanical
 * translation of `MemoryRepository` rather than a re-modelling: both write the
 * same rows, with the same `PK`/`SK`/`GSI1PK`/`GSI1SK`/`entity`/`data` shape
 * from `keys.ts`, so the local dev mirror in `.data/dev-table.json` is a genuine
 * table export and a bug reproduced on a laptop is the same bug in prod.
 * `store/contract.test.ts` runs one suite against both to keep that true.
 *
 * Three places have real semantics rather than storage:
 *
 *   `commit()`            one TransactWriteItems — the event and the state move
 *                         together or not at all (§4.1)
 *   `putRoomIfAbsent()`   a conditional write is what makes a code collision
 *                         impossible rather than unlikely
 *   `claimHousehold()`    one conditional update turns anonymous play permanent
 *
 * Everything else is a Get, a Put, or a Query on one partition.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type {
  Character,
  DeviceBinding,
  Household,
  PlayerProfile,
  RunState,
} from "@kad/shared";
import type {
  ChapterProgressRecord,
  CommitInput,
  EventRecord,
  GameRepository,
  RoomRecord,
  RunRecord,
} from "./repository.ts";
import {
  ACCT,
  CHAPTER_SK,
  CHAR_SK,
  DEVICE_SK,
  EVT_SK,
  EVT_SK_MAX,
  GSI1_DEVICE,
  GSI1_GUEST,
  GSI1_GUEST_SK,
  GSI1_RUN,
  HH,
  META,
  PLAYER_SK,
  PREFIX,
  ROOM,
  RUN,
  RUN_SK,
  STATE,
} from "./keys.ts";

/** One row. Identical to the local store's `TableItem` — that is the point. */
interface TableItem {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  /** Epoch seconds, DynamoDB's TTL attribute. Only rooms carry it. */
  ttl?: number;
  entity: string;
  data: unknown;
}

export const GSI1_NAME = "GSI1";

/** BatchWriteItem's hard limit. */
const BATCH_SIZE = 25;

/** Retries per chunk before a sweep gives up and says so. */
const MAX_BATCH_ATTEMPTS = 6;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface DynamoRepositoryOptions {
  tableName: string;
  /** Injected by tests (DynamoDB Local); defaults to the ambient credentials. */
  client?: DynamoDBClient;
  indexName?: string;
}

export class DynamoRepository implements GameRepository {
  private readonly doc: DynamoDBDocumentClient;
  private readonly table: string;
  private readonly index: string;

  constructor(options: DynamoRepositoryOptions) {
    this.table = options.tableName;
    this.index = options.indexName ?? GSI1_NAME;
    this.doc = DynamoDBDocumentClient.from(options.client ?? new DynamoDBClient({}), {
      marshallOptions: {
        // Optional fields (`userAgent`, `presentation`, `avatar`) are absent
        // rather than null all over the domain types. Without this every one of
        // them is a runtime error at write time.
        removeUndefinedValues: true,
      },
    });
  }

  // --- table primitives -----------------------------------------------------

  private async put(item: TableItem): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: item }));
  }

  private async get(pk: string, sk: string): Promise<TableItem | undefined> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { PK: pk, SK: sk } }),
    );
    return out.Item as TableItem | undefined;
  }

  /**
   * A Query on one partition, following pagination to the end.
   *
   * Following it matters more than it looks: DynamoDB stops at 1MB *before*
   * applying a filter, so a partition with a long event log can hand back an
   * empty page and a `LastEvaluatedKey`. Stopping at the first page would make
   * a household's characters intermittently invisible as its runs pile up.
   */
  private async query(input: Omit<QueryCommandInput, "TableName">, limit?: number) {
    const items: TableItem[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const out = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          ...input,
          ...(start ? { ExclusiveStartKey: start } : {}),
          ...(limit ? { Limit: limit - items.length } : {}),
        }),
      );
      items.push(...((out.Items ?? []) as TableItem[]));
      start = out.LastEvaluatedKey;
    } while (start && (limit === undefined || items.length < limit));
    return limit === undefined ? items : items.slice(0, limit);
  }

  /** A partition plus an optional sort-key prefix. */
  private partition(pk: string, skPrefix?: string, limit?: number) {
    return this.query(
      {
        KeyConditionExpression: skPrefix ? "PK = :pk AND begins_with(SK, :sk)" : "PK = :pk",
        ExpressionAttributeValues: { ":pk": pk, ...(skPrefix ? { ":sk": skPrefix } : {}) },
      },
      limit,
    );
  }

  /**
   * Deletes every key, and does not return until they are actually gone.
   *
   * `BatchWriteItem` can return **200 with work left undone**: under partial
   * throttling it hands back the requests it declined in `UnprocessedItems`.
   * Treating that as success is quietly destructive here — the sweeper deletes
   * a household's rows and then its `META` row, so a dropped chunk leaves
   * characters and event logs behind with nothing pointing at them and no index
   * entry for a later sweep to rediscover them by. Orphaned forever, and
   * invisible.
   *
   * So: retry what came back, with backoff, and throw rather than return if it
   * still will not finish. A sweep that fails loudly is recoverable; one that
   * lies is not.
   */
  private async deleteAll(keys: { PK: string; SK: string }[]): Promise<void> {
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const chunk = keys.slice(i, i + BATCH_SIZE);
      let pending: Record<string, unknown[]> = {
        [this.table]: chunk.map((Key) => ({ DeleteRequest: { Key } })),
      };

      for (let attempt = 0; ; attempt++) {
        const out = await this.doc.send(
          new BatchWriteCommand({ RequestItems: pending as never }),
        );
        const unprocessed = out.UnprocessedItems ?? {};
        const left = unprocessed[this.table] ?? [];
        if (left.length === 0) break;

        if (attempt >= MAX_BATCH_ATTEMPTS) {
          throw new Error(
            `BatchWriteItem left ${String(left.length)} deletes unprocessed after ` +
              `${String(attempt + 1)} attempts on ${this.table}`,
          );
        }
        pending = { [this.table]: left as unknown[] };
        // Exponential with jitter: a retry storm is what caused the throttle.
        await sleep(2 ** attempt * 50 * (0.5 + Math.random()));
      }
    }
  }

  // --- household, players, devices ------------------------------------------

  async putHousehold(household: Household): Promise<void> {
    await this.put({
      PK: HH(household.id),
      SK: META,
      // Only guests are indexed; a claimed household has no GSI1 entry, which is
      // exactly what makes it invisible to the sweeper (see keys.ts).
      ...(household.guest && household.expiresAt
        ? { GSI1PK: GSI1_GUEST, GSI1SK: GSI1_GUEST_SK(household.expiresAt, household.id) }
        : {}),
      entity: "household",
      data: household,
    });
  }

  async getHousehold(householdId: string): Promise<Household | null> {
    return ((await this.get(HH(householdId), META))?.data as Household | undefined) ?? null;
  }

  async claimHousehold(householdId: string, cognitoSub: string): Promise<boolean> {
    try {
      /*
       * The entire promotion, in one conditional write. `REMOVE GSI1PK, GSI1SK`
       * is what stops the sweeper ever looking at this household again; the
       * condition is what stops a second account claiming a household that is
       * already someone's. A guest's `ownerSub` is `null` rather than absent, so
       * both spellings of "unclaimed" are accepted.
       */
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: HH(householdId), SK: META },
          UpdateExpression:
            "SET #d.#owner = :sub, #d.#guest = :no REMOVE #d.#expires, GSI1PK, GSI1SK",
          /*
           * `attribute_not_exists(sweeping)` is the other half of the sweeper's
           * conditional delete. Once a sweep has begun, claiming has to fail —
           * otherwise the claim succeeds against a household whose characters
           * are already being deleted, and the family is told their party is
           * kept while it disappears.
           */
          ConditionExpression:
            "attribute_exists(PK) AND attribute_not_exists(sweeping) " +
            "AND (attribute_not_exists(#d.#owner) OR #d.#owner = :null OR #d.#owner = :sub)",
          ExpressionAttributeNames: {
            "#d": "data",
            "#owner": "ownerSub",
            "#guest": "guest",
            "#expires": "expiresAt",
          },
          ExpressionAttributeValues: { ":sub": cognitoSub, ":no": false, ":null": null },
        }),
      );
    } catch (err) {
      if (isConditionalFailure(err)) return false;
      throw err;
    }
    await this.putAccountPointer(cognitoSub, householdId);
    return true;
  }

  async listExpiredGuestHouseholds(nowIso: string, limit = 25): Promise<Household[]> {
    const items = await this.query(
      {
        IndexName: this.index,
        KeyConditionExpression: "GSI1PK = :guest AND GSI1SK < :now",
        ExpressionAttributeValues: {
          ":guest": GSI1_GUEST,
          // The same expression the local store uses — an entry whose expiry is
          // exactly now has not expired yet, in both.
          ":now": GSI1_GUEST_SK(nowIso, ""),
        },
      },
      limit,
    );
    return items.map((i) => i.data as Household);
  }

  async deleteGuestHousehold(householdId: string, nowIso: string): Promise<boolean> {
    /*
     * Phase 1 — claim the right to delete, conditionally.
     *
     * This single write is what makes the whole operation safe. It is the point
     * at which a concurrent `claimHousehold` either has already won (this
     * condition fails, and nothing is deleted) or has already lost (it will
     * fail on `attribute_not_exists(sweeping)` from here on).
     *
     * Deliberately *not* conditional on `sweeping` being absent: a sweep that
     * died halfway leaves the marker set, and refusing to re-enter would strand
     * that household forever.
     */
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: HH(householdId), SK: META },
          UpdateExpression: "SET sweeping = :yes",
          ConditionExpression:
            "attribute_exists(PK) AND #d.#guest = :true AND #d.#expires <= :now",
          ExpressionAttributeNames: { "#d": "data", "#guest": "guest", "#expires": "expiresAt" },
          ExpressionAttributeValues: { ":yes": true, ":true": true, ":now": nowIso },
        }),
      );
    } catch (err) {
      // Claimed in time, already gone, or expiry moved. All mean "leave it".
      if (isConditionalFailure(err)) return false;
      throw err;
    }

    // Phase 2 — the contents. Runs live in their own partitions and are only
    // reachable *through* the household, so they go before anything in the
    // household partition is touched.
    for (const run of await this.listRuns(householdId)) {
      const runItems = await this.partition(RUN(run.id));
      await this.deleteAll(runItems.map(({ PK, SK }) => ({ PK, SK })));
      await this.deleteRoom(run.roomCode);
    }
    const household = await this.getHousehold(householdId);
    if (household?.ownerSub) {
      await this.doc.send(
        new DeleteCommand({
          TableName: this.table,
          Key: { PK: ACCT(household.ownerSub), SK: HH(householdId) },
        }),
      );
    }

    // Phase 3 — everything else in the household partition, `META` last. It
    // carries the GUEST index entry, so until it goes an interrupted sweep is
    // still discoverable by the next one.
    const items = await this.partition(HH(householdId));
    await this.deleteAll(
      items.filter((i) => i.SK !== META).map(({ PK, SK }) => ({ PK, SK })),
    );
    await this.doc.send(
      new DeleteCommand({ TableName: this.table, Key: { PK: HH(householdId), SK: META } }),
    );
    return true;
  }

  async putAccountPointer(cognitoSub: string, householdId: string): Promise<void> {
    await this.put({
      PK: ACCT(cognitoSub),
      SK: HH(householdId),
      entity: "account",
      data: { cognitoSub, householdId },
    });
  }

  async listHouseholdsForAccount(cognitoSub: string): Promise<string[]> {
    const items = await this.partition(ACCT(cognitoSub), "HH#");
    return items.map((i) => i.SK.slice("HH#".length));
  }

  async putPlayer(player: PlayerProfile): Promise<void> {
    await this.put({
      PK: HH(player.householdId),
      SK: PLAYER_SK(player.id),
      entity: "player",
      data: player,
    });
  }

  async getPlayer(householdId: string, playerId: string): Promise<PlayerProfile | null> {
    return (
      ((await this.get(HH(householdId), PLAYER_SK(playerId)))?.data as PlayerProfile | undefined) ??
      null
    );
  }

  async listPlayers(householdId: string): Promise<PlayerProfile[]> {
    const items = await this.partition(HH(householdId), PREFIX.player);
    return items.map((i) => i.data as PlayerProfile);
  }

  async putDevice(device: DeviceBinding): Promise<void> {
    await this.put({
      PK: HH(device.householdId),
      SK: DEVICE_SK(device.deviceId),
      GSI1PK: GSI1_DEVICE(device.deviceId),
      GSI1SK: HH(device.householdId),
      entity: "device",
      data: device,
    });
  }

  async getDeviceById(deviceId: string): Promise<DeviceBinding | null> {
    const items = await this.query(
      {
        IndexName: this.index,
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": GSI1_DEVICE(deviceId) },
      },
      1,
    );
    return (items[0]?.data as DeviceBinding | undefined) ?? null;
  }

  async listDevices(householdId: string): Promise<DeviceBinding[]> {
    const items = await this.partition(HH(householdId), PREFIX.device);
    return items.map((i) => i.data as DeviceBinding);
  }

  async revokeDevice(householdId: string, deviceId: string): Promise<void> {
    try {
      // A flag, not a delete: characters have to survive a revoked phone (§4.5).
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: HH(householdId), SK: DEVICE_SK(deviceId) },
          UpdateExpression: "SET #d.#revoked = :yes",
          ConditionExpression: "attribute_exists(PK)",
          ExpressionAttributeNames: { "#d": "data", "#revoked": "revoked" },
          ExpressionAttributeValues: { ":yes": true },
        }),
      );
    } catch (err) {
      // Revoking a device that is not there is the state the caller wanted.
      if (!isConditionalFailure(err)) throw err;
    }
  }

  // --- characters ------------------------------------------------------------

  async putCharacter(character: Character): Promise<void> {
    await this.put({
      PK: HH(character.householdId),
      SK: CHAR_SK(character.id),
      entity: "character",
      data: character,
    });
  }

  async getCharacter(householdId: string, characterId: string): Promise<Character | null> {
    return (
      ((await this.get(HH(householdId), CHAR_SK(characterId)))?.data as Character | undefined) ??
      null
    );
  }

  async listCharacters(householdId: string): Promise<Character[]> {
    const items = await this.partition(HH(householdId), PREFIX.character);
    return items.map((i) => i.data as Character);
  }

  // --- runs, state, events ---------------------------------------------------

  async putRun(run: RunRecord): Promise<void> {
    await this.put({
      PK: HH(run.householdId),
      SK: RUN_SK(run.id),
      GSI1PK: GSI1_RUN(run.id),
      GSI1SK: HH(run.householdId),
      entity: "run",
      data: run,
    });
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const items = await this.query({
      IndexName: this.index,
      KeyConditionExpression: "GSI1PK = :pk",
      // The room item is indexed under the same GSI1PK, so `RUN#<id>` resolves
      // to both the run and the room pointing at it. Only one is a RunRecord.
      FilterExpression: "entity = :entity",
      ExpressionAttributeValues: { ":pk": GSI1_RUN(runId), ":entity": "run" },
    });
    return (items[0]?.data as RunRecord | undefined) ?? null;
  }

  async listRuns(householdId: string): Promise<RunRecord[]> {
    const items = await this.partition(HH(householdId), PREFIX.run);
    return items.map((i) => i.data as RunRecord);
  }

  async putChapterProgress(progress: ChapterProgressRecord): Promise<void> {
    await this.put({
      PK: RUN(progress.runId),
      SK: CHAPTER_SK(progress.index),
      entity: "chapter-progress",
      data: progress,
    });
  }

  async listChapterProgress(runId: string): Promise<ChapterProgressRecord[]> {
    const items = await this.partition(RUN(runId), PREFIX.chapter);
    return items.map((i) => i.data as ChapterProgressRecord);
  }

  async getState(runId: string): Promise<RunState | null> {
    return ((await this.get(RUN(runId), STATE))?.data as RunState | undefined) ?? null;
  }

  async putState(state: RunState): Promise<void> {
    await this.put({ PK: RUN(state.runId), SK: STATE, entity: "state", data: state });
  }

  async commit(input: CommitInput): Promise<boolean> {
    const { runId, expectedSeq, state, event } = input;
    try {
      /*
       * The two writes that must never come apart: append `EVT#<seq>` and
       * overwrite `STATE`. Both conditions matter and they catch different
       * races — `attribute_not_exists(SK)` stops a retry double-appending an
       * event, and `data.seq = :expected` stops two intents interleaving. Losing
       * either means the event log stops being a faithful replay of the run,
       * which is what reconnect and deterministic dice both stand on (§4.3).
       */
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: {
                  PK: RUN(runId),
                  SK: EVT_SK(event.seq),
                  entity: "event",
                  data: event,
                } satisfies TableItem,
                ConditionExpression: "attribute_not_exists(SK)",
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: {
                  PK: RUN(runId),
                  SK: STATE,
                  entity: "state",
                  data: state,
                } satisfies TableItem,
                ConditionExpression: "#d.#seq = :expected",
                ExpressionAttributeNames: { "#d": "data", "#seq": "seq" },
                ExpressionAttributeValues: { ":expected": expectedSeq },
              },
            },
          ],
        }),
      );
      return true;
    } catch (err) {
      // Somebody else advanced the run first. The caller turns this into
      // STALE_SEQ and the client resyncs — it is not an error condition.
      if (isTransactionCancelled(err)) return false;
      throw err;
    }
  }

  async listEvents(runId: string, sinceSeq: number, limit = 200): Promise<EventRecord[]> {
    const items = await this.query(
      {
        // A key condition cannot mix `SK > :lo` with `begins_with`, so the
        // event range is expressed by its bounds — see EVT_SK_MAX.
        KeyConditionExpression: "PK = :pk AND SK BETWEEN :lo AND :hi",
        ExpressionAttributeValues: {
          ":pk": RUN(runId),
          ":lo": EVT_SK(sinceSeq + 1),
          ":hi": EVT_SK_MAX,
        },
        ScanIndexForward: true,
      },
      limit,
    );
    return items.map((i) => i.data as EventRecord);
  }

  // --- rooms -----------------------------------------------------------------

  async putRoomIfAbsent(room: RoomRecord): Promise<boolean> {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            PK: ROOM(room.code),
            SK: META,
            GSI1PK: GSI1_RUN(room.runId),
            GSI1SK: ROOM(room.code),
            ttl: room.ttl,
            entity: "room",
            data: room,
          } satisfies TableItem,
          /*
           * Whoever writes the code first owns it — that is what makes a
           * collision impossible rather than unlikely.
           *
           * The second clause matters because TTL deletion is *eventual*: AWS
           * gives itself up to 48 hours to sweep an expired item. Four letters
           * is a small space, and without this an expired room would hold its
           * code hostage for two days after the family went to bed.
           */
          ConditionExpression: "attribute_not_exists(PK) OR #ttl <= :now",
          ExpressionAttributeNames: { "#ttl": "ttl" },
          ExpressionAttributeValues: { ":now": Math.floor(Date.now() / 1000) },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalFailure(err)) return false;
      throw err;
    }
  }

  async getRoom(code: string): Promise<RoomRecord | null> {
    const item = await this.get(ROOM(code), META);
    if (!item) return null;
    // Reads are not eventual even though the sweep is: an expired room must read
    // as gone the moment it expires, or a phone restores a session whose token
    // is already dead (§3).
    if (item.ttl !== undefined && item.ttl * 1000 <= Date.now()) return null;
    return (item.data as RoomRecord | undefined) ?? null;
  }

  async deleteRoom(code: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({ TableName: this.table, Key: { PK: ROOM(code), SK: META } }),
    );
  }
}

/** `ConditionalCheckFailedException`, however the SDK version spells it. */
function isConditionalFailure(err: unknown): boolean {
  return nameOf(err) === "ConditionalCheckFailedException";
}

/**
 * A cancelled transaction. Every cancellation `commit()` can provoke is a lost
 * race, but a *validation* error is a bug and must not be swallowed as one —
 * hence checking the cancellation reasons rather than the exception name alone.
 */
function isTransactionCancelled(err: unknown): boolean {
  if (nameOf(err) !== "TransactionCanceledException") return false;
  const reasons = (err as { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
  if (!reasons) return true;
  return reasons.some((r) => r.Code === "ConditionalCheckFailed");
}

function nameOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null ? (err as { name?: string }).name : undefined;
}
