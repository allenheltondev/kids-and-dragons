import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MANIFEST_FILE, REPO_ROOT, SORTED_LISTS, findList, listName, mergeManifests, orderProblems, sortLists } from "./manifest-order.ts";
import { driveMerge, gitTextMerge, manifestProblems, resolveConflict } from "./merge-manifest.ts";

/** A small manifest laid out by hand the way the real one is: inline objects, an escape, a list of each kind. */
const manifest = (parts: { cast?: string[]; scenes?: string[]; motions?: string[]; tolerance?: string; entities?: string[] } = {}): string => {
  const cast = parts.cast ?? ['{ "id": "pellam", "name": "Pellam", "heightCm": 150 }', '{ "id": "gullet", "name": "Gullet", "heightCm": 96 }'];
  const scenes = parts.scenes ?? ['"scenes/gemfall/market"', '"scenes/entry/home"', '"scenes/gemfall/bridge"'];
  const motions = parts.motions ?? ['"rope-loop": { "idle": "sway", "use": "pull" }', '"empty-bowl": {\n        "idle": "still",\n        "use": "tip"\n      }'];
  const entities = parts.entities ?? ['{\n      "id": "sheeple",\n      "scale": 1,\n      "states": ["idle"]\n    }', '{\n      "id": "centaur",\n      "scale": 2,\n      "states": ["idle"]\n    }'];
  return [
    "{",
    '  "$comment": "Caf\\u00e9 rules: \\"quoted\\", [brackets] and {braces} in a string",',
    '  "canvas": { "width": 512, "height": 192 },',
    `  "tolerance": { "edgeMarginPx": ${parts.tolerance ?? "4"} },`,
    '  "tiers": ["sworn", "radiant", "base"],',
    '  "entities": [',
    `    ${entities.join(",\n    ")}`,
    "  ],",
    '  "sceneIllustrations": [',
    `    ${scenes.join(",\n    ")}`,
    "  ],",
    '  "castFigures": [',
    `    ${cast.join(",\n    ")}`,
    "  ],",
    '  "storyProps": {',
    '    "canvas": { "width": 256, "height": 256 },',
    '    "ids": [',
    '      "rope-loop",',
    '      "empty-bowl"',
    "    ],",
    '    "motions": {',
    `      ${motions.join(",\n      ")}`,
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
};

const LISTS = [["castFigures"], ["entities"], ["sceneIllustrations"], ["storyProps", "ids"], ["storyProps", "motions"]] as const;
const keys = (text: string, listPath: readonly string[]): string[] => findList(text, listPath)!.entries.map((e) => e.key);

describe("the real manifest", () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, MANIFEST_FILE), "utf8");

  it("has every ordered list in order, with nothing declared twice", () => {
    // Out of order? `npm run art:sort` puts it right; commit the result.
    expect(orderProblems(text).map((p) => p.detail)).toEqual([]);
  });

  it("is left exactly as it is by the sorter", () => {
    expect(sortLists(text)).toEqual({ text, moved: {} });
  });

  it("names lists that are there, and finds every entry JSON.parse finds", () => {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    for (const listPath of SORTED_LISTS) {
      const value = listPath.reduce<unknown>((at, key) => (at as Record<string, unknown>)[key], parsed);
      const expected = Array.isArray(value) ? value.map((v: unknown) => (typeof v === "string" ? v : (v as { id: string }).id)) : Object.keys(value as object);
      expect(keys(text, listPath), listName(listPath)).toEqual(expected);
    }
  });

  it("is kept with Unix line endings", () => {
    const stored = execFileSync("git", ["ls-files", "--eol", MANIFEST_FILE], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(stored).toMatch(/^i\/lf\s/);
  });
});

