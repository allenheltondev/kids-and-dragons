/**
 * The content gate, from the other side.
 *
 * `npm run content:validate` runs in CI against the one corpus this repo ships,
 * and it passes. That proves the corpus has not changed. It says nothing about
 * whether the validator would *catch* anything — a gate that has only ever been
 * shown a valid tree is indistinguishable from `exit 0`, and this one is 1031
 * lines of rules that no test had ever exercised.
 *
 * So every case here takes a copy of the real content, breaks exactly one
 * thing, and requires a specific complaint about that thing. Breaking real
 * content rather than authoring a fixture tree is deliberate: the baseline is
 * known-good (CI says so), so a failure can only come from the mutation, and
 * the rules are checked against the shapes actually in play rather than against
 * a minimal stub that drifts.
 *
 * The first test is the load-bearing one. If the untouched copy did not pass,
 * every assertion below would be satisfied by the copy being broken rather than
 * by the rule working — which is the exact failure mode this file exists to fix,
 * reappearing one level up.
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const VALIDATOR = join(REPO, "tools", "content", "validate.mjs");

const temps = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/**
 * A copy of the real tree: the content, the schemas that judge it, and the
 * asset manifest the biome check reads.
 */
function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), "kad-content-"));
  temps.push(dir);
  cpSync(join(REPO, "content"), join(dir, "content"), { recursive: true });
  cpSync(join(REPO, "schemas"), join(dir, "schemas"), { recursive: true });
  // The world map's painting is checked for presence, like the manifest.
  cpSync(join(REPO, "assets", "world"), join(dir, "assets", "world"), { recursive: true });
  cpSync(join(REPO, "assets", "manifest.json"), join(dir, "assets", "manifest.json"), {
    recursive: true,
  });
  return dir;
}

function readJson(dir, ...parts) {
  return JSON.parse(readFileSync(join(dir, ...parts), "utf8"));
}

function writeJson(dir, parts, value) {
  writeFileSync(join(dir, ...parts), JSON.stringify(value, null, 2));
}

