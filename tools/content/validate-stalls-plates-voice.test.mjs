/** Part 4 of the content gate suite; see validate-core.test.mjs. */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sourceHash } from "../voice/script.ts";
import { cleanup, CHAPTER, copyTree, readJson, writeJson, validate } from "./validate-harness.mjs";

// Every negative case copies the content tree; removing them all is real disk work.
afterAll(cleanup, 60_000);


// ---------------------------------------------------------------------------

describe("the fitting stall (#312)", { timeout: 30_000 }, () => {
  const RULES = ["content", "rules.json"];
  /** The shipped tree with rules.json's stall changed by `mutate`. */
  const withStall = (mutate) => {
    const dir = copyTree();
    const rules = readJson(dir, ...RULES);
    mutate(rules.fittingStall, dir);
    writeJson(dir, RULES, rules);
    return validate(dir);
  };

  it("passes where it ships: Gemfall's opening scene at the Exchange", () => {
    const result = withStall(() => {});
    expect(result.code).toBe(0);
    expect(result.out).toContain("fitting stall (1 stand)");
  });

  it.each([
    ["a chapter that is not there", { chapterId: "gemfall-99", sceneId: "scene_prologue_city" }, 'no chapter "gemfall-99"'],
    ["a scene that is not there", { chapterId: "gemfall-01", sceneId: "nowhere" }, 'has no scene "nowhere"'],
    ["a chapter that does not open its campaign", { chapterId: "gemfall-02", sceneId: null }, "is chapter 2 of its campaign"],
  ])("rejects %s", (_label, stand, problem) => {
    const result = withStall((stall, dir) => {
      const sceneId = stand.sceneId ?? readJson(dir, "content", "chapters", `${stand.chapterId}.json`).entry;
      stall.stands = [{ chapterId: stand.chapterId, sceneId }];
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain(problem);
  });

  it("rejects a scene a party could never answer in: a check, or an ending", () => {
    const chapter = readJson(copyTree(), "content", "chapters", "gemfall-01.json");
    const check = Object.keys(chapter.scenes).find((id) => chapter.scenes[id].type === "check");
    const ending = Object.keys(chapter.scenes).find((id) => chapter.scenes[id].choices?.length === 0);
    const result = withStall((stall) => {
      stall.stands = [
        { chapterId: "gemfall-01", sceneId: check },
        { chapterId: "gemfall-01", sceneId: ending },
      ];
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain(`"${check}" is a check scene`);
    expect(result.out).toContain(`"${ending}" ends the chapter`);
  });

  it("rejects a scene whose way on is a decision the wait would hold: more than one choice", () => {
    // scene_prologue_party is the vote right after the stall's scene.
    const result = withStall((stall) => {
      stall.stands = [{ chapterId: "gemfall-01", sceneId: "scene_prologue_party" }];
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("the stall's wait would hold a decision");
  });

  it.each([
    ["requiresFlag", "night_fishing"],
    ["requiresClass", "starweaver"],
    ["requiresSpecies", "unicorn"],
  ])("rejects a scene whose one choice is gated (%s)", (key, value) => {
    const dir = copyTree();
    const GEMFALL_01 = ["content", "chapters", "gemfall-01.json"];
    const chapter = readJson(dir, ...GEMFALL_01);
    chapter.scenes.scene_prologue_city.choices[0][key] = value;
    writeJson(dir, GEMFALL_01, chapter);
    const result = validate(dir);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain(`choice "prologue_to_party" is gated (${key})`);
  });

  it("rejects an em dash in its words, which Gemfall's screen shows", () => {
    const result = withStall((stall) => {
      stall.narration = "Madame Tuck — the tailor.";
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("has an em dash");
  });

  it("rejects a stall with no keeper, through the schema", () => {
    const result = withStall((stall) => {
      delete stall.keeper;
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("keeper");
  });
});

describe("story plates (docs/story-plates.md)", () => {
  const RIFTLIGHT = ["content", "campaigns", "riftlight.json"];
  const OPENING = ["content", "chapters", "riftlight-exchange-rift.json"];
  const FINALE = ["content", "chapters", "riftlight-finale.json"];

  /** Break one thing in Riftlight's campaign file or a chapter's, then run the gate. */
  function breaking(parts, mutate) {
    const dir = copyTree();
    const file = readJson(dir, ...parts);
    mutate(file);
    writeJson(dir, parts, file);
    return validate(dir);
  }

  it("passes the real prologue and chapter plates", () => {
    const result = validate(copyTree());
    expect(result.out).not.toContain("plate");
    expect(result.code).toBe(0);
  });

  it("catches a plate that says too much", () => {
    const result = breaking(RIFTLIGHT, (c) => {
      c.prologue.plates[0].narration = Array(60).fill("snow").join(" ");
    });
    expect(result.out).toContain("/prologue/plates/0/narration");
    expect(result.out).toContain("a plate says at most");
    expect(result.code).not.toBe(0);
  });

  // Each case runs the full-tree validator once, with its own CI timeout.
  it("catches a plate that counts the party", () => {
    const counted = breaking(RIFTLIGHT, (c) => {
      c.prologue.plates[1].narration = "All three of you hear the bell.";
    });
    expect(counted.out).toContain("counts the party");
    expect(counted.code, counted.out).not.toBe(0);
  });

  it("catches a plate that leaves a token", () => {
    const token = breaking(FINALE, (c) => {
      c.plate.narration = "Welcome back, {party}.";
    });
    expect(token.out).toContain("has a {token}");
    expect(token.code, token.out).not.toBe(0);
  });

  it("catches a prologue of two plates", () => {
    const short = breaking(RIFTLIGHT, (c) => {
      c.prologue.plates.length = 2;
    });
    expect(short.out).toContain("/prologue");
    expect(short.code).not.toBe(0);
  });

  it("catches a painting in another campaign's folder", () => {
    const strayed = breaking(FINALE, (c) => {
      c.plate.art = "plates/gemfall/finale";
    });
    expect(strayed.out).toContain("is not under plates/riftlight/");
    expect(strayed.code, strayed.out).not.toBe(0);
  });

  it("catches a painting used twice", () => {
    const result = breaking(FINALE, (c) => {
      c.plate.art = "plates/riftlight/prologue-1";
    });
    expect(result.out).toContain("is already used at /prologue/plates/0");
  });

  it("catches a plate on the opening chapter, which has the prologue", () => {
    const result = breaking(OPENING, (c) => {
      c.plate = { art: "plates/riftlight/exchange-rift", narration: "A busy quay." };
    });
    expect(result.out).toContain("takes no plate of its own");
    expect(result.code).not.toBe(0);
  });
});

describe("matchups (docs/matchups.md)", () => {
  const RULES = ["content", "rules.json"];
  function withRules(mutate, mutateChapter) {
    const dir = copyTree();
    const rules = readJson(dir, ...RULES);
    mutate(rules.matchups, rules);
    writeJson(dir, RULES, rules);
    if (mutateChapter) {
      const chapter = readJson(dir, ...CHAPTER);
      mutateChapter(chapter);
      writeJson(dir, CHAPTER, chapter);
    }
    return validate(dir);
  }
  const firstOf = (chapter, type) => Object.values(chapter.scenes).find((s) => s.type === type);

  it("catches an edge naming an unknown trait, tag or ability, and an edge that does nothing", () => {
    const result = withRules((m) => {
      m.traits.thorny ??= { name: "Thorny", icon: "thorn", text: "Spiky.", hint: "Thorny: hit hard" };
      m.checkTags.sneak ??= { name: "Sneak", text: "Quiet." };
      m.edges.push(
        { id: "t_bad_trait", hero: {}, on: "attack", foe: "made_up_trait", roll: 1, text: "x" },
        { id: "t_bad_tag", hero: {}, on: "check", tag: "made_up_tag", roll: 1, text: "x" },
        { id: "t_bad_ability", hero: {}, on: "attack", foe: "thorny", ability: "made_up_ability", roll: 1, text: "x" },
        { id: "t_nothing", hero: {}, on: "attack", foe: "thorny", text: "x" },
      );
    });
    expect(result.out).toContain('"made_up_trait" is not a trait in rules.matchups.traits');
    expect(result.out).toContain('"made_up_tag" is not a check tag in rules.matchups.checkTags');
    expect(result.out).toContain('"made_up_ability" is not an ability in content/abilities.json');
    expect(result.out).toContain('edge "t_nothing" has no effect');
    expect(result.code).not.toBe(0);
  });

  it("catches an attack edge on a move that never rolls an attack", () => {
    const result = withRules((m) => {
      m.traits.hulking ??= { name: "Hulking", icon: "fist", text: "Big.", hint: "Hulking: stand firm" };
      m.edges.push(
        // Shove pushes and Tanglelight roots: neither has an attack effect.
        { id: "t_shove", hero: {}, on: "attack", foe: "hulking", ability: "shove", roll: 1, text: "x" },
        { id: "t_tangle", hero: {}, on: "attack", foe: "hulking", ability: ["burst", "tanglelight"], roll: 1, text: "x" },
        // Burst does roll one, so this is fine.
        { id: "t_burst", hero: {}, on: "attack", foe: "hulking", ability: "burst", roll: 1, text: "x" },
      );
    });
    expect(result.out).toContain('attack edge "t_shove" names "shove", which never rolls an attack');
    expect(result.out).toContain('attack edge "t_tangle" names "tanglelight", which never rolls an attack');
    expect(result.out).not.toContain('attack edge "t_burst"');
    expect(result.code).not.toBe(0);
  });

  it("catches a number above the design's 2", () => {
    const result = withRules((m) => {
      m.edges.push({ id: "t_big", hero: {}, on: "check", tag: Object.keys(m.checkTags)[0] ?? "sneak", roll: 3, text: "x" });
    });
    expect(result.out).toContain("/matchups/edges/");
    expect(result.code).not.toBe(0);
  });

  it("catches a chapter naming an unknown trait or check tag", () => {
    const result = withRules(
      (m) => {
        m.traits.thorny ??= { name: "Thorny", icon: "thorn", text: "Spiky.", hint: "Thorny: hit hard" };
        m.checkTags.sneak ??= { name: "Sneak", text: "Quiet." };
      },
      (chapter) => {
        const check = firstOf(chapter, "check");
        const fight = firstOf(chapter, "encounter");
        if (!check || !fight) throw new Error("fixture: bramblewood-01 needs a check and a fight");
        check.tags = ["made_up_tag"];
        fight.enemies[0].traits = ["made_up_trait"];
      },
    );
    expect(result.out).toContain('"made_up_tag" is not a check tag');
    expect(result.out).toContain('"made_up_trait" is not a trait');
    expect(result.code).not.toBe(0);
  });

  it("checks an interaction's tags, and refuses tags on a game that takes no edge (#567)", () => {
    const result = withRules(
      (m) => {
        m.checkTags.force ??= { name: "Force", text: "Heave." };
      },
      (chapter) => {
        const to = { goto: chapter.entry };
        chapter.scenes.edge_tagged = { type: "interaction", narration: "A log.", tags: ["made_up_tag"],
          interaction: { kind: "precision", cue: "Heave.", actionLabel: "Heave", target: 0.5, width: 0.3, periodMs: 4000 },
          onSuccess: to, onFailure: to };
        chapter.scenes.edge_play = { type: "interaction", narration: "A goat.", tags: ["force"],
          interaction: { kind: "play", cue: "Pet it.", actionLabel: "Pet", participation: "any", options: [{ id: "pet", label: "Pet", icon: "heart", reaction: "Baa." }] },
          onSuccess: to, onFailure: to };
      },
    );
    expect(result.out).toContain('"made_up_tag" is not a check tag');
    expect(result.out).toContain("a play game takes no matchup tags");
    expect(result.code).not.toBe(0);
  });

  it("skips the vocabulary checks while the tables are empty", () => {
    const result = withRules(
      (m) => {
        m.traits = {};
        m.checkTags = {};
      },
      (chapter) => {
        const check = firstOf(chapter, "check");
        if (check) check.tags = ["anything"];
      },
    );
    expect(result.out).toContain("no traits yet");
    expect(result.code).toBe(0);
  });
});

describe("voice scripts (docs/voice-narration-plan.md section 3)", () => {
  const SCRIPT = ["content", "voice", "scripts", "bramblewood-01.json"];

  /** A script for the entry scene's narration, cut in two, then bent by `mutate`. */
  function withScript(mutate) {
    const dir = copyTree();
    const chapter = readJson(dir, ...CHAPTER);
    const address = `bramblewood-01/${chapter.entry}/narration`;
    const text = chapter.scenes[chapter.entry].narration;
    const middle = Math.floor(text.length / 2);
    const entry = {
      source: sourceHash(text),
      lines: [
        { by: "narrator", text: text.slice(0, middle) },
        { by: "narrator", text: text.slice(middle) },
      ],
    };
    mutate(entry, text);
    mkdirSync(join(dir, "content", "voice", "scripts"), { recursive: true });
    writeJson(dir, SCRIPT, { [address]: entry });
    return validate(dir);
  }

  it("passes a script whose lines rebuild the screen text", () => {
    const result = withScript(() => {});
    expect(result.out).toContain("voice script");
    expect(result.code).toBe(0);
  });

  it("fails a script that would say something the screen does not", () => {
    const result = withScript((entry) => {
      entry.lines[1].text += " And a surprise.";
    });
    expect(result.out).toContain("do not equal the authored text");
    expect(result.code).not.toBe(0);
  });

  it("fails a line by someone who is not cast", () => {
    const result = withScript((entry) => {
      entry.lines[0].by = "nobody-cast-this";
    });
    expect(result.out).toContain("not in the cast");
    expect(result.code).not.toBe(0);
  });

  it("only warns when the text changed since the script was cut", () => {
    const result = withScript((entry) => {
      entry.source = sourceHash("older words");
    });
    expect(result.out).toContain("stale");
    expect(result.code).toBe(0);
  });
});

describe("the cast voice sheet and the lexicon (#539)", () => {
  const CAST = ["content", "voice", "cast.json"];
  const LEXICON = ["content", "voice", "lexicon.json"];

  function withCast(mutate) {
    const dir = copyTree();
    const cast = readJson(dir, ...CAST);
    mutate(cast);
    writeJson(dir, CAST, cast);
    return validate(dir);
  }

  it("fails a voice that is not one of Gemini's", () => {
    const result = withCast((cast) => {
      cast.speakers.pib.gemini.voice = "Robotron";
    });
    expect(result.out).toMatch(/FAIL\s+content\/voice\/cast\.json/);
    expect(result.code).not.toBe(0);
  });

  it("fails two speakers on one voice in a chapter", () => {
    const result = withCast((cast) => {
      cast.speakers.wisp.gemini.voice = cast.speakers.pib.gemini.voice;
    });
    expect(result.out).toContain("share the voice");
    expect(result.code).not.toBe(0);
  });

  it("fails anybody else on the narrator's voice", () => {
    const result = withCast((cast) => {
      cast.speakers.pib.gemini.voice = cast.speakers.narrator.gemini.voice;
    });
    expect(result.out).toContain("share the voice");
    expect(result.code).not.toBe(0);
  });

  it("fails when the cast sheet is missing, so the gate cannot be skipped", () => {
    const dir = copyTree();
    rmSync(join(dir, ...CAST));
    const result = validate(dir);
    expect(result.out).toContain("the cast voice sheet is missing");
    expect(result.code).not.toBe(0);
  });

  it("fails a speaker entry with no chapter list, as a schema error and not a crash", () => {
    const result = withCast((cast) => {
      delete cast.speakers.pib.chapters;
    });
    expect(result.out).toMatch(/FAIL\s+content\/voice\/cast\.json/);
    expect(result.out).not.toContain("TypeError");
    expect(result.code).not.toBe(0);
  });

  it("checks voices against who is in each chapter now, not the sheet's stale lists", () => {
    // Pib and Bun share a voice and never meet. Bun walks into bramblewood-01 (Pib's chapter)
    // and the sheet is not rebuilt: the clash must still be caught.
    const dir = copyTree();
    const cast = readJson(dir, ...CAST);
    expect(cast.speakers.bun.gemini.voice).toBe(cast.speakers.pib.gemini.voice);
    expect(cast.speakers.bun.chapters).not.toContain("bramblewood-01");
    const chapter = readJson(dir, ...CHAPTER);
    chapter.voiceGuide.npcVoices.bun = "Bun, visiting, talks fast.";
    writeJson(dir, CHAPTER, chapter);
    const result = validate(dir);
    expect(result.out).toContain("share the voice");
    expect(result.out).toContain("bramblewood-01");
    expect(result.code).not.toBe(0);
  });

  it("does not count a speaker the content no longer has, even if the sheet still lists them", () => {
    // A retired character left on the sheet with Pib's voice and Pib's chapter: not a clash,
    // because nobody by that id appears in bramblewood-01 any more.
    const result = withCast((cast) => {
      cast.speakers.retired_ghost = { ...cast.speakers.pib, name: "Retired Ghost", chapters: ["bramblewood-01"], aliases: [] };
    });
    expect(result.out).not.toContain("share the voice");
    expect(result.code).toBe(0);
  });

  it("fails a lexicon entry with nothing to say", () => {
    const dir = copyTree();
    writeJson(dir, LEXICON, { words: { Pib: { say: "" } } });
    const result = validate(dir);
    expect(result.out).toMatch(/FAIL\s+content\/voice\/lexicon\.json/);
    expect(result.code).not.toBe(0);
  });
});