describe("the check", () => {
  it("says which list is out of order and which entry is the first out of place", () => {
    const problems = orderProblems(manifest(), LISTS);
    expect(problems.map((p) => `${p.list}:${p.problem}`)).toEqual(["castFigures:order", "entities:order", "sceneIllustrations:order", "storyProps.ids:order", "storyProps.motions:order"]);
    expect(problems[0]!.detail).toBe('castFigures is out of order: "gullet" comes after "pellam" (2 of 2 out of place)');
    expect(problems[2]!.detail).toMatch(/"scenes\/entry\/home" comes after "scenes\/gemfall\/market" \(3 of 3 out of place\)/);
  });

  it("passes a manifest in order, and one entry out of place fails it", () => {
    const sorted = sortLists(manifest(), LISTS).text;
    expect(orderProblems(sorted, LISTS)).toEqual([]);
    const appended = sorted.replace('"scenes/gemfall/market"\n', '"scenes/gemfall/market",\n    "scenes/bramblewood/gate"\n');
    expect(orderProblems(appended, LISTS).map((p) => p.detail)).toEqual(['sceneIllustrations is out of order: "scenes/bramblewood/gate" comes after "scenes/gemfall/market" (4 of 4 out of place)']);
  });

  it("reports an entry declared twice, which sorting cannot fix", () => {
    const twice = sortLists(manifest({ scenes: ['"scenes/a"', '"scenes/b"', '"scenes/a"'] }), LISTS).text;
    expect(orderProblems(twice, LISTS).map((p) => `${p.problem}: ${p.detail}`)).toEqual(['duplicate: sceneIllustrations declares "scenes/a" more than once']);
  });

  it("reports a list the manifest no longer has, so the table cannot go stale in silence", () => {
    const problems = orderProblems(sortLists(manifest(), LISTS).text, [...LISTS, ["storyPlates", "ids"]]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ list: "storyPlates.ids", problem: "missing" });
  });

  it("refuses a list entry with no key to order it by", () => {
    expect(() => orderProblems(manifest(), [["tolerance"]])).not.toThrow();
    expect(() => orderProblems('{ "figureVariants": [{ "class": "knight" }] }', [["figureVariants"]])).toThrow(/figureVariants\[0\] is neither a string nor an object with an id/);
  });

  it("orders by plain string order, the same on every machine", () => {
    const sorted = sortLists(manifest({ scenes: ['"b_two"', '"b-one"', '"B"', '"b/three"', '"b10"', '"b9"'] }), LISTS).text;
    expect(keys(sorted, ["sceneIllustrations"])).toEqual(["B", "b-one", "b/three", "b10", "b9", "b_two"]);
    expect(keys(sorted, ["sceneIllustrations"])).toEqual(["b_two", "b-one", "B", "b/three", "b10", "b9"].sort());
  });
});

describe("the sorter", () => {
  it("moves each entry's own text and changes nothing else", () => {
    const before = manifest();
    const { text, moved } = sortLists(before, LISTS);
    expect(moved).toEqual({ castFigures: 2, entities: 2, sceneIllustrations: 3, "storyProps.ids": 2, "storyProps.motions": 2 });
    expect(keys(text, ["castFigures"])).toEqual(["gullet", "pellam"]);
    expect(keys(text, ["entities"])).toEqual(["centaur", "sheeple"]);
    expect(keys(text, ["sceneIllustrations"])).toEqual(["scenes/entry/home", "scenes/gemfall/bridge", "scenes/gemfall/market"]);
    expect(keys(text, ["storyProps", "motions"])).toEqual(["empty-bowl", "rope-loop"]);
    // The same lines, in another order: no line was reformatted, re-escaped or re-indented.
    const lines = (t: string): string[] => t.split("\n").map((l) => l.replace(/,$/, "")).sort();
    expect(lines(text)).toEqual(lines(before));
    expect(text).toHaveLength(before.length);
    // Hand formatting and escapes are where they were.
    expect(text).toContain('"canvas": { "width": 512, "height": 192 },');
    expect(text).toContain("Caf\\u00e9");
    expect(text).toContain('"tiers": ["sworn", "radiant", "base"]');
    expect(text).toContain('    { "id": "gullet", "name": "Gullet", "heightCm": 96 },\n    { "id": "pellam", "name": "Pellam", "heightCm": 150 }\n  ],');
    // Same content, order aside.
    const set = (t: string) => (JSON.parse(t) as { sceneIllustrations: string[] }).sceneIllustrations.sort();
    expect(set(text)).toEqual(set(before));
  });

  it("does nothing to a manifest already in order", () => {
    const once = sortLists(manifest(), LISTS).text;
    expect(sortLists(once, LISTS)).toEqual({ text: once, moved: {} });
  });

  it("keeps Windows line endings where a file has them", () => {
    const windows = manifest().replace(/\n/g, "\r\n");
    const { text } = sortLists(windows, LISTS);
    expect(text).not.toMatch(/[^\r]\n/);
    expect(text.replace(/\r\n/g, "\n")).toBe(sortLists(manifest(), LISTS).text);
  });

  it("is not fooled by brackets, commas and quotes inside strings", () => {
    const tricky = '{ "sceneIllustrations": ["b ] , [", "a \\" } {", "c"] }';
    const { text } = sortLists(tricky, [["sceneIllustrations"]]);
    expect(text).toBe('{ "sceneIllustrations": ["a \\" } {", "b ] , [", "c"] }');
  });

  it("refuses a file that is not JSON rather than guess", () => {
    expect(() => sortLists('{ "sceneIllustrations": ["b", "a", ] }', [["sceneIllustrations"]])).toThrow();
  });
});

