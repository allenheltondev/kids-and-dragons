import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeChapter, makeItems, makeMap, makeRules } from "../test-support.ts";
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
  abilities?: unknown;
  chapters?: Record<string, unknown> | null;
  maps?: Record<string, unknown> | null;
}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kad-content-"));
  tempDirs.push(root);
  if (files.rules !== undefined) await write(path.join(root, "rules.json"), files.rules);
  if (files.items !== undefined) await write(path.join(root, "items.json"), files.items);
  if (files.abilities !== undefined) await write(path.join(root, "abilities.json"), files.abilities);
  if (files.chapters !== null) {
    const dir = path.join(root, "chapters");
    await fs.mkdir(dir, { recursive: true });
    for (const [name, body] of Object.entries(files.chapters ?? {})) {
      await write(path.join(dir, `${name}.json`), body);
    }
  }
  if (files.maps !== null) {
    const dir = path.join(root, "maps");
    await fs.mkdir(dir, { recursive: true });
    for (const [name, body] of Object.entries(files.maps ?? {})) {
      await write(path.join(dir, `${name}.json`), body);
    }
  }
  return root;
}

async function write(file: string, body: unknown): Promise<void> {
  await fs.writeFile(file, typeof body === "string" ? body : JSON.stringify(body), "utf8");
}

function good() {
  return {
    rules: makeRules(),
    items: makeItems(),
    chapters: { "bramblewood-01": makeChapter() },
    // The fixture chapter has an encounter, and an encounter without its board
    // is a chapter that cannot be played past its first fight — so the loader
    // refuses it. That is the check working, not the fixture being fussy.
    maps: { thicket: makeMap() },
  };
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

describe("the ability catalog", () => {
  function abilities(overrides: Record<string, unknown> = {}) {
    return {
      version: 1,
      abilities: {
        brace: {
          id: "brace",
          name: "Brace",
          icon: "shield",
          timing: "action",
          target: { kind: "ally", range: "adjacent" },
          effects: [{ effect: { type: "protect" } }],
        },
        ...overrides,
      },
      $deferred: { bramble_wall: "Needs a verb that changes the terrain." },
    };
  }

  it("loads the catalog flat, dropping the wrapper the engine has no use for", async () => {
    const content = await loadContent(await tree({ ...good(), abilities: abilities() }));

    // Keyed by id, with no `version` or `$deferred` leaking in — the engine hands
    // this straight to `abilityFor`, which does a bare property lookup.
    expect(Object.keys(content.abilities())).toEqual(["brace"]);
    expect(content.abilities().brace?.effects[0]?.effect).toEqual({ type: "protect" });
  });

  it("loads a content set that has no abilities.json at all", async () => {
    /*
     * A thinner game, not a broken one: every class signature falls back to the
     * three universal actions of §7.2 and a fight is still playable. The loader's
     * job is to refuse content that would *break* at the table — `content:validate`
     * is what insists the shipped set is complete, and it fails the build for a
     * missing file rather than the session.
     */
    const content = await loadContent(await tree(good()));
    expect(content.abilities()).toEqual({});
  });

  it("rejects an ability whose key and id disagree", async () => {
    // `legalActions` offers the key and `performAction` looks up the same key, so
    // this would be an ability that vanishes between being offered and being
    // tapped — a refusal on a legal action, mid-fight.
    const catalog = abilities();
    catalog.abilities.brace.id = "brase";
    await expect(loadContent(await tree({ ...good(), abilities: catalog }))).rejects.toThrow(
      /"brace" carries id "brase"/,
    );
  });

  it("rejects an ability with no effects", async () => {
    const catalog = abilities();
    catalog.abilities.brace.effects = [];
    await expect(loadContent(await tree({ ...good(), abilities: catalog }))).rejects.toThrow(
      /button that does nothing/,
    );
  });

  it("rejects an effect verb the engine does not implement", async () => {
    /*
     * The bug this pins, found in review: the catalog is cast to its type, not
     * deeply validated, so an authored `{"type":"stun"}` sailed through and
     * became `undefined` out of `applyEffect`'s switch — a TypeError in the
     * middle of somebody's turn. It has to be a startup failure with the
     * ability's name on it, never a 500 at the table.
     */
    const catalog = abilities();
    catalog.abilities.brace.effects = [{ effect: { type: "stun" } }] as never;
    await expect(loadContent(await tree({ ...good(), abilities: catalog }))).rejects.toThrow(
      /effect verb the engine does not implement \(stun\)/,
    );
  });

  it("rejects a nameless, iconless or untimed ability", async () => {
    const bare = { id: "x", target: { kind: "self" }, effects: [{ effect: { type: "revive" } }] };
    const root = await tree({ ...good(), abilities: { version: 1, abilities: { x: bare } } });
    const error = await loadContent(root).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ContentError);
    if (!(error instanceof ContentError)) return;
    expect(error.problems).toEqual([
      expect.stringContaining('"x" has no name'),
      expect.stringContaining('"x" has no icon'),
      expect.stringContaining('"x" has an invalid timing'),
    ]);
  });

  it("rejects a file that is not JSON, or has no abilities object", async () => {
    await expect(loadContent(await tree({ ...good(), abilities: "{ oh no" }))).rejects.toThrow(
      /abilities.json is not valid JSON/,
    );
    await expect(
      loadContent(await tree({ ...good(), abilities: { version: 1, abilities: [] } })),
    ).rejects.toThrow(/expected an "abilities" object/);
  });
});
