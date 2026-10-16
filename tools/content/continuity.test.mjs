/**
 * The continuity sweep, as a test (tools/content/continuity.mjs).
 *
 * Two halves. The first runs the sweep over EVERY campaign in
 * content/campaigns (ordered and graph alike, so the next campaign is covered
 * the day its file lands) and fails on any finding that is not in
 * continuity-allow.json, naming the chapter, the scene, the name and where
 * else the name appears. It also fails on a STALE allow-list entry (one no
 * finding matches any more): a list nobody prunes stops being read, and the
 * fix is deleting one line. The second half is small synthetic campaigns that
 * show the analysis does what it says, so a change to it is judged without
 * needing the real content to break first.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  REPO,
  analyse,
  analyseCampaign,
  analyseGraphCampaign,
  checkAllowList,
  describeFinding,
  extractNames,
  introducedNames,
  loadAllowList,
  loadCampaign,
  loadCampaigns,
} from "./continuity.mjs";

describe("continuity across every campaign", () => {
  const campaigns = loadCampaigns();
  const results = campaigns.map(({ campaign, chapters }) => ({ id: campaign.id, ...analyse(campaign, chapters) }));
  const allow = loadAllowList();
  const split = checkAllowList(results.flatMap((r) => r.findings), allow);

  it("sweeps every campaign file, Gemfall among them", () => {
    expect(campaigns.map((c) => c.campaign.id)).toContain("gemfall");
    expect(campaigns.length).toBeGreaterThanOrEqual(2);
  });

  it("has no dangling reference that is not allow-listed", () => {
    expect(split.unlisted.map((f) => `${describeFinding(f)}\n    allow-list key: ${f.key}`)).toEqual([]);
  });

  it("has no stale allow-list entry (delete the line)", () => {
    expect(split.stale).toEqual([]);
  });

  it("gives every allow-list entry a reason, and keeps the list short", () => {
    expect(split.noReason).toEqual([]);
    expect(Object.keys(allow).length).toBeLessThanOrEqual(80);
  });

  it("reaches every chapter and strands no road", () => {
    for (const r of results) {
      expect(r.unreached, r.id).toEqual([]);
      expect(r.stranded, r.id).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------------- */
/* A small synthetic campaign.                                                */

const scene = (narration, choices = [], extra = {}) => ({ type: "story", narration, choices, ...extra });
const go = (goto, label = "On", extra = {}) => ({ id: goto, label, icon: "arrow", goto, ...extra });
const set = (flag) => ({ type: "setFlag", flag, value: true });

function chapter(id, index, scenes, route) {
  return { id, index, entry: Object.keys(scenes)[0], ...(route ? { route } : {}), scenes };
}

/** Prose that makes Pellam, Gullet and Quill known words ("seen mid-sentence"). */
const PRIMER = scene("You wave at Pellam, then Gullet, then Quill.");

