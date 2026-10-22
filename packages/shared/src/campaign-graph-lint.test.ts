/**
 * Graph campaigns (#193): can the declaration be walked, and is there a way to
 * get stuck on the way?
 *
 * The Rift Sampler is the valid case — a branching, cyclic graph that every
 * check must leave alone, because a validator that rejects the cyclic example
 * the doc teaches would teach nobody anything. Every other case builds the
 * smallest graph that has exactly one thing wrong with it, and requires that
 * thing's code, by name, at the right path.
 */

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { campaignMode, parseCampaignGraph } from "./campaign-graph.js";
import {
  chapterFlagWrites,
  exploreCampaignGraph,
  duplicateJsonKeys,
  lintCampaignGraph,
  type GraphFinding,
  type GraphLintOptions,
} from "./campaign-graph-lint.js";
import type { Campaign } from "./types/chapter.js";
import type { GraphEdge, GraphNode } from "./types/campaign-graph.js";

const REPO = new URL("../../../", import.meta.url);

function sampler(): Campaign {
  return JSON.parse(readFileSync(new URL("./fixtures/rift-sampler.campaign.json", import.meta.url), "utf8")) as Campaign;
}

type NodeSpec = Omit<GraphNode, "chapter"> & { chapter?: string };

/**
 * A graph from the bones of one: node specs (chapter defaults to one named for
 * the node) and edge specs, entry `start`. Parsed with the real parser, so a
 * test graph with a dangling name fails loudly here and not in the lint.
 */
function build(nodes: Record<string, NodeSpec>, edges: Record<string, GraphEdge>, flags: string[] = []) {
  const declared = Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => [id, { chapter: `ch-${id}`, ...node }]),
  );
  const chapters = [
    ...new Set(Object.values(declared).flatMap((node) => [node.chapter, ...(node.variants ?? []).map((v) => v.chapter)])),
  ];
  const campaign = {
    id: "t",
    title: "T",
    blurb: "t",
    chapters,
    graph: { version: 1, entry: "start", flags, nodes: declared, edges },
  } as unknown as Campaign;
  const { graph, problems } = parseCampaignGraph(campaign);
  expect(problems).toEqual([]);
  return graph!;
}

const fwd = (from: string, to: string, extra: Partial<GraphEdge> = {}): GraphEdge => ({ from, to, kind: "forward", ...extra });
const back = (from: string, to: string, extra: Partial<GraphEdge> = {}): GraphEdge => ({ from, to, kind: "return", ...extra });
const END: NodeSpec = { ending: { title: "The End" } };

const lint = (graph: ReturnType<typeof build>, options?: GraphLintOptions): GraphFinding[] =>
  lintCampaignGraph(graph, options).findings;
const codes = (findings: GraphFinding[]) => findings.map((f) => f.code);
const only = (findings: GraphFinding[], code: GraphFinding["code"]) => findings.filter((f) => f.code === code);
/** Chapters that are known to write no flags at all. */
const writesNothing = () => ({ setsTrue: [], setsFalse: [] });

/** A hub that reaches an ending: the shape most cases below bend. */
const hub = (extraNodes: Record<string, NodeSpec> = {}, extraEdges: Record<string, GraphEdge> = {}, flags: string[] = []) =>
  build({ start: { revisit: "pass" }, end: END, ...extraNodes }, { "to-end": fwd("start", "end"), ...extraEdges }, flags);

describe("the Rift Sampler — a valid cyclic graph", () => {
  it("passes every check cleanly, with chapters unknown", () => {
    const { graph } = parseCampaignGraph(sampler());
    const result = lintCampaignGraph(graph!);
    expect(result.findings).toEqual([]);
    expect(result.search.complete).toBe(true);
  });

  it("passes with chapters known, when the quarry chapter can find the lens", () => {
    const { graph } = parseCampaignGraph(sampler());
    const chapterFlags = (chapter: string) =>
      chapter === "sampler-quarry" ? { setsTrue: ["found_the_lens"], setsFalse: [] } : writesNothing();
    expect(lintCampaignGraph(graph!, { chapterFlags }).findings).toEqual([]);
  });

  it("warns, and only warns, when no chapter can find the lens", () => {
    const { graph } = parseCampaignGraph(sampler());
    const findings = lint(graph!, { chapterFlags: writesNothing });
    expect(codes(findings)).toEqual(["GUARD_FLAG_NEVER_SET"]);
    expect(findings[0]).toMatchObject({ severity: "warning", path: "/graph/edges/quarry-to-tower/when/flag" });
    expect(findings[0]!.message).toContain("found_the_lens");
  });

  it("is a cycle the moment its return edges stop being return edges", () => {
    const campaign = sampler();
    campaign.graph!.edges["orchard-to-waystone"]!.kind = "forward";
    const { graph } = parseCampaignGraph(campaign);
    expect(only(lint(graph!), "UNINTENTIONAL_CYCLE").length).toBeGreaterThan(0);
  });
});