describe("merging the manifest", () => {
  const sorted = (parts: Parameters<typeof manifest>[0] = {}): string => sortLists(manifest(parts), LISTS).text;
  const merge = (base: string, ours: string, theirs: string) => mergeManifests(base, ours, theirs, gitTextMerge, LISTS);
  const SCENES = ['"scenes/entry/home"', '"scenes/gemfall/bridge"', '"scenes/gemfall/market"'];
  const CAST = ['{ "id": "gullet", "name": "Gullet", "heightCm": 96 }', '{ "id": "pellam", "name": "Pellam", "heightCm": 150 }'];

  it("merges two branches whose new entries sort next to each other, which git alone calls a conflict", () => {
    const base = sorted();
    const ours = sorted({ scenes: [...SCENES, '"scenes/gemfall/cellar"'] });
    const theirs = sorted({ scenes: [...SCENES, '"scenes/gemfall/chapel"'] });
    expect(gitTextMerge(base, ours, theirs).conflicts).toBe(1);

    const merged = merge(base, ours, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(keys(merged.text, ["sceneIllustrations"])).toEqual(["scenes/entry/home", "scenes/gemfall/bridge", "scenes/gemfall/cellar", "scenes/gemfall/chapel", "scenes/gemfall/market"]);
    expect(orderProblems(merged.text, LISTS)).toEqual([]);
    // Laid out as the file is: one entry to a line, at the list's indent.
    expect(merged.text).toContain('    "scenes/gemfall/cellar",\n    "scenes/gemfall/chapel",\n    "scenes/gemfall/market"\n  ],');
    expect(merged.text).toContain('"canvas": { "width": 512, "height": 192 },');
  });

  it("merges a branch cut before the lists were sorted with a main cut after", () => {
    const base = manifest();
    const branch = manifest({ scenes: ['"scenes/gemfall/market"', '"scenes/entry/home"', '"scenes/gemfall/bridge"', '"scenes/gemfall/attic"'], cast: ['{ "id": "pellam", "name": "Pellam", "heightCm": 150 }', '{ "id": "gullet", "name": "Gullet", "heightCm": 96 }', '{ "id": "posy", "name": "Posy", "heightCm": 110 }'] });
    const main = sorted({ scenes: [...SCENES, '"scenes/riftlight/quay"'] });
    expect(gitTextMerge(base, branch, main).conflicts).toBeGreaterThan(0);

    for (const [ours, theirs] of [[branch, main], [main, branch]] as const) {
      const merged = merge(base, ours, theirs);
      expect(merged.conflicts).toEqual([]);
      expect(keys(merged.text, ["sceneIllustrations"])).toEqual(["scenes/entry/home", "scenes/gemfall/attic", "scenes/gemfall/bridge", "scenes/gemfall/market", "scenes/riftlight/quay"]);
      expect(keys(merged.text, ["castFigures"])).toEqual(["gullet", "pellam", "posy"]);
      expect(orderProblems(merged.text, LISTS)).toEqual([]);
    }
  });

  it("takes a removal, a change and an addition from whichever side made it", () => {
    const base = sorted();
    const ours = sorted({ scenes: ['"scenes/entry/home"', '"scenes/gemfall/market"'], cast: [CAST[0]!, '{ "id": "pellam", "name": "Pellam", "heightCm": 155 }'] });
    const theirs = sorted({ motions: ['"empty-bowl": {\n        "idle": "still",\n        "use": "tip"\n      }', '"rope-loop": { "idle": "sway", "use": "pull" }', '"wind-bells": { "idle": "ring", "use": "ring" }'] });
    const merged = merge(base, ours, theirs);
    expect(merged.conflicts).toEqual([]);
    const parsed = JSON.parse(merged.text) as { sceneIllustrations: string[]; castFigures: { id: string; heightCm: number }[]; storyProps: { motions: Record<string, unknown> } };
    expect(parsed.sceneIllustrations).toEqual(["scenes/entry/home", "scenes/gemfall/market"]);
    expect(parsed.castFigures.find((f) => f.id === "pellam")!.heightCm).toBe(155);
    expect(Object.keys(parsed.storyProps.motions)).toEqual(["empty-bowl", "rope-loop", "wind-bells"]);
  });

  it("merges two changes to different lines of one entry, as git would", () => {
    // The two changes are a few lines apart: git calls changes to neighbouring lines a conflict.
    const entity = (scale: number, states: string) => `{\n      "id": "sheeple",\n      "scale": ${scale},\n      "biome": "plains",\n      "rig": "none",\n      "states": [${states}]\n    }`;
    const centaur = '{\n      "id": "centaur",\n      "scale": 2,\n      "states": ["idle"]\n    }';
    const base = sorted({ entities: [centaur, entity(1, '"idle"')] });
    const ours = sorted({ entities: [centaur, entity(3, '"idle"')] });
    const theirs = sorted({ entities: [centaur, entity(1, '"idle", "graze"')] });
    const merged = merge(base, ours, theirs);
    expect(merged.conflicts).toEqual([]);
    expect((JSON.parse(merged.text) as { entities: unknown[] }).entities[1]).toEqual({ id: "sheeple", scale: 3, biome: "plains", rig: "none", states: ["idle", "graze"] });
  });

  it("keeps ours and names the entry when both sides changed it differently", () => {
    const base = sorted();
    const ours = sorted({ cast: [CAST[0]!, '{ "id": "pellam", "name": "Pellam", "heightCm": 155 }'] });
    const theirs = sorted({ cast: [CAST[0]!, '{ "id": "pellam", "name": "Pellam", "heightCm": 160 }'] });
    const merged = merge(base, ours, theirs);
    expect(merged.conflicts).toEqual(['castFigures "pellam": both sides changed it differently; ours is kept']);
    expect((JSON.parse(merged.text) as { castFigures: { id: string; heightCm: number }[] }).castFigures[1]!.heightCm).toBe(155);

    const removed = merge(base, sorted({ cast: [CAST[0]!] }), theirs);
    expect(removed.conflicts).toEqual(['castFigures "pellam": ours removed it and theirs changed it; it stays removed']);
    const both = merge(base, sorted({ scenes: [...SCENES, '"scenes/new"'] }), sorted({ scenes: [...SCENES, '"scenes/new"'] }));
    expect(both.conflicts).toEqual([]);
    expect(keys(both.text, ["sceneIllustrations"]).filter((k) => k === "scenes/new")).toHaveLength(1);
  });

  it("merges the rest of the file by line, and marks a conflict there the usual way", () => {
    const base = sorted();
    const clean = merge(base, sorted({ tolerance: "6" }), sorted({ scenes: [...SCENES, '"scenes/gemfall/cellar"'] }));
    expect(clean.conflicts).toEqual([]);
    expect((JSON.parse(clean.text) as { tolerance: { edgeMarginPx: number } }).tolerance.edgeMarginPx).toBe(6);
    expect(keys(clean.text, ["sceneIllustrations"])).toContain("scenes/gemfall/cellar");

    const fought = merge(base, sorted({ tolerance: "6" }), sorted({ tolerance: "8", scenes: [...SCENES, '"scenes/gemfall/cellar"'] }));
    expect(fought.conflicts).toEqual(["1 conflict(s) outside the ordered lists, marked in the file"]);
    expect(fought.text).toMatch(/^<<<<<<< ours\n {2}"tolerance": \{ "edgeMarginPx": 6 \},\n=======\n {2}"tolerance": \{ "edgeMarginPx": 8 \},\n>>>>>>> theirs$/m);
    // The lists are still merged around it.
    expect(fought.text).toContain('"scenes/gemfall/cellar",');
    expect(fought.text).not.toContain("@@kad-list");
  });

  it("writes Unix line endings whatever came in, as the file is stored", () => {
    const windows = (text: string): string => text.replace(/\n/g, "\r\n");
    const merged = merge(windows(sorted()), windows(sorted({ scenes: [...SCENES, '"scenes/gemfall/cellar"'] })), sorted({ scenes: [...SCENES, '"scenes/gemfall/chapel"'] }));
    expect(merged.conflicts).toEqual([]);
    expect(merged.text).not.toContain("\r");
    expect(merged.text).toBe(merge(sorted(), sorted({ scenes: [...SCENES, '"scenes/gemfall/cellar"'] }), sorted({ scenes: [...SCENES, '"scenes/gemfall/chapel"'] })).text);
  });

  it("falls back to git's own line merge when a side is not JSON, and takes a result that is a manifest", () => {
    // The ancestor is broken and ours mended it: the lines merge, and what they make is valid.
    const ours = sorted();
    const broken = ours.replace('"tiers": [', '"tiers": [,');
    const theirs = broken.replace('"scenes/gemfall/bridge",', '"scenes/gemfall/bridge",\n    "scenes/gemfall/chapel",');
    expect(() => mergeManifests(broken, ours, theirs, gitTextMerge, LISTS)).toThrow();
    const result = driveMerge(broken, ours, theirs);
    expect(result.conflicts).toEqual([]);
    expect(result.text).toBe(gitTextMerge(broken, ours, theirs).text);
    expect(keys(result.text, ["sceneIllustrations"])).toContain("scenes/gemfall/chapel");
    expect(manifestProblems(result.text)).toEqual([]);
  });

  it("never calls a line merge clean when what it made is not JSON", () => {
    const base = sorted();
    const theirs = sorted({ scenes: [...SCENES, '"scenes/gemfall/chapel"'] });
    const broken = base.replace('"tiers": [', '"tiers": [,');
    // git's line merge has nothing to object to: the two sides changed different lines.
    const plain = gitTextMerge(base, broken, theirs);
    expect(plain.conflicts).toBe(0);
    expect(() => JSON.parse(plain.text)).toThrow();

    const result = driveMerge(base, broken, theirs);
    expect(result.text).toBe(plain.text);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatch(/^the lines merged without a conflict, but the result is not a valid manifest: it is not a manifest: /);
    // The same when it is theirs that is broken.
    expect(driveMerge(base, theirs, broken).conflicts).toHaveLength(1);
  });

  it("never calls a line merge clean when it leaves a list out of order or an entry declared twice", () => {
    const base = sorted();
    // Ours declares a scene a second time, at the end: the entry-by-entry merge refuses to
    // pick one, and the line merge sees only two changes that do not touch.
    const ours = base.replace('"scenes/gemfall/market"\n', '"scenes/gemfall/market",\n    "scenes/entry/home"\n');
    const theirs = sorted({ tolerance: "6" });
    expect(() => mergeManifests(base, ours, theirs, gitTextMerge, LISTS)).toThrow(/sceneIllustrations declares "scenes\/entry\/home" more than once/);
    const plain = gitTextMerge(base, ours, theirs);
    expect(plain.conflicts).toBe(0);
    expect(() => JSON.parse(plain.text)).not.toThrow();

    const result = driveMerge(base, ours, theirs);
    expect(result.text).toBe(plain.text);
    expect(result.conflicts).toEqual([
      'the lines merged without a conflict, but the result is not a valid manifest: sceneIllustrations declares "scenes/entry/home" more than once',
      'the lines merged without a conflict, but the result is not a valid manifest: sceneIllustrations is out of order: "scenes/entry/home" comes after "scenes/gemfall/market" (3 of 4 out of place)',
    ]);
  });

  it("does not quietly drop one of two entries with the same key", () => {
    const pellamTwice = sorted({ cast: [CAST[0]!, CAST[1]!, '{ "id": "pellam", "name": "Pellam the Younger", "heightCm": 90 }'] });
    const result = driveMerge(sorted(), pellamTwice, sorted({ tolerance: "6" }));
    expect(result.conflicts).toEqual(['the lines merged without a conflict, but the result is not a valid manifest: castFigures declares "pellam" more than once']);
    expect(result.text).toContain("Pellam the Younger");
    expect(result.text).toContain('"name": "Pellam", "heightCm": 150');
  });

  it("merges the real manifest with itself plus a neighbour on each side", () => {
    const base = fs.readFileSync(path.join(REPO_ROOT, MANIFEST_FILE), "utf8");
    const scenes = findList(base, ["sceneIllustrations"])!;
    const last = scenes.entries[scenes.entries.length - 1]!;
    const add = (id: string): string => `${base.slice(0, last.end)},\n    "${id}"${base.slice(last.end)}`;
    const merged = driveMerge(base, add("zz/ours"), add("zz/theirs"));
    expect(merged.conflicts).toEqual([]);
    expect(orderProblems(merged.text)).toEqual([]);
    expect(keys(merged.text, ["sceneIllustrations"]).slice(-2)).toEqual(["zz/ours", "zz/theirs"]);
    // Nothing else moved: taking the two new lines back out gives the file we started with.
    expect(merged.text.replace(',\n    "zz/ours",\n    "zz/theirs"', "")).toBe(base);
  });
});

describe("the merge driver, run by git", () => {
  let repo: string;
  const git = (...args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const write = (text: string): void => fs.writeFileSync(path.join(repo, "assets", "manifest.json"), text);
  const read = (): string => fs.readFileSync(path.join(repo, "assets", "manifest.json"), "utf8");

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kad-manifest-driver-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("config", "core.autocrlf", "false");
    git("config", "merge.kad-art-manifest.driver", `node ${path.join(REPO_ROOT, "tools/art/merge-manifest.ts").replace(/\\/g, "/")} %O %A %B`);
    fs.mkdirSync(path.join(repo, "assets"));
    fs.writeFileSync(path.join(repo, ".gitattributes"), "assets/manifest.json merge=kad-art-manifest text eol=lf\n");
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  // The driver sorts the lists the real manifest has; this fixture has three of them.
  const real = (scenes: string[], height = 150): string =>
    `{\n  "tolerance": { "edgeMarginPx": 4 },\n  "sceneIllustrations": [\n    ${scenes.map((s) => `"${s}"`).join(",\n    ")}\n  ],\n  "castFigures": [\n    { "id": "gullet", "heightCm": 96 },\n    { "id": "pellam", "heightCm": ${height} }\n  ]\n}\n`;

  it("merges two art branches that git alone would stop on", () => {
    write(real(["scenes/a", "scenes/m"]));
    git("add", "-A");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "left");
    write(real(["scenes/a", "scenes/b", "scenes/m"]));
    git("commit", "-qam", "left");
    git("checkout", "-q", "main");
    write(real(["scenes/a", "scenes/c", "scenes/m"]));
    git("commit", "-qam", "right");

    git("merge", "-q", "--no-edit", "left");
    expect(read()).toBe(real(["scenes/a", "scenes/b", "scenes/c", "scenes/m"]));
    expect(git("status", "--porcelain")).toBe("");
  }, 60_000);

  it("leaves the merge for a person when both sides changed one entry, with ours in the file", () => {
    write(real(["scenes/a"]));
    git("add", "-A");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "left");
    write(real(["scenes/a", "scenes/b"], 160));
    git("commit", "-qam", "left");
    git("checkout", "-q", "main");
    write(real(["scenes/a"], 155));
    git("commit", "-qam", "right");

    let said = "";
    try {
      git("merge", "-q", "--no-edit", "left");
    } catch (error) {
      said = String((error as { stderr?: string }).stderr) + String((error as { stdout?: string }).stdout);
    }
    expect(said).toMatch(/castFigures "pellam": both sides changed it differently; ours is kept/);
    expect(git("status", "--porcelain")).toMatch(/^UU assets\/manifest\.json$/m);
    // What merged is merged, and the disputed entry is ours, with no markers to break the JSON.
    expect(read()).toBe(real(["scenes/a", "scenes/b"], 155));
  }, 60_000);

  it("stops git from recording a merge whose lines went together into something that is not a manifest", () => {
    const tolerance = (text: string, value: number): string => text.replace('"edgeMarginPx": 4', `"edgeMarginPx": ${value}`);
    write(real(["scenes/a", "scenes/m"]));
    git("add", "-A");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "left");
    write(tolerance(real(["scenes/a", "scenes/m"]), 6));
    git("commit", "-qam", "left changes a tolerance");
    git("checkout", "-q", "main");
    // Main declares a scene twice, far from the line left changed.
    write(real(["scenes/a", "scenes/m", "scenes/a"]));
    git("commit", "-qam", "right declares a scene twice");

    let said = "";
    try {
      git("merge", "-q", "--no-edit", "left");
    } catch (error) {
      said = String((error as { stderr?: string }).stderr) + String((error as { stdout?: string }).stdout);
    }
    // Without the check this merge succeeded, and git committed a manifest the gate fails.
    expect(said).toMatch(/the lines merged without a conflict, but the result is not a valid manifest: sceneIllustrations declares "scenes\/a" more than once/);
    expect(git("status", "--porcelain")).toMatch(/^UU assets\/manifest\.json$/m);
    expect(read()).toBe(tolerance(real(["scenes/a", "scenes/m", "scenes/a"]), 6));
    // And art:resolve does not stage it either.
    expect(resolveConflict(repo).outcome).toBe("conflicts");
    expect(git("status", "--porcelain")).toMatch(/^UU assets\/manifest\.json$/m);
  }, 60_000);

  it("is not there for a branch cut before it, whose first merge of main art:resolve finishes", () => {
    // Before: no driver named for the file, lists in the order they grew, Windows line endings.
    fs.rmSync(path.join(repo, ".gitattributes"));
    const old = (scenes: string[]): string => real(scenes).replace(/\n/g, "\r\n");
    write(old(["scenes/m", "scenes/a"]));
    git("add", "-A");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "old-art");
    write(old(["scenes/m", "scenes/a", "scenes/b"]));
    git("commit", "-qam", "an art branch adds at the end");
    git("checkout", "-q", "main");
    fs.writeFileSync(path.join(repo, ".gitattributes"), "assets/manifest.json merge=kad-art-manifest text eol=lf\n");
    write(real(["scenes/a", "scenes/c", "scenes/m"]));
    git("add", "-A");
    git("commit", "-qm", "main sorts the lists and names the driver");

    git("checkout", "-q", "old-art");
    expect(resolveConflict(repo)).toEqual({ outcome: "none", conflicts: [] });
    expect(() => git("merge", "-q", "--no-edit", "main")).toThrow();
    expect(git("status", "--porcelain")).toMatch(/^UU assets\/manifest\.json$/m);

    expect(resolveConflict(repo)).toEqual({ outcome: "resolved", conflicts: [] });
    expect(read()).toBe(real(["scenes/a", "scenes/b", "scenes/c", "scenes/m"]));
    expect(git("status", "--porcelain")).not.toMatch(/^UU/m);
    expect(git("ls-files", "--eol", "assets/manifest.json")).toMatch(/^i\/lf\s/);
    git("commit", "-qm", "merge main");
    // From here on the branch names the driver, and the next merge needs no help.
    git("checkout", "-q", "main");
    write(real(["scenes/a", "scenes/c", "scenes/d", "scenes/m"]));
    git("commit", "-qam", "main adds another");
    git("checkout", "-q", "old-art");
    write(real(["scenes/a", "scenes/b", "scenes/c", "scenes/cc", "scenes/m"]));
    git("commit", "-qam", "the branch adds a neighbour");
    git("merge", "-q", "--no-edit", "main");
    expect(read()).toBe(real(["scenes/a", "scenes/b", "scenes/c", "scenes/cc", "scenes/d", "scenes/m"]));
  }, 60_000);

  it("leaves what it cannot decide unstaged, and says what", () => {
    fs.rmSync(path.join(repo, ".gitattributes"));
    write(real(["scenes/a"]));
    git("add", "-A");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "left");
    write(real(["scenes/a"], 160));
    git("commit", "-qam", "left");
    git("checkout", "-q", "main");
    write(real(["scenes/a"], 155));
    git("commit", "-qam", "right");
    expect(() => git("merge", "-q", "--no-edit", "left")).toThrow();

    expect(resolveConflict(repo)).toEqual({ outcome: "conflicts", conflicts: ['castFigures "pellam": both sides changed it differently; ours is kept'] });
    expect(read()).toBe(real(["scenes/a"], 155));
    expect(git("status", "--porcelain")).toMatch(/^UU assets\/manifest\.json$/m);
  }, 60_000);
});
