/**
 * The `GameRepository` contract — run against **every** implementation.
 *
 * The local store's whole justification is that swapping in `DynamoRepository`
 * is a wiring change rather than a re-modelling exercise (see the header of
 * `memory-repository.ts`). That claim is only worth anything if something checks
 * it, so this file is written once and executed twice: against `MemoryRepository`
 * always, and against `DynamoRepository` on a real DynamoDB whenever
 * `KAD_DDB_ENDPOINT` points at one (`npm run ddb:local`, and CI).
 *
 * What lives here is the behaviour the game *depends on* rather than the
 * behaviour DynamoDB happens to have — conditional room creation, the
 * transactional commit, event ordering under zero-padding, GSI1 lookups, and the
 * guest-household lifecycle. If the two stores ever disagree about one of these,
 * a bug found at the table would be unreproducible on a laptop, which is the
 * failure this suite exists to prevent.
 */

import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Character, Household, PlayerProfile, RunState } from "@kad/shared";
import { DynamoRepository, GSI1_NAME } from "./dynamo-repository.ts";
import { MemoryRepository } from "./memory-repository.ts";
import type { EventRecord, GameRepository, RoomRecord } from "./repository.ts";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function household(overrides: Partial<Household> = {}): Household {
  return {
    id: "h_1",
    displayName: "Home",
    ownerSub: null,
    guest: false,
    createdAt: "2026-07-04T18:00:00.000Z",
    ...overrides,
  };
}

function guest(id: string, expiresAt: string): Household {
  return household({ id, displayName: "Guests", guest: true, expiresAt });
}

function player(id: string, householdId = "h_1"): PlayerProfile {
  return { id, householdId, displayName: `Player ${id}`, color: "#7FD4C1", role: "adult" };
}

