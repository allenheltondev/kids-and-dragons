import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunState } from "@kad/shared";
import { makeClock } from "../test-support.ts";
import { EVT_SK } from "./keys.ts";
import { MemoryRepository } from "./memory-repository.ts";
import type { RoomRecord } from "./repository.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function tempFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kad-store-"));
  tempDirs.push(dir);
  return path.join(dir, ".data", "dev-table.json");
}

function state(runId: string, seq: number): RunState {
  return {
    runId,
    roomCode: "ABCD",
    mode: "party",
    seq,
    phase: "lobby",
    campaignId: null,
    chapterId: null,
    sceneId: null,
    sceneType: null,
    narration: "",
    art: null,
    party: [],
    prompt: null,
    lastRoll: null,
    flags: {},
    xpEarned: 0,
    updatedAt: "2026-07-04T18:00:00.000Z",
  };
}

function room(overrides: Partial<RoomRecord> = {}): RoomRecord {
  const now = Date.parse("2026-07-04T18:00:00.000Z");
  return {
    code: "ABCD",
    runId: "r_1",
    householdId: "h_1",
    mode: "party",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 6 * 3600_000).toISOString(),
    ttl: Math.floor((now + 6 * 3600_000) / 1000),
    ...overrides,
  };
}

describe("keys", () => {
  it("zero-pads event sort keys so they sort in seq order", () => {
    // Without padding `EVT#10` sorts before `EVT#9` and reconnect replays the
    // run out of order — silently.
    expect(EVT_SK(9) < EVT_SK(10)).toBe(true);
    expect([EVT_SK(11), EVT_SK(2), EVT_SK(1)].sort()).toEqual([EVT_SK(1), EVT_SK(2), EVT_SK(11)]);
  });
});

describe("MemoryRepository", () => {
  it("stores households, players, characters, and devices under the household", async () => {
    const repo = new MemoryRepository();
    await repo.putHousehold({
      id: "h_1",
      displayName: "Home",
      ownerSub: "sub",
      guest: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await repo.putPlayer({
      id: "p_1",
      householdId: "h_1",
      displayName: "Allen",
      color: "#7FD4C1",
      role: "adult",
    });
    await repo.putDevice({
      deviceId: "d_1",
      householdId: "h_1",
      playerId: "p_1",
      tokenHash: "hash",
      lastSeen: "2026-01-01T00:00:00.000Z",
    });

    expect((await repo.getHousehold("h_1"))?.displayName).toBe("Home");
    expect(await repo.listPlayers("h_1")).toHaveLength(1);
    // GSI1: a returning phone resolves from the device id alone (§3).
    expect((await repo.getDeviceById("d_1"))?.playerId).toBe("p_1");

    await repo.revokeDevice("h_1", "d_1");
    expect((await repo.getDeviceById("d_1"))?.revoked).toBe(true);
  });

  it("commits state and event together, and refuses a stale expectedSeq", async () => {
    const repo = new MemoryRepository();
    await repo.putState(state("r_1", 0));

    const first = await repo.commit({
      runId: "r_1",
      expectedSeq: 0,
      state: state("r_1", 1),
      event: { seq: 1, runId: "r_1", patch: [], at: "now" },
    });
    expect(first).toBe(true);

    // Same expectedSeq again: the run has moved on, so this loses.
    const second = await repo.commit({
      runId: "r_1",
      expectedSeq: 0,
      state: state("r_1", 1),
      event: { seq: 1, runId: "r_1", patch: [], at: "now" },
    });
    expect(second).toBe(false);
    expect(await repo.listEvents("r_1", 0)).toHaveLength(1);
  });

  it("lists events in seq order across the 9 → 10 boundary", async () => {
    const repo = new MemoryRepository();
    await repo.putState(state("r_1", 0));
    for (let seq = 1; seq <= 12; seq++) {
      await repo.commit({
        runId: "r_1",
        expectedSeq: seq - 1,
        state: state("r_1", seq),
        event: { seq, runId: "r_1", patch: [], at: "now" },
      });
    }
    expect((await repo.listEvents("r_1", 0)).map((e) => e.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect((await repo.listEvents("r_1", 9)).map((e) => e.seq)).toEqual([10, 11, 12]);
    expect(await repo.listEvents("r_1", 3, 2)).toHaveLength(2);
  });

  it("creates a room only if the code is free, and frees it again at TTL", async () => {
    const clock = makeClock(Date.parse("2026-07-04T18:00:00.000Z"));
    const repo = new MemoryRepository({ now: clock.now });

    expect(await repo.putRoomIfAbsent(room())).toBe(true);
    expect(await repo.putRoomIfAbsent(room({ runId: "r_2" }))).toBe(false);
    expect((await repo.getRoom("ABCD"))?.runId).toBe("r_1");
    // Codes are case-insensitive on the wire.
    expect((await repo.getRoom("abcd"))?.runId).toBe("r_1");

    clock.advance(6 * 3600_000 + 1);
    expect(await repo.getRoom("ABCD")).toBeNull();
    expect(await repo.putRoomIfAbsent(room({ runId: "r_3" }))).toBe(true);
  });

  it("survives a restart", async () => {
    const filePath = await tempFile();
    const repo = await MemoryRepository.open({ filePath });
    await repo.putHousehold({
      id: "h_1",
      displayName: "Home",
      ownerSub: "sub",
      guest: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await repo.putState(state("r_1", 3));
    await repo.flush();

    const restarted = await MemoryRepository.open({ filePath });
    expect((await restarted.getHousehold("h_1"))?.displayName).toBe("Home");
    expect((await restarted.getState("r_1"))?.seq).toBe(3);

    // The mirror is a table export: the real PK/SK live on every row.
    const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      items: { PK: string; SK: string }[];
    };
    expect(raw.items).toContainEqual(expect.objectContaining({ PK: "HH#h_1", SK: "META" }));
    expect(raw.items).toContainEqual(expect.objectContaining({ PK: "RUN#r_1", SK: "STATE" }));
  });

  it("starts empty rather than refusing to boot on a corrupt mirror", async () => {
    const filePath = await tempFile();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{ this is not json", "utf8");
    const repo = await MemoryRepository.open({ filePath });
    expect(await repo.getHousehold("h_1")).toBeNull();
  });
});

/*
 * The guest-household lifecycle used to be tested here. It now lives in
 * `contract.test.ts`, which runs the same cases against this store *and*
 * against DynamoDB — the interlock between claiming and sweeping is exactly the
 * kind of thing where a local-only test would pass while prod lost a family's
 * characters.
 */
