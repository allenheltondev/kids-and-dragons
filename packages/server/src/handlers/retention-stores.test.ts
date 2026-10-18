/**
 * A visit, then a delete, on both stores (#252): once Ada is deleted, nothing
 * Rue's household keeps (its rows, its runs' rows, their event logs) says
 * her name or her hero's. Read off the raw rows, not through the handlers,
 * so a copy nobody thought to read is a copy this still finds.
 *
 * Against `MemoryRepository` always, and `DynamoRepository` whenever
 * `KAD_DDB_ENDPOINT` points at DynamoDB Local, as the contract suite is.
 */

import path from "node:path";
import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { applyIntent, createRunState, makeRng, type ClientIntent } from "@kad/shared";
import { afterAll, describe, expect, it } from "vitest";
import { loadContent } from "../content/loader.ts";
import { DevIdentity } from "../identity.ts";
import type { Engine } from "../engine/port.ts";
import { DynamoRepository, GSI1_NAME } from "../store/dynamo-repository.ts";
import type { MemoryRepository } from "../store/memory-repository.ts";
import type { GameRepository } from "../store/repository.ts";
import { makeHarness, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { sweep } from "../lambda/sweep.ts";
import { deleteHousehold, deleteProfile } from "./organizer.ts";
import { createRoom, joinRoom } from "./room.ts";
import { setVisitors } from "./visitors.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));
const realEngine: Engine = { applyIntent, createRunState };

interface Row {
  PK: string;
  SK: string;
  [key: string]: unknown;
}

type Store = { repo: GameRepository; rows: () => Promise<Row[]> };

function suite(name: string, open: (now: () => number) => Promise<Store>): void {
  describe(`a visit, then a delete — ${name}`, () => {
    async function table() {
      const h = makeHarness({ engine: realEngine, playtest: true, content });
      h.deps.rng = (key) => makeRng(`retention-stores:${String(key).split(":").pop()}`);
      const backing = await open(h.clock.now);
      // A store that can be made to fail the event-log rewrite, the way a
      // throttle or a dying Lambda would part-way through a scrub.
      const fault = { on: false };
      const repo = new Proxy(backing.repo, {
        get(target, key, receiver) {
          if (key === "rewriteEvent" && fault.on) return () => Promise.reject(new Error("throttled"));
          const value: unknown = Reflect.get(target, key, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const store = { ...backing, repo };
      // The same harness on this store: every handler reads and writes it.
      const identity = new DevIdentity(store.repo, h.clock.now);
      h.deps.repo = store.repo;
      h.deps.identity = identity;
      const harness: TestHarness = { ...h, repo: store.repo as MemoryRepository, identity };
      const ada = await home(harness, "h_ada", "Ada");
      const rue = await home(harness, "h_rue", "Rue");

      const room = await createRoom(
        { householdId: "h_rue", mode: "travel", hostDeviceId: rue.deviceId, campaignId: "gemfall" },
        harness.deps,
      );
      if (!room.ok) throw new Error("room");
      const { code, runId } = room.value;
      if (!(await joinRoom({ code, principal: rue }, harness.deps)).ok) throw new Error("host join");
      const opened = await setVisitors({ cognitoSub: "sub_h_rue", code, open: true }, harness.deps);
      if (!opened.ok) throw new Error("open");
      const joined = await joinRoom({ code, principal: ada, visitorCode: opened.value.visitorCode }, harness.deps);
      if (!joined.ok) throw new Error("visitor join");
      for (const [who, hero] of [[rue, "Thistledown"], [ada, "Sparklehoof"]] as const) {
        const seq = (await store.repo.getState(runId))!.seq;
        const intent: ClientIntent = {
          type: "CREATE_CHARACTER",
          name: hero,
          species: "unicorn",
          class: "thornguard",
          stats: { might: 1, quick: 1, clever: 0, heart: 1 },
        };
        expect(await applyAction({ runId, playerId: who.playerId, seq, intent, principal: who }, harness.deps)).toMatchObject({
          ok: true,
        });
      }
      await store.repo.recordDiscoveries("h_rue", [{ canonId: "lore.first", playerId: ada.playerId }]);

      /** Every row Rue's household keeps: its partition and its runs'. */
      const rues = async () => {
        const runs = (await store.repo.listRuns("h_rue")).map((r) => `RUN#${r.id}`);
        return (await store.rows()).filter((row) => row.PK === "HH#h_rue" || runs.includes(row.PK));
      };
      return { harness, ada, rue, runId, rues, fault, repo };
    }

    it("deleting her leaves her names nowhere in the household she visited", async () => {
      const { harness, ada, rues } = await table();
      const before = JSON.stringify(await rues());
      expect(before).toContain("Sparklehoof");
      expect(before).toContain('"Ada"');
      expect(before).toContain(ada.playerId);

      const done = await deleteProfile({ cognitoSub: "sub_h_ada", householdId: "h_ada", playerId: ada.playerId }, harness.deps);
      expect(done.ok && done.value.cleanupPending).toBeUndefined();
      expect(await harness.deps.repo.listForgets()).toEqual([]);

      const after = JSON.stringify(await rues());
      expect(after).not.toContain("Sparklehoof");
      expect(after).not.toContain('"Ada"');
      expect(after).toContain("Thistledown");
      // Nothing of hers is left at home either.
      expect((await harness.deps.repo.listCharacters("h_ada")).map((c) => c.name)).toEqual([]);
    });

    it("a scrub that fails part-way is finished by the sweep", async () => {
      const { harness, ada, rues, fault, repo } = await table();
      fault.on = true;
      const done = await deleteProfile({ cognitoSub: "sub_h_ada", householdId: "h_ada", playerId: ada.playerId }, harness.deps);
      // Her own rows are gone; Rue's event log still names her, and the job
      // says so, though her visits went with her. The answer says it is pending.
      expect(done.ok && done.value.cleanupPending).toBe(true);
      expect(await repo.getPlayer("h_ada", ada.playerId)).toBeNull();
      expect(await repo.listVisits(ada.playerId)).toEqual([]);
      expect(JSON.stringify(await rues())).toContain("Sparklehoof");
      expect(await repo.listForgets()).toMatchObject([{ playerId: ada.playerId, tables: ["h_rue"], attempts: 1 }]);

      // Still failing: the sweep keeps it owed rather than dropping it.
      expect((await sweep(repo, () => harness.clock.now())).forgets.owed).toEqual([ada.playerId]);
      expect(await repo.listForgets()).toMatchObject([{ attempts: 2 }]);

      fault.on = false;
      expect((await sweep(repo, () => harness.clock.now())).forgets.finished).toEqual([ada.playerId]);
      expect(await repo.listForgets()).toEqual([]);
      expect(JSON.stringify(await rues())).not.toContain("Sparklehoof");
      expect(JSON.stringify(await rues())).not.toContain('"Ada"');
    });

    it("a delete that died after writing its job is finished by the sweep", async () => {
      const { harness, ada, rues, repo } = await table();
      // The owner's delete wrote its job and nothing else.
      await repo.putForget({
        playerId: ada.playerId,
        home: "h_ada",
        reason: "kid",
        nicknames: ["Ada"],
        heroes: ["Sparklehoof"],
        tables: ["h_ada", "h_rue"],
        createdAt: new Date(harness.clock.now()).toISOString(),
        attempts: 0,
      });

      expect((await sweep(repo, () => harness.clock.now())).forgets.finished).toEqual([ada.playerId]);
      expect(await repo.getPlayer("h_ada", ada.playerId)).toBeNull();
      expect(await repo.listCharacters("h_ada")).toEqual([]);
      expect(JSON.stringify(await rues())).not.toContain("Sparklehoof");
    });

    it("a job for a kid who was never deleted forgets nothing", async () => {
      const { harness, ada, rues, repo } = await table();
      // A guest sweep that wrote its job and then found the household kept.
      await repo.putForget({
        playerId: ada.playerId,
        home: "h_ada",
        reason: "guest",
        nicknames: ["Ada"],
        heroes: ["Sparklehoof"],
        tables: ["h_rue"],
        createdAt: new Date(harness.clock.now()).toISOString(),
        attempts: 0,
      });

      expect((await sweep(repo, () => harness.clock.now())).forgets.dropped).toEqual([ada.playerId]);
      expect(await repo.listForgets()).toEqual([]);
      expect(await repo.getPlayer("h_ada", ada.playerId)).not.toBeNull();
      expect(JSON.stringify(await rues())).toContain("Sparklehoof");
    });

    it("deleting her household does the same", async () => {
      const { harness, rues } = await table();
      const done = await deleteHousehold({ cognitoSub: "sub_h_ada", householdId: "h_ada" }, harness.deps);
      expect(done.ok).toBe(true);
      const after = JSON.stringify(await rues());
      expect(after).not.toContain("Sparklehoof");
      expect(after).not.toContain('"Ada"');
    });
  });
}

/** A kept home with one kid on her own phone, owned by `sub_<id>`. */
async function home(h: TestHarness, id: string, name: string) {
  await h.deps.repo.putHousehold({ id, displayName: id, ownerSub: `sub_${id}`, guest: false, createdAt: new Date(h.clock.now()).toISOString() });
  await h.deps.repo.putAccountPointer(`sub_${id}`, id);
  const playerId = `p_${id}`;
  await h.deps.repo.putPlayer({ id: playerId, householdId: id, displayName: name, color: "#E8A33D" });
  const { deviceId } = await h.identity.issueDeviceToken({ householdId: id, playerId });
  return { deviceId, householdId: id, playerId };
}

suite("MemoryRepository", async (now) => {
  const { MemoryRepository } = await import("../store/memory-repository.ts");
  const repo = new MemoryRepository({ now });
  // The store's own rows; reading them is the point of the check.
  const items = (repo as unknown as { items: Map<string, Row> }).items;
  return { repo, rows: async () => [...items.values()] };
});

const endpoint = process.env.KAD_DDB_ENDPOINT;
if (endpoint) {
  const client = new DynamoDBClient({
    endpoint,
    region: process.env.AWS_REGION ?? "us-east-1",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  const doc = DynamoDBDocumentClient.from(client);
  let n = 0;
  afterAll(() => client.destroy());

  suite("DynamoRepository", async (now) => {
    const tableName = `kad-forget-${process.pid}-${n++}`;
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: ["PK", "SK", "GSI1PK", "GSI1SK"].map((AttributeName) => ({ AttributeName, AttributeType: "S" })),
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
    const repo = new DynamoRepository({ tableName, client, now });
    const rows = async () => {
      const out: Row[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const page = await doc.send(new ScanCommand({ TableName: tableName, ...(start ? { ExclusiveStartKey: start } : {}) }));
        out.push(...((page.Items ?? []) as Row[]));
        start = page.LastEvaluatedKey;
      } while (start);
      return out;
    };
    return { repo, rows };
  });
} else {
  describe.skip("a visit, then a delete — DynamoRepository (set KAD_DDB_ENDPOINT)", () => {
    it("is skipped", () => undefined);
  });
}