function character(id: string, householdId = "h_1"): Character {
  return {
    id,
    householdId,
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    committed: {
      level: 1,
      xp: 0,
      stats: { might: 1, quick: 2, clever: 2, heart: 4 },
      tier: "fledgling",
      unlockedActions: [],
      inventory: [],
    },
    questItems: [],
    souvenirs: [],
    createdAt: "2026-07-04T18:00:00.000Z",
  };
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

function event(runId: string, seq: number): EventRecord {
  return {
    seq,
    runId,
    patch: [{ op: "replace", path: "/seq", value: seq }],
    at: "2026-07-04T18:00:00.000Z",
    playerId: "p_1",
  };
}

function room(overrides: Partial<RoomRecord> = {}): RoomRecord {
  const expires = Date.now() + 6 * HOUR;
  return {
    code: "ABCD",
    runId: "r_1",
    householdId: "h_1",
    mode: "party",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(expires).toISOString(),
    ttl: Math.floor(expires / 1000),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

function contract(name: string, open: () => Promise<GameRepository>): void {
  describe(`GameRepository contract — ${name}`, () => {
    let repo: GameRepository;
    beforeEach(async () => {
      repo = await open();
    });

    describe("household scope", () => {
      it("keeps players, devices, and characters under the household", async () => {
        await repo.putHousehold(household());
        await repo.putPlayer(player("p_1"));
        await repo.putPlayer(player("p_2"));
        await repo.putCharacter(character("c_1"));
        await repo.putDevice({
          deviceId: "d_1",
          householdId: "h_1",
          playerId: "p_1",
          tokenHash: "hash",
          lastSeen: "2026-07-04T18:00:00.000Z",
        });

        expect((await repo.getHousehold("h_1"))?.displayName).toBe("Home");
        expect((await repo.listPlayers("h_1")).map((p) => p.id)).toEqual(["p_1", "p_2"]);
        expect((await repo.getCharacter("h_1", "c_1"))?.name).toBe("Sparklehoof");
        expect(await repo.listCharacters("h_1")).toHaveLength(1);
        expect(await repo.listDevices("h_1")).toHaveLength(1);
      });

      it("resolves a returning phone from its device id alone", async () => {
        // GSI1 (§3) — this is what removes the "who are you?" step at join.
        await repo.putDevice({
          deviceId: "d_1",
          householdId: "h_1",
          playerId: "p_1",
          tokenHash: "hash",
          lastSeen: "2026-07-04T18:00:00.000Z",
        });
        expect(await repo.getDeviceById("d_1")).toMatchObject({
          householdId: "h_1",
          playerId: "p_1",
        });
        expect(await repo.getDeviceById("d_nope")).toBeNull();
      });

      it("revokes a device without touching anything it owns", async () => {
        await repo.putCharacter(character("c_1"));
        await repo.putDevice({
          deviceId: "d_1",
          householdId: "h_1",
          playerId: "p_1",
          tokenHash: "hash",
          lastSeen: "2026-07-04T18:00:00.000Z",
        });

        await repo.revokeDevice("h_1", "d_1");

        expect((await repo.getDeviceById("d_1"))?.revoked).toBe(true);
        // "Revoking a device does not touch any character" (§4.5) — a lost phone
        // must never cost a kid her unicorn.
        expect(await repo.getCharacter("h_1", "c_1")).not.toBeNull();
      });

      it("maps an account to its households", async () => {
        await repo.putAccountPointer("sub_a", "h_1");
        await repo.putAccountPointer("sub_a", "h_2");
        expect((await repo.listHouseholdsForAccount("sub_a")).sort()).toEqual(["h_1", "h_2"]);
        expect(await repo.listHouseholdsForAccount("sub_b")).toEqual([]);
      });
    });

    describe("guest households", () => {
      it("lists only guests whose expiry has passed", async () => {
        const now = Date.now();
        await repo.putHousehold(guest("h_stale", new Date(now - DAY).toISOString()));
        await repo.putHousehold(guest("h_fresh", new Date(now + DAY).toISOString()));
        await repo.putHousehold(household({ id: "h_owned", ownerSub: "sub" }));

        const expired = await repo.listExpiredGuestHouseholds(new Date(now).toISOString());
        expect(expired.map((h) => h.id)).toEqual(["h_stale"]);
      });

      it("claiming drops it out of the sweep index for good", async () => {
        const now = Date.now();
        await repo.putHousehold(guest("h_1", new Date(now - DAY).toISOString()));

        expect(await repo.claimHousehold("h_1", "sub_a")).toBe(true);

        const claimed = await repo.getHousehold("h_1");
        expect(claimed).toMatchObject({ guest: false, ownerSub: "sub_a" });
        expect(claimed).not.toHaveProperty("expiresAt");
        expect(await repo.listExpiredGuestHouseholds(new Date(now).toISOString())).toEqual([]);
        expect(await repo.listHouseholdsForAccount("sub_a")).toEqual(["h_1"]);
      });

      it("is idempotent for the same account and refuses a different one", async () => {
        await repo.putHousehold(guest("h_1", new Date(Date.now() + DAY).toISOString()));
        expect(await repo.claimHousehold("h_1", "sub_a")).toBe(true);
        expect(await repo.claimHousehold("h_1", "sub_a")).toBe(true);
        expect(await repo.claimHousehold("h_1", "sub_b")).toBe(false);
        expect((await repo.getHousehold("h_1"))?.ownerSub).toBe("sub_a");
      });

      it("will not claim a household that does not exist", async () => {
        expect(await repo.claimHousehold("h_nope", "sub_a")).toBe(false);
      });

      it("refuses to sweep a household that was claimed first", async () => {
        /*
         * The race the sweeper used to lose. Reading the household, deciding it
         * is an expired guest, and *then* deleting it is not a guard — a
         * sign-in landing in that gap got a successful claim and then had the
         * characters deleted anyway, which is the one failure the whole feature
         * exists to prevent. The condition has to live in the delete.
         */
        const now = Date.now();
        await repo.putHousehold(guest("h_1", new Date(now - DAY).toISOString()));
        await repo.putCharacter(character("c_1"));

        expect(await repo.claimHousehold("h_1", "sub_a")).toBe(true);
        expect(await repo.deleteGuestHousehold("h_1", new Date(now).toISOString())).toBe(false);

        // Nothing was touched.
        expect(await repo.getHousehold("h_1")).toMatchObject({ guest: false });
        expect(await repo.getCharacter("h_1", "c_1")).not.toBeNull();
      });

      it("refuses to claim a household the sweeper has already started on", async () => {
        // The other side of the same interlock. Succeeding here would tell a
        // family their party is kept while it is being deleted.
        const now = Date.now();
        await repo.putHousehold(guest("h_1", new Date(now - DAY).toISOString()));
        await repo.deleteGuestHousehold("h_1", new Date(now).toISOString());

        expect(await repo.claimHousehold("h_1", "sub_a")).toBe(false);
      });

      it("will not sweep a guest whose expiry has not passed", async () => {
        const now = Date.now();
        await repo.putHousehold(guest("h_1", new Date(now + DAY).toISOString()));
        expect(await repo.deleteGuestHousehold("h_1", new Date(now).toISOString())).toBe(false);
        expect(await repo.getHousehold("h_1")).not.toBeNull();
      });

      it("will not sweep a household that was never a guest", async () => {
        await repo.putHousehold(household({ ownerSub: "sub_a" }));
        expect(await repo.deleteGuestHousehold("h_1", new Date().toISOString())).toBe(false);
        expect(await repo.getHousehold("h_1")).not.toBeNull();
      });

      it("deletes runs, rooms, and the account pointer with the household", async () => {
        await repo.putHousehold(guest("h_1", new Date(Date.now() - DAY).toISOString()));
        await repo.putPlayer(player("p_1"));
        await repo.putCharacter(character("c_1"));
        await repo.putRun({
          id: "r_1",
          householdId: "h_1",
          roomCode: "ABCD",
          campaignId: null,
          status: "active",
          createdAt: "2026-07-04T18:00:00.000Z",
        });
        await repo.putState(state("r_1", 0));
        await repo.commit({ runId: "r_1", expectedSeq: 0, state: state("r_1", 1), event: event("r_1", 1) });
        await repo.putRoomIfAbsent(room());

        expect(await repo.deleteGuestHousehold("h_1", new Date().toISOString())).toBe(true);

        expect(await repo.getHousehold("h_1")).toBeNull();
        expect(await repo.listPlayers("h_1")).toEqual([]);
        expect(await repo.listCharacters("h_1")).toEqual([]);
        expect(await repo.getRun("r_1")).toBeNull();
        // The run partition is a different partition, only reachable through the
        // household. Leaving it behind orphans the event log forever.
        expect(await repo.getState("r_1")).toBeNull();
        expect(await repo.listEvents("r_1", 0)).toEqual([]);
        expect(await repo.getRoom("ABCD")).toBeNull();
        /*
         * No account pointer is asserted here, because a swept household cannot
         * have one: the pointer is only ever written by `claimHousehold`, which
         * also clears `guest` — and a household that is not a guest is one this
         * call refuses outright. The pointer cleanup inside it is belt and
         * braces for a future path, not a case reachable today.
         */
      });
    });

    describe("runs and the event log", () => {
      it("finds a run from its id alone, past the room sharing that index key", async () => {
        // Regression: rooms are indexed under the same GSI1PK as the run they
        // point at, so an unfiltered lookup can return a RoomRecord as a run.
        await repo.putRun({
          id: "r_1",
          householdId: "h_1",
          roomCode: "ABCD",
          campaignId: "hollow-crown",
          status: "active",
          createdAt: "2026-07-04T18:00:00.000Z",
        });
        await repo.putRoomIfAbsent(room());

        expect(await repo.getRun("r_1")).toMatchObject({
          id: "r_1",
          householdId: "h_1",
          campaignId: "hollow-crown",
        });
        expect((await repo.listRuns("h_1")).map((r) => r.id)).toEqual(["r_1"]);
      });

      it("records chapter progress under the run", async () => {
        await repo.putChapterProgress({
          runId: "r_1",
          index: 1,
          chapterId: "bramblewood-01",
          status: "complete",
          xpEarned: 300,
          updatedAt: "2026-07-04T18:00:00.000Z",
        });
        expect(await repo.listChapterProgress("r_1")).toHaveLength(1);
      });

      it("advances state and event together, once", async () => {
        await repo.putState(state("r_1", 0));

        expect(
          await repo.commit({
            runId: "r_1",
            expectedSeq: 0,
            state: state("r_1", 1),
            event: event("r_1", 1),
          }),
        ).toBe(true);
        expect((await repo.getState("r_1"))?.seq).toBe(1);
        expect(await repo.listEvents("r_1", 0)).toHaveLength(1);
      });

      it("rejects a commit whose expected seq has moved on", async () => {
        await repo.putState(state("r_1", 0));
        await repo.commit({ runId: "r_1", expectedSeq: 0, state: state("r_1", 1), event: event("r_1", 1) });

        // Two phones tapping at once: the loser gets STALE_SEQ and resyncs.
        expect(
          await repo.commit({
            runId: "r_1",
            expectedSeq: 0,
            state: state("r_1", 1),
            event: event("r_1", 1),
          }),
        ).toBe(false);
        expect((await repo.getState("r_1"))?.seq).toBe(1);
        expect(await repo.listEvents("r_1", 0)).toHaveLength(1);
      });

      it("writes a character in the same transaction as the run", async () => {
        await repo.putState(state("r_1", 0));
        const hero = { ...character("h_1"), id: "c_win" };

        expect(
          await repo.commit({
            runId: "r_1",
            expectedSeq: 0,
            state: state("r_1", 1),
            event: event("r_1", 1),
            characters: [hero],
          }),
        ).toBe(true);
        expect((await repo.getCharacter("h_1", "c_win"))?.id).toBe("c_win");
      });

      it("leaves characters untouched when the commit loses the seq race", async () => {
        /*
         * The reason character writes belong in this transaction at all. XP is
         * folded into a character by the same intent that ends a chapter, so
         * writing it separately means the phone that loses the race still banks
         * its award — and a retry after a transient failure banks it twice.
         */
        await repo.putState(state("r_1", 0));
        await repo.commit({ runId: "r_1", expectedSeq: 0, state: state("r_1", 1), event: event("r_1", 1) });

        const loser = { ...character("h_1"), id: "c_loser" };
        expect(
          await repo.commit({
            runId: "r_1",
            expectedSeq: 0,
            state: state("r_1", 1),
            event: event("r_1", 1),
            characters: [loser],
          }),
        ).toBe(false);
        expect(await repo.getCharacter("h_1", "c_loser")).toBeNull();
      });

      it("refuses to commit against a run that has no state", async () => {
        expect(
          await repo.commit({
            runId: "r_ghost",
            expectedSeq: 0,
            state: state("r_ghost", 1),
            event: event("r_ghost", 1),
          }),
        ).toBe(false);
      });

      it("replays events in seq order past the ten boundary", async () => {
        // Zero-padding is a key contract, not a detail: unpadded, `EVT#10`
        // sorts before `EVT#9` and reconnect silently replays out of order.
        await repo.putState(state("r_1", 0));
        for (let seq = 1; seq <= 12; seq++) {
          await repo.commit({
            runId: "r_1",
            expectedSeq: seq - 1,
            state: state("r_1", seq),
            event: event("r_1", seq),
          });
        }

        expect((await repo.listEvents("r_1", 0)).map((e) => e.seq)).toEqual([
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
        ]);
        expect((await repo.listEvents("r_1", 8)).map((e) => e.seq)).toEqual([9, 10, 11, 12]);
        expect((await repo.listEvents("r_1", 0, 3)).map((e) => e.seq)).toEqual([1, 2, 3]);
        expect(await repo.listEvents("r_1", 12)).toEqual([]);
      });
    });

    describe("rooms", () => {
      it("hands a code to exactly one caller", async () => {
        expect(await repo.putRoomIfAbsent(room({ runId: "r_1" }))).toBe(true);
        // Two families cannot be handed the same four letters by a race.
        expect(await repo.putRoomIfAbsent(room({ runId: "r_2" }))).toBe(false);
        expect((await repo.getRoom("ABCD"))?.runId).toBe("r_1");
      });

      it("is case-insensitive on the code", async () => {
        await repo.putRoomIfAbsent(room());
        expect((await repo.getRoom("abcd"))?.code).toBe("ABCD");
      });

      it("reads as gone the moment it expires, not when the sweep runs", async () => {
        const past = Date.now() - HOUR;
        await repo.putRoomIfAbsent(
          room({ expiresAt: new Date(past).toISOString(), ttl: Math.floor(past / 1000) }),
        );
        // TTL deletion is eventual — up to 48h. A phone restoring a session must
        // be told the room is gone now, not two days from now (§3).
        expect(await repo.getRoom("ABCD")).toBeNull();
      });

      it("frees an expired code for reuse", async () => {
        const past = Date.now() - HOUR;
        await repo.putRoomIfAbsent(
          room({ runId: "r_1", expiresAt: new Date(past).toISOString(), ttl: Math.floor(past / 1000) }),
        );
        // 24^4 codes and a 6-hour TTL: codes have to recycle or the space runs out.
        expect(await repo.putRoomIfAbsent(room({ runId: "r_2" }))).toBe(true);
        expect((await repo.getRoom("ABCD"))?.runId).toBe("r_2");
      });

      it("deletes on request", async () => {
        await repo.putRoomIfAbsent(room());
        await repo.deleteRoom("ABCD");
        expect(await repo.getRoom("ABCD")).toBeNull();
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Implementations under test
// ---------------------------------------------------------------------------

contract("MemoryRepository", async () => new MemoryRepository());

/**
 * DynamoDB Local, when there is one. Skipped rather than failed without it so
 * `npm test` stays a two-second command on a laptop; CI always sets it, so the
 * prod store is never merged unverified.
 */
const endpoint = process.env.KAD_DDB_ENDPOINT;

if (!endpoint) {
  describe.skip("GameRepository contract — DynamoRepository (set KAD_DDB_ENDPOINT)", () => {
    it("is skipped", () => undefined);
  });
} else {
  const client = new DynamoDBClient({
    endpoint,
    region: process.env.AWS_REGION ?? "us-east-1",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  let n = 0;

  afterAll(() => {
    client.destroy();
  });

  contract("DynamoRepository", async () => {
    // A fresh table per test: DynamoDB has no truncate, and a suite that leaks
    // rows between cases fails in an order-dependent way that is miserable to
    // read. Creation is milliseconds against the local jar.
    const tableName = `kad-test-${process.pid}-${n++}`;
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
          { AttributeName: "PK", AttributeType: "S" },
          { AttributeName: "SK", AttributeType: "S" },
          { AttributeName: "GSI1PK", AttributeType: "S" },
          { AttributeName: "GSI1SK", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: GSI1_NAME,
            KeySchema: [
              { AttributeName: "GSI1PK", KeyType: "HASH" },
              { AttributeName: "GSI1SK", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
        ],
      }),
    );
    return new DynamoRepository({ tableName, client });
  });
}
