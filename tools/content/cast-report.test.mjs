import { describe, expect, it } from "vitest";
import { reportCast } from "./cast-report.mjs";

const manifest = {
  castFigures: [{ id: "old_ossley", name: "Old Ossley" }, { id: "archivist", name: "Archivist" }, { id: "oldest", name: "Oldest Archivist" }],
  entities: [{ id: "frost_wyrm" }, { id: "yeti" }],
};
const chapter = (scenes) => ({ id: "test", scenes });

describe("cast mention report", () => {
  it("finds manifest names and entity IDs with word boundaries, ignoring case", () => {
    const findings = reportCast(chapter({ a: { narration: "OLD OSSLEY watches a frost wyrm. Yetis are elsewhere." } }), manifest);
    expect(findings.map((f) => f.name)).toEqual(["old ossley", "frost wyrm"]);
  });
  it("accepts local nameplates for generic figures without demanding the dedicated art", () => {
    expect(reportCast(chapter({ a: { narration: "Old Ossley waves.", cast: [{ figure: "entities/frogfolk", name: "Old Ossley" }] } }), manifest)).toEqual([]);
  });
  it("reports local names across scenes, checks, choices, variants and branch results", () => {
    const findings = reportCast(chapter({
      a: { cast: [{ figure: "entities/yeti", name: "Reading-room elder" }] },
      b: { type: "check", prompt: "Help the reading-room elder", choices: [{ label: "Ask the elder about Old Ossley" }], variants: [{ text: "A yeti waits." }], onSuccess: { narration: "Old Ossley cheers." }, onFailure: { narration: "A frost wyrm lands." } },
    }), manifest);
    expect(findings.map((f) => [f.at, f.name])).toEqual([
      ["prompt", "reading room elder"], ["variants[0].text", "yeti"], ["choices[0].label", "old ossley"], ["onSuccess.narration", "old ossley"], ["onFailure.narration", "frost wyrm"],
    ]);
  });
  it("prefers a full role over an overlapping generic role and deduplicates repeated mentions", () => {
    const findings = reportCast(chapter({ a: { narration: "The Oldest Archivist nods. The Oldest Archivist smiles." } }), manifest);
    expect(findings.map((f) => f.name)).toEqual(["oldest archivist"]);
  });
  it("skips encounters and marks cap limits without discarding candidates", () => {
    const findings = reportCast(chapter({
      fight: { type: "encounter", narration: "A frost wyrm!" },
      a: { narration: "Old Ossley waves.", cast: [{ figure: "entities/yeti" }, { figure: "entities/faun" }, { figure: "entities/selkie" }] },
    }), manifest);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ scene: "a", atCap: true, castCount: 3 });
  });
  it("retains mentions in memories as advisory candidates rather than claiming presence", () => {
    expect(reportCast(chapter({ a: { narration: "You remember Old Ossley." } }), manifest)[0].text).toBe("You remember Old Ossley.");
  });
});
