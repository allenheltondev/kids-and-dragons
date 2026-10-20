/**
 * The "what we store" page (#252) against what the game actually writes: the
 * data model in architecture.md §3 and the `entity` tag on every row the
 * stores put. A new kind of row that is not on the page fails here.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DELETING, ELSEWHERE, STORED } from "./what-we-store";

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

/** The field names of an interface in the shared domain types. */
function fieldsOf(typeName: string): string[] {
  const source = readFileSync(path.join(ROOT, "packages", "shared", "src", "types", "domain.ts"), "utf8");
  const start = source.indexOf(`export interface ${typeName} {`);
  if (start < 0) throw new Error(`no interface ${typeName}`);
  const body = source.slice(start, source.indexOf("\n}\n", start));
  // A property line sits one level in: two spaces, then its name.
  return [...body.matchAll(/^ {2}([A-Za-z]\w*)\??:/gm)].map((m) => m[1]!);
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

  it("names what a hero row remembers about her, the practice included (#255)", () => {
    const hero = STORED.find((s) => s.rows.includes("Character"))!;
    expect(hero.what).toMatch(/finished/);
    expect(hero.what).toMatch(/played the practice/);
  });

  it("describes every kind of row the stores write", () => {
    const described = new Set(STORED.flatMap((s) => s.entities));
    expect(storeEntities().filter((entity) => !described.has(entity))).toEqual([]);
    expect([...described].filter((entity) => !storeEntities().includes(entity))).toEqual([]);
  });

  it("describes every field of a kid's profile, so a new one is not stored unmentioned (#299)", () => {
    const profile = STORED.find((s) => s.entities.includes("player"));
    expect(fieldsOf("PlayerProfile")).toContain("flair");
    const described = Object.keys(profile?.fields ?? {});
    expect(fieldsOf("PlayerProfile").filter((field) => !described.includes(field))).toEqual([]);
    expect(described.filter((field) => !fieldsOf("PlayerProfile").includes(field))).toEqual([]);
  });

  it("says a kid's page goes when she does (#299)", () => {
    expect(DELETING[0]).toMatch(/profile, with the colors, frames and title she picked/);
  });

  it("says crash reports are logged and not stored, with nothing a kid typed (#317)", () => {
    const reports = ELSEWHERE.find((e) => e.title === "Crash reports");
    expect(reports?.what).toMatch(/Logged, not stored/);
    expect(reports?.what).toMatch(/never sent/);
  });

  it("says no data goes to a model (#347)", () => {
    const ai = ELSEWHERE.find((e) => e.title === "No AI at the table");
    expect(ai?.what).toMatch(/no AI calls/);
    expect(ai?.what).toMatch(/is sent to an AI model/);
    expect(JSON.stringify([STORED, ELSEWHERE, DELETING])).not.toMatch(/narration/i);
  });
});
