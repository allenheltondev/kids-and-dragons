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
import { isDeepStrictEqual } from "node:util";
import {
  CHARACTER_VERSION,
  FIELD_GUIDE_VERSION,
  FORGOTTEN_FINDER,
  migrateCharacter,
  migrateFieldGuide,
} from "@kad/shared";
import { claimHolds, claimedRow, readAll } from "./character-io.ts";
import path from "node:path";
import type {
  Character,
  DeviceBinding,
  FieldGuideDiscovery,
  FieldGuideFind,
  FieldGuideRecord,
  Household,
  PlayerProfile,
  RunState,
} from "@kad/shared";
import type {
  CampaignProgressRecord,
  ChapterProgressRecord,
  CharacterWrite,
  CommitInput,
  EventRecord,
  GameRepository,
  ForgetJob,
  GuestRenewal,
  HouseholdOwnerRecord,
  IdlePlayer,
  MoveOutcome,
  MoveProfileInput,
  OrganizerInviteRecord,
  PairingCodeRecord,
  ProfileMove,
  RoomRecord,
  RunRecord,
  TransferCodeRecord,
} from "./repository.ts";
import { collectMove, fieldGuideItem, planMove } from "./profile-move.ts";
import {
  ACCT,
  CAMPAIGN_SK,
  CHAPTER_SK,
  CHAR_SK,
  DEVICE_SK,
  EVT_SK,
  FIELDGUIDE,
  FORGET,
  GSI1_DEVICE,
  GSI1_FORGET,
  GSI1_FORGET_SK,
  GSI1_GUEST,
  GSI1_GUEST_SK,
  GSI1_IDLE,
  GSI1_IDLE_SK,
  GSI1_RUN,
  GUESS,
  GUESS_WINDOW_SK,
  HH,
  INVITE,
  META,
  MOVED_SK,
  OWNER_SK,
  PAIR,
  PLAYER_SK,
  PREFIX,
  PRESENCE,
  ROOM,
  RUN,
  RUN_SK,
  STATE,
  TRANSFER,
  VISIT,
} from "./keys.ts";

/** One row. Mirrors a DynamoDB item: keys are attributes, not metadata. */
interface TableItem {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  /** Epoch seconds, TTL attribute. Only rooms, code-miss windows, invites, transfer codes and moved-device forwards carry it. */
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
  /** ISO. On a `PLAYER#` row: when she last joined a room (#252). Bookkeeping, like `sweeping`. */
  lastPlayedAt?: string;
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

  async claimHousehold(householdId: string, cognitoSub: string, deviceId: string): Promise<boolean> {
    const item = this.get(HH(householdId), META);
    if (!item) return false;
    // Deletion has already begun. Succeeding here would tell a family their
    // party is kept while it is being deleted out from under them.
    if (item.sweeping) return false;
    const household = item.data as Household;
    // Already someone else's. Signing in on a borrowed phone must not hand you
    // that family's characters.
    if (household.ownerSub && household.ownerSub !== cognitoSub) return false;
    // Only the device that started it, unless it is already this account's.
    // A household from before founders keeps the old rule until it expires.
    const legacy = household.founderDeviceId === undefined && household.awaitingFounder !== true;
    if (household.ownerSub !== cognitoSub && !legacy && household.founderDeviceId !== deviceId) return false;

    const { expiresAt: _dropped, ...rest } = household;
    // Dropping GSI1PK/GSI1SK is the whole promotion: no sweep entry, no sweep.
    await this.putHousehold({ ...rest, ownerSub: cognitoSub, guest: false });
    await this.putAccountPointer(cognitoSub, householdId);
    return true;
  }

  async takeFounding(householdId: string, deviceId: string): Promise<boolean> {
    const item = this.get(HH(householdId), META);
    if (!item || item.sweeping) return false;
    const household = item.data as Household;
    if (household.awaitingFounder !== true) return false;
    const { awaitingFounder: _taken, ...rest } = household;
    await this.putHousehold({ ...rest, founderDeviceId: deviceId });
    return true;
  }