/** Run the gate over `dir`. Never throws — the exit code is the result. */
function validate(dir) {
  try {
    const stdout = execFileSync(process.execPath, [VALIDATOR], {
      env: { ...process.env, KAD_CONTENT_ROOT: dir, NO_COLOR: "1" },
      encoding: "utf8",
    });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

/** The chapter every graph case below bends, and its file name. */
const CHAPTER = ["content", "chapters", "bramblewood-01.json"];

/** Break one thing in the chapter, then run the gate. */
function withChapter(mutate) {
  const dir = copyTree();
  const chapter = readJson(dir, ...CHAPTER);
  mutate(chapter);
  writeJson(dir, CHAPTER, chapter);
  return validate(dir);
}

/** The id of some scene that is not the entry — a safe thing to orphan. */
function laterSceneOf(chapter) {
  const id = Object.keys(chapter.scenes).find((s) => s !== chapter.entry);
  if (!id) throw new Error("fixture: the chapter has only an entry scene");
  return id;
}

// ---------------------------------------------------------------------------

describe("regional atlas content", () => {
  it.each([
    ["level ordering", (w) => { w.atlas.levels.reverse(); }, "increase in resolution"],
    ["native level", (w) => { w.atlas.levels.pop(); }, "native resolution level"],
    ["unknown route endpoint", (w) => { w.routes[0].connects[0] = "biome.nowhere"; }, "all endpoints must be mapped"],
    ["detail bounds", (w) => { w.atlas.patches[0].bounds.x = 900; }, "bounds inside the realm"],
    ["missing detail tile", (w) => { w.atlas.patches[0].tiles[0].src = "/assets/world/atlas/missing.webp"; }, "missing tile"],
  ])("rejects invalid %s", (_name, mutate, complaint) => {
    const dir = copyTree();
    const world = readJson(dir, "content", "world.json");
    mutate(world);
    writeJson(dir, ["content", "world.json"], world);
    const result = validate(dir);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain(complaint);
  });
  it.each([
    ["canonical identity", (r) => { r.placeId = "biome.sunward_fields"; }, "reference its canonical place"],
    ["realm bounds", (r) => { r.bounds.width = 1000; }, "outside the realm"],
    ["missing tile", (r) => { r.tiles[0].src = "/assets/world/atlas/missing.webp"; }, "missing tile"],
    ["gaps", (r) => { r.tiles[0].width -= 1; }, "without gaps"],
    ["overlaps", (r) => { r.tiles.push({ ...r.tiles[0] }); }, "tiles overlap"],
  ])("rejects invalid %s", (_name, mutate, complaint) => {
    const dir = copyTree();
    const world = readJson(dir, "content", "world.json");
    mutate(world.regions.enchanted_woods);
    writeJson(dir, ["content", "world.json"], world);
    const result = validate(dir);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain(complaint);
  });
});

describe("the harness itself", () => {
  it("passes an untouched copy of the real content", () => {
    /*
     * Without this, a copy that was subtly wrong — a missed directory, a
     * schema that did not come along — would make every case below pass for
     * the wrong reason, reporting a working gate on the strength of a broken
     * fixture.
     */
    const result = validate(copyTree());
    expect(result.out).toContain("PASS");
    expect(result.code).toBe(0);
  }, 15_000);

  it("fails the build with a non-zero exit, not just a printed complaint", () => {
    // CI reads the exit code and nothing else. A validator that describes
    // every problem beautifully and exits 0 is not a gate.
    const result = withChapter((chapter) => {
      chapter.entry = "no_such_scene";
    });
    expect(result.code).not.toBe(0);
  });
});

describe("the scene graph — the rules a schema cannot express", () => {
  it("catches an entry that names no scene", () => {
    const result = withChapter((chapter) => {
      chapter.entry = "no_such_scene";
    });
    expect(result.out).toContain('entry scene "no_such_scene" does not exist');
    expect(result.code).not.toBe(0);
  });

  it("catches a goto that points nowhere", () => {
    /*
     * The typo that ends a session: the party taps a choice and the engine
     * looks up a scene that was never authored. It has to fail the build,
     * never the play session (architecture §5).
     */
    const result = withChapter((chapter) => {
      const scene = chapter.scenes[chapter.entry];
      const choice = scene.choices?.[0];
      if (!choice) throw new Error("fixture: the entry scene has no choices");
      choice.goto = "definitely_not_a_scene";
    });
    expect(result.out).toContain('goto "definitely_not_a_scene" is not a scene in this chapter');
    expect(result.code).not.toBe(0);
  });

  it("catches a scene nothing leads to", () => {
    /*
     * An orphan is either a typo in a goto or content nobody will ever see,
     * and both are worth failing over — the second is a chapter that is
     * quietly shorter than it was written to be.
     */
    const result = withChapter((chapter) => {
      const orphan = laterSceneOf(chapter);
      for (const scene of Object.values(chapter.scenes)) {
        for (const choice of scene.choices ?? []) {
          if (choice.goto === orphan) choice.goto = chapter.entry;
        }
        if (scene.goto === orphan) scene.goto = chapter.entry;
        if (scene.onSuccess?.goto === orphan) scene.onSuccess.goto = chapter.entry;
        if (scene.onFailure?.goto === orphan) scene.onFailure.goto = chapter.entry;
        if (scene.onVictory?.goto === orphan) scene.onVictory.goto = chapter.entry;
        if (scene.onDefeat?.goto === orphan) scene.onDefeat.goto = chapter.entry;
      }
    });
    expect(result.out).toContain("unreachable from entry");
    expect(result.code).not.toBe(0);
  });

  it("catches endsCampaign on a scene that is not an ending", () => {
    // The campaign can only finish where the chapter does.
    const { code, out } = withChapter((chapter) => {
      chapter.scenes[chapter.entry].endsCampaign = true;
    });
    expect(code).toBe(1);
    expect(out).toMatch(/endsCampaign on a scene that is not an ending/);
  });

  it("catches a chapter whose id disagrees with its filename", () => {
    // The loader resolves chapters by filename, so this is a chapter that
    // cannot be started by the id the campaign uses to name it.
    const result = withChapter((chapter) => {
      chapter.id = "renamed-in-the-file-only";
    });
    expect(result.out).toContain("does not match filename");
    expect(result.code).not.toBe(0);
  });
});

describe("cross-file rules", () => {
  it("catches a grant of an item that is not in the catalog", () => {
    /*
     * Aimed at the rule rather than at the catalog. Deleting an entry from
     * items.json only breaks something if a chapter happens to reference that
     * entry, so the first cut of this test deleted an unreferenced item and
     * passed a perfectly valid tree — proving nothing. Renaming the *grant*
     * always trips the rule.
     */
    const result = withChapter((chapter) => {
      const grant = Object.values(chapter.scenes)
        .flatMap((scene) =>
          [scene.effects, scene.onSuccess?.effects, scene.onFailure?.effects,
           scene.onVictory?.effects, scene.onDefeat?.effects].flat(),
        )
        .find((effect) => effect?.type === "grantItem");
      if (!grant) throw new Error("fixture: no chapter scene grants an item");
      grant.itemId = "a_potion_nobody_wrote";
    });

    expect(result.out).toContain('item "a_potion_nobody_wrote" is not in content/items.json');
    expect(result.code).not.toBe(0);
  });

  it("catches a chapter set in a biome the art contract has never heard of", () => {
    // Content and art must not drift apart: the biome picks the tile sheet,
    // and an unknown one is a fight drawn on a flat colour.
    const result = withChapter((chapter) => {
      chapter.biome = "the_moon";
    });
    expect(result.out).toContain('biome "the_moon" is not in assets/manifest.json');
    expect(result.code).not.toBe(0);
  });

  it("catches a music override naming a track MUSIC_SPECS does not know", () => {
    // Music is chosen by name at a table; a track with no spec row is not one
    // the game can be asked for, so the override is refused, not left to the synth pad.
    const onChapter = withChapter((chapter) => {
      chapter.music = "a-track-nobody-produced";
    });
    expect(onChapter.out).toContain('music "a-track-nobody-produced" is not a MUSIC_SPECS track');
    expect(onChapter.code).not.toBe(0);

    const onScene = withChapter((chapter) => {
      chapter.scenes[laterSceneOf(chapter)].music = "a-track-nobody-produced";
    });
    expect(onScene.out).toContain('music "a-track-nobody-produced" is not a MUSIC_SPECS track');
    expect(onScene.code).not.toBe(0);
  });

  it("accepts music overrides that name real tracks", () => {
    const result = withChapter((chapter) => {
      chapter.music = "riftlight-finale";
      chapter.scenes[laterSceneOf(chapter)].music = "forest";
    });
    expect(result.out).not.toContain("MUSIC_SPECS");
    expect(result.code).toBe(0);
  });

  it("catches a campaign listing a chapter that does not exist", () => {
    const dir = copyTree();
    const campaign = readJson(dir, "content", "campaigns", "the-hollow-crown.json");
    campaign.chapters = [...campaign.chapters, "a-chapter-nobody-wrote"];
    writeJson(dir, ["content", "campaigns", "the-hollow-crown.json"], campaign);

    const result = validate(dir);
    expect(result.out).toContain("a-chapter-nobody-wrote");
    expect(result.code).not.toBe(0);
  });

  describe("campaign prerequisites (#221)", () => {
    const CROWN = ["content", "campaigns", "the-hollow-crown.json"];
    const GEMFALL = ["content", "campaigns", "gemfall.json"];

    it("passes a campaign that requires another, and still passes with none", () => {
      const dir = copyTree();
      const crown = readJson(dir, ...CROWN);
      crown.requires = ["gemfall"];
      writeJson(dir, CROWN, crown);
      const result = validate(dir);
      expect(result.out).toContain("PASS");
      expect(result.code).toBe(0);
    });

    it("catches a prerequisite naming a campaign that does not exist", () => {
      const dir = copyTree();
      const crown = readJson(dir, ...CROWN);
      crown.requires = ["gemfal"];
      writeJson(dir, CROWN, crown);

      const result = validate(dir);
      expect(result.out).toContain('requires campaign "gemfal", which does not exist');
      expect(result.code).not.toBe(0);
    });

    it("catches a prerequisite cycle", () => {
      const dir = copyTree();
      const crown = readJson(dir, ...CROWN);
      crown.requires = ["gemfall"];
      writeJson(dir, CROWN, crown);
      const gemfall = readJson(dir, ...GEMFALL);
      gemfall.requires = ["the-hollow-crown"];
      writeJson(dir, GEMFALL, gemfall);

      const result = validate(dir);
      expect(result.out).toContain("prerequisite cycle: gemfall -> the-hollow-crown -> gemfall");
      expect(result.code).not.toBe(0);
    });

    it("catches a campaign requiring itself, and a requires the schema refuses", () => {
      const self = copyTree();
      const crown = readJson(self, ...CROWN);
      crown.requires = ["the-hollow-crown"];
      writeJson(self, CROWN, crown);
      const selfResult = validate(self);
      expect(selfResult.out).toContain('campaign "the-hollow-crown" cannot require itself');
      expect(selfResult.code).not.toBe(0);

      const empty = copyTree();
      const bare = readJson(empty, ...CROWN);
      bare.requires = [];
      writeJson(empty, CROWN, bare);
      expect(validate(empty).code).not.toBe(0);
    });
  });

  it("catches a purse backfill keyed on a flag no attempt ever saves", () => {
    const dir = copyTree();
    const campaign = readJson(dir, "content", "campaigns", "gemfall.json");
    campaign.purseBackfill = { coins: 6, byFlag: { ember_sold: 15, a_chapter_only_flag: 3 } };
    writeJson(dir, ["content", "campaigns", "gemfall.json"], campaign);

    const result = validate(dir);
    expect(result.out).toContain('"a_chapter_only_flag" is not in any routeSets entry');
    expect(result.out).not.toContain('"ember_sold" is not in any');
    expect(result.code).not.toBe(0);
  });

  it("catches two maps claiming the same id", () => {
    const dir = copyTree();
    const map = readJson(dir, "content", "maps", "thicket.json");
    writeJson(dir, ["content", "maps", "thicket-copy.json"], map);

    const result = validate(dir);
    expect(result.out).toContain(`duplicate map id "${map.id}"`);
    expect(result.code).not.toBe(0);
  });
});

describe("the files themselves", () => {
  it("catches content that is not valid JSON at all", () => {
    // A half-saved file is the most ordinary way content breaks, and the one
    // where a stack trace instead of a message costs the most time.
    const dir = copyTree();
    writeFileSync(join(dir, "content", "rules.json"), "{ this is not json");

    const result = validate(dir);
    expect(result.out).toContain("not valid JSON");
    expect(result.code).not.toBe(0);
  });

  it("catches a missing rules.json rather than crashing on it", () => {
    const dir = copyTree();
    rmSync(join(dir, "content", "rules.json"));

    const result = validate(dir);
    expect(result.out).toContain("content/rules.json is missing");
    expect(result.code).not.toBe(0);
  });

  it("catches a schema violation, not only the hand-written rules", () => {
    /*
     * The two halves of the gate are independent: ajv judges shape, the
     * functions judge meaning. This one is shape — a required field given the
     * wrong type — and it has to fail before the cross-file rules ever run.
     */
    const result = withChapter((chapter) => {
      chapter.title = 42;
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("chapters/bramblewood-01.json");
  });
});

// ---------------------------------------------------------------------------

describe("routed beats", () => {
  const CAMPAIGN = ["content", "campaigns", "the-hollow-crown.json"];

  /**
   * A campaign whose beat 2 is a triple, built by cloning the reference
   * chapter three times. The scene graph is beside the point here — what is
   * under test is the arithmetic of beats, routes and sets.
   */
  function routedTree(mutate = () => {}) {
    const dir = copyTree();
    const base = readJson(dir, ...CHAPTER);
    const roads = [
      ["beat2-river", "route_river"],
      ["beat2-rush", "route_rush"],
      ["beat2-wild", "route_wild"],
    ];
    for (const [id, flag] of roads) {
      const variant = { ...structuredClone(base), id, index: 2, title: id, route: { set: "road", flag } };
      writeJson(dir, ["content", "chapters", `${id}.json`], variant);
    }
    const campaign = readJson(dir, ...CAMPAIGN);
    campaign.chapters = ["bramblewood-01", ...roads.map(([id]) => id)];
    campaign.routeSets = { road: roads.map(([, flag]) => flag) };
    mutate({ dir, campaign, roads });
    writeJson(dir, CAMPAIGN, campaign);
    return validate(dir);
  }

  it("accepts a beat that covers its route set", () => {
    const { code, out } = routedTree();
    expect(code, out).toBe(0);
    // The summary says the shape, so a routed campaign reads as routed.
    expect(out).toMatch(/2 beat\(s\), 1 routed/);
  });

  it("refuses a beat with a road missing", () => {
    /*
     * The failure this whole feature exists to prevent: author two roads of
     * three, and a party that took the third arrives at a beat with no
     * chapter in it — at a table, mid-evening, with no way forward.
     */
    const { code, out } = routedTree(({ dir, campaign }) => {
      rmSync(join(dir, "content", "chapters", "beat2-wild.json"));
      campaign.chapters = campaign.chapters.filter((id) => id !== "beat2-wild");
    });
    expect(code).toBe(1);
    expect(out).toMatch(/missing route\(s\) route_wild/);
    expect(out).toMatch(/no chapter to enter/);
  });

  it("refuses two chapters at one beat with no routes between them", () => {
    // The old duplicate-index bug in a new hat: nothing could ever choose one.
    const { code, out } = routedTree(({ dir, roads }) => {
      for (const [id] of roads) {
        const file = ["content", "chapters", `${id}.json`];
        const chapter = readJson(dir, ...file);
        delete chapter.route;
        writeJson(dir, file, chapter);
      }
    });
    expect(code).toBe(1);
    expect(out).toMatch(/and no routes; only a routed beat may share an index/);
  });

  it("refuses a beat that mixes routed and unrouted chapters", () => {
    const { code, out } = routedTree(({ dir }) => {
      const file = ["content", "chapters", "beat2-wild.json"];
      const chapter = readJson(dir, ...file);
      delete chapter.route;
      writeJson(dir, file, chapter);
    });
    expect(code).toBe(1);
    expect(out).toMatch(/mixes routed and unrouted/);
  });

  it("refuses a route the campaign never declared", () => {
    const { code, out } = routedTree(({ dir }) => {
      const file = ["content", "chapters", "beat2-wild.json"];
      const chapter = readJson(dir, ...file);
      chapter.route = { set: "road", flag: "route_sea" };
      writeJson(dir, file, chapter);
    });
    expect(code).toBe(1);
    expect(out).toMatch(/not in set "road"/);
  });

  it("refuses a beat drawn from two different sets", () => {
    // A beat is chosen along one axis: the road you took, or the pursuit you
    // are playing — never a mixture nothing could evaluate.
    const { code, out } = routedTree(({ dir, campaign }) => {
      campaign.routeSets.pursuit = ["pursuit_reckoning", "pursuit_collection"];
      const file = ["content", "chapters", "beat2-wild.json"];
      const chapter = readJson(dir, ...file);
      chapter.route = { set: "pursuit", flag: "pursuit_reckoning" };
      writeJson(dir, file, chapter);
    });
    expect(code).toBe(1);
    expect(out).toMatch(/more than one route set/);
  });

  /** Give beat2-river's entry scene one extra choice gated on `flag`. */
  function readsFlag(flag) {
    return ({ dir }) => {
      const file = ["content", "chapters", "beat2-river.json"];
      const chapter = readJson(dir, ...file);
      chapter.scenes[chapter.entry].choices.push({
        id: "remember",
        label: "Remember the road",
        icon: "map",
        goto: chapter.entry,
        requiresFlag: flag,
      });
      writeJson(dir, file, chapter);
    };
  }

  it("lets a chapter read a flag its campaign carries in from an earlier chapter", () => {
    // Route-set flags arrive seeded from the campaign attempt, so a later
    // chapter gating on one that it never sets itself is the design, not a typo.
    const { code, out } = routedTree(readsFlag("route_wild"));
    expect(code, out).toBe(0);
  });

  it("still refuses a flag that nothing sets and the campaign does not carry", () => {
    const { code, out } = routedTree(readsFlag("route_nowhere"));
    expect(code).toBe(1);
    expect(out).toMatch(/flag "route_nowhere" is never set/);
  });

  it("still refuses a gap in the beats themselves", () => {
    // Routing loosened index *uniqueness*, not contiguity: the player still
    // sees "Chapter 3 of 6".
    const { code, out } = routedTree(({ dir, roads }) => {
      for (const [id] of roads) {
        const file = ["content", "chapters", `${id}.json`];
        const chapter = readJson(dir, ...file);
        chapter.index = 4;
        writeJson(dir, file, chapter);
      }
    });
    expect(code).toBe(1);
    expect(out).toMatch(/out of sequence/);
  });
});

describe("Field Guide tags (`discovers`)", () => {
  const sceneOf = (chapter) => chapter.scenes[chapter.entry];

  it("accepts a real canon id on a scene", () => {
    const result = withChapter((chapter) => {
      sceneOf(chapter).discovers = ["creature.embermoth"];
    });
    expect(result.out).toContain("PASS");
    expect(result.code).toBe(0);
  });

  it("names chapter and scene when an id is not in the field guide", () => {
    const result = withChapter((chapter) => {
      sceneOf(chapter).discovers = ["creature.not_a_thing"];
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("bramblewood-01");
    expect(result.out).toContain("scene \"");
    expect(result.out).toContain("creature.not_a_thing");
    expect(result.out).toContain("not an entry of content/field-guide.json");
  });

  it("rejects a duplicate within one scene", () => {
    const result = withChapter((chapter) => {
      sceneOf(chapter).discovers = ["creature.embermoth", "creature.embermoth"];
    });
    expect(result.code).not.toBe(0);
    // The schema (uniqueItems) catches it first, naming the file and /scenes/<id>/discovers.
    expect(result.out).toContain("bramblewood-01");
    expect(result.out).toContain("/discovers");
    expect(result.out).toContain("duplicate items");
  });
});

describe("story cast (`cast`)", () => {
  const sceneOf = (chapter) => chapter.scenes[chapter.entry];

  it("accepts figures that resolve to art, read from this checkout even in a staged tree", () => {
    // copyTree() carries no PNGs; the figure check still finds them.
    const result = withChapter((chapter) => {
      sceneOf(chapter).cast = [
        { figure: "entities/selkie", name: "Professor Tidewell" },
        { figure: "characters/dragonling", name: "Grandmother Tull", size: "small" },
        { figure: "cast/deep-ice-figure", name: "Deep-ice figure", size: "very_large" },
      ];
    });
    expect(result.out).toContain("PASS");
    expect(result.code).toBe(0);
  });

  it("names chapter, scene and expected file when a figure has no art", () => {
    const result = withChapter((chapter) => {
      sceneOf(chapter).cast = [{ figure: "cast/nobody_drew_this" }];
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("bramblewood-01");
    expect(result.out).toContain('cast figure "cast/nobody_drew_this" has no art');
    expect(result.out).toContain("assets/cast/nobody_drew_this/assembled.png");
  });

  it("refuses a crowd: three at most, so the party keeps its stage", () => {
    const result = withChapter((chapter) => {
      sceneOf(chapter).cast = ["a", "b", "c", "d"].map((name) => ({ figure: "entities/sheeple", name }));
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("/cast");
  });

  it("refuses the same member twice", () => {
    const result = withChapter((chapter) => {
      sceneOf(chapter).cast = [{ figure: "entities/yeti" }, { figure: "entities/yeti" }];
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("the same cast member twice");
  });
});

// ---------------------------------------------------------------------------
// #160 - conditions, variants and tokens. A malformed `when` fails the build,
// never the play session.

describe("conditions, variants and tokens", { timeout: 30_000 }, () => {
  const entryOf = (chapter) => chapter.scenes[chapter.entry];
  const addChoice = (chapter, when) => {
    const scene = entryOf(chapter);
    const goto = scene.choices[0].goto;
    scene.choices.push({ id: "extra_when", label: "Extra", icon: "arrow", goto, when });
  };
  const withVariants = (variants, extra) =>
    withChapter((chapter) => {
      entryOf(chapter).variants = variants;
      extra?.(chapter);
    });

  it("accepts well-formed conditions, variants and tokens", () => {
    const result = withVariants(
      [
        { when: { count: { of: "facet_*", max: 0 } }, text: "Your packs are humming, {party}.", replace: true },
        { when: { count: { of: "facet_*", min: 1 } }, text: "{facets} great stones glow.", at: "start" },
        { when: { partySize: { max: 1 } }, text: "Alone, you steady yourself." },
      ],
      (chapter) => addChoice(chapter, { notItem: "facet_ember", partySize: { min: 1 } }),
    );
    expect(result.out).toContain("PASS");
    expect(result.code).toBe(0);
  }, 15_000);

  it("refuses a choice that spends or takes what it does not gate on", () => {
    const result = withChapter((chapter) => {
      const scene = entryOf(chapter);
      const goto = scene.choices[0].goto;
      scene.choices.push(
        { id: "pay", label: "Pay", icon: "coin", goto, effects: [{ type: "spendCoins", amount: 2 }] },
        { id: "give", label: "Give", icon: "cake", goto, effects: [{ type: "takeItem", itemId: "honeycake" }] },
        { id: "lose", label: "Lose", icon: "cake", goto, requiresItem: "honeycake", effects: [{ type: "takeItem", itemId: "no_such_item" }] },
      );
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("spends 2 coins but is not gated");
    expect(result.out).toContain('takes "honeycake" but is not gated');
    expect(result.out).toContain('item "no_such_item" is not in content/items.json');
  }, 15_000);

  it("refuses a check that charges coins behind an ungated choice", () => {
    const result = withChapter((chapter) => {
      const check = Object.values(chapter.scenes).find((scene) => scene.type === "check");
      check.onFailure.effects = [...(check.onFailure.effects ?? []), { type: "spendCoins", amount: 2 }];
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("which charges 2 coins, but is not gated on when.coins.min >= 2");
  }, 15_000);

  it("catches an unknown flag in when.flag", () => {
    const result = withChapter((chapter) => addChoice(chapter, { flag: "never_set_anywhere" }));
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('flag "never_set_anywhere" is never set');
  });

  it("catches an unknown flag in notFlag and in a variant", () => {
    const a = withChapter((chapter) => addChoice(chapter, { notFlag: "never_set_anywhere" }));
    expect(a.code).not.toBe(0);
    expect(a.out).toContain("never_set_anywhere");
    const b = withVariants([{ when: { flag: "typo_flag" }, text: "x" }]);
    expect(b.code).not.toBe(0);
    expect(b.out).toContain('flag "typo_flag" is never set');
  });

  it("allows a carried route-set flag in when and in notFlag", () => {
    const dir = copyTree();
    const chapter = readJson(dir, "content", "chapters", "gemfall-08.json");
    const scene = chapter.scenes[chapter.entry];
    scene.variants = [
      { when: { flag: "ember_kept" }, text: "You kept the Ember." },
      { when: { notFlag: "ember_kept" }, text: "You did not." },
    ];
    writeJson(dir, ["content", "chapters", "gemfall-08.json"], chapter);
    const result = validate(dir);
    expect(result.out).toContain("PASS");
    expect(result.code).toBe(0);
  }, 15_000);

  it("catches an unknown item in item and notItem", () => {
    const a = withChapter((chapter) => addChoice(chapter, { item: "no_such_item" }));
    expect(a.code).not.toBe(0);
    expect(a.out).toContain('item "no_such_item" is not in content/items.json');
    const b = withVariants([{ when: { notItem: "no_such_item" }, text: "x" }]);
    expect(b.code).not.toBe(0);
    expect(b.out).toContain('item "no_such_item" is not in content/items.json');
  });

  it("catches a count prefix that matches no item, and an unknown exact or listed id", () => {
    const prefix = withVariants([{ when: { count: { of: "zzz_*", min: 1 } }, text: "x" }]);
    expect(prefix.code).not.toBe(0);
    expect(prefix.out).toContain('prefix "zzz_*" matches no item');
    const exact = withVariants([{ when: { count: { of: "no_such_item", min: 1 } }, text: "x" }]);
    expect(exact.out).toContain('item "no_such_item" is not in content/items.json');
    const listed = withVariants([{ when: { count: { of: ["facet_ember", "no_such_item"], min: 1 } }, text: "x" }]);
    expect(listed.out).toContain('item "no_such_item" is not in content/items.json');
  });

  it("catches min above max", () => {
    const count = withVariants([{ when: { count: { of: "facet_*", min: 3, max: 1 } }, text: "x" }]);
    expect(count.code).not.toBe(0);
    expect(count.out).toContain("min 3 is above max 1");
    const size = withChapter((chapter) => addChoice(chapter, { partySize: { min: 4, max: 2 } }));
    expect(size.code).not.toBe(0);
    expect(size.out).toContain("min 4 is above max 2");
  });

  it("catches an unknown token in narration, variant text, a label and a check prompt", () => {
    const narration = withChapter((chapter) => {
      entryOf(chapter).narration += " {oops}";
    });
    expect(narration.code).not.toBe(0);
    expect(narration.out).toContain('unknown token "{oops}"');
    const variant = withVariants([{ when: {}, text: "Hello {nope}" }]);
    expect(variant.out).toContain('unknown token "{nope}"');
    const label = withChapter((chapter) => {
      entryOf(chapter).choices[0].label = "Go {bad}";
    });
    expect(label.out).toContain('unknown token "{bad}"');
    const prompt = withChapter((chapter) => {
      const check = Object.values(chapter.scenes).find((s) => s.type === "check");
      check.prompt = `${check.prompt} {worse}`;
    });
    expect(prompt.out).toContain('unknown token "{worse}"');
  });

  it("catches two replace variants that can overlap", () => {
    const result = withVariants([
      { when: { count: { of: "facet_*", max: 1 } }, text: "a", replace: true },
      { when: { count: { of: "facet_*", max: 2 } }, text: "b", replace: true },
    ]);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("can both match");
  });

  it("allows replace variants it can show are exclusive", () => {
    for (const variants of [
      [
        { when: { count: { of: "facet_*", max: 0 } }, text: "a", replace: true },
        { when: { count: { of: "facet_*", min: 1 } }, text: "b", replace: true },
      ],
      [
        { when: { partySize: { max: 1 } }, text: "a", replace: true },
        { when: { partySize: { min: 2 } }, text: "b", replace: true },
      ],
      [
        { when: { item: "facet_ember" }, text: "a", replace: true },
        { when: { notItem: "facet_ember" }, text: "b", replace: true },
      ],
    ]) {
      const result = withVariants(variants);
      expect(result.out).toContain("PASS");
    }
  }, 30_000);

  it("still demands one ungated choice: a scene whose every choice has a when is a dead end", () => {
    const result = withChapter((chapter) => {
      for (const choice of entryOf(chapter).choices) choice.when = { partySize: { min: 1 } };
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("every choice is gated");
  });

  it("rejects a malformed condition shape at the schema", () => {
    const result = withChapter((chapter) => addChoice(chapter, { flagg: "x" }));
    expect(result.code).not.toBe(0);
  });
});

describe("class-gated choices (#228)", { timeout: 30_000 }, () => {
  const entryOf = (chapter) => chapter.scenes[chapter.entry];
  const addClassChoice = (chapter, requiresClass) => {
    const scene = entryOf(chapter);
    scene.choices.push({ id: "read_light", label: "Read the light", icon: "star", goto: scene.choices[0].goto, requiresClass });
  };

  it("accepts a class, and a list of them, beside an ungated choice", () => {
    for (const requiresClass of ["starweaver", ["thornguard", "songkeeper"]]) {
      const result = withChapter((chapter) => addClassChoice(chapter, requiresClass));
      expect(result.code).toBe(0);
      expect(result.out).toContain("PASS");
    }
  });

  it("rejects a class the game does not have", () => {
    const result = withChapter((chapter) => addClassChoice(chapter, "wizard"));
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("requiresClass");
  });

  it("rejects an empty list", () => {
    const result = withChapter((chapter) => addClassChoice(chapter, []));
    expect(result.code).not.toBe(0);
  });

  it("fails a scene whose every choice needs a class, and names the fix", () => {
    const result = withChapter((chapter) => {
      for (const choice of entryOf(chapter).choices) choice.requiresClass = "starweaver";
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("CLASS_GATED_ONLY_EXIT");
    expect(result.out).toContain("add a choice no class is needed for");
  });

  it("still fails when a class gate is mixed with other gates on every choice", () => {
    const result = withChapter((chapter) => {
      const choices = entryOf(chapter).choices;
      choices[0].requiresClass = "starweaver";
      for (const choice of choices.slice(1)) choice.requiresFlag = "route_wild";
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("every choice is gated");
  });
});

// ---------------------------------------------------------------------------

describe("graph campaigns (#192)", { timeout: 30_000 }, () => {
  const CAMPAIGN = ["content", "campaigns", "the-hollow-crown.json"];

  /**
   * The reference campaign turned into a three-node graph — the clearing, a
   * side glade that returns to it, and an ending — by cloning the reference
   * chapter. Every chapter keeps index 1: in a graph campaign the index
   * routes nothing, and the beat arithmetic must not run.
   */
  function graphTree(mutate = () => {}) {
    const dir = copyTree();
    const base = readJson(dir, ...CHAPTER);
    for (const id of ["graph-glade", "graph-dawn"]) {
      writeJson(dir, ["content", "chapters", `${id}.json`], { ...structuredClone(base), id, title: id });
    }
    const campaign = readJson(dir, ...CAMPAIGN);
    campaign.chapters = ["bramblewood-01", "graph-glade", "graph-dawn"];
    campaign.graph = {
      version: 1,
      entry: "clearing",
      flags: ["lantern_lit"],
      nodes: {
        clearing: { chapter: "bramblewood-01", revisit: "pass" },
        glade: { chapter: "graph-glade" },
        dawn: { chapter: "graph-dawn", ending: { title: "Dawn" } },
      },
      edges: {
        "to-glade": { from: "clearing", to: "glade", kind: "sideways" },
        "glade-back": {
          from: "glade",
          to: "clearing",
          kind: "return",
          effects: [{ type: "setFlag", flag: "lantern_lit" }],
        },
        "to-dawn": { from: "clearing", to: "dawn", kind: "forward", when: { flag: "lantern_lit" } },
      },
    };
    mutate({ dir, campaign });
    writeJson(dir, CAMPAIGN, campaign);
    return validate(dir);
  }

  it("accepts a whole graph, and skips the beat rules it has no beats for", () => {
    const { code, out } = graphTree();
    expect(code, out).toBe(0);
    expect(out).toMatch(/graph v1: 3 node\(s\), 3 edge\(s\), 1 ending\(s\)/);
    expect(out).not.toMatch(/out of sequence|only a routed beat may share an index/);
  });

  it("refuses a rift action way that needs an item the catalog does not have (#199)", () => {
    const { code, out } = graphTree(({ campaign }) => {
      campaign.graph.edges["to-dawn"].rift = {
        opensWhen: { flag: "lantern_lit" },
        actions: { open: [{ id: "glow", requires: { anyItem: ["mosslight_jar", "moonlight_jar"] } }] },
      };
    });
    expect(code).toBe(1);
    expect(out).toContain("/graph/edges/to-dawn/rift/actions/open/0/requires/anyItem/1");
    expect(out).toContain('item "moonlight_jar" is not in content/items.json');
    expect(out).not.toContain('item "mosslight_jar"');
  });

  it("refuses a map only a party with the right hero can finish (#199)", () => {
    const { code, out } = graphTree(({ campaign }) => {
      campaign.graph.edges["to-dawn"].rift = {
        opensWhen: { visited: "dawn" },
        actions: { open: { requires: { anyClass: ["starweaver"] }, label: "Read the stars" } },
      };
    });
    expect(code).toBe(1);
    expect(out).toMatch(/CLASS_GATED_ONLY_PATH: a party without the right hero/);
  });

  it("refuses a dangling name in the declaration, at its path", () => {
    const { code, out } = graphTree(({ campaign }) => {
      campaign.graph.edges["to-dawn"].to = "dusk";
    });
    expect(code).toBe(1);
    expect(out).toContain("/graph/edges/to-dawn/to");
    expect(out).toContain('no node "dusk"');
  });

  it("refuses a listed chapter no node plays", () => {
    const { code, out } = graphTree(({ campaign }) => {
      campaign.graph.nodes.glade.chapter = "graph-dawn";
    });
    expect(code).toBe(1);
    expect(out).toMatch(/chapter "graph-glade" is listed but no graph node plays it/);
  });

  it("refuses a chapter that still claims a routed beat", () => {
    const { code, out } = graphTree(({ dir, campaign }) => {
      campaign.routeSets = { road: ["route_river", "route_wild"] };
      const file = ["content", "chapters", "graph-glade.json"];
      writeJson(dir, file, { ...readJson(dir, ...file), route: { set: "road", flag: "route_river" } });
    });
    expect(code).toBe(1);
    expect(out).toMatch(/declares a route, but a graph campaign chooses its chapters by edge/);
  });

  it("refuses a graph version the schema does not know", () => {
    const { code, out } = graphTree(({ campaign }) => {
      campaign.graph.version = 2;
    });
    expect(code).toBe(1);
    expect(out).toContain("the-hollow-crown.json");
  });

  it("lets a chapter read a journey flag the graph declares, as it may a carried route flag", () => {
    const { code, out } = graphTree(({ dir }) => {
      const file = ["content", "chapters", "graph-dawn.json"];
      const chapter = readJson(dir, ...file);
      chapter.scenes[chapter.entry].choices.push({
        id: "remember",
        label: "Remember the lantern",
        icon: "map",
        goto: chapter.entry,
        requiresFlag: "lantern_lit",
      });
      writeJson(dir, file, chapter);
    });
    expect(code, out).toBe(0);
  });
});

describe("graph campaigns are walked, not just resolved (#193)", { timeout: 30_000 }, () => {
  const CAMPAIGN = ["content", "campaigns", "the-hollow-crown.json"];

  /**
   * A small cyclic graph over cloned chapters: the clearing (a hub, played once
   * then passed through), a glade that returns to it, and the dawn ending the
   * clearing opens once the glade has lit the lantern. Valid as written.
   */
  function walkTree(mutate = () => {}, rawEdit = (text) => text) {
    const dir = copyTree();
    const base = readJson(dir, ...CHAPTER);
    for (const id of ["graph-glade", "graph-dawn"]) {
      writeJson(dir, ["content", "chapters", `${id}.json`], { ...structuredClone(base), id, title: id });
    }
    const campaign = readJson(dir, ...CAMPAIGN);
    campaign.chapters = ["bramblewood-01", "graph-glade", "graph-dawn"];
    campaign.graph = {
      version: 1,
      entry: "clearing",
      flags: ["lantern_lit"],
      nodes: {
        clearing: { chapter: "bramblewood-01", revisit: "pass" },
        glade: { chapter: "graph-glade" },
        dawn: { chapter: "graph-dawn", ending: { title: "Dawn" } },
      },
      edges: {
        "to-glade": { from: "clearing", to: "glade", kind: "sideways" },
        "glade-back": { from: "glade", to: "clearing", kind: "return", effects: [{ type: "setFlag", flag: "lantern_lit" }] },
        "to-dawn": { from: "clearing", to: "dawn", kind: "forward", when: { flag: "lantern_lit" } },
      },
    };
    mutate(campaign);
    writeJson(dir, CAMPAIGN, campaign);
    const file = join(dir, ...CAMPAIGN);
    writeFileSync(file, rawEdit(readFileSync(file, "utf8")));
    return validate(dir);
  }

  it("accepts a cyclic graph, and says it walked it", () => {
    const { code, out } = walkTree();
    expect(code, out).toBe(0);
    expect(out).toMatch(/graph v1: 3 node\(s\), 3 edge\(s\), 1 ending\(s\), walked \d+ state\(s\)/);
  });

  it("rejects a node nothing leads to, with the path and a fix", () => {
    const { code, out } = walkTree((campaign) => {
      campaign.graph.edges["to-dawn"].from = "glade";
      campaign.graph.edges["to-dawn"].kind = "forward";
      delete campaign.graph.edges["glade-back"];
      campaign.graph.nodes.island = { chapter: "bramblewood-01" };
    });
    expect(code).toBe(1);
    expect(out).toContain("/graph/nodes/island");
    expect(out).toContain("UNREACHABLE_NODE");
    expect(out).toMatch(/Add an edge from a node the party can reach/);
  });

  it("rejects a place the party can walk into and never leave", () => {
    const { code, out } = walkTree((campaign) => {
      delete campaign.graph.edges["glade-back"];
      campaign.graph.edges["to-dawn"].when = undefined;
    });
    expect(code).toBe(1);
    expect(out).toContain("/graph/nodes/glade");
    expect(out).toContain("DEAD_END");
  });

  it("rejects a loop with no return edge, and names the edge to mark", () => {
    const { code, out } = walkTree((campaign) => {
      campaign.graph.edges["glade-back"].kind = "forward";
    });
    expect(code).toBe(1);
    expect(out).toContain("UNINTENTIONAL_CYCLE");
    expect(out).toContain("/graph/edges/glade-back");
    expect(out).toContain('"kind": "return"');
  });

  it("rejects a party that can be stranded, showing how they got there", () => {
    const { code, out } = walkTree((campaign) => {
      // The glade can be entered once, and the way to the dawn is shut to a
      // party that has not lit the lantern - which the glade does only on a
      // success the party might not have. Outcome decides it.
      campaign.graph.edges["glade-back"].when = { outcome: "success" };
    });
    expect(code).toBe(1);
    expect(out).toContain("STRANDED");
    expect(out).toContain('-[to-glade]-> "glade" (setback)');
  });

  it("rejects an irreversible claim the graph disproves", () => {
    const { code, out } = walkTree((campaign) => {
      campaign.graph.edges["to-glade"].irreversible = true;
    });
    expect(code).toBe(1);
    expect(out).toContain("IRREVERSIBLE_NOT");
    expect(out).toContain("/graph/edges/to-glade");
  });

  it("rejects a locked edge that nothing unlocks", () => {
    const { code, out } = walkTree((campaign) => {
      campaign.graph.edges["to-glade"].locked = true;
    });
    expect(code).toBe(1);
    expect(out).toContain("LOCKED_EDGE_NEVER_UNLOCKED");
  });

  it("rejects an id declared twice, which JSON would silently merge", () => {
    const { code, out } = walkTree(undefined, (text) =>
      text.replace('"glade": {', '"glade": {"chapter": "graph-dawn"},\n        "glade": {'),
    );
    expect(code).toBe(1);
    expect(out).toContain("/graph/nodes/glade");
    expect(out).toMatch(/appears twice in the same object/);
  });

  it("only warns, and still passes, about a guard no chapter or edge can ever satisfy", () => {
    const { code, out } = walkTree((campaign) => {
      campaign.graph.flags.push("never_set");
      campaign.graph.edges["to-dawn-late"] = {
        from: "clearing",
        to: "dawn",
        kind: "forward",
        when: { flag: "never_set" },
      };
    });
    expect(code, out).toBe(0);
    expect(out).toContain("GUARD_FLAG_NEVER_SET");
  });

  it("leaves the ordered campaigns' output exactly as it was", () => {
    const result = validate(REPO);
    expect(result.code, result.out).toBe(0);
    expect(result.out).toMatch(/gemfall\.json {2}campaign/);
    expect(result.out).not.toMatch(/graph v\d|walked \d+ state|UNREACHABLE_NODE|STRANDED/);
  });
});