describe("static reachability", () => {
  it("rejects a node no edge reaches, naming it", () => {
    const graph = hub({ island: {} }, { "island-out": fwd("island", "end") });
    const found = only(lint(graph), "UNREACHABLE_NODE");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", path: "/graph/nodes/island" });
    expect(found[0]!.message).toContain('"island"');
    expect(found[0]!.hint).toMatch(/Add an edge/);
  });

  it("rejects a graph with no reachable ending", () => {
    const graph = build(
      { start: {}, a: {}, island: END },
      { "to-a": fwd("start", "a"), "a-back": back("a", "start") },
    );
    const findings = lint(graph);
    expect(codes(findings)).toContain("NO_ENDING_REACHABLE");
    expect(codes(findings)).toContain("UNREACHABLE_NODE");
  });

  it("rejects a non-ending node with no exits", () => {
    const graph = hub({ pit: {} }, { "to-pit": fwd("start", "pit") });
    const found = only(lint(graph), "DEAD_END");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", path: "/graph/nodes/pit" });
    expect(found[0]!.hint).toMatch(/ending/);
    // The search does not say it a second time as a stranding.
    expect(codes(lint(graph))).not.toContain("STRANDED");
  });

  it("rejects a reachable region whose every route circles without an ending", () => {
    const graph = hub(
      { a: {}, b: {} },
      { "to-a": fwd("start", "a"), "a-to-b": fwd("a", "b"), "b-to-a": back("b", "a") },
    );
    const found = only(lint(graph), "CANNOT_FINISH");
    expect(found.map((f) => f.path).sort()).toEqual(["/graph/nodes/a", "/graph/nodes/b"]);
    expect(found[0]!.message).toMatch(/ever reaches an ending/);
  });
});

describe("cycles", () => {
  it("rejects a loop of forward edges and says which edge to mark return", () => {
    const graph = hub(
      { a: {}, b: {} },
      { "to-a": fwd("start", "a"), "a-to-b": fwd("a", "b"), "b-to-a": fwd("b", "a"), "b-to-end": fwd("b", "end") },
    );
    const found = only(lint(graph), "UNINTENTIONAL_CYCLE");
    expect(found).toHaveLength(1);
    expect(found[0]!.path).toBe("/graph/edges/b-to-a");
    expect(found[0]!.hint).toContain('"kind": "return"');
    expect(found[0]!.message).toContain('"a" -> "b" -> "a"');
  });

  it("accepts the same loop once the back edge is a return edge", () => {
    const graph = hub(
      { a: {}, b: {} },
      { "to-a": fwd("start", "a"), "a-to-b": fwd("a", "b"), "b-to-a": back("b", "a"), "b-to-end": fwd("b", "end") },
    );
    expect(lint(graph)).toEqual([]);
  });

  it("counts sideways edges as forward ones, and a self-loop as a loop", () => {
    const sideways = hub(
      { a: {}, b: {} },
      {
        "to-a": fwd("start", "a"),
        "a-to-b": { from: "a", to: "b", kind: "sideways" },
        "b-to-a": { from: "b", to: "a", kind: "sideways" },
        "b-to-end": fwd("b", "end"),
      },
    );
    expect(codes(lint(sideways))).toContain("UNINTENTIONAL_CYCLE");
    const self = hub({ a: {} }, { "to-a": fwd("start", "a"), "a-again": fwd("a", "a"), "a-to-end": fwd("a", "end") });
    const found = only(lint(self), "UNINTENTIONAL_CYCLE");
    expect(found).toHaveLength(1);
    expect(found[0]!.path).toBe("/graph/edges/a-again");
  });
});

