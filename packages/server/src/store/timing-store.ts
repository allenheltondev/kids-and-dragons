/**
 * Where session timing lives (#511): a table of its own, not the game's.
 *
 * Telemetry for operators has no business sharing a table with a family's
 * heroes: it has its own retention (a TTL), its own IAM (an operator can read
 * this and nothing else), and it must never compete with play for capacity.
 * It holds no household id, player id or name: a mark is a random run id, a
 * chapter, a seq, a server time and a `TimingNote`.
 *
 * Rows: `PK = CH#<chapterId>`, `SK = <runId>#<seq>` (zero-padded, so a run's
 * marks sort in order). A put is idempotent: the same run and seq is the same
 * row, so a retry writes the same thing twice and counts once.
 *
 * Not in the game's commit. The mark is written after the step lands, so a
 * failed write loses a mark rather than failing a turn: a missing step folds
 * two scenes together, a missing start drops the sitting, a missing end reads
 * as abandoned. `recordTiming` retries and logs.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { TimingMark } from "@kad/shared";
import { CLIENT_CONFIG } from "./dynamo-repository.ts";

/** How long a mark is kept, in days. */
export const TIMING_RETENTION_DAYS = 180;

export interface TimingStore {
  /** Idempotent: the same run and seq is the same row. */
  put(mark: TimingMark): Promise<void>;
  /** One run's marks in one chapter, in seq order. */
  runMarks(chapterId: string, runId: string): Promise<TimingMark[]>;
  /** A chapter's marks, every revision, every run. */
  chapterMarks(chapterId: string): Promise<TimingMark[]>;
  /** Everything kept. For an operator's export. */
  allMarks(): Promise<TimingMark[]>;
}

export const timingPk = (chapterId: string): string => `CH#${chapterId}`;
export const timingSk = (runId: string, seq: number): string => `${runId}#${String(seq).padStart(9, "0")}`;

const bySeq = (a: TimingMark, b: TimingMark): number => a.seq - b.seq;

export class MemoryTimingStore implements TimingStore {
  private readonly rows = new Map<string, TimingMark>();

  async put(mark: TimingMark): Promise<void> {
    this.rows.set(`${timingPk(mark.chapterId)}|${timingSk(mark.runId, mark.seq)}`, structuredClone(mark));
  }

  async runMarks(chapterId: string, runId: string): Promise<TimingMark[]> {
    return (await this.chapterMarks(chapterId)).filter((m) => m.runId === runId).sort(bySeq);
  }

  async chapterMarks(chapterId: string): Promise<TimingMark[]> {
    return (await this.allMarks()).filter((m) => m.chapterId === chapterId);
  }

  async allMarks(): Promise<TimingMark[]> {
    return [...this.rows.values()].map((m) => structuredClone(m));
  }
}

interface Row {
  PK: string;
  SK: string;
  ttl?: number;
  mark: TimingMark;
}

export interface DynamoTimingStoreOptions {
  tableName: string;
  client?: DynamoDBClient;
  now?: () => number;
}

export class DynamoTimingStore implements TimingStore {
  private readonly doc: DynamoDBDocumentClient;
  private readonly table: string;
  private readonly now: () => number;

  constructor(options: DynamoTimingStoreOptions) {
    this.table = options.tableName;
    this.now = options.now ?? Date.now;
    this.doc = DynamoDBDocumentClient.from(options.client ?? new DynamoDBClient(CLIENT_CONFIG), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async put(mark: TimingMark): Promise<void> {
    const item: Row = {
      PK: timingPk(mark.chapterId),
      SK: timingSk(mark.runId, mark.seq),
      ttl: Math.floor(this.now() / 1000) + TIMING_RETENTION_DAYS * 86_400,
      mark,
    };
    await this.doc.send(new PutCommand({ TableName: this.table, Item: item }));
  }

  async runMarks(chapterId: string, runId: string): Promise<TimingMark[]> {
    return this.query(chapterId, `${runId}#`);
  }

  async chapterMarks(chapterId: string): Promise<TimingMark[]> {
    return this.query(chapterId);
  }

  async allMarks(): Promise<TimingMark[]> {
    const out: TimingMark[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const page = await this.doc.send(
        new ScanCommand({ TableName: this.table, ProjectionExpression: "#m",
          ExpressionAttributeNames: { "#m": "mark" }, ...(key ? { ExclusiveStartKey: key } : {}) }),
      );
      out.push(...((page.Items ?? []) as Array<Pick<Row, "mark">>).map((r) => r.mark));
      key = page.LastEvaluatedKey;
    } while (key);
    return out;
  }

  private async query(chapterId: string, prefix?: string): Promise<TimingMark[]> {
    const out: TimingMark[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const page = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: prefix ? "PK = :pk AND begins_with(SK, :sk)" : "PK = :pk",
          ExpressionAttributeValues: { ":pk": timingPk(chapterId), ...(prefix ? { ":sk": prefix } : {}) },
          ProjectionExpression: "#m",
          ExpressionAttributeNames: { "#m": "mark" },
          ...(key ? { ExclusiveStartKey: key } : {}),
        }),
      );
      out.push(...((page.Items ?? []) as Array<Pick<Row, "mark">>).map((r) => r.mark));
      key = page.LastEvaluatedKey;
    } while (key);
    return out.sort(bySeq);
  }
}
