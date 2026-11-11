import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MemoryKeyStore, verifyKey } from "../../packages/server/src/mcp/keys";
import { runKeysCli } from "./keys";

function cli() {
  const store = new MemoryKeyStore();
  const tables: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const run = (...argv: string[]) =>
    runKeysCli(
      argv,
      (table) => {
        tables.push(table);
        return store;
      },
      { out: (l) => out.push(l), err: (l) => err.push(l) },
    );
  return { store, tables, out, err, run };
}

describe("npm run mcp:keys", () => {
  it("mints a working key on the stage's table, prints it once, lists and revokes it", async () => {
    const c = cli();
    expect(await c.run("create", "--stage", "prod", "--label", "cloud-agent", "--scope", "assets:write", "--days", "30")).toBe(0);
    expect(c.tables).toEqual(["kad-mcp-keys-prod"]);
    const key = c.out.map((l) => l.trim()).find((l) => l.startsWith("kadmcp_"))!;
    expect(await verifyKey(c.store, key)).toMatchObject({ label: "cloud-agent", scopes: ["assets:write"] });

    c.out.length = 0;
    expect(await c.run("list", "--stage", "prod")).toBe(0);
    expect(c.out).toHaveLength(1);
    expect(c.out[0]).toContain("cloud-agent");
    expect(c.out[0]).not.toContain(key.split(".")[1]!);

    const id = c.out[0]!.split(" ")[0]!;
    expect(await c.run("revoke", "--stage", "prod", id)).toBe(0);
    expect(await verifyKey(c.store, key)).toBeNull();
    expect(await c.run("revoke", "--stage", "prod", id)).toBe(1);
  });

  it("revokes a key minted before ids were hex, even one whose id starts with a dash", async () => {
    // Keys minted with base64url ids may start with "-"; `revoke -- <id>` still reaches them.
    const c = cli();
    c.store.rows.set("-aBcDeFgHiJkLmNo", {
      id: "-aBcDeFgHiJkLmNo", label: "old", scopes: ["assets:read"], agent: null, tags: {},
      secretHash: "0".repeat(64), createdAt: "2026-11-11T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", lastUsedAt: null,
    });
    expect(await c.run("revoke", "--stage", "prod", "--", "-aBcDeFgHiJkLmNo")).toBe(0);
    expect(c.store.rows.size).toBe(0);
  });

  it("explains itself instead of minting something odd", async () => {
    const c = cli();
    expect(await c.run("create", "--label", "x", "--scope", "assets:write")).toBe(2);
    expect(await c.run("create", "--stage", "prod", "--label", "x", "--scope", "everything")).toBe(1);
    expect(c.err.join("\n")).toMatch(/Unknown scope everything/);
    expect(await c.run("create", "--stage", "prod", "--table", "custom", "--label", "x", "--scope", "operator:read")).toBe(0);
    expect(c.tables.at(-1)).toBe("custom");
    expect(c.store.rows.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Run as a command. Everything above calls `runKeysCli` directly, which is how
// a tool that never starts went unnoticed: on Windows the "was I run, or
// imported?" check compared a path with a URL, was never true, and
// `npm run mcp:keys -- create …` printed nothing and exited 0.
// ---------------------------------------------------------------------------

describe("the tools, run as commands", () => {
  const ROOT = path.resolve(import.meta.dirname, "..", "..");

  it("starts: with no arguments the key tool prints its usage and exits 2, on every platform", () => {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve("tsx/cli")), path.join(ROOT, "tools", "mcp", "keys.ts")], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("usage: npm run mcp:keys -- <create|list|revoke>");
  });

  it("never decides it was run directly by comparing a path with a URL", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (/\.(ts|mts|mjs|js)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          if (fs.readFileSync(file, "utf8").includes("`file://${process.argv[1]}`")) offenders.push(path.relative(ROOT, file));
        }
      }
    };
    for (const top of ["tools", "scripts", "infra", path.join("packages", "server", "src")]) walk(path.join(ROOT, top));
    // Use `import.meta.url === pathToFileURL(process.argv[1]).href`.
    expect(offenders).toEqual([]);
  });
});
