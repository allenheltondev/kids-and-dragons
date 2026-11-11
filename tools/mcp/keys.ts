/**
 * Mint, list and revoke the MCP server's API keys (docs/mcp-server.md, "Keys").
 *
 *   npm run mcp:keys -- create --stage prod --label cloud-agent --scope assets:write [--days 90]
 *   npm run mcp:keys -- list   --stage prod
 *   npm run mcp:keys -- revoke --stage prod <id>
 *
 * Runs with your AWS credentials, on the stage's keys table
 * (`kad-mcp-keys-<stage>`, or --table). Being able to write that table is what
 * makes someone the operator: there is no other way to mint a key, and a key
 * cannot mint another. The key is printed once; it is not stored anywhere.
 */

import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { DynamoKeyStore } from "../../packages/server/src/mcp/dynamo-keys.ts";
import { KeyError, SCOPES, listKeys, mintKey, revokeKey, type KeyInfo, type KeyStore } from "../../packages/server/src/mcp/keys.ts";

export interface KeysCliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export async function runKeysCli(argv: string[], open: (table: string) => KeyStore, io: KeysCliIo): Promise<number> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      stage: { type: "string" },
      table: { type: "string" },
      label: { type: "string" },
      scope: { type: "string", multiple: true },
      agent: { type: "string" },
      tag: { type: "string", multiple: true },
      days: { type: "string" },
    },
  });
  const usage = (): number => {
    io.err("usage: npm run mcp:keys -- <create|list|revoke> --stage <prod|staging|dev> [--table NAME]");
    io.err("  create --label NAME --scope SCOPE [--scope SCOPE…] [--agent NAME] [--tag k=v…] [--days N]   scopes: " + SCOPES.join(", "));
    io.err("  (label, agent and tags are stamped, in public, on every blob the key uploads)");
    io.err("  revoke <id>");
    return 2;
  };
  if (!values.stage && !values.table) return usage();
  const table = values.table ?? `kad-mcp-keys-${values.stage}`;
  const store = open(table);
  const row = (k: KeyInfo): string =>
    `${k.id}  ${k.label.padEnd(20)} ${(k.agent ?? "-").padEnd(10)} ${k.scopes.join(",").padEnd(28)} expires ${k.expiresAt.slice(0, 10)}  last used ${k.lastUsedAt?.slice(0, 16).replace("T", " ") ?? "never"}${
      Object.keys(k.tags ?? {}).length ? `  ${Object.entries(k.tags).map(([t, v]) => `${t}=${v}`).join(" ")}` : ""
    }`;

  try {
    switch (command) {
      case "create": {
        if (!values.label) return usage();
        const { key, info } = await mintKey(store, {
          label: values.label,
          scopes: values.scope ?? [],
          agent: values.agent,
          tags: values.tag ?? [],
          days: values.days === undefined ? undefined : Number(values.days),
        });
        io.out(`Minted ${info.id} (${info.label}${info.agent ? `, agent ${info.agent}` : ""}: ${info.scopes.join(", ")}), expires ${info.expiresAt.slice(0, 10)}.`);
        io.out("");
        io.out(`  ${key}`);
        io.out("");
        io.out("This is the only time the key is shown. Store it where its holder reads it:");
        io.out("  a cloud environment's network secret for the site's host (Authorization: Bearer <key>),");
        io.out("  or KAD_MCP_TOKEN on a laptop. Revoke with: npm run mcp:keys -- revoke --stage " + (values.stage ?? "<stage>") + ` ${info.id}`);
        return 0;
      }
      case "list": {
        const keys = await listKeys(store);
        if (keys.length === 0) io.out(`No keys in ${table}.`);
        for (const k of keys) io.out(row(k));
        return 0;
      }
      case "revoke": {
        const id = positionals[0];
        if (!id) return usage();
        await revokeKey(store, id);
        io.out(`Revoked ${id}. Its next request is refused.`);
        return 0;
      }
      default:
        return usage();
    }
  } catch (error) {
    if (error instanceof KeyError) {
      io.err(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

// Run directly, not imported. Compared as URLs: a Windows path (C:\git\...) is not
// what follows file:// in import.meta.url, and a string compare there is never true,
// so the command printed nothing and exited 0.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runKeysCli(process.argv.slice(2), (table) => new DynamoKeyStore(table), { out: console.log, err: console.error }).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
