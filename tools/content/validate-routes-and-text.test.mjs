/** Part 2 of the content gate suite; see validate-core.test.mjs. */
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, CHAPTER, copyTree, readJson, writeJson, validate, withChapter, withFirstSteps } from "./validate-harness.mjs";

// Every negative case copies the content tree; removing them all is real disk work.
afterAll(cleanup, 60_000);


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

  it("rejects unknown presentation props, stale scene keys, wrong tracking counts, and option icon typos", () => {
    const result = withFirstSteps((chapter) => {
      chapter.presentation.interactions.interaction_roots.props = ["unknown-prop"];
      chapter.presentation.interactions.misspelled_scene = { props: ["rope-loop"] };
      chapter.presentation.interactions.interaction_cups = { props: [], coverIcons: ["snow-mound", "wind-bells"] };
      chapter.scenes.interaction_stones.interaction.options[0].icon = "starr";
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('problem: unknown story prop id "unknown-prop"');
    expect(result.out).toContain("does not name an interaction scene");
    expect(result.out).toContain("has 2 icons for 3 covers");
    expect(result.out).toContain('problem: unknown icon id "starr"');
  });

  it("accepts flags earned only by the untimed helping hand", () => {
    const result = withFirstSteps((chapter) => {
      const scene = chapter.scenes.interaction_roots;
      scene.onAssisted.effects = [{ type: "setFlag", flag: "roots_helped", value: true }];
      chapter.scenes[scene.onAssisted.goto].variants = [
        { when: { flag: "roots_helped" }, text: "You remember the helping hand." },
      ];
    });
    expect(result.code, result.out).toBe(0);
  });

  it("checks item effects on assisted interaction branches", () => {
    const result = withFirstSteps((chapter) => {
      chapter.scenes.interaction_roots.onAssisted.effects = [
        { type: "grantItem", itemId: "missing_assisted_item", to: "party" },
      ];
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('item "missing_assisted_item" is not in content/items.json');
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
    // A campaign that carries flags has a "Last time" line for each (#357).
    campaign.lastTime = { opener: "Off we go.", lines: Object.fromEntries(roads.map(([, flag]) => [flag, `You took the ${flag} road.`])) };
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