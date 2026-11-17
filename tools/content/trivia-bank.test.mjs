/**
 * The Field Guide quiz's content checks (docs/trivia.md §3, §4.3, §5;
 * tools/content/trivia-bank.mjs): the shipped bank and ladder are clean, and
 * every rule catches what it is for, on small fixtures. The last block runs
 * the whole gate over a copy of the real tree with one thing broken.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pagesNamed, triviaBankProblems } from "./trivia-bank.mjs";
import { copyTree, readJson, validate, writeJson } from "./validate-harness.ts";

const read = (...p) => JSON.parse(readFileSync(new URL(`../../${p.join("/")}`, import.meta.url), "utf8"));

const GUIDE = {
  entries: {
    "creature.bone_crawler": { id: "creature.bone_crawler", kind: "creature", title: "Bone Crawler", art: "/assets/entities/bone_crawler/portrait.webp" },
    "creature.restless_remains": { id: "creature.restless_remains", kind: "creature", title: "Restless Remains", art: "/assets/entities/restless_remains/portrait.webp" },
    "biome.plains": { id: "biome.plains", kind: "biome", title: "The Plains", art: "/assets/biomes/plains/portrait.webp" },
    "biome.eastern_plains": { id: "biome.eastern_plains", kind: "biome", title: "The Eastern Plains", art: "/assets/biomes/eastern_plains/portrait.webp" },
    "class.thornguard": { id: "class.thornguard", kind: "class", title: "Thornguard" },
    "class.songkeeper": { id: "class.songkeeper", kind: "class", title: "Songkeeper" },
    "npc.faun": { id: "npc.faun", kind: "people", title: "Faun" },
  },
};
const ON_DISK = new Set([
  "assets/entities/bone_crawler/portrait.webp",
  "assets/entities/restless_remains/portrait.webp",
  "assets/biomes/plains/portrait.webp",
  "assets/biomes/eastern_plains/portrait.webp",
  "assets/gear-portraits/thornguard/sworn/bigfoot.png",
]);
const LOOKS = {
  coats: [],
  specials: [],
  nameplates: [],
  titles: [
    { id: "the_learned", text: "the Learned", unlock: { from: "trivia", rung: 25 } },
    { id: "the_bold", text: "the Bold", unlock: { from: "starter" } },
  ],
};
const LADDER = {
  rungs: [
    { at: 10, badge: { id: "trivia-10", name: "Curious Reader", blurb: "Ten right." } },
    { at: 25, title: "the_learned" },
  ],
  firstTry: [{ at: 25, badge: { id: "trivia-first-25", name: "Sharp Memory", blurb: "First try." } }],
};

const question = (over = {}) => ({
  id: "creature.bone_crawler.shell",
  entry: "creature.bone_crawler",
  ask: "What does a bone crawler build its shell from?",
  answer: "Old fossil pieces",
  wrong: ["River pebbles", "Other crawlers' claws", "Broken pots", "Dragon scales", "Woven seaweed"],
  also: [],
  link: "entry",
  ...over,
});

const problems = (questions, { ladder = LADDER, looks = LOOKS, files } = {}) =>
  triviaBankProblems({
    files: files ?? [{ path: "content/trivia/creatures.json", data: { questions } }],
    ladder,
    guide: GUIDE,
    looks,
    exists: (p) => ON_DISK.has(p),
  }).map((p) => `${p.file}${p.at}: ${p.problem}`);

describe("the shipped quiz", () => {
  it("is clean, with the decided ladder", () => {
    const files = ["creatures", "biomes", "classes", "landmarks", "others"].map((g) => ({ path: `content/trivia/${g}.json`, data: read("content", "trivia", `${g}.json`) }));
    const ladder = read("content", "trivia", "ladder.json");
    const found = triviaBankProblems({ files, ladder, guide: read("content", "field-guide.json"), looks: read("content", "looks.json"), exists: () => true });
    expect(found).toEqual([]);
    expect(ladder.rungs.map((r) => r.at)).toEqual([10, 25, 50, 120, 175, 220]);
    expect(ladder.firstTry.map((r) => r.at)).toEqual([25, 100]);
    expect(ladder.rungs.filter((r) => r.title).map((r) => r.title)).toEqual(["the_learned", "the_well_read"]);
  });
});

describe("a question", () => {
  it("passes as the doc writes it", () => {
    expect(problems([question()])).toEqual([]);
    expect(problems([question({ wrong: [...question().wrong, "Seashells"] })])).toEqual([]);
  });

  it("names Field Guide pages that exist, and its picture is one of them", () => {
    const found = problems([question({ entry: "creature.nobody", id: "creature.nobody.x" }), question({ id: "creature.bone_crawler.b", also: ["creature.ghost", "creature.bone_crawler"], image: "biome.plains" })]);
    expect(found).toContain('content/trivia/creatures.json/questions/0/entry: "creature.nobody" is not a page of content/field-guide.json');
    expect(found).toContain('content/trivia/creatures.json/questions/1/also/0: "creature.ghost" is not a page of content/field-guide.json');
    expect(found).toContain('content/trivia/creatures.json/questions/1/also/1: "creature.bone_crawler" is the question\'s own entry');
    expect(found).toContain('content/trivia/creatures.json/questions/1/image: "biome.plains" is neither the entry nor in also');
  });

  it("takes another page's picture when that page is in also", () => {
    expect(problems([question({ also: ["creature.restless_remains"], image: "creature.restless_remains", ask: "Who builds shells from these, like the Restless Remains?" })])).toEqual([]);
  });

  it("refuses an id used twice, across files too", () => {
    const found = problems([], {
      files: [
        { path: "content/trivia/creatures.json", data: { questions: [question()] } },
        { path: "content/trivia/biomes.json", data: { questions: [question()] } },
      ],
    });
    expect(found).toEqual(['content/trivia/biomes.json/questions/0/id: "creature.bone_crawler.shell" is already a question (content/trivia/creatures.json/questions/0)']);
  });

  it("lists in also every other page its words name (the spoiler rule)", () => {
    const found = problems([question({ wrong: ["River pebbles", "Restless Remains bones", "Broken pots", "Dragon scales", "Grass from the plains"] })]);
    expect(found).toContain('content/trivia/creatures.json/questions/0/wrong/1: names "Restless Remains" (creature.restless_remains), which is not in also');
    expect(found).toContain('content/trivia/creatures.json/questions/0/wrong/4: names "The Plains" (biome.plains), which is not in also');
    expect(problems([question({ also: ["creature.restless_remains", "biome.plains"], wrong: ["River pebbles", "Restless Remains bones", "Broken pots", "Dragon scales", "Grass from the plains"] })])).toEqual([]);
  });

  it("matches whole words, case-insensitively, the longer title first", () => {
    expect(pagesNamed("Where do the eastern plains end?", GUIDE).map((p) => p.id)).toEqual(["biome.eastern_plains"]);
    expect(pagesNamed("A fauna of fauns, and one FAUN", GUIDE).map((p) => p.id)).toEqual(["npc.faun"]);
  });

  it("matches a title's plural too, so the yetis name the Yeti page", () => {
    expect(pagesNamed("Bone crawlers", GUIDE).map((p) => p.id)).toEqual(["creature.bone_crawler"]);
    expect(pagesNamed("Bone crawlersmith", GUIDE)).toEqual([]);
  });

  it("asks for five or six wrong options, all different from each other and the answer", () => {
    expect(problems([question({ wrong: ["A", "B", "C", "D"] })])).toContain("content/trivia/creatures.json/questions/0/wrong: 4 wrong option(s)");
    expect(problems([question({ wrong: ["A", "B", "C", "D", "E", "F", "G"] })])).toContain("content/trivia/creatures.json/questions/0/wrong: 7 wrong option(s)");
    const found = problems([question({ wrong: ["River pebbles", "river  Pebbles", "old fossil pieces", "Dragon scales", "Woven seaweed"] })]);
    expect(found).toContain('content/trivia/creatures.json/questions/0/wrong/1: "river  Pebbles" is the same as wrong option 0');
    expect(found).toContain('content/trivia/creatures.json/questions/0/wrong/2: "old fossil pieces" is the same as the answer');
  });

  it("keeps options under 10 words and the ask under 20", () => {
    expect(problems([question({ answer: "one two three four five six seven eight nine" })])).toEqual([]);
    expect(problems([question({ answer: "one two three four five six seven eight nine ten" })])).toContain('content/trivia/creatures.json/questions/0/answer: "one two three four five six seven eight nine ten" is 10 words');
    const long = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty?";
    expect(problems([question({ ask: long })])).toContain(`content/trivia/creatures.json/questions/0/ask: "${long}" is 20 words`);
  });

  it("refuses an em dash and British spelling", () => {
    const found = problems([question({ ask: "What colour is a bone crawler—really?" })]);
    expect(found.some((p) => p.includes("has an em dash"))).toBe(true);
    expect(found.some((p) => p.includes('"colour" is not US spelling'))).toBe(true);
  });

  it("needs a link, and an entry link never opens on its own answer", () => {
    expect(problems([question({ link: undefined })])).toContain("content/trivia/creatures.json/questions/0/link: needs a link");
    const named = question({ ask: "Which creature wears fossil shells?", answer: "Bone Crawler" });
    expect(problems([named])).toContain('content/trivia/creatures.json/questions/0/link: the answer is "Bone Crawler", the page\'s own title');
    expect(problems([{ ...named, link: "shelf" }])).toEqual([]);
    const plains = question({ id: "biome.plains.name", entry: "biome.plains", ask: "Where is the grass tallest?", answer: "Plains", wrong: ["Bogs", "Peaks", "Coves", "Caves", "Seas"] });
    expect(problems([plains])).toContain('content/trivia/creatures.json/questions/0/link: the answer is "The Plains", the page\'s own title');
  });

  it("resolves to a picture on disk: the page's art, or a class page's gear portrait", () => {
    const thornguard = question({ id: "class.thornguard.gear", entry: "class.thornguard", ask: "What does a Thornguard carry?", answer: "A thorn bracer", wrong: ["A lute", "A bow", "A wand", "A net", "A drum"] });
    expect(problems([thornguard])).toEqual([]);
    const songkeeper = { ...thornguard, id: "class.songkeeper.gear", entry: "class.songkeeper", ask: "What does a Songkeeper carry?" };
    expect(problems([songkeeper])).toContain("content/trivia/creatures.json/questions/0/entry: its picture /assets/gear-portraits/songkeeper/sworn/griffin.png is not on disk");
    const faun = question({ id: "npc.faun.x", entry: "npc.faun", ask: "What does a faun play?", answer: "Pipes", wrong: ["Drums", "Bells", "Harps", "Horns", "Flutes"] });
    expect(problems([faun])).toContain('content/trivia/creatures.json/questions/0/entry: "npc.faun" has no picture');
  });
});

describe("the ladder", () => {
  it("names titles the looks catalog gives at the same rung", () => {
    expect(problems([], { ladder: { ...LADDER, rungs: [...LADDER.rungs, { at: 30, title: "the_bold" }, { at: 40, title: "the_nobody" }] } })).toEqual([
      'content/trivia/ladder.json/rungs/2/title: content/looks.json title "the_bold" is not unlocked by { "from": "trivia", "rung": 30 }',
      'content/trivia/ladder.json/rungs/3/title: no title "the_nobody" in content/looks.json',
    ]);
  });

  it("refuses a quiz look the ladder never gives", () => {
    const looks = { ...LOOKS, titles: [...LOOKS.titles, { id: "the_wise", text: "the Wise", unlock: { from: "trivia", rung: 50 } }] };
    expect(problems([], { looks })).toEqual(['content/looks.json/titles/2/unlock: "the_wise" is a quiz look the ladder does not give at rung 50']);
  });

  it("keeps badge ids unique, rungs ascending, and the first-try track to badges", () => {
    const ladder = {
      rungs: [LADDER.rungs[1], LADDER.rungs[0]],
      firstTry: [{ at: 25, badge: { id: "trivia-10", name: "Again", blurb: "Again." } }, { at: 30, title: "the_learned" }],
    };
    const found = problems([], { ladder });
    expect(found).toContain("content/trivia/ladder.json/rungs/1/at: rung 10 is not above the one before (25)");
    expect(found).toContain('content/trivia/ladder.json/firstTry/0/badge/id: badge "trivia-10" is already /rungs/1');
    expect(found).toContain("content/trivia/ladder.json/firstTry/1/title: the first-try track gives badges only");
  });
});

describe("content:validate over the quiz", () => {
  const withQuestions = (questions) => {
    const dir = copyTree();
    // Only this question in the bank: the other groups are emptied so the count is exact.
    for (const group of ["creatures", "biomes", "classes", "landmarks", "others"]) {
      const file = readJson(dir, "content", "trivia", `${group}.json`);
      file.questions = group === "creatures" ? questions : [];
      writeJson(dir, ["content", "trivia", `${group}.json`], file);
    }
    return validate(dir);
  };
  const real = question({ id: "creature.bone_crawler.shell", also: [] });

  it("passes a good question", () => {
    const result = withQuestions([real]);
    expect(result.out).toContain("1 question(s) in 5 group(s)");
    expect(result.code).toBe(0);
  });

  it("fails a question with three wrong options, at the schema", () => {
    const result = withQuestions([{ ...real, wrong: ["A", "B", "C"] }]);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("content/trivia/creatures.json");
  });

  it("fails a question naming a page it does not list", () => {
    const result = withQuestions([{ ...real, wrong: ["Cloud Whale bones", ...real.wrong.slice(1)] }]);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('names "Cloud Whale" (creature.cloud_whale), which is not in also');
  });

  it("fails a missing group file and a stray file", () => {
    const dir = copyTree();
    const file = readJson(dir, "content", "trivia", "others.json");
    writeJson(dir, ["content", "trivia", "people.json"], file);
    const result = validate(dir);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("is not a quiz group");
  });
});
