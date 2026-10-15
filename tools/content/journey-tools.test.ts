/**
 * The graph campaign inspection and playtest gate (#202).
 *
 * Three things are held here, and they are different kinds of test:
 *
 *   1. THE GATE. Every graph campaign in the repo — each fixture in
 *      packages/shared/src/fixtures and each graph campaign under
 *      content/campaigns (there are none yet, and the loop is what makes the
 *      first one arrive already covered) — is linted, explored, and walked
 *      through the real runtime. Nothing may be unreachable, every node, edge
 *      and ending must be covered by some playthrough, no softlock may exist,
 *      and every invariant must hold on every step. This is what `npm test`
 *      (and so CI) runs; a graph campaign that cannot be walked end to end
 *      does not merge.
 *
 *   2. THE FIXTURES THAT PROVE THE TOOL. `journey-ci` is the one small graph
 *      with a sideways move, a revisited hub, a place that changes, a
 *      single-use road and a single-use rift; the tool must report each as
 *      what it is. A handful of deliberately broken graphs (built in-test, so
 *      no broken campaign file ever sits in the repo) prove the other
 *      direction: unreachable nodes and softlocks are *reported*, with the
 *      path that reaches them, by the same code that says "clean" above.
 *
 *   3. THE ORDERED CAMPAIGNS. Gemfall and the Hollow Crown are seen and
 *      skipped, never inspected, never changed: their files, their chapter
 *      viewer output and their validation are none of this tool's business.
 *
 * Existing issue #167's continuity sweep (dangling names in prose) is not
 * repeated here: it reads ordered campaigns' chapters, and a graph's prose is
 * a separate question. What a graph adds that the sweep cannot see is the
 * walkability of the graph itself, which is this file.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  completeVisit,
  campaignMode,
  exploreCampaignGraph,
  lintCampaignGraph,
  parseCampaignGraph,
  startJourney,
  takeExit,
} from "@kad/shared";
import type { Campaign, GraphEdge, GraphNode, JourneyState, ParsedCampaignGraph } from "@kad/shared";
import {
  REPO_ROOT,
  campaignFiles,
  chapterFlagsFrom,
  isGraphSubject,
  loadChapters,
  outline,
  readSubject,
  toDot,
  toMermaid,
  toSummary,
} from "./journey-graph.ts";
import type { GraphSubject } from "./journey-graph.ts";
import { exploreRoutes, playtest, randomWalk, replayState, scriptedWalk, stateChain } from "./journey-explore.ts";
import { checkJourneySave } from "./journey-save.ts";

const FIXTURES = campaignFiles().fixtures;
const CONTENT = campaignFiles().content;
const CHAPTERS = loadChapters();

type GraphCampaignSubject = GraphSubject & { graph: ParsedCampaignGraph };

const subject = (stem: string): GraphCampaignSubject => {
  const found = readSubject(path.join(REPO_ROOT, "packages", "shared", "src", "fixtures", `${stem}.campaign.json`));
  if (!isGraphSubject(found)) throw new Error(`${stem} is not a graph campaign`);
  return found;
};

const explorerOptions = (s: GraphSubject) => ({ chapterFlags: chapterFlagsFrom(CHAPTERS), routeSets: s.campaign.routeSets });

// ===========================================================================
// 1. The gate
// ===========================================================================

describe("the gate — every graph campaign in the repo", () => {
  it("sees the fixtures (the gate is not vacuous)", () => {
    const stems = FIXTURES.map((file) => path.basename(file));
    expect(stems).toEqual(expect.arrayContaining(["journey-ci.campaign.json", "rift-sampler.campaign.json"]));
  });

  const graphFiles = [...FIXTURES, ...CONTENT].filter((file) => {
    const read = readSubject(file);
    return campaignMode(read.campaign) === "graph";
  });

  for (const file of graphFiles) {
    const name = path.relative(REPO_ROOT, file);
    describe(name, () => {
      const s = readSubject(file);

      it("declares a graph that parses with no problems", () => {
        expect(s.problems).toEqual([]);
        expect(isGraphSubject(s)).toBe(true);
      });

      it("lints without an error and the search runs to completion", () => {
        const { findings, search } = lintCampaignGraph(s.graph!, explorerOptions(s));
        expect(findings.filter((f) => f.severity === "error")).toEqual([]);
        expect(search.complete).toBe(true);
      });

      it("covers every node, every edge and every ending, with no softlock", () => {
        const { coverage } = exploreRoutes(s.graph!, explorerOptions(s));
        expect(coverage.complete).toBe(true);
        expect(coverage.unreachableNodes).toEqual([]);
        expect(coverage.neverEntered).toEqual([]);
        expect(coverage.nodes.filter((node) => !node.entered).map((node) => node.id)).toEqual([]);
        expect(coverage.edges.filter((edge) => !edge.traversable).map((edge) => edge.id)).toEqual([]);
        expect(coverage.endings.filter((ending) => !ending.reached).map((ending) => ending.id)).toEqual([]);
        expect(coverage.endingsReached).toBe(s.graph!.endings.length);
        expect(coverage.softlocks).toEqual([]);
        expect(coverage.noEndingWinnable).toBe(false);
      });

      it("holds every runtime invariant on replayed and random playthroughs, and covers the graph", () => {
        const { search, coverage } = exploreRoutes(s.graph!, explorerOptions(s));
        const report = playtest(s.graph!, s.campaign, {
          chapterFlags: explorerOptions(s).chapterFlags,
          random: { seed: 1, runs: 25 },
          replay: { search, coverage },
        });
        expect(report.violations).toEqual([]);
        expect(report.covered.nodes).toEqual(s.graph!.nodeOrder);
        expect(report.covered.edges).toEqual(s.graph!.edgeOrder);
        expect(report.covered.endings).toEqual(s.graph!.endings);
      });

      it("renders a diagram and an outline that name every node and edge", () => {
        const mermaid = toMermaid(s.campaign, s.graph!);
        const dot = toDot(s.campaign, s.graph!);
        const text = outline(s.campaign, s.graph!);
        for (const id of [...s.graph!.nodeOrder, ...s.graph!.edgeOrder]) expect(text).toContain(id);
        for (const id of s.graph!.edgeOrder) {
          expect(mermaid).toContain(id);
          expect(dot).toContain(`label="${id}`);
        }
      });
    });
  }
});

// ===========================================================================
// 2. The ordered campaigns are untouched
// ===========================================================================

describe("ordered campaigns — seen, skipped, unchanged", () => {
  it("Gemfall and the Hollow Crown are listed and are not graph campaigns", () => {
    const names = CONTENT.map((file) => path.basename(file));
    expect(names).toEqual(expect.arrayContaining(["gemfall.json", "the-hollow-crown.json"]));
    for (const file of CONTENT) {
      const read = readSubject(file);
      if (read.campaign.id === "gemfall" || read.campaign.id === "the-hollow-crown") {
        expect(campaignMode(read.campaign)).toBe("ordered");
        expect(read.graph).toBeNull();
        expect(read.problems).toEqual([]);
        expect(isGraphSubject(read)).toBe(false);
      }
    }
  });

  it("the CLI skips them with status 0 and says so", () => {
    const run = cli(["--campaign", "gemfall"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("ordered campaign (no graph), skipped");
  });

  it("--all inspects only the graph campaigns and still exits 0 on the shipped repo", () => {
    const run = cli(["--all"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("gemfall.json: ordered campaign (no graph), skipped");
    expect(run.stdout).toContain("the-hollow-crown.json: ordered campaign (no graph), skipped");
    expect(run.stdout).toContain("rift-sampler");
  });

  it("the chapter viewer (content:graph) and the continuity sweep do not import this tooling", () => {
    // They are the ordered campaigns' tools; the new files are additive and
    // nothing they run loads them, so their output cannot change with them.
    for (const file of ["graph.ts", "graph-page.ts", "continuity.mjs"]) {
      const source = fs.readFileSync(path.join(REPO_ROOT, "tools", "content", file), "utf8");
      expect(source).not.toMatch(/journey-(graph|explore|save)/);
    }
  });
});

// ===========================================================================
// 3. journey-ci: every route shape, reported as what it is
// ===========================================================================

describe("journey-ci — sideways, revisit and single-use routes", () => {
  const s = subject("journey-ci");
  const { search, coverage } = exploreRoutes(s.graph, explorerOptions(s));

  it("is clean, and the explorer is the lint's explorer", () => {
    const lint = lintCampaignGraph(s.graph, explorerOptions(s));
    expect(lint.findings).toEqual([]);
    expect(search.states.length).toBe(lint.search.states);
    expect(exploreCampaignGraph(s.graph, explorerOptions(s)).states.length).toBe(search.states.length);
  });

  it("reports the shortest route to each ending", () => {
    const harvest = coverage.endings.find((e) => e.id === "harvest")!;
    const escape = coverage.endings.find((e) => e.id === "escape")!;
    expect(harvest.shortest!.edges).toEqual(["camp-to-meadow", "meadow-to-harvest"]);
    expect(escape.shortest!.edges).toEqual(["camp-to-keep", "keep-to-escape"]);
    expect(harvest.shortest!.text).toContain("+lantern_lit");
    expect(coverage.endingsReached).toBe(2);
  });

  it("traverses the sideways move and the revisit return", () => {
    const traversable = new Set(coverage.edges.filter((e) => e.traversable).map((e) => e.id));
    for (const id of ["meadow-to-grotto", "grotto-to-meadow", "meadow-to-camp", "camp-to-meadow"]) expect(traversable.has(id)).toBe(true);
  });

  it("reports both single-use routes as used up, with an ending still reachable", () => {
    const ford = coverage.consumed.find((c) => c.edge === "camp-to-ford")!;
    const rift = coverage.consumed.find((c) => c.edge === "camp-to-keep")!;
    expect(ford.reason).toBe("spent");
    expect(rift.reason).toBe("rift-consumed");
    expect(ford.firstSpent.edges).toEqual(["camp-to-ford"]);
    expect(ford.stillWinnable).toBe(true);
    expect(rift.stillWinnable).toBe(true);
    // The party can be standing at the camp afterwards, so the runtime has something to refuse.
    expect(ford.refusedAt).toBeDefined();
    expect(rift.refusedAt).toBeDefined();
  });

  it("the runtime refuses each used-up route, for the reason the explorer gives", () => {
    const report = playtest(s.graph, s.campaign, { replay: { search, coverage } });
    expect(report.violations).toEqual([]);
    const refusals = report.walks.filter((walk) => walk.walk.startsWith("spent:"));
    expect(refusals.map((walk) => walk.walk).sort()).toEqual(["spent:camp-to-ford", "spent:camp-to-keep"]);
  });

  it("the replay bites: an explorer state that disagrees with the runtime is reported", () => {
    const fresh = exploreRoutes(s.graph, explorerOptions(s));
    const harvest = fresh.coverage.endings.find((e) => e.id === "harvest")!.shortest!;
    expect(replayState(s.graph, s.campaign, fresh.search, harvest.state, "intact").violations).toEqual([]);
    // Pretend the explorer thought the lantern stayed dark after the grotto.
    const chain = stateChain(fresh.search, harvest.state);
    fresh.search.states[chain[1]!]!.facts = { ...fresh.search.states[chain[1]!]!.facts, flags: { lantern_lit: false } };
    const walk = replayState(s.graph, s.campaign, fresh.search, harvest.state, "tampered");
    expect(walk.violations.map((v) => v.code)).toContain("EXPLORER_DIVERGES");
    expect(walk.violations[0]!.message).toContain("lantern_lit");
  });

  it("a scripted walk replays a revisit: the meadow is a different chapter once the lantern is lit", () => {
    const campaign = s.campaign;
    let j = startJourney(s.graph, campaign);
    const play = (outcome: "success" | "setback" = "success", flags: Record<string, boolean> = {}): void => {
      const done = completeVisit(s.graph, j, { node: j.node, visit: j.visit, chapterId: j.chapter, outcome, flags }, campaign);
      if (!done.ok || done.duplicate) throw new Error("completion refused");
      j = done.journey;
    };
    const go = (edge: string): void => {
      const crossing = takeExit(s.graph, j, { edge, visit: j.visit }, campaign);
      if (!crossing.ok || crossing.duplicate) throw new Error(`${edge} refused`);
      j = crossing.journey;
    };
    play();
    go("camp-to-meadow");
    expect(j.chapter).toBe("jci-meadow");
    play();
    go("meadow-to-grotto");
    play();
    go("grotto-to-meadow");
    expect(j.chapter).toBe("jci-meadow-lit");
    expect(j.visits!.meadow).toBe(2);
  });

  it("a scripted walk to an ending runs clean; one that reuses a used-up road is reported", () => {
    const clean = scriptedWalk(s.graph, s.campaign, ["camp-to-meadow", "meadow-to-grotto", "grotto-to-meadow", "meadow-to-harvest"]);
    expect(clean.violations).toEqual([]);
    expect(clean.ended).toBe(true);
    expect(clean.at).toBe("harvest");

    const reuse = scriptedWalk(s.graph, s.campaign, ["camp-to-ford", "ford-to-keep", "keep-to-camp", "camp-to-ford"]);
    expect(reuse.violations.map((v) => v.code)).toEqual(["SCRIPT_BLOCKED"]);
    expect(reuse.violations[0]!.message).toContain("spent");
    expect(reuse.violations[0]!.trail.join(" ")).toContain("camp-to-ford");
  });

  it("random walks are deterministic by seed", () => {
    const a = randomWalk(s.graph, s.campaign, 42, "r");
    const b = randomWalk(s.graph, s.campaign, 42, "r");
    expect(b.trail).toEqual(a.trail);
    const others = Array.from({ length: 6 }, (_, i) => randomWalk(s.graph, s.campaign, 1000 + i, "r").trail.join("|"));
    expect(new Set(others).size).toBeGreaterThan(1);
  });

  it("draws kinds, once, rifts (dashed) and endings", () => {
    const mermaid = toMermaid(s.campaign, s.graph);
    expect(mermaid.startsWith("%% ")).toBe(true);
    expect(mermaid).toContain("flowchart LR");
    // sideways thick, the rift dashed, return labelled
    expect(mermaid).toMatch(/n_meadow ==>\|"meadow-to-grotto"\| n_grotto/);
    expect(mermaid).toMatch(/n_camp -\.->\|"camp-to-keep<br\/>rift"\| n_keep/);
    expect(mermaid).toContain('"grotto-to-meadow (return)"');
    expect(mermaid).toMatch(/linkStyle \d+ stroke:#d68910/); // once
    expect(mermaid).toContain("stroke-dasharray:6 4"); // rift
    expect(mermaid).toContain("class n_harvest,n_escape ending");
    expect(mermaid).toContain("class n_grotto closed");
    expect(toMermaid(s.campaign, s.graph)).toBe(mermaid); // deterministic

    const dot = toDot(s.campaign, s.graph);
    expect(dot).toContain("digraph");
    expect(dot).toMatch(/"camp" -> "keep" \[label="camp-to-keep\\nrift", style=dashed/);
    expect((dot.match(/style=dashed/g) ?? []).length).toBe(1);
    expect(dot).toContain("doubleoctagon");
  });

  it("outlines revisit policy, variants, guards, effects and rifts, and exports JSON", () => {
    const text = outline(s.campaign, s.graph);
    expect(text).toContain("[entry, revisit pass]");
    expect(text).toContain("variant 0: jci-meadow-lit when flag:lantern_lit");
    expect(text).toContain("effect: set flag lantern_lit");
    expect(text).toContain("rift: 1 use");
    expect(text).toContain("[once]");
    const summary = toSummary(s.campaign, s.graph);
    expect(summary.nodes).toHaveLength(7);
    expect(summary.edges.find((e) => e.id === "camp-to-keep")!.tags).toContain("rift");
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });

  it("the CLI draws it, plays it and exits 0", () => {
    const mermaid = cli(["--campaign", "journey-ci", "--format", "mermaid"]);
    expect(mermaid.status).toBe(0);
    expect(mermaid.stdout.startsWith("%% The Journey Gate")).toBe(true);
    const play = cli(["--campaign", "journey-ci", "--walk", "random", "--seed", "3", "--runs", "5", "--path", "camp-to-meadow"]);
    expect(play.status).toBe(0);
    expect(play.stdout).toContain("invariants: all held");
    const json = cli(["--campaign", "packages/shared/src/fixtures/journey-ci.campaign.json", "--format", "json"]);
    expect(json.status).toBe(0);
    const parsed = JSON.parse(json.stdout) as { coverage: { endingsReached: number } };
    expect(parsed.coverage.endingsReached).toBe(2);
  });
});

// ===========================================================================
// 4. Deliberately broken graphs: unreachable nodes and softlocks are reported
// ===========================================================================

type NodeSpec = Omit<GraphNode, "chapter"> & { chapter?: string };

function build(nodes: Record<string, NodeSpec>, edges: Record<string, GraphEdge>, flags: string[] = []): ParsedCampaignGraph {
  const declared = Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, { chapter: `ch-${id}`, ...node }]));
  const campaign = {
    id: "broken",
    title: "Broken",
    blurb: "broken on purpose",
    chapters: [...new Set(Object.values(declared).map((node) => node.chapter))],
    graph: { version: 1, entry: "start", flags, nodes: declared, edges },
  } as unknown as Campaign;
  const { graph, problems } = parseCampaignGraph(campaign);
  expect(problems).toEqual([]);
  return graph!;
}
const fwd = (from: string, to: string, extra: Partial<GraphEdge> = {}): GraphEdge => ({ from, to, kind: "forward", ...extra });
const back = (from: string, to: string, extra: Partial<GraphEdge> = {}): GraphEdge => ({ from, to, kind: "return", ...extra });
const END: NodeSpec = { ending: { title: "The End" } };

describe("broken graphs — reported, with the path that gets there", () => {
  it("an unreachable node is reported by the coverage and the lint", () => {
    const graph = build(
      { start: { revisit: "pass" }, end: END, island: {} },
      { "to-end": fwd("start", "end"), "island-to-end": fwd("island", "end") },
    );
    const { coverage } = exploreRoutes(graph);
    expect(coverage.unreachableNodes).toEqual(["island"]);
    expect(coverage.nodes.find((n) => n.id === "island")!.entered).toBe(false);
    expect(coverage.edges.find((e) => e.id === "island-to-end")!.traversable).toBe(false);
    expect(coverage.endingsReached).toBe(1);
    expect(lintCampaignGraph(graph).findings.map((f) => f.code)).toContain("UNREACHABLE_NODE");
  });

  it("a node connected by edges that are always shut is 'never entered'", () => {
    const graph = build(
      { start: { revisit: "pass" }, end: END, vault: {} },
      {
        "to-end": fwd("start", "end"),
        "to-vault": fwd("start", "vault", { when: { flag: "key", notFlag: "key" } }),
        "vault-to-end": fwd("vault", "end"),
      },
      ["key"],
    );
    const { coverage } = exploreRoutes(graph);
    expect(coverage.unreachableNodes).toEqual([]);
    expect(coverage.neverEntered).toEqual(["vault"]);
  });

  it("a stranded party is a softlock, with the way there and why each exit is shut", () => {
    const graph = build(
      { start: { revisit: "pass" }, cellar: {}, end: END },
      {
        "to-end": fwd("start", "end", { when: { flag: "never" } }),
        "to-cellar": fwd("start", "cellar"),
        "cellar-up": back("cellar", "start", { locked: true }),
      },
      ["never"],
    );
    const { coverage } = exploreRoutes(graph, { chapterFlags: () => ({ setsTrue: [], setsFalse: [] }) });
    const lock = coverage.softlocks.find((each) => each.kind === "stranded")!;
    expect(lock.node).toBe("cellar");
    expect(lock.path.edges).toEqual(["to-cellar"]);
    expect(lock.blocks).toEqual([{ edge: "cellar-up", reason: "locked" }]);

    // …and the runtime agrees: walking in there leaves no open exit.
    const walk = scriptedWalk(graph, { routeSets: undefined }, ["to-cellar"]);
    expect(walk.violations.map((v) => v.code)).toEqual(["NO_OPEN_EXIT"]);
    expect(walk.at).toBe("cellar");
  });

  it("a used-up route that strands the way to every ending is a trap, with the path", () => {
    const graph = build(
      { start: { revisit: "pass" }, vault: {}, loop: {}, end: END },
      {
        "to-end": fwd("start", "end", { when: { notTraversed: "to-vault" } }),
        "to-vault": fwd("start", "vault", { once: true }),
        "vault-up": back("vault", "start"),
        "to-loop": fwd("start", "loop"),
        "loop-up": back("loop", "start"),
      },
    );
    const { coverage } = exploreRoutes(graph);
    const trap = coverage.softlocks.find((each) => each.kind === "trapped")!;
    expect(trap).toBeDefined();
    expect(trap.path.edges).toContain("to-vault");
    const link = coverage.consumed.find((each) => each.edge === "to-vault")!;
    expect(link.reason).toBe("spent");
    expect(link.stillWinnable).toBe(false);
    expect(lintCampaignGraph(graph).findings.map((f) => f.code)).toContain("TRAPPED");

    const cli1 = scriptedWalk(graph, {}, ["to-vault", "vault-up", "to-loop", "loop-up", "to-loop"]);
    // The party can wander forever, but the runtime keeps every promise while it does.
    expect(cli1.violations).toEqual([]);
    expect(cli1.ended).toBe(false);
  });

  it("an ending nobody can enter is reported as unwinnable", () => {
    const graph = build(
      { start: { revisit: "pass" }, end: END },
      { "to-end": fwd("start", "end", { locked: true }) },
    );
    const { coverage } = exploreRoutes(graph);
    expect(coverage.noEndingWinnable).toBe(true);
    expect(coverage.endings.map((e) => e.reached)).toEqual([false]);
    expect(coverage.softlocks.map((s) => s.kind)).toEqual(["stranded"]);
  });
});

// ===========================================================================
// 5. Invalid save states
// ===========================================================================

describe("checkJourneySave — classifying a stored journey", () => {
  const s = subject("rift-sampler");
  const graph = s.graph;

  /** A journey that has really played: the party at the mill with the wheel turning. */
  function played(): JourneyState {
    const walk = (j: JourneyState, step: ["complete"] | ["go", string]): JourneyState => {
      if (step[0] === "complete") {
        const done = completeVisit(graph, j, { node: j.node, visit: j.visit, chapterId: j.chapter, outcome: "success", flags: {} }, s.campaign);
        if (!done.ok || done.duplicate) throw new Error("completion refused");
        return done.journey;
      }
      const crossing = takeExit(graph, j, { edge: step[1], visit: j.visit }, s.campaign);
      if (!crossing.ok || crossing.duplicate) throw new Error(`${step[1]} refused`);
      return crossing.journey;
    };
    let j = startJourney(graph, s.campaign);
    for (const step of [["complete"], ["go", "to-orchard"], ["complete"], ["go", "orchard-to-mill"], ["complete"]] as const) {
      j = walk(j, step as ["complete"] | ["go", string]);
    }
    return j;
  }
  const mutate = (change: (j: Record<string, unknown>) => void): unknown => {
    const copy = JSON.parse(JSON.stringify(played())) as Record<string, unknown>;
    change(copy);
    return copy;
  };
  const classes = (raw: unknown, severity?: "error" | "warning") =>
    checkJourneySave(graph, raw).issues.filter((i) => severity === undefined || i.severity === severity).map((i) => i.class);

  it("accepts a fresh journey and one that has really been played", () => {
    expect(checkJourneySave(graph, startJourney(graph, s.campaign))).toMatchObject({ verdict: "ok", loadable: true, issues: [] });
    expect(checkJourneySave(graph, JSON.parse(JSON.stringify(played())))).toMatchObject({ verdict: "ok", loadable: true, issues: [] });
  });

  it("classifies what the server would refuse", () => {
    for (const raw of [null, undefined, "journey", 7, [], {}, { version: 1 }, { version: 1, node: "waystone" }]) {
      const check = checkJourneySave(graph, raw);
      expect(check.verdict).toBe("unreadable");
      expect(check.loadable).toBe(false);
    }
    const future = checkJourneySave(graph, mutate((j) => (j.version = 2)));
    expect(future).toMatchObject({ verdict: "future-version", loadable: false });
    expect(checkJourneySave(graph, mutate((j) => (j.version = 0))).verdict).toBe("unreadable");
    expect(checkJourneySave(graph, mutate((j) => (j.version = "1"))).verdict).toBe("unreadable");
    const renamed = checkJourneySave(graph, mutate((j) => (j.node = "old-mill")));
    expect(renamed).toMatchObject({ verdict: "unknown-node", loadable: false });
    expect(renamed.issues[0]!.path).toBe("/node");
  });

  it("reports edge ids the graph does not have, which the runtime ignores", () => {
    const raw = mutate((j) => {
      j.traversed = { ...(j.traversed as object), "ghost-edge": 1 };
      j.rifts = { "ghost-rift": { status: "open" }, "to-orchard": { status: "open" } };
      j.edges = { "ghost-lock": "open" };
      j.lastExit = { node: "orchard", visit: 1, edge: "ghost-exit" };
    });
    const check = checkJourneySave(graph, raw);
    expect(check.verdict).toBe("dangling");
    expect(check.loadable).toBe(true);
    expect(check.issues.map((i) => i.path).sort()).toEqual(
      ["/edges/ghost-lock", "/lastExit/edge", "/rifts/ghost-rift", "/rifts/to-orchard", "/traversed/ghost-edge"].sort(),
    );
    expect(check.issues.every((i) => i.severity === "warning")).toBe(true);
  });

  it("reports unknown facts and flags as ignored, not as a failure", () => {
    const raw = mutate((j) => {
      j.flags = { mill_wheel_turning: true, mystery_flag: true };
      j.facts = { "no-such-fact": 3 };
      j.visits = { ...(j.visits as object), "old-node": 2 };
    });
    const check = checkJourneySave(graph, raw);
    expect(check.verdict).toBe("ok");
    expect(check.issues.every((i) => i.severity === "warning")).toBe(true);
    expect(check.issues.map((i) => i.path).sort()).toEqual(["/facts/no-such-fact", "/flags/mystery_flag", "/visits/old-node"]);
  });

  it("reports facts outside their domain as coerced", () => {
    const world = subject("world-state").graph;
    const raw = { ...startJourney(world), facts: { "river-folk": 99, "mill-village": "swallowed" } };
    const check = checkJourneySave(world, JSON.parse(JSON.stringify(raw)));
    expect(check.verdict).toBe("ok");
    expect(check.issues.map((i) => i.path).sort()).toEqual(["/facts/mill-village", "/facts/river-folk"]);
  });

  it("flags impossible combinations the runtime would act on as if they were true", () => {
    expect(classes(mutate((j) => (j.status = "ended")), "error")).toContain("impossible"); // ended at a non-ending
    expect(classes(mutate((j) => (j.visit = 5)), "error")).toContain("impossible"); // visit counter mismatch
    expect(classes(mutate((j) => (j.completions = {})), "error")).toContain("impossible"); // choosing but never completed
    expect(classes(mutate((j) => (j.ending = "mill")), "error")).toContain("impossible"); // ending on a live journey
    expect(classes(mutate((j) => (j.chapter = "sampler-quarry")), "error")).toContain("impossible"); // a chapter the node does not play
    expect(classes(mutate((j) => (j.traversed = { "to-quarry": 2 })), "error")).toContain("impossible"); // once edge taken twice
    expect(classes(mutate((j) => (j.traversed = { "orchard-to-tower": 1, "quarry-to-tower": 1 })), "error")).toContain("impossible");
    expect(classes(mutate((j) => (j.visits = { mill: -1 })), "error")).toContain("impossible");
    expect(classes(mutate((j) => (j.outcomes = { quarry: "success" })), "error")).toContain("impossible"); // outcome without a completion
    expect(classes(mutate((j) => (j.outcomes = { mill: "triumph" })), "error")).toContain("impossible");
    expect(classes(mutate((j) => (j.edges = { "to-orchard": "ajar" })), "error")).toContain("impossible");
    expect(classes(mutate((j) => (j.lastExit = { node: "waystone", visit: 1, edge: "orchard-to-mill" })), "error")).toContain("impossible");
    const verdict = checkJourneySave(graph, mutate((j) => (j.status = "ended")));
    expect(verdict.verdict).toBe("impossible");
    expect(verdict.loadable).toBe(true); // readJourney alone would have let it through
  });

  it("flags a closed place played again after it was completed, and a rift record with no status", () => {
    const mill = mutate((j) => {
      j.status = "playing";
      j.completions = { ...(j.completions as object), mill: 1 };
    });
    expect(checkJourneySave(graph, mill).verdict).toBe("impossible");
    const rifts = subject("rift-lifecycle").graph;
    const riftId = rifts.edgeOrder.find((id) => rifts.edges[id]!.rift !== undefined)!;
    const raw = JSON.parse(JSON.stringify({ ...startJourney(rifts), rifts: { [riftId]: { status: "bogus" } } }));
    const check = checkJourneySave(rifts, raw);
    expect(check.verdict).toBe("impossible");
    expect(check.issues[0]!.path).toBe(`/rifts/${riftId}`);
  });

  it("the CLI checks a save file and exits non-zero when it is broken", () => {
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "journey-save-"));
    try {
      const good = path.join(dir, "good.json");
      const bad = path.join(dir, "bad.json");
      fs.writeFileSync(good, JSON.stringify(played()));
      fs.writeFileSync(bad, JSON.stringify(mutate((j) => (j.node = "old-mill"))));
      const ok = cli(["--campaign", "rift-sampler", "--save", good]);
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain("Save check");
      const broken = cli(["--campaign", "rift-sampler", "--save", bad]);
      expect(broken.status).toBe(1);
      expect(broken.stdout).toContain("unknown-node");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// CLI plumbing
// ===========================================================================

describe("the CLI", () => {
  it("refuses an unknown campaign and a bad option with status 2", () => {
    expect(cli(["--campaign", "no-such-campaign"]).status).toBe(2);
    expect(cli(["--campaign", "journey-ci", "--format", "svg"]).status).toBe(2);
    expect(cli([]).status).toBe(2);
  });
});

function cli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const tsx = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
  const run = spawnSync(tsx, [path.join(REPO_ROOT, "tools", "content", "journey.ts"), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 90_000,
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}
