/**
 * Graph campaigns (#192): the mode, the parser, and the read-side rules a
 * journey is judged by.
 *
 * Most cases bend the Rift Sampler (fixtures/rift-sampler.campaign.json), the
 * illustrative branching-and-cycle graph the authoring doc walks through, so
 * the rules are checked against the shape the doc promises rather than a stub.
 * The last block is the other half of the contract: the ordered campaigns that
 * ship — Gemfall above all — read exactly as they did before graphs existed.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  arrivalAt,
  CAMPAIGN_GRAPH_VERSION,
  campaignMode,
  chapterAtNode,
  evaluateGraphCondition,
  exitAvailability,
  exitsFrom,
  journeyFlags,
  parseCampaignGraph,
  type ParsedCampaignGraph,
} from "./campaign-graph.js";
import { beatCount, chapterFor } from "./routes.js";
import type { Campaign, Chapter } from "./types/chapter.js";
import type { JourneyFacts } from "./types/campaign-graph.js";

const read = (url: URL): unknown => JSON.parse(readFileSync(url, "utf8"));
const REPO = new URL("../../../", import.meta.url);

/** A fresh copy each time, so a test that bends it bends only its own. */
function sampler(): Campaign {
  return read(new URL("./fixtures/rift-sampler.campaign.json", import.meta.url)) as Campaign;
}

function parsed(): ParsedCampaignGraph {
  const { graph, problems } = parseCampaignGraph(sampler());
  expect(problems).toEqual([]);
  return graph!;
}

/** The problems a bent sampler has, as `path: problem` lines. */
function problemsAfter(bend: (campaign: Campaign) => void): string[] {
  const campaign = sampler();
  bend(campaign);
  const { graph, problems } = parseCampaignGraph(campaign);
  // A declaration with problems never produces a graph: a holder of one may
  // assume every id resolves.
  if (problems.length > 0) expect(graph).toBeNull();
  return problems.map(({ path, problem }) => `${path}: ${problem}`);
}

describe("campaignMode", () => {
  it("is ordered without a graph — the legacy reading, and Gemfall's", () => {
    expect(campaignMode({})).toBe("ordered");
    expect(campaignMode({ graph: undefined })).toBe("ordered");
  });

  it("is graph with one", () => {
    expect(campaignMode(sampler())).toBe("graph");
  });
});

describe("journeyFlags", () => {
  it("is the route set members for an ordered campaign: the flags that already carry", () => {
    expect(journeyFlags({ routeSets: { road: ["route_wild", "route_river"] } })).toEqual(["route_river", "route_wild"]);
    expect(journeyFlags({})).toEqual([]);
  });

  it("widens with graph.flags, sorted and once each", () => {
    const campaign = sampler();
    campaign.routeSets = { pact: ["pact_kept", "pact_broken"], echo: ["found_the_lens", "lens_lost"] };
    expect(journeyFlags(campaign)).toEqual(["found_the_lens", "lens_lost", "mill_wheel_turning", "pact_broken", "pact_kept"]);
  });
});

describe("parseCampaignGraph: the sampler", () => {
  it("parses clean", () => {
    const graph = parsed();
    expect(graph.version).toBe(CAMPAIGN_GRAPH_VERSION);
    expect(graph.entry).toBe("waystone");
  });

  it("keeps authored order for nodes, edges and every node's exits", () => {
    const graph = parsed();
    expect(graph.nodeOrder).toEqual(["waystone", "orchard", "mill", "quarry", "tower", "dawn-gate", "long-road-home"]);
    expect(graph.exits.waystone).toEqual(["to-orchard", "to-quarry"]);
    expect(graph.exits.orchard).toEqual(["orchard-to-mill", "orchard-to-waystone", "orchard-to-tower"]);
    expect(graph.exits.quarry).toEqual(["quarry-to-tower", "quarry-to-home", "quarry-to-waystone"]);
    expect(graph.entrances.tower).toEqual(["orchard-to-tower", "quarry-to-tower"]);
    // Every node has a key, even one nothing leaves.
    expect(graph.exits["dawn-gate"]).toEqual([]);
    expect(graph.entrances.waystone).toEqual(["orchard-to-waystone", "quarry-to-waystone"]);
  });

  it("fills the defaults, so no reader re-derives them", () => {
    const graph = parsed();
    expect(graph.nodes.quarry!.revisit).toBe("replay");
    expect(graph.nodes.waystone!.revisit).toBe("pass");
    expect(graph.edges["to-orchard"]!.blocked).toBe("hidden");
    expect(graph.edges["orchard-to-tower"]!.blocked).toBe("shown");
  });

  it("lists the endings and the journey flags", () => {
    const graph = parsed();
    expect(graph.endings).toEqual(["dawn-gate", "long-road-home"]);
    expect(graph.flags).toEqual(["found_the_lens", "mill_wheel_turning"]);
  });

  it("is the shape the acceptance asks for: a branch, a sideways move, a cycle through a return, a guard, two endings", () => {
    const graph = parsed();
    const kinds = (node: string) => graph.exits[node]!.map((id) => graph.edges[id]!.kind);
    expect(kinds("waystone")).toEqual(["forward", "forward"]);
    expect(kinds("orchard")).toContain("sideways");
    // orchard -> mill -> orchard, closed by a return edge.
    expect(graph.edges["orchard-to-mill"]!.to).toBe("mill");
    expect(graph.edges["mill-to-orchard"]).toMatchObject({ to: "orchard", kind: "return" });
    expect(graph.edges["quarry-to-tower"]!.when).toEqual({ flag: "found_the_lens" });
    expect(graph.endings).toHaveLength(2);
  });
});

