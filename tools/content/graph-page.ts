/**
 * The chapter viewer's page — pure, so the geometry can be checked.
 *
 * Split out of `graph.ts` rather than left inside it because the layout is the
 * part that quietly rots. Three separate bugs in this file's first afternoon
 * were all invisible in code review and all obvious in a browser: sibling edges
 * drawn on top of each other, long edges routed *through* the boxes they were
 * skipping, and routed labels centred back over those boxes because a
 * stylesheet's `text-anchor` beats a presentation attribute. A file that only
 * ever ran as a CLI could not be asked about any of them.
 *
 * `graph.ts` reads the content tree and writes the files; everything here is a
 * function of a chapter.
 */

import type { Chapter, ChapterIssue, ChapterMap, MapEdge, MapNode } from "@kad/shared";

// --- Geometry ---------------------------------------------------------------
// One box is wide enough for a scene id at 13px monospace and two lines under
// it. Everything else is derived, so retuning the picture is these five numbers.
const BOX_W = 210;
const BOX_H = 62;
const COL_GAP = 34;
// Tight, because longest-path layering makes a mostly-linear chapter a tall
// ribbon — the reference chapter is 22 rows and most of them hold one scene.
// That is the shape it really is; the gap only decides how much scrolling it
// costs to see it.
const ROW_GAP = 72;
const PAD = 40;

function nodeX(node: MapNode, widest: number, perRow: Map<number, number>, gutter: number): number {
  const inRow = perRow.get(node.row) ?? 1;
  // Rows are centred against the widest row, so the trunk of the story runs
  // down the middle instead of hugging the left edge.
  const rowWidth = inRow * BOX_W + (inRow - 1) * COL_GAP;
  const left = PAD + gutter + (widest - rowWidth) / 2;
  return left + node.column * (BOX_W + COL_GAP);
}