  async dropFounder(householdId: string, deviceId: string): Promise<void> {
    const item = this.get(HH(householdId), META);
    if (!item) return;
    const household = item.data as Household;
    if (household.founderDeviceId !== deviceId) return;
    // Empty, not absent: absent reads as a household from before founders.
    await this.putHousehold({ ...household, founderDeviceId: "" });
  }

  async extendGuestHousehold(householdId: string, expiresAt: string): Promise<GuestRenewal> {
    // The same condition the real store writes under.
    const item = this.get(HH(householdId), META);
    if (!item || item.sweeping) return "swept";
    const household = item.data as Household;
    if (!household.guest || !household.expiresAt || household.expiresAt >= expiresAt) return "kept";
    // Through putHousehold, so the sweep index entry moves with the expiry.
    await this.putHousehold({ ...household, expiresAt });
    return "extended";
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
    await this.purge(householdId);
    return true;
  }

  async deleteHousehold(householdId: string): Promise<boolean> {
    // The same mark, gated only on the household being there: the caller
    // proved an owner. Re-entrant like the sweep, so a delete that died
    // part-way is finished by the next.
    const meta = this.get(HH(householdId), META);
    if (!meta) return false;
    this.put({ ...meta, sweeping: true });
    await this.purge(householdId);
    return true;
  }

  /** Everything under a marked household, in the order that keeps an interrupted delete findable. */
  private async purge(householdId: string): Promise<void> {
    const household = this.get(HH(householdId), META)?.data as Household | undefined;

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
    // Every owner's pointer: the founding one, and each co-organizer's (#248).
    const subs = new Set(this.query(HH(householdId), PREFIX.owner).map((i) => (i.data as HouseholdOwnerRecord).cognitoSub));
    if (household?.ownerSub) subs.add(household.ownerSub);
    for (const sub of subs) this.items.delete(rowKey(ACCT(sub), HH(householdId)));
    // Each kid's visits, which are keyed by her and not by this household.
    for (const item of this.query(HH(householdId), PREFIX.player)) {
      for (const visit of this.query(VISIT((item.data as PlayerProfile).id))) {
        this.items.delete(rowKey(visit.PK, visit.SK));
      }
    }

    // Phase 3 — the rest of the household partition, META last: it carries the
    // GUEST index entry, so an interrupted sweep stays discoverable.
    for (const item of this.query(HH(householdId))) {
      if (item.SK === META) continue;
      this.items.delete(rowKey(item.PK, item.SK));
    }
    this.items.delete(rowKey(HH(householdId), META));
    this.persist();
  }

  async deleteProfile(householdId: string, playerId: string, idleBefore?: string): Promise<boolean> {
    // Phase 1 — the mark, conditional as the real store's is. Not on
    // `sweeping` being absent: an interrupted delete must be re-enterable.
    const row = this.items.get(rowKey(HH(householdId), PLAYER_SK(playerId)));
    if (!row) return false;
    if (idleBefore !== undefined && !(row.lastPlayedAt !== undefined && row.lastPlayedAt <= idleBefore)) return false;
    this.put({ ...row, sweeping: true });

    // Phase 2 — hers, by what each row says.
    for (const item of this.query(HH(householdId), PREFIX.character)) {
      if ((item.data as { ownerPlayerId?: string }).ownerPlayerId === playerId) this.items.delete(rowKey(item.PK, item.SK));
    }
    for (const item of this.query(HH(householdId), PREFIX.device)) {
      const device = item.data as DeviceBinding;
      if (device.kind !== "shared" && device.playerId === playerId) this.items.delete(rowKey(item.PK, item.SK));
    }
    for (const visit of this.query(VISIT(playerId))) this.items.delete(rowKey(visit.PK, visit.SK));

    // Phase 3 — the profile, which is what marks her and what indexes her.
    this.items.delete(rowKey(HH(householdId), PLAYER_SK(playerId)));
    this.persist();
    return true;
  }

