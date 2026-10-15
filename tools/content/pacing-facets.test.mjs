/*
 * The pacing scenarios seat real facet ids (PACING_FACET_IDS), so content that
 * lists exact facets in `count.of` is measured correctly. This keeps that list
 * in step with the catalog: a facet added to or removed from items.json fails
 * here until the list is updated.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PACING_FACET_IDS } from "../../packages/shared/src/chapter-pacing.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const items = readFileSync(join(REPO, "content", "items.json"), "utf8");
const catalog = [...new Set(items.match(/"facet_[a-z_]+"/g).map((s) => s.slice(1, -1)))].sort();

describe("pacing facet ids", () => {
  it("are exactly the facet_* ids in content/items.json", () => {
    expect([...PACING_FACET_IDS].sort()).toEqual(catalog);
  });
});
