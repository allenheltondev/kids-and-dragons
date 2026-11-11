/**
 * The MCP function's reach, pinned (docs/mcp-server.md, "What it can reach").
 * An upload key goes to agents, so the function behind it must not be able to
 * read a family's data. This reads its block of infra/template.yaml and fails
 * if that block starts naming anything beyond the keys table and the store.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const template = fs.readFileSync(path.join(ROOT, "infra", "template.yaml"), "utf8");

function resource(name: string): string {
  const start = template.indexOf(`\n  ${name}:\n`);
  expect(start, name).toBeGreaterThan(0);
  const rest = template.slice(start + 1);
  const next = rest.slice(1).search(/\n  [A-Za-z]+:\n|\n  # -{10}/);
  return rest.slice(0, next < 0 ? undefined : next + 1);
}

describe("the MCP function", () => {
  const fn = resource("McpFunction");

  it("is routed at /api/mcp on the HTTP API, ahead of the catch-all", () => {
    expect(fn).toContain("Path: /api/mcp");
    expect(fn).toContain("ApiId: !Ref HttpApi");
  });

  it("reaches the keys table and the asset store's blobs, and nothing that holds a family's data", () => {
    expect(fn).toContain("!GetAtt McpKeysTable.Arn");
    expect(fn).toContain("kad-asset-store-${AWS::AccountId}/sha256/*");
    expect(fn).not.toMatch(/!Ref Table\b|!GetAtt Table\.|TimingTable|DynamoDBCrudPolicy/);
    expect(fn).not.toMatch(/ssm:|kms:|appsync:|cognito-idp:|lambda:Invoke/);
    expect(fn).not.toMatch(/dynamodb:(PutItem|DeleteItem|Scan|Query)/);
  });

  it("names the store by the bucket asset-store.yaml creates", () => {
    const store = fs.readFileSync(path.join(ROOT, "infra", "asset-store.yaml"), "utf8");
    expect(store).toContain('BucketName: !Sub "kad-asset-store-${AWS::AccountId}"');
  });
});
