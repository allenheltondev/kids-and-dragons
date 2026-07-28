import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeChapter, makeItems, makeRules } from "../test-support.ts";
import { ContentError, clearContentCache, loadContent } from "./loader.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  clearContentCache();
  for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

/** Writes a content tree; pass `null` for a file to leave it out entirely. */
async function tree(files: {
  rules?: unknown;
  items?: unknown;
  chapters?: Record<string, unknown> | null;
}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kad-content-"));
  tempDirs.push(root);
  if (files.rules !== undefined) await write(path.join(root, "rules.json"), files.rules);
  if (files.items !== undefined) await write(path.join(root, "items.json"), files.items);
  if (files.chapters !== null) {
    const dir = path.join(root, "chapters");
    await fs.mkdir(dir, { recursive: true });
    for (const [name, body] of Object.entries(files.chapters ?? {})) {
      await write(path.join(dir, `${name}.json`), body);
    }
  }
  return root;
}

async function write(file: string, body: unknown): Promise<void> {
  await fs.writeFile(file, typeof body === "string" ? body : JSON.stringify(body), "utf8");
}

function good() {
  return { rules: makeRules(), items: makeItems(), chapters: { "bramblewood-01": makeChapter() } };
}

describe("loadContent", () => {
  it("loads rules, items, and every chapter", async () => {
    const root = await tree(good());
    const content = await loadContent(root);

    expect(content.rules().version).toBe(1);
    expect(content.items().sunbloom_draught?.kind).toBe("consumable");
    expect(content.chapterIds()).toEqual(["bramblewood-01"]);
    expect(content.chapter("bramblewood-01")?.entry).toBe("scene_clearing");
    expect(content.chapter("nope")).toBeNull();
  });

  it("reads the tree once per root and re-reads only after a cache clear", async () => {
    const root = await tree(good());
    const first = await loadContent(root);
    // The cache key is the resolved path, so a trailing separator is the same
    // root — content is loaded at startup and must not be re-read per request.
    expect(await loadContent(root + path.sep)).toBe(first);

    clearContentCache();
    expect(await loadContent(root)).not.toBe(first);
  });

  it("fails loudly when a file is missing", async () => {
    const root = await tree({ items: makeItems(), chapters: null });
    const error = await loadContent(root).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ContentError);
    if (!(error instanceof ContentError)) return;
    // Every problem at once — a startup failure should not be a game of
    // whack-a-mole across three restarts.
    expect(error.problems).toEqual([
      expect.stringContaining("rules.json is missing"),
      expect.stringContaining("chapters/ is missing"),
    ]);
    expect(error.message).toContain("Content failed to load from");
  });

  it("fails loudly on malformed JSON and on an empty chapters directory", async () => {
    const broken = await tree({ ...good(), rules: "{ oh no" });
    await expect(loadContent(broken)).rejects.toThrow(/rules.json is not valid JSON/);

    const empty = await tree({ rules: makeRules(), items: makeItems(), chapters: {} });
    await expect(loadContent(empty)).rejects.toThrow(/no \.json files/);
  });

  it("rejects a chapter whose scene graph would strand a party", async () => {
    const chapter = makeChapter();
    const clearing = chapter.scenes["scene_clearing"];
    if (clearing?.type !== "story" || !clearing.choices[0]) throw new Error("bad fixture");
    clearing.choices[0].goto = "scene_that_does_not_exist";

    const root = await tree({ ...good(), chapters: { broken: chapter } });
    await expect(loadContent(root)).rejects.toThrow(
      /goes to unknown scene "scene_that_does_not_exist"/,
    );
  });

  it("rejects an entry scene that is not in the chapter, and duplicate ids", async () => {
    const orphaned = { ...makeChapter(), entry: "scene_missing" };
    await expect(loadContent(await tree({ ...good(), chapters: { a: orphaned } }))).rejects.toThrow(
      /entry scene "scene_missing"/,
    );

    const dupes = { a: makeChapter(), b: makeChapter() };
    await expect(loadContent(await tree({ ...good(), chapters: dupes }))).rejects.toThrow(
      /duplicate chapter id/,
    );
  });

  it("rejects rules and items that are missing required pieces", async () => {
    const { levelXp: _dropped, ...rules } = makeRules();
    await expect(loadContent(await tree({ ...good(), rules }))).rejects.toThrow(
      /missing "levelXp"/,
    );

    const items = { ...makeItems(), broken: { name: "Broken", text: "", icon: "" } };
    await expect(loadContent(await tree({ ...good(), items }))).rejects.toThrow(/invalid kind/);
  });
});
