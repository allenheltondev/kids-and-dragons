/**
 * Moving a kid to another home (#251, architecture §4.5 "Who owns what"), as
 * one list of steps both stores carry out.
 *
 * Her profile, her heroes and her own phone's binding are rows under
 * `HH#<home>`, so moving her is deleting each one there and writing it,
 * unchanged but for its household, under the new home: the same ids, the same
 * `data`, the same schema stamp (`v`), so a row from an older build is moved
 * as it is and migrated on its next read like any other (§3.2). Her Field
 * Guide finds are added to the new home's book, first finder wins there too.
 *
 * Written once here rather than in each store, because the point of the plan
 * is that it is the same plan: `MemoryRepository` applies it directly and
 * `DynamoRepository` sends it as one TransactWriteItems. A step the two stores
 * read differently would be a move that works on a laptop and not at a club.
 */

import { FIELD_GUIDE_VERSION } from "@kad/shared";
import type { DeviceBinding, FieldGuideFind, FieldGuideRecord, Household, PersonalDeviceBinding, PlayerProfile } from "@kad/shared";
import { readAll } from "./character-io.ts";
import type { HouseholdOwnerRecord, MoveProfileInput, ProfileMove } from "./repository.ts";
import {
  ACCT,
  CHAR_SK,
  DEVICE_SK,
  FIELDGUIDE,
  GSI1_DEVICE,
  HH,
  META,
  MOVED_SK,
  OWNER_SK,
  PLAYER_SK,
  TRANSFER,
} from "./keys.ts";

/** DynamoDB's cap on one TransactWriteItems. A move is one, or it is refused. */
export const MOVE_ITEM_LIMIT = 100;

/** A row as both stores hold it (their own `TableItem`s are this, plus bookkeeping). */
export interface StoredRow {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  ttl?: number;
  v?: number;
  entity: string;
  data: unknown;
}

/**
 * What a store read for a move (`ProfileMove.rows`): the rows exactly as
 * stored, so every delete can be conditioned on the row being the one read.
 */
export interface ProfileRows {
  player: StoredRow;
  characters: StoredRow[];
  /** Her personal bindings, revoked or not. A shared tablet is never one. */
  devices: StoredRow[];
  /** Hers in the household's book, as read through `migrateFieldGuide`. */
  finds: Record<string, FieldGuideFind>;
}

/** One write, in the order the transaction carries them. */
export type MoveStep =
  /** Spend the code: there, unexpired, and naming this kid in this household. */
  | { op: "spend"; code: string; householdId: string; playerId: string; nowIso: string }
  /** The home she is moving into is still there. */
  | { op: "check"; PK: string; SK: string }
  /** Gone from the old home, if it is still exactly the row read. */
  | { op: "delete"; PK: string; SK: string; data: unknown }
  /**
   * Written in the new home, where nothing has that key yet (`ifAbsent`). A
   * forward is the one row written over whatever is there: she may have moved
   * out of this home once before.
   */
  | { op: "put"; item: StoredRow; ifAbsent: boolean }
  /** Her finds, added to the new home's book without touching what is there. */
  | { op: "finds"; householdId: string; entries: Record<string, FieldGuideFind>; fresh: boolean };

/**
 * `readProfileMove`, from what a store read: the profile row, the household's
 * character and device partitions, and its book. Picks out what is hers.
 */
export function collectMove(
  householdId: string,
  playerId: string,
  read: { player: StoredRow; characters: readonly StoredRow[]; devices: readonly StoredRow[]; book: FieldGuideRecord },
): ProfileMove {
  const characters = read.characters.filter((row) => (row.data as { ownerPlayerId?: string }).ownerPlayerId === playerId);
  const devices = read.devices.filter((row) => {
    const device = row.data as DeviceBinding;
    return device.kind !== "shared" && device.playerId === playerId;
  });
  const finds: Record<string, FieldGuideFind> = {};
  for (const [canonId, find] of Object.entries(read.book.entries)) {
    if (find.firstFoundBy === playerId) finds[canonId] = find;
  }
  const rows: ProfileRows = { player: read.player, characters, devices, finds };
  return {
    householdId,
    player: read.player.data as PlayerProfile,
    characters: readAll(characters, householdId),
    devices: devices.map((row) => row.data as PersonalDeviceBinding),
    finds,
    rows,
  };
}

