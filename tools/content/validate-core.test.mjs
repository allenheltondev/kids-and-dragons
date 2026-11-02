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


import { afterAll, describe, expect, it } from "vitest";
import { cleanup, copyTree, readJson, writeJson, validate, withChapter, laterSceneOf } from "./validate-harness.mjs";

// Every negative case copies the content tree; removing them all is real disk work.
afterAll(cleanup, 60_000);


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

  // Music is chosen by name at a table; a track with no spec row is not one
  // the game can be asked for, so the override is refused, not left to the synth pad.
  // A chapter's and a scene's are separate cases so two full-tree runs do not
  // share one five-second CI timeout (it timed out on #571's runners).
  it("catches a chapter's music override naming a track MUSIC_SPECS does not know", () => {
    const onChapter = withChapter((chapter) => {
      chapter.music = "a-track-nobody-produced";
    });
    expect(onChapter.out).toContain('music "a-track-nobody-produced" is not a MUSIC_SPECS track');
    expect(onChapter.code).not.toBe(0);
  });

  it("catches a scene's music override naming a track MUSIC_SPECS does not know", () => {
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

    it("catches a campaign requiring itself", () => {
      const self = copyTree();
      const crown = readJson(self, ...CROWN);
      crown.requires = ["the-hollow-crown"];
      writeJson(self, CROWN, crown);
      const selfResult = validate(self);
      expect(selfResult.out).toContain('campaign "the-hollow-crown" cannot require itself');
      expect(selfResult.code).not.toBe(0);
    });

    it("catches an empty prerequisite list the schema refuses", () => {
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

describe("the chapter's goal (#356)", () => {
  it("catches a chapter with no goal", () => {
    const result = withChapter((chapter) => { delete chapter.goal; });
    expect(result.out).toContain("chapter has no goal");
    expect(result.code).not.toBe(0);
  });

  it("catches a step watching a flag nothing sets", () => {
    const result = withChapter((chapter) => { chapter.goal.steps[0].flag = "a_flag_nobody_sets"; });
    expect(result.out).toContain('flag "a_flag_nobody_sets" is never set to true by any effect in this chapter, so this step can never tick');
    expect(result.code).not.toBe(0);
  });

  it("catches a step some road to a success ending never ticks", () => {
    const result = withChapter((chapter) => {
      // An objective's flag: set on an optional choice, so a party can finish without it.
      chapter.goal.steps[0].flag = chapter.objectives[0].flag;
    });
    expect(result.out).toMatch(/step "[a-z_]+" is not on the spine: some path reaches the success ending "[a-z_]+" without setting its flag/);
    expect(result.code).not.toBe(0);
  });

  it("keeps a many-flag step on the spine when one of its flags is cleared and another is surely set", () => {
    // The hedge step watches either flag; clearing the wood's flag at the mossbank (nothing sets it
    // again), after the hedge flag is surely set, leaves it ticked at the table, so the gate must not
    // refuse it either.
    const result = withChapter((chapter) => {
      chapter.goal.steps[0].flag = ["got_past_the_hedge", "crossed_the_wood"];
      // The wood's own step watches that flag alone, so it is set aside: this is about the hedge step.
      chapter.goal.steps[1].optional = true;
      const rest = chapter.scenes.rest_mossbank;
      rest.onEnter = [...(rest.onEnter ?? []), { type: "setFlag", flag: "crossed_the_wood", value: false }];
    });
    expect(result.out).not.toContain("is not on the spine");
    expect(result.code).toBe(0);
  });

  it("lets an optional step sit off the spine", () => {
    const result = withChapter((chapter) => {
      chapter.goal.steps[0].flag = chapter.objectives[0].flag;
      chapter.goal.steps[0].optional = true;
    });
    expect(result.out).not.toContain("is not on the spine");
    expect(result.code).toBe(0);
  });

  it("catches a step watching a route-set flag, which can arrive already set", () => {
    const dir = copyTree();
    const parts = ["content", "chapters", "gemfall-03a.json"];
    const chapter = readJson(dir, ...parts);
    chapter.goal.steps[0].flag = "route_river";
    writeJson(dir, parts, chapter);
    const result = validate(dir);
    expect(result.out).toContain('flag "route_river" is a route-set member');
    expect(result.code).not.toBe(0);
  });

  it("catches a goal of more than one sentence", () => {
    expect(withChapter((chapter) => { chapter.goal.text = "Find the door. Then open it."; }).out).toContain("the goal is more than one sentence");
  });

  it("catches a goal with an em dash", () => {
    expect(withChapter((chapter) => { chapter.goal.steps[1].label = "Find it \u2014 fast"; }).out).toContain("the goal has an em dash");
  });

  it("lets a step watch one of the chapter's own quest items, and refuses any other item", () => {
    const dir = copyTree();
    const parts = ["content", "chapters", "gemfall-07l.json"];
    const chapter = readJson(dir, ...parts);
    const step = chapter.goal.steps.find((s) => s.item);
    step.item = "honeycake";
    writeJson(dir, parts, chapter);
    const result = validate(dir);
    expect(result.out).toContain('item "honeycake" is not one of this chapter\'s props');
    expect(result.code).not.toBe(0);
  });

  it("catches a step that watches a flag and an item at once", () => {
    const result = withChapter((chapter) => { chapter.goal.steps[0].item = "rusted_key"; });
    expect(result.out).toContain("must watch a flag or an item, and not both");
    expect(result.code).not.toBe(0);
  });

  it("catches two steps with one id", () => {
    const result = withChapter((chapter) => { chapter.goal.steps[1].id = chapter.goal.steps[0].id; });
    expect(result.out).toContain("duplicate goal step id");
    expect(result.code).not.toBe(0);
  });
});