import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chapterFlagWrites } from "./campaign-graph-lint.js";
import { graphFingerprint, stableHash } from "./graph-proof.js";
import type { Campaign, Chapter } from "./types/chapter.js";

const REPO = new URL("../../../", import.meta.url);
const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, REPO), "utf8")) as T;
const campaign = read<Campaign>("content/campaigns/riftlight.json");
const chapters = new Map(campaign.chapters.map((id) => [id, read<Chapter>(`content/chapters/${id}.json`)]));
const flagsOf = (from: Map<string, Chapter>) => (id: string) => {
  const chapter = from.get(id);
  return chapter ? chapterFlagWrites(chapter) : undefined;
};

describe("a graph fingerprint", () => {
  const base = graphFingerprint(campaign, flagsOf(chapters));

  it("is a stable 128-bit hex hash", () => {
    expect(base).toMatch(/^[0-9a-f]{32}$/);
    expect(graphFingerprint(structuredClone(campaign), flagsOf(chapters))).toBe(base);
    expect(stableHash("a")).not.toBe(stableHash("b"));
  });

  it("matches the shipped proof, so the server never walks Riftlight at start", () => {
    expect(read<{ fingerprint: string }>("content/graph-proofs/riftlight.json").fingerprint).toBe(base);
  });

  it("moves when the graph changes", () => {
    const edited = structuredClone(campaign);
    delete edited.graph!.edges[Object.keys(edited.graph!.edges)[0]!];
    expect(graphFingerprint(edited, flagsOf(chapters))).not.toBe(base);
  });

  it("moves when a chapter can set a different flag", () => {
    const id = campaign.chapters[0]!;
    const chapter = structuredClone(chapters.get(id)!);
    const scene = Object.values(chapter.scenes)[0]!;
    scene.onEnter = [...(scene.onEnter ?? []), { type: "setFlag", flag: "a_new_flag", value: true }];
    expect(graphFingerprint(campaign, flagsOf(new Map([...chapters, [id, chapter]])))).not.toBe(base);
  });

  it("holds still when only words change", () => {
    const id = campaign.chapters[0]!;
    const chapter = structuredClone(chapters.get(id)!);
    chapter.title = "A different title";
    const scene = Object.values(chapter.scenes)[0]! as { narration?: string };
    scene.narration = "Different words, same story.";
    expect(graphFingerprint(campaign, flagsOf(new Map([...chapters, [id, chapter]])))).toBe(base);
  });
});
