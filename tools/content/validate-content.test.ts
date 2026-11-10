/**
 * The gate as a function: what `validateContent` hands back, and what it must
 * leave alone.
 *
 * The validate-*.test.mjs suites hold the gate to its rules, reading the
 * report as text. This holds it to the shape of its result (findings a tool
 * can read without parsing that text) and to the two promises the in-memory
 * harness rests on: the report rendered afterwards is the report printed as
 * it went, and a tree is never changed by being judged, so clones that share
 * their parsed files cannot leak one case into the next.
 */
import { describe, expect, it } from "vitest";

import { sceneExits } from "../../packages/shared/src/scene-exits.ts";
import type { Chapter } from "../../packages/shared/src/types/chapter.ts";
import { ContentSet } from "./content-set.ts";
import { formatEvent, renderReport, validateContent, type ReportEvent } from "./validate-content.ts";
import { copyTree, readJson, REPO, writeJson } from "./validate-harness.ts";

const CHAPTER = "content/chapters/bramblewood-01.json";

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

describe("validateContent", () => {
  it("passes the real tree with the class-place check on, as CI runs it", () => {
    const result = validateContent(copyTree());
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(0);
    expect(result.passed).toBeGreaterThan(100);
    expect(result.written).toEqual([]);
  });

  it("reports a failure as a finding: file, pointer, scene, rule, message and hint", () => {
    const tree = copyTree();
    const chapter = readJson(tree, "content", "chapters", "bramblewood-01.json");
    const entry = chapter.entry as string;
    chapter.scenes[entry].choices[0].goto = "definitely_not_a_scene";
    writeJson(tree, ["content", "chapters", "bramblewood-01.json"], chapter);

    const result = validateContent(tree);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(1);
    expect(result.findings).toContainEqual({
      file: CHAPTER,
      at: `/scenes/${entry}/choices/0/goto`,
      scene: entry,
      rule: "chapter",
      message: 'goto "definitely_not_a_scene" is not a scene in this chapter',
    });
    // Every finding is one FAIL block of the report, in order.
    const blocks = result.events.filter((event) => event.kind === "fail");
    expect(blocks.map(({ kind: _kind, ...finding }) => finding)).toEqual(result.findings);
  });

  it("files a finding under the check that raised it, and a schema failure under the schema", () => {
    const tree = copyTree();
    const chapter = readJson(tree, "content", "chapters", "bramblewood-01.json");
    chapter.surprise = true;
    writeJson(tree, ["content", "chapters", "bramblewood-01.json"], chapter);
    const rules = readJson(tree, "content", "rules.json");
    rules.tierLevels.fledgling = 2;
    writeJson(tree, ["content", "rules.json"], rules);

    const { findings } = validateContent(tree);
    expect(findings).toContainEqual(expect.objectContaining({ file: CHAPTER, at: "/", rule: "schema" }));
    expect(findings).toContainEqual(expect.objectContaining({ file: "content/rules.json", at: "/tierLevels/fledgling", rule: "rules" }));
    // A file the gate never got to parse is the loading's own failure.
    const broken = copyTree();
    broken.writeText("content/items.json", "{ this is not json");
    expect(validateContent(broken).findings).toContainEqual(expect.objectContaining({ file: "content/items.json", rule: "load" }));
  });

  it("names a problem's own code in the rule, where it leads with one", () => {
    const tree = copyTree();
    const campaign = "content/campaigns/riftlight.json";
    // A repeated key, which JSON.parse merges and only the text shows.
    const text = tree.text(campaign).replace(/"nodes":\s*\{\s*("[^"]+":)/, (whole, first: string) => `${whole} {}, ${first}`);
    expect(text).not.toBe(tree.text(campaign));
    tree.writeText(campaign, text);
    const { findings } = validateContent(tree);
    expect(findings).toContainEqual(expect.objectContaining({ file: campaign, rule: "campaign/DUPLICATE_KEY" }));
  });

  it("renders afterwards exactly what it reported as it went", () => {
    const tree = copyTree();
    tree.remove("content/voice/lexicon.json");
    tree.writeText(CHAPTER, tree.text(CHAPTER).replace('"entry"', '"entrance"'));
    const live: ReportEvent[] = [];
    const result = validateContent(tree, { onEvent: (event) => live.push(event) });
    expect(result.code).toBe(1);
    expect(live).toEqual(result.events);
    const printed = live.flatMap((event) => formatEvent(event)).map((line) => `${line}\n`).join("");
    expect(renderReport(result)).toBe(printed);
    expect(printed.startsWith("Kids & Dragons - content validate\nschemas: schemas   content: content\n")).toBe(true);
    expect(printed).toContain("\nFAILED - content is broken. A malformed chapter fails the build, never the play session.\n");
    // Color is the terminal's, and only when asked for.
    expect(printed).not.toContain("\u001b[");
    expect(renderReport(result, true)).toContain("\u001b[31mFAIL\u001b[0m");
  });

  it("changes nothing it reads, whether the tree passes or fails", () => {
    // Frozen all the way down: a write anywhere throws, and the gate would report the crash.
    const tree = ContentSet.load(REPO);
    for (const path of tree.paths()) deepFreeze(tree.json(path));
    const texts = new Map(tree.paths().map((path) => [path, tree.text(path)]));

    expect(validateContent(tree).findings).toEqual([]);

    const broken = tree.clone();
    const chapter = readJson(broken, "content", "chapters", "bramblewood-01.json");
    chapter.entry = "no_such_scene";
    delete chapter.goal;
    writeJson(broken, ["content", "chapters", "bramblewood-01.json"], chapter);
    deepFreeze(broken.json(CHAPTER));
    expect(validateContent(broken).code).toBe(1);

    // And the tree the broken one was cloned from still holds what was loaded.
    expect(tree.paths().length).toBe(texts.size);
    for (const [path, text] of texts) expect(tree.text(path)).toBe(text);
    expect(validateContent(tree).findings).toEqual([]);
  }, 30_000);

  it("writes a proof into the tree only when asked, and says so", () => {
    const proof = "content/graph-proofs/riftlight.json";
    const tree = copyTree();
    tree.remove(proof);

    const refused = validateContent(tree);
    expect(refused.findings).toContainEqual(expect.objectContaining({ file: "content/campaigns/riftlight.json", at: "/graph", message: expect.stringContaining("no graph proof") }));
    expect(refused.written).toEqual([]);
    expect(tree.has(proof)).toBe(false);

    const handed: string[] = [];
    const written = validateContent(tree, { writeProofs: true, write: (path) => handed.push(path) });
    expect(written.findings).toEqual([]);
    expect(written.written.map((file) => file.path)).toEqual([proof]);
    expect(handed).toEqual([proof]);
    // The same walk, by the same checker, over the same graph: the proof that ships.
    expect(tree.json(proof)).toEqual(copyTree().json(proof));

    expect(validateContent(tree).findings).toEqual([]);
  }, 60_000);
});

describe("ContentSet", () => {
  it("holds the tree by repo-relative path, and lists a directory as readdir sorts it", () => {
    const tree = copyTree();
    expect(tree.has("content/rules.json")).toBe(true);
    expect(tree.has("schemas/chapter.schema.json")).toBe(true);
    expect(tree.has("assets/manifest.json")).toBe(true);
    const chapters = tree.list("content/chapters");
    expect(chapters).toContain(CHAPTER);
    expect(chapters).toEqual([...chapters].sort());
    // Directly in the directory, not below it.
    expect(tree.list("content").every((path) => /^content\/[^/]+\.json$/.test(path))).toBe(true);
    expect(tree.list("content/no-such-directory")).toEqual([]);
    expect(tree.hasDir("content/chapters")).toBe(true);
    expect(tree.hasDir("content/no-such-directory")).toBe(false);
  });

  it("keeps a clone's changes to the clone", () => {
    const tree = copyTree();
    const clone = tree.clone();
    clone.writeJson("content/rules.json", { version: 99 });
    clone.remove(CHAPTER);
    clone.writeText("content/chapters/new.json", "{}");

    expect(clone.json("content/rules.json")).toEqual({ version: 99 });
    expect(clone.has(CHAPTER)).toBe(false);
    expect(clone.exists(CHAPTER)).toBe(false);
    expect(clone.list("content/chapters")).toContain("content/chapters/new.json");

    expect((tree.json("content/rules.json") as { version: number }).version).not.toBe(99);
    expect(tree.has(CHAPTER)).toBe(true);
    expect(tree.has("content/chapters/new.json")).toBe(false);
  });

  it("hands `readJson` callers their own copy, and `json` callers the shared one", () => {
    const tree = copyTree();
    const own = tree.readJson("content/rules.json") as { version: unknown };
    own.version = "changed";
    expect((tree.json("content/rules.json") as { version: unknown }).version).not.toBe("changed");
    expect(tree.json("content/rules.json")).toBe(tree.clone().json("content/rules.json"));
  });

  it("throws on text that is not JSON every time it is asked, and on a file it does not hold", () => {
    const tree = copyTree();
    tree.writeText("content/rules.json", "{ this is not json");
    expect(() => tree.json("content/rules.json")).toThrow(SyntaxError);
    expect(() => tree.json("content/rules.json")).toThrow(SyntaxError);
    expect(tree.text("content/rules.json")).toBe("{ this is not json");
    expect(() => tree.text("content/nothing.json")).toThrow(/ENOENT/);
  });

  it("stores a written value as a file would hold it", () => {
    const tree = copyTree();
    tree.writeJson("content/x.json", { kept: 1, dropped: undefined });
    expect(tree.text("content/x.json")).toBe('{\n  "kept": 1\n}');
    expect(tree.json("content/x.json")).toEqual({ kept: 1 });
  });

  it("answers for files it does not hold from the disk it was loaded from", () => {
    const tree = copyTree();
    const world = tree.json("content/world.json") as { image: { src: string } };
    expect(tree.exists(world.image.src.replace(/^\//, ""))).toBe(true);
    expect(tree.exists("assets/world/no-such-painting.webp")).toBe(false);
    // One made from nothing has no disk to ask.
    const bare = new ContentSet();
    bare.writeText("content/a.json", "1");
    expect(bare.exists("content/a.json")).toBe(true);
    expect(bare.exists("package.json")).toBe(false);
  });
});

describe("the shared sceneExits, against how the gate used to read a scene", () => {
  /** The gate's own reading before it took the shared one: every choice, then any of the seven branch keys with a goto, whatever the scene's type. */
  const KEYS = ["onSuccess", "onFailure", "onAssisted", "onVictory", "onDefeat", "onEscape", "onTimeout"];
  function before(scene: Record<string, unknown>): [to: string, at: string][] {
    const choices = Array.isArray(scene.choices) ? (scene.choices as { goto: string }[]) : [];
    return [
      ...choices.map((choice, i): [string, string] => [choice.goto, `/choices/${String(i)}`]),
      ...KEYS.flatMap((key): [string, string][] => {
        const goto = (scene[key] as { goto?: string } | undefined)?.goto;
        return goto ? [[goto, `/${key}`]] : [];
      }),
    ];
  }

  it("names the same exits, in the same order, for every scene this repo ships", () => {
    const tree = copyTree();
    let scenes = 0;
    for (const file of tree.list("content/chapters")) {
      const chapter = tree.json(file) as Chapter;
      for (const [id, scene] of [...Object.entries(chapter.scenes), ...Object.entries(chapter.resumeInteractions ?? {})]) {
        expect(sceneExits(scene).map((exit) => [exit.to, exit.at]), `${file} ${id}`).toEqual(before(scene as unknown as Record<string, unknown>));
        scenes += 1;
      }
    }
    expect(scenes).toBeGreaterThan(500);
  });
});