describe("detecting a dangling reference", () => {
  const diamond = (merge, mergeChoices = []) =>
    chapter("c1", 1, {
      start: scene("The road forks.", [go("left", "Left"), go("right", "Right")]),
      left: scene("Along the left, a clerk named Pellam stamps your pass.", [go("merge")]),
      right: scene("Along the right, nobody stamps anything.", [go("merge")]),
      merge: scene(merge, mergeChoices),
      primer: PRIMER,
    });
  const run = (chapters, routeSets = {}) => analyseCampaign({ id: "x", chapters: chapters.map((c) => c.id), routeSets }, chapters);

  it("names the scene and the name when one way in never showed it", () => {
    const { findings } = run([diamond("You see Pellam again.")]);
    expect(findings.map((f) => f.key)).toEqual(["c1/merge/Pellam"]);
    expect(describeFinding(findings[0])).toContain("c1 / merge");
    expect(describeFinding(findings[0])).toContain("also appears in: c1/left");
  });

  it("is quiet when every way in showed it", () => {
    const c = chapter("c1", 1, {
      start: scene("The road forks.", [go("left", "Left"), go("right", "Right")]),
      left: scene("A clerk named Pellam stamps your pass.", [go("merge")]),
      right: scene("A clerk named Pellam waves you on.", [go("merge")]),
      merge: scene("You see Pellam again."),
    });
    expect(run([c]).findings).toEqual([]);
  });

  it("is quiet when the scene introduces the name itself", () => {
    expect(run([diamond("A clerk named Pellam is here too.")]).findings).toEqual([]);
  });

  it("stops reporting once the introduction is put back, and starts when it is taken out", () => {
    const withIntro = chapter("c1", 1, {
      start: scene("Begin.", [go("a", "A"), go("b", "B")]),
      a: scene("Pellam, a clerk, is here.", [go("m")]),
      b: scene("Nobody is here.", [go("m")]),
      m: scene("Say hello to Pellam."),
    });
    // m is reached by a way that never showed Pellam, and by one that did.
    expect(run([withIntro]).findings.map((f) => f.key)).toEqual(["c1/m/Pellam"]);
    const bothShow = chapter("c1", 1, {
      start: scene("Begin.", [go("a", "A"), go("b", "B")]),
      a: scene("Pellam, a clerk, is here.", [go("m")]),
      b: scene("Pellam, a clerk, is also here.", [go("m")]),
      m: scene("Say hello to Pellam."),
    });
    expect(run([bothShow]).findings).toEqual([]);
  });

  it("does not report a name no way in has shown: that scene is coining it", () => {
    const c = chapter("c1", 1, { start: scene("You meet Quill at last."), primer: PRIMER });
    expect(run([c]).findings).toEqual([]);
  });

  it("treats a gated choice as proof of what its flag's setter showed", () => {
    const build = (gate) =>
      chapter("c1", 1, {
        start: scene("Begin.", [go("a", "A"), go("b", "B")]),
        a: scene("You meet Pellam on the stairs.", [go("m", "On", { effects: [set("met")] })]),
        b: scene("You meet nobody.", [go("m")]),
        m: scene("A landing.", [go("end", "Ask Pellam about it", gate)]),
        end: scene("Done."),
      });
    expect(run([build({ requiresFlag: "met" })]).findings).toEqual([]);
    expect(run([build({})]).findings.map((f) => f.key)).toEqual(["c1/m/Pellam"]);
  });

  it("drops a choice nobody can reach, instead of judging its label", () => {
    const c = chapter("c1", 1, {
      start: scene("Begin.", [go("a", "A"), go("b", "B")]),
      a: scene("You meet Pellam.", [go("m")]),
      b: scene("You meet nobody.", [go("m")]),
      m: scene("A landing.", [go("end", "Ask Pellam", { requiresFlag: "never_set" }), go("end", "Leave")]),
      end: scene("Done."),
    });
    expect(run([c]).findings).toEqual([]);
  });
});

describe("the road weave", () => {
  /*
   * Two roads, and the failed ford of the second one re-routes to the first,
   * exactly as 3C's failed ford sends a party to 4B/5B:
   *
   *   c1 : left  sets r_a and shows Gullet;  right sets r_b and does not.
   *   c2a: (r_a)  carries r_a through.
   *   c2b: (r_b)  "stay" shows Quill and carries r_b; "ford" fails, sets r_a.
   *   c3 : reads the flags.
   */
  const sets = { road: ["r_a", "r_b"] };
  const base = (c3) => [
    chapter("c1", 1, {
      start: scene("Choose.", [go("left", "Left"), go("right", "Right")]),
      left: scene("Gullet poles you along.", [go("end_a")], { onEnter: [set("r_a")] }),
      right: scene("A long quiet walk.", [go("end_b")], { onEnter: [set("r_b")] }),
      end_a: scene("Done."),
      end_b: scene("Done."),
      primer: PRIMER,
    }),
    chapter("c2a", 2, { start: scene("The A road."), }, { set: "road", flag: "r_a" }),
    chapter(
      "c2b",
      2,
      {
        start: scene("The B road forks.", [go("stay", "Stay"), go("ford", "Try the ford")]),
        stay: scene("Quill waves from the bank.", [go("end_stay")]),
        end_stay: scene("Done."),
        ford: scene("The ford fails.", [go("end_ford")]),
        end_ford: scene("Done.", [], { onEnter: [set("r_a")] }),
      },
      { set: "road", flag: "r_b" },
    ),
    c3,
  ];
  const run = (c3) => {
    const chapters = base(c3);
    return analyseCampaign({ id: "x", chapters: chapters.map((c) => c.id), routeSets: sets }, chapters);
  };

  it("reaches the chapter the failed ford re-routes to, from either road", () => {
    const { unreached, stranded } = run(chapter("c3", 3, { start: scene("The end.") }));
    expect(unreached).toEqual([]);
    expect(stranded).toEqual([]);
  });

  it("does not let a road flag prove which earlier chapter was played", () => {
    // r_a holders: left -> c2a (Gullet) and right -> c2b -> ford (no Gullet).
    const c3 = chapter("c3", 3, {
      start: scene("The gate.", [go("end", "Thank Gullet", { requiresFlag: "r_a" }), go("end", "Leave")]),
      end: scene("Done."),
    });
    expect(run(c3).findings.map((f) => f.key)).toEqual(["c3/start/Gullet"]);
  });

  it("proves a road flag from the histories that END holding it, not every one that visited its chapter", () => {
    // r_b holders all took "stay" in c2b and saw Quill; c2b's ford path is a
    // c2b history too, but it ends holding r_a. Credit it to r_b and Quill
    // would look unproven.
    const gated = chapter("c3", 3, {
      start: scene("The gate.", [go("end", "Wave to Quill", { requiresFlag: "r_b" }), go("end", "Leave")]),
      end: scene("Done."),
    });
    expect(run(gated).findings).toEqual([]);
    // Ungated, the same label is a real merge-point dangle: some parties did see Quill.
    const ungated = chapter("c3", 3, {
      start: scene("The gate.", [go("end", "Wave to Quill"), go("end", "Leave")]),
      end: scene("Done."),
    });
    expect(run(ungated).findings.map((f) => f.key)).toEqual(["c3/start/Quill"]);
  });
});

