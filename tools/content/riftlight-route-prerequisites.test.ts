import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { campaign, chapters, allPaths } from "./riftlight-test-support.ts";

// This is a whole-campaign proof: every chapter is walked twice through the
// real engine, including class rooms, before checking inter-region bypasses.
// CI exceeded 20 seconds under V8 coverage and four-worker contention (#534).
// Keep all route assertions and allow this exhaustive test a bounded minute.
it("proves regional prerequisites across every incoming graph route rather than assuming entry facts", () => {
  const contracts = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../docs/campaigns/continental-rift/continuity.json"), "utf8")).chapters as Record<string, { entryFacts: string[] }>;
  const graph = campaign.graph!;
  const intersection = (sets: Set<string>[]) => new Set([...sets[0]!].filter((fact) => sets.every((s) => s.has(fact))));
  const introduced = new Map<string, Set<string>>();
  for (const [node, definition] of Object.entries(graph.nodes)) {
    const chapter = chapters.get(definition.chapter)!;
    const paths = [
      allPaths(chapter, "manticore", "duskrunner"),
      allPaths(chapter, "kitsune", "starweaver", { attune_taught: true, starweaver_read_first_rift: true }),
    ];
    // Only facts whose literal introductions were actually read on EVERY ending path count.
    // Contract entryFacts are deliberately excluded from this transfer function.
    introduced.set(node, intersection(paths.flatMap((p) => p.endingIntroductions)));
    if (node === "riftseekers-departure" || chapter.index >= 4) {
      for (const result of paths) for (const end of result.ends) {
        expect(end.party.some((p) => p.character.questItems.includes("listening_chime")), chapter.id).toBe(true);
      }
    }
  }
  function propagate(edges: typeof graph.edges) {
    const reachable = new Set<string>();
    const pending = [graph.entry];
    while (pending.length) {
      const node = pending.pop()!;
      if (reachable.has(node)) continue;
      reachable.add(node);
      // Include even dormant/guarded edges: an overapproximation checks MORE routes,
      // so future shortcuts cannot silently bypass required introductions.
      for (const edge of Object.values(edges)) if (edge.from === node) pending.push(edge.to);
    }
    expect(reachable.size).toBe(Object.keys(graph.nodes).length);
    const universe = new Set([...introduced.values()].flatMap((s) => [...s]));
    const incoming = new Map([...reachable].map((node) => [node, node === graph.entry ? new Set<string>() : new Set(universe)]));
    const outgoing = (node: string) => new Set([...incoming.get(node)!, ...introduced.get(node)!]);
    let changed = true;
    let rounds = 0;
    while (changed) {
      expect(++rounds).toBeLessThan(100);
      changed = false;
      for (const node of reachable) {
        if (node === graph.entry) continue;
        const predecessors = Object.values(edges).filter((e) => e.to === node && reachable.has(e.from));
        const next = intersection(predecessors.map((e) => {
          const facts = outgoing(e.from);
          // A completed-place guard proves a prior full visit, even when a
          // return loop's immediate predecessor has not introduced those facts.
          // Include that chapter's checked entry contract and literal output.
          const completed = e.when?.completed;
          for (const done of completed === undefined ? [] : Array.isArray(completed) ? completed : [completed]) {
            for (const fact of [...contracts[graph.nodes[done]!.chapter]!.entryFacts, ...introduced.get(done)!]) facts.add(fact);
          }
          return facts;
        }));
        const before = incoming.get(node)!;
        if (next.size !== before.size || [...next].some((fact) => !before.has(fact))) {
          incoming.set(node, next); changed = true;
        }
      }
    }
    return { incoming, reachable };
  }
  const { incoming, reachable } = propagate(graph.edges);
  for (const node of reachable) {
    for (const fact of contracts[graph.nodes[node]!.chapter]!.entryFacts) {
      expect(incoming.get(node)!.has(fact), `${node}: an incoming route bypasses introduction of ${fact}`).toBe(true);
    }
  }
  for (const node of ["stone-counters", "whale-road", "buried-bridge", "the-wrong-valley", "reading-room", "the-island-due-back"]) {
    for (const fact of ["orin", "olivia", "listening_chime", "chime_rules", "learned_note", "hall", "riftseekers"]) {
      expect(incoming.get(node)!.has(fact), `${node}/${fact}`).toBe(true);
    }
  }
  // A new inter-strand shortcut from before the fellowship must invalidate the proof.
  for (const node of ["stone-counters", "whale-road", "buried-bridge", "the-wrong-valley", "reading-room", "the-island-due-back"]) {
    const bypass = propagate({ ...graph.edges, bypass: { from: graph.entry, to: node, kind: "sideways" } });
    expect(bypass.incoming.get(node)!.has("listening_chime")).toBe(false);
    expect(bypass.incoming.get(node)!.has("orin")).toBe(false);
    expect(bypass.incoming.get(node)!.has("olivia")).toBe(false);
  }
}, 60_000);
