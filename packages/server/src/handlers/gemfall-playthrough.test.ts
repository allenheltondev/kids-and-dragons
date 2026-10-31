/**
 * Gemfall, played — every chapter, start to finish, through the real server.
 *
 * `content:validate` proves each chapter is a sound graph and the wiring test
 * proves each one sets the forks it owes. Neither proves the campaign is
 * *playable*: that a party who started chapter 1 on a Tuesday can keep tapping
 * "Begin the adventure" and arrive, eight evenings later, at an ending — with
 * the road they took and the pursuit they declared steering them into the
 * right files on the way, through every fight, without the engine refusing a
 * tap or stranding them at a beat with nothing to start.
 *
 * So this plays it. A three-player party drives `applyAction` exactly as the
 * phones do — votes, rolls, item swaps, combat turns through `legalActions` —
 * and continues the campaign with CONTINUE_CAMPAIGN after each chapter. Choices
 * are random under a seed, and the party's species change per seed so the
 * species gates get walked too. Every run must end the campaign: completed, or
 * failed by setbacks. Never stuck.
 *
 * Below the random parties, three STEERED ones (#166) play it again as a
 * particular kind of table: empty-handed, full-collection and solo. The driver
 * and the steering live in playthrough-driver.ts; what the table was shown is
 * recorded and judged by narration-audit.ts, so content work (#162-#165) can
 * run the same checks while it is being written:
 *
 *   KAD_AUDIT_REPORT=1 npx vitest run packages/server/src/handlers/gemfall-playthrough.test.ts
 *
 * prints every current offender (chapter / scene / line) per party. The
 * assertions are active: a failure names the chapter, the scene and the line.
 */

import { describe, expect, it } from "vitest";
import path from "node:path";
import { chapterStartDiscoveries, fillTokens, type Chapter } from "@kad/shared";
import { loadContent } from "../content/loader.ts";
import {
  EMPTY_HANDED,
  FULL_COLLECTION,
  FULL_COLLECTION_BEFORE_8,
  SOLO,
  FULL_HANDED_AT_7,
  onPursuit,
  playCampaign,
  type PartyPlan,
  type Playthrough,
} from "./playthrough-driver.ts";
import {
  countVariantScenesShown,
  facetNamesOf,
  findOffenders,
  heldFacets,
  formatOffenders,
  type AuditLine,
  type AuditRule,
} from "./narration-audit.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));

/**
 * Choice ids a seed's party always takes when offered. Everything else is
 * random. The Collection's Walk is one pursuit out of three and then one
 * choice out of two, so leaving it to the dice makes "some party walked"
 * a coin toss that any content change can flip; one party is held to it.
 */
const STEERED: Record<number, readonly string[]> = { 1: ["hoard", "walk"] };

describe("Gemfall can be played from the Exchange to the mountain", () => {
  const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
  const runs: Playthrough[] = [];

  for (const seed of SEEDS) {
    it(`seed ${seed} reaches an ending of the campaign`, { timeout: 60_000 }, async () => {
      const run = await playCampaign(content, seed, { label: "random", steer: STEERED[seed] });
      runs.push(run);
      expect(["complete", "failed"]).toContain(run.status);
      // Whatever size the table was, no line counts a party that is not that size (#165).
      const miscounted = findOffenders(run.lines, { facetNames, rules: ["counted_party"] });
      expect(miscounted, formatOffenders(miscounted)).toEqual([]);

      // The household's Field Guide holds exactly what the road walked revealed
      // — every chapter's biome, every creature fought — once each, credited
      // to somebody at the table.
      expect(new Set(Object.keys(run.book))).toEqual(run.expectedFinds);
      for (const id of Object.keys(run.book)) expect(run.possibleFinds).toContain(id);
      for (const find of Object.values(run.book)) expect(run.playerIds).toContain(find.firstFoundBy);
      // Implicit finds need no tagging: chapter 1's biome is always there.
      const opening = content.chapter("gemfall-01")!;
      for (const id of chapterStartDiscoveries(opening, content.world())) expect(run.book).toHaveProperty([id]);
      expect(Object.keys(run.book).length).toBeGreaterThan(0);
      // The snowhorn goat (#169). The Tether's rope bridge puts it on stage on
      // every road through 07l, so a Tether run always finds it. On the Restore
      // it is optional (borrow it for the haul, or take the goat path round the
      // slide), so only those runs are held to it, below.
      if (run.chapters.includes("gemfall-07l")) expect(run.book).toHaveProperty(["creature.snowhorn_goat"]);
      if (run.status === "complete") {
        // A finished campaign toured one chapter per beat, in order — all
        // eight, or seven when the Collection took the Walk at the tree line.
        expect(run.chapters[0]).toBe("gemfall-01");
        const last = run.chapters[run.chapters.length - 1];
        if (run.chapters.length === 7) expect(last).toBe("gemfall-07h");
        else expect(run.chapters, "a campaign of eight beats").toHaveLength(8);
        if (run.chapters.length === 8) expect(last).toBe("gemfall-08");
      }
    });
  }

  it("between them, the runs took every road and every pursuit", () => {
    const visited = new Set(runs.flatMap((r) => r.chapters));
    for (const id of ["gemfall-03a", "gemfall-03b", "gemfall-03c", "gemfall-07r", "gemfall-07h", "gemfall-07l"]) {
      expect(visited, `no run entered ${id}`).toContain(id);
    }
    // And the Restore's goat (#169) was met by some run that took a goat road.
    expect(runs.some((r) => r.chapters.includes("gemfall-07r") && "creature.snowhorn_goat" in r.book)).toBe(true);
    // And at least one Collection party took the Walk and finished there.
    expect(runs.some((r) => r.status === "complete" && r.chapters.length === 7)).toBe(true);
  });
});

