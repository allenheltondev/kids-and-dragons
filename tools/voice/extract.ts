#!/usr/bin/env node
/**
 * The line inventory — `npm run voice:extract`.
 *
 * Lists every spoken line with its address, kind and class
 * (docs/voice-narration-plan.md §1), per chapter, and fails on an address that
 * names two strings. Writes nothing to content/.
 *
 *   npm run voice:extract                          # counts per chapter
 *   npm run voice:extract -- --chapter bramblewood-01 --lines
 *   npm run voice:extract -- --json                # the full list, for tooling
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { inventory } from "./inventory";
import { classify, duplicateAddresses } from "./lines";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CONTENT = path.join(ROOT, "content");

const { values } = parseArgs({
  options: {
    chapter: { type: "string" },
    "facets-max": { type: "string", default: "6" },
    lines: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const facetsMax = Number(values["facets-max"]);
if (!Number.isInteger(facetsMax) || facetsMax < 0) {
  console.error("--facets-max takes a whole number.");
  process.exit(2);
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function readDir(dir: string): Record<string, unknown>[] {
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => readJson(path.join(dir, name)));
}

const options = { facetsMax };
const raw = inventory(
  {
    chapters: readDir(path.join(CONTENT, "chapters")),
    campaigns: readDir(path.join(CONTENT, "campaigns")),
    help: readJson(path.join(CONTENT, "help.json")),
  },
  options,
);
const dupes = duplicateAddresses(raw);
const all = classify(raw, options);
const lines = values.chapter === undefined ? all : all.filter((line) => line.chapter === values.chapter);

if (lines.length === 0) {
  console.error(`No lines for chapter "${String(values.chapter)}".`);
  process.exit(2);
}

if (values.json) {
  console.log(JSON.stringify({ facetsMax, duplicates: dupes, lines }, null, 2));
} else if (values.lines) {
  for (const line of lines) {
    const tag = line.class === "templated" ? ` ×${String(line.variants.length)}` : "";
    console.log(`${line.address}  [${line.kind}${tag}]\n  ${line.text}`);
  }
} else {
  const groups = new Map<string, typeof lines>();
  for (const line of lines) groups.set(line.chapter, [...(groups.get(line.chapter) ?? []), line]);
  const num = (n: number): string => n.toLocaleString("en-US");
  console.log(`${"chapter".padEnd(28)}${"lines".padStart(7)}${"templated".padStart(11)}${"chars".padStart(10)}`);
  for (const [chapter, group] of groups) {
    const templated = group.filter((l) => l.class === "templated").length;
    const chars = group.reduce((sum, l) => sum + l.text.length, 0);
    console.log(`${chapter.padEnd(28)}${num(group.length).padStart(7)}${num(templated).padStart(11)}${num(chars).padStart(10)}`);
  }
  console.log(`\n${num(lines.length)} lines, ${num(lines.reduce((s, l) => s + l.variants.length, 0))} clips once tokens are expanded.`);
}

if (dupes.length > 0) {
  console.error(`\n${String(dupes.length)} address(es) name more than one string:\n  ${dupes.slice(0, 20).join("\n  ")}`);
  process.exit(1);
}