/** The steps for one move, or `null` when they would not fit in one transaction. */
export function planMove(input: MoveProfileInput): MoveStep[] | null {
  const { move, code, nowIso } = input;
  const rows = move.rows as ProfileRows;
  const from = move.householdId;
  const to = destination(input.to);
  if (to === from) throw new Error(`${move.player.id} already lives in ${to}`);
  const steps: MoveStep[] = [{ op: "spend", code, householdId: from, playerId: move.player.id, nowIso }];

  if ("household" in input.to) {
    steps.push(...newHome(input.to.household, input.to.owner));
  } else {
    steps.push({ op: "check", PK: HH(to), SK: META });
  }

  // She arrives on the pickers: a group's kid going home at the end of term
  // is the reason this exists, and "taken off the list" was the group's word.
  const { retired: _left, ...profile } = rows.player.data as { retired?: true };
  steps.push(
    { op: "delete", PK: rows.player.PK, SK: rows.player.SK, data: rows.player.data },
    {
      op: "put",
      item: { ...rows.player, PK: HH(to), SK: PLAYER_SK(move.player.id), data: { ...profile, householdId: to } },
      ifAbsent: true,
    },
  );

  for (const row of rows.characters) {
    const id = (row.data as { id: string }).id;
    steps.push(
      { op: "delete", PK: row.PK, SK: row.SK, data: row.data },
      {
        op: "put",
        item: {
          ...row,
          PK: HH(to),
          SK: CHAR_SK(id),
          data: { ...(row.data as object), householdId: to },
        },
        ifAbsent: true,
      },
    );
  }

  for (const row of rows.devices) {
    const device = row.data as { deviceId: string; revoked?: boolean };
    steps.push({ op: "delete", PK: row.PK, SK: row.SK, data: row.data });
    // A revoked binding is a dead token: it is dropped, not carried.
    if (device.revoked) continue;
    steps.push(
      {
        op: "put",
        item: {
          ...row,
          PK: HH(to),
          SK: DEVICE_SK(device.deviceId),
          GSI1PK: GSI1_DEVICE(device.deviceId),
          GSI1SK: HH(to),
          data: { ...(row.data as object), householdId: to },
        },
        ifAbsent: true,
      },
      {
        op: "put",
        item: {
          PK: HH(from),
          SK: MOVED_SK(device.deviceId),
          ttl: input.forwardTtl,
          entity: "moved-device",
          data: { deviceId: device.deviceId, householdId: to, movedAt: nowIso },
        },
        ifAbsent: false,
      },
    );
  }

  if (Object.keys(rows.finds).length > 0) {
    steps.push({ op: "finds", householdId: to, entries: rows.finds, fresh: "household" in input.to });
  }
  return steps.length <= MOVE_ITEM_LIMIT ? steps : null;
}

/** The household a move goes to. */
export function destination(to: MoveProfileInput["to"]): string {
  return "household" in to ? to.household.id : to.householdId;
}

/** The book a new home starts with: hers. */
export function fieldGuideItem(householdId: string, entries: Record<string, FieldGuideFind>): StoredRow {
  return { PK: HH(householdId), SK: FIELDGUIDE, entity: "field-guide", v: FIELD_GUIDE_VERSION, data: { entries } };
}

/** A household made for her, owned by whoever redeemed the code: the rows `createGroup` writes. */
function newHome(household: Household, owner: HouseholdOwnerRecord): MoveStep[] {
  if (household.guest) throw new Error("a kid moves into a kept household, never a guest one");
  return [
    { op: "put", item: { PK: HH(household.id), SK: META, entity: "household", data: household }, ifAbsent: true },
    {
      op: "put",
      item: { PK: HH(household.id), SK: OWNER_SK(owner.cognitoSub), entity: "owner", data: owner },
      ifAbsent: true,
    },
    {
      op: "put",
      item: {
        PK: ACCT(owner.cognitoSub),
        SK: HH(household.id),
        entity: "account",
        data: { cognitoSub: owner.cognitoSub, householdId: household.id },
      },
      ifAbsent: true,
    },
  ];
}

/** The code's key, for the stores' `spend` step. */
export const transferKey = (code: string) => ({ PK: TRANSFER(code), SK: META });