// --- steered parties (#166) -------------------------------------------------------

const facetNames = facetNamesOf(content.items() as never);
const FINALE = content.chapter("gemfall-08") as Chapter;

/** One play per (party, seed), shared by every assertion that needs it. */
const plays = new Map<string, Promise<Playthrough>>();
function play(plan: PartyPlan, seed: number): Promise<Playthrough> {
  const key = `${plan.label}#${seed}`;
  if (!plays.has(key)) plays.set(key, playCampaign(content, seed, plan));
  return plays.get(key)!;
}

const SEEDS_OF = new Map<PartyPlan, number[]>([
  [EMPTY_HANDED, [1, 2, 3, 4, 5, 6]],
  [FULL_COLLECTION, [1, 2, 3, 4, 5, 6]],
  [SOLO, [1, 2, 3, 4, 5, 6]],
]);
const seedsOf = (plan: PartyPlan) => SEEDS_OF.get(plan)!;

/**
 * Fails with every offender of `rules` across the party's seeds, each naming
 * the chapter, the scene and the line. With KAD_AUDIT_REPORT set it prints
 * the same list instead of asserting, for content work to read.
 */
async function expectNoOffenders(plan: PartyPlan, rules: AuditRule[], band = false) {
  const found: string[] = [];
  for (const seed of seedsOf(plan)) {
    const run = await play(plan, seed);
    const offenders = findOffenders(run.lines, { facetNames, rules, ...(band ? { band: { chapter: FINALE } } : {}) });
    if (offenders.length) found.push(`${plan.label}, seed ${seed}: ${formatOffenders(offenders)}`);
  }
  if (process.env["KAD_AUDIT_REPORT"]) console.log(`[${plan.label}] ${rules.join(",")}\n${found.join("\n") || "no offenders"}`);
  else expect(found, found.join("\n")).toEqual([]);
}

/** Facets the road gave a party, chapter 1 to 7 (the finale closes the case, and a top-up is not the road). */
const gained = (run: Playthrough) =>
  run.facetLog.filter((f) => f.chapterId !== "gemfall-08").reduce((n, f) => n + (f.atEnd - f.atStart), 0);