describe("parseCampaignGraph: what it refuses", () => {
  it("reads nothing past a version it does not know", () => {
    expect(
      problemsAfter((c) => {
        (c.graph as { version: number }).version = 2;
        c.graph!.entry = "nowhere";
      }),
    ).toEqual(["/graph/version: graph version 2 is not one this build reads (it reads 1)"]);
  });

  it("refuses a graph that is not an object, or has no nodes, or no edges object", () => {
    expect(problemsAfter((c) => ((c as { graph: unknown }).graph = "graph"))).toEqual(["/graph: graph must be an object"]);
    expect(problemsAfter((c) => (c.graph!.nodes = {}))).toEqual(["/graph/nodes: a graph needs at least one node"]);
    expect(problemsAfter((c) => ((c.graph as { edges: unknown }).edges = []))).toEqual([
      "/graph/edges: edges must be an object keyed by edge id",
    ]);
  });

  it("refuses an entry that is not a node", () => {
    expect(problemsAfter((c) => (c.graph!.entry = "nowhere"))).toEqual(['/graph/entry: entry "nowhere" is not a node']);
  });

  it("refuses a node or variant chapter the campaign does not list, and a listed chapter nothing plays", () => {
    const out = problemsAfter((c) => {
      c.graph!.nodes.quarry!.chapter = "sampler-quary";
      c.graph!.nodes.orchard!.variants![0]!.chapter = "sampler-orchard-drowned";
    });
    expect(out).toEqual([
      '/graph/nodes/orchard/variants/0/chapter: chapter "sampler-orchard-drowned" is not in the campaign\'s chapters list',
      '/graph/nodes/quarry/chapter: chapter "sampler-quary" is not in the campaign\'s chapters list',
      '/chapters/2: chapter "sampler-orchard-flooded" is listed but no graph node plays it',
      '/chapters/4: chapter "sampler-quarry" is listed but no graph node plays it',
    ]);
  });

  it("refuses an edge whose ends are not nodes", () => {
    expect(
      problemsAfter((c) => {
        c.graph!.edges["to-orchard"]!.to = "orchid";
        c.graph!.edges["to-quarry"]!.from = "wayston";
      }),
    ).toEqual(['/graph/edges/to-orchard/to: no node "orchid"', '/graph/edges/to-quarry/from: no node "wayston"']);
  });

  it("refuses an exit from an ending, and a graph with no ending", () => {
    expect(
      problemsAfter((c) => {
        c.graph!.edges.loop = { from: "dawn-gate", to: "waystone", kind: "return" };
      }),
    ).toEqual(['/graph/edges/loop/from: "dawn-gate" is an ending, and an ending has no exits']);
    expect(
      problemsAfter((c) => {
        delete c.graph!.nodes["dawn-gate"]!.ending;
        delete c.graph!.nodes["long-road-home"]!.ending;
      }),
    ).toEqual(["/graph/nodes: no node is an ending, so no attempt could ever complete"]);
  });

  it("refuses guards and effects that name what is not there", () => {
    const out = problemsAfter((c) => {
      c.graph!.edges["to-orchard"]!.when = {
        flag: "lens_found",
        notFlag: "mill_wheel_turning",
        visited: ["quarry", "querry"],
        notCompleted: "toewr",
        traversed: "to-mil",
        notTraversed: ["to-quarry"],
      };
      c.graph!.edges["to-quarry"]!.effects = [
        { type: "setFlag", flag: "lens_found" },
        { type: "unlock", edge: "secret" },
        { type: "lock", edge: "to-orchard" },
      ];
    });
    expect(out).toEqual([
      '/graph/edges/to-orchard/when/flag: "lens_found" is not a journey flag (declare it in graph.flags or a routeSets entry)',
      '/graph/edges/to-orchard/when/visited: no node "querry"',
      '/graph/edges/to-orchard/when/notCompleted: no node "toewr"',
      '/graph/edges/to-orchard/when/traversed: no edge "to-mil"',
      '/graph/edges/to-quarry/effects/0/flag: "lens_found" is not a journey flag (declare it in graph.flags or a routeSets entry)',
      '/graph/edges/to-quarry/effects/1/edge: no edge "secret"',
    ]);
  });

  it("accepts a route set member as a journey flag", () => {
    expect(
      problemsAfter((c) => {
        c.routeSets = { pact: ["pact_kept", "pact_broken"] };
        c.graph!.edges["to-orchard"]!.when = { flag: "pact_kept" };
      }),
    ).toEqual([]);
  });

  it("is total over malformed input: wrong types are problems, never throws", () => {
    const out = problemsAfter((c) => {
      const graph = c.graph as unknown as Record<string, Record<string, unknown>>;
      graph.nodes!.quarry = "quarry";
      graph.edges!["to-orchard"] = 7;
      (graph.edges!["to-quarry"] as Record<string, unknown>).when = "always";
      (graph.edges!["orchard-to-mill"] as Record<string, unknown>).effects = [{ type: "teleport" }];
    });
    expect(out).toEqual(
      expect.arrayContaining([
        "/graph/nodes/quarry: a node must be an object",
        "/graph/edges/to-orchard: an edge must be an object",
        "/graph/edges/to-quarry/when: a condition must be an object",
        '/graph/edges/orchard-to-mill/effects/0/type: unknown graph effect "teleport"',
      ]),
    );
  });

  it("escapes ids into the JSON pointer", () => {
    const out = problemsAfter((c) => {
      c.graph!.edges["a/b~c"] = { from: "x", to: "waystone", kind: "forward" };
    });
    expect(out).toContain('/graph/edges/a~1b~0c/from: no node "x"');
  });

  it("says nothing about an ordered campaign", () => {
    expect(parseCampaignGraph({ chapters: ["a"] })).toEqual({ graph: null, problems: [] });
  });
});

