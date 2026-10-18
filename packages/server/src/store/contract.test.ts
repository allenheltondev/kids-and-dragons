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
 * What lives here is the behavior the game *depends on* rather than the
 * behavior DynamoDB happens to have — conditional room creation, the
 * transactional commit, event ordering under zero-padding, GSI1 lookups, and the
 * guest-household lifecycle. If the two stores ever disagree about one of these,
 * a bug found at the table would be unreproducible on a laptop, which is the
 * failure this suite exists to prevent.
 */

import { CreateTableCommand, DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FIELD_GUIDE_VERSION, FORGOTTEN_FINDER } from "@kad/shared";
import type { Character, Household, JourneyState, PlayerProfile, RunState } from "@kad/shared";
import { DynamoRepository, GSI1_NAME } from "./dynamo-repository.ts";
import { MemoryRepository } from "./memory-repository.ts";
import type { CharacterWrite, EventRecord, GameRepository, RoomRecord } from "./repository.ts";

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

/** A guest household started by device `d_1`, the only one that may claim it. */
function guest(id: string, expiresAt: string): Household {
  return household({ id, displayName: "Guests", guest: true, expiresAt, founderDeviceId: "d_1" });
}

function player(id: string, householdId = "h_1"): PlayerProfile {
  return { id, householdId, displayName: `Player ${id}`, color: "#7FD4C1" };
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

/** Every row in the store, as `PK SK`: what "nothing is left" is checked against. */
type Rows = (repo: GameRepository) => Promise<string[]>;

function contract(name: string, open: () => Promise<GameRepository>, rows: Rows): void {
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

      it("resolves a device by primary key too", async () => {
        // The consistent read the revocation check depends on (`getDevice`'s
        // port comment) — resolvable by household + device, null otherwise.
        await repo.putDevice({
          deviceId: "d_1",
          householdId: "h_1",
          playerId: "p_1",
          tokenHash: "hash",
          lastSeen: "2026-07-04T18:00:00.000Z",
        });
        expect(await repo.getDevice("h_1", "d_1")).toMatchObject({ playerId: "p_1" });
        expect(await repo.getDevice("h_1", "d_nope")).toBeNull();
        expect(await repo.getDevice("h_other", "d_1")).toBeNull();
      });

      it("touching a device cannot un-revoke it", async () => {
        /*
         * The bug this pins, found in review: resolve wrote the whole binding
         * back to refresh `lastSeen`, so a resolve racing a revocation could
         * write a pre-revocation copy over the flag — the lost phone erasing
         * its own revocation. `touchDevice` updates `lastSeen` and nothing
         * else, so the race has nothing to lose.
         */
        await repo.putDevice({
          deviceId: "d_1",
          householdId: "h_1",
          playerId: "p_1",
          tokenHash: "hash",
          lastSeen: "2026-07-04T18:00:00.000Z",
        });
        await repo.revokeDevice("h_1", "d_1");
        await repo.touchDevice("h_1", "d_1", "2026-07-05T09:00:00.000Z");

        const binding = await repo.getDevice("h_1", "d_1");
        expect(binding?.revoked).toBe(true);
        expect(binding?.lastSeen).toBe("2026-07-05T09:00:00.000Z");

        // A device that is not there is a no-op, never a throw.
        await repo.touchDevice("h_1", "d_ghost", "2026-07-05T09:00:00.000Z");
      });

      it("maps an account to its households", async () => {
        await repo.putAccountPointer("sub_a", "h_1");
        await repo.putAccountPointer("sub_a", "h_2");
        expect((await repo.listHouseholdsForAccount("sub_a")).sort()).toEqual(["h_1", "h_2"]);
        expect(await repo.listHouseholdsForAccount("sub_b")).toEqual([]);
      });
    });

    describe("multi-owner households (#248)", () => {
      const at = "2026-07-04T18:00:00.000Z";

      it("gives every owner the household, and lists them all", async () => {
        await repo.putHousehold(household({ id: "h_g", ownerSub: "sub_a" }));
        await repo.putAccountPointer("sub_a", "h_g");
        await repo.putOwner({ householdId: "h_g", cognitoSub: "sub_a", email: "a@example.com", addedAt: at });
        await repo.putOwner({ householdId: "h_g", cognitoSub: "sub_b", email: "b@example.com", addedAt: at });

        expect(await repo.listHouseholdsForAccount("sub_a")).toEqual(["h_g"]);
        expect(await repo.listHouseholdsForAccount("sub_b")).toEqual(["h_g"]);
        const owners = await repo.listOwners("h_g");
        expect(owners.map((o) => [o.cognitoSub, o.email]).sort()).toEqual([
          ["sub_a", "a@example.com"],
          ["sub_b", "b@example.com"],
        ]);
        // An owner row is not a player, a device, or anything else in the partition.
        expect(await repo.listPlayers("h_g")).toEqual([]);
        expect(await repo.listDevices("h_g")).toEqual([]);
      });

      it("keeps an owner's own family beside the group", async () => {
        await repo.putAccountPointer("sub_b", "h_family");
        await repo.putOwner({ householdId: "h_g", cognitoSub: "sub_b", addedAt: at });
        expect((await repo.listHouseholdsForAccount("sub_b")).sort()).toEqual(["h_family", "h_g"]);
      });

      it("is idempotent, and a second put refreshes the row", async () => {
        await repo.putOwner({ householdId: "h_g", cognitoSub: "sub_b", addedAt: at });
        await repo.putOwner({ householdId: "h_g", cognitoSub: "sub_b", email: "b@example.com", addedAt: at });
        expect(await repo.listOwners("h_g")).toEqual([
          { householdId: "h_g", cognitoSub: "sub_b", email: "b@example.com", addedAt: at },
        ]);
        expect(await repo.listHouseholdsForAccount("sub_b")).toEqual(["h_g"]);
      });

      it("removes both halves of an owner, and only that owner", async () => {
        await repo.putOwner({ householdId: "h_g", cognitoSub: "sub_a", addedAt: at });
        await repo.putOwner({ householdId: "h_g", cognitoSub: "sub_b", addedAt: at });
        await repo.putAccountPointer("sub_b", "h_family");

        await repo.removeOwner("h_g", "sub_b");
        expect(await repo.listHouseholdsForAccount("sub_b")).toEqual(["h_family"]);
        expect((await repo.listOwners("h_g")).map((o) => o.cognitoSub)).toEqual(["sub_a"]);
        expect(await repo.listHouseholdsForAccount("sub_a")).toEqual(["h_g"]);

        // Somebody who was never an owner: nothing to remove, nothing thrown.
        await repo.removeOwner("h_g", "sub_nobody");
      });
    });

    describe("pairing codes (#281)", () => {
      function pairing(code: string, expiresAt: string) {
        return {
          code,
          householdId: "h_g",
          playerId: "p_ada",
          createdBy: "device:d_ada",
          createdAt: "2026-07-04T18:00:00.000Z",
          expiresAt,
          ttl: Math.floor(Date.parse(expiresAt) / 1000),
        };
      }
      const later = new Date(Date.now() + HOUR).toISOString();

      it("is spent exactly once, and says whom it names", async () => {
        expect(await repo.putPairingCodeIfAbsent(pairing("ABCDEFGH", later))).toBe(true);
        const nowIso = new Date().toISOString();
        expect(await repo.redeemPairingCode("ABCDEFGH", nowIso)).toEqual(pairing("ABCDEFGH", later));
        expect(await repo.redeemPairingCode("ABCDEFGH", nowIso)).toBeNull();
      });

      it("lets exactly one of two simultaneous redeemers have it", async () => {
        await repo.putPairingCodeIfAbsent(pairing("ABCDEFGH", later));
        const nowIso = new Date().toISOString();
        const results = await Promise.all([
          repo.redeemPairingCode("ABCDEFGH", nowIso),
          repo.redeemPairingCode("ABCDEFGH", nowIso),
        ]);
        expect(results.filter((r) => r !== null)).toHaveLength(1);
      });

      it("reads a code in any case", async () => {
        await repo.putPairingCodeIfAbsent(pairing("ABCDEFGH", later));
        expect((await repo.redeemPairingCode("abcdefgh", new Date().toISOString()))?.playerId).toBe("p_ada");
      });

      it("refuses a code that is already taken", async () => {
        expect(await repo.putPairingCodeIfAbsent(pairing("ABCDEFGH", later))).toBe(true);
        expect(await repo.putPairingCodeIfAbsent({ ...pairing("ABCDEFGH", later), playerId: "p_other" })).toBe(false);
        expect((await repo.redeemPairingCode("ABCDEFGH", new Date().toISOString()))?.playerId).toBe("p_ada");
      });

      it("will not spend a code past its expiry, even before it is swept", async () => {
        await repo.putPairingCodeIfAbsent(pairing("ABCDEFGH", new Date(Date.now() + 10 * 60 * 1000).toISOString()));
        const late = new Date(Date.now() + HOUR).toISOString();
        expect(await repo.redeemPairingCode("ABCDEFGH", late)).toBeNull();
      });

      it("knows nothing of a code never issued, and is not an organizer invite", async () => {
        expect(await repo.redeemPairingCode("ZZZZZZZZ", new Date().toISOString())).toBeNull();
        await repo.putOrganizerInviteIfAbsent({
          code: "ABCDEFGH",
          householdId: "h_g",
          createdBy: "sub_a",
          createdAt: "2026-07-04T18:00:00.000Z",
          expiresAt: later,
          ttl: Math.floor(Date.parse(later) / 1000),
        });
        expect(await repo.redeemPairingCode("ABCDEFGH", new Date().toISOString())).toBeNull();
      });
    });

    describe("organizer invites (#248)", () => {
      function invite(code: string, expiresAt: string) {
        return {
          code,
          householdId: "h_g",
          createdBy: "sub_a",
          createdAt: "2026-07-04T18:00:00.000Z",
          expiresAt,
          ttl: Math.floor(Date.parse(expiresAt) / 1000),
        };
      }
      const later = new Date(Date.now() + DAY).toISOString();
      const ben = { cognitoSub: "sub_b", email: "b@example.com", addedAt: "2026-07-04T18:00:00.000Z" };
      // A code names a household that is there (#252): redeeming checks it.
      beforeEach(async () => {
        await repo.putHousehold(household({ id: "h_g", ownerSub: "sub_a" }));
      });
      const eve = { cognitoSub: "sub_e", addedAt: "2026-07-04T18:00:00.000Z" };

      it("is spent exactly once, and makes whoever spends it an owner in the same write", async () => {
        expect(await repo.putOrganizerInviteIfAbsent(invite("ABCDEFGHJK", later))).toBe(true);
        const nowIso = new Date().toISOString();
        expect(await repo.redeemOrganizerInvite("ABCDEFGHJK", nowIso, ben)).toEqual(invite("ABCDEFGHJK", later));
        expect(await repo.listHouseholdsForAccount("sub_b")).toEqual(["h_g"]);
        expect(await repo.listOwners("h_g")).toEqual([{ ...ben, householdId: "h_g" }]);

        expect(await repo.redeemOrganizerInvite("ABCDEFGHJK", nowIso, eve)).toBeNull();
        expect(await repo.listHouseholdsForAccount("sub_e")).toEqual([]);
      });

      it("reads a code in any case", async () => {
        await repo.putOrganizerInviteIfAbsent(invite("ABCDEFGHJK", later));
        expect((await repo.redeemOrganizerInvite("abcdefghjk", new Date().toISOString(), ben))?.householdId).toBe("h_g");
      });

      it("refuses a code that is already taken", async () => {
        expect(await repo.putOrganizerInviteIfAbsent(invite("ABCDEFGHJK", later))).toBe(true);
        expect(await repo.putOrganizerInviteIfAbsent({ ...invite("ABCDEFGHJK", later), householdId: "h_x" })).toBe(false);
        expect((await repo.redeemOrganizerInvite("ABCDEFGHJK", new Date().toISOString(), ben))?.householdId).toBe("h_g");
      });

      it("will not spend an invite past its expiry, even before it is swept, and writes nothing", async () => {
        const expiresAt = new Date(Date.now() + HOUR).toISOString();
        await repo.putOrganizerInviteIfAbsent(invite("ABCDEFGHJK", expiresAt));
        const late = new Date(Date.now() + 2 * HOUR).toISOString();
        expect(await repo.redeemOrganizerInvite("ABCDEFGHJK", late, ben)).toBeNull();
        expect(await repo.listHouseholdsForAccount("sub_b")).toEqual([]);
        expect(await repo.listOwners("h_g")).toEqual([]);
      });

      it("knows nothing of a code never issued", async () => {
        expect(await repo.redeemOrganizerInvite("ZZZZZZZZZZ", new Date().toISOString(), ben)).toBeNull();
      });
    });

    describe("moving a kid to another home (#251)", () => {
      const T = "2026-07-04T18:00:00.000Z";
      const later = () => new Date(Date.now() + DAY).toISOString();
      const nowIso = () => new Date().toISOString();
      const forwardTtl = () => Math.floor((Date.now() + 31 * DAY) / 1000);

      function code(overrides: Partial<{ code: string; householdId: string; playerId: string; expiresAt: string }> = {}) {
        const expiresAt = overrides.expiresAt ?? later();
        return {
          code: "MOVEHERNOW",
          householdId: "h_club",
          playerId: "p_ada",
          createdBy: "sub_leader",
          createdAt: T,
          ttl: Math.floor(Date.parse(expiresAt) / 1000),
          ...overrides,
          expiresAt,
        };
      }

      function hero(id: string, ownerPlayerId: string, level = 1): Character {
        return {
          ...character(id, "h_club"),
          ownerPlayerId,
          committed: { ...character(id).committed, level, xp: level * 300 },
        };
      }

      /** A club with Ada (two heroes, her phone, a dead phone, a find), Bo, and the club tablet. */
      async function club(): Promise<void> {
        await repo.putHousehold(household({ id: "h_club", displayName: "Dragon Club", ownerSub: "sub_leader" }));
        await repo.putHousehold(household({ id: "h_home", displayName: "Ada's house", ownerSub: "sub_mum" }));
        await repo.putPlayer({ ...player("p_ada", "h_club"), displayName: "Ada", retired: true });
        await repo.putPlayer({ ...player("p_bo", "h_club"), displayName: "Bo" });
        await repo.putCharacter(hero("c_spark", "p_ada", 3));
        await repo.putCharacter(hero("c_moth", "p_ada"));
        await repo.putCharacter(hero("c_bo", "p_bo"));
        await repo.putDevice({ deviceId: "d_ada", householdId: "h_club", playerId: "p_ada", tokenHash: "h1", lastSeen: T });
        await repo.putDevice({ deviceId: "d_old", householdId: "h_club", playerId: "p_ada", tokenHash: "h2", lastSeen: T, revoked: true });
        await repo.putDevice({ deviceId: "d_bo", householdId: "h_club", playerId: "p_bo", tokenHash: "h3", lastSeen: T });
        await repo.putDevice({ kind: "shared", deviceId: "d_tab", householdId: "h_club", tokenHash: "h4", lastSeen: T });
        await repo.recordDiscoveries("h_club", [
          { canonId: "moth", playerId: "p_ada", runId: "r_1", foundAt: T },
          { canonId: "newt", playerId: "p_bo", foundAt: T },
        ]);
        await repo.putRun({ id: "r_1", householdId: "h_club", roomCode: "ABCD", campaignId: "gemfall", status: "complete", createdAt: T });
        await repo.putCampaignProgress({ householdId: "h_club", campaignId: "gemfall", status: "active", setbacks: 1, updatedAt: T });
        expect(await repo.putTransferCodeIfAbsent(code())).toBe(true);
      }

      async function move(to: Parameters<GameRepository["moveProfile"]>[0]["to"], at = nowIso()) {
        const read = await repo.readProfileMove("h_club", "p_ada");
        if (!read) throw new Error("Ada is not in the club");
        return repo.moveProfile({ move: read, code: "MOVEHERNOW", nowIso: at, to, forwardTtl: forwardTtl() });
      }

      it("reads what is hers and nothing else", async () => {
        await club();
        const read = await repo.readProfileMove("h_club", "p_ada");
        expect(read?.player.displayName).toBe("Ada");
        expect(read?.characters.map((c) => c.id).sort()).toEqual(["c_moth", "c_spark"]);
        expect(read?.devices.map((d) => d.deviceId).sort()).toEqual(["d_ada", "d_old"]);
        expect(Object.keys(read?.finds ?? {})).toEqual(["moth"]);
        expect(await repo.readProfileMove("h_club", "p_nobody")).toBeNull();
      });

      it("moves her profile, heroes, phone and finds, with every id unchanged, and leaves the table's save", async () => {
        await club();
        await repo.recordDiscoveries("h_home", [{ canonId: "owl", playerId: "p_sis", foundAt: T }]);
        expect(await move({ householdId: "h_home" })).toBe("moved");

        // She lives at home now, back on the pickers.
        const ada = await repo.getPlayer("h_home", "p_ada");
        expect(ada).toMatchObject({ id: "p_ada", householdId: "h_home", displayName: "Ada" });
        expect(ada?.retired).toBeUndefined();
        expect((await repo.getCharacter("h_home", "c_spark"))?.committed.level).toBe(3);
        expect((await repo.getCharacter("h_home", "c_spark"))?.householdId).toBe("h_home");
        expect((await repo.listCharacters("h_home")).map((c) => c.id).sort()).toEqual(["c_moth", "c_spark"]);
        expect(await repo.getDevice("h_home", "d_ada")).toMatchObject({ householdId: "h_home", playerId: "p_ada", tokenHash: "h1" });
        expect(await repo.getDeviceById("d_ada")).toMatchObject({ householdId: "h_home" });
        expect((await repo.getFieldGuide("h_home")).entries).toEqual({
          owl: { firstFoundBy: "p_sis", foundAt: T },
          moth: { firstFoundBy: "p_ada", foundAt: T, runId: "r_1" },
        });

        // Gone from the club: a move, never a copy.
        expect(await repo.getPlayer("h_club", "p_ada")).toBeNull();
        expect(await repo.getCharacter("h_club", "c_spark")).toBeNull();
        expect((await repo.listCharacters("h_club")).map((c) => c.id)).toEqual(["c_bo"]);
        expect(await repo.getDevice("h_club", "d_ada")).toBeNull();
        // Her dead phone is dropped, not carried.
        expect(await repo.getDevice("h_club", "d_old")).toBeNull();
        expect(await repo.getDevice("h_home", "d_old")).toBeNull();
        // Her old token finds her binding by key.
        expect(await repo.getMovedDevice("h_club", "d_ada")).toBe("h_home");
        expect(await repo.getMovedDevice("h_club", "d_bo")).toBeNull();

        // Everybody else, the tablet, the table's book and its save stay.
        expect((await repo.listPlayers("h_club")).map((p) => p.id)).toEqual(["p_bo"]);
        expect((await repo.listDevices("h_club")).map((d) => d.deviceId).sort()).toEqual(["d_bo", "d_tab"]);
        expect(Object.keys((await repo.getFieldGuide("h_club")).entries).sort()).toEqual(["moth", "newt"]);
        expect(await repo.getRun("r_1")).toMatchObject({ householdId: "h_club" });
        expect(await repo.getCampaignProgress("h_club", "gemfall")).toMatchObject({ setbacks: 1 });
        expect(await repo.listCampaignProgress("h_home")).toEqual([]);

        // The code is spent.
        expect(await repo.getTransferCode("MOVEHERNOW", nowIso())).toBeNull();
      });

      it("moves her into a brand-new home owned by whoever redeemed it", async () => {
        await club();
        const home = household({ id: "h_new", displayName: "Ada's household", ownerSub: "sub_dad" });
        const owner = { householdId: "h_new", cognitoSub: "sub_dad", email: "dad@example.com", addedAt: T };
        expect(await move({ household: home, owner })).toBe("moved");

        expect(await repo.getHousehold("h_new")).toEqual(home);
        expect(await repo.listHouseholdsForAccount("sub_dad")).toEqual(["h_new"]);
        expect(await repo.listOwners("h_new")).toEqual([owner]);
        expect((await repo.listCharacters("h_new")).map((c) => c.id).sort()).toEqual(["c_moth", "c_spark"]);
        expect(Object.keys((await repo.getFieldGuide("h_new")).entries)).toEqual(["moth"]);
      });

      it("carries her own record with her hero: her finished campaigns, and the finds she made visiting (#283)", async () => {
        await club();
        const finished = [{ campaignId: "gemfall", outcome: "success" as const, at: T, table: "h_rue" }];
        await repo.putCharacter({ ...hero("c_spark", "p_ada", 3), finished });
        // A find she made at Rue's table, written to her home book, credited to her.
        await repo.recordDiscoveries("h_club", [{ canonId: "lark", playerId: "p_ada", runId: "r_rue", foundAt: T }]);
        expect(await move({ householdId: "h_home" })).toBe("moved");

        expect((await repo.getCharacter("h_home", "c_spark"))?.finished).toEqual(finished);
        expect((await repo.listCharacters("h_home")).find((c) => c.id === "c_spark")?.finished).toEqual(finished);
        expect((await repo.getCharacter("h_home", "c_moth"))).not.toHaveProperty("finished");
        expect((await repo.getFieldGuide("h_home")).entries["lark"]).toEqual({ firstFoundBy: "p_ada", foundAt: T, runId: "r_rue" });
      });

      it("keeps the first finder in her new home's book", async () => {
        await club();
        await repo.recordDiscoveries("h_home", [{ canonId: "moth", playerId: "p_sis", foundAt: "2026-01-01T00:00:00.000Z" }]);
        expect(await move({ householdId: "h_home" })).toBe("moved");
        expect((await repo.getFieldGuide("h_home")).entries["moth"]?.firstFoundBy).toBe("p_sis");
      });

      it("is spent exactly once", async () => {
        await club();
        const read = await repo.readProfileMove("h_club", "p_ada");
        if (!read) throw new Error("no Ada");
        const input = { move: read, code: "MOVEHERNOW", nowIso: nowIso(), forwardTtl: forwardTtl() };
        expect(await repo.moveProfile({ ...input, to: { householdId: "h_home" } })).toBe("moved");
        await repo.putHousehold(household({ id: "h_other", ownerSub: "sub_eve" }));
        expect(await repo.moveProfile({ ...input, to: { householdId: "h_other" } })).toBe("spent");
        expect(await repo.getPlayer("h_other", "p_ada")).toBeNull();
      });

      it("refuses an expired code, or one for somebody else, and moves nothing", async () => {
        await club();
        expect(await move({ householdId: "h_home" }, new Date(Date.now() + 2 * DAY).toISOString())).toBe("spent");
        expect(await repo.getTransferCode("MOVEHERNOW", new Date(Date.now() + 2 * DAY).toISOString())).toBeNull();

        await repo.putTransferCodeIfAbsent(code({ code: "FORBOBONLY", playerId: "p_bo" }));
        const read = await repo.readProfileMove("h_club", "p_ada");
        if (!read) throw new Error("no Ada");
        const outcome = await repo.moveProfile({
          move: read,
          code: "FORBOBONLY",
          nowIso: nowIso(),
          to: { householdId: "h_home" },
          forwardTtl: forwardTtl(),
        });
        expect(outcome).toBe("spent");
        expect(await repo.getPlayer("h_club", "p_ada")).not.toBeNull();
        expect(await repo.listCharacters("h_home")).toEqual([]);
        expect(await repo.getTransferCode("FORBOBONLY", nowIso())).not.toBeNull();
      });

      it("cancels, moving nothing and spending nothing, when a hero changed since the read", async () => {
        await club();
        const read = await repo.readProfileMove("h_club", "p_ada");
        if (!read) throw new Error("no Ada");
        // A level lands between the read and the move.
        await repo.putCharacter(hero("c_spark", "p_ada", 4));
        const input = { code: "MOVEHERNOW", nowIso: nowIso(), to: { householdId: "h_home" }, forwardTtl: forwardTtl() };
        expect(await repo.moveProfile({ ...input, move: read })).toBe("changed");
        expect(await repo.getPlayer("h_home", "p_ada")).toBeNull();
        expect(await repo.listCharacters("h_home")).toEqual([]);
        expect(await repo.getTransferCode("MOVEHERNOW", nowIso())).not.toBeNull();

        // Read again, and the level comes with her.
        const fresh = await repo.readProfileMove("h_club", "p_ada");
        if (!fresh) throw new Error("no Ada");
        expect(await repo.moveProfile({ ...input, move: fresh })).toBe("moved");
        expect((await repo.getCharacter("h_home", "c_spark"))?.committed.level).toBe(4);
      });

      it("cancels when the home she is going to is gone", async () => {
        await club();
        expect(await move({ householdId: "h_nowhere" })).toBe("changed");
        expect(await repo.getPlayer("h_club", "p_ada")).not.toBeNull();
      });

      it("refuses a move bigger than one transaction, and moves nothing", async () => {
        await club();
        for (let i = 0; i < 48; i++) await repo.putCharacter(hero(`c_${String(i).padStart(2, "0")}`, "p_ada"));
        expect(await move({ householdId: "h_home" })).toBe("too-big");
        expect(await repo.getPlayer("h_club", "p_ada")).not.toBeNull();
        expect(await repo.getTransferCode("MOVEHERNOW", nowIso())).not.toBeNull();
      });

      it("can move her again, and back", async () => {
        await club();
        expect(await move({ householdId: "h_home" })).toBe("moved");
        await repo.putTransferCodeIfAbsent(code({ code: "BACKTOCLUB", householdId: "h_home" }));
        const back = await repo.readProfileMove("h_home", "p_ada");
        if (!back) throw new Error("no Ada");
        const input = { nowIso: nowIso(), forwardTtl: forwardTtl() };
        expect(await repo.moveProfile({ ...input, move: back, code: "BACKTOCLUB", to: { householdId: "h_club" } })).toBe("moved");
        expect(await repo.getDevice("h_club", "d_ada")).toMatchObject({ householdId: "h_club" });
        expect(await repo.getMovedDevice("h_home", "d_ada")).toBe("h_club");

        // Out of the club a second time: the forward it left last time is written over.
        await repo.putTransferCodeIfAbsent(code({ code: "SECONDMOVE" }));
        const again = await repo.readProfileMove("h_club", "p_ada");
        if (!again) throw new Error("no Ada");
        expect(await repo.moveProfile({ ...input, move: again, code: "SECONDMOVE", to: { householdId: "h_home" } })).toBe("moved");
        expect(await repo.getMovedDevice("h_club", "d_ada")).toBe("h_home");
      });

      it("will not let a write from a read before the move bring a hero back to her old home", async () => {
        await club();
        const stale = await repo.getCharacter("h_club", "c_spark");
        if (!stale) throw new Error("no hero");
        expect(await move({ householdId: "h_home" })).toBe("moved");
        const late = await repo.writeCharacter({
          character: { ...stale, committed: { ...stale.committed, xp: 9999 } },
          expectedVersion: stale.version ?? 0,
          expectedClaim: stale.provisional?.runId ?? null,
        });
        expect(late).toBe(false);
        expect(await repo.getCharacter("h_club", "c_spark")).toBeNull();
        expect((await repo.getCharacter("h_home", "c_spark"))?.committed.xp).toBe(900);
      });

      it("refuses a transfer code that is already taken, and reads one in any case", async () => {
        expect(await repo.putTransferCodeIfAbsent(code())).toBe(true);
        expect(await repo.putTransferCodeIfAbsent(code({ playerId: "p_bo" }))).toBe(false);
        expect((await repo.getTransferCode("movehernow", nowIso()))?.playerId).toBe("p_ada");
        expect(await repo.getTransferCode("ZZZZZZZZZZ", nowIso())).toBeNull();
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

        expect(await repo.claimHousehold("h_1", "sub_a", "d_1")).toBe(true);

        const claimed = await repo.getHousehold("h_1");
        expect(claimed).toMatchObject({ guest: false, ownerSub: "sub_a" });
        expect(claimed).not.toHaveProperty("expiresAt");
        expect(await repo.listExpiredGuestHouseholds(new Date(now).toISOString())).toEqual([]);
        expect(await repo.listHouseholdsForAccount("sub_a")).toEqual(["h_1"]);
      });

      it("is idempotent for the same account and refuses a different one", async () => {
        await repo.putHousehold(guest("h_1", new Date(Date.now() + DAY).toISOString()));
        expect(await repo.claimHousehold("h_1", "sub_a", "d_1")).toBe(true);
        expect(await repo.claimHousehold("h_1", "sub_a", "d_1")).toBe(true);
        expect(await repo.claimHousehold("h_1", "sub_b", "d_1")).toBe(false);
        expect((await repo.getHousehold("h_1"))?.ownerSub).toBe("sub_a");
      });

      it("slides a guest's expiry forward, and moves its sweep entry with it", async () => {
        const now = Date.now();
        await repo.putHousehold(guest("h_1", new Date(now + DAY).toISOString()));
        const later = new Date(now + 7 * DAY).toISOString();

        expect(await repo.extendGuestHousehold("h_1", later)).toBe("extended");
        expect((await repo.getHousehold("h_1"))?.expiresAt).toBe(later);
        // Not swept at the old time…
        expect(await repo.listExpiredGuestHouseholds(new Date(now + 2 * DAY).toISOString())).toEqual([]);
        expect(await repo.deleteGuestHousehold("h_1", new Date(now + 2 * DAY).toISOString())).toBe(false);
        // …and still swept at the new one.
        const after = new Date(now + 8 * DAY).toISOString();
        expect((await repo.listExpiredGuestHouseholds(after)).map((h) => h.id)).toEqual(["h_1"]);
      });

      it("only ever moves an expiry forward", async () => {
        const now = Date.now();
        const far = new Date(now + 7 * DAY).toISOString();
        await repo.putHousehold(guest("h_1", far));
        expect(await repo.extendGuestHousehold("h_1", new Date(now + DAY).toISOString())).toBe("kept");
        expect((await repo.getHousehold("h_1"))?.expiresAt).toBe(far);
      });

      it("rescues a guest that expired but was not swept yet", async () => {
        // The family came back on day eight, before the sweeper got there.
        const now = Date.now();
        await repo.putHousehold(guest("h_1", new Date(now - DAY).toISOString()));
        expect(await repo.extendGuestHousehold("h_1", new Date(now + 7 * DAY).toISOString())).toBe("extended");
        expect(await repo.deleteGuestHousehold("h_1", new Date(now).toISOString())).toBe(false);
        expect(await repo.getHousehold("h_1")).not.toBeNull();
      });

      it("will not extend a household the sweeper has already started on", async () => {
        // Same interlock as claiming: never resurrect a household mid-delete.
        const now = Date.now();
        await repo.putHousehold(guest("h_1", new Date(now - DAY).toISOString()));
        await repo.deleteGuestHousehold("h_1", new Date(now).toISOString());
        expect(await repo.extendGuestHousehold("h_1", new Date(now + 7 * DAY).toISOString())).toBe("swept");
      });

      it("will not give a claimed household an expiry", async () => {
        await repo.putHousehold(household({ ownerSub: "sub_a" }));
        expect(await repo.extendGuestHousehold("h_1", new Date(Date.now() + DAY).toISOString())).toBe("kept");
        expect(await repo.getHousehold("h_1")).not.toHaveProperty("expiresAt");
      });

      it("reports a household that is gone as swept", async () => {
        expect(await repo.extendGuestHousehold("h_nope", new Date(Date.now() + DAY).toISOString())).toBe("swept");
      });

      it("claims only from the device that started the household (#265)", async () => {
        await repo.putHousehold(guest("h_1", new Date(Date.now() + DAY).toISOString()));
        expect(await repo.claimHousehold("h_1", "sub_a", "d_joiner")).toBe(false);
        expect(await repo.getHousehold("h_1")).toMatchObject({ guest: true, ownerSub: null });

        // A founder taken off (a host removing them) claims nothing after.
        await repo.dropFounder("h_1", "d_other");
        expect((await repo.getHousehold("h_1"))?.founderDeviceId).toBe("d_1");
        await repo.dropFounder("h_1", "d_1");
        expect(await repo.claimHousehold("h_1", "sub_a", "d_1")).toBe(false);
      });

      it("claims a household made before founders from any device, as before (#265)", async () => {
        const { founderDeviceId: _none, ...legacy } = guest("h_1", new Date(Date.now() + DAY).toISOString());
        await repo.putHousehold(legacy);
        expect(await repo.claimHousehold("h_1", "sub_a", "d_anyone")).toBe(true);
      });

      it("will not claim a household still awaiting its founder", async () => {
        const { founderDeviceId: _none, ...open } = guest("h_1", new Date(Date.now() + DAY).toISOString());
        await repo.putHousehold({ ...open, awaitingFounder: true });
        expect(await repo.claimHousehold("h_1", "sub_a", "d_1")).toBe(false);
      });

      it("lets exactly one device found a household awaiting a founder", async () => {
        const { founderDeviceId: _none, ...open } = guest("h_1", new Date(Date.now() + DAY).toISOString());
        await repo.putHousehold({ ...open, awaitingFounder: true });
        const won = await Promise.all([repo.takeFounding("h_1", "d_a"), repo.takeFounding("h_1", "d_b")]);
        expect(won.filter(Boolean)).toHaveLength(1);
        const founded = await repo.getHousehold("h_1");
        expect(founded).not.toHaveProperty("awaitingFounder");
        expect(founded?.founderDeviceId).toBe(won[0] ? "d_a" : "d_b");
        // Never again, once taken.
        expect(await repo.takeFounding("h_1", "d_c")).toBe(false);
        expect(await repo.takeFounding("h_nope", "d_c")).toBe(false);
      });

      it("lets a host hand the founding to another device, once the first is gone (#272)", async () => {
        await repo.putHousehold(guest("h_1", new Date(Date.now() + DAY).toISOString()));
        await repo.dropFounder("h_1", "d_1");
        expect(await repo.setFounder("h_1", "d_family")).toBe(true);
        expect(await repo.claimHousehold("h_1", "sub_a", "d_1")).toBe(false);
        expect(await repo.claimHousehold("h_1", "sub_a", "d_family")).toBe(true);
      });

      it("hands the founding over a founder who is still there, and ends the wait for one (#272)", async () => {
        const { founderDeviceId: _none, ...open } = guest("h_1", new Date(Date.now() + DAY).toISOString());
        await repo.putHousehold({ ...open, awaitingFounder: true });
        expect(await repo.setFounder("h_1", "d_a")).toBe(true);
        expect(await repo.getHousehold("h_1")).toMatchObject({ founderDeviceId: "d_a" });
        expect(await repo.getHousehold("h_1")).not.toHaveProperty("awaitingFounder");
        expect(await repo.setFounder("h_1", "d_b")).toBe(true);
        expect((await repo.getHousehold("h_1"))?.founderDeviceId).toBe("d_b");
      });

      it("will not hand the founding of a kept household, or one that does not exist (#272)", async () => {
        await repo.putHousehold(guest("h_1", new Date(Date.now() + DAY).toISOString()));
        expect(await repo.claimHousehold("h_1", "sub_a", "d_1")).toBe(true);
        expect(await repo.setFounder("h_1", "d_other")).toBe(false);
        expect((await repo.getHousehold("h_1"))?.founderDeviceId).toBe("d_1");
        expect(await repo.setFounder("h_nope", "d_other")).toBe(false);
      });

      it("will not claim a household that does not exist", async () => {
        expect(await repo.claimHousehold("h_nope", "sub_a", "d_1")).toBe(false);
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

        expect(await repo.claimHousehold("h_1", "sub_a", "d_1")).toBe(true);
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

        expect(await repo.claimHousehold("h_1", "sub_a", "d_1")).toBe(false);
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

    describe("deleting and keeping (#252)", () => {
      const at = "2026-07-04T18:00:00.000Z";
      function run(id: string, householdId: string, roomCode = "ABCD") {
        return { id, householdId, roomCode, campaignId: null, status: "active" as const, createdAt: at };
      }

      /** A kept household with one of everything a household can hold. */
      async function fullHousehold(): Promise<void> {
        await repo.putHousehold(household({ ownerSub: "sub_a" }));
        await repo.putOwner({ householdId: "h_1", cognitoSub: "sub_a", addedAt: at });
        await repo.putOwner({ householdId: "h_1", cognitoSub: "sub_b", addedAt: at });
        await repo.putPlayer(player("p_1"));
        await repo.touchPlayer("h_1", "p_1", at, new Date(Date.now() + DAY).toISOString());
        await repo.putDevice({ deviceId: "d_1", householdId: "h_1", playerId: "p_1", tokenHash: "x", lastSeen: at });
        await repo.putDevice({ kind: "shared", deviceId: "d_tab", householdId: "h_1", tokenHash: "y", lastSeen: at });
        await repo.putCharacter(character("c_1"));
        await repo.recordDiscoveries("h_1", [{ canonId: "lore.x", playerId: "p_1" }]);
        await repo.putCampaignProgress({ householdId: "h_1", campaignId: "gemfall", status: "active", setbacks: 0, updatedAt: at });
        await repo.putRun(run("r_1", "h_1"));
        await repo.putState(state("r_1", 0));
        await repo.commit({ runId: "r_1", expectedSeq: 0, state: state("r_1", 1), event: event("r_1", 1) });
        await repo.putChapterProgress({ runId: "r_1", index: 0, chapterId: "ch", status: "complete", xpEarned: 10, updatedAt: at });
        await repo.touchPresence("r_1", "p_1", at, Math.floor(Date.now() / 1000) + 3600);
        await repo.putRoomIfAbsent(room());
        await repo.putVisit("p_1", "h_other", at);
      }

      /** Somebody else's household, which no delete of h_1 may touch. */
      async function neighbour(): Promise<string[]> {
        await repo.putHousehold(household({ id: "h_other", ownerSub: "sub_o" }));
        await repo.putOwner({ householdId: "h_other", cognitoSub: "sub_o", addedAt: at });
        await repo.putPlayer(player("p_o", "h_other"));
        await repo.putCharacter({ ...character("c_o", "h_other"), ownerPlayerId: "p_o" });
        await repo.putRun(run("r_o", "h_other", "WXYZ"));
        await repo.putState(state("r_o", 0));
        await repo.putVisit("p_o", "h_1", at);
        return (await rows(repo)).sort();
      }

      it("deletes a household and every row under it, its runs and its owners' pointers included", async () => {
        const before = await neighbour();
        await fullHousehold();

        expect(await repo.deleteHousehold("h_1")).toBe(true);

        // Nothing is left but the neighbour's rows, exactly as they were.
        expect((await rows(repo)).sort()).toEqual(before);
        expect(await repo.listHouseholdsForAccount("sub_a")).toEqual([]);
        expect(await repo.listHouseholdsForAccount("sub_b")).toEqual([]);
        expect(await repo.listVisits("p_1")).toEqual([]);
        expect(await repo.getRun("r_1")).toBeNull();
        expect(await repo.getDeviceById("d_tab")).toBeNull();
        // A visitor's hero lives at her own home, which is not touched.
        expect(await repo.getCharacter("h_other", "c_o")).not.toBeNull();
        expect(await repo.listVisits("p_o")).toEqual(["h_1"]);
      });

      it("is refused for a household that is not there", async () => {
        expect(await repo.deleteHousehold("h_nope")).toBe(false);
      });

      it("hands out nothing for an organizer code made before the delete", async () => {
        await repo.putHousehold(household({ ownerSub: "sub_a" }));
        const expiresAt = new Date(Date.now() + DAY).toISOString();
        await repo.putOrganizerInviteIfAbsent({
          code: "ABCDEFGHJK",
          householdId: "h_1",
          createdBy: "sub_a",
          createdAt: at,
          expiresAt,
          ttl: Math.floor(Date.parse(expiresAt) / 1000),
        });
        await repo.deleteHousehold("h_1");
        expect(await repo.redeemOrganizerInvite("ABCDEFGHJK", new Date().toISOString(), { cognitoSub: "sub_b", addedAt: at })).toBeNull();
        expect(await repo.listHouseholdsForAccount("sub_b")).toEqual([]);
      });

      it("deletes one kid: her profile, heroes, own phones and visits, and nobody else's", async () => {
        await fullHousehold();
        await repo.putPlayer(player("p_2"));
        await repo.putCharacter({ ...character("c_2"), ownerPlayerId: "p_2" });
        await repo.putDevice({ deviceId: "d_2", householdId: "h_1", playerId: "p_2", tokenHash: "z", lastSeen: at });

        expect(await repo.deleteProfile("h_1", "p_1")).toBe(true);

        expect(await repo.getPlayer("h_1", "p_1")).toBeNull();
        expect((await repo.listPlayers("h_1")).map((p) => p.id)).toEqual(["p_2"]);
        expect(await repo.getCharacter("h_1", "c_1")).toBeNull();
        expect(await repo.getDevice("h_1", "d_1")).toBeNull();
        expect(await repo.listVisits("p_1")).toEqual([]);
        expect(await repo.listIdlePlayers(new Date(Date.now() + 2 * DAY).toISOString())).toEqual([]);
        // Hers only: her sister, the family tablet and the table's save stay.
        expect(await repo.getCharacter("h_1", "c_2")).not.toBeNull();
        expect(await repo.getDevice("h_1", "d_2")).not.toBeNull();
        expect(await repo.getDevice("h_1", "d_tab")).not.toBeNull();
        expect(await repo.getState("r_1")).not.toBeNull();
        expect((await rows(repo)).filter((r) => r.includes("p_1") && !r.startsWith("RUN#"))).toEqual([]);
        expect(await repo.deleteProfile("h_1", "p_1")).toBe(false);
      });

      it("never brings a deleted kid back by renewing her", async () => {
        await repo.putHousehold(household({ ownerSub: "sub_a" }));
        await repo.putPlayer(player("p_1"));
        await repo.touchPlayer("h_1", "p_1", at, null);
        // A gate she does not meet marks nothing.
        expect(await repo.deleteProfile("h_1", "p_1", "2026-01-01T00:00:00.000Z")).toBe(false);
        expect(await repo.getPlayer("h_1", "p_1")).not.toBeNull();

        expect(await repo.deleteProfile("h_1", "p_1")).toBe(true);
        // A join that read her a moment before the delete lands after it.
        await repo.touchPlayer("h_1", "p_1", new Date().toISOString(), new Date(Date.now() + DAY).toISOString());
        expect(await repo.getPlayer("h_1", "p_1")).toBeNull();
        expect(await repo.getLastPlayed("h_1", "p_1")).toBeNull();
        expect(await repo.readProfileMove("h_1", "p_1")).toBeNull();
        expect(await rows(repo)).not.toContain("HH#h_1 PLAYER#p_1");
      });

      it("deletes an idle kid only if she has not played since the cutoff", async () => {
        await repo.putHousehold(household({ ownerSub: "sub_a", retentionDays: 30 }));
        await repo.putPlayer(player("p_1"));
        const now = Date.now();
        const played = new Date(now - 40 * DAY).toISOString();
        await repo.touchPlayer("h_1", "p_1", played, new Date(now - 10 * DAY).toISOString());

        expect(await repo.listIdlePlayers(new Date(now).toISOString())).toEqual([
          { householdId: "h_1", playerId: "p_1", lastPlayedAt: played },
        ]);
        // She came back an hour ago: the gate in the delete itself spares her.
        await repo.touchPlayer("h_1", "p_1", new Date(now - HOUR).toISOString(), new Date(now + 29 * DAY).toISOString());
        expect(await repo.deleteProfile("h_1", "p_1", new Date(now - 30 * DAY).toISOString())).toBe(false);
        expect(await repo.getPlayer("h_1", "p_1")).not.toBeNull();
        expect(await repo.listIdlePlayers(new Date(now).toISOString())).toEqual([]);
        expect(await repo.deleteProfile("h_1", "p_1", new Date(now).toISOString())).toBe(true);
      });

      it("keeps when she last played and her sweep entry through a rename", async () => {
        await repo.putHousehold(household({ ownerSub: "sub_a", retentionDays: 30 }));
        await repo.putPlayer(player("p_1"));
        await repo.touchPlayer("h_1", "p_1", at, "2026-08-03T18:00:00.000Z");
        await repo.putPlayer({ ...player("p_1"), displayName: "Ada" });

        expect(await repo.getLastPlayed("h_1", "p_1")).toBe(at);
        expect(await repo.listIdlePlayers("2026-09-01T00:00:00.000Z")).toHaveLength(1);
        // Out of the sweep when her household keeps everybody.
        await repo.touchPlayer("h_1", "p_1", at, null);
        expect(await repo.listIdlePlayers("2026-09-01T00:00:00.000Z")).toEqual([]);
        expect((await repo.getPlayer("h_1", "p_1"))?.displayName).toBe("Ada");
      });

      it("writes a visit once per table, keyed by the kid", async () => {
        await repo.putVisit("p_1", "h_a", at);
        await repo.putVisit("p_1", "h_a", "2026-07-05T18:00:00.000Z");
        await repo.putVisit("p_1", "h_b", at);
        expect((await repo.listVisits("p_1")).sort()).toEqual(["h_a", "h_b"]);
        expect(await repo.listVisits("p_2")).toEqual([]);
      });

      it("rewrites an event in place, and never adds one", async () => {
        await repo.putRun(run("r_1", "h_1"));
        await repo.putState(state("r_1", 0));
        await repo.commit({ runId: "r_1", expectedSeq: 0, state: state("r_1", 1), event: event("r_1", 1) });

        const scrubbed = { ...event("r_1", 1), patch: [{ op: "replace" as const, path: "/narration", value: "A friend" }] };
        await repo.rewriteEvent(scrubbed);
        await repo.rewriteEvent({ ...event("r_1", 2), patch: [] });

        expect(await repo.listEvents("r_1", 0)).toEqual([scrubbed]);
        expect((await repo.getState("r_1"))?.seq).toBe(1);
      });

      it("re-credits her finds in a book, and nobody else's", async () => {
        await repo.recordDiscoveries("h_1", [
          { canonId: "lore.a", playerId: "p_1", foundAt: at },
          { canonId: "lore.b", playerId: "p_2", foundAt: at },
          { canonId: "lore.c", playerId: "p_1", foundAt: at, runId: "r_1" },
        ]);
        expect(await repo.forgetFinder("h_1", "p_1")).toBe(2);
        expect((await repo.getFieldGuide("h_1")).entries).toEqual({
          "lore.a": { firstFoundBy: FORGOTTEN_FINDER, foundAt: at },
          "lore.b": { firstFoundBy: "p_2", foundAt: at },
          "lore.c": { firstFoundBy: FORGOTTEN_FINDER, foundAt: at, runId: "r_1" },
        });
        expect(await repo.forgetFinder("h_1", "p_1")).toBe(0);
        expect(await repo.forgetFinder("h_none", "p_1")).toBe(0);
      });

      it("never brings a deleted kid back by a change read before the delete", async () => {
        /*
         * The race: an owner's rename reads her, the delete lands, the rename
         * writes. An update that made a row would bring her back as a profile
         * nothing is marked on, and nobody would ever delete her again.
         */
        await repo.putHousehold(household({ ownerSub: "sub_a" }));
        await repo.putPlayer(player("p_1"));
        const read = (await repo.getPlayer("h_1", "p_1"))!;
        expect(await repo.updatePlayer({ ...read, displayName: "Ada" })).toBe(true);

        expect(await repo.deleteProfile("h_1", "p_1")).toBe(true);
        expect(await repo.updatePlayer({ ...read, displayName: "Ada again" })).toBe(false);
        expect(await repo.updatePlayer({ ...read, retired: true })).toBe(false);

        expect(await repo.getPlayer("h_1", "p_1")).toBeNull();
        expect(await rows(repo)).not.toContain("HH#h_1 PLAYER#p_1");
        expect(await repo.updatePlayer(player("p_never"))).toBe(false);
        expect(await repo.getPlayer("h_1", "p_never")).toBeNull();
      });

      it("keeps forget jobs until they are done, oldest first", async () => {
        const job = (playerId: string, createdAt: string) => ({
          playerId,
          home: "h_1",
          reason: "kid" as const,
          nicknames: ["Ada"],
          heroes: ["Sparklehoof"],
          tables: ["h_rue", "h_bo"],
          createdAt,
          attempts: 0,
        });
        await repo.putForget(job("p_2", "2026-07-05T18:00:00.000Z"));
        await repo.putForget(job("p_1", at));
        expect((await repo.listForgets()).map((j) => j.playerId)).toEqual(["p_1", "p_2"]);

        // A scrub that cleaned one table and not the other rewrites it.
        await repo.putForget({ ...job("p_1", at), tables: ["h_bo"], attempts: 1 });
        expect((await repo.listForgets())[0]).toMatchObject({ playerId: "p_1", tables: ["h_bo"], attempts: 1 });

        await repo.deleteForget("p_1");
        await repo.deleteForget("p_2");
        expect(await repo.listForgets()).toEqual([]);
        expect(await rows(repo)).toEqual([]);
      });

      it("takes the kids' visits with a swept guest household", async () => {
        await repo.putHousehold(guest("h_1", new Date(Date.now() - DAY).toISOString()));
        await repo.putPlayer(player("p_1"));
        await repo.putVisit("p_1", "h_other", at);
        expect(await repo.deleteGuestHousehold("h_1", new Date().toISOString())).toBe(true);
        expect(await rows(repo)).toEqual([]);
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

      it("keeps the campaign setback counter under the household", async () => {
        // §8.3 counts across the weeks a campaign takes — runs come and go,
        // the counter has to outlive every one of them.
        expect(await repo.getCampaignProgress("h_1", "hollow-crown")).toBeNull();
        await repo.putCampaignProgress({
          householdId: "h_1",
          campaignId: "hollow-crown",
          status: "active",
          setbacks: 2,
          updatedAt: "2026-07-04T18:00:00.000Z",
        });
        expect(await repo.getCampaignProgress("h_1", "hollow-crown")).toMatchObject({
          status: "active",
          setbacks: 2,
        });
        // Scoped by household — a neighbour's campaign is not this one's.
        expect(await repo.getCampaignProgress("h_other", "hollow-crown")).toBeNull();
      });

      it("lists a household's campaign attempts, and only its own", async () => {
        for (const [householdId, campaignId] of [
          ["h_1", "gemfall"],
          ["h_1", "hollow-crown"],
          ["h_other", "gemfall"],
        ] as const) {
          await repo.putCampaignProgress({
            householdId,
            campaignId,
            status: "active",
            setbacks: 0,
            updatedAt: "2026-07-04T18:00:00.000Z",
          });
        }
        const listed = await repo.listCampaignProgress("h_1");
        expect(listed.map((p) => p.campaignId).sort()).toEqual(["gemfall", "hollow-crown"]);
      });

      it("progress rows ride the commit, and lose with it", async () => {
        /*
         * The setback counter is a read-modify-write: read it, decide the
         * campaign's fate, write it back. The seq gate on the commit is what
         * serializes that against two phones completing the chapter at once —
         * a counter written by a *losing* commit would count the same setback
         * twice, or fail a campaign nobody actually failed.
         */
        await repo.putState(state("r_1", 0));
        const progress = {
          chapterProgress: {
            runId: "r_1",
            index: 1,
            chapterId: "bramblewood-01",
            status: "complete" as const,
            outcome: "setback" as const,
            xpEarned: 150,
            updatedAt: "2026-07-04T18:00:00.000Z",
          },
          campaignProgress: {
            householdId: "h_1",
            campaignId: "hollow-crown",
            status: "active" as const,
            setbacks: 1,
            version: 1,
            updatedAt: "2026-07-04T18:00:00.000Z",
          },
          campaignProgressExpectedVersion: null,
        };

        // A losing commit must leave both rows unwritten.
        expect(
          await repo.commit({
            runId: "r_1",
            expectedSeq: 7,
            state: state("r_1", 8),
            event: event("r_1", 8),
            ...progress,
          }),
        ).toBe(false);
        expect(await repo.listChapterProgress("r_1")).toEqual([]);
        expect(await repo.getCampaignProgress("h_1", "hollow-crown")).toBeNull();

        // The winning commit lands all of it together.
        expect(
          await repo.commit({
            runId: "r_1",
            expectedSeq: 0,
            state: state("r_1", 1),
            event: event("r_1", 1),
            ...progress,
          }),
        ).toBe(true);
        expect((await repo.listChapterProgress("r_1"))[0]).toMatchObject({ outcome: "setback" });
        expect(await repo.getCampaignProgress("h_1", "hollow-crown")).toMatchObject({
          setbacks: 1,
        });
      });

      it("round-trips a graph campaign's journey on the attempt, put or committed (#194)", async () => {
        // The journey is the whole of where a graph party got to, so a store
        // that dropped a key — an empty map, a nested counter, the last exit —
        // would strand the party somewhere it never was.
        const journey: JourneyState = {
          version: 1,
          node: "orchard",
          visit: 2,
          status: "choosing",
          chapter: "sampler-orchard-flooded",
          visits: { waystone: 1, orchard: 2, mill: 1 },
          completions: { waystone: 1, orchard: 2, mill: 1 },
          outcomes: { waystone: "success", orchard: "success", mill: "setback" },
          traversed: { "to-orchard": 1, "orchard-to-mill": 1, "mill-to-orchard": 1 },
          edges: { "orchard-to-tower": "open" },
          flags: { mill_wheel_turning: true },
          chaptersCompleted: ["sampler-waystone", "sampler-orchard", "sampler-mill", "sampler-orchard-flooded"],
          lastExit: { node: "mill", visit: 1, edge: "mill-to-orchard" },
          // Rift lifecycles (#196): a store that dropped one would reopen a
          // used-up rift on the next evening.
          rifts: {
            "to-quarry": { status: "consumed", crossings: 1, revealed: true },
            "twin-a": { status: "open", crossings: 1, age: 2, latched: true },
            "twin-b": { status: "open", crossings: 1, age: 2, latched: true },
          },
        };
        const attempt = {
          householdId: "h_1",
          campaignId: "rift-sampler",
          status: "active" as const,
          setbacks: 1,
          attemptId: "rift-sampler:1:r_1:2026-07-04T18:00:00.000Z",
          journey,
          version: 1,
          updatedAt: "2026-07-04T18:00:00.000Z",
        };
        await repo.putCampaignProgress(attempt);
        expect(await repo.getCampaignProgress("h_1", "rift-sampler")).toEqual(attempt);

        // And through the conditional commit, under the version it was read at.
        await repo.putState(state("r_1", 0));
        const moved = {
          ...attempt,
          journey: { ...journey, node: "tower", visit: 1, status: "playing" as const, chapter: "sampler-tower" },
          version: 2,
        };
        expect(
          await repo.commit({
            runId: "r_1",
            expectedSeq: 0,
            state: state("r_1", 1),
            event: event("r_1", 1),
            campaignProgress: moved,
            campaignProgressExpectedVersion: 1,
          }),
        ).toBe(true);
        expect(await repo.getCampaignProgress("h_1", "rift-sampler")).toEqual(moved);
        expect((await repo.listCampaignProgress("h_1"))[0]?.journey).toEqual(moved.journey);
      });

      it("round-trips a journey's world facts of every type, falsy values included (#198)", async () => {
        // A fact's value is a string, an integer or a boolean — and 0 and false
        // are real values (a counter at its floor, a road closed again), which a
        // store that dropped falsy attributes would turn back into `initial`.
        const journey: JourneyState = {
          version: 1,
          node: "crossroads",
          visit: 2,
          status: "choosing",
          chapter: "ws-crossroads",
          visits: { crossroads: 2, lair: 1 },
          completions: { crossroads: 1, lair: 1 },
          facts: {
            "mill-village": "displaced",
            "ash-wyrm": "raging",
            "river-folk": 0,
            "ford-path": false,
            "scorched-orchard": true,
          },
        };
        const attempt = {
          householdId: "h_1",
          campaignId: "world-state-sampler",
          status: "active" as const,
          setbacks: 1,
          attemptId: "world-state-sampler:1:r_1:2026-07-04T18:00:00.000Z",
          journey,
          version: 1,
          updatedAt: "2026-07-04T18:00:00.000Z",
        };
        await repo.putCampaignProgress(attempt);
        expect(await repo.getCampaignProgress("h_1", "world-state-sampler")).toEqual(attempt);

        await repo.putState(state("r_1", 0));
        const moved = { ...attempt, journey: { ...journey, facts: { ...journey.facts, "river-folk": 3 } }, version: 2 };
        expect(
          await repo.commit({
            runId: "r_1",
            expectedSeq: 0,
            state: state("r_1", 1),
            event: event("r_1", 1),
            campaignProgress: moved,
            campaignProgressExpectedVersion: 1,
          }),
        ).toBe(true);
        expect((await repo.getCampaignProgress("h_1", "world-state-sampler"))?.journey?.facts).toEqual(moved.journey.facts);
      });

      it("an attempt without a journey reads back without one — the ordered reading", async () => {
        await repo.putCampaignProgress({
          householdId: "h_1",
          campaignId: "gemfall",
          status: "active",
          setbacks: 0,
          lastIndex: 3,
          routeFlags: { road_rush: true },
          version: 4,
          updatedAt: "2026-07-04T18:00:00.000Z",
        });
        const read = await repo.getCampaignProgress("h_1", "gemfall");
        expect(read).not.toHaveProperty("journey");
        expect(read).toMatchObject({ lastIndex: 3, routeFlags: { road_rush: true } });
      });

      it("serializes one campaign attempt across different runs", async () => {
        await repo.putState(state("r_1", 0));
        await repo.putState(state("r_2", 0));
        await repo.putCampaignProgress({
          householdId: "h_1",
          campaignId: "hollow-crown",
          status: "active",
          setbacks: 0,
          version: 1,
          updatedAt: "2026-07-04T18:00:00.000Z",
        });

        const advance = (runId: string, setbacks: number) =>
          repo.commit({
            runId,
            expectedSeq: 0,
            state: state(runId, 1),
            event: event(runId, 1),
            campaignProgress: {
              householdId: "h_1",
              campaignId: "hollow-crown",
              status: "active",
              setbacks,
              version: 2,
              updatedAt: `2026-07-04T18:00:0${setbacks}.000Z`,
            },
            campaignProgressExpectedVersion: 1,
          });

        const results = await Promise.all([advance("r_1", 1), advance("r_2", 2)]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(await repo.getCampaignProgress("h_1", "hollow-crown")).toMatchObject({
          version: 2,
        });
        const advancedRuns = [await repo.getState("r_1"), await repo.getState("r_2")].filter(
          (candidate) => candidate?.seq === 1,
        );
        expect(advancedRuns).toHaveLength(1);
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
            characters: [{ character: hero, expectedVersion: null, expectedClaim: null }],
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
            characters: [{ character: loser, expectedVersion: null, expectedClaim: null }],
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

    describe("the hero's claim (#282)", () => {
      /*
       * One game at a time per hero (architecture §4.5): her claim is
       * `provisional.runId`, next to a monotonic `version` on her row, and
       * every write from a run rides its commit conditioned on both as read.
       * These are the races that rule exists for, run against both stores.
       */
      const claimedBy = (hero: Character, claim: string | null): Character => ({
        ...hero,
        provisional: claim === null ? null : { ...hero.committed, runId: claim },
      });
      /** One run's turn: its seq gate plus the hero writes it owes. */
      const turn = async (runId: string, seq: number, characters: CharacterWrite[]) =>
        repo.commit({ runId, expectedSeq: seq - 1, state: state(runId, seq), event: event(runId, seq), characters });
      const read = async () => (await repo.getCharacter("h_1", "c_1"))!;
      /** The write a run makes after reading her as she now stands. */
      const from = (as: Character, next: Character): CharacterWrite => ({
        character: next,
        expectedVersion: as.version ?? 0,
        expectedClaim: as.provisional?.runId ?? null,
      });

      beforeEach(async () => {
        await repo.putState(state("r_a", 0));
        await repo.putState(state("r_b", 0));
        // As written before the claim: no version, which is version 0.
        await repo.putCharacter(character("c_1"));
      });

      it("reads a row from before the claim as version 0 with no claim", async () => {
        const hero = await read();
        expect(hero.version ?? 0).toBe(0);
        expect(hero.provisional ?? null).toBeNull();
      });

      it("two runs racing for one hero: exactly one wins, and the loser writes nothing", async () => {
        const seenByA = await read();
        const seenByB = await read();

        expect(await turn("r_a", 1, [from(seenByA, claimedBy(seenByA, "gemfall"))])).toBe(true);
        expect(await turn("r_b", 1, [from(seenByB, claimedBy(seenByB, "riftlight@h_2"))])).toBe(false);

        const hero = await read();
        expect(hero.provisional?.runId).toBe("gemfall");
        expect(hero.version).toBe(1);
        // The loser's whole turn failed with it, as a lost seq race does.
        expect((await repo.getState("r_b"))?.seq).toBe(0);
        expect(await repo.listEvents("r_b", 0)).toEqual([]);
      });

      it("refuses a stale write after the claim moved, from the old version or the current one", async () => {
        const free = await read();
        expect(await turn("r_a", 1, [from(free, claimedBy(free, "gemfall"))])).toBe(true);
        const held = await read();
        // Gemfall finished elsewhere; another table reclaims her.
        expect(await turn("r_b", 1, [from(held, claimedBy(held, "riftlight@h_2"))])).toBe(true);

        // A worker still holding Gemfall's read tries to bank a level.
        const gains = { ...claimedBy(held, "gemfall"), provisional: { ...held.provisional!, xp: 300 } };
        expect(await turn("r_a", 2, [from(held, gains)])).toBe(false);
        // Even at the row's current version, the claim alone refuses it.
        expect(
          await turn("r_a", 2, [{ character: gains, expectedVersion: 2, expectedClaim: "gemfall" }]),
        ).toBe(false);
        // And outside a run, the same.
        expect(await repo.writeCharacter(from(held, gains))).toBe(false);

        const hero = await read();
        expect(hero.provisional).toMatchObject({ runId: "riftlight@h_2", xp: 0 });
        expect(hero.version).toBe(2);
        expect((await repo.getState("r_a"))?.seq).toBe(1);
      });

      it("an acquire retried after it landed fails on the old read and lands on a new one", async () => {
        const free = await read();
        const acquire = from(free, claimedBy(free, "gemfall"));
        expect(await turn("r_a", 1, [acquire])).toBe(true);

        // The response was lost and the same acquire is sent again: it fails
        // cleanly, leaving the row as the first one left it.
        expect(await turn("r_a", 2, [acquire])).toBe(false);
        expect(await repo.writeCharacter(acquire)).toBe(false);
        expect((await read()).version).toBe(1);

        // Re-read: she already names this run, so the retry holds her and lands.
        const mine = await read();
        expect(await turn("r_a", 2, [from(mine, claimedBy(mine, "gemfall"))])).toBe(true);
        const hero = await read();
        expect(hero.provisional?.runId).toBe("gemfall");
        expect(hero.version).toBe(2);
      });

      it("reclaims from a terminal run on its old claim and version, and only once", async () => {
        const free = await read();
        expect(await turn("r_a", 1, [from(free, claimedBy(free, "gemfall"))])).toBe(true);
        // Gemfall's attempt is over and she was not there to settle: two
        // tables both read her, stale claim and all, and both reclaim.
        const seenByB = await read();
        const seenByC = await read();
        expect(await turn("r_b", 1, [from(seenByB, claimedBy(seenByB, "riftlight@h_2"))])).toBe(true);
        await repo.putState(state("r_c", 0));
        expect(await turn("r_c", 1, [from(seenByC, claimedBy(seenByC, "riftlight@h_3"))])).toBe(false);

        expect((await read()).provisional?.runId).toBe("riftlight@h_2");
      });

      it("releases a claim only for the run that holds it", async () => {
        const free = await read();
        expect(await turn("r_a", 1, [from(free, claimedBy(free, "gemfall"))])).toBe(true);
        const held = await read();

        // Leaving an adventure she is not in changes nothing.
        expect(
          await repo.writeCharacter({ character: claimedBy(held, null), expectedVersion: 1, expectedClaim: "riftlight" }),
        ).toBe(false);
        expect(await repo.writeCharacter(from(held, claimedBy(held, null)))).toBe(true);

        const hero = await read();
        expect(hero.provisional ?? null).toBeNull();
        expect(hero.version).toBe(2);
      });

      it("creates a new hero only where none exists", async () => {
        const fresh = { ...character("c_2"), name: "Pip" };
        const create: CharacterWrite = { character: fresh, expectedVersion: null, expectedClaim: null };
        expect(await turn("r_a", 1, [create])).toBe(true);
        expect((await repo.getCharacter("h_1", "c_2"))?.version).toBe(1);
        // A re-sent create cannot flatten the hero it already made.
        expect(await turn("r_a", 2, [create])).toBe(false);
        expect(await repo.writeCharacter(create)).toBe(false);
      });
    });

    describe("a hero's own record (#283)", () => {
      /*
       * Her finished campaigns live on her row, at her home, and are written
       * by the run's commit beside the release of her claim, whichever table
       * that run is at. These pin that the record round-trips every path a
       * hero row takes through both stores.
       */
      const line = (campaignId: string, table: string) => ({
        campaignId,
        outcome: "success" as const,
        at: "2026-07-04T18:00:00.000Z",
        table,
      });
      const turn = async (runId: string, seq: number, characters: CharacterWrite[]) =>
        repo.commit({ runId, expectedSeq: seq - 1, state: state(runId, seq), event: event(runId, seq), characters });

      it("reads back a hero with no record without one", async () => {
        await repo.putCharacter(character("c_1"));
        expect(await repo.getCharacter("h_1", "c_1")).not.toHaveProperty("finished");
        expect((await repo.listCharacters("h_1"))[0]).not.toHaveProperty("finished");
      });

      it("round-trips the record through put, get and list", async () => {
        const finished = [line("gemfall", "h_rue"), line("riftlight", "h_1")];
        await repo.putCharacter({ ...character("c_1"), finished });
        expect((await repo.getCharacter("h_1", "c_1"))?.finished).toEqual(finished);
        expect((await repo.listCharacters("h_1"))[0]?.finished).toEqual(finished);
      });

      it("is written by a visiting table's commit, at her home, as it releases her claim", async () => {
        // Her home is h_home; the table is h_rue's run, which holds her claim.
        await repo.putState(state("r_rue", 0));
        await repo.putCharacter({
          ...character("c_1", "h_home"),
          provisional: { ...character("c_1").committed, level: 2, runId: "gemfall@h_rue" },
        });
        const read = (await repo.getCharacter("h_home", "c_1"))!;
        const settled: Character = {
          ...read,
          committed: { ...read.committed, level: 2 },
          provisional: null,
          finished: [line("gemfall", "h_rue")],
        };
        const write: CharacterWrite = { character: settled, expectedVersion: read.version ?? 0, expectedClaim: "gemfall@h_rue" };
        expect(await turn("r_rue", 1, [write])).toBe(true);

        const hero = await repo.getCharacter("h_home", "c_1");
        expect(hero?.finished).toEqual([line("gemfall", "h_rue")]);
        expect(hero?.provisional ?? null).toBeNull();
        expect(hero?.committed.level).toBe(2);
        // A retry of the same settlement, on the read it already used, writes nothing twice.
        expect(await turn("r_rue", 2, [write])).toBe(false);
        expect((await repo.getCharacter("h_home", "c_1"))?.finished).toHaveLength(1);
      });

      it("is not written when the settling commit loses its seq race", async () => {
        await repo.putState(state("r_rue", 0));
        await repo.putCharacter(character("c_1", "h_home"));
        const read = (await repo.getCharacter("h_home", "c_1"))!;
        const write: CharacterWrite = {
          character: { ...read, finished: [line("gemfall", "h_rue")] },
          expectedVersion: read.version ?? 0,
          expectedClaim: null,
        };
        expect(await turn("r_rue", 2, [write])).toBe(false);
        expect(await repo.getCharacter("h_home", "c_1")).not.toHaveProperty("finished");
      });

      it("rides writeCharacter too, conditioned like any other hero write", async () => {
        await repo.putCharacter(character("c_1"));
        const read = (await repo.getCharacter("h_1", "c_1"))!;
        const next = { ...read, finished: [line("gemfall", "h_1")] };
        expect(await repo.writeCharacter({ character: next, expectedVersion: read.version ?? 0, expectedClaim: null })).toBe(true);
        expect((await repo.getCharacter("h_1", "c_1"))?.finished).toEqual([line("gemfall", "h_1")]);
        // A write from the old read is refused and cannot drop it.
        const stale = { ...read, finished: [] };
        expect(await repo.writeCharacter({ character: stale, expectedVersion: read.version ?? 0, expectedClaim: null })).toBe(false);
        expect((await repo.getCharacter("h_1", "c_1"))?.finished).toHaveLength(1);
      });

      it("keeps her own finds in her home book beside the table's, each first-finder-wins", async () => {
        // The table's book and hers both get her find; a later find by
        // somebody else at the table is the table's alone.
        await repo.recordDiscoveries("h_rue", [{ canonId: "lark", playerId: "p_ada", runId: "r_rue" }]);
        await repo.recordDiscoveries("h_home", [{ canonId: "lark", playerId: "p_ada", runId: "r_rue" }]);
        await repo.recordDiscoveries("h_rue", [{ canonId: "newt", playerId: "p_rue", runId: "r_rue" }]);
        expect((await repo.getFieldGuide("h_home")).entries["lark"]?.firstFoundBy).toBe("p_ada");
        expect((await repo.getFieldGuide("h_rue")).entries["lark"]?.firstFoundBy).toBe("p_ada");
        expect(Object.keys((await repo.getFieldGuide("h_home")).entries)).toEqual(["lark"]);
      });
    });

    describe("field guide", () => {
      const T1 = "2026-07-04T18:00:00.000Z";
      const T2 = "2026-07-05T18:00:00.000Z";

      it("reads as an empty book before anything is found", async () => {
        expect(await repo.getFieldGuide("h_1")).toEqual({ v: FIELD_GUIDE_VERSION, entries: {} });
      });

      it("creates the record on first discovery and reports what was added", async () => {
        const added = await repo.recordDiscoveries("h_1", [
          { canonId: "moth", playerId: "p_1", runId: "r_1", foundAt: T1 },
        ]);
        expect(added).toEqual(["moth"]);
        expect(await repo.getFieldGuide("h_1")).toEqual({
          v: FIELD_GUIDE_VERSION,
          entries: { moth: { firstFoundBy: "p_1", foundAt: T1, runId: "r_1" } },
        });
      });

      it("adds more later without disturbing what is there", async () => {
        await repo.recordDiscoveries("h_1", [{ canonId: "moth", playerId: "p_1", foundAt: T1 }]);
        const added = await repo.recordDiscoveries("h_1", [
          { canonId: "newt", playerId: "p_2", foundAt: T2 },
          { canonId: "owl", playerId: "p_2", runId: "r_2", foundAt: T2 },
        ]);
        expect(added).toEqual(["newt", "owl"]);
        const book = await repo.getFieldGuide("h_1");
        expect(Object.keys(book.entries).sort()).toEqual(["moth", "newt", "owl"]);
        expect(book.entries["moth"]).toEqual({ firstFoundBy: "p_1", foundAt: T1 });
        expect(book.entries["owl"]).toEqual({ firstFoundBy: "p_2", foundAt: T2, runId: "r_2" });
      });

      it("is idempotent and keeps the first finder", async () => {
        await repo.recordDiscoveries("h_1", [{ canonId: "moth", playerId: "p_1", runId: "r_1", foundAt: T1 }]);
        const again = await repo.recordDiscoveries("h_1", [
          { canonId: "moth", playerId: "p_2", runId: "r_2", foundAt: T2 },
        ]);
        expect(again).toEqual([]);
        expect((await repo.getFieldGuide("h_1")).entries["moth"]).toEqual({
          firstFoundBy: "p_1",
          foundAt: T1,
          runId: "r_1",
        });
      });

      it("reports only the genuinely new ids from a mixed batch", async () => {
        await repo.recordDiscoveries("h_1", [{ canonId: "moth", playerId: "p_1", foundAt: T1 }]);
        const added = await repo.recordDiscoveries("h_1", [
          { canonId: "moth", playerId: "p_2", foundAt: T2 },
          { canonId: "newt", playerId: "p_2", foundAt: T2 },
          // A repeat inside one call: first occurrence wins, reported once.
          { canonId: "newt", playerId: "p_3", foundAt: T2 },
        ]);
        expect(added).toEqual(["newt"]);
        expect((await repo.getFieldGuide("h_1")).entries["newt"]?.firstFoundBy).toBe("p_2");
      });

      it("survives concurrent writers: every id lands once, first finder wins", async () => {
        const results = await Promise.all([
          repo.recordDiscoveries("h_1", [
            { canonId: "a", playerId: "p_1", foundAt: T1 },
            { canonId: "b", playerId: "p_1", foundAt: T1 },
          ]),
          repo.recordDiscoveries("h_1", [
            { canonId: "b", playerId: "p_2", foundAt: T2 },
            { canonId: "c", playerId: "p_2", foundAt: T2 },
          ]),
        ]);
        // "b" is reported by exactly one writer.
        expect(results.flat().sort()).toEqual(["a", "b", "c"]);
        const book = await repo.getFieldGuide("h_1");
        expect(Object.keys(book.entries).sort()).toEqual(["a", "b", "c"]);
        const bWinner = results[0]?.includes("b") ? "p_1" : "p_2";
        expect(book.entries["b"]?.firstFoundBy).toBe(bWinner);
      });

      it("is scoped to the household", async () => {
        await repo.recordDiscoveries("h_1", [{ canonId: "moth", playerId: "p_1", foundAt: T1 }]);
        expect((await repo.getFieldGuide("h_other")).entries).toEqual({});
      });

      it("goes with a swept guest household", async () => {
        const now = Date.now();
        await repo.putHousehold(guest("h_1", new Date(now - DAY).toISOString()));
        await repo.recordDiscoveries("h_1", [{ canonId: "moth", playerId: "p_1", foundAt: T1 }]);

        expect(await repo.deleteGuestHousehold("h_1", new Date(now).toISOString())).toBe(true);
        expect((await repo.getFieldGuide("h_1")).entries).toEqual({});
      });

      it("is kept when a guest household is claimed instead", async () => {
        const now = Date.now();
        await repo.putHousehold(guest("h_1", new Date(now - DAY).toISOString()));
        await repo.recordDiscoveries("h_1", [{ canonId: "moth", playerId: "p_1", foundAt: T1 }]);
        expect(await repo.claimHousehold("h_1", "sub_a", "d_1")).toBe(true);
        expect(await repo.deleteGuestHousehold("h_1", new Date(now).toISOString())).toBe(false);
        expect(Object.keys((await repo.getFieldGuide("h_1")).entries)).toEqual(["moth"]);
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

      const run = {
        id: "r_1",
        householdId: "h_tv",
        roomCode: "ABCD",
        campaignId: null,
        status: "active" as const,
        createdAt: "2026-07-04T18:00:00.000Z",
      };

      it("moves a claimed room, and its run, to the claiming household", async () => {
        await repo.putRun(run);
        await repo.putRoomIfAbsent(room({ householdId: "h_tv", claimable: true }));

        expect(await repo.claimRoom({ code: "ABCD", run, householdId: "h_1" })).toBe(true);
        const claimed = await repo.getRoom("ABCD");
        expect(claimed?.householdId).toBe("h_1");
        expect(claimed?.claimable).toBeUndefined();
        expect(await repo.getRun("r_1")).toMatchObject({ householdId: "h_1" });
        expect((await repo.listRuns("h_1")).map((r) => r.id)).toEqual(["r_1"]);
        expect(await repo.listRuns("h_tv")).toEqual([]);
      });

      it("settles a claimable room exactly once", async () => {
        await repo.putRun(run);
        await repo.putRoomIfAbsent(room({ householdId: "h_tv", claimable: true }));

        expect(await repo.claimRoom({ code: "ABCD", run, householdId: "h_tv" })).toBe(true);
        // Settled on the TV's own household: the run stays where it was.
        expect((await repo.listRuns("h_tv")).map((r) => r.id)).toEqual(["r_1"]);
        // And nobody can take it after that.
        expect(await repo.claimRoom({ code: "ABCD", run, householdId: "h_1" })).toBe(false);
        expect((await repo.getRoom("ABCD"))?.householdId).toBe("h_tv");
      });

      it("never claims a room that was not opened claimable", async () => {
        await repo.putRun({ ...run, householdId: "h_1" });
        await repo.putRoomIfAbsent(room());
        expect(
          await repo.claimRoom({ code: "ABCD", run: { ...run, householdId: "h_1" }, householdId: "h_2" }),
        ).toBe(false);
        expect((await repo.getRoom("ABCD"))?.householdId).toBe("h_1");
      });
    });

    describe("room-code lookups", () => {
      const later = () => Math.floor((Date.now() + HOUR) / 1000);
      const LIMIT = 5;

      it("admits a client up to the limit in one window, then refuses it", async () => {
        for (let i = 0; i < LIMIT; i++) {
          expect(await repo.reserveCodeLookup("192.0.2.1", 7, LIMIT, later()), `lookup ${i}`).toBe(true);
        }
        expect(await repo.reserveCodeLookup("192.0.2.1", 7, LIMIT, later())).toBe(false);
      });

      it("keeps clients and windows apart", async () => {
        for (let i = 0; i < LIMIT; i++) await repo.reserveCodeLookup("192.0.2.1", 7, LIMIT, later());
        expect(await repo.reserveCodeLookup("192.0.2.2", 7, LIMIT, later())).toBe(true);
        expect(await repo.reserveCodeLookup("192.0.2.1", 8, LIMIT, later())).toBe(true);
      });

      it("admits a burst of parallel lookups exactly up to the limit", async () => {
        // A guesser fires in parallel. A read before the write let every one
        // of them see "under the limit"; one conditional write does not.
        const admitted = await Promise.all(
          Array.from({ length: LIMIT * 3 }, () => repo.reserveCodeLookup("192.0.2.1", 7, LIMIT, later())),
        );
        expect(admitted.filter(Boolean)).toHaveLength(LIMIT);
      });

      it("gives a lookup back, and never below zero", async () => {
        for (let i = 0; i < LIMIT; i++) await repo.reserveCodeLookup("192.0.2.1", 7, LIMIT, later());
        await repo.refundCodeLookup("192.0.2.1", 7);
        expect(await repo.reserveCodeLookup("192.0.2.1", 7, LIMIT, later())).toBe(true);
        expect(await repo.reserveCodeLookup("192.0.2.1", 7, LIMIT, later())).toBe(false);

        // A refund on a window nobody used does nothing, and leaves no credit behind.
        await repo.refundCodeLookup("192.0.2.9", 7);
        await repo.refundCodeLookup("192.0.2.9", 7);
        for (let i = 0; i < LIMIT; i++) await repo.reserveCodeLookup("192.0.2.9", 7, LIMIT, later());
        expect(await repo.reserveCodeLookup("192.0.2.9", 7, LIMIT, later())).toBe(false);
      });

      it("starts a window over the moment its ttl passes, not when the sweep runs", async () => {
        const past = Math.floor((Date.now() - HOUR) / 1000);
        for (let i = 0; i < LIMIT; i++) await repo.reserveCodeLookup("192.0.2.1", 7, LIMIT, past);
        expect(await repo.reserveCodeLookup("192.0.2.1", 7, LIMIT, later())).toBe(true);
      });
    });

    describe("presence beats (#258)", () => {
      const later = () => Math.floor((Date.now() + HOUR) / 1000);

      it("keeps every phone's last word, and hands the whole map back", async () => {
        expect(await repo.touchPresence("r_1", "p_1", "2026-10-18T12:00:00.000Z", later())).toEqual({
          p_1: "2026-10-18T12:00:00.000Z",
        });
        await repo.touchPresence("r_1", "p_2", "2026-10-18T12:00:05.000Z", later());
        expect(await repo.touchPresence("r_1", "p_1", "2026-10-18T12:00:20.000Z", later())).toEqual({
          p_1: "2026-10-18T12:00:20.000Z",
          p_2: "2026-10-18T12:00:05.000Z",
        });
        // Runs are kept apart.
        expect(await repo.touchPresence("r_2", "p_1", "2026-10-18T12:00:30.000Z", later())).toEqual({
          p_1: "2026-10-18T12:00:30.000Z",
        });
      });

      it("loses nobody's beat when every phone's first one lands at once", async () => {
        const ids = ["p_1", "p_2", "p_3", "p_4"];
        await Promise.all(ids.map((id) => repo.touchPresence("r_9", id, "2026-10-18T12:00:00.000Z", later())));
        const beats = await repo.touchPresence("r_9", "p_1", "2026-10-18T12:00:01.000Z", later());
        expect(Object.keys(beats).sort()).toEqual(ids);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Implementations under test
// ---------------------------------------------------------------------------

contract("MemoryRepository", async () => new MemoryRepository(), async (repo) =>
  // The store's own rows; reading them is the point of the check.
  [...(repo as unknown as { items: Map<string, { PK: string; SK: string }> }).items.values()].map((i) => `${i.PK} ${i.SK}`),
);

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

  /**
   * A fresh table per test: DynamoDB has no truncate, and a suite that leaks
   * rows between cases fails in an order-dependent way that is miserable to
   * read. Creation is milliseconds against the local jar.
   */
  async function freshTable(): Promise<string> {
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
    return tableName;
  }

  contract(
    "DynamoRepository",
    async () => new DynamoRepository({ tableName: await freshTable(), client }),
    async (repo) => {
      const tableName = (repo as unknown as { table: string }).table;
      const out: string[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const page = await client.send(new ScanCommand({ TableName: tableName, ...(start ? { ExclusiveStartKey: start as never } : {}) }));
        for (const item of page.Items ?? []) out.push(`${item.PK?.S ?? ""} ${item.SK?.S ?? ""}`);
        start = page.LastEvaluatedKey;
      } while (start);
      return out;
    },
  );

  describe("DynamoRepository — an invite redemption that fails part-way (#248)", () => {
    it("spends nothing: the code still works, and nobody was made an owner", async () => {
      const tableName = await freshTable();
      // Its own client, so the fault below reaches no other test.
      const faulty = new DynamoDBClient({
        endpoint,
        region: process.env.AWS_REGION ?? "us-east-1",
        credentials: { accessKeyId: "local", secretAccessKey: "local" },
      });
      let failing = true;
      // The membership write fails on its way to the table: a throttle, a
      // dropped connection, a Lambda that times out.
      faulty.middlewareStack.add(
        (next, context) => async (args) => {
          if (failing && context.commandName === "TransactWriteItemsCommand") {
            throw Object.assign(new Error("throttled"), { name: "ThrottlingException" });
          }
          return next(args);
        },
        { step: "initialize", name: "injectTransactFault" },
      );
      const repo = new DynamoRepository({ tableName, client: faulty });
      await repo.putHousehold(household({ id: "h_g", ownerSub: "sub_a" }));
      const expiresAt = new Date(Date.now() + DAY).toISOString();
      await repo.putOrganizerInviteIfAbsent({
        code: "ABCDEFGHJK",
        householdId: "h_g",
        createdBy: "sub_a",
        createdAt: new Date().toISOString(),
        expiresAt,
        ttl: Math.floor(Date.parse(expiresAt) / 1000),
      });
      const ben = { cognitoSub: "sub_b", addedAt: new Date().toISOString() };

      try {
        await expect(repo.redeemOrganizerInvite("ABCDEFGHJK", new Date().toISOString(), ben)).rejects.toThrow("throttled");
      } finally {
        failing = false;
      }

      expect(await repo.listHouseholdsForAccount("sub_b")).toEqual([]);
      expect(await repo.listOwners("h_g")).toEqual([]);
      // The same grown-up tries again, and it works.
      expect((await repo.redeemOrganizerInvite("ABCDEFGHJK", new Date().toISOString(), ben))?.householdId).toBe("h_g");
      expect(await repo.listHouseholdsForAccount("sub_b")).toEqual(["h_g"]);
      faulty.destroy();
    });
  });
}