describe("Gemfall, played by steered parties (#166)", { timeout: 60_000 }, () => {
  describe("what a chapter's first scene shows", () => {
    it("is the party the chapter opens with (strip and top-up land before the entry scene)", async () => {
      for (const plan of [EMPTY_HANDED, FULL_COLLECTION]) {
        for (const seed of seedsOf(plan)) {
          const run = await play(plan, seed);
          for (const f of run.facetLog) {
            const first = run.lines.find((l) => l.chapterId === f.chapterId && l.kind === "narration")!;
            expect(heldFacets(first.party).size, `${plan.label}, seed ${seed}: ${f.chapterId} entry scene`).toBe(f.atStart);
          }
        }
      }
    });
  });

  describe("the empty-handed party", () => {
    it("refuses what it can, hands the rest back, and reaches an ending", async () => {
      let kept = 0;
      let collected = 0;
      for (const seed of seedsOf(EMPTY_HANDED)) {
        const run = await play(EMPTY_HANDED, seed);
        expect(["complete", "failed"], `seed ${seed}`).toContain(run.status);
        // Stripped in the lobby every evening after the first: nobody opens a chapter holding one.
        for (const f of run.facetLog) expect(f.atStart, `seed ${seed} opens ${f.chapterId} holding facets`).toBe(0);
        // It reached the finale, or the audit would be about a shorter road.
        expect(run.chapters, `seed ${seed}`).toContain("gemfall-08");
        expect(run.lines.length, "something was recorded").toBeGreaterThan(100);
        kept += gained(run);
        collected += gained(await play(FULL_COLLECTION, seed));
      }
      // What it still gains is only what no choice can refuse (onEnter grants, dice-decided ones).
      expect(kept, "the empty-handed party took as many facets as the collectors").toBeLessThan(collected);
    });

    it("sees no unfilled {token}", () => expectNoOffenders(EMPTY_HANDED, ["unfilled_token"]));

    it("is never counted as a party of another size (#165)", () => expectNoOffenders(EMPTY_HANDED, ["counted_party"]));

    it("is never shown a stone it does not hold, or a count other than 'no' (#162/#163/#164)", () =>
      expectNoOffenders(EMPTY_HANDED, ["stones_not_held"]));
  });

  describe("the full collection", () => {
    it("takes what is offered and starts the finale with at least nine facets", async () => {
      for (const seed of seedsOf(FULL_COLLECTION)) {
        const run = await play(FULL_COLLECTION, seed);
        expect(["complete", "failed"], `seed ${seed}`).toContain(run.status);
        expect(run.chapters[run.chapters.length - 1], `seed ${seed}`).toBe("gemfall-08");
        // Every road gave the facet its chapter offers: the count never falls going into the finale.
        let held = 0;
        for (const f of run.facetLog) {
          if (f.chapterId === "gemfall-08") break;
          expect(f.atStart, `seed ${seed}: ${f.chapterId} opened below what the road had given`).toBeGreaterThanOrEqual(held);
          held = Math.max(held, f.atEnd);
        }
        expect(held, `seed ${seed}: the road gave nothing`).toBeGreaterThanOrEqual(5);
        // No road yields nine before chapter 8 (one a chapter in 1-6, and in 7 only the Caravan Stone is new:
        // seven or eight), so the driver seeds the household up to nine before the finale; `topUps` is how many.
        const opened = run.facetLog.find((f) => f.chapterId === "gemfall-08")!.atStart;
        expect(opened, `seed ${seed}: reached ${held}, topped up ${run.topUps}`).toBeGreaterThanOrEqual(FULL_COLLECTION_BEFORE_8);
      }
    });

    it("sees no unfilled {token}", () => expectNoOffenders(FULL_COLLECTION, ["unfilled_token"]));

    it("is never counted as a party of another size (#165)", () => expectNoOffenders(FULL_COLLECTION, ["counted_party"]));

    // gemfall-08's band variants (`count.min >= 5`): in the climb and the ending always, and at
    // the Seal-Keeper on the roads that meet one (seed 5 loses the race check and never does).
    it("sees its band text in the climb, at the Seal-Keeper and in the ending (#163)", () =>
      expectNoOffenders(FULL_COLLECTION, ["band_text_missing"], true));
  });

  describe("the solo party", () => {
    it("plays chapters 6 to 8 alone, to an ending", async () => {
      for (const seed of seedsOf(SOLO)) {
        const run = await play(SOLO, seed);
        expect(["complete", "failed"], `seed ${seed}`).toContain(run.status);
        for (const id of ["gemfall-06", "gemfall-08"]) expect(run.chapters, `seed ${seed}`).toContain(id);
        expect(run.chapters.some((id) => id.startsWith("gemfall-07")), `seed ${seed}`).toBe(true);
        expect(run.playerIds).toHaveLength(1);
        for (const line of run.lines) expect(line.party.members, `${line.chapterId}/${line.sceneId}`).toHaveLength(1);
      }
    });

    it("sees no unfilled {token}", () => expectNoOffenders(SOLO, ["unfilled_token"]));

    it("is never counted as 'two of you', 'three of you', 'four of you' or 'both of you', or as 'each of you' (#165)", () =>
      expectNoOffenders(SOLO, ["counted_party"]));
  });
});

// --- the Collection and the Tether, steered (#164) ----------------------------------

/**
 * The parties above all take the Restore, so 07h and 07l are walked here: the
 * same plans with the pursuit overridden, at no facets (the empty-handed party,
 * stripped every evening) and at nine or more (topped up as chapter 7 opens).
 * Each must reach an ending, trip no audit rule, and show count-gated wording
 * (a variant with `count` in its `when`) in at least three scenes of the chapter.
 */
