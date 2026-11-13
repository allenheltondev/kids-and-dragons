import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadContent } from "../content/loader.ts";
import { chapterRevision } from "../handlers/timing.ts";
import { buildChapterIndex, currentRevisions, readChapterIndex, type IndexSource } from "./chapter-index.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));

/** The real content, cut to a few chapters so the pacing walks stay quick. */
const few = (ids: string[]): IndexSource => ({
  chapterIds: () => ids,
  chapter: (id) => content.chapter(id),
  campaignIds: () => content.campaignIds(),
  campaign: (id) => content.campaign(id),
});

describe("the chapter index", () => {
  const index = buildChapterIndex(few(["gemfall-02", "first-steps-01"]), new Date("2026-11-13T00:00:00Z"));

  it("hashes each chapter as the server does, from the loaded chapter", () => {
    const [g2] = index.chapters;
    expect(g2).toMatchObject({ id: "gemfall-02", campaignId: "gemfall", position: 2 });
    expect(g2!.revision).toBe(chapterRevision(content.chapter("gemfall-02")!));
    expect(currentRevisions(index).get("gemfall-02")).toBe(g2!.revision);
  });

  it("carries the plan, the prediction, and the games and fights the chapter holds", () => {
    const g2 = index.chapters[0]!;
    const chapter = content.chapter("gemfall-02")!;
    expect(g2.estimatedMinutes).toBe(chapter.estimatedMinutes);
    expect(g2.predictedMinutes.typical).toBeGreaterThan(0);
    expect(g2.games.length).toBe(Object.values(chapter.scenes).filter((s) => s.type === "interaction").length);
    expect(g2.fights.every((f) => f.foes > 0 && f.foeKinds.length > 0)).toBe(true);
  });

  it("leaves the practice out, as timing does", () => {
    expect(index.chapters.map((c) => c.id)).toEqual(["gemfall-02"]);
    expect(index.campaigns.map((c) => c.id)).not.toContain("first-steps");
  });

  it("reads back what was written, and nothing from a missing or broken file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kad-index-"));
    const file = path.join(dir, "chapter-index.json");
    fs.writeFileSync(file, JSON.stringify(index));
    expect(readChapterIndex(file)).toEqual(index);
    fs.writeFileSync(file, "{");
    expect(readChapterIndex(file)).toBeNull();
    expect(readChapterIndex(path.join(dir, "absent.json"))).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
