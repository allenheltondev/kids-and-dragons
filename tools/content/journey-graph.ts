/**
 * Reading and drawing a graph campaign — the inspection half of #202.
 *
 *   npm run content:journey -- --campaign rift-sampler               # outline + findings + coverage
 *   npm run content:journey -- --campaign rift-sampler --format mermaid
 *
 * `content:graph` draws *chapters* (the scene graph inside one chapter file);
 * this draws a *campaign*: the places a party can go and the ways between
 * them, which is a different graph at a different scale and needs no chapter
 * files at all (the fixtures' chapters are placeholders). The two do not share
 * output, and `content:graph` is untouched, so the ordered campaigns' viewer
 * output cannot change.
 *
 * ---------------------------------------------------------------------------
 * WHY TEXT, MERMAID AND DOT AND NOT A NEW HTML VIEWER
 *
 * A campaign graph is read in a pull request and pasted into an issue. Mermaid
 * renders natively in GitHub comments, docs and the wiki, which is where an
 * author argues about a route; DOT feeds anything else (`dot -Tsvg`). Neither
 * needs a server, a browser or a build step, and both are plain text a test
 * can assert on — which is how this file is held to the drawing it promises.
 *
 * Everything drawn comes from the `ParsedCampaignGraph` the runtime reads, in
 * its authored order, so a rendering is deterministic: the same campaign
 * always produces byte-identical output, and a diff of two renderings is a
 * diff of the two campaigns.
 */

import fs from "node:fs";
import path from "node:path";
import {
  campaignMode,
  chapterFlagWrites,
  parseCampaignGraph,
} from "@kad/shared";
import type {
  Campaign,
  Chapter,
  ChapterFlagWrites,
  GraphCondition,
  GraphEdge,
  GraphEffect,
  GraphProblem,
  ParsedCampaignGraph,
  WorldFact,
} from "@kad/shared";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const FIXTURE_DIR = path.join(REPO_ROOT, "packages", "shared", "src", "fixtures");
export const CAMPAIGN_DIR = path.join(REPO_ROOT, "content", "campaigns");
const CHAPTER_DIR = path.join(REPO_ROOT, "content", "chapters");

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** A campaign file read and its graph parsed. `graph` is null for an ordered campaign. */
export interface GraphSubject {
  /** Repo-relative path, or the path as given when outside the repo. */
  file: string;
  campaign: Campaign;
  graph: ParsedCampaignGraph | null;
  problems: GraphProblem[];
}

export function readSubject(file: string): GraphSubject {
  const campaign = JSON.parse(fs.readFileSync(file, "utf8")) as Campaign;
  const { graph, problems } = parseCampaignGraph(campaign);
  const relative = path.relative(REPO_ROOT, path.resolve(file));
  return { file: relative.startsWith("..") ? file : relative, campaign, graph, problems };
}

/**
 * Every campaign file the inspection gate covers: the graph fixtures, then the
 * campaigns under `content/campaigns` — all of them, so an ordered campaign is
 * *seen* and skipped (the gate's test asserts that) rather than silently not
 * listed.
 */
export function campaignFiles(root: string = REPO_ROOT): { fixtures: string[]; content: string[] } {
  const list = (dir: string, suffix: string): string[] =>
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((name) => name.endsWith(suffix))
          .sort()
          .map((name) => path.join(dir, name))
      : [];
  return {
    fixtures: list(path.join(root, "packages", "shared", "src", "fixtures"), ".campaign.json"),
    content: list(path.join(root, "content", "campaigns"), ".json"),
  };
}

/**
 * `--campaign <file-or-id>`: a path that exists, else an id (or file stem)
 * looked up in the fixtures and then in `content/campaigns`. Returns null when
 * nothing matches, so the CLI can say what it tried.
 */
export function resolveCampaign(arg: string, root: string = REPO_ROOT): string | null {
  if (fs.existsSync(arg) && fs.statSync(arg).isFile()) return path.resolve(arg);
  const { fixtures, content } = campaignFiles(root);
  for (const file of [...fixtures, ...content]) {
    const stem = path.basename(file).replace(/\.campaign\.json$|\.json$/, "");
    if (stem === arg) return file;
  }
  for (const file of [...fixtures, ...content]) {
    try {
      if ((JSON.parse(fs.readFileSync(file, "utf8")) as { id?: string }).id === arg) return file;
    } catch {
      // an unreadable file is reported when it is opened by name
    }
  }
  return null;
}