describe("evaluateGraphCondition", () => {
  const journey: JourneyFacts = {
    visits: { waystone: 2, orchard: 1 },
    completions: { waystone: 1, orchard: 1 },
    outcomes: { waystone: "success", orchard: "setback" },
    traversed: { "to-orchard": 1 },
    flags: { mill_wheel_turning: true, found_the_lens: false },
  };

  it("holds when absent or empty", () => {
    expect(evaluateGraphCondition(undefined, {})).toBe(true);
    expect(evaluateGraphCondition({}, {})).toBe(true);
  });

  it("reads flags as the chapters' Condition does: only true is set", () => {
    expect(evaluateGraphCondition({ flag: "mill_wheel_turning" }, journey)).toBe(true);
    expect(evaluateGraphCondition({ flag: "found_the_lens" }, journey)).toBe(false);
    expect(evaluateGraphCondition({ notFlag: "found_the_lens" }, journey)).toBe(true);
    expect(evaluateGraphCondition({ notFlag: "mill_wheel_turning" }, journey)).toBe(false);
    expect(evaluateGraphCondition({ flag: "anything" }, {})).toBe(false);
  });

  it("distinguishes visited from completed", () => {
    // Entered and not finished is visited, not completed — the quarry run
    // that dropped mid-chapter.
    const midway: JourneyFacts = { visits: { quarry: 1 } };
    expect(evaluateGraphCondition({ visited: "quarry" }, midway)).toBe(true);
    expect(evaluateGraphCondition({ completed: "quarry" }, midway)).toBe(false);
    expect(evaluateGraphCondition({ notCompleted: "quarry" }, midway)).toBe(true);
    expect(evaluateGraphCondition({ notVisited: "quarry" }, midway)).toBe(false);
  });

  it("needs every listed id", () => {
    expect(evaluateGraphCondition({ visited: ["waystone", "orchard"] }, journey)).toBe(true);
    expect(evaluateGraphCondition({ visited: ["waystone", "mill"] }, journey)).toBe(false);
    expect(evaluateGraphCondition({ notVisited: ["mill", "quarry"] }, journey)).toBe(true);
    expect(evaluateGraphCondition({ notVisited: ["mill", "orchard"] }, journey)).toBe(false);
    expect(evaluateGraphCondition({ completed: ["waystone", "orchard"] }, journey)).toBe(true);
    expect(evaluateGraphCondition({ traversed: "to-orchard" }, journey)).toBe(true);
    expect(evaluateGraphCondition({ traversed: ["to-orchard", "to-quarry"] }, journey)).toBe(false);
    expect(evaluateGraphCondition({ notTraversed: "to-quarry" }, journey)).toBe(true);
    expect(evaluateGraphCondition({ notTraversed: "to-orchard" }, journey)).toBe(false);
  });

  it("reads outcome off the subject, and fails without one", () => {
    expect(evaluateGraphCondition({ outcome: "setback" }, journey, "orchard")).toBe(true);
    expect(evaluateGraphCondition({ outcome: "setback" }, journey, "waystone")).toBe(false);
    expect(evaluateGraphCondition({ outcome: "success" }, journey, "mill")).toBe(false);
    expect(evaluateGraphCondition({ outcome: "success" }, journey)).toBe(false);
  });

  it("ANDs every field", () => {
    expect(evaluateGraphCondition({ flag: "mill_wheel_turning", completed: "orchard" }, journey)).toBe(true);
    expect(evaluateGraphCondition({ flag: "mill_wheel_turning", completed: "mill" }, journey)).toBe(false);
  });
});