describe("locked edges and guards that cannot hold", () => {
  it("rejects a locked edge nothing unlocks, and accepts it once something does", () => {
    const locked = hub(
      { vault: {} },
      { "to-vault": fwd("start", "vault", { locked: true }), "vault-out": back("vault", "start") },
    );
    const found = only(lint(locked), "LOCKED_EDGE_NEVER_UNLOCKED");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", path: "/graph/edges/to-vault" });
    expect(found[0]!.hint).toContain('"type": "unlock"');

    const opened = hub(
      { vault: {} },
      {
        "to-vault": fwd("start", "vault", { locked: true }),
        "vault-out": back("vault", "start"),
        "to-end": fwd("start", "end", { effects: [{ type: "unlock", edge: "to-vault" }] }),
      },
    );
    expect(codes(lint(opened))).not.toContain("LOCKED_EDGE_NEVER_UNLOCKED");
  });

  it("rejects a guard whose fields contradict each other", () => {
    const cases: [string, GraphEdge["when"]][] = [
      ["flag/notFlag", { flag: "a", notFlag: "a" }],
      ["visited/notVisited", { visited: "start", notVisited: ["start"] }],
      ["completed/notCompleted", { completed: ["start"], notCompleted: "start" }],
      ["traversed/notTraversed", { traversed: "to-end", notTraversed: "to-end" }],
      ["completed/notVisited", { completed: "start", notVisited: "start" }],
      ["outcome/notCompleted", { outcome: "success", notCompleted: "start" }],
    ];
    for (const [name, when] of cases) {
      const graph = hub({}, { "to-end": fwd("start", "end", { when }), spare: fwd("start", "end") }, ["a"]);
      const found = only(lint(graph), "GUARD_CONTRADICTION");
      expect(found, name).toHaveLength(1);
      expect(found[0]).toMatchObject({ severity: "error", path: "/graph/edges/to-end/when" });
    }
  });

  it("warns about a flag guard no effect and no chapter can satisfy", () => {
    const guarded = {
      "to-end": fwd("start", "end", { when: { flag: "never" } }),
      spare: fwd("start", "end"),
    };
    const graph = hub({}, guarded, ["never"]);
    const found = only(lint(graph, { chapterFlags: writesNothing }), "GUARD_FLAG_NEVER_SET");
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe("warning");
    // With chapters unknown, any of them might set it: no warning.
    expect(codes(lint(graph))).toEqual([]);
    // An edge effect that sets it is enough.
    const set = hub(
      {},
      {
        "to-end": fwd("start", "end", { when: { flag: "never" } }),
        spare: back("start", "start", { effects: [{ type: "setFlag", flag: "never" }] }),
      },
      ["never"],
    );
    expect(codes(lint(set, { chapterFlags: writesNothing }))).toEqual([]);
  });
});

