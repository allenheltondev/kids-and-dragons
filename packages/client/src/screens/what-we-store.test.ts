/**
 * The "what we store" page (#252) against what the game actually writes: the
 * data model in architecture.md §3 and the `entity` tag on every row the
 * stores put. A new kind of row that is not on the page fails here.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STORED } from "./what-we-store";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const STORE = path.join(ROOT, "packages", "server", "src", "store");

/** The Entity column of §3's first table. */
function modelRows(): string[] {
  const doc = readFileSync(path.join(ROOT, "docs", "architecture.md"), "utf8");
  const section = doc.slice(doc.indexOf("## 3. Data model"));
  const table = section.slice(section.indexOf("| Entity |"));
  const rows: string[] = [];
  for (const line of table.split("\n").slice(2)) {
    if (!line.startsWith("|")) break;
    rows.push(line.split("|")[1]!.trim());
  }
  return rows;
}

/** Every `entity` a store stamps on a row it writes. */
function storeEntities(): string[] {
  const found = new Set<string>();
  for (const file of readdirSync(STORE)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = readFileSync(path.join(STORE, file), "utf8");
    for (const match of source.matchAll(/(?:\bentity|":entity"): "([a-z-]+)"/g)) found.add(match[1]!);
  }
  return [...found].sort();
}

describe("what we store (#252)", () => {
  it("reads the data model and the stores", () => {
    expect(modelRows()).toContain("Player profile");
    expect(storeEntities()).toContain("player");
  });

  it("describes every entity in the data model", () => {
    const described = new Set(STORED.flatMap((s) => s.rows));
    expect(modelRows().filter((row) => !described.has(row))).toEqual([]);
    // And names nothing the model does not.
    expect([...described].filter((row) => !modelRows().includes(row))).toEqual([]);
  });

  it("describes every kind of row the stores write", () => {
    const described = new Set(STORED.flatMap((s) => s.entities));
    expect(storeEntities().filter((entity) => !described.has(entity))).toEqual([]);
    expect([...described].filter((entity) => !storeEntities().includes(entity))).toEqual([]);
  });
});
