/**
 * In-memory `GameRepository`, optionally mirrored to a JSON file under `.data/`.
 *
 * The records carry the **real** `PK`/`SK`/`GSI1PK`/`GSI1SK` attributes from
 * architecture §3, and every read is expressed as a partition lookup plus a
 * sort-key prefix range — i.e. as things DynamoDB can actually do. Nothing here
 * scans the table, so `DynamoRepository` can be a mechanical translation rather
 * than a redesign. Where the semantics matter (conditional room creation,
 * transactional commit, TTL) the local store reproduces them exactly.
 *
 * Persistence is a dev-only convenience: `npm run dev:server` restarts on every
 * save under `tsx watch`, and losing the household + characters on each restart
 * would make multi-device testing (§7) miserable.
 */

import fs from "node:fs/promises";
import { CHARACTER_VERSION, migrateCharacter } from "@kad/shared";
import { readAll } from "./character-io.ts";
import path from "node:path";
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

/** One row. Mirrors a DynamoDB item: keys are attributes, not metadata. */
interface TableItem {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  /** Epoch seconds, TTL attribute. Only rooms carry it today. */
  ttl?: number;
  /**
   * Schema version of `data`, per entity (architecture §3.2). A top-level
   * attribute rather than a field on `data`, so the domain type never learns
   * that it is stored and nothing above the repository can branch on it.
   * Absent means a row written before versioning — v0.
   */
  v?: number;
  /**
   * Set on a household `META` row once the sweeper has begun deleting it, which
   * is what makes `claimHousehold` start refusing. A top-level attribute rather
   * than a field on `data` so the domain type stays free of storage bookkeeping.
   */
  sweeping?: boolean;
  entity: string;
  data: unknown;
}

export interface MemoryRepositoryOptions {
  /** Absolute path to the JSON mirror. Omit for a pure in-memory store. */
  filePath?: string;
  now?: () => number;
}

export class MemoryRepository implements GameRepository {
  private readonly items = new Map<string, TableItem>();
  private readonly filePath: string | undefined;
  private readonly now: () => number;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(options: MemoryRepositoryOptions = {}) {
    this.filePath = options.filePath;
    this.now = options.now ?? Date.now;
  }

  /** Loads the JSON mirror if it exists. A corrupt mirror starts empty — dev
   * data is disposable, and refusing to boot over it would be worse. */
  static async open(options: MemoryRepositoryOptions = {}): Promise<MemoryRepository> {
    const repo = new MemoryRepository(options);
    if (options.filePath) await repo.load(options.filePath);
    return repo;
  }