  async touchPlayer(householdId: string, playerId: string, lastPlayedAt: string, keepUntil: string | null): Promise<void> {
    const row = this.items.get(rowKey(HH(householdId), PLAYER_SK(playerId)));
    if (!row || row.sweeping) return;
    const { GSI1PK: _pk, GSI1SK: _sk, ...rest } = row;
    this.put({
      ...rest,
      lastPlayedAt,
      ...(keepUntil ? { GSI1PK: GSI1_IDLE, GSI1SK: GSI1_IDLE_SK(keepUntil, householdId, playerId) } : {}),
    });
  }

  async getLastPlayed(householdId: string, playerId: string): Promise<string | null> {
    const row = this.get(HH(householdId), PLAYER_SK(playerId));
    return row && !row.sweeping ? (row.lastPlayedAt ?? null) : null;
  }

  async listIdlePlayers(nowIso: string, limit = 25): Promise<IdlePlayer[]> {
    return this.queryIndex(GSI1_IDLE, GSI1_IDLE_SK(nowIso, "", ""))
      .slice(0, limit)
      .map(idlePlayer);
  }

  async rewriteEvent(event: EventRecord): Promise<void> {
    if (!this.get(RUN(event.runId), EVT_SK(event.seq))) return;
    this.put({ PK: RUN(event.runId), SK: EVT_SK(event.seq), entity: "event", data: event });
  }

  async forgetFinder(householdId: string, playerId: string): Promise<number> {
    if (!this.get(HH(householdId), FIELDGUIDE)) return 0;
    const entries = { ...this.readFieldGuide(householdId).entries };
    let changed = 0;
    for (const [canonId, find] of Object.entries(entries)) {
      if (find.firstFoundBy !== playerId) continue;
      entries[canonId] = { ...find, firstFoundBy: FORGOTTEN_FINDER };
      changed++;
    }
    if (changed > 0) this.put(fieldGuideItem(householdId, entries));
    return changed;
  }

  async putForget(job: ForgetJob): Promise<void> {
    this.put({
      PK: FORGET(job.playerId),
      SK: META,
      GSI1PK: GSI1_FORGET,
      GSI1SK: GSI1_FORGET_SK(job.createdAt, job.playerId),
      entity: "forget",
      data: job,
    });
  }

  async listForgets(limit = 25): Promise<ForgetJob[]> {
    return this.queryIndex(GSI1_FORGET)
      .slice(0, limit)
      .map((i) => i.data as ForgetJob);
  }

  async deleteForget(playerId: string): Promise<void> {
    this.items.delete(rowKey(FORGET(playerId), META));
    this.persist();
  }

  async putVisit(playerId: string, tableHouseholdId: string, at: string): Promise<void> {
    this.put({ PK: VISIT(playerId), SK: HH(tableHouseholdId), entity: "visit", data: { playerId, householdId: tableHouseholdId, at } });
  }

