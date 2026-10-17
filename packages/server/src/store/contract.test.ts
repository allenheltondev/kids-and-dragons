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

import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FIELD_GUIDE_VERSION } from "@kad/shared";
import type { Character, Household, JourneyState, PlayerProfile, RunState } from "@kad/shared";
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
        expect(await repo.claimHousehold("h_1", "sub_a")).toBe(true);
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
