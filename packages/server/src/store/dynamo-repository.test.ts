import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
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
