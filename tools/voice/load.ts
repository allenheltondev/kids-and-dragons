/**
 * Reading content/ for the voice tools, so `voice:cost` and `voice:extract`
 * price and list the same lines.
 */

import fs from "node:fs";
import path from "node:path";
import type { ContentSet } from "./inventory";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const CONTENT = path.join(ROOT, "content");

export function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function readDir(dir: string): Record<string, unknown>[] {
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => readJson(path.join(dir, name)));
}

export function loadContent(): ContentSet {
  return {
    chapters: readDir(path.join(CONTENT, "chapters")),
    campaigns: readDir(path.join(CONTENT, "campaigns")),
    help: readJson(path.join(CONTENT, "help.json")),
  };
}

/**
 * The most great stones a party can hold, which is how many `{facets}` clips a
 * line needs (0 through this). The engine counts distinct `facet_*` items
 * across the party with no cap of its own (countPartyItems), so the bound is
 * the number of distinct facet ids the content can hand out: the items catalog
 * and anything a chapter or campaign grants.
 */
export function facetsMaxOf(...documents: readonly unknown[]): number {
  const ids = new Set<string>();
  for (const document of documents) {
    for (const match of JSON.stringify(document).matchAll(/"(facet_[A-Za-z0-9_]+)"/g)) ids.add(match[1] ?? "");
  }
  return ids.size;
}

export function reachableFacets(content: ContentSet): number {
  return facetsMaxOf(readJson(path.join(CONTENT, "items.json")), content.chapters, content.campaigns);
}