describe("softlocks — the search over journey states", () => {
  it("finds a party stranded after a once edge is spent, with the path", () => {
    // The hub's only way on is guarded on never having taken the side road;
    // the side road can be taken once; and it returns to the hub.
    const graph = build(
      { start: { revisit: "pass" }, side: {}, end: END },
      {
        "to-side": fwd("start", "side", { once: true }),
        "side-back": back("side", "start"),
        "to-end": fwd("start", "end", { when: { notTraversed: "to-side" } }),
      },
    );
    const found = only(lint(graph), "STRANDED");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", path: "/graph/nodes/start" });
    expect(found[0]!.message).toContain('"to-side" is already used (once)');
    expect(found[0]!.message).toContain('"to-end" is guarded');
    expect(found[0]!.message).toContain('-[to-side]-> "side"');
    expect(found[0]!.message).toContain('-[side-back]-> "start"');
    expect(found[0]!.hint).toMatch(/always open/);
  });

  it("finds a point of no return where exits remain but none leads to an ending", () => {
    const graph = build(
      { start: { revisit: "pass" }, side: {}, end: END },
      {
        "to-side": fwd("start", "side"),
        "side-back": back("side", "start"),
        "to-end": fwd("start", "end", { when: { notTraversed: "to-side" } }),
      },
    );
    const found = lint(graph);
    expect(codes(found)).toEqual(["TRAPPED"]);
    expect(found[0]!.message).toContain('-[to-side]-> "side"');
    expect(found[0]!.hint).toMatch(/once|closed|lock/);
  });

  it("finds a stranding that only one outcome produces", () => {
    const fine = build(
      { start: {}, trial: {}, end: END },
      {
        "to-trial": fwd("start", "trial"),
        "trial-on": fwd("trial", "end", { when: { outcome: "success" } }),
        "trial-back": back("trial", "start", { when: { outcome: "setback" } }),
      },
    );
    // Both outcomes have an exit, so this is fine ...
    expect(lint(fine)).toEqual([]);
    // ... take the setback exit away and a setback strands the party.
    const bent = build(
      { start: {}, trial: {}, end: END },
      { "to-trial": fwd("start", "trial"), "trial-on": fwd("trial", "end", { when: { outcome: "success" } }) },
    );
    const found = only(lint(bent), "STRANDED");
    expect(found).toHaveLength(1);
    expect(found[0]!.path).toBe("/graph/nodes/trial");
    expect(found[0]!.message).toContain("(setback)");
  });

  it("finds a trap made by a lock effect", () => {
    const graph = build(
      { start: { revisit: "pass" }, bridge: {}, end: END },
      {
        "to-bridge": fwd("start", "bridge", { effects: [{ type: "lock", edge: "to-end" }] }),
        "bridge-back": back("bridge", "start"),
        "to-end": fwd("start", "end"),
      },
    );
    // Crossing the bridge locks the only way to the end.
    const trapped = only(lint(graph), "TRAPPED");
    expect(trapped).toHaveLength(1);
    expect(trapped[0]!.message).toContain("-[to-bridge]->");
  });

  it("finds a trap made by a closed revisit", () => {
    const graph = build(
      { start: { revisit: "pass" }, gate: { revisit: "closed" }, end: END },
      {
        "to-gate": fwd("start", "gate"),
        "gate-back": back("gate", "start"),
        // A setback at the gate sends the party home, and the gate is shut.
        "gate-end": fwd("gate", "end", { when: { outcome: "success" } }),
        "to-end": fwd("start", "end", { when: { completed: "gate" } }),
      },
    );
    // Completing the gate opens `to-end`, so it is fine ...
    expect(lint(graph)).toEqual([]);
    // ... without that edge, the only way to the end is through a gate
    // that closes behind a setback.
    const stuck = build(
      { start: { revisit: "pass" }, gate: { revisit: "closed" }, end: END },
      {
        "to-gate": fwd("start", "gate"),
        "gate-back": back("gate", "start"),
        "gate-end": fwd("gate", "end", { when: { outcome: "success" } }),
      },
    );
    expect(codes(lint(stuck))).toContain("TRAPPED");
  });

  it("accepts a once edge that is not the only way", () => {
    const graph = build(
      { start: { revisit: "pass" }, side: {}, end: END },
      { "to-side": fwd("start", "side", { once: true }), "side-back": back("side", "start"), "to-end": fwd("start", "end") },
    );
    expect(lint(graph)).toEqual([]);
  });

  it("follows flags that chapters set, and fails when none can", () => {
    // The end is open only to a party whose side chapter set `key`.
    const graph = build(
      { start: { revisit: "pass" }, side: {}, end: END },
      {
        "to-side": fwd("start", "side"),
        "side-back": back("side", "start"),
        "to-end": fwd("start", "end", { when: { flag: "key" } }),
      },
      ["key"],
    );
    const sets = (chapter: string) => ({ setsTrue: chapter === "ch-side" ? ["key"] : [], setsFalse: [] });
    expect(lint(graph, { chapterFlags: sets })).toEqual([]);
    const found = lint(graph, { chapterFlags: writesNothing });
    expect(codes(found)).toContain("GUARD_FLAG_NEVER_SET");
    expect(codes(found)).toContain("NO_ENDING_WINNABLE");
  });

  it("reports an ending no play-through can enter, though an edge leads to it", () => {
    const graph = build(
      { start: { revisit: "pass" }, side: {}, end: END, secret: END },
      {
        "to-side": fwd("start", "side"),
        "side-back": back("side", "start"),
        "to-end": fwd("start", "end"),
        // Needs having visited the end - which stops the attempt.
        "to-secret": fwd("start", "secret", { when: { visited: "end" } }),
      },
    );
    const found = only(lint(graph), "ENDING_NEVER_REACHED");
    expect(found).toHaveLength(1);
    expect(found[0]!.path).toBe("/graph/nodes/secret");
  });

  it("warns about an edge that is never available in a place the party does reach", () => {
    const graph = hub(
      { side: {} },
      {
        "to-side": fwd("start", "side"),
        "side-back": back("side", "start"),
        "side-dead": fwd("side", "end", { when: { visited: "end" } }),
      },
    );
    const found = only(lint(graph), "EDGE_NEVER_AVAILABLE");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "warning", path: "/graph/edges/side-dead" });
  });

  it("says so, and skips the 'never' checks, when the state cap is hit", () => {
    const { graph } = parseCampaignGraph(sampler());
    const result = lintCampaignGraph(graph!, { maxStates: 5 });
    expect(result.search.complete).toBe(false);
    expect(codes(result.findings)).toEqual(["SEARCH_TRUNCATED"]);
    expect(result.findings[0]!.severity).toBe("warning");
  });

  it("applies a route set's fork to edge effects", () => {
    // `river` and `wild` are one fork: taking the wild road clears `river`,
    // so the river-only way on is no longer open.
    const graph = build(
      { start: { revisit: "pass" }, end: END },
      {
        "go-river": back("start", "start", { effects: [{ type: "setFlag", flag: "river" }] }),
        "go-wild": back("start", "start", { effects: [{ type: "setFlag", flag: "wild" }] }),
        "to-end": fwd("start", "end", { when: { flag: "river" } }),
      },
      ["river", "wild"],
    );
    // Without the fork a party that took both roads still holds `river`.
    expect(codes(lint(graph, { chapterFlags: writesNothing }))).not.toContain("TRAPPED");
    const forked = lint(graph, { chapterFlags: writesNothing, routeSets: { road: ["river", "wild"] } });
    expect(codes(forked)).not.toContain("TRAPPED");
    // The party can always go back and take the river road again: not a trap.
    // Make the river road once-only and it is.
    const once = build(
      { start: { revisit: "pass" }, end: END },
      {
        "go-river": back("start", "start", { once: true, effects: [{ type: "setFlag", flag: "river" }] }),
        "go-wild": back("start", "start", { effects: [{ type: "setFlag", flag: "wild" }] }),
        "to-end": fwd("start", "end", { when: { flag: "river" } }),
      },
      ["river", "wild"],
    );
    expect(codes(lint(once, { chapterFlags: writesNothing }))).not.toContain("TRAPPED");
    expect(codes(lint(once, { chapterFlags: writesNothing, routeSets: { road: ["river", "wild"] } }))).toContain("TRAPPED");
  });
});