describe("reading names", () => {
  const vocab = { lower: new Set(["then", "gate"]), midCaps: new Set(["Gullet", "Gate"]) };

  it("takes capitalised words mid-sentence and drops ordinary sentence openers", () => {
    expect([...extractNames("Then you meet Gullet at the Gate.", vocab)].sort()).toEqual(["Gate", "Gullet"]);
  });

  it("keeps a sentence-opening name the rest of the text capitalises", () => {
    expect([...extractNames("Gullet stops poling.", vocab)]).toEqual(["Gullet"]);
  });

  it("reads the introductions authors actually write", () => {
    expect([...introducedNames("a clerk named Pellam")]).toEqual(["Pellam"]);
    expect([...introducedNames("a frogfolk ferrywoman called Gullet")]).toEqual(["Gullet"]);
    expect([...introducedNames("Tibbet, a goblin with a ledger")]).toEqual(["Tibbet"]);
    expect([...introducedNames("his daughter Posy on his shoulders")]).toEqual(["Posy"]);
  });
});

describe("the allow-list", () => {
  const finding = (key) => ({ key, chapter: "c", scene: "s", name: "n", elsewhere: [] });

  it("splits findings and reports stale and reasonless entries", () => {
    const out = checkAllowList([finding("a/b/C"), finding("a/b/D")], { "a/b/C": "reason", "a/b/Gone": "reason", "a/b/Blank": " " });
    expect(out.allowed.map((f) => f.key)).toEqual(["a/b/C"]);
    expect(out.unlisted.map((f) => f.key)).toEqual(["a/b/D"]);
    expect(out.stale.sort()).toEqual(["a/b/Blank", "a/b/Gone"]);
    expect(out.noReason).toEqual(["a/b/Blank"]);
  });
});

/* ------------------------------------------------------------------------- */
/* #160: `when` gates, narration variants, text tokens.                       */

