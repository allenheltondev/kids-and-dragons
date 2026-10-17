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
  CHARACTER_VERSION,
  FIELD_GUIDE_VERSION,
  migrateCharacter,
  migrateFieldGuide,
} from "@kad/shared";
import { readAll } from "./character-io.ts";
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
  FieldGuideDiscovery,
  FieldGuideRecord,
  Household,
  PlayerProfile,
  RunState,
} from "@kad/shared";
import type {
  CampaignProgressRecord,
  ChapterProgressRecord,
  CommitInput,
  EventRecord,
  GameRepository,
  GuestRenewal,
  RoomRecord,
  RunRecord,
} from "./repository.ts";
import {
  ACCT,
  CAMPAIGN_SK,
  CHAPTER_SK,
  CHAR_SK,
  DEVICE_SK,
  EVT_SK,
  EVT_SK_MAX,
  FIELDGUIDE,
  GSI1_DEVICE,
  GSI1_GUEST,
  GSI1_GUEST_SK,
  GSI1_RUN,
  GUESS,
  GUESS_WINDOW_SK,
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
  /** Epoch seconds, DynamoDB's TTL attribute. Only rooms and code-miss windows carry it. */
  ttl?: number;
  /**
   * Schema version of `data`, per entity (architecture §3.2). A top-level
   * attribute rather than a field on `data`, so the domain type never learns
   * that it is stored and nothing above the repository can branch on it.
   * Absent means a row written before versioning — v0.
   */
  v?: number;
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
  /**
   * Injected by tests, like everywhere else the server tells time (`deps.ts`).
   * The room-code TTL comparisons read this — `MemoryRepository` already did,
   * and a fake clock that expires a room in one store but not the other is a
   * contract suite lying to itself.
   */
  now?: () => number;
}

export class DynamoRepository implements GameRepository {
  private readonly doc: DynamoDBDocumentClient;
  private readonly table: string;
  private readonly index: string;
  private readonly now: () => number;

