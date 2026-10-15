import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { CHARACTER_VERSION, type Character, type RunState } from "@kad/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DynamoRepository } from "./dynamo-repository.ts";

function character(): Character {
  return {
    id: "c_1",
    householdId: "h_1",
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    committed: {
      level: 4,
      xp: 700,
      stats: { might: 2, quick: 3, clever: 2, heart: 4 },
      tier: "sworn",
      unlockedActions: ["songkeeper-signature", "rallying-chorus"],
      inventory: [{ itemId: "lucky-charm", kind: "trinket" }],
      unspentPoints: 2,
    },
    provisional: {
      runId: "r_1",
      level: 5,
      xp: 1200,
      stats: { might: 3, quick: 3, clever: 2, heart: 4 },
      tier: "sworn",
      unlockedActions: ["songkeeper-signature", "rallying-chorus", "heroic-verse"],
      inventory: [{ itemId: "lucky-charm", kind: "trinket" }],
      unspentPoints: 1,
    },
    questItems: ["moon-key"],
    souvenirs: [{ id: "bramble-pin", fromRun: "r_0", earnedAt: "2026-07-01T00:00:00.000Z" }],
    createdAt: "2026-07-04T18:00:00.000Z",
  };
}
function state(seq: number): RunState {
  return {
    runId: "r_1",
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

describe("DynamoRepository character persistence", () => {
  const client = new DynamoDBClient({
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    vi.spyOn(DynamoDBDocumentClient, "from").mockReturnValue({ send } as unknown as DynamoDBDocumentClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("puts the complete progression snapshot with the current schema version", async () => {
    send.mockResolvedValueOnce({});
    const repo = new DynamoRepository({ tableName: "kad-test", client });
    const hero = character();

    await repo.putCharacter(hero);

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input.Item).toMatchObject({
      PK: "HH#h_1",
      SK: "CHAR#c_1",
      entity: "character",
      v: CHARACTER_VERSION,
      data: hero,
    });
  });
  it("migrates an unstamped character row on read without losing progression", async () => {
    const legacy = structuredClone(character());
    delete legacy.committed.unspentPoints;
    delete legacy.provisional!.unspentPoints;
    send.mockResolvedValueOnce({ Item: { data: legacy } });
    const repo = new DynamoRepository({ tableName: "kad-test", client });

    const loaded = await repo.getCharacter("h_1", "c_1");

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetCommand);
    expect(loaded?.committed.unspentPoints).toBe(0);
    expect(loaded?.provisional?.unspentPoints).toBe(0);
    expect(loaded?.provisional?.unlockedActions).toEqual(legacy.provisional?.unlockedActions);
  });

  it("includes versioned full character writes in the run transaction", async () => {
    send.mockResolvedValueOnce({});
    const repo = new DynamoRepository({ tableName: "kad-test", client });
    const hero = character();

    await expect(
      repo.commit({
        runId: "r_1",
        expectedSeq: 0,
        state: state(1),
        event: {
          runId: "r_1",
          seq: 1,
          patch: [{ op: "replace", path: "/seq", value: 1 }],
          at: "2026-07-04T18:00:00.000Z",
        },
        characters: [hero],
      }),
    ).resolves.toBe(true);

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    expect(command.input.TransactItems).toHaveLength(3);
    expect(command.input.TransactItems?.[2]?.Put?.Item).toMatchObject({
      PK: "HH#h_1",
      SK: "CHAR#c_1",
      entity: "character",
      v: CHARACTER_VERSION,
      data: hero,
    });
  });
});

describe("DynamoRepository field guide writes", () => {
  const client = new DynamoDBClient({
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    vi.spyOn(DynamoDBDocumentClient, "from").mockReturnValue({ send } as unknown as DynamoDBDocumentClient);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const found = (canonId: string, playerId = "p_1") => ({ canonId, playerId, foundAt: "2026-07-04T18:00:00.000Z" });

  it("writes each key with if_not_exists in a single update when the map exists", async () => {
    send.mockResolvedValueOnce({ Attributes: { data: { entries: { moth: {} } } } });
    const repo = new DynamoRepository({ tableName: "kad-test", client });

    const added = await repo.recordDiscoveries("h_1", [found("moth"), found("newt"), found("newt", "p_2")]);

    expect(added).toEqual(["newt"]);
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(UpdateCommand);
    expect(command.input.Key).toEqual({ PK: "HH#h_1", SK: "FIELDGUIDE" });
    expect(command.input.ReturnValues).toBe("ALL_OLD");
    expect(command.input.UpdateExpression).toBe(
      "SET #d.#e.#k0 = if_not_exists(#d.#e.#k0, :e0), #d.#e.#k1 = if_not_exists(#d.#e.#k1, :e1)",
    );
    expect(command.input.ExpressionAttributeValues[":e1"]).toMatchObject({ firstFoundBy: "p_1" });
  });

  it("creates the empty map once, then retries, when the record does not exist yet", async () => {
    send
      .mockRejectedValueOnce(Object.assign(new Error("invalid document path"), { name: "ValidationException" }))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const repo = new DynamoRepository({ tableName: "kad-test", client });

    const added = await repo.recordDiscoveries("h_1", [found("moth")]);

    expect(added).toEqual(["moth"]);
    expect(send).toHaveBeenCalledTimes(3);
    const bootstrap = send.mock.calls[1]?.[0];
    expect(bootstrap.input.UpdateExpression).toContain("if_not_exists(#d, :empty)");
    expect(bootstrap.input.ExpressionAttributeValues[":empty"]).toEqual({ entries: {} });
  });

  it("does not swallow other failures", async () => {
    send.mockRejectedValueOnce(Object.assign(new Error("throttled"), { name: "ProvisionedThroughputExceededException" }));
    const repo = new DynamoRepository({ tableName: "kad-test", client });
    await expect(repo.recordDiscoveries("h_1", [found("moth")])).rejects.toThrow("throttled");
  });

  it("makes no call for an empty batch", async () => {
    const repo = new DynamoRepository({ tableName: "kad-test", client });
    expect(await repo.recordDiscoveries("h_1", [])).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("DynamoRepository graph journeys (#194)", () => {
  const client = new DynamoDBClient({
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    vi.spyOn(DynamoDBDocumentClient, "from").mockReturnValue({ send } as unknown as DynamoDBDocumentClient);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const attempt = {
    householdId: "h_1",
    campaignId: "rift-sampler",
    status: "active" as const,
    setbacks: 0,
    attemptId: "attempt-1",
    journey: {
      version: 1 as const,
      node: "orchard",
      visit: 1,
      status: "playing" as const,
      chapter: "sampler-orchard",
      visits: { waystone: 1, orchard: 1 },
      completions: { waystone: 1 },
      traversed: { "to-orchard": 1 },
      lastExit: { node: "waystone", visit: 1, edge: "to-orchard" },
    },
    version: 3,
    updatedAt: "2026-07-04T18:00:00.000Z",
  };

  it("writes the journey whole inside the attempt's versioned conditional put", async () => {
    send.mockResolvedValueOnce({});
    const repo = new DynamoRepository({ tableName: "kad-test", client });
    await repo.commit({
      runId: "r_1",
      expectedSeq: 0,
      state: state(1),
      event: { runId: "r_1", seq: 1, patch: [], at: "2026-07-04T18:00:00.000Z" },
      campaignProgress: attempt,
      campaignProgressExpectedVersion: 2,
    });
    const put = send.mock.calls[0]?.[0].input.TransactItems?.[2]?.Put;
    expect(put.Item).toMatchObject({ PK: "HH#h_1", SK: "CAMPAIGN#rift-sampler", data: attempt });
    expect(put.ConditionExpression).toBe("#d.#version = :expectedVersion");
    expect(put.ExpressionAttributeValues).toEqual({ ":expectedVersion": 2 });
  });

  it("reads the journey back as it was stored", async () => {
    send.mockResolvedValueOnce({ Item: { data: structuredClone(attempt) } });
    const repo = new DynamoRepository({ tableName: "kad-test", client });
    expect(await repo.getCampaignProgress("h_1", "rift-sampler")).toEqual(attempt);
  });
});
