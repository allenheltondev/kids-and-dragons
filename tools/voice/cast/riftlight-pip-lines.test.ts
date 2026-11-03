/**
 * Pip Thistledown's lines in the November 2026 Riftlight rewrite, attributed by the one
 * attributor the cast sheet, `voice:untagged` and `voice:script` share. These quotes were
 * once tagged only "he says" beside other people, and went to Bram, Olivia, Seren and the
 * (silent) frost wyrm (PR #606 review).
 */
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { attributeLines, type CastSheet } from "./sheet.ts";
import { loadSources } from "./sources.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const previous = JSON.parse(fs.readFileSync(path.join(root, "content/voice/cast.json"), "utf8")) as CastSheet;
const lines = attributeLines(loadSources(root, { canon: false }), previous);
const speakersAt = (address: string) => lines.filter((line) => line.address === address).flatMap((line) => line.quotes.map((q) => q.id));

it.each([
  "riftlight-convergence/pip_choice/variants/0",
  "riftlight-convergence/pip_choice/variants/1",
  "riftlight-wyrm-nest/pip_poke/narration",
  "riftlight-wyrm-nest/pip_pokes/narration",
  "riftlight-sky-islands-arrival/lesson/variants/0",
])("%s is Pip's", (address) => {
  const ids = speakersAt(address);
  expect(ids.length, address).toBeGreaterThan(0);
  expect(new Set(ids)).toEqual(new Set(["pip_thistledown"]));
});

it("the frost wyrm never speaks", () => {
  expect(lines.flatMap((line) => line.quotes).some((q) => q.id === "frost_wyrm")).toBe(false);
});
