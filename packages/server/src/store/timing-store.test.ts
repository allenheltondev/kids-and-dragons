import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { TimingMark } from "@kad/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DynamoTimingStore, MemoryTimingStore, TIMING_RETENTION_DAYS, timingPk, timingSk } from "./timing-store.ts";

const mark = (runId: string, seq: number, chapterId = "c1"): TimingMark => ({
  runId,
  chapterId,
  seq,
  at: "2026-10-27T18:00:00.000Z",
  timing: { kind: "pause" },
});

describe("MemoryTimingStore", () => {
  it("keeps a put idempotent and returns a run's marks in seq order", async () => {
    const store = new MemoryTimingStore();
    await store.put(mark("A", 3));
    await store.put(mark("A", 1));
    await store.put(mark("A", 3));
    await store.put(mark("B", 2));
    await store.put(mark("A", 9, "c2"));
    expect((await store.runMarks("c1", "A")).map((m) => m.seq)).toEqual([1, 3]);
    expect((await store.chapterMarks("c1")).map((m) => `${m.runId}${String(m.seq)}`).sort()).toEqual(["A1", "A3", "B2"]);
    expect(await store.allMarks()).toHaveLength(4);
  });
});

describe("DynamoTimingStore", () => {
  const send = vi.fn();
  const client = {} as DynamoDBClient;
  beforeEach(() => {
    send.mockReset();
    vi.spyOn(DynamoDBDocumentClient, "from").mockReturnValue({ send } as unknown as DynamoDBDocumentClient);
  });
  afterEach(() => vi.restoreAllMocks());

  it("writes a row per mark keyed by chapter and run+seq, expiring", async () => {
    send.mockResolvedValueOnce({});
    const store = new DynamoTimingStore({ tableName: "kad-timing-test", client, now: () => 1_000_000_000_000 });
    await store.put(mark("run1", 7));
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input).toMatchObject({
      TableName: "kad-timing-test",
      Item: { PK: timingPk("c1"), SK: timingSk("run1", 7), ttl: 1_000_000_000 + TIMING_RETENTION_DAYS * 86_400, mark: mark("run1", 7) },
    });
    expect(timingSk("run1", 7)).toBe("run1#000000007");
  });

  it("queries a chapter, or one run in it, and follows pages in seq order", async () => {
    send
      .mockResolvedValueOnce({ Items: [{ mark: mark("A", 5) }], LastEvaluatedKey: { PK: "x" } })
      .mockResolvedValueOnce({ Items: [{ mark: mark("A", 2) }] });
    const store = new DynamoTimingStore({ tableName: "t", client });
    expect((await store.runMarks("c1", "A")).map((m) => m.seq)).toEqual([2, 5]);
    const first = send.mock.calls[0]?.[0];
    expect(first).toBeInstanceOf(QueryCommand);
    expect(first.input).toMatchObject({
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": "CH#c1", ":sk": "A#" },
    });
    expect(send.mock.calls[1]?.[0].input.ExclusiveStartKey).toEqual({ PK: "x" });
  });

  it("scans everything for an operator's export, page by page", async () => {
    send.mockResolvedValueOnce({ Items: [{ mark: mark("A", 1) }], LastEvaluatedKey: { PK: "y" } }).mockResolvedValueOnce({ Items: [{ mark: mark("B", 1) }] });
    const store = new DynamoTimingStore({ tableName: "t", client });
    expect((await store.allMarks()).map((m) => m.runId)).toEqual(["A", "B"]);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ScanCommand);
  });
});