  async listVisits(playerId: string): Promise<string[]> {
    return this.query(VISIT(playerId), "HH#").map((i) => i.SK.slice("HH#".length));
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

  async putOwner(owner: HouseholdOwnerRecord): Promise<void> {
    // No await between the two: one transaction, as in the real store.
    this.put({ PK: HH(owner.householdId), SK: OWNER_SK(owner.cognitoSub), entity: "owner", data: owner });
    this.put({
      PK: ACCT(owner.cognitoSub),
      SK: HH(owner.householdId),
      entity: "account",
      data: { cognitoSub: owner.cognitoSub, householdId: owner.householdId },
    });
  }

  async listOwners(householdId: string): Promise<HouseholdOwnerRecord[]> {
    return this.query(HH(householdId), PREFIX.owner).map((i) => i.data as HouseholdOwnerRecord);
  }

  async removeOwner(householdId: string, cognitoSub: string): Promise<void> {
    this.items.delete(rowKey(HH(householdId), OWNER_SK(cognitoSub)));
    this.items.delete(rowKey(ACCT(cognitoSub), HH(householdId)));
    this.persist();
  }

  async putOrganizerInviteIfAbsent(invite: OrganizerInviteRecord): Promise<boolean> {
    if (this.get(INVITE(invite.code), META)) return false;
    this.put({ PK: INVITE(invite.code), SK: META, ttl: invite.ttl, entity: "invite", data: invite });
    return true;
  }

  async redeemOrganizerInvite(
    code: string,
    nowIso: string,
    owner: Omit<HouseholdOwnerRecord, "householdId">,
  ): Promise<OrganizerInviteRecord | null> {
    // Nothing yields from the read to the last write (`putOwner` writes before
    // its first await): one transaction, as in the real store.
    const item = this.get(INVITE(code), META);
    const invite = item?.data as OrganizerInviteRecord | undefined;
    if (!invite || invite.expiresAt <= nowIso) return null;
    // The real store's condition check on the household (#252): a code made
    // before its household was deleted hands out nothing.
    const household = this.get(HH(invite.householdId), META);
    if (!household || household.sweeping) return null;
    this.items.delete(rowKey(INVITE(code), META));
    await this.putOwner({ ...owner, householdId: invite.householdId });
    return invite;
  }

  async putPairingCodeIfAbsent(pairing: PairingCodeRecord): Promise<boolean> {
    if (this.get(PAIR(pairing.code), META)) return false;
    this.put({ PK: PAIR(pairing.code), SK: META, ttl: pairing.ttl, entity: "pairing", data: pairing });
    return true;
  }

  async redeemPairingCode(code: string, nowIso: string): Promise<PairingCodeRecord | null> {
    const pairing = this.get(PAIR(code), META)?.data as PairingCodeRecord | undefined;
    if (!pairing || pairing.expiresAt <= nowIso) return null;
    this.items.delete(rowKey(PAIR(code), META));
    this.persist();
    return pairing;
  }

  async putTransferCodeIfAbsent(record: TransferCodeRecord): Promise<boolean> {
    if (this.get(TRANSFER(record.code), META)) return false;
    this.put({ PK: TRANSFER(record.code), SK: META, ttl: record.ttl, entity: "transfer", data: record });
    return true;
  }

  async getTransferCode(code: string, nowIso: string): Promise<TransferCodeRecord | null> {
    const record = this.get(TRANSFER(code), META)?.data as TransferCodeRecord | undefined;
    return record && record.expiresAt > nowIso ? record : null;
  }

  async readProfileMove(householdId: string, playerId: string): Promise<ProfileMove | null> {
    const player = this.get(HH(householdId), PLAYER_SK(playerId));
    if (!player || player.sweeping) return null;
    return collectMove(householdId, playerId, {
      player,
      characters: this.query(HH(householdId), PREFIX.character),
      devices: this.query(HH(householdId), PREFIX.device),
      book: this.readFieldGuide(householdId),
    });
  }

  async moveProfile(input: MoveProfileInput): Promise<MoveOutcome> {
    const steps = planMove(input);
    if (!steps) return "too-big";

    // Every condition the real transaction carries, checked before anything
    // is written, and no await from here to the last write: one transaction.
    for (const step of steps) {
      if (step.op === "spend") {
        const code = this.get(TRANSFER(step.code), META)?.data as TransferCodeRecord | undefined;
        const good =
          code !== undefined &&
          code.expiresAt > step.nowIso &&
          code.householdId === step.householdId &&
          code.playerId === step.playerId;
        if (!good) return "spent";
      } else if (step.op === "check") {
        if (!this.get(step.PK, step.SK)) return "changed";
      } else if (step.op === "delete") {
        const row = this.get(step.PK, step.SK);
        if (!row || !isDeepStrictEqual(row.data, step.data)) return "changed";
      } else if (step.op === "put") {
        if (step.ifAbsent && this.get(step.item.PK, step.item.SK)) return "changed";
      }
    }

    for (const step of steps) {
      if (step.op === "spend") {
        this.items.delete(rowKey(TRANSFER(step.code), META));
      } else if (step.op === "delete") {
        this.items.delete(rowKey(step.PK, step.SK));
      } else if (step.op === "put") {
        this.put(step.item);
      } else if (step.op === "finds") {
        // First finder wins in her new home's book too.
        const entries = { ...this.readFieldGuide(step.householdId).entries };
        for (const [canonId, find] of Object.entries(step.entries)) {
          if (!Object.hasOwn(entries, canonId)) entries[canonId] = find;
        }
        this.put(fieldGuideItem(step.householdId, entries));
      }
    }
    this.persist();
    return "moved";
  }

  async getMovedDevice(householdId: string, deviceId: string): Promise<string | null> {
    const forward = this.get(HH(householdId), MOVED_SK(deviceId))?.data as { householdId?: string } | undefined;
    return forward?.householdId ?? null;
  }

  async putPlayer(player: PlayerProfile): Promise<void> {
    const row = this.items.get(rowKey(HH(player.householdId), PLAYER_SK(player.id)));
    // Never over a profile being deleted, as the real store's condition says.
    if (row?.sweeping) return;
    this.writePlayer(row, player);
  }

  async updatePlayer(player: PlayerProfile): Promise<boolean> {
    const row = this.items.get(rowKey(HH(player.householdId), PLAYER_SK(player.id)));
    if (!row || row.sweeping) return false;
    this.writePlayer(row, player);
    return true;
  }

  /**
   * `data` only, like the real store's update: when she last played, her
   * retention entry and a delete's mark are not the profile's to clear.
   */
  private writePlayer(row: TableItem | undefined, player: PlayerProfile): void {
    const { PK: _pk, SK: _sk, entity: _entity, data: _data, ...kept } = row ?? ({} as Partial<TableItem>);
    this.put({
      ...kept,
      PK: HH(player.householdId),
      SK: PLAYER_SK(player.id),
      entity: "player",
      data: player,
    });
  }

  async getPlayer(householdId: string, playerId: string): Promise<PlayerProfile | null> {
    // A profile being deleted (#252) is gone to every reader already.
    const row = this.get(HH(householdId), PLAYER_SK(playerId));
    return row && !row.sweeping ? (row.data as PlayerProfile) : null;
  }

  async listPlayers(householdId: string): Promise<PlayerProfile[]> {
    return this.query(HH(householdId), PREFIX.player)
      .filter((i) => !i.sweeping)
      .map((i) => i.data as PlayerProfile);
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
    // hold them to the same behavior.
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
    this.put(characterItem(character));
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

  async writeCharacter(write: CharacterWrite): Promise<boolean> {
    const { householdId, id } = write.character;
    if (!claimHolds(this.get(HH(householdId), CHAR_SK(id)), write)) return false;
    this.put(characterItem(claimedRow(write)));
    return true;
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

  async getCampaignProgress(
    householdId: string,
    campaignId: string,
  ): Promise<CampaignProgressRecord | null> {
    const item = this.get(HH(householdId), CAMPAIGN_SK(campaignId));
    return (item?.data as CampaignProgressRecord | undefined) ?? null;
  }

  async listCampaignProgress(householdId: string): Promise<CampaignProgressRecord[]> {
    return this.query(HH(householdId), PREFIX.campaign).map(
      (i) => i.data as CampaignProgressRecord,
    );
  }

  async getFieldGuide(householdId: string): Promise<FieldGuideRecord> {
    return this.readFieldGuide(householdId);
  }

  private readFieldGuide(householdId: string): FieldGuideRecord {
    const item = this.get(HH(householdId), FIELDGUIDE);
    return migrateFieldGuide(item?.data ?? {}, item ? (item.v ?? 0) : FIELD_GUIDE_VERSION);
  }

  async recordDiscoveries(householdId: string, discoveries: FieldGuideDiscovery[]): Promise<string[]> {
    // The first-wins rule is what DynamoRepository gets from `if_not_exists`.
    // No `await` between the read and the put - that is the atomicity.
    const entries = { ...this.readFieldGuide(householdId).entries };
    const added: string[] = [];
    for (const d of discoveries) {
      if (!d.canonId || Object.hasOwn(entries, d.canonId)) continue;
      const entry: FieldGuideFind = {
        firstFoundBy: d.playerId,
        foundAt: d.foundAt ?? new Date(this.now()).toISOString(),
        ...(d.runId ? { runId: d.runId } : {}),
      };
      entries[d.canonId] = entry;
      added.push(d.canonId);
    }
    if (added.length > 0) {
      this.put({
        PK: HH(householdId),
        SK: FIELDGUIDE,
        entity: "field-guide",
        v: FIELD_GUIDE_VERSION,
        data: { entries },
      });
    }
    return added;
  }

  async putCampaignProgress(progress: CampaignProgressRecord): Promise<void> {
    this.put({
      PK: HH(progress.householdId),
      SK: CAMPAIGN_SK(progress.campaignId),
      entity: "campaign-progress",
      data: progress,
    });
  }

  async getState(runId: string): Promise<RunState | null> {
    return (this.get(RUN(runId), STATE)?.data as RunState | undefined) ?? null;
  }

  async putState(state: RunState): Promise<void> {
    this.put({ PK: RUN(state.runId), SK: STATE, entity: "state", data: state });
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
    const current = (this.get(RUN(runId), STATE)?.data as RunState | undefined) ?? null;
    // Both conditions of the real TransactWriteItems: the state has not moved,
    // and this seq has not already been written.
    if (!current || current.seq !== expectedSeq) return false;
    if (this.items.has(rowKey(RUN(runId), EVT_SK(event.seq)))) return false;

    if (campaignProgress) {
      if (campaignProgressExpectedVersion === undefined) {
        throw new Error("campaign progress commit is missing its expected version");
      }
      const stored =
        (this.get(
          HH(campaignProgress.householdId),
          CAMPAIGN_SK(campaignProgress.campaignId),
        )?.data as CampaignProgressRecord | undefined) ?? null;
      const matches =
        campaignProgressExpectedVersion === null
          ? stored === null
          : stored !== null && (stored.version ?? 0) === campaignProgressExpectedVersion;
      if (!matches) return false;
    }
    // The founder's household is still a guest game nobody has kept (#272).
    const founding = input.founder ? this.get(HH(input.founder.householdId), META) : undefined;
    if (input.founder) {
      const household = founding?.data as Household | undefined;
      if (!founding || founding.sweeping || !household?.guest || household.ownerSub) return false;
    }
    // Each hero still stands as this turn read her: her claim and her version.
    for (const write of characters) {
      const { householdId, id } = write.character;
      if (!claimHolds(this.get(HH(householdId), CHAR_SK(id)), write)) return false;
    }

    // No await from here through the final row: this is the local equivalent of
    // one TransactWriteItems, including across two different run partitions.
    this.put({ PK: RUN(runId), SK: EVT_SK(event.seq), entity: "event", data: event });
    this.put({ PK: RUN(runId), SK: STATE, entity: "state", data: state });
    if (input.founder && founding) {
      const { awaitingFounder: _taken, ...rest } = founding.data as Household;
      const household: Household = { ...rest, founderDeviceId: input.founder.deviceId };
      this.put({
        PK: HH(household.id),
        SK: META,
        ...(household.expiresAt ? { GSI1PK: GSI1_GUEST, GSI1SK: GSI1_GUEST_SK(household.expiresAt, household.id) } : {}),
        entity: "household",
        data: household,
      });
    }
    for (const write of characters) {
      this.put(characterItem(claimedRow(write)));
    }
    if (chapterProgress) {
      this.put({
        PK: RUN(chapterProgress.runId),
        SK: CHAPTER_SK(chapterProgress.index),
        entity: "chapter-progress",
        data: chapterProgress,
      });
    }
    if (campaignProgress) {
      this.put({
        PK: HH(campaignProgress.householdId),
        SK: CAMPAIGN_SK(campaignProgress.campaignId),
        entity: "campaign-progress",
        data: campaignProgress,
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

  async claimRoom(input: { code: string; run: RunRecord; householdId: string }): Promise<boolean> {
    const { code, run, householdId } = input;
    const item = this.get(ROOM(code), META);
    const room = item?.data as RoomRecord | undefined;
    // The same three conditions as the DynamoDB transaction.
    if (!item || !room || room.claimable !== true) return false;
    if (room.runId !== run.id || room.householdId !== run.householdId) return false;

    // No await from here on: one transaction, as in the real store.
    const { claimable: _claimable, ...settled } = room;
    this.put({ ...item, data: { ...settled, householdId } });
    if (householdId !== run.householdId) {
      this.items.delete(rowKey(HH(run.householdId), RUN_SK(run.id)));
      this.put({
        PK: HH(householdId),
        SK: RUN_SK(run.id),
        GSI1PK: GSI1_RUN(run.id),
        GSI1SK: HH(householdId),
        entity: "run",
        data: { ...run, householdId },
      });
    }
    return true;
  }

  // --- room-code lookups ----------------------------------------------------

  async reserveCodeLookup(clientKey: string, window: number, limit: number, ttl: number): Promise<boolean> {
    // No await between the read and the write: atomic, as the conditional
    // `ADD` is in the real store.
    const existing = this.get(GUESS(clientKey), GUESS_WINDOW_SK(window));
    const taken = (existing?.data as number | undefined) ?? 0;
    if (taken >= limit) return false;
    this.put({
      PK: GUESS(clientKey),
      SK: GUESS_WINDOW_SK(window),
      ttl: existing?.ttl ?? ttl,
      entity: "code-lookups",
      data: taken + 1,
    });
    return true;
  }

  async refundCodeLookup(clientKey: string, window: number): Promise<void> {
    const existing = this.get(GUESS(clientKey), GUESS_WINDOW_SK(window));
    const taken = (existing?.data as number | undefined) ?? 0;
    if (!existing || taken <= 0) return;
    this.put({ ...existing, data: taken - 1 });
  }

  async touchPresence(runId: string, playerId: string, at: string, ttl: number): Promise<Record<string, string>> {
    // No await between the read and the write: one atomic step, as the
    // nested `SET` is in the real store.
    const existing = this.get(RUN(runId), PRESENCE);
    const beats = { ...((existing?.data as Record<string, string> | undefined) ?? {}), [playerId]: at };
    this.put({ PK: RUN(runId), SK: PRESENCE, ttl, entity: "presence", data: beats });
    return { ...beats };
  }
}

function characterItem(character: Character): TableItem {
  return {
    PK: HH(character.householdId),
    SK: CHAR_SK(character.id),
    entity: "character",
    // Both unconditional puts and transactional commits go through this
    // builder so neither path can omit progression fields or the schema stamp.
    v: CHARACTER_VERSION,
    data: character,
  };
}

function idlePlayer(item: TableItem): IdlePlayer {
  // From the row itself, not the index key: a kid who moved (#251) took her
  // entry with her, and her row names where she lives now.
  return {
    householdId: item.PK.slice("HH#".length),
    playerId: (item.data as PlayerProfile).id,
    lastPlayedAt: item.lastPlayedAt ?? "",
  };
}

function rowKey(pk: string, sk: string): string {
  return `${pk} ${sk}`;
}
