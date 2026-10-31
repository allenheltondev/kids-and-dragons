/**
 * How many lines each character has to speak (docs/voice-cast.md): every quote the narration gives them, counted
 * in full, where `lines` is only the few worth auditioning on. The cast pages sort by it, to put the characters
 * with the most to say first.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { castOrder, castPageData } from "./routes.ts";
import { reviewJson } from "./review.ts";
import { attributeQuotes, buildSheet, looksSpoken, withSceneRoles, type CastSheet, type ChapterLike, type LooseQuote, type NarrationLine } from "./sheet.ts";

const chapters: ChapterLike[] = [
  { id: "c1", voiceGuide: { npcVoices: { pib: "a bramble sprite; he chirps", wisp: "a shy ghost; she whispers", mute: "a goat; only bleats" } } },
  { id: "c2", voiceGuide: { npcVoices: { pib: "a bramble sprite; he chirps" } } },
];

const said = (chapter: string, scene: string, who: string, n: number): NarrationLine => ({ chapter, address: `${chapter}/${scene}/narration`, text: `${who} says, "Line number ${String(n)} is spoken aloud."` });

const narration: NarrationLine[] = [
  // Pib speaks seven times across two chapters, wisp twice, and the party once.
  ...[1, 2, 3, 4].map((n) => said("c1", `s${String(n)}`, "Pib", n)),
  ...[5, 6, 7].map((n) => said("c2", `s${String(n)}`, "Pib", n)),
  said("c1", "w1", "Wisp", 1),
  said("c1", "w2", "Wisp", 2),
  { chapter: "c1", address: "c1/p1/narration", text: '"We came to help," you say.' },
  { chapter: "c1", address: "c1/n1/narration", text: "The path ends at a wall of thorns." },
];

const sheetOf = (previous: CastSheet | null = null): CastSheet => buildSheet({ chapters, individuals: [], narration }, previous);

describe("counting each character's spoken lines", () => {
  it("counts every line they speak, where the audition lines are only the best three", () => {
    const sheet = sheetOf();
    expect(sheet.speakers.pib!.lineCount).toBe(7);
    expect(sheet.speakers.pib!.lines).toHaveLength(3);
    expect(sheet.speakers.wisp!.lineCount).toBe(2);
    expect(sheet.speakers.wisp!.lines).toHaveLength(2);
  });

  it("counts someone nobody quotes as none, rather than leaving the field out", () => {
    expect(sheetOf().speakers.mute!.lineCount).toBe(0);
  });

  it("counts the party's 'you say' lines, and gives the narrator every line of narration", () => {
    const sheet = sheetOf();
    expect(sheet.speakers.party!.lineCount).toBe(1);
    expect(sheet.speakers.narrator!.lineCount).toBe(narration.length);
  });

  it("refreshes the count on a rebuild, narrator and party included, and keeps what a person decided", () => {
    const first = sheetOf();
    first.speakers.pib!.status = "approved";
    first.speakers.pib!.lineCount = 99;
    first.speakers.narrator!.lineCount = 1;
    first.speakers.party!.lineCount = 99;
    const again = sheetOf(first);
    expect(again.speakers.pib).toMatchObject({ status: "approved", lineCount: 7 });
    expect(again.speakers.narrator!.lineCount).toBe(narration.length);
    expect(again.speakers.party!.lineCount).toBe(1);
  });

  it("walks the narrator, the party, then whoever speaks most, ties going to the most chapters", () => {
    const sheet = sheetOf();
    expect(castOrder(sheet).slice(0, 4)).toEqual(["narrator", "party", "pib", "wisp"]);
    // Fewer chapters but more lines still comes first; the same lines, the most chapters.
    sheet.speakers.wisp!.lineCount = 7;
    sheet.speakers.wisp!.chapters = ["c1"];
    expect(castOrder(sheet).slice(2, 4)).toEqual(["pib", "wisp"]);
    sheet.speakers.wisp!.lineCount = 8;
    expect(castOrder(sheet).slice(2, 4)).toEqual(["wisp", "pib"]);
  });

  it("serves the count to the pages with each character", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cast-lines-"));
    const sheetPath = path.join(dir, "cast.json");
    fs.writeFileSync(sheetPath, JSON.stringify(sheetOf()));
    const data = castPageData({ ws: { outDir: dir, cast: { speakers: {}, delivery: {}, beats: {} } as never, pricing: { models: [] } as never, today: "2026-10-30" }, sheetPath, catalog: [], fetch: async () => { throw new Error("no"); }, chapterCampaigns: {} }, { profiles: false });
    expect(Object.fromEntries(Object.entries(data.speakers).map(([id, e]) => [id, e.lineCount]))).toEqual({ narrator: narration.length, party: 1, pib: 7, wisp: 2, mute: 0 });
    // The count is not the audition list: the page shows both.
    expect(data.auditions.pib).toHaveLength(3);
  });

  it("puts the count in the review export", () => {
    const review = reviewJson(sheetOf());
    expect(Object.fromEntries(review.speakers.map((e) => [e.id, e.lines]))).toMatchObject({ pib: 7, wisp: 2, mute: 0 });
  });
});

describe("guessing at quotes nobody is tagged for", () => {
  const loose = (words: string, before = "", after = ""): LooseQuote => ({ words, before, after });

  it("reports the quotes it could not give to anyone, with the words either side", () => {
    const sink: LooseQuote[] = [];
    const found = attributeQuotes('The path ends at a wall of thorns. "Mind the brambles." Then it hums.', [{ id: "pib", names: ["Pib"] }], sink);
    expect(found).toEqual([]);
    expect(sink).toEqual([{ words: "Mind the brambles.", before: "The path ends at a wall of thorns. ", after: " Then it hums." }]);
  });

  it("takes a sentence someone said, and not a fragment, a quoted phrase, a sign or the party", () => {
    expect(looksSpoken(loose("Going, then.", "At dawn, Mortar watches you pass. "))).toBe(true);
    expect(looksSpoken(loose("for keeping the argument going."))).toBe(false); // a fragment
    expect(looksSpoken(loose("Mine,"))).toBe(false); // one word
    expect(looksSpoken(loose("slightly used rumors.", "A boggart in a coat of other coats sells "))).toBe(false); // sold, not said
    expect(looksSpoken(loose("NO MESSING.", "A sign on the gate reads "))).toBe(false);
    expect(looksSpoken(loose("Now you're Sunward,", "You sing the verse back to Hob. "))).toBe(false);
    expect(looksSpoken(loose("We will see.", "", ", you say, and mean it."))).toBe(false);
    // The same words a sentence earlier are not a sign: the cue must be in the quote's own sentence.
    expect(looksSpoken(loose("Then we are home.", "The grandmother reads the founder's plaque twice. "))).toBe(true);
  });

  const hedge: ChapterLike[] = [
    {
      id: "h1",
      voiceGuide: { npcVoices: { pib: "a bramble sprite; he chirps", wisp: "a shy ghost; she whispers" } },
      scenes: {
        // One speaker here: Pib. Two there: nobody can say who.
        alone: { cast: [{ name: "Pib" }] },
        crowd: { cast: [{ name: "Pib" }, { name: "Wisp" }] },
      },
    },
  ];
  const guessing: NarrationLine[] = [
    { chapter: "h1", address: "h1/alone/narration", text: 'Pib says, "Welcome to the hedge." The hedge rustles. "Mind the brambles on your way in."' },
    { chapter: "h1", address: "h1/alone/narration", text: 'A hush falls. "The hedge remembers everyone who passes."' },
    { chapter: "h1", address: "h1/alone/narration", text: 'A sign nailed to the gate reads "KEEP OUT."' },
    { chapter: "h1", address: "h1/crowd/narration", text: 'A hush falls. "Somebody here is humming."' },
  ];
  const sheet = buildSheet({ chapters: hedge, individuals: [], narration: guessing }, null);

  it("counts them for the one who is alone in the scene, apart from the tagged lines", () => {
    const pib = sheet.speakers.pib!;
    // One tagged line (his two back-to-back quotes are one line, as they are said), and one guess; the sign is neither.
    expect(pib.lineCount).toBe(2);
    expect(pib.guessedLines).toBe(1);
    // Only the tagged line is offered to audition on: a guess is never a sample of their voice.
    expect(pib.lines.map((line) => line.text)).toEqual(["Welcome to the hedge. Mind the brambles on your way in."]);
  });

  it("leaves a crowded scene's quotes uncounted, and a sign alone", () => {
    expect(sheet.speakers.wisp!.lineCount).toBe(0);
    expect(sheet.speakers.wisp!.guessedLines).toBeUndefined();
  });

  it("does not guess when someone else is named right beside the quote", () => {
    const withWisp = buildSheet({ chapters: hedge, individuals: [], narration: [{ chapter: "h1", address: "h1/alone/narration", text: 'Wisp drifts past the gate. "The hedge remembers everyone who passes."' }] }, null);
    expect(withWisp.speakers.pib!.lineCount).toBe(0);
  });
});

describe("naming someone by what they are, in the scene they are in", () => {
  const names = new Map([["cousins", "Gullet's Cousins"], ["gullet", "Gullet"], ["drover_a", "Centaur drover"], ["drover_b", "Faun drover"]]);
  const speakers = [{ id: "cousins", names: ["Gullet's Cousins"] }, { id: "gullet", names: ["Gullet"] }, { id: "drover_a", names: ["Centaur drover"] }, { id: "drover_b", names: ["Faun drover"] }];
  const rolesOf = (here: string[], id: string): readonly string[] => withSceneRoles(speakers, new Set(here), names).find((speaker) => speaker.id === id)!.names;

  it("lets the last word of a name stand for them where nobody else in the scene shares it", () => {
    expect(rolesOf(["cousins", "gullet"], "cousins")).toEqual(["Gullet's Cousins", "cousins", "cousin"]);
    // Two drovers in one scene: "the drover" is nobody's, but "the centaur drover" still is.
    expect(rolesOf(["drover_a", "drover_b"], "drover_a")).toEqual(["Centaur drover"]);
    // Someone not in the scene keeps just their own names.
    expect(rolesOf(["gullet"], "cousins")).toEqual(["Gullet's Cousins"]);
    expect(withSceneRoles(speakers, undefined, names)).toEqual(speakers.map((speaker) => ({ ...speaker, here: false })));
  });

  it("reads 'says a cousin' and 'groans the guide' as tags, and a bare 'the drover says' only when one drover is there", () => {
    const here = withSceneRoles(speakers, new Set(["cousins", "gullet"]), names);
    expect(attributeQuotes('"Tall lady with cords," says a cousin. "Never stopped jogging."', here).map((q) => q.id)).toEqual(["cousins", "cousins"]);
    expect(attributeQuotes('"My cousin," groans the cousin.', here).map((q) => q.id)).toEqual(["cousins"]);
    const drovers = withSceneRoles(speakers, new Set(["drover_a", "drover_b"]), names);
    const loose: LooseQuote[] = [];
    expect(attributeQuotes('"Toll refund," the drover says.', drovers, loose)).toEqual([]);
    expect(loose).toHaveLength(1);
    expect(attributeQuotes('"Toll refund," the centaur drover says.', drovers).map((q) => q.id)).toEqual(["drover_a"]);
  });
});

describe("a scene variant that carries on from the scene's narration", () => {
  const speakers = [{ id: "pellam", names: ["Pellam"] }];
  const base = 'Pellam opens the ledger. "Here it is."';
  const variant = '"Pockets," he reads. "A great many pockets."';

  it("takes its 'he' from who the narration last named, and counts only its own quotes", () => {
    const loose: LooseQuote[] = [];
    const alone = attributeQuotes(variant, speakers, loose);
    expect(alone).toEqual([]);
    expect(loose).toHaveLength(2);
    const sink: LooseQuote[] = [];
    const joined = attributeQuotes(`${base} ${variant}`, speakers, sink, base.length + 1);
    expect(joined.map((q) => [q.id, q.words])).toEqual([["pellam", "Pockets,"], ["pellam", "A great many pockets."]]);
    expect(sink).toEqual([]);
  });
});

describe("a character cast in another chapter of the campaign", () => {
  // Wisp is cast in chapter w1. In chapter r1 only the runner is, and the prose says "the wisp line" (a noun, not the person).
  const campaign: ChapterLike[] = [
    { id: "w1", campaignId: "gem", voiceGuide: { npcVoices: { wisp: "Wisp, a shy ghost; she whispers", cousins: "Gullet's Cousins, croaky frog folk" } }, scenes: { a: { cast: [{ name: "Wisp" }, { name: "Gullet's Cousins" }] } } },
    { id: "r1", campaignId: "gem", voiceGuide: { npcVoices: { runner: "a MossHome runner; brisk" } }, scenes: { post: { cast: [{ name: "Runner" }] } } },
  ];
  const text = 'And the ribbon crew moved the wisp line out twice more this week. "She said to tell anybody who asked," he puffs, "that she is not worried. Which means she is."';

  it("keeps a lowercase noun from being the person: the wisp line is not Wisp, so the runner's quote is not hers", () => {
    const sheet = buildSheet({ chapters: campaign, individuals: [], narration: [{ chapter: "r1", address: "r1/post/narration", text }] }, null);
    expect(sheet.speakers.wisp!.lineCount).toBe(0);
    expect(sheet.speakers.wisp!.pronouns).toBeUndefined();
    expect(sheet.speakers.runner!.lineCount).toBe(1);
  });

  it("still tags them by their own name in a chapter that does not cast them", () => {
    const sheet = buildSheet({ chapters: campaign, individuals: [], narration: [{ chapter: "r1", address: "r1/post/narration", text: 'Wisp drifts by. "The ribbon is loose," says Wisp.' }] }, null);
    expect(sheet.speakers.wisp!.lineCount).toBe(1);
  });

  it("masks a name that only counts as written, and keeps the words and the places of the text", () => {
    const speakers = [{ id: "runner", names: ["Runner"] }, { id: "wisp", names: ["Wisp"], exact: true }];
    expect(attributeQuotes(text, speakers).map((q) => q.id)).not.toContain("wisp");
    expect(attributeQuotes('Wisp says, "Hello there."', speakers).map((q) => q.id)).toEqual(["wisp"]);
    expect(attributeQuotes('"Hello there," says wisp.', speakers)).toEqual([]);
  });

  it("does not take a group for a she because one of them was, and keeps what a rebuild had already learned", () => {
    const told = [{ chapter: "w1", address: "w1/a/narration", text: '"Good hands," croaks the cousin. "We will carry you across," she says.' }];
    const first = buildSheet({ chapters: campaign, individuals: [], narration: told }, null);
    expect(first.speakers.cousins!.pronouns).toBeUndefined();
    // Something once learned from the narration stays when the quotes later go elsewhere.
    const before = buildSheet({ chapters: campaign, individuals: [], narration: [{ chapter: "w1", address: "w1/a/narration", text: '"I am here," Wisp says. "Come along," she whispers.' }] }, null);
    expect(before.speakers.wisp).toMatchObject({ pronouns: "she/her", pronounsFrom: "narration" });
    const later = buildSheet({ chapters: campaign, individuals: [], narration: [] }, before);
    expect(later.speakers.wisp).toMatchObject({ pronouns: "she/her", pronounsFrom: "narration" });
  });
});

describe("three more ways the prose names a speaker", () => {
  const speakers = [{ id: "corvane", names: ["Corvane"] }, { id: "seal", names: ["Seal Keeper"] }, { id: "guide", names: ["guide"] }];

  it("takes a hyphen for a space in a name: 'Seal-Keeper' is the Seal Keeper", () => {
    expect(attributeQuotes('"Catch it!" roars the Seal-Keeper.', speakers).map((q) => q.id)).toEqual(["seal"]);
    expect(attributeQuotes('"Catch it!" roars the Seal Keeper.', speakers).map((q) => q.id)).toEqual(["seal"]);
  });

  it("lets a quote that introduces its speaker name them, when a he or she tag has nobody before it", () => {
    const text = 'The figure steps into view. "I am Corvane," he says. "Emperor of Pangea."';
    expect(attributeQuotes(text, speakers).map((q) => [q.id, q.words])).toEqual([["corvane", "I am Corvane,"], ["corvane", "Emperor of Pangea."]]);
    // Not when somebody is named before it: that is who "he" is.
    expect(attributeQuotes('The guide waits. "I am Corvane," he says.', speakers).map((q) => q.id)).toEqual(["guide"]);
  });

  it("reads 'repeats' and 'observes' as speaking", () => {
    expect(attributeQuotes('"An old river," the guide repeats. "Still no tours."', speakers).map((q) => q.id)).toEqual(["guide", "guide"]);
  });
});

describe("'she says' with nobody named, in a scene with one she", () => {
  const speakers = [
    { id: "herder", names: ["Yeti herder"], pronoun: "she" as const, here: true },
    { id: "wick", names: ["Wick"], pronoun: "he" as const, here: true },
    { id: "other", names: ["Moss"], pronoun: "she" as const, here: false },
  ];

  it("is the one she in the scene, for a tag and for a sentence that starts with she", () => {
    const text = 'She stops at the sight of the kid. "There you are." Then she notices the rest of you. "There you all are," she says.';
    expect(attributeQuotes(text, speakers).map((q) => q.id)).toEqual(["herder", "herder"]);
    expect(attributeQuotes('He tugs his cap. "Mornin\'," he says.', speakers).map((q) => q.id)).toEqual(["wick"]);
  });

  it("is nobody when two of the scene are she, and not someone who is not in the scene", () => {
    const two = [...speakers, { id: "kid", names: ["Kid"], pronoun: "she" as const, here: true }];
    expect(attributeQuotes('"There you are," she says.', two)).toEqual([]);
    expect(attributeQuotes('"There you are," she says.', speakers).map((q) => q.id)).toEqual(["herder"]);
  });

  it("gives way to a name the narration used, unless the sheet knows that person is a he", () => {
    expect(attributeQuotes('Moss waves. "Hello," she says.', speakers).map((q) => q.id)).toEqual(["other"]);
    expect(attributeQuotes('Wick waves. "Hello," she says.', speakers).map((q) => q.id)).toEqual(["herder"]);
  });
});

describe("someone known only by what they are, and a gender the notes already state", () => {
  const campaign: ChapterLike[] = [
    { id: "a", campaignId: "gem", voiceGuide: { npcVoices: { beech_tree: "old, slow; whispers in long sentences" } }, scenes: { s: { cast: [{ name: "Beech Tree" }] } } },
    { id: "b", campaignId: "gem", voiceGuide: { npcVoices: { Pib: "Pib, a sprite" } }, scenes: { s: { cast: [{ name: "Pib" }] } } },
  ];

  it("lets a tree be 'the beech' in a scene that does not cast it", () => {
    const sheet = buildSheet({ chapters: campaign, individuals: [], narration: [{ chapter: "a", address: "a/other/narration", text: 'A huge beech sits across the path. "Why did you come?" it whispers.' }] }, null);
    expect(sheet.speakers.beech_tree!.lineCount).toBe(1);
  });

  it("takes the elder for the Elder Unicorn where no other elder is in the scene", () => {
    const names = new Map([["unicorn", "Elder Unicorn"], ["pib", "Pib"]]);
    const speakers = [{ id: "unicorn", names: ["Elder Unicorn"] }, { id: "pib", names: ["Pib"] }];
    const here = withSceneRoles(speakers, new Set(["unicorn", "pib"]), names);
    expect(here.find((speaker) => speaker.id === "unicorn")!.names).toEqual(expect.arrayContaining(["elder", "unicorn"]));
    expect(attributeQuotes('"We are mending," says the elder.', here).map((q) => q.id)).toEqual(["unicorn"]);
  });

  it("does not let a 'he' the counter heard overturn a woman the notes describe", () => {
    const chapters: ChapterLike[] = [{ id: "c", voiceGuide: { npcVoices: { archivist: "brisk archivist; warm once she decides you matter" } }, scenes: { s: { cast: [{ name: "Archivist" }] } } }];
    const sheet = buildSheet({ chapters, individuals: [], narration: [{ chapter: "c", address: "c/s/narration", text: 'The archivist waits. "Wipe your feet," he says. "Please."' }] }, null);
    expect(sheet.speakers.archivist!.pronouns).toBeUndefined();
    expect(sheet.speakers.archivist!.gender).toBe("female");
  });
});

describe("a quote that says who is speaking, after a sentence about someone else", () => {
  it("is the one it names, not the one the sentence before it was about", () => {
    const speakers = [{ id: "guide", names: ["guide"] }, { id: "corvane", names: ["Corvane"] }];
    expect(attributeQuotes('The guide waits. "I\'m Corvane."', speakers).map((q) => q.id)).toEqual(["corvane"]);
    // With nothing in the quote naming anyone, the sentence before it still says whose it is.
    expect(attributeQuotes('The guide waits. "Mind the step."', speakers).map((q) => q.id)).toEqual(["guide"]);
  });
});

describe("names that are mostly a common word", () => {
  const campaign: ChapterLike[] = [
    {
      id: "c",
      voiceGuide: { npcVoices: { "The Eldest": "MossHome elder; mild", "MossHome Runner": "a runner; brisk", "Door Archivist": "brisk archivist; warm once she decides you matter" } },
      scenes: { quay: { cast: [{ name: "MossHome Runner" }] }, hall: { cast: [{ name: "Door Archivist" }] } },
    },
    { id: "d", voiceGuide: { npcVoices: { Gullet: "Gullet, a marsh frog" } }, scenes: { a: { cast: [{ name: "Gullet" }] } } },
  ];

  it("does not make 'The' or 'door' a name: the Eldest and the Door Archivist are not credited with the quotes around them", () => {
    const narration: NarrationLine[] = [
      { chapter: "c", address: "c/quay/narration", text: 'The runner skids to a stop at the tavern door. "Shoo them off my lamps!" she says.' },
      { chapter: "c", address: "c/quay/narration", text: 'The Seal-Keeper opens an eye the size of a door. "Harvest sprites. They do not give those to many," it says.' },
      { chapter: "c", address: "c/quay/narration", text: 'He shuts the door and hands over the whistle. "Now. Before the captain, the tags," he says.' },
    ];
    const sheet = buildSheet({ chapters: campaign, individuals: [], narration }, null);
    const named = (name: string) => Object.values(sheet.speakers).find((speaker) => speaker.name === name)!;
    expect(named("The Eldest").lineCount).toBe(0);
    expect(named("Door Archivist").lineCount).toBe(0);
    expect(named("MossHome Runner").lineCount).toBeGreaterThanOrEqual(1);
  });

  it("does not take the describing first word of a name for the name: 'a small thing' is not the Small Dragonling", () => {
    const chapters: ChapterLike[] = [{ id: "e", voiceGuide: { npcVoices: { "Small Dragonling": "a small dragonling", "Tobble Reedpipe": "Tobble Reedpipe, a faun" } }, scenes: { s: { cast: [{ name: "Tobble Reedpipe" }] } } }];
    const sheet = buildSheet({ chapters, individuals: [], narration: [{ chapter: "e", address: "e/s/narration", text: 'A small bell rings. "Hello," Tobble says. A small cheer goes up. "Welcome!" says Tobble.' }] }, null);
    const named = (name: string) => Object.values(sheet.speakers).find((speaker) => speaker.name === name)!;
    expect(named("Small Dragonling").lineCount).toBe(0);
    // A given name is still a name.
    expect(named("Tobble Reedpipe").lineCount).toBeGreaterThanOrEqual(1);
  });

  it("still tags the Eldest by 'the eldest' and by their full name", () => {
    const narration: NarrationLine[] = [
      { chapter: "c", address: "c/hall/narration", text: '"You have the outline of it now," says the eldest.' },
      { chapter: "c", address: "c/hall/second", text: '"Nobody yet," says The Eldest.' },
    ];
    const sheet = buildSheet({ chapters: campaign, individuals: [], narration }, null);
    expect(Object.values(sheet.speakers).find((speaker) => speaker.name === "The Eldest")!.lineCount).toBe(2);
  });
});

describe("one person under a title in the scenes and without it in the notes", () => {
  const chapters: ChapterLike[] = [
    {
      id: "p",
      voiceGuide: { npcVoices: { "Sefa Tallgrass": "pride elder; voice like warm gravel", "Captain Voss": "a captain", "Captain Thimble": "a ferry captain" } },
      scenes: { camp: { cast: [{ name: "Elder Sefa", figure: "cast/elder_sefa" }] }, quay: { cast: [{ name: "Captain Voss" }, { name: "Captain Thimble" }] } },
    },
  ];

  it("is one character, whose figure and lines are shared, and does not fold two people who share a title", () => {
    const sheet = buildSheet({ chapters, individuals: [], narration: [{ chapter: "p", address: "p/camp/narration", text: '"Welcome," says Elder Sefa. "Come in," says Sefa Tallgrass.' }] }, null);
    const sefa = Object.values(sheet.speakers).filter((speaker) => /Sefa/.test(speaker.name));
    expect(sefa).toHaveLength(1);
    expect(sefa[0]!.name).toBe("Sefa Tallgrass");
    expect(sefa[0]!.aliases).toContain("Elder Sefa");
    // The figure the scenes draw her with comes with her.
    expect(sefa[0]!.figure).toBe("cast/elder_sefa");
    expect(sefa[0]!.lineCount).toBe(1);
    // Voss and Thimble are both captains, and two people.
    expect(Object.values(sheet.speakers).filter((speaker) => /Captain/.test(speaker.name))).toHaveLength(2);
  });
});

describe("a name whose first word is also an ordinary word", () => {
  it("is not the first word alone: a soup line is not the Soup Woman, and the runner's quotes are the runner's", () => {
    const chapters: ChapterLike[] = [
      {
        id: "g",
        voiceGuide: { npcVoices: { "Soup Woman": "Marigold; warm, runs the soup tent", "MossHome Runner": "a runner; brisk" } },
        scenes: { tent: { cast: [{ name: "Soup Woman" }] }, post: { cast: [{ name: "MossHome Runner" }] } },
      },
    ];
    const narration: NarrationLine[] = [
      { chapter: "g", address: "g/tent/narration", text: 'The tent smells of onions. Soup for everyone, and a soup ladle the size of an oar. "Eat," she says.' },
      { chapter: "g", address: "g/post/narration", text: '"The rush road?" A runner puffs out the news. A ford line two days long. And a soup line, very kind, that keeps asking people about the mountain. "Same shape as here," she says. "Different country. Everybody\'s noticing."' },
    ];
    const sheet = buildSheet({ chapters, individuals: [], narration }, null);
    const named = (name: string) => Object.values(sheet.speakers).find((speaker) => speaker.name === name)!;
    expect(named("Soup Woman").lines.map((line) => line.text).join(" ")).not.toMatch(/Same shape/);
    expect(named("MossHome Runner").lines.map((line) => line.text).join(" ")).toMatch(/Same shape as here/);
    // Her own name still works.
    const again = buildSheet({ chapters, individuals: [], narration: [{ chapter: "g", address: "g/post/narration", text: '"Hello," says Soup Woman.' }] }, null);
    expect(Object.values(again.speakers).find((speaker) => speaker.name === "Soup Woman")!.lineCount).toBe(1);
  });
});

describe("matching a title-less name to a voice note, only when it is unambiguous", () => {
  const sheetOf = (notes: Record<string, string>, cast: string) =>
    buildSheet({ chapters: [{ id: "q", voiceGuide: { npcVoices: notes }, scenes: { s: { cast: [{ name: cast }] } } }], individuals: [], narration: [] }, null);
  const named = (sheet: ReturnType<typeof sheetOf>, name: string) => Object.values(sheet.speakers).filter((speaker) => speaker.name === name);

  it("does not pick a person when two voice notes share the given name", () => {
    const sheet = sheetOf({ "Sefa Tallgrass": "pride elder", "Sefa Dunmore": "a miller" }, "Elder Sefa");
    // Which Sefa? Nobody can say, so "Elder Sefa" stays her own entry and neither note absorbs her.
    expect(named(sheet, "Elder Sefa")).toHaveLength(1);
    expect(named(sheet, "Sefa Tallgrass")).toHaveLength(1);
    expect(named(sheet, "Sefa Dunmore")).toHaveLength(1);
  });

  it("only takes a title off the front of a name, not a word inside it", () => {
    const sheet = sheetOf({ "Sefa Tallgrass": "pride elder" }, "Sefa Mother");
    expect(named(sheet, "Sefa Mother")).toHaveLength(1);
    expect(named(sheet, "Sefa Tallgrass")).toHaveLength(1);
  });
});
