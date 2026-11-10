/** Part 3 of the content gate suite; see validate-core.test.mjs. */
import { describe, expect, it } from "vitest";
import { CHAPTER, copyTree, readJson, readText, removeFile, writeJson, writeText, validate, withChapter } from "./validate-harness.ts";



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

describe("class places (#311)", { timeout: 30_000 }, () => {
  const sceneOfType = (chapter, type) => Object.keys(chapter.scenes).find((id) => chapter.scenes[id].type === type);

  it("accepts a story scene that teaches a class", () => {
    const result = withChapter((chapter) => {
      chapter.scenes[chapter.entry].classPlace = "starweaver";
    });
    expect(result.code).toBe(0);
    expect(result.out).toContain("PASS");
  });

  it("rejects a class the game does not have", () => {
    const result = withChapter((chapter) => {
      chapter.scenes[chapter.entry].classPlace = "wizard";
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("classPlace");
  });

  it.each(["check", "rest", "encounter"])("rejects a class place on a %s scene", (type) => {
    let id;
    const result = withChapter((chapter) => {
      id = sceneOfType(chapter, type);
      chapter.scenes[id].classPlace = "thornguard";
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain(`/scenes/${id}`);
    expect(result.out).toContain("classPlace");
  });

  it("rejects a class place that ends the chapter", () => {
    const result = withChapter((chapter) => {
      chapter.scenes.room_that_ends = { type: "story", narration: "The crows nod.", classPlace: "duskrunner", choices: [] };
      const entry = chapter.scenes[chapter.entry];
      entry.choices.push({ id: "to_room", label: "Go up", icon: "door", goto: "room_that_ends" });
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("a class place cannot end the chapter");
  });

  it("rejects a class place in Gemfall, which is pinned", () => {
    const dir = copyTree();
    const GEMFALL_01 = ["content", "chapters", "gemfall-01.json"];
    const chapter = readJson(dir, ...GEMFALL_01);
    const id = Object.keys(chapter.scenes).find((s) => chapter.scenes[s].type === "story" && chapter.scenes[s].choices.length > 0);
    chapter.scenes[id].classPlace = "songkeeper";
    writeJson(dir, GEMFALL_01, chapter);
    const result = validate(dir);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("Gemfall has no class places");
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
    // A new graph, so a new proof, written as an author would (content:proofs).
    return validate(dir, ["--write-proofs"]);
  }

  it("refuses a graph campaign with no proof, or a stale one, so the server never walks at start", () => {
    // The small graph above, not Riftlight: an untrusted proof means a walk,
    // and Riftlight's takes seconds.
    let dir = "";
    const written = graphTree(({ dir: d }) => {
      dir = d;
    });
    expect(written.code, written.out).toBe(0);
    expect(written.out).toMatch(/proof written/);
    const proofFile = ["content", "graph-proofs", "the-hollow-crown.json"];

    const proof = readJson(dir, ...proofFile);
    writeJson(dir, proofFile, { ...proof, fingerprint: "0".repeat(32) });
    const stale = validate(dir);
    expect(stale.code, stale.out).not.toBe(0);
    expect(stale.out).toMatch(/the graph proof is stale/);
    expect(stale.out).toMatch(/npm run content:proofs/);

    removeFile(dir, ...proofFile);
    const none = validate(dir);
    expect(none.code, none.out).not.toBe(0);
    expect(none.out).toMatch(/no graph proof .*graph-proofs\/the-hollow-crown\.json/);

    // And Riftlight's shipped proof was trusted throughout, not walked.
    expect(none.out).toMatch(/riftlight\.json {2}campaign .*proven/);
  });

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
    writeText(dir, CAMPAIGN, rawEdit(readText(dir, ...CAMPAIGN)));
    return validate(dir, ["--write-proofs"]);
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
    const result = validate(copyTree());
    expect(result.code, result.out).toBe(0);
    expect(result.out).toMatch(/gemfall\.json {2}campaign/);
    // Riftlight is the shipped graph campaign; every other line reads as before.
    const ordered = result.out.split("\n").filter((line) => !line.includes("riftlight")).join("\n");
    expect(ordered).not.toMatch(/graph v\d|walked \d+ state|UNREACHABLE_NODE|STRANDED/);
  });
});

describe("class deeds (#310, docs/class-mastery.md §6)", () => {
  function withRules(mutate) {
    const dir = copyTree();
    const rules = readJson(dir, "content", "rules.json");
    mutate(rules);
    writeJson(dir, ["content", "rules.json"], rules);
    return validate(dir);
  }

  it("rejects a rank that asks for another class's deed, which nobody wearing it could do", () => {
    const result = withRules((r) => {
      r.classes.songkeeper.deeds.apprentice.withFriends = { shove: 3 };
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('"shove" can only be done by a thornguard');
  });

  it("rejects a Master track without a story deed", () => {
    const result = withRules((r) => {
      delete r.classes.duskrunner.deeds.master.withFriends.class_story;
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("Master includes a story deed");
  });

  // Each validation copies and checks the full content tree. Keep the cases
  // separate so two subprocess runs do not share one five-second CI timeout.
  it("rejects a deed the game does not count", () => {
    const result = withRules((r) => { r.classes.starweaver.deeds.apprentice.withFriends = { stare_hard: 2 }; });
    expect(result.code, result.out).not.toBe(0);
  });

  it("rejects a class with no ladder", () => {
    const result = withRules((r) => { delete r.classes.thornguard.deeds; });
    expect(result.code, result.out).not.toBe(0);
  });
});