function nodeY(node: MapNode): number {
  return PAD + node.row * (BOX_H + ROW_GAP);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Long labels get an ellipsis rather than overlapping the box next door. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

interface Point {
  x: number;
  y: number;
}

/** A point on the cubic, so a label can sit *on* its own curve. */
function bezierAt(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/**
 * One edge. `index` and `siblings` are its place among the edges leaving the
 * same scene, and they are what stop a branching scene from drawing four curves
 * and four labels on top of each other.
 *
 * The reference chapter has three species-gated choices from its opening scene
 * that all lead to the same place. Without the fan they are one line, and the
 * picture says the opening has one way out when it has four.
 */
function drawEdge(
  edge: MapEdge,
  from: MapNode,
  to: MapNode | undefined,
  place: (node: MapNode) => { x: number; y: number },
  index = 0,
  siblings = 1,
  /**
   * An absolute x to route the curve through, or null for a straight drop.
   *
   * Absolute rather than an offset from the source, and that is the whole
   * lesson of the two drafts before this one. An edge spanning four rows has to
   * clear every box between, and how far that is depends on where the *widest*
   * row reaches — not on where this particular scene happens to sit. A bow
   * measured from the node lands on the box in the next column whenever a row
   * holds more than one scene, and the label with it.
   */
  apexX: number | null = null,
): string {
  const a = place(from);
  // Spread the departure across the bottom of the box, centred. Capped so a
  // scene with eight choices does not leave the box it came from.
  const spread = Math.min(26, (BOX_W - 40) / Math.max(1, siblings));
  const fan = (index - (siblings - 1) / 2) * spread;
  const start = { x: a.x + BOX_W / 2 + fan, y: a.y + BOX_H };

  /*
   * An edge to a scene that does not exist still gets drawn — as a stub going
   * nowhere, ending in the void under its own box. `content:validate` reports
   * it as UNKNOWN_GOTO; a picture that silently dropped the broken choice would
   * be hiding exactly the thing the author needs to see.
   */
  if (!to) {
    const end = { x: start.x, y: start.y + ROW_GAP * 0.5 };
    return (
      `<path class="edge edge--broken" d="M${String(start.x)} ${String(start.y)} L${String(end.x)} ${String(end.y)}"/>` +
      `<text class="edge-label edge-label--broken" x="${String(end.x + 6)}" y="${String(end.y)}">${escapeHtml(clip(edge.to, 22))} — missing</text>`
    );
  }

  const b = place(to);
  const end = { x: b.x + BOX_W / 2, y: edge.backward ? b.y + BOX_H : b.y };
  // Cubic with vertical control points: the curve leaves the bottom of one box
  // and arrives at the top of the next, so direction reads without arrowheads
  // having to be large.
  const bend = Math.max(30, Math.abs(end.y - start.y) / 2);
  /*
   * Both control points pushed the same way, so the curve leaves the trunk,
   * travels beside it, and comes back — rather than crossing it twice.
   *
   * The control x is solved back from where the curve should actually *go*,
   * not set to it. A cubic's midpoint is
   *   B(½) = ⅛·P₀ + ⅜·P₁ + ⅜·P₂ + ⅛·P₃
   * so with both controls at `apexX` the curve only reaches three quarters of
   * the way there — which is how the previous draft put its labels back inside
   * the column it was trying to route around.
   */
  const controlX =
    apexX === null ? null : (apexX - 0.125 * (start.x + end.x)) / 0.75;
  const c1 = { x: controlX ?? start.x, y: start.y + bend * (apexX === null ? 1 : 0.55) };
  const c2 = { x: controlX ?? end.x, y: end.y - bend * (apexX === null ? 1 : 0.55) };
  const path = `M${String(start.x)} ${String(start.y)} C${String(c1.x)} ${String(c1.y)}, ${String(c2.x)} ${String(c2.y)}, ${String(end.x)} ${String(end.y)}`;

  const classes = ["edge", `edge--${edge.kind}`, edge.gate ? "edge--gated" : "", edge.backward ? "edge--back" : ""]
    .filter(Boolean)
    .join(" ");

  /*
   * The label sits *on* its own curve. Where on it depends on whether the edge
   * bowed, and the two cases want opposite things:
   *
   *   - A straight drop between adjacent rows has one clear gap to put a label
   *     in, and its siblings want spreading *along* the curve so three labels
   *     do not stack at one midpoint — which is what the first draft drew.
   *   - A bowed edge is closest to the trunk at both ends and furthest from it
   *     at the apex, so the apex is the only place the label is clear of the
   *     boxes it is going around. Siblings on the same side (they alternate, so
   *     that is every other one) get separated vertically instead, and the text
   *     anchors *away* from the trunk so it grows into the gutter.
   */
  const label = edge.gate ? `${edge.label} · ${edge.gate}` : edge.label;
  if (apexX !== null) {
    const at = bezierAt(0.5, start, c1, c2, end);
    /*
     * Two components, because two different edges can want the same apex.
     * Siblings out of one scene alternate sides and so only collide two at a
     * time; two *different* scenes side by side in a row both route left with
     * the same index and land on each other, which is what the two checks in
     * the reference chapter did.
     */
    const stagger = (Math.floor(index / 2) + from.column) * 16;
    /*
     * A class rather than a `text-anchor` attribute. `.edge-label` sets
     * `text-anchor: middle` in the stylesheet, and in SVG a CSS declaration
     * beats a presentation attribute — so the attribute version of this drew
     * every routed label centred on the apex and back over the boxes the route
     * had just gone around, which is a very quiet way to undo the whole detour.
     */
    const anchor = apexX < start.x ? "edge-label--end" : "edge-label--start";
    const nudge = apexX < start.x ? -8 : 8;
    return (
      `<path class="${classes}" d="${path}" marker-end="url(#tip)"/>` +
      `<text class="edge-label ${anchor}" x="${String(Math.round(at.x) + nudge)}" y="${String(Math.round(at.y) + stagger)}">${escapeHtml(clip(label, 34))}</text>`
    );
  }

  const t = siblings === 1 ? 0.5 : 0.3 + (0.45 * index) / Math.max(1, siblings - 1);
  const at = bezierAt(t, start, c1, c2, end);
  /*
   * Labels from the left of a row ride a little higher than labels from the
   * right. Sibling staggering only separates edges out of the *same* scene, and
   * the two checks side by side in the reference chapter both drop into the
   * same scene and collided at the same height. One rule, no bookkeeping.
   */
  const lane = (from.column * 2 - 1) * 12;
  return (
    `<path class="${classes}" d="${path}" marker-end="url(#tip)"/>` +
    `<text class="edge-label" x="${String(Math.round(at.x))}" y="${String(Math.round(at.y) - 4 + lane)}">${escapeHtml(clip(label, 34))}</text>`
  );
}

function drawNode(node: MapNode, issues: ChapterIssue[], place: (n: MapNode) => { x: number; y: number }): string {
  const { x, y } = place(node);
  const mine = issues.filter((issue) => issue.sceneId === node.id);
  const worst = mine.some((issue) => issue.severity === "error")
    ? "error"
    : mine.length > 0
      ? "warning"
      : null;

  const classes = [
    "node",
    `node--${node.type}`,
    node.entry ? "node--entry" : "",
    node.terminal ? "node--terminal" : "",
    node.reachable ? "" : "node--orphan",
    worst ? `node--${worst}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const badges = [
    node.entry ? "start" : "",
    node.terminal ? "ends here" : "",
    node.reachable ? "" : "orphan",
  ].filter(Boolean);

  return (
    `<g class="${classes}" data-scene="${escapeHtml(node.id)}" tabindex="0" role="button">` +
    `<rect x="${String(x)}" y="${String(y)}" width="${String(BOX_W)}" height="${String(BOX_H)}" rx="10"/>` +
    `<text class="node-id" x="${String(x + 12)}" y="${String(y + 24)}">${escapeHtml(clip(node.id, 24))}</text>` +
    `<text class="node-meta" x="${String(x + 12)}" y="${String(y + 44)}">${escapeHtml([node.type, ...badges].join(" · "))}</text>` +
    (worst ? `<circle class="node-flag" cx="${String(x + BOX_W - 14)}" cy="${String(y + 16)}" r="6"/>` : "") +
    `</g>`
  );
}

/** Everything the inspector shows about one scene, as plain data. */
function inspect(chapter: Chapter, map: ChapterMap, issues: ChapterIssue[]): string {
  const detail = Object.fromEntries(
    map.nodes.map((node) => {
      const scene = chapter.scenes[node.id];
      return [
        node.id,
        {
          type: node.type,
          depth: node.depth,
          reachable: node.reachable,
          terminal: node.terminal,
          out: map.edges
            .filter((edge) => edge.from === node.id)
            .map((edge) => ({ to: edge.to, kind: edge.kind, label: edge.label, gate: edge.gate })),
          in: map.edges
            .filter((edge) => edge.to === node.id)
            .map((edge) => ({ from: edge.from, kind: edge.kind, label: edge.label })),
          issues: issues
            .filter((issue) => issue.sceneId === node.id)
            .map((issue) => ({ severity: issue.severity, code: issue.code, message: issue.message })),
          json: scene ?? null,
        },
      ];
    }),
  );
  // `</script>` inside authored narration would close the tag early.
  return JSON.stringify(detail).replace(/</g, "\\u003c");
}

export function page(chapter: Chapter, map: ChapterMap, issues: ChapterIssue[]): string {
  const perRow = new Map<number, number>();
  for (const node of map.nodes) perRow.set(node.row, (perRow.get(node.row) ?? 0) + 1);
  const widestCount = Math.max(1, ...perRow.values());
  const widest = widestCount * BOX_W + (widestCount - 1) * COL_GAP;
  const rows = Math.max(1, ...map.nodes.map((node) => node.row + 1));

  const byId = new Map(map.nodes.map((node) => [node.id, node]));

  /*
   * Long edges swing out of the trunk, so the page needs a margin wide enough
   * to hold the widest detour on each side. Measured rather than guessed: a
   * fixed gutter is either wasted whitespace on a linear chapter or a clipped
   * curve on a branching one.
   */
  const spanOf = (edge: MapEdge): number => {
    const to = byId.get(edge.to);
    const from = byId.get(edge.from);
    return to && from ? Math.abs(to.row - from.row) : 0;
  };
  /*
   * A margin either side, wide enough to hold a routed edge *and* the label
   * hanging off its apex. Only paid for when something actually skips a row —
   * a purely linear chapter gets no empty margins.
   */
  const LABEL_ROOM = 230;
  const skips = map.edges.some((edge) => spanOf(edge) > 1);
  const gutter = skips ? LABEL_ROOM : 16;

  const place = (node: MapNode) => ({ x: nodeX(node, widest, perRow, gutter), y: nodeY(node) });

  const width = widest + PAD * 2 + gutter * 2;
  const height = rows * (BOX_H + ROW_GAP) + PAD * 2;

  const orphanBand =
    map.nodes.some((node) => !node.reachable) && map.depth > 0
      ? `<line class="band" x1="${String(PAD / 2)}" y1="${String(PAD + map.depth * (BOX_H + ROW_GAP) - ROW_GAP / 2)}" x2="${String(width - PAD / 2)}" y2="${String(PAD + map.depth * (BOX_H + ROW_GAP) - ROW_GAP / 2)}"/>` +
        `<text class="band-label" x="${String(PAD / 2)}" y="${String(PAD + map.depth * (BOX_H + ROW_GAP) - ROW_GAP / 2 - 8)}">nothing reaches these</text>`
      : "";

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(chapter.title)} — scene graph</title>
<style>
  :root {
    color-scheme: dark;
    --ink: #ece9ff; --dim: #9c96c4; --line: #3a3560;
    --bg: #0d0b1c; --card: #171334; --sunken: #120f26;
    --error: #ff8080; --warn: #ffcc66; --ok: #7fd4c1;
    --story: #7fa9d4; --check: #c9a0e8; --encounter: #ff9d7a; --rest: #7fd4c1;
    --choice_point: #ffd27a; --ending: #f0c0dd;
  }
  * { box-sizing: border-box; }
  body { margin: 0; display: flex; min-height: 100vh; background: var(--bg); color: var(--ink);
         font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { flex: 1 1 auto; overflow: auto; }
  header { position: sticky; top: 0; z-index: 2; padding: 12px 16px; background: var(--sunken);
           border-bottom: 1px solid var(--line); }
  h1 { margin: 0; font-size: 16px; }
  .sub { margin: 2px 0 0; color: var(--dim); font-size: 12px; }
  .counts b { font-variant-numeric: tabular-nums; }
  .counts .e { color: var(--error); } .counts .w { color: var(--warn); } .counts .g { color: var(--ok); }

  aside { flex: 0 0 340px; border-left: 1px solid var(--line); background: var(--sunken);
          padding: 16px; overflow: auto; }
  aside h2 { margin: 0 0 4px; font-size: 15px; font-family: ui-monospace, monospace; }
  aside h3 { margin: 16px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em;
             color: var(--dim); }
  aside ul { margin: 0; padding-left: 16px; }
  aside li { margin: 2px 0; }
  aside pre { margin: 0; padding: 8px; background: var(--card); border-radius: 6px;
              font-size: 11px; white-space: pre-wrap; word-break: break-word; max-height: 40vh;
              overflow: auto; }
  .gate { color: var(--warn); }
  .issue { color: var(--error); }
  .issue.warning { color: var(--warn); }
  .empty { color: var(--dim); }

  svg { display: block; }
  .node rect { fill: var(--card); stroke: var(--line); stroke-width: 2; cursor: pointer; }
  .node:hover rect, .node:focus rect { stroke: var(--ink); outline: none; }
  .node.selected rect { stroke: var(--ink); stroke-width: 3; }
  .node-id { fill: var(--ink); font: 600 13px ui-monospace, monospace; pointer-events: none; }
  .node-meta { fill: var(--dim); font-size: 11px; pointer-events: none; }
  .node--story rect { stroke: var(--story); }
  .node--check rect { stroke: var(--check); }
  .node--encounter rect { stroke: var(--encounter); }
  .node--rest rect { stroke: var(--rest); }
  .node--choice_point rect { stroke: var(--choice_point); }
  .node--ending rect { stroke: var(--ending); }
  .node--entry rect { stroke-width: 3; }
  .node--orphan rect { stroke-dasharray: 6 4; opacity: .75; }
  .node-flag { fill: var(--warn); }
  .node--error .node-flag { fill: var(--error); }

  .edge { fill: none; stroke: var(--line); stroke-width: 2; }
  .edge--success { stroke: var(--ok); }
  .edge--failure, .edge--defeat { stroke: var(--error); }
  .edge--victory { stroke: var(--ok); }
  .edge--gated { stroke-dasharray: 5 4; }
  .edge--back { stroke: var(--warn); }
  .edge--broken { stroke: var(--error); stroke-dasharray: 3 3; }
  .edge-label { fill: var(--dim); font-size: 10px; text-anchor: middle; pointer-events: none; }
  .edge-label--start { text-anchor: start; }
  .edge-label--end { text-anchor: end; }
  .edge-label--broken { fill: var(--error); text-anchor: start; }
  .band { stroke: var(--line); stroke-dasharray: 8 6; }
  .band-label { fill: var(--dim); font-size: 11px; }
</style>
</head>
<body>
<main>
  <header>
    <h1>${escapeHtml(chapter.title)} <span class="empty">${escapeHtml(chapter.id)}</span></h1>
    <p class="sub counts">
      ${String(map.nodes.length)} scenes · ${String(map.edges.length)} edges · ${String(map.depth)} deep ·
      ${errors.length > 0 ? `<b class="e">${String(errors.length)} errors</b>` : ""}
      ${warnings.length > 0 ? `<b class="w">${String(warnings.length)} warnings</b>` : ""}
      ${issues.length === 0 ? `<b class="g">clean</b>` : ""}
      · dashed = hidden unless the party matches · amber = goes back up
    </p>
  </header>
  <svg width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">
    <defs>
      <marker id="tip" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0 0 L8 4 L0 8 z" fill="currentColor"/>
      </marker>
    </defs>
    ${orphanBand}
    ${map.edges
      .map((edge) => {
        const from = byId.get(edge.from);
        if (!from) return "";
        const siblings = map.edges.filter((each) => each.from === edge.from);
        const index = siblings.indexOf(edge);
        /*
         * Sides alternate by index, and each same-side edge is nudged a little
         * further out than the one before it — the reference chapter's opening
         * scene has three species-gated choices that all lead to the same place
         * four rows down, and without both they are one curve and one label.
         */
        const left = index % 2 === 0;
        const step = Math.floor(index / 2) * 14;
        const apexX =
          spanOf(edge) > 1
            ? left
              ? PAD + gutter - 14 - step
              : PAD + gutter + widest + 14 + step
            : null;
        return drawEdge(edge, from, byId.get(edge.to), place, index, siblings.length, apexX);
      })
      .join("\n    ")}
    ${map.nodes.map((node) => drawNode(node, issues, place)).join("\n    ")}
  </svg>
</main>
<aside id="panel"><p class="empty">Click a scene.</p></aside>
<script>
const SCENES = ${inspect(chapter, map, issues)};
const panel = document.getElementById("panel");
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

function show(id) {
  const s = SCENES[id];
  if (!s) return;
  for (const g of document.querySelectorAll(".node")) g.classList.toggle("selected", g.dataset.scene === id);
  const bits = [];
  bits.push('<h2>' + esc(id) + '</h2>');
  bits.push('<p class="empty">' + esc(s.type) + (s.depth === null ? ' · unreachable' : ' · depth ' + s.depth) +
            (s.terminal ? ' · ends the chapter' : '') + '</p>');
  if (s.issues.length) {
    bits.push('<h3>Findings</h3><ul>' + s.issues.map((i) =>
      '<li class="issue ' + i.severity + '">' + esc(i.code) + ' — ' + esc(i.message) + '</li>').join('') + '</ul>');
  }
  bits.push('<h3>Out</h3>' + (s.out.length
    ? '<ul>' + s.out.map((e) => '<li>' + esc(e.label) + ' → <b>' + esc(e.to) + '</b>' +
        (e.gate ? ' <span class="gate">(' + esc(e.gate) + ')</span>' : '') + '</li>').join('') + '</ul>'
    : '<p class="empty">Nothing. This is where the chapter ends.</p>'));
  bits.push('<h3>In</h3>' + (s.in.length
    ? '<ul>' + s.in.map((e) => '<li><b>' + esc(e.from) + '</b> — ' + esc(e.label) + '</li>').join('') + '</ul>'
    : '<p class="empty">Nothing points here.</p>'));
  bits.push('<h3>Authored</h3><pre>' + esc(JSON.stringify(s.json, null, 2)) + '</pre>');
  panel.innerHTML = bits.join('');
}

for (const g of document.querySelectorAll(".node")) {
  g.addEventListener("click", () => show(g.dataset.scene));
  g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(g.dataset.scene); } });
}
</script>
</body>
</html>
`;
}