/** The chapter files under `content/chapters`, by id — empty when there are none to read. */
export function loadChapters(dir: string = CHAPTER_DIR): Map<string, Chapter> {
  const out = new Map<string, Chapter>();
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).filter((each) => each.endsWith(".json")).sort()) {
    const chapter = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as Chapter;
    out.set(chapter.id, chapter);
  }
  return out;
}

/**
 * What the explorer is told about each chapter — the same reading
 * `content:validate` gives it: a chapter that loaded is read for its
 * `setFlag`s, a chapter with no file (a fixture's placeholder) is unknown and
 * may write any flag either way, the conservative reading.
 */
export function chapterFlagsFrom(chapters: ReadonlyMap<string, Chapter>): (id: string) => ChapterFlagWrites | undefined {
  return (id) => (chapters.has(id) ? chapterFlagWrites(chapters.get(id)!) : undefined);
}

// ---------------------------------------------------------------------------
// Words for conditions, effects and rifts
// ---------------------------------------------------------------------------

const list = (value: string | string[] | undefined): string => (value === undefined ? "" : Array.isArray(value) ? value.join("+") : value);

/** A guard as one line: `flag:a visited:b outcome:success`. Empty for "always". */
export function describeCondition(cond: GraphCondition | undefined): string {
  if (!cond) return "";
  const parts: string[] = [];
  if (cond.flag !== undefined) parts.push(`flag:${cond.flag}`);
  if (cond.notFlag !== undefined) parts.push(`notFlag:${cond.notFlag}`);
  for (const key of ["visited", "notVisited", "completed", "notCompleted", "traversed", "notTraversed"] as const) {
    if (cond[key] !== undefined) parts.push(`${key}:${list(cond[key])}`);
  }
  if (cond.outcome !== undefined) parts.push(`outcome:${cond.outcome}`);
  if (cond.visit !== undefined) parts.push(`visit:${cond.visit.min ?? ""}..${cond.visit.max ?? ""}`);
  for (const [id, test] of Object.entries(cond.facts ?? {})) {
    parts.push(`fact:${id}=${typeof test === "object" && test !== null ? JSON.stringify(test) : String(test)}`);
  }
  return parts.join(" ");
}

export function describeEffect(effect: GraphEffect): string {
  switch (effect.type) {
    case "setFlag":
      return `${effect.value === false ? "clear" : "set"} flag ${effect.flag}`;
    case "unlock":
      return `unlock ${effect.edge}`;
    case "lock":
      return `lock ${effect.edge}`;
    case "setFact":
      return `fact ${effect.fact} = ${JSON.stringify(effect.value)}`;
    case "adjustFact":
      return `fact ${effect.fact} ${effect.by >= 0 ? "+" : ""}${effect.by}`;
    default:
      return JSON.stringify(effect);
  }
}

/** A rift's properties as short phrases, in a fixed order. Empty for a plain edge. */
export function describeRift(edge: GraphEdge): string[] {
  const rift = edge.rift;
  if (!rift) return [];
  const out: string[] = [];
  if (rift.oneWay) out.push("one-way");
  if (rift.uses !== undefined) out.push(`${rift.uses} use${rift.uses === 1 ? "" : "s"}`);
  if (rift.lasts) out.push(`lasts ${rift.lasts.count} ${rift.lasts.unit}`);
  if (rift.opensWhen) out.push(`opens when ${describeCondition(rift.opensWhen) || "always"}`);
  if (rift.unstable?.flicker) out.push(`flickers ${rift.unstable.flicker.open} open / ${rift.unstable.flicker.shut} shut`);
  if (rift.unstable?.collapsesAfter !== undefined) out.push(`collapses after ${rift.unstable.collapsesAfter}`);
  if (rift.persistent) out.push("persistent");
  if (rift.linkedTo) out.push(`linked to ${rift.linkedTo}`);
  if (rift.reveal && rift.reveal !== "always") out.push(`reveals ${rift.reveal}`);
  return out;
}

function describeFact(fact: WorldFact): string {
  const head = `${fact.type}${fact.domain ? `/${fact.domain}` : ""}`;
  if (fact.type === "enum") return `${head} ${fact.values.join("|")} (initial ${fact.initial})`;
  if (fact.type === "counter") return `${head} ${fact.min}..${fact.max} (initial ${fact.initial})`;
  return `${head} (initial ${String(fact.initial ?? false)})`;
}

/** Tags an edge carries, in drawing order: the things a reader must see at a glance. */
export function edgeTags(edge: GraphEdge): string[] {
  const tags: string[] = [];
  if (edge.once) tags.push("once");
  if (edge.irreversible) tags.push("irreversible");
  if (edge.locked) tags.push("locked");
  if (edge.rift) tags.push("rift");
  if (edge.when && describeCondition(edge.when) !== "") tags.push("guarded");
  return tags;
}