  constructor(options: DynamoRepositoryOptions) {
    this.table = options.tableName;
    this.index = options.indexName ?? GSI1_NAME;
    this.now = options.now ?? Date.now;
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

  async claimHousehold(householdId: string, cognitoSub: string, deviceId: string): Promise<boolean> {
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
          /*
           * And only from the device that started it (#265), unless it is
           * already this account's: a room code gets a phone a seat in the
           * household, never the household.
           */
          ConditionExpression:
            "attribute_exists(PK) AND attribute_not_exists(sweeping) AND (#d.#owner = :sub OR (" +
            "(attribute_not_exists(#d.#owner) OR #d.#owner = :null) AND #d.#founder = :device))",
          ExpressionAttributeNames: {
            "#d": "data",
            "#owner": "ownerSub",
            "#guest": "guest",
            "#expires": "expiresAt",
            "#founder": "founderDeviceId",
          },
          ExpressionAttributeValues: { ":sub": cognitoSub, ":no": false, ":null": null, ":device": deviceId },
        }),
      );
    } catch (err) {
      if (isConditionalFailure(err)) return false;
      throw err;
    }
    await this.putAccountPointer(cognitoSub, householdId);
    return true;
  }

  async takeFounding(householdId: string, deviceId: string): Promise<boolean> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: HH(householdId), SK: META },
          UpdateExpression: "SET #d.#founder = :device REMOVE #d.#awaiting",
          ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(sweeping) AND #d.#awaiting = :true",
          ExpressionAttributeNames: { "#d": "data", "#founder": "founderDeviceId", "#awaiting": "awaitingFounder" },
          ExpressionAttributeValues: { ":device": deviceId, ":true": true },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalFailure(err)) return false;
      throw err;
    }
  }

  async dropFounder(householdId: string, deviceId: string): Promise<void> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: HH(householdId), SK: META },
          UpdateExpression: "REMOVE #d.#founder",
          ConditionExpression: "attribute_exists(PK) AND #d.#founder = :device",
          ExpressionAttributeNames: { "#d": "data", "#founder": "founderDeviceId" },
          ExpressionAttributeValues: { ":device": deviceId },
        }),
      );
    } catch (err) {
      if (!isConditionalFailure(err)) throw err;
    }
  }

  async extendGuestHousehold(householdId: string, expiresAt: string): Promise<GuestRenewal> {
    try {
      /*
       * One conditional write, so it cannot race the sweeper: the sweep's own
       * first write sets `sweeping` only while `expiresAt <= now`, and this one
       * moves `expiresAt` only while `sweeping` is absent. Whichever lands
       * first, the other's condition fails. GSI1SK moves with the expiry, or
       * the sweep index would still list the household at its old time.
       */
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: HH(householdId), SK: META },
          UpdateExpression: "SET #d.#expires = :exp, GSI1SK = :sk",
          ConditionExpression:
            "attribute_exists(PK) AND attribute_not_exists(sweeping) " +
            "AND #d.#guest = :true AND #d.#expires < :exp",
          ExpressionAttributeNames: { "#d": "data", "#guest": "guest", "#expires": "expiresAt" },
          ExpressionAttributeValues: {
            ":exp": expiresAt,
            ":sk": GSI1_GUEST_SK(expiresAt, householdId),
            ":true": true,
          },
        }),
      );
      return "extended";
    } catch (err) {
      if (!isConditionalFailure(err)) throw err;
    }
    /*
     * Refused — and the caller needs to know whether that was benign (already
     * later, or claimed) or the sweep. A read after the failed write is sound
     * because `sweeping` is never unset: if this read sees it absent, the
     * household was not being swept when the write was refused either, and a
     * household whose expiry is already later than ours cannot be swept now.
     */
    const item = await this.get(HH(householdId), META);
    if (!item || (item as { sweeping?: boolean }).sweeping) return "swept";
    return "kept";
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
      /*
       * Conditional, because codes recycle by design (`putRoomIfAbsent` frees
       * an expired one — four letters is a small space). A 7-day-old guest's
       * run can hold a code that now names a *different* household's live
       * room; an unconditional delete here would end that family's evening
       * from a background Lambda. Only the room still pointing at this run is
       * this sweep's to take.
       */
      try {
        await this.doc.send(
          new DeleteCommand({
            TableName: this.table,
            Key: { PK: ROOM(run.roomCode), SK: META },
            ConditionExpression: "#d.#run = :runId",
            ExpressionAttributeNames: { "#d": "data", "#run": "runId" },
            ExpressionAttributeValues: { ":runId": run.id },
          }),
        );
      } catch (err) {
        // Recycled or already gone — either way it is not ours to delete.
        if (!isConditionalFailure(err)) throw err;
      }
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

  async getDevice(householdId: string, deviceId: string): Promise<DeviceBinding | null> {
    // ConsistentRead, deliberately: this is the read revocation depends on
    // (see the port's comment). A GSI cannot serve a consistent read at all,
    // which is why this exists beside `getDeviceById`.
    const out = await this.doc.send(
      new GetCommand({
        TableName: this.table,
        Key: { PK: HH(householdId), SK: DEVICE_SK(deviceId) },
        ConsistentRead: true,
      }),
    );
    return ((out.Item as TableItem | undefined)?.data as DeviceBinding | undefined) ?? null;
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

  async touchDevice(householdId: string, deviceId: string, lastSeen: string): Promise<void> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: HH(householdId), SK: DEVICE_SK(deviceId) },
          UpdateExpression: "SET #d.#seen = :t",
          ConditionExpression: "attribute_exists(PK)",
          ExpressionAttributeNames: { "#d": "data", "#seen": "lastSeen" },
          ExpressionAttributeValues: { ":t": lastSeen },
        }),
      );
    } catch (err) {
      // A device deleted mid-flight has nothing to keep honest.
      if (!isConditionalFailure(err)) throw err;
    }
  }

  // --- characters ------------------------------------------------------------

  async putCharacter(character: Character): Promise<void> {
    await this.put({
      PK: HH(character.householdId),
      SK: CHAR_SK(character.id),
      entity: "character",
      // Stamped on every write, so a row's version is a fact rather than an
      // inference from which fields happen to be present (architecture §3.2).
      v: CHARACTER_VERSION,
      data: character,
    });
  }

  async getCharacter(householdId: string, characterId: string): Promise<Character | null> {
    const item = await this.get(HH(householdId), CHAR_SK(characterId));
    if (!item) return null;
    // Migrated on read, never on write (architecture §3.2): the row is upgraded
    // in memory now and rewritten at the next natural write, so a character
    // self-heals within a session rather than costing a write on every load.
    return migrateCharacter(item.data, item.v);
  }

  async listCharacters(householdId: string): Promise<Character[]> {
    const items = await this.partition(HH(householdId), PREFIX.character);
    return readAll(items, householdId);
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

  async getCampaignProgress(
    householdId: string,
    campaignId: string,
  ): Promise<CampaignProgressRecord | null> {
    const item = await this.get(HH(householdId), CAMPAIGN_SK(campaignId));
    return (item?.data as CampaignProgressRecord | undefined) ?? null;
  }

  async listCampaignProgress(householdId: string): Promise<CampaignProgressRecord[]> {
    const items = await this.partition(HH(householdId), PREFIX.campaign);
    return items.map((i) => i.data as CampaignProgressRecord);
  }

  async getFieldGuide(householdId: string): Promise<FieldGuideRecord> {
    const item = await this.get(HH(householdId), FIELDGUIDE);
    if (!item) return migrateFieldGuide({}, FIELD_GUIDE_VERSION);
    return migrateFieldGuide(item.data, item.v);
  }

  /*
   * Design: one item, `data.entries` a map keyed by canon id, written with a
   * per-key `SET data.entries.<id> = if_not_exists(data.entries.<id>, :entry)`.
   *
   * `if_not_exists` on each key is what makes first-finder-wins hold with no
   * read and no lock: two concurrent writers each add only the keys the other
   * has not, and a key that exists is left byte-for-byte alone. Different keys
   * touch different paths, so they merge instead of racing.
   *
   * The wrinkle is that a nested `SET` needs its *parent* map to exist, and
   * `SET entries = if_not_exists(entries, :empty)` cannot share an expression
   * with `SET entries.<id> = ...` (DynamoDB rejects overlapping paths). So the
   * write is optimistic with a one-time bootstrap: try the nested write; on the
   * ValidationException that means "no such map yet", create the empty map
   * (itself idempotent - `if_not_exists`, so a racing bootstrap is harmless and
   * can never wipe entries) and retry. After the first discovery ever, every
   * call is a single UpdateItem. `ReturnValues: ALL_OLD` hands back the item as
   * it was *atomically before* this write, so "newly added" is exactly the ids
   * absent from that image - correct even when another writer lands in between.
   *
   * Capacity note: all entries share one item (400 KB cap, ~100 B/entry =>
   * thousands of discoveries), far above any content pack.
   */
  async recordDiscoveries(householdId: string, discoveries: FieldGuideDiscovery[]): Promise<string[]> {
    const nowIso = new Date(this.now()).toISOString();
    // First occurrence wins; repeated paths in one expression are an error.
    const wanted = new Map<string, FieldGuideDiscovery>();
    for (const d of discoveries) {
      if (d.canonId && !wanted.has(d.canonId)) wanted.set(d.canonId, d);
    }
    if (wanted.size === 0) return [];

    const names: Record<string, string> = { "#d": "data", "#e": "entries" };
    const values: Record<string, unknown> = {};
    const sets: string[] = [];
    let i = 0;
    for (const [canonId, d] of wanted) {
      names[`#k${i}`] = canonId;
      values[`:e${i}`] = {
        firstFoundBy: d.playerId,
        foundAt: d.foundAt ?? nowIso,
        ...(d.runId ? { runId: d.runId } : {}),
      };
      sets.push(`#d.#e.#k${i} = if_not_exists(#d.#e.#k${i}, :e${i})`);
      i++;
    }
    const key = { PK: HH(householdId), SK: FIELDGUIDE };

    for (let attempt = 0; ; attempt++) {
      try {
        const out = await this.doc.send(
          new UpdateCommand({
            TableName: this.table,
            Key: key,
            UpdateExpression: `SET ${sets.join(", ")}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ReturnValues: "ALL_OLD",
          }),
        );
        const before = (out.Attributes?.["data"] as { entries?: Record<string, unknown> } | undefined)?.entries ?? {};
        return [...wanted.keys()].filter((id) => !Object.hasOwn(before, id));
      } catch (err) {
        // Only "the entries map does not exist yet" is recoverable, and only once.
        if (nameOf(err) !== "ValidationException" || attempt >= 2) throw err;
        await this.doc.send(
          new UpdateCommand({
            TableName: this.table,
            Key: key,
            UpdateExpression:
              "SET #d = if_not_exists(#d, :empty), v = if_not_exists(v, :v), entity = if_not_exists(entity, :entity)",
            ExpressionAttributeNames: { "#d": "data" },
            ExpressionAttributeValues: {
              ":empty": { entries: {} },
              ":v": FIELD_GUIDE_VERSION,
              ":entity": "field-guide",
            },
          }),
        );
      }
    }
  }

  async putCampaignProgress(progress: CampaignProgressRecord): Promise<void> {
    await this.put(campaignProgressItem(progress));
  }

  async getState(runId: string): Promise<RunState | null> {
    return ((await this.get(RUN(runId), STATE))?.data as RunState | undefined) ?? null;
  }

  async putState(state: RunState): Promise<void> {
    await this.put({ PK: RUN(state.runId), SK: STATE, entity: "state", data: state });
  }

  async commit(input: CommitInput): Promise<boolean> {
    const {
      runId,
      expectedSeq,
      state,
      event,
      characters = [],
      chapterProgress,
      campaignProgress,
      campaignProgressExpectedVersion,
    } = input;
    if (campaignProgress && campaignProgressExpectedVersion === undefined) {
      throw new Error("campaign progress commit is missing its expected version");
    }
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
            // Unconditional, and safe because the two above are not: if the run
            // has moved on, the whole transaction is rejected and these never
            // land. That is the entire point of putting them here.
            ...characters.map((character) => ({
              Put: {
                TableName: this.table,
                Item: {
                  PK: HH(character.householdId),
                  SK: CHAR_SK(character.id),
                  entity: "character",
                  v: CHARACTER_VERSION,
                  data: character,
                } satisfies TableItem,
              },
            })),
            // Progress rows ride the run gate. The campaign row also has its
            // own version condition because a second run has a different seq gate.
            ...(chapterProgress
              ? [
                  {
                    Put: {
                      TableName: this.table,
                      Item: {
                        PK: RUN(chapterProgress.runId),
                        SK: CHAPTER_SK(chapterProgress.index),
                        entity: "chapter-progress",
                        data: chapterProgress,
                      } satisfies TableItem,
                    },
                  },
                ]
              : []),
            ...(campaignProgress
              ? [
                  campaignProgressTransaction(
                    this.table,
                    campaignProgress,
                    campaignProgressExpectedVersion as number | null,
                  ),
                ]
              : []),
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
          ExpressionAttributeValues: { ":now": Math.floor(this.now() / 1000) },
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
    if (item.ttl !== undefined && item.ttl * 1000 <= this.now()) return null;
    return (item.data as RoomRecord | undefined) ?? null;
  }

  async deleteRoom(code: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({ TableName: this.table, Key: { PK: ROOM(code), SK: META } }),
    );
  }

  async claimRoom(input: { code: string; run: RunRecord; householdId: string }): Promise<boolean> {
    const { code, run, householdId } = input;
    const moving = householdId !== run.householdId;
    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              // Whoever settles the room first owns it — the same rule as the
              // code reservation, and for the same reason: two phones from two
              // households must not both walk away believing it is theirs.
              Update: {
                TableName: this.table,
                Key: { PK: ROOM(code), SK: META },
                UpdateExpression: "SET #d.#hh = :to REMOVE #d.#claimable",
                ConditionExpression:
                  "#d.#claimable = :true AND #d.#hh = :from AND #d.#run = :runId",
                ExpressionAttributeNames: {
                  "#d": "data",
                  "#hh": "householdId",
                  "#claimable": "claimable",
                  "#run": "runId",
                },
                ExpressionAttributeValues: {
                  ":to": householdId,
                  ":from": run.householdId,
                  ":runId": run.id,
                  ":true": true,
                },
              },
            },
            // The run row follows the room. Only its household partition moves:
            // state, events and progress live under `RUN#<id>`, which is
            // keyed by the run alone.
            ...(moving
              ? [
                  {
                    Delete: {
                      TableName: this.table,
                      Key: { PK: HH(run.householdId), SK: RUN_SK(run.id) },
                    },
                  },
                  {
                    Put: {
                      TableName: this.table,
                      Item: {
                        PK: HH(householdId),
                        SK: RUN_SK(run.id),
                        GSI1PK: GSI1_RUN(run.id),
                        GSI1SK: HH(householdId),
                        entity: "run",
                        data: { ...run, householdId },
                      } satisfies TableItem,
                    },
                  },
                ]
              : []),
          ],
        }),
      );
      return true;
    } catch (err) {
      if (isTransactionCancelled(err)) return false;
      throw err;
    }
  }

  // --- room-code lookups ----------------------------------------------------

  async reserveCodeLookup(clientKey: string, window: number, limit: number, ttl: number): Promise<boolean> {
    /*
     * One conditional `ADD`: the condition and the increment are a single
     * write, so a burst of parallel guesses is admitted at most `limit` times
     * however it interleaves, and no read anywhere can be stale.
     *
     * A row whose ttl has passed but which TTL has not swept yet (deletion is
     * eventual) is started over instead of added to. If two requests race to
     * start it over, the loser goes round once more and adds to the winner's.
     */
    const key = { PK: GUESS(clientKey), SK: GUESS_WINDOW_SK(window) };
    const names = { "#d": "data", "#ttl": "ttl", "#entity": "entity" };
    for (let attempt = 0; attempt < 2; attempt++) {
      const nowSeconds = Math.floor(this.now() / 1000);
      const values = { ":one": 1, ":ttl": ttl, ":entity": "code-lookups", ":now": nowSeconds };
      try {
        await this.doc.send(
          new UpdateCommand({
            TableName: this.table,
            Key: key,
            UpdateExpression: "ADD #d :one SET #ttl = if_not_exists(#ttl, :ttl), #entity = :entity",
            ConditionExpression: "attribute_not_exists(#d) OR (#d < :limit AND #ttl > :now)",
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: { ...values, ":limit": limit },
          }),
        );
        return true;
      } catch (err) {
        if (!isConditionalFailure(err)) throw err;
      }
      // Refused: the window is full, or the row is expired and unswept. Only
      // the second may be started over, and only while it is still expired.
      try {
        await this.doc.send(
          new UpdateCommand({
            TableName: this.table,
            Key: key,
            UpdateExpression: "SET #d = :one, #ttl = :ttl, #entity = :entity",
            ConditionExpression: "#ttl <= :now",
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
          }),
        );
        return true;
      } catch (err) {
        if (!isConditionalFailure(err)) throw err;
      }
    }
    return false;
  }

  async refundCodeLookup(clientKey: string, window: number): Promise<void> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: GUESS(clientKey), SK: GUESS_WINDOW_SK(window) },
          UpdateExpression: "ADD #d :minus",
          ConditionExpression: "#d > :zero",
          ExpressionAttributeNames: { "#d": "data" },
          ExpressionAttributeValues: { ":minus": -1, ":zero": 0 },
        }),
      );
    } catch (err) {
      // Already at zero, or gone: nothing to give back.
      if (!isConditionalFailure(err)) throw err;
    }
  }
}

/** A conditional Put that is safe across independent run partitions. */
function campaignProgressTransaction(
  table: string,
  progress: CampaignProgressRecord,
  expectedVersion: number | null,
) {
  const condition =
    expectedVersion === null
      ? { ConditionExpression: "attribute_not_exists(PK)" }
      : {
          ConditionExpression:
            expectedVersion === 0
              ? "attribute_exists(PK) AND (attribute_not_exists(#d.#version) OR #d.#version = :expectedVersion)"
              : "#d.#version = :expectedVersion",
          ExpressionAttributeNames: { "#d": "data", "#version": "version" },
          ExpressionAttributeValues: { ":expectedVersion": expectedVersion },
        };
  return {
    Put: {
      TableName: table,
      Item: campaignProgressItem(progress),
      ...condition,
    },
  };
}

/** One shape for both write paths — `putCampaignProgress` and `commit`. */
function campaignProgressItem(progress: CampaignProgressRecord): TableItem {
  return {
    PK: HH(progress.householdId),
    SK: CAMPAIGN_SK(progress.campaignId),
    entity: "campaign-progress",
    data: progress,
  };
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
