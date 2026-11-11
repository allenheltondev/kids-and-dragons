/**
 * The MCP keys' table, `kad-mcp-keys-<stage>` (infra/template.yaml).
 *
 * Its own table rather than rows in the game's, for the same reason session
 * timing has one: the MCP function's IAM names this table and the asset store,
 * and nothing that holds a family's data. One item per key, `PK = KEY#<id>`.
 * A handful of keys at most, so listing them is a Scan.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { KeyRecord, KeyStore } from "./keys.ts";

interface Send {
  send(command: unknown): Promise<unknown>;
}

const pk = (id: string): string => `KEY#${id}`;

function fromItem(item: Record<string, unknown>): KeyRecord {
  return {
    id: String(item.id),
    label: String(item.label),
    scopes: (item.scopes as KeyRecord["scopes"]) ?? [],
    secretHash: String(item.secretHash),
    createdAt: String(item.createdAt),
    expiresAt: String(item.expiresAt),
    lastUsedAt: (item.lastUsedAt as string | null) ?? null,
  };
}

function isConditionFailure(error: unknown): boolean {
  return (error as { name?: string }).name === "ConditionalCheckFailedException";
}

export class DynamoKeyStore implements KeyStore {
  private readonly doc: Send;
  private readonly table: string;
  constructor(table: string, doc?: Send) {
    this.table = table;
    this.doc = doc ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async get(id: string): Promise<KeyRecord | null> {
    const out = (await this.doc.send(new GetCommand({ TableName: this.table, Key: { PK: pk(id) }, ConsistentRead: true }))) as {
      Item?: Record<string, unknown>;
    };
    return out.Item ? fromItem(out.Item) : null;
  }

  async create(record: KeyRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { PK: pk(record.id), ...record },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
  }

  async list(): Promise<KeyRecord[]> {
    const rows: KeyRecord[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const out = (await this.doc.send(new ScanCommand({ TableName: this.table, ExclusiveStartKey: start }))) as {
        Items?: Record<string, unknown>[];
        LastEvaluatedKey?: Record<string, unknown>;
      };
      rows.push(...(out.Items ?? []).map(fromItem));
      start = out.LastEvaluatedKey;
    } while (start);
    return rows;
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { PK: pk(id) }, ConditionExpression: "attribute_exists(PK)" }));
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  async touch(id: string, at: string): Promise<void> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: pk(id) },
          UpdateExpression: "SET lastUsedAt = :at",
          ConditionExpression: "attribute_exists(PK)",
          ExpressionAttributeValues: { ":at": at },
        }),
      );
    } catch (error) {
      // Revoked between the read and this write: nothing to record.
      if (!isConditionFailure(error)) throw error;
    }
  }
}