describe("exits", () => {
  it("are open from the start where nothing stands in the way", () => {
    const graph = parsed();
    expect(exitsFrom(graph, "waystone", {})).toEqual([
      { edge: "to-orchard", to: "orchard", kind: "forward", availability: { available: true }, visible: true },
      { edge: "to-quarry", to: "quarry", kind: "forward", availability: { available: true }, visible: true },
    ]);
  });

  it("hide when blocked unless authored shown — the house rule, with its exception", () => {
    const graph = parsed();
    const fromOrchard = exitsFrom(graph, "orchard", {});
    expect(fromOrchard.map((exit) => [exit.edge, exit.availability, exit.visible])).toEqual([
      ["orchard-to-mill", { available: true }, true],
      ["orchard-to-waystone", { available: true }, true],
      ["orchard-to-tower", { available: false, reason: "locked" }, true],
    ]);
    const fromQuarry = exitsFrom(graph, "quarry", { outcomes: { quarry: "success" } });
    expect(fromQuarry.map((exit) => [exit.edge, exit.visible])).toEqual([
      ["quarry-to-tower", false],
      ["quarry-to-home", false],
      ["quarry-to-waystone", true],
    ]);
  });

  it("open a locked edge once unlocked, and close any edge once locked", () => {
    const graph = parsed();
    expect(exitAvailability(graph, "orchard-to-tower", { edges: { "orchard-to-tower": "open" } })).toEqual({ available: true });
    expect(exitAvailability(graph, "to-orchard", { edges: { "to-orchard": "locked" } })).toEqual({ available: false, reason: "locked" });
  });

  it("spend a once edge after one crossing", () => {
    const graph = parsed();
    expect(exitAvailability(graph, "to-quarry", { traversed: { "to-quarry": 1 } })).toEqual({ available: false, reason: "spent" });
    // An ordinary edge is never spent.
    expect(exitAvailability(graph, "to-orchard", { traversed: { "to-orchard": 4 } })).toEqual({ available: true });
  });

  it("close into a closed node once it is completed, not before", () => {
    const graph = parsed();
    expect(exitAvailability(graph, "orchard-to-mill", { visits: { mill: 1 } })).toEqual({ available: true });
    expect(exitAvailability(graph, "orchard-to-mill", { completions: { mill: 1 } })).toEqual({ available: false, reason: "closed" });
  });

  it("follow their guard, reading outcome off the edge's from", () => {
    const graph = parsed();
    expect(exitAvailability(graph, "quarry-to-tower", { flags: { found_the_lens: true } })).toEqual({ available: true });
    expect(exitAvailability(graph, "quarry-to-home", { outcomes: { quarry: "setback" } })).toEqual({ available: true });
    expect(exitAvailability(graph, "quarry-to-home", { outcomes: { quarry: "success" } })).toEqual({ available: false, reason: "guard" });
  });

  it("report the first block in a fixed order, so the screen says one true thing", () => {
    const graph = parsed();
    graph.edges["to-quarry"]!.when = { flag: "found_the_lens" };
    graph.nodes.quarry!.revisit = "closed";
    const everything: JourneyFacts = { edges: { "to-quarry": "locked" }, traversed: { "to-quarry": 1 }, completions: { quarry: 1 } };
    expect(exitAvailability(graph, "to-quarry", everything)).toEqual({ available: false, reason: "locked" });
    expect(exitAvailability(graph, "to-quarry", { ...everything, edges: {} })).toEqual({ available: false, reason: "spent" });
    expect(exitAvailability(graph, "to-quarry", { ...everything, edges: {}, traversed: {} })).toEqual({ available: false, reason: "closed" });
    expect(exitAvailability(graph, "to-quarry", {})).toEqual({ available: false, reason: "guard" });
  });

  it("treat an unknown edge or node as nothing to take", () => {
    const graph = parsed();
    expect(exitAvailability(graph, "nowhere", {})).toEqual({ available: false, reason: "locked" });
    expect(exitsFrom(graph, "nowhere", {})).toEqual([]);
  });
});