describe("irreversible claims", () => {
  it("accepts claims that hold (the sampler's two)", () => {
    const { graph } = parseCampaignGraph(sampler());
    expect(only(lint(graph!), "IRREVERSIBLE_NOT")).toEqual([]);
  });

  it("rejects a claim a way back disproves, naming the way", () => {
    const graph = build(
      { start: {}, bridge: {}, end: END },
      {
        "cross-bridge": fwd("start", "bridge", { irreversible: true }),
        "bridge-back": back("bridge", "start"),
        "bridge-end": fwd("bridge", "end"),
      },
    );
    const found = only(lint(graph), "IRREVERSIBLE_NOT");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", path: "/graph/edges/cross-bridge" });
    expect(found[0]!.message).toContain('"bridge" -> "start"');
    expect(found[0]!.hint).toContain('remove "irreversible"');
  });

  it("accepts a claim when the way back is closed behind the crossing", () => {
    const graph = build(
      { start: {}, bridge: {}, end: END },
      {
        "cross-bridge": fwd("start", "bridge", { irreversible: true }),
        "bridge-back": back("bridge", "start", { when: { notTraversed: "cross-bridge" } }),
        "bridge-end": fwd("bridge", "end"),
      },
    );
    expect(only(lint(graph), "IRREVERSIBLE_NOT")).toEqual([]);
  });
});

