/**
 * Is this stored journey one the runtime can resume? (#202)
 *
 * `readJourney` (journey.ts) answers the question the server has to answer on
 * every request: can I act on this at all? It refuses three things and waves
 * everything else through, because a request path must not fail on a counter
 * it never reads. That is the right contract for the server and the wrong one
 * for a developer holding a save from a bug report, or a content author who
 * has just renamed a node: they want to know everything that is off about it,
 * including the things the runtime would silently ignore and the things it
 * would act on as if they were fine.
 *
 * This is that checker. It never throws and never changes the save; it
 * classifies it:
 *
 *   ok              nothing to say (warnings about ignored facts may remain).
 *   unreadable      not a journey: not an object, no node / visit / status.
 *   future-version  written by a newer build; its meanings are not ours.
 *   unknown-node    stands at, or counts visits to nothing but, a node the
 *                   campaign no longer has — a renamed id, a migration (§6).
 *   dangling        loads, but names edges or rifts the graph does not have;
 *                   the runtime ignores them and so they are dead weight.
 *   impossible      loads, but no sequence of legal transitions could have
 *                   written it (an ended journey at a non-ending, a
 *                   `choosing` visit that never completed, a once edge taken
 *                   twice...). The runtime would act on it as if it were
 *                   true, which is how a hand-edited or corrupted row strands
 *                   a party.
 *
 * The verdict is the most severe class found, in the order above; `issues`
 * lists every finding with a JSON pointer into the save. It reuses
 * `readJourney` for the load decision instead of restating it, so the two
 * cannot disagree about what "unreadable" means.
 *
 * Unknown *facts* (flags the graph does not declare, world facts it no longer
 * has, values outside a fact's domain) are warnings and do not change the
 * verdict: `readBackFlags` and `readFact` drop or coerce them by design.
 */

import { JOURNEY_VERSION, readJourney, readFact } from "@kad/shared";
import type { JourneyState, ParsedCampaignGraph } from "@kad/shared";

export type SaveVerdict = "ok" | "unreadable" | "future-version" | "unknown-node" | "dangling" | "impossible";

export type SaveIssueClass = Exclude<SaveVerdict, "ok"> | "unknown-fact";

export interface SaveIssue {
  class: SaveIssueClass;
  /** `error`: the verdict. `warning`: reported, harmless to the runtime. */
  severity: "error" | "warning";
  /** A JSON pointer inside the stored journey. */
  path: string;
  message: string;
}

export interface SaveCheck {
  verdict: SaveVerdict;
  /** Whether `readJourney` accepts it — what the server would do with the save. */
  loadable: boolean;
  issues: SaveIssue[];
  /** The journey as read, when it is loadable. */
  journey: JourneyState | null;
}

