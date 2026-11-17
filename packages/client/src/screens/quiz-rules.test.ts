/**
 * The quiz's screen rules (docs/trivia.md §3.5, §4.1, §5.1): each question's
 * picture as this device draws it, and held back offline when it is not on
 * the phone; what the Quiz button says when there is nothing to ask; what a
 * new rung is called; and a quiz title on her shelf, "From the quiz", at once.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { TRIVIA_LOOK_SOURCE, emptyTriviaRecord, type FieldGuide, type HeroLookView, type LookCatalog, type TriviaLadder, type TriviaQuestion, type TriviaRecord } from "@kad/shared";
import { QUIZ_EMPTY_WORDS, newlyReached, pickRound, pictureOnPhone, quizEmptyReason, quizOfflineArt, quizPicture, rungRewardWords, triviaLookRungs, withTriviaLooks } from "./quiz-rules";

const GUIDE: FieldGuide = {
  version: 1,
  entries: {
    "creature.bone_crawler": { id: "creature.bone_crawler", category: "creatures", kind: "creature", title: "Bone Crawler", art: "/assets/entities/bone_crawler/assembled.png" },
    "biome.sallow_wastelands": { id: "biome.sallow_wastelands", category: "places", kind: "biome", title: "The Sallow Wastelands", art: "/assets/biomes/sallow_wastelands/bg.webp" },
    "class.thornguard": { id: "class.thornguard", category: "classes", kind: "class", title: "Thornguard" },
  },
};

function q(id: string, entry: string, over: Partial<TriviaQuestion> = {}): TriviaQuestion {
  return { id, entry, ask: "What?", answer: "Yes", wrong: ["A", "B", "C", "D", "E"], also: [], link: "entry", ...over };
}

const BANK = [q("creature.bone_crawler.shell", "creature.bone_crawler"), q("biome.sallow_wastelands.dust", "biome.sallow_wastelands"), q("class.thornguard.gear", "class.thornguard")];
const find = (at = "2026-11-01T00:00:00.000Z") => ({ firstFoundBy: "p_1", foundAt: at });
const FOUND = { "creature.bone_crawler": find(), "biome.sallow_wastelands": find(), "class.thornguard": find() };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a question's picture", () => {
  it("is a figure as on its guide card, a place as its backdrop (half size on a phone), a class as its gear portrait", () => {
    expect(quizPicture(BANK[0]!, GUIDE, true)).toEqual({ src: "/assets/entities/bone_crawler/assembled.png", painting: "/assets/entities/bone_crawler/assembled.png", place: false });
    expect(quizPicture(BANK[1]!, GUIDE, false)).toMatchObject({ src: "/assets/biomes/sallow_wastelands/bg.webp", place: true });
    expect(quizPicture(BANK[2]!, GUIDE, true)).toMatchObject({ src: "/assets/gear-portraits/thornguard/sworn/bigfoot.png", place: false });
    // Another page's painting, when the question names one.
    expect(quizPicture(q("x.y.z", "class.thornguard", { image: "creature.bone_crawler", also: ["creature.bone_crawler"] }), GUIDE)?.src).toBe("/assets/entities/bone_crawler/assembled.png");
    expect(quizPicture(q("x.y.z", "creature.nobody"), GUIDE)).toBeNull();
  });

  it("is what the book saves while there is a signal", () => {
    expect(quizOfflineArt(GUIDE, ["biome.sallow_wastelands", "class.thornguard"], false)).toEqual([
      "/assets/biomes/sallow_wastelands/bg.webp",
      "/assets/gear-portraits/thornguard/sworn/bigfoot.png",
    ]);
    expect(quizOfflineArt(null, ["class.thornguard"])).toEqual([]);
  });

  it("is held back offline unless the phone kept it", async () => {
    const picture = { src: "/assets/biomes/a/bg@0.5x.webp", painting: "/assets/biomes/a/bg.webp", place: true };
    expect(await pictureOnPhone(picture)).toBe(picture.src);
    vi.stubGlobal("navigator", { onLine: false });
    const match = vi.fn(async (url: string) => (url === picture.painting ? new Response("") : undefined));
    vi.stubGlobal("caches", { match });
    expect(await pictureOnPhone(picture)).toBe(picture.painting);
    expect(match).toHaveBeenCalledWith(picture.src, { ignoreSearch: true });
    vi.stubGlobal("caches", { match: async () => undefined });
    expect(await pictureOnPhone(picture)).toBeNull();
    const round = await pickRound(BANK, GUIDE, FOUND, emptyTriviaRecord(), "r_1");
    expect(round).toEqual([]);
  });
});

describe("a round", () => {
  it("asks up to eight questions the household has found and she has not mastered", async () => {
    const record: TriviaRecord = { ...emptyTriviaRecord(), mastered: { "class.thornguard.gear": { at: "2026-11-02T00:00:00.000Z", firstTry: true } } };
    const round = await pickRound(BANK, GUIDE, { "creature.bone_crawler": find(), "class.thornguard": find() }, record, "r_1");
    expect(round.map((r) => r.id)).toEqual(["creature.bone_crawler.shell"]);
    expect(round[0]).toMatchObject({ picture: "/assets/entities/bone_crawler/assembled.png", place: false });
  });
});

describe("the Quiz button with nothing to ask", () => {
  it("says why", () => {
    const none = emptyTriviaRecord();
    expect(quizEmptyReason(BANK, FOUND, none, 3)).toBeNull();
    expect(quizEmptyReason(BANK, {}, none, 0)).toBe("nothing-yet");
    const all: TriviaRecord = { ...none, mastered: Object.fromEntries(BANK.map((x) => [x.id, { at: "2026-11-02T00:00:00.000Z", firstTry: true }])) };
    expect(quizEmptyReason(BANK, FOUND, all, 0)).toBe("all-done");
    expect(QUIZ_EMPTY_WORDS["all-done"]).toBe("You've answered everything you've found. Go find more!");
    // Some left, none askable just now: offline without their pictures.
    expect(quizEmptyReason(BANK, FOUND, none, 0)).toBe("resting");
    expect(QUIZ_EMPTY_WORDS.resting).toBe("Some questions need their pictures. Open your book with a signal, then come back.");
  });
});

const CATALOG: LookCatalog = {
  coats: [],
  specials: [],
  nameplates: [],
  titles: [
    { id: "the_learned", text: "the Learned", unlock: { from: "trivia", rung: 25 } },
    { id: "the_brave", text: "the Brave", unlock: { from: "starter" } },
  ],
} as unknown as LookCatalog;

const LADDER: TriviaLadder = {
  rungs: [
    { at: 1, badge: { id: "trivia-1", name: "Curious Reader", blurb: "One right." } },
    { at: 2, title: "the_learned" },
  ],
  firstTry: [{ at: 1, badge: { id: "trivia-first-1", name: "Sharp Memory", blurb: "First ask." } }],
};

describe("rewards", () => {
  it("names each rung newly reached, on both tracks", () => {
    const reached = newlyReached({ mastered: 1, firstTry: 0 }, { mastered: 2, firstTry: 1 }, LADDER);
    expect(reached.map((r) => r.at)).toEqual([2, 1]);
    expect(reached.flatMap((r) => rungRewardWords(r, CATALOG))).toEqual(["You earned the title the Learned!", "You earned the Sharp Memory badge!"]);
    expect(newlyReached({ mastered: 2, firstTry: 1 }, { mastered: 2, firstTry: 1 }, LADDER)).toEqual([]);
  });

  it("puts a quiz title on her shelf, from the quiz, as soon as she has enough right", () => {
    const look: HeroLookView = { revision: 1, coat: null, accent: null, special: null, nameplate: null, title: null, unlocked: [] };
    const mastered = (n: number): TriviaRecord => ({ ...emptyTriviaRecord(), mastered: Object.fromEntries(Array.from({ length: n }, (_, i) => [`q.${String(i)}.x`, { at: "2026-11-02T00:00:00.000Z", firstTry: true }])) });
    expect(triviaLookRungs(mastered(24), CATALOG)).toEqual([]);
    expect(triviaLookRungs(mastered(25), CATALOG)).toEqual([25]);
    // A rung the server granted stands whatever the count.
    expect(triviaLookRungs({ ...emptyTriviaRecord(), rungs: [25] }, CATALOG)).toEqual([25]);
    const shown = withTriviaLooks(look, [25], CATALOG);
    expect(shown.unlocked).toEqual(["the_learned"]);
    expect(shown.sources).toEqual({ the_learned: TRIVIA_LOOK_SOURCE });
    expect(TRIVIA_LOOK_SOURCE).toBe("From the quiz");
    // Already written by the server: as it is.
    expect(withTriviaLooks(shown, [25], CATALOG)).toBe(shown);
    expect(withTriviaLooks(look, [], CATALOG)).toBe(look);
  });
});