describe("helpers", () => {
  it("chapterFlagWrites finds setFlag effects wherever they sit", () => {
    const chapter = {
      scenes: {
        a: {
          onEnter: [{ type: "setFlag", flag: "x" }],
          choices: [{ effects: [{ type: "setFlag", flag: "y", value: false }, { type: "grantItem", itemId: "q" }] }],
          onSuccess: { effects: [{ type: "setFlag", flag: "z", value: true }] },
        },
      },
    };
    expect(chapterFlagWrites(chapter as never)).toEqual({ setsTrue: ["x", "z"], setsFalse: ["y"] });
  });

  it("duplicateJsonKeys finds a repeated key, by pointer", () => {
    const text = `{"graph": {"nodes": {"a": {"chapter": "x"}, "b": {}, "a": {}}, "edges": [{"k": 1, "k": 2}]}}`;
    expect(duplicateJsonKeys(text)).toEqual([
      { path: "/graph/nodes/a", key: "a" },
      { path: "/graph/edges/0/k", key: "k" },
    ]);
    expect(duplicateJsonKeys(JSON.stringify(sampler()))).toEqual([]);
    expect(duplicateJsonKeys('{"a": "b\\"c", "b": ["a", {"a": 1}]}')).toEqual([]);
  });
});

describe("Gemfall and the other ordered campaigns", () => {
  it("are not graph campaigns, so none of this ever runs on them", () => {
    const dir = new URL("content/campaigns/", REPO);
    const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
    expect(files).toContain("gemfall.json");
    // Riftlight is the one shipped graph campaign; everything else is ordered.
    for (const file of files.filter((f) => f !== "riftlight.json")) {
      const campaign = JSON.parse(readFileSync(new URL(file, dir), "utf8")) as Campaign;
      expect(campaignMode(campaign), file).toBe("ordered");
      expect(parseCampaignGraph(campaign)).toEqual({ graph: null, problems: [] });
    }
  });
});

describe("completion relevance in pass hubs", () => {
  const graph = (flagged = false) => build(
    { start: { revisit: "pass" }, a: { revisit: "pass" }, b: { revisit: "pass" }, end: END },
    { a: fwd("start", "a"), ar: back("a", "start"), b: fwd("start", "b"), br: back("b", "start"),
      end: fwd("start", "end", flagged ? { when: { flag: "ready" } } : {}) }, ["ready"]);
  it("merges first visits and passes only for chapters with no observable writes", () => {
    const reduced = exploreCampaignGraph(graph(), { chapterFlags: writesNothing });
    const conservative = exploreCampaignGraph(graph());
    expect(reduced.states.length).toBeLessThan(conservative.states.length);
    expect(lintCampaignGraph(graph(), { chapterFlags: writesNothing }).findings).toEqual([]);
  });
  it("keeps completion when the first play sets a route flag", () => {
    const g = graph(true);
    const result = exploreCampaignGraph(g, { chapterFlags: (id) => ({ setsTrue: id === "ch-a" ? ["ready"] : [], setsFalse: [] }) });
    expect(result.states.some(s => s.facts.completions?.a)).toBe(true);
    expect(result.states.some(s => s.facts.completions?.b)).toBe(false);
    expect(lintCampaignGraph(g, { chapterFlags: (id) => ({ setsTrue: id === "ch-a" ? ["ready"] : [], setsFalse: [] }) }).search.complete).toBe(true);
  });
  it("keeps explicitly guarded completions and chapter clocks", () => {
    const guarded = build({ start: { revisit: "pass" }, end: END }, { end: fwd("start", "end", { when: { completed: "start" } }) });
    expect(exploreCampaignGraph(guarded, { chapterFlags: writesNothing }).states.some(s => s.facts.completions?.start)).toBe(true);
    const clock = build({ start: { revisit: "pass" }, end: END }, { end: fwd("start", "end", { rift: { lasts: { unit: "chapters", count: 2 } } }) });
    expect(exploreCampaignGraph(clock, { chapterFlags: writesNothing }).states.some(s => s.facts.completions?.start)).toBe(true);
  });
});

describe("reusing a graph proof without hiding changed fixtures", () => {
  it("refreshes the proof when chapter metadata changes", () => {
    const graph = build({ start: { revisit: "pass" }, end: END }, { guarded: fwd("start", "end", { when: { flag: "ready" } }) }, ["ready"]);
    const metadata = { setsTrue: [] as string[], setsFalse: [] as string[] };
    const options = { chapterFlags: () => metadata };
    const first = exploreCampaignGraph(graph, options);
    expect(first.entered.has("end")).toBe(false);
    metadata.setsTrue.push("ready");
    expect(exploreCampaignGraph(graph, options).entered.has("end")).toBe(true);
    graph.edges.guarded!.when = { notFlag: "ready" };
    metadata.setsTrue.length = 0;
    expect(exploreCampaignGraph(graph, options).entered.has("end")).toBe(true);
  });
});