describe("visits and revisits", () => {
  it("anything not yet completed is a new visit, whatever its revisit policy says", () => {
    const graph = parsed();
    for (const node of ["waystone", "orchard", "mill"]) expect(arrivalAt(graph, node, {})).toBe("new");
    // Entered but never finished — a dropped session — is still new: the
    // journey resumes that visit rather than arriving again.
    expect(arrivalAt(graph, "mill", { visits: { mill: 1 } })).toBe("new");
  });

  it("a completed node answers by its policy", () => {
    const graph = parsed();
    const done: JourneyFacts = { completions: { waystone: 1, orchard: 1, mill: 1 } };
    expect(arrivalAt(graph, "waystone", done)).toBe("pass");
    expect(arrivalAt(graph, "orchard", done)).toBe("replay");
    expect(arrivalAt(graph, "mill", done)).toBe("closed");
  });

  it("plays the first variant that holds, else the node's chapter", () => {
    const graph = parsed();
    expect(chapterAtNode(graph, "orchard", {})).toBe("sampler-orchard");
    expect(chapterAtNode(graph, "orchard", { flags: { mill_wheel_turning: true } })).toBe("sampler-orchard-flooded");
    expect(chapterAtNode(graph, "quarry", { flags: { mill_wheel_turning: true } })).toBe("sampler-quarry");
    expect(chapterAtNode(graph, "nowhere", {})).toBeNull();
  });

  it("reads a variant's outcome off its own node", () => {
    const graph = parsed();
    graph.nodes.quarry!.variants = [{ chapter: "sampler-tower", when: { outcome: "setback" } }];
    expect(chapterAtNode(graph, "quarry", { outcomes: { quarry: "setback" } })).toBe("sampler-tower");
    expect(chapterAtNode(graph, "quarry", { outcomes: { orchard: "setback" } })).toBe("sampler-quarry");
  });
});

// ---------------------------------------------------------------------------

describe("ordered campaigns are untouched (legacy regression)", () => {
  const campaign = (id: string) => read(new URL(`content/campaigns/${id}.json`, REPO)) as Campaign;
  const chapter = (id: string) => read(new URL(`content/chapters/${id}.json`, REPO)) as Chapter;

  it.each(["gemfall", "the-hollow-crown"])("%s has no graph, is ordered, and parses to nothing", (id) => {
    const shipped = campaign(id);
    expect(shipped).not.toHaveProperty("graph");
    expect(campaignMode(shipped)).toBe("ordered");
    expect(parseCampaignGraph(shipped)).toEqual({ graph: null, problems: [] });
  });

  it("Gemfall still tours eight index-ordered beats, routed by flag", () => {
    const gemfall = campaign("gemfall");
    const chapters = gemfall.chapters.map(chapter);
    expect(beatCount(chapters)).toBe(8);
    const tour = (flags: Record<string, boolean>) =>
      [1, 2, 3, 4, 5, 6, 7, 8].map((index) => chapterFor(chapters, index, flags)?.id ?? null);
    expect(tour({ route_river: true, pursuit_restore: true })).toEqual([
      "gemfall-01", "gemfall-02", "gemfall-03a", "gemfall-04a", "gemfall-05a", "gemfall-06", "gemfall-07r", "gemfall-08",
    ]);
    expect(tour({ route_wild: true, pursuit_hoard: true })).toEqual([
      "gemfall-01", "gemfall-02", "gemfall-03b", "gemfall-04b", "gemfall-05b", "gemfall-06", "gemfall-07h", "gemfall-08",
    ]);
    // No road yet: a routed beat still refuses rather than guesses.
    expect(tour({})[2]).toBeNull();
  });

  it("Gemfall's carried flags are exactly its route set members, as before", () => {
    const gemfall = campaign("gemfall");
    expect(journeyFlags(gemfall)).toEqual(Object.values(gemfall.routeSets ?? {}).flat().sort());
  });
});