describe("Gemfall, the Collection and the Tether, played at both ends of the haul (#164)", { timeout: 60_000 }, () => {
  // Upstream content changes move these seeded parties' dice. A legitimate
  // chapter-7 setback may close before three count-gated scenes. Audit every
  // line on that route, require three on each success, and retain aggregate
  // coverage across the seeds rather than replacing an unlucky seed.
  const SEEDS = [2, 3, 4];
  const RULES: AuditRule[] = ["stones_not_held", "counted_party", "unfilled_token"];
  const cases = [
    { chapterId: "gemfall-07h", pursuit: "hoard" as const },
    { chapterId: "gemfall-07l", pursuit: "leash" as const },
  ];
  const levels = [
    { name: "no facets", base: EMPTY_HANDED, check: (n: number) => n === 0 },
    { name: "nine or more facets", base: FULL_HANDED_AT_7, check: (n: number) => n >= FULL_COLLECTION_BEFORE_8 },
  ];

  for (const { chapterId, pursuit } of cases) {
    for (const level of levels) {
      it(`${chapterId} at ${level.name}: reaches an ending, clean, with count-gated wording in 3+ scenes`, async () => {
        const plan = onPursuit(level.base, pursuit);
        const chapter = content.chapter(chapterId) as Chapter;
        const covered = new Set<string>();
        for (const seed of SEEDS) {
          const run = await playCampaign(content, seed, plan);
          expect(["complete", "failed"], `seed ${seed}`).toContain(run.status);
          expect(run.chapters, `seed ${seed}`).toContain(chapterId);
          expect(run.chapters, `seed ${seed}: only the chosen pursuit`).not.toContain(chapterId === "gemfall-07h" ? "gemfall-07l" : "gemfall-07h");
          expect(run.chapters, `seed ${seed}`).not.toContain("gemfall-07r");
          const opened = run.facetLog.find((f) => f.chapterId === chapterId)!.atStart;
          expect(level.check(opened), `seed ${seed}: opened ${chapterId} holding ${opened}`).toBe(true);
          const offenders = findOffenders(run.lines, { facetNames, rules: RULES });
          expect(offenders, `seed ${seed}: ${formatOffenders(offenders)}`).toEqual([]);
          const shown = countVariantScenesShown(run.lines, chapter);
          for (const id of shown) covered.add(id);
          if (shown.size < 3) {
            expect(run.outcomes[run.chapters.indexOf(chapterId)], `seed ${seed}: only a real setback may end before the third count scene`).toBe("setback");
            const ending = chapterId === "gemfall-07h" ? "ending_robbed" : "ending_lost_in_echoes";
            expect(run.lines.some(line => line.chapterId === chapterId && line.sceneId === ending)).toBe(true);
          }
        }
        expect(covered.size, `${chapterId}: count-gated scene coverage across all seeds`).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it("07h's Walk (the campaign-ending choice) is taken and ends the campaign cleanly", async () => {
    const run = await playCampaign(content, 2, onPursuit(FULL_HANDED_AT_7, "hoard", true));
    expect(run.status).toBe("complete");
    expect(run.chapters[run.chapters.length - 1]).toBe("gemfall-07h");
    expect(run.chapters).toHaveLength(7);
    const offenders = findOffenders(run.lines, { facetNames, rules: RULES });
    expect(offenders, formatOffenders(offenders)).toEqual([]);
  });
});

describe("the narration audit itself", () => {
  const member = (questItems: string[]) => ({ species: "unicorn", inventory: [], questItems });
  const line = (text: string, held: string[] = [], size = 3, extra: Partial<AuditLine> = {}): AuditLine => ({
    chapterId: "gemfall-00",
    sceneId: "scene_x",
    kind: "narration",
    text,
    party: { members: Array.from({ length: size }, (_, i) => member(i === 0 ? held : [])) as never, flags: {} },
    ...extra,
  });
  const rules = (text: string, held: string[] = [], size = 3) =>
    findOffenders([line(text, held, size)], {
      facetNames,
      rules: ["stones_not_held", "counted_party", "unfilled_token"],
    }).map((o) => o.rule);

  it("flags a stone named, or counted, that the party does not hold", () => {
    expect(rules("You find the Ford Stone.")).toEqual(["stones_not_held"]);
    expect(rules("You find the Ford Stone.", ["facet_ford"])).toEqual([]);
    expect(rules("You carry no great stones.")).toEqual(["stones_not_held"]);
    expect(rules("You carry five great stones.", ["facet_ford"])).toEqual(["stones_not_held"]);
    expect(rules("You carry one great stone.", ["facet_ford"])).toEqual([]);
    expect(rules("The wardens hold the stones.")).toEqual([]);
  });

  describe("counted party wording, at every party size (#165)", () => {
    const flagged = (text: string, size: number) => rules(text, [], size).filter((r) => r === "counted_party");
    // What `{party}` renders at each size, and what a writer might type by hand.
    const valid: Record<number, string[]> = {
      1: ["You hear it.", "You alone hear it."],
      2: ["Both of you hear it.", "The two of you hear it.", "Two of you hear it.", "Each of you hears it.", "One of you hears it."],
      3: ["All three of you hear it.", "The three of you hear it.", "Three of you hear it.", "All of you hear it.", "Each of you hears it."],
      4: ["All four of you hear it.", "The four of you hear it.", "Four of you hear it.", "One of you hears it."],
    };
    const invalid: Record<number, string[]> = {
      1: ["Both of you hear it.", "The two of you hear it.", "All three of you hear it.", "All four of you hear it.", "Each of you hears it.", "One of you hears it.", "All of you hear it."],
      2: ["All three of you hear it.", "All four of you hear it.", "Three of you hear it."],
      3: ["Both of you hear it.", "The two of you hear it.", "All four of you hear it.", "Two of you hear it."],
      4: ["Both of you hear it.", "All three of you hear it.", "Three of you hear it."],
    };

    for (const size of [1, 2, 3, 4]) {
      it(`accepts wording that counts ${size} and flags wording that counts anything else`, () => {
        for (const text of valid[size]!) expect(flagged(text, size), `"${text}" at ${size}`).toEqual([]);
        for (const text of invalid[size]!) expect(flagged(text, size), `"${text}" at ${size}`).toEqual(["counted_party"]);
      });
    }

    it("passes what {party} renders at each size", () => {
      for (const size of [1, 2, 3, 4]) {
        const text = fillTokens("Plainly, {party} hear it.", {
          members: Array.from({ length: size }, () => member([])) as never,
          flags: {},
        });
        expect(flagged(text, size), text).toEqual([]);
      }
    });

    it("says which count it heard and which party it was shown to", () => {
      const [offence] = findOffenders([line("Both of you hear it.", [], 3)], { facetNames, rules: ["counted_party"] });
      expect(offence!.why).toContain("Both of you");
      expect(offence!.why).toContain("three");
    });

    it("excuses a player and an NPC, at any size", () => {
      for (const size of [1, 2, 3]) {
        expect(flagged("A mule looks at you. You look at the mule. Neither of you tells anybody.", size)).toEqual([]);
        expect(flagged("The goat lies down too. Neither of you says anything for a while.", size)).toEqual([]);
      }
      // Without the NPC, the same words are a count again.
      expect(flagged("Neither of you tells anybody.", 1)).toEqual(["counted_party"]);
    });
  });

  it("flags an unfilled token", () => {
    expect(rules("It is {facets} stones.")).toContain("unfilled_token");
    expect(rules("Plain words.")).toEqual([]);
  });

  it("names the chapter, the scene and the line", () => {
    const text = formatOffenders(findOffenders([line("Both of you hear it.", [], 1)], { facetNames, rules: ["counted_party"] }));
    expect(text).toContain("gemfall-00 / scene_x");
    expect(text).toContain("Both of you hear it.");
  });

  it("wants band text where a band variant holds", () => {
    const chapter = {
      id: "gemfall-08",
      scenes: {
        scene_keeper: {
          type: "story",
          narration: "Base.",
          choices: [],
          variants: [{ when: { count: { of: "facet_*", min: 5 } }, text: "Band." }],
        },
      },
    } as unknown as Chapter;
    const nine = Array.from({ length: 9 }, (_, i) => `facet_${i}`);
    const opts = { facetNames, rules: ["band_text_missing"] as AuditRule[], band: { chapter } };
    const keeper = (text: string) => line(text, nine, 3, { chapterId: "gemfall-08", sceneId: "scene_keeper" });
    expect(findOffenders([keeper("Base.")], opts).some((o) => o.sceneId === "scene_keeper")).toBe(true);
    const shown = findOffenders([keeper("Base.\n\nBand.")], opts);
    expect(shown.some((o) => o.sceneId === "scene_keeper")).toBe(false);
    // Climb and ending have no band scene in this toy chapter, and say so.
    expect(shown.map((o) => o.sceneId).sort()).toEqual(["(climb)", "(ending)"]);
  });
});
