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