describe("when conditions and variants", () => {
  const run = (c) => analyseCampaign({ id: "x", chapters: [c.id], routeSets: {} }, [c]);
  const grant = (itemId) => ({ type: "grantItem", itemId, to: "party" });
  /** Two ways to `m`; only the left one shows Pellam and sets/grants something. */
  const fork = (mScene, leftEffects = []) =>
    chapter("c1", 1, {
      start: scene("Begin.", [go("a", "A"), go("b", "B")]),
      a: scene("You meet Pellam on the stairs.", [go("m", "On", { effects: leftEffects })]),
      b: scene("You meet nobody.", [go("m")]),
      m: mScene,
      end: scene("Done."),
      primer: PRIMER,
    });
  const ask = (when) => scene("A landing.", [go("end", "Ask Pellam about it", when ? { when } : {}), go("end", "Leave")]);

  it("treats when.flag, when.item and when.count (min >= 1) like requiresFlag / requiresItem", () => {
    expect(run(fork(ask({ flag: "met" }), [set("met")])).findings).toEqual([]);
    expect(run(fork(ask({ item: "pass" }), [grant("pass")])).findings).toEqual([]);
    expect(run(fork(ask({ count: { of: "pass", min: 1 } }), [grant("pass")])).findings).toEqual([]);
    expect(run(fork(ask({ count: { of: ["pass", "seal"], min: 1 } }), [grant("pass"), grant("seal")])).findings).toEqual([]);
  });

  it("proves nothing from notFlag, notItem, count max, or partySize", () => {
    for (const when of [{ notFlag: "x" }, { notItem: "pass" }, { count: { of: "pass", max: 0 } }, { partySize: { min: 2 } }, undefined]) {
      expect(run(fork(ask(when), [set("met")])).findings.map((f) => f.key)).toEqual(["c1/m/Pellam"]);
    }
  });

  it("drops a when-gated choice that can never hold", () => {
    expect(run(fork(ask({ flag: "never_set" }))).findings).toEqual([]);
  });

  it("checks names in variant text against what the variant's own when proves", () => {
    const withVariant = (when) =>
      fork(scene("A landing.", [go("end")], { variants: [{ when, text: "Pellam waves." }] }), [set("met")]);
    expect(run(withVariant({ flag: "met" })).findings).toEqual([]);
    expect(run(withVariant({ partySize: { min: 2 } })).findings.map((f) => f.key)).toEqual(["c1/m/Pellam"]);
    expect(run(withVariant({ flag: "never_set" })).findings).toEqual([]);
  });

  it("does not count variant text as showing a name downstream, unless always true or replacing", () => {
    const after = (variants) =>
      chapter("c1", 1, {
        start: scene("Begin.", [go("a", "A"), go("b", "B")]),
        a: scene("You meet Pellam.", [go("m")]),
        b: scene("You meet nobody.", [go("m")], variants ? { variants } : {}),
        m: scene("A landing.", [go("n")]),
        n: scene("You wave at Pellam."),
        primer: PRIMER,
      });
    const conditional = [{ when: { flag: "x" }, text: "Pellam is here too." }];
    expect(run(after(conditional)).findings.map((f) => f.key)).toContain("c1/n/Pellam");
    expect(run(after([{ when: {}, text: "Pellam is here too." }])).findings).toEqual([]);
    // A replacing variant stands in for the base: it cannot make up for a base that skips the name.
    expect(run(after([{ when: { flag: "x" }, text: "Pellam is here too.", replace: true }])).findings.map((f) => f.key)).toContain("c1/n/Pellam");
  });

  it("does not read {facets} or {party} as names", () => {
    expect([...extractNames("You hold {facets} and tell {party} about it.", { lower: new Set(), midCaps: new Set(["Facets", "Party"]) })]).toEqual([]);
    expect([...introducedNames("called {party}")]).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* Graph campaigns: places and ways, in any order.                           */

describe("a graph campaign", () => {
  /** A one-scene chapter that ends at once. */
  const solo = (id, narration, extra = {}) => chapter(id, 1, { start: scene(narration, [], extra), primer: PRIMER });
  const graph = (nodes, edges, more = {}) => ({
    id: "g",
    chapters: [],
    graph: { version: 1, entry: Object.keys(nodes)[0], nodes, edges, ...more },
  });
  const run = (campaign, chapters) => analyseGraphCampaign({ ...campaign, chapters: chapters.map((c) => c.id) }, chapters);
  const edge = (from, to, extra = {}) => ({ from, to, kind: "forward", ...extra });

  /*
   *   hub --> left  (meets Pellam) --> door
   *   hub --> right (meets nobody) --> door
   */
  const diamond = (doorNarration, doorEdge = {}) => [
    graph(
      { hub: { chapter: "hub" }, left: { chapter: "left" }, right: { chapter: "right" }, door: { chapter: "door" } },
      {
        a: edge("hub", "left", { label: "Go left" }),
        b: edge("hub", "right", { label: "Go right" }),
        c: edge("left", "door", { label: "On" }),
        d: edge("right", "door", { label: "On", ...doorEdge }),
      },
    ),
    [
      solo("hub", "A crossroads."),
      solo("left", "A clerk named Pellam stamps your pass."),
      solo("right", "Nobody stamps anything."),
      solo("door", doorNarration),
    ],
  ];

  it("names a place that one way in never introduced", () => {
    const { findings, unreached } = run(...diamond("Pellam is at the door."));
    expect(findings.map((f) => f.key)).toEqual(["door/start/Pellam"]);
    expect(unreached).toEqual([]);
  });

  it("is quiet when the place introduces the name itself", () => {
    expect(run(...diamond("A clerk named Pellam is at the door.")).findings).toEqual([]);
  });

  it("treats `completed` on a way in as proof of what that place showed", () => {
    expect(run(...diamond("Pellam is at the door.", { when: { completed: "left" } })).findings).toEqual([]);
    // `visited` proves only the way INTO the place: a visit may not have reached Pellam yet.
    expect(run(...diamond("Pellam is at the door.", { when: { visited: "left" } })).findings.map((f) => f.key)).toEqual([
      "door/start/Pellam",
    ]);
  });

  it("counts what a way's own label shows", () => {
    expect(run(...diamond("Pellam is at the door.", { label: "Follow Pellam's footprints" })).findings).toEqual([]);
  });

  it("proves a journey flag from every setter of it, wherever it is in the graph", () => {
    const build = (gate) => [
      graph(
        { hub: { chapter: "hub" }, left: { chapter: "left" }, right: { chapter: "right" }, door: { chapter: "door" } },
        { a: edge("hub", "left"), b: edge("hub", "right"), c: edge("left", "door"), d: edge("right", "door") },
        { flags: ["met_pellam"] },
      ),
      [
        solo("hub", "A crossroads."),
        chapter("left", 1, {
          start: scene("A clerk named Pellam stamps your pass.", [go("end", "Thank him", { effects: [set("met_pellam")] })]),
          end: scene("Done."),
        }),
        solo("right", "Nobody stamps anything."),
        chapter("door", 1, {
          start: scene("A door.", [go("end", "Ask Pellam to open it", gate), go("end", "Knock")]),
          end: scene("Done."),
          primer: PRIMER,
        }),
      ],
    ];
    expect(run(...build({ requiresFlag: "met_pellam" })).findings).toEqual([]);
    expect(run(...build({})).findings.map((f) => f.key)).toEqual(["door/start/Pellam"]);
  });

  it("does not mistake a return to a place for a citation of what it coined", () => {
    // The hub coins Quill on the first visit; a party back from the side trip knows Quill only from here.
    const campaign = graph(
      { hub: { chapter: "hub" }, side: { chapter: "side" } },
      { out: edge("hub", "side", { kind: "sideways" }), back: edge("side", "hub", { kind: "return", label: "Back to Quill's" }) },
    );
    expect(run(campaign, [solo("hub", "You meet Quill at the well."), solo("side", "A quiet field.")]).findings).toEqual([]);
  });

  it("judges a node variant from the ways that reach it, plus what its own `when` proves", () => {
    const campaign = (when) =>
      graph(
        {
          hub: { chapter: "hub", variants: [{ chapter: "hub-late", when }] },
          left: { chapter: "left" },
          right: { chapter: "right" },
        },
        {
          a: edge("hub", "left"),
          b: edge("hub", "right"),
          c: edge("left", "hub", { kind: "return" }),
          d: edge("right", "hub", { kind: "return" }),
        },
      );
    const chapters = [
      // No primer at the hub: what the hub itself shows is left out of a variant's ways in.
      chapter("hub", 1, { start: scene("A crossroads.") }),
      solo("hub-late", "Pellam waits at the crossroads."),
      solo("left", "A clerk named Pellam stamps your pass."),
      solo("right", "Nobody stamps anything."),
    ];
    expect(run(campaign({ visit: { min: 2 } }), chapters).findings.map((f) => f.key)).toEqual(["hub-late/start/Pellam"]);
    expect(run(campaign({ completed: "left" }), chapters).findings).toEqual([]);
  });

  it("settles possible knowledge too, when an optional introduction reaches a variant a round late", () => {
    /*
     *   hub --> w           (w-late, on a return, waves to Pellam)
     *   hub --> x --> y --(return)--> x --(sideways)--> w
     *
     * y may introduce Pellam, on one branch only, and the only way that
     * possibility reaches w-late is round the loop through x-late. The sweep
     * meets w before x, and nothing here is guaranteed, so every K is empty
     * from the first round. A sweep that stopped when K stopped, reading M as
     * it stood then, could judge w-late's merge point with M from before the
     * loop was walked (PR #223 review). M is now computed from the graph before
     * the fixed point, and the fixed point compares K and M both: the finding
     * is there and the sweep reports it settled.
     */
    const late = { visit: { min: 2 } };
    const campaign = graph(
      {
        hub: { chapter: "hub" },
        w: { chapter: "w", variants: [{ chapter: "w-late", when: late }] },
        x: { chapter: "x", variants: [{ chapter: "x-late", when: late }] },
        y: { chapter: "y" },
      },
      {
        a: edge("hub", "w"),
        b: edge("hub", "x"),
        c: edge("x", "y"),
        d: edge("y", "x", { kind: "return" }),
        e: edge("x", "w", { kind: "sideways" }),
      },
    );
    const chapters = [
      chapter("hub", 1, { start: scene("A crossroads.") }),
      chapter("w", 1, { start: scene("A well.") }),
      chapter("w-late", 1, { start: scene("The well again.", [go("end", "Wave to Pellam"), go("end", "Walk on")]), end: scene("Done.") }),
      chapter("x", 1, { start: scene("A bridge.") }),
      chapter("x-late", 1, { start: scene("The bridge again.") }),
      chapter("y", 1, {
        start: scene("A market.", [go("meet", "Look around"), go("quiet", "Keep walking")]),
        meet: scene("A clerk named Pellam waves.", [go("end")]),
        quiet: scene("Nobody waves.", [go("end")]),
        end: scene("Done."),
        primer: PRIMER,
      }),
    ];
    const result = run(campaign, chapters);
    expect(result.findings.map((f) => f.key)).toEqual(["w-late/start/Pellam"]);
    expect(result.settled).toBe(true);
  });

  it("lets a node variant coin a name a return brings back round the loop", () => {
    // n2 is the only chapter that mentions Pellam, and it introduces him. A party
    // back from q has never seen n2, so the name cannot have reached it from there.
    const campaign = graph(
      { hub: { chapter: "hub" }, n: { chapter: "n", variants: [{ chapter: "n2", when: { visit: { min: 2 } } }] }, q: { chapter: "q" } },
      { a: edge("hub", "n"), b: edge("n", "q"), c: edge("q", "n", { kind: "return" }) },
    );
    const chapters = [
      chapter("hub", 1, { start: scene("A crossroads.") }),
      chapter("n", 1, { start: scene("A bridge.") }),
      chapter("n2", 1, { start: scene("Back at the bridge, you meet Pellam, who waves. Pellam smiles.") }),
      chapter("q", 1, { start: scene("A field.") }),
    ];
    expect(run(campaign, chapters).findings).toEqual([]);
  });

  it("is what `analyse` runs for a campaign with a graph", () => {
    const [campaign, chapters] = diamond("Pellam is at the door.");
    expect(analyse({ ...campaign, chapters: chapters.map((c) => c.id) }, chapters).findings.map((f) => f.key)).toEqual([
      "door/start/Pellam",
    ]);
  });
});

describe("the Continental Rift slice (the worked graph campaign)", () => {
  const fixtures = join(REPO, "packages", "shared", "src", "fixtures");
  const { campaign, chapters } = loadCampaign("continental-rift", REPO, {
    file: join(fixtures, "continental-rift.campaign.json"),
    chapters: join(fixtures, "continental-rift", "chapters"),
  });
  const result = analyse(campaign, chapters);

  it("plays every chapter from some way in, and settles", () => {
    expect(result.unreached).toEqual([]);
    expect(result.settled).toBe(true);
  });

  it("finds only the Great River, and says why each one is or is not real", () => {
    /*
     * cr-heart/scene_door: real by the rule. A party can go Exchange -> tear ->
     * glacier -> blue door without ever reading "the Great River"; only the
     * meltwater way home names it. A real campaign would introduce it in the
     * door scene or allow-list it as world geography.
     *
     * cr-exchange-flooded/scene_flood: the analysis's limit. The flooded
     * Exchange is chosen by a world fact (`great-river: surging`) that only
     * the glacier sets, so in play it is always first entered down the
     * meltwater way, whose label names the river. Facts prove nothing here,
     * so the return from the marsh still counts as a way in.
     */
    expect(result.findings.map((f) => f.key)).toEqual(["cr-exchange-flooded/scene_flood/Great", "cr-heart/scene_door/Great"]);
  });
});