  private async load(filePath: string): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { items?: TableItem[] };
      for (const item of parsed.items ?? []) {
        if (item && typeof item.PK === "string" && typeof item.SK === "string") {
          this.items.set(rowKey(item.PK, item.SK), item);
        }
      }
    } catch {
      console.warn(`[store] ignoring corrupt dev table at ${filePath}`);
    }
  }

  /** Waits for any pending mirror write. Tests and shutdown call this. */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.scheduleWrite();
    }
    await this.writing;
  }

  // --- table primitives -----------------------------------------------------
  //
  // Every item is cloned across the boundary, both ways. DynamoDB serializes
  // on write and deserializes on read, so nothing a caller holds is ever the
  // stored object; the Map used to hand out live references, which let a
  // handler that mutated a loaded record corrupt the dev store while behaving
  // correctly in prod — a divergence the contract suite structurally cannot
  // see, because it runs the same handler against both.

  private put(item: TableItem): void {
    this.items.set(rowKey(item.PK, item.SK), structuredClone(item));
    this.persist();
  }

  private get(pk: string, sk: string): TableItem | undefined {
    const item = this.items.get(rowKey(pk, sk));
    if (!item) return undefined;
    if (this.isExpired(item)) return undefined;
    return structuredClone(item);
  }

  /** A Query: one partition, sort keys ascending, optional prefix. */
  private query(pk: string, skPrefix = ""): TableItem[] {
    const out: TableItem[] = [];
    for (const item of this.items.values()) {
      if (item.PK !== pk) continue;
      if (!item.SK.startsWith(skPrefix)) continue;
      if (this.isExpired(item)) continue;
      out.push(structuredClone(item));
    }
    return out.sort((a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0));
  }

  /** A GSI1 Query. `skBelow` is the `GSI1SK < :v` range condition. */
  private queryIndex(gsi1pk: string, skBelow?: string): TableItem[] {
    const out: TableItem[] = [];
    for (const item of this.items.values()) {
      if (item.GSI1PK !== gsi1pk) continue;
      if (skBelow !== undefined && !((item.GSI1SK ?? "") < skBelow)) continue;
      if (this.isExpired(item)) continue;
      out.push(structuredClone(item));
    }
    return out.sort((a, b) => ((a.GSI1SK ?? "") < (b.GSI1SK ?? "") ? -1 : 1));
  }

  private isExpired(item: TableItem): boolean {
    return item.ttl !== undefined && item.ttl * 1000 <= this.now();
  }

  private persist(): void {
    if (!this.filePath) return;
    if (this.flushTimer) return;
    // Debounced: an action writes two rows, and a burst of intents writes many.
    // The mirror only has to be current by the next restart.
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.scheduleWrite();
    }, 25);
    this.flushTimer.unref?.();
  }

  private scheduleWrite(): void {
    const filePath = this.filePath;
    if (!filePath) return;
    const snapshot = { version: 1, items: [...this.items.values()] };
    this.writing = this.writing.then(async () => {
      const tmp = `${filePath}.${process.pid}.tmp`;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      // Rename is atomic on the same filesystem: a killed dev server never
      // leaves a half-written table behind.
      await fs.rename(tmp, filePath);
    }).catch((err: unknown) => {
      console.warn(`[store] could not write dev table: ${String(err)}`);
    });
  }

  // --- household, players, devices ------------------------------------------

  async putHousehold(household: Household): Promise<void> {
    this.put({
      PK: HH(household.id),
      SK: META,
      // Only guests are indexed. A claimed household has no GSI1 entry at all,
      // which is precisely what makes it invisible to the sweeper.
      ...(household.guest && household.expiresAt
        ? {
            GSI1PK: GSI1_GUEST,
            GSI1SK: GSI1_GUEST_SK(household.expiresAt, household.id),
          }
        : {}),
      entity: "household",
      data: household,
    });
  }

  async getHousehold(householdId: string): Promise<Household | null> {
    return (this.get(HH(householdId), META)?.data as Household | undefined) ?? null;
  }

  async claimHousehold(householdId: string, cognitoSub: string): Promise<boolean> {
    const item = this.get(HH(householdId), META);
    if (!item) return false;
    // Deletion has already begun. Succeeding here would tell a family their
    // party is kept while it is being deleted out from under them.
    if (item.sweeping) return false;
    const household = item.data as Household;
    // Already someone else's. Signing in on a borrowed phone must not hand you
    // that family's characters.
    if (household.ownerSub && household.ownerSub !== cognitoSub) return false;

    const { expiresAt: _dropped, ...rest } = household;
    // Dropping GSI1PK/GSI1SK is the whole promotion: no sweep entry, no sweep.
    await this.putHousehold({ ...rest, ownerSub: cognitoSub, guest: false });
    await this.putAccountPointer(cognitoSub, householdId);
    return true;
  }

  async listExpiredGuestHouseholds(nowIso: string, limit = 25): Promise<Household[]> {
    return this.queryIndex(GSI1_GUEST, GSI1_GUEST_SK(nowIso, ""))
      .slice(0, limit)
      .map((i) => i.data as Household);
  }

  async deleteGuestHousehold(householdId: string, nowIso: string): Promise<boolean> {
    /*
     * Phase 1 — the same conditional gate the real store uses, and the reason
     * the sweeper cannot delete a household somebody just claimed. Not
     * conditional on `sweeping` being absent: an interrupted sweep must be
     * re-enterable or that household is stranded forever.
     */
    const meta = this.get(HH(householdId), META);
    if (!meta) return false;
    const household = meta.data as Household;
    if (!household.guest) return false;
    if (!household.expiresAt || household.expiresAt > nowIso) return false;
    this.put({ ...meta, sweeping: true });

    // Phase 2 — runs first: they live in their own partitions and are only
    // reachable through the household, so deleting the household row first
    // would orphan every event log under it.
    for (const run of await this.listRuns(householdId)) {
      for (const item of this.query(RUN(run.id))) {
        this.items.delete(rowKey(item.PK, item.SK));
      }
      // Conditional like the Dynamo sweep: codes recycle, so the code may now
      // name a different household's live room. Only ours to take if it still
      // points at this run.
      const room = this.get(ROOM(run.roomCode), META);
      if ((room?.data as { runId?: string } | undefined)?.runId === run.id) {
        this.items.delete(rowKey(ROOM(run.roomCode), META));
      }
    }
    if (household.ownerSub) {
      this.items.delete(rowKey(ACCT(household.ownerSub), HH(householdId)));
    }

    // Phase 3 — the rest of the household partition, META last: it carries the
    // GUEST index entry, so an interrupted sweep stays discoverable.
    for (const item of this.query(HH(householdId))) {
      if (item.SK === META) continue;
      this.items.delete(rowKey(item.PK, item.SK));
    }
    this.items.delete(rowKey(HH(householdId), META));
    this.persist();
    return true;
  }

  async putAccountPointer(cognitoSub: string, householdId: string): Promise<void> {
    this.put({
      PK: ACCT(cognitoSub),
      SK: HH(householdId),
      entity: "account",
      data: { cognitoSub, householdId },
    });
  }

  async listHouseholdsForAccount(cognitoSub: string): Promise<string[]> {
    return this.query(ACCT(cognitoSub), "HH#").map((i) => i.SK.slice("HH#".length));
  }

  async putPlayer(player: PlayerProfile): Promise<void> {
    this.put({
      PK: HH(player.householdId),
      SK: PLAYER_SK(player.id),
      entity: "player",
      data: player,
    });
  }

  async getPlayer(householdId: string, playerId: string): Promise<PlayerProfile | null> {
    return (
      (this.get(HH(householdId), PLAYER_SK(playerId))?.data as PlayerProfile | undefined) ?? null
    );
  }

  async listPlayers(householdId: string): Promise<PlayerProfile[]> {
    return this.query(HH(householdId), PREFIX.player).map((i) => i.data as PlayerProfile);
  }

  async putDevice(device: DeviceBinding): Promise<void> {
    this.put({
      PK: HH(device.householdId),
      SK: DEVICE_SK(device.deviceId),
      GSI1PK: GSI1_DEVICE(device.deviceId),
      GSI1SK: HH(device.householdId),
      entity: "device",
      data: device,
    });
  }

  async getDeviceById(deviceId: string): Promise<DeviceBinding | null> {
    const hit = this.queryIndex(GSI1_DEVICE(deviceId))[0];
    return (hit?.data as DeviceBinding | undefined) ?? null;
  }

  async getDevice(householdId: string, deviceId: string): Promise<DeviceBinding | null> {
    // Memory is always consistent, so this differs from `getDeviceById` only
    // in shape — but both stores must expose it or the contract suite cannot
    // hold them to the same behaviour.
    const item = this.get(HH(householdId), DEVICE_SK(deviceId));
    return (item?.data as DeviceBinding | undefined) ?? null;
  }

  async listDevices(householdId: string): Promise<DeviceBinding[]> {
    return this.query(HH(householdId), PREFIX.device).map((i) => i.data as DeviceBinding);
  }

  async revokeDevice(householdId: string, deviceId: string): Promise<void> {
    const item = this.get(HH(householdId), DEVICE_SK(deviceId));
    if (!item) return;
    const device = item.data as DeviceBinding;
    this.put({ ...item, data: { ...device, revoked: true } });
  }

  async touchDevice(householdId: string, deviceId: string, lastSeen: string): Promise<void> {
    const item = this.get(HH(householdId), DEVICE_SK(deviceId));
    if (!item) return;
    const device = item.data as DeviceBinding;
    // Only `lastSeen`, mirroring the Dynamo update expression — `revoked` and
    // everything else on the item must be untouchable from this path.
    this.put({ ...item, data: { ...device, lastSeen } });
  }

  // --- characters ------------------------------------------------------------

  async putCharacter(character: Character): Promise<void> {
    this.put({
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
    const item = this.get(HH(householdId), CHAR_SK(characterId));
    if (!item) return null;
    // Same migration path as DynamoRepository, on purpose — the contract suite
    // runs against both, so this is the only way it covers either.
    return migrateCharacter(item.data, item.v);
  }

  async listCharacters(householdId: string): Promise<Character[]> {
    return readAll(this.query(HH(householdId), PREFIX.character), householdId);
  }

  // --- runs, state, events ---------------------------------------------------

  async putRun(run: RunRecord): Promise<void> {
    this.put({
      PK: HH(run.householdId),
      SK: RUN_SK(run.id),
      GSI1PK: GSI1_RUN(run.id),
      GSI1SK: HH(run.householdId),
      entity: "run",
      data: run,
    });
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    // Filtered by entity because the *room* item is indexed under the same
    // GSI1PK (see `putRoomIfAbsent`) — `RUN#<id>` resolves to both the run and
    // the room that points at it, and only one of them is a RunRecord.
    const hit = this.queryIndex(GSI1_RUN(runId)).find((i) => i.entity === "run");
    return (hit?.data as RunRecord | undefined) ?? null;
  }

  async listRuns(householdId: string): Promise<RunRecord[]> {
    return this.query(HH(householdId), PREFIX.run).map((i) => i.data as RunRecord);
  }

  async putChapterProgress(progress: ChapterProgressRecord): Promise<void> {
    this.put({
      PK: RUN(progress.runId),
      SK: CHAPTER_SK(progress.index),
      entity: "chapter-progress",
      data: progress,
    });
  }

  async listChapterProgress(runId: string): Promise<ChapterProgressRecord[]> {
    return this.query(RUN(runId), PREFIX.chapter).map((i) => i.data as ChapterProgressRecord);
  }

  async getState(runId: string): Promise<RunState | null> {
    return (this.get(RUN(runId), STATE)?.data as RunState | undefined) ?? null;
  }

  async putState(state: RunState): Promise<void> {
    this.put({ PK: RUN(state.runId), SK: STATE, entity: "state", data: state });
  }

  async commit(input: CommitInput): Promise<boolean> {
    const { runId, expectedSeq, state, event, characters = [] } = input;
    const current = (this.get(RUN(runId), STATE)?.data as RunState | undefined) ?? null;
    // Both conditions of the real TransactWriteItems: the state has not moved,
    // and this seq has not already been written.
    if (!current || current.seq !== expectedSeq) return false;
    if (this.items.has(rowKey(RUN(runId), EVT_SK(event.seq)))) return false;

    this.put({ PK: RUN(runId), SK: EVT_SK(event.seq), entity: "event", data: event });
    this.put({ PK: RUN(runId), SK: STATE, entity: "state", data: state });
    // Written only once both checks above have passed, mirroring the real
    // transaction: a commit that loses the seq race must leave characters
    // untouched, or a losing turn still banks its XP.
    for (const character of characters) {
      this.put({
        PK: HH(character.householdId),
        SK: CHAR_SK(character.id),
        entity: "character",
        v: CHARACTER_VERSION,
        data: character,
      });
    }
    return true;
  }

  async listEvents(runId: string, sinceSeq: number, limit = 200): Promise<EventRecord[]> {
    const rows = this.query(RUN(runId), PREFIX.event);
    const out: EventRecord[] = [];
    for (const row of rows) {
      const event = row.data as EventRecord;
      if (event.seq <= sinceSeq) continue;
      out.push(event);
      if (out.length >= limit) break;
    }
    return out;
  }

  // --- rooms -----------------------------------------------------------------

  async putRoomIfAbsent(room: RoomRecord): Promise<boolean> {
    const key = rowKey(ROOM(room.code), META);
    const existing = this.items.get(key);
    // An *expired* room's code is free again, which is the whole point of the
    // 6-hour TTL (§3): four letters is a small space and codes must recycle.
    if (existing && !this.isExpired(existing)) return false;
    this.put({
      PK: ROOM(room.code),
      SK: META,
      GSI1PK: GSI1_RUN(room.runId),
      GSI1SK: ROOM(room.code),
      ttl: room.ttl,
      entity: "room",
      data: room,
    });
    return true;
  }

  async getRoom(code: string): Promise<RoomRecord | null> {
    return (this.get(ROOM(code), META)?.data as RoomRecord | undefined) ?? null;
  }

  async deleteRoom(code: string): Promise<void> {
    this.items.delete(rowKey(ROOM(code), META));
    this.persist();
  }
}

function rowKey(pk: string, sk: string): string {
  return `${pk} ${sk}`;
}
