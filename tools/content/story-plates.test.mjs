/**
 * Story plates (docs/story-plates.md): the paintings content asks for and the paintings the
 * manifest declares are the same list, so the art tools count what is owed and nothing in a
 * campaign points at a painting nobody was commissioned to make.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const readJson = (...path) => JSON.parse(readFileSync(join(REPO, ...path), "utf8"));
const jsonIn = (dir) => readdirSync(join(REPO, dir)).filter((f) => f.endsWith(".json")).map((f) => readJson(dir, f));

const manifest = readJson("assets", "manifest.json");
const campaigns = jsonIn("content/campaigns");
const chapters = jsonIn("content/chapters");

/** Every plate content uses: [owner, art]. */
function used() {
  const out = [];
  for (const campaign of campaigns) {
    for (const [i, plate] of (campaign.prologue?.plates ?? []).entries()) out.push([`${campaign.id} prologue ${String(i + 1)}`, plate.art]);
  }
  for (const chapter of chapters) if (chapter.plate) out.push([`${chapter.id} plate`, chapter.plate.art]);
  return out;
}

describe("story plates", () => {
  it("declares a 16:9 canvas", () => {
    expect(manifest.storyPlates.canvas).toEqual({ width: 1600, height: 900 });
  });

  it("has every painting content uses in the manifest, and nothing else", () => {
    const declared = new Set(manifest.storyPlates.ids);
    const asked = new Set(used().map(([, art]) => art));
    expect([...asked].filter((art) => !declared.has(art))).toEqual([]);
    expect([...declared].filter((art) => !asked.has(art))).toEqual([]);
  });

  it("has a prompt for every declared painting, with the words content says over it", () => {
    const prompts = readJson("docs", "story-plates-prompts.json").paintings;
    expect(prompts.map((p) => p.id).sort()).toEqual([...manifest.storyPlates.ids].sort());
    const said = new Map();
    for (const campaign of campaigns) for (const plate of campaign.prologue?.plates ?? []) said.set(plate.art, plate.narration);
    for (const chapter of chapters) if (chapter.plate) said.set(chapter.plate.art, chapter.plate.narration);
    for (const painting of prompts) {
      expect(painting.narration, painting.id).toBe(said.get(painting.id));
      expect(painting.path, painting.id).toBe(`assets/${painting.id}.webp`);
    }
  });

  it("declares each painting once", () => {
    const ids = manifest.storyPlates.ids;
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every prologue three to six plates, in the campaign's own folder", () => {
    for (const campaign of campaigns) {
      if (!campaign.prologue) continue;
      expect(campaign.prologue.plates.length, campaign.id).toBeGreaterThanOrEqual(3);
      expect(campaign.prologue.plates.length, campaign.id).toBeLessThanOrEqual(6);
      for (const plate of campaign.prologue.plates) expect(plate.art.startsWith(`plates/${campaign.id}/`), plate.art).toBe(true);
    }
  });

  it("puts a chapter plate only in a chapter of the campaign whose folder it is in", () => {
    for (const chapter of chapters) {
      if (chapter.plate) expect(chapter.plate.art.startsWith(`plates/${chapter.campaignId}/`), chapter.id).toBe(true);
    }
  });
});
