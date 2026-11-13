/**
 * The MCP function's reach, pinned (docs/mcp-server.md, "What it can reach").
 * An upload key goes to agents, so the function behind it must not be able to
 * read a family's data. This reads its block of infra/template.yaml and fails
 * if that block starts naming anything beyond the keys table, the store and the
 * session-timing table, or writes a timing row that is not an exclusion.
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

  it("reaches the keys table, the asset store's blobs and the timing table, and nothing that holds a family's data", () => {
    expect(fn).toContain("!GetAtt McpKeysTable.Arn");
    expect(fn).toContain("kad-asset-store-${AWS::AccountId}/sha256/*");
    expect(fn).not.toMatch(/!Ref Table\b|!GetAtt Table\.|DynamoDBCrudPolicy|DynamoDBReadPolicy/);
    expect(fn).not.toMatch(/ssm:|kms:|appsync:|cognito-idp:|lambda:Invoke/);
  });

  it("reads the timing table, and writes there only an operator's exclusions, never a mark", () => {
    const statements = fn.split(/\n {12}- Effect: Allow\n/).slice(1);
    const timing = statements.filter((st) => st.includes("TimingTable"));
    expect(timing).toHaveLength(2);
    const [read, write] = timing as [string, string];
    expect(read.match(/dynamodb:\w+/g)).toEqual(["dynamodb:Query", "dynamodb:Scan"]);
    expect(write.match(/dynamodb:\w+/g)).toEqual(["dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:LeadingKeys"]);
    expect(write).toMatch(/ForAllValues:StringLike:\s+dynamodb:LeadingKeys:\s+- "OPS#\*"/);
    // Writes anywhere else in the block are to the keys table only.
    for (const st of statements.filter((x) => !x.includes("TimingTable"))) {
      if (/dynamodb:(PutItem|DeleteItem|Scan|Query)/.test(st)) throw new Error(`unexpected table access: ${st}`);
    }
  });

  it("ships with the chapter index its timing tools read, made by plain Node", () => {
    const build = fs.readFileSync(path.join(ROOT, "infra", "build.mjs"), "utf8");
    expect(build).toMatch(/name: "mcp", entry: "packages\/server\/src\/lambda\/mcp\.ts", chapterIndex: true/);
    expect(build).toMatch(/if \(fn\.chapterIndex\)[\s\S]*?writeChapterIndex\(dir, ROOT\)/);
    // The loader is TypeScript Node cannot strip; it must be bundled, never imported raw.
    expect(build).not.toMatch(/import\("\.\.\/packages\/server/);
    expect(fs.readFileSync(path.join(ROOT, "packages", "server", "src", "lambda", "mcp.ts"), "utf8")).toContain('new URL("./chapter-index.json", import.meta.url)');
  });

  it("names the store by the bucket asset-store.yaml creates", () => {
    const store = fs.readFileSync(path.join(ROOT, "infra", "asset-store.yaml"), "utf8");
    expect(store).toContain('BucketName: !Sub "kad-asset-store-${AWS::AccountId}"');
  });
});