const SEVERITY_ORDER: readonly Exclude<SaveVerdict, "ok">[] = [
  "unreadable",
  "future-version",
  "unknown-node",
  "impossible",
  "dangling",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const seg = (key: string): string => key.replaceAll("~", "~0").replaceAll("/", "~1");

/** A counter: a non-negative integer. */
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

export function checkJourneySave(graph: ParsedCampaignGraph, raw: unknown): SaveCheck {
  const issues: SaveIssue[] = [];
  const error = (cls: SaveIssueClass, path: string, message: string): void =>
    void issues.push({ class: cls, severity: "error", path, message });
  const warn = (cls: SaveIssueClass, path: string, message: string): void =>
    void issues.push({ class: cls, severity: "warning", path, message });
  const finish = (loadable: boolean, journey: JourneyState | null): SaveCheck => {
    const verdict = SEVERITY_ORDER.find((cls) => issues.some((issue) => issue.class === cls && issue.severity === "error"))
      ?? (issues.some((issue) => issue.class === "dangling") ? "dangling" : "ok");
    return { verdict, loadable, issues, journey };
  };

  // --- can it be loaded at all? -----------------------------------------
  if (raw === undefined || raw === null) {
    error("unreadable", "", "there is no journey in this save (a graph attempt with none yet starts fresh; nothing to check)");
    return finish(false, null);
  }
  if (isRecord(raw) && typeof raw.version === "number" && raw.version > JOURNEY_VERSION) {
    error(
      "future-version",
      "/version",
      `the save is journey version ${raw.version}; this build reads version ${JOURNEY_VERSION} and must not guess at a newer one`,
    );
    return finish(false, null);
  }
  const read = readJourney(graph, raw);
  if (!read.ok) {
    // "version" here is a save that is not a version at all (a future one was
    // classified above); readJourney's other refusals are the two classes below.
    if (read.code === "unknown-node") error("unknown-node", "/node", read.message);
    else error("unreadable", read.code === "version" ? "/version" : "", read.message);
    return finish(false, null);
  }
  const journey = read.journey!;
  const j = journey as unknown as Record<string, unknown>;

  const nodeIds = new Set(graph.nodeOrder);
  const edgeIds = new Set(graph.edgeOrder);
  const node = graph.nodes[journey.node]!;

  // --- counters ---------------------------------------------------------
  const counters = (name: "visits" | "completions" | "traversed", known: ReadonlySet<string>, kind: "node" | "edge"): Record<string, number> => {
    const record = j[name];
    const out: Record<string, number> = {};
    if (record === undefined) return out;
    if (!isRecord(record)) {
      error("impossible", `/${name}`, `"${name}" must be an object of counts`);
      return out;
    }
    for (const [id, value] of Object.entries(record)) {
      if (!isCount(value)) {
        error("impossible", `/${name}/${seg(id)}`, `${JSON.stringify(value)} is not a count (a non-negative integer)`);
      } else if (!known.has(id)) {
        warn(kind === "node" ? "unknown-node" : "dangling", `/${name}/${seg(id)}`, `${kind} "${id}" is not in this campaign; the count is ignored`);
      } else {
        out[id] = value;
      }
    }
    return out;
  };
  const visits = counters("visits", nodeIds, "node");
  const completions = counters("completions", nodeIds, "node");
  const traversed = counters("traversed", edgeIds, "edge");

  if (visits[journey.node] !== journey.visit) {
    error(
      "impossible",
      `/visits/${seg(journey.node)}`,
      `the journey is on visit ${journey.visit} to "${journey.node}", but it counts ${visits[journey.node] ?? 0} visit(s) there; the current visit is always the latest counted`,
    );
  }
  for (const [id, done] of Object.entries(completions)) {
    if (done > (visits[id] ?? 0)) {
      error("impossible", `/completions/${seg(id)}`, `"${id}" is completed ${done} time(s) but visited ${visits[id] ?? 0}`);
    }
  }
  for (const [id, times] of Object.entries(traversed)) {
    const edge = graph.edges[id]!;
    if (edge.once === true && times > 1) {
      error("impossible", `/traversed/${seg(id)}`, `"once" edge "${id}" is taken ${times} times`);
    }
    if (times > 0 && (visits[edge.from] ?? 0) === 0) {
      error("impossible", `/traversed/${seg(id)}`, `edge "${id}" is taken, but "${edge.from}", where it starts, was never visited`);
    }
  }

  // --- where the party is, and what the status claims --------------------
  const chapters = new Set([node.chapter, ...(node.variants ?? []).map((variant) => variant.chapter)]);
  if (!chapters.has(journey.chapter)) {
    error(
      "impossible",
      "/chapter",
      `the visit plays chapter "${journey.chapter}", which "${journey.node}" does not (it plays ${[...chapters].map((c) => `"${c}"`).join(", ")}); completing it would be refused forever`,
    );
  }
  const finished = (completions[journey.node] ?? 0) > 0;
  if (journey.status === "ended") {
    if (node.ending === undefined) {
      error("impossible", "/status", `the journey is ended at "${journey.node}", which is not an ending`);
    }
    if (journey.ending !== journey.node) {
      error("impossible", "/ending", `an ended journey names the ending it reached ("${journey.node}"), not ${JSON.stringify(journey.ending)}`);
    }
    if (!finished) error("impossible", "/completions", `the journey is ended at "${journey.node}", which it never completed`);
  } else {
    if (journey.ending !== undefined) {
      error("impossible", "/ending", `"ending" is set but the journey is ${journey.status}; only an ended journey has one`);
    }
    if (node.ending !== undefined && journey.status === "choosing") {
      error("impossible", "/status", `the journey is choosing an exit at "${journey.node}", an ending: an ending offers none`);
    }
    if (journey.status === "choosing" && !finished) {
      error("impossible", "/status", `the journey is choosing an exit at "${journey.node}", but no visit there ever completed`);
    }
    if (journey.status === "playing" && node.revisit === "closed" && finished) {
      error("impossible", "/status", `the journey is playing "${journey.node}" again, but it is a closed place already completed: no exit leads back in`);
    }
  }

  // --- outcomes, overrides, last exit -------------------------------------
  if (isRecord(j.outcomes)) {
    for (const [id, outcome] of Object.entries(j.outcomes)) {
      const path = `/outcomes/${seg(id)}`;
      if (!nodeIds.has(id)) warn("unknown-node", path, `node "${id}" is not in this campaign; the outcome is ignored`);
      else if (outcome !== "success" && outcome !== "setback") error("impossible", path, `${JSON.stringify(outcome)} is not an outcome ("success" or "setback")`);
      else if ((completions[id] ?? 0) === 0) error("impossible", path, `"${id}" has an outcome but was never completed`);
    }
  }
  if (isRecord(j.edges)) {
    for (const [id, state] of Object.entries(j.edges)) {
      const path = `/edges/${seg(id)}`;
      if (!edgeIds.has(id)) warn("dangling", path, `edge "${id}" is not in this campaign; its lock override is ignored`);
      else if (state !== "open" && state !== "locked") error("impossible", path, `${JSON.stringify(state)} is not a lock state ("open" or "locked")`);
    }
  }
  if (j.lastExit !== undefined) {
    const last = j.lastExit;
    if (!isRecord(last) || typeof last.edge !== "string" || typeof last.node !== "string" || !Number.isInteger(last.visit)) {
      error("impossible", "/lastExit", `"lastExit" must be { node, visit, edge }`);
    } else if (!edgeIds.has(last.edge)) {
      warn("dangling", "/lastExit/edge", `the last exit names edge "${last.edge}", which this campaign does not have`);
    } else if (graph.edges[last.edge]!.from !== last.node) {
      error("impossible", "/lastExit", `the last exit "${last.edge}" leaves "${graph.edges[last.edge]!.from}", not "${last.node}"`);
    }
  }

  if (j.lastAction !== undefined) {
    // The rift action idempotence key (#197), held to `lastExit`'s rules.
    const last = j.lastAction;
    if (!isRecord(last) || typeof last.edge !== "string" || typeof last.node !== "string" || typeof last.action !== "string" || !Number.isInteger(last.visit)) {
      error("impossible", "/lastAction", `"lastAction" must be { node, visit, action, edge, to? }`);
    } else if (!edgeIds.has(last.edge)) {
      warn("dangling", "/lastAction/edge", `the last rift action names edge "${last.edge}", which this campaign does not have`);
    } else if (graph.edges[last.edge]!.from !== last.node) {
      error("impossible", "/lastAction", `the last rift action was on "${last.edge}", which leaves "${graph.edges[last.edge]!.from}", not "${last.node}"`);
    }
  }

  // --- rifts ----------------------------------------------------------------
  if (isRecord(j.rifts)) {
    for (const [id, state] of Object.entries(j.rifts)) {
      const path = `/rifts/${seg(id)}`;
      if (!edgeIds.has(id)) {
        warn("dangling", path, `edge "${id}" is not in this campaign; its rift record is ignored`);
      } else if (graph.edges[id]!.rift === undefined) {
        warn("dangling", path, `edge "${id}" is no longer a rift; its rift record is ignored`);
      } else if (!isRecord(state) || !["dormant", "open", "closed", "consumed", "expired", "collapsed"].includes(state.status as string)) {
        error("impossible", path, `the rift record for "${id}" has no valid status; the runtime reads it as closed, and only an explicit open brings it back`);
      } else if (state.to !== undefined && !(graph.edges[id]!.rift!.redirects ?? []).includes(state.to as string)) {
        // A redirect (#197) the declaration no longer lists reads as the edge's own `to`.
        warn("dangling", `${path}/to`, `the rift "${id}" is turned toward ${JSON.stringify(state.to)}, which it no longer declares; it leads to "${graph.edges[id]!.to}"`);
      }
    }
  }

  // --- flags and facts the graph does not know -------------------------------
  if (isRecord(j.flags)) {
    for (const [flag, value] of Object.entries(j.flags)) {
      if (!graph.flags.includes(flag)) {
        warn("unknown-fact", `/flags/${seg(flag)}`, `flag "${flag}" is not declared by this campaign; it is dropped at the next chapter boundary`);
      } else if (typeof value !== "boolean") {
        error("impossible", `/flags/${seg(flag)}`, `${JSON.stringify(value)} is not a flag value (journey flags are stored true-only)`);
      }
    }
  }
  if (isRecord(j.facts)) {
    for (const [id, value] of Object.entries(j.facts)) {
      const path = `/facts/${seg(id)}`;
      const fact = graph.facts[id];
      if (!fact) {
        warn("unknown-fact", path, `world fact "${id}" is not declared by this campaign; it is ignored`);
      } else if (JSON.stringify(readFact(fact, value)) !== JSON.stringify(value)) {
        warn("unknown-fact", path, `${JSON.stringify(value)} is outside the domain of fact "${id}"; it reads as ${JSON.stringify(readFact(fact, value))}`);
      }
    }
  }
  if (j.chaptersCompleted !== undefined && (!Array.isArray(j.chaptersCompleted) || j.chaptersCompleted.some((c) => typeof c !== "string"))) {
    error("impossible", "/chaptersCompleted", `"chaptersCompleted" must be a list of chapter ids`);
  }

  return finish(true, journey);
}
