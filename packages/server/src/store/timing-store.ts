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
 * Beside them, an operator's exclusions (`PK = OPS#exclusions`, `SK =
 * <sittingId>`): sittings that are not a family's evening to count, written by
 * the MCP server's `timing_exclude` (docs/mcp-server.md). They expire with the
 * marks, and the MCP function's role may write only under `OPS#`.
 *
 * Not in the game's commit. The mark is written after the step lands, so a
 * failed write loses a mark rather than failing a turn: a missing step folds
 * two scenes together, a missing start drops the sitting, a missing end reads
 * as abandoned. `recordTiming` retries and logs.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { TimingExclusion, TimingMark } from "@kad/shared";
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

/** What an operator reads and decides about the marks (the MCP tools, the export). */
export interface TimingReader extends Pick<TimingStore, "chapterMarks" | "allMarks"> {
  exclusions(): Promise<TimingExclusion[]>;
  /** Idempotent: excluding again replaces the reason. */
  exclude(exclusion: TimingExclusion): Promise<void>;
  /** True when there was one to remove. */
  include(sittingId: string): Promise<boolean>;
}

export const EXCLUSIONS_PK = "OPS#exclusions";

export const timingPk = (chapterId: string): string => `CH#${chapterId}`;
export const timingSk = (runId: string, seq: number): string => `${runId}#${String(seq).padStart(9, "0")}`;

const bySeq = (a: TimingMark, b: TimingMark): number => a.seq - b.seq;

export class MemoryTimingStore implements TimingStore, TimingReader {
  private readonly rows = new Map<string, TimingMark>();
  private readonly excluded = new Map<string, TimingExclusion>();

  async exclusions(): Promise<TimingExclusion[]> {
    return [...this.excluded.values()].map((e) => structuredClone(e));
  }

  async exclude(exclusion: TimingExclusion): Promise<void> {
    this.excluded.set(exclusion.sittingId, structuredClone(exclusion));
  }

  async include(sittingId: string): Promise<boolean> {
    return this.excluded.delete(sittingId);
  }

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

interface ExclusionRow {
  PK: typeof EXCLUSIONS_PK;
  SK: string;
  ttl: number;
  exclusion: TimingExclusion;
}

export interface DynamoTimingStoreOptions {
  tableName: string;
  client?: DynamoDBClient;
  now?: () => number;
}

export class DynamoTimingStore implements TimingStore, TimingReader {
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
      // An exclusion row has no mark: the projection gives it back empty.
      out.push(...((page.Items ?? []) as Array<Partial<Pick<Row, "mark">>>).flatMap((r) => (r.mark ? [r.mark] : [])));
      key = page.LastEvaluatedKey;
    } while (key);
    return out;
  }

  async exclusions(): Promise<TimingExclusion[]> {
    const out: TimingExclusion[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const page = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": EXCLUSIONS_PK },
          ...(key ? { ExclusiveStartKey: key } : {}),
        }),
      );
      out.push(...((page.Items ?? []) as ExclusionRow[]).map((r) => r.exclusion));
      key = page.LastEvaluatedKey;
    } while (key);
    return out;
  }

  async exclude(exclusion: TimingExclusion): Promise<void> {
    const item: ExclusionRow = {
      PK: EXCLUSIONS_PK,
      SK: exclusion.sittingId,
      ttl: Math.floor(this.now() / 1000) + TIMING_RETENTION_DAYS * 86_400,
      exclusion,
    };
    await this.doc.send(new PutCommand({ TableName: this.table, Item: item }));
  }

  async include(sittingId: string): Promise<boolean> {
    const out = await this.doc.send(
      new DeleteCommand({ TableName: this.table, Key: { PK: EXCLUSIONS_PK, SK: sittingId }, ReturnValues: "ALL_OLD" }),
    );
    return Boolean(out.Attributes);
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