// ---------------------------------------------------------------------------
// Text outline
// ---------------------------------------------------------------------------

export function outline(campaign: Campaign, graph: ParsedCampaignGraph): string {
  const lines: string[] = [];
  lines.push(
    `${campaign.title} (${campaign.id})  graph v${graph.version}: ${graph.nodeOrder.length} nodes, ${graph.edgeOrder.length} edges, ${graph.endings.length} ending(s)`,
  );
  lines.push(`entry: ${graph.entry}`);
  if (graph.flags.length > 0) lines.push(`flags: ${graph.flags.join(", ")}`);
  for (const id of graph.factOrder) lines.push(`fact ${id}: ${describeFact(graph.facts[id]!)}`);
  lines.push("");
  for (const id of graph.nodeOrder) {
    const node = graph.nodes[id]!;
    const marks = [
      ...(id === graph.entry ? ["entry"] : []),
      ...(node.ending ? [`ending "${node.ending.title}"`] : []),
      `revisit ${node.revisit}`,
    ];
    lines.push(`${id}${node.title ? `  "${node.title}"` : ""}  [${marks.join(", ")}]  chapter ${node.chapter}`);
    for (const [i, variant] of (node.variants ?? []).entries()) {
      const policy = variant.revisit ? ` (revisit ${variant.revisit})` : "";
      lines.push(`    variant ${i}: ${variant.chapter} when ${describeCondition(variant.when) || "always"}${policy}`);
    }
    for (const rule of node.onComplete ?? []) {
      lines.push(`    on complete${rule.when ? ` when ${describeCondition(rule.when)}` : ""}: ${rule.effects.map(describeEffect).join("; ")}`);
    }
    const exits = graph.exits[id] ?? [];
    if (exits.length === 0 && node.ending === undefined) lines.push("    (no exits)");
    for (const edgeId of exits) {
      const edge = graph.edges[edgeId]!;
      const tags = edgeTags(edge).filter((tag) => tag !== "guarded");
      const head = `    ${edge.kind.padEnd(8)} ${edgeId} -> ${edge.to}${tags.length > 0 ? `  [${tags.join(", ")}]` : ""}${edge.label ? `  "${edge.label}"` : ""}`;
      lines.push(head);
      if (edge.blocked === "shown") lines.push("             shown even when blocked");
      const guard = describeCondition(edge.when);
      if (guard !== "") lines.push(`             when ${guard}`);
      for (const effect of edge.effects ?? []) lines.push(`             effect: ${describeEffect(effect)}`);
      const rift = describeRift(edge);
      if (rift.length > 0) lines.push(`             rift: ${rift.join(", ")}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Mermaid
// ---------------------------------------------------------------------------

/** Mermaid ids are identifiers; node ids are `a-b_c`, and `end` is a reserved word there. */
const mid = (id: string): string => `n_${id.replace(/[^a-z0-9]/g, "_")}`;
const mq = (text: string): string => text.replaceAll('"', "#quot;");

/**
 * A flowchart: nodes as boxes (the entry bold, endings as stadiums, closed
 * places greyed), edges by kind — forward solid, sideways thick, return solid
 * grey with a back-arrow glyph — and every rift **dashed**, `once` edges
 * amber, `irreversible` edges red. The edge label is its id plus its tags, so
 * a drawing can be matched to the JSON it came from.
 */
export function toMermaid(campaign: Campaign, graph: ParsedCampaignGraph): string {
  const out: string[] = [`%% ${campaign.title} (${campaign.id}), generated by npm run content:journey`, "flowchart LR"];
  for (const id of graph.nodeOrder) {
    const node = graph.nodes[id]!;
    const title = node.title ?? node.ending?.title ?? id;
    const sub = node.ending ? "ending" : node.revisit !== "replay" ? `revisit: ${node.revisit}` : "";
    const label = mq(sub ? `${title}<br/>${sub}` : title);
    out.push(`  ${mid(id)}${node.ending ? `(["${label}"])` : `["${label}"]`}`);
  }
  const styled: string[] = [];
  graph.edgeOrder.forEach((id, i) => {
    const edge = graph.edges[id]!;
    const tags = edgeTags(edge);
    const label = mq(`${id}${edge.kind === "return" ? " (return)" : ""}${tags.length > 0 ? `<br/>${tags.join(", ")}` : ""}`);
    const arrow = edge.rift ? "-.->" : edge.kind === "sideways" ? "==>" : "-->";
    out.push(`  ${mid(edge.from)} ${arrow}|"${label}"| ${mid(edge.to)}`);
    const style: string[] = [];
    if (edge.irreversible) style.push("stroke:#c0392b", "stroke-width:3px");
    else if (edge.once) style.push("stroke:#d68910");
    else if (edge.kind === "return") style.push("stroke:#7f8c8d");
    else if (edge.kind === "sideways") style.push("stroke:#2874a6");
    if (edge.rift) style.push("stroke-dasharray:6 4");
    if (style.length > 0) styled.push(`  linkStyle ${i} ${style.join(",")}`);
  });
  out.push(...styled);
  out.push("  classDef entry stroke:#1e8449,stroke-width:3px");
  out.push("  classDef ending fill:#fcf3cf,stroke:#b7950b");
  out.push("  classDef closed fill:#eaecee,stroke:#7f8c8d,stroke-dasharray:3 3");
  const entry = [graph.entry];
  const endings = graph.endings;
  const closed = graph.nodeOrder.filter((id) => graph.nodes[id]!.revisit === "closed" && graph.nodes[id]!.ending === undefined);
  out.push(`  class ${entry.map(mid).join(",")} entry`);
  if (endings.length > 0) out.push(`  class ${endings.map(mid).join(",")} ending`);
  if (closed.length > 0) out.push(`  class ${closed.map(mid).join(",")} closed`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// DOT
// ---------------------------------------------------------------------------

const dq = (text: string): string => `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
/** A multi-line DOT label: each line escaped, joined by DOT's own `\n`. */
const dqLines = (lines: readonly string[]): string => `"${lines.map((line) => dq(line).slice(1, -1)).join("\\n")}"`;

/** Graphviz: the same drawing as {@link toMermaid}, for `dot -Tsvg` and friends. */
export function toDot(campaign: Campaign, graph: ParsedCampaignGraph): string {
  const out: string[] = [
    `// ${campaign.title} (${campaign.id}), generated by npm run content:journey`,
    `digraph ${dq(campaign.id)} {`,
    "  rankdir=LR;",
    '  node [shape=box, style="rounded"];',
  ];
  for (const id of graph.nodeOrder) {
    const node = graph.nodes[id]!;
    const attrs = [`label=${dq(node.title ?? node.ending?.title ?? id)}`];
    if (node.ending) attrs.push("shape=doubleoctagon", 'fillcolor="#fcf3cf"', 'style="filled"');
    if (id === graph.entry) attrs.push("penwidth=3", 'color="#1e8449"');
    if (node.revisit === "closed" && !node.ending) attrs.push('style="rounded,dashed"');
    if (node.revisit === "pass") attrs.push('xlabel="pass"');
    out.push(`  ${dq(id)} [${attrs.join(", ")}];`);
  }
  for (const id of graph.edgeOrder) {
    const edge = graph.edges[id]!;
    const tags = edgeTags(edge);
    const attrs = [`label=${dqLines(tags.length > 0 ? [id, tags.join(", ")] : [id])}`];
    if (edge.rift) attrs.push("style=dashed");
    if (edge.irreversible) attrs.push('color="#c0392b"', "penwidth=3");
    else if (edge.once) attrs.push('color="#d68910"');
    else if (edge.kind === "return") attrs.push('color="#7f8c8d"');
    else if (edge.kind === "sideways") attrs.push('color="#2874a6"', "penwidth=2");
    out.push(`  ${dq(edge.from)} -> ${dq(edge.to)} [${attrs.join(", ")}];`);
  }
  out.push("}");
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/** The declaration, normalized, as plain data a script can read. */
export function toSummary(campaign: Campaign, graph: ParsedCampaignGraph) {
  return {
    id: campaign.id,
    title: campaign.title,
    version: graph.version,
    entry: graph.entry,
    flags: graph.flags,
    facts: graph.factOrder.map((id) => ({ id, ...graph.facts[id]! })),
    nodes: graph.nodeOrder.map((id) => ({
      id,
      ...graph.nodes[id]!,
      entry: id === graph.entry,
      exits: graph.exits[id],
    })),
    edges: graph.edgeOrder.map((id) => ({ id, ...graph.edges[id]!, tags: edgeTags(graph.edges[id]!) })),
    endings: graph.endings,
  };
}

/** True for a campaign the tooling should inspect; ordered campaigns are skipped by design. */
export const isGraphSubject = (subject: GraphSubject): subject is GraphSubject & { graph: ParsedCampaignGraph } =>
  campaignMode(subject.campaign) === "graph" && subject.graph !== null;
