/**
 * The listening page: every sample, every engine, side by side
 * (docs/voice-bakeoff.md). One static file next to the clips, with the results
 * embedded, so it opens from disk with no server.
 *
 * What it does in the browser:
 *  - plays a cell's clips in order and highlights the script line being
 *    spoken, so what you hear is tied to the words it is for;
 *  - blind mode: engines become A, B, C…, shuffled per sample, until you
 *    reveal them;
 *  - a score from 1 to 5, quick flags and a note per cell, kept in this
 *    browser's localStorage, with an engine-by-tier summary and a JSON export.
 */

import type { Sample } from "./samples.ts";

export interface ClipRef {
  file: string;
  lines: number[];
  chars: number;
  renderMs: number | null;
}

export interface Take {
  clips: ClipRef[];
  error?: string;
}

export interface Cell {
  takes?: Take[];
  unsupported?: string;
}

export interface Results {
  generated: string;
  tiers: Record<string, string>;
  samples: Sample[];
  engines: { id: string; label: string; provider: string; model: string; mode: string }[];
  /** engine id → sample id → cell. */
  cells: Record<string, Record<string, Cell>>;
}

export function renderPage(results: Results): string {
  const data = JSON.stringify(results).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Voice bake-off</title>
<style>
:root {
  --bg: #faf7f2; --card: #ffffff; --ink: #2b2620; --muted: #6f665b; --line: #e6dfd4;
  --accent: #b5562a; --accent-soft: #f6e6dc; --now: #fff1c2; --bad: #a3322a; --ok: #2f7a4a;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1b1916; --card: #24211d; --ink: #efe9e0; --muted: #a69c8f; --line: #3a352f;
    --accent: #e08a5c; --accent-soft: #3a2a20; --now: #4a3f1c; --bad: #e07a70; --ok: #6cc08b;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { position: sticky; top: 0; z-index: 2; background: var(--bg); border-bottom: 1px solid var(--line); padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
header h1 { font-size: 18px; margin: 0 8px 0 0; }
header .meta { color: var(--muted); font-size: 13px; }
header .tools { min-width: 0; max-width: 100%; margin-left: auto; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
select { max-width: 100%; min-width: 0; }
button, select { font: inherit; color: inherit; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; cursor: pointer; }
button:hover { border-color: var(--accent); }
button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
main { max-width: 1400px; margin: 0 auto; padding: 16px; }
.tier { margin: 28px 0 8px; }
.tier h2 { font-size: 16px; margin: 0; }
.tier p { margin: 2px 0 0; color: var(--muted); }
.sample { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin: 12px 0; }
.sample h3 { margin: 0; font-size: 16px; }
.sample .tests { color: var(--muted); margin: 2px 0 8px; }
.sample .addr { font: 12px ui-monospace, monospace; color: var(--muted); overflow-wrap: anywhere; }
.badge { display: inline-block; font-size: 12px; padding: 1px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); margin-left: 6px; vertical-align: 2px; }
.script { margin: 10px 0 14px; display: grid; gap: 4px; }
.script div { padding: 2px 8px; border-left: 3px solid var(--line); border-radius: 4px; }
.script div.now { background: var(--now); border-left-color: var(--accent); }
.script b { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin-right: 6px; }
.script i { font-size: 12px; color: var(--accent); margin-left: 6px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.cell { border: 1px solid var(--line); border-radius: 10px; padding: 10px; display: grid; gap: 8px; align-content: start; }
.cell.playing { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.cell .name { font-weight: 600; }
.cell .stats { font-size: 12px; color: var(--muted); }
.cell .err { font-size: 12px; color: var(--bad); overflow-wrap: anywhere; }
.cell .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.score button { width: 32px; padding: 4px 0; }
.flags { display: flex; flex-wrap: wrap; gap: 4px; }
.flags button { font-size: 12px; padding: 2px 8px; border-radius: 999px; }
textarea { width: 100%; min-height: 44px; font: inherit; font-size: 13px; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 6px; }
table { border-collapse: collapse; width: 100%; background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
th, td { padding: 6px 10px; border-bottom: 1px solid var(--line); text-align: left; font-variant-numeric: tabular-nums; }
th { font-size: 13px; color: var(--muted); font-weight: 600; }
#summary { margin: 8px 0 0; overflow-x: auto; }
@media (max-width: 600px) { header .tools { margin-left: 0; } }
</style>
</head>
<body>
<header>
  <h1>Voice bake-off</h1>
  <span class="meta" id="meta"></span>
  <div class="tools">
    <select id="tier" aria-label="Show tier"><option value="">All tiers</option></select>
    <button id="blind" type="button">Blind</button>
    <button id="scores" type="button">Scores</button>
    <button id="export" type="button">Export ratings</button>
  </div>
</header>
<main>
  <div id="summary" hidden></div>
  <div id="samples"></div>
</main>
<script type="application/json" id="data">${data}</script>
<script>
(() => {
  const data = JSON.parse(document.getElementById("data").textContent);
  const STORE = "kad.voice-bakeoff";
  const FLAGS = ["wrong voice", "mispronounced", "delivery off", "robotic", "clipped", "read the prompt"];
  const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; } };
  const state = Object.assign({ blind: false, salt: Math.random().toString(36).slice(2), ratings: {}, revealed: {} }, load());
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} };
  save();

  const el = (tag, props = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined) node.append(kid);
    return node;
  };
  const rating = (sample, engine) => ((state.ratings[sample] ||= {})[engine] ||= { score: 0, flags: [], notes: "" });

  // A stable shuffle per sample, so blind letters do not move between reloads.
  const hash = (text) => { let h = 2166136261; for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  const order = (sampleId, engines) => state.blind ? [...engines].sort((a, b) => hash(state.salt + sampleId + a.id) - hash(state.salt + sampleId + b.id)) : engines;

  let player = null;
  function stop() {
    if (!player) return;
    player.audio.pause();
    player.cell.classList.remove("playing");
    player.script.querySelectorAll(".now").forEach((n) => n.classList.remove("now"));
    player.button.textContent = "Play";
    player = null;
  }
  function play(clips, cell, script, button) {
    const same = player && player.cell === cell;
    stop();
    if (same) return;
    let i = 0;
    const audio = new Audio();
    player = { audio, cell, script, button };
    cell.classList.add("playing");
    button.textContent = "Stop";
    const next = () => {
      script.querySelectorAll(".now").forEach((n) => n.classList.remove("now"));
      if (i >= clips.length || !player || player.audio !== audio) { if (player && player.audio === audio) stop(); return; }
      const clip = clips[i++];
      clip.lines.forEach((line) => script.children[line]?.classList.add("now"));
      audio.src = clip.file;
      audio.play().catch(() => stop());
    };
    // A short breath between lines, as the game would leave between clips.
    audio.addEventListener("ended", () => setTimeout(next, 150));
    next();
  }

  function cellFor(sample, engine, letter, script) {
    const cell = data.cells[engine.id]?.[sample.id];
    const revealed = !state.blind || state.revealed[sample.id];
    const title = revealed ? engine.label : "Engine " + letter;
    const box = el("div", { class: "cell" }, el("div", { class: "name" }, title));
    if (!cell) { box.append(el("div", { class: "stats" }, "Not rendered yet.")); return box; }
    if (cell.unsupported) { box.append(el("div", { class: "err" }, cell.unsupported)); return box; }
    const takes = cell.takes || [];
    let take = 0;
    const stats = el("div", { class: "stats" });
    const err = el("div", { class: "err" });
    const button = el("button", { type: "button" }, "Play");
    const showTake = () => {
      const t = takes[take];
      err.textContent = t.error || "";
      button.disabled = !!t.error || t.clips.length === 0;
      const chars = t.clips.reduce((s, c) => s + c.chars, 0);
      const ms = t.clips.reduce((s, c) => s + (c.renderMs || 0), 0);
      stats.textContent = chars + " chars · " + t.clips.length + (t.clips.length === 1 ? " request" : " requests") + (ms ? " · rendered in " + (ms / 1000).toFixed(1) + "s" : "");
    };
    button.addEventListener("click", () => play(takes[take].clips, box, script, button));
    const controls = el("div", { class: "row" }, button);
    if (takes.length > 1) {
      const pick = el("select", { "aria-label": "Take" }, takes.map((_, i) => el("option", { value: String(i) }, "Take " + (i + 1))));
      pick.addEventListener("change", () => { stop(); take = Number(pick.value); showTake(); });
      controls.append(pick);
    }
    showTake();
    const r = rating(sample.id, engine.id);
    const score = el("div", { class: "row score", role: "group", "aria-label": "Score" });
    for (let n = 1; n <= 5; n++) {
      const b = el("button", { type: "button", class: r.score === n ? "on" : "" }, String(n));
      b.addEventListener("click", () => { r.score = r.score === n ? 0 : n; save(); draw(); });
      score.append(b);
    }
    const flags = el("div", { class: "flags" }, FLAGS.map((flag) => {
      const b = el("button", { type: "button", class: r.flags.includes(flag) ? "on" : "" }, flag);
      b.addEventListener("click", () => { r.flags = r.flags.includes(flag) ? r.flags.filter((f) => f !== flag) : [...r.flags, flag]; save(); b.classList.toggle("on"); });
      return b;
    }));
    const notes = el("textarea", { placeholder: "Notes", "aria-label": "Notes" });
    notes.value = r.notes;
    notes.addEventListener("input", () => { r.notes = notes.value; save(); });
    box.append(controls, stats, err, score, flags, notes);
    return box;
  }

  function sampleCard(sample) {
    const script = el("div", { class: "script" }, sample.lines.map((line) =>
      el("div", {}, el("b", {}, line.by.replace(/_/g, " ")), line.text, line.delivery ? el("i", {}, line.delivery) : null)));
    const grid = el("div", { class: "grid" });
    order(sample.id, data.engines).forEach((engine, i) => grid.append(cellFor(sample, engine, String.fromCharCode(65 + i), script)));
    const head = el("div", { class: "row" }, el("h3", {}, sample.title, sample.group ? el("span", { class: "badge" }, "same voice: " + sample.group) : null));
    if (state.blind) {
      const reveal = el("button", { type: "button" }, state.revealed[sample.id] ? "Hide names" : "Reveal");
      reveal.addEventListener("click", () => { state.revealed[sample.id] = !state.revealed[sample.id]; save(); draw(); });
      head.append(reveal);
    }
    return el("section", { class: "sample", id: sample.id }, head, el("p", { class: "tests" }, sample.tests), el("div", { class: "addr" }, sample.address), script, grid);
  }

  function summary() {
    const tiers = Object.keys(data.tiers);
    const rows = data.engines.map((engine) => {
      const per = tiers.map((tier) => {
        const scores = data.samples.filter((s) => s.tier === tier).map((s) => state.ratings[s.id]?.[engine.id]?.score || 0).filter(Boolean);
        return scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) + " (" + scores.length + ")" : "";
      });
      const all = data.samples.map((s) => state.ratings[s.id]?.[engine.id]?.score || 0).filter(Boolean);
      const flags = data.samples.reduce((n, s) => n + (state.ratings[s.id]?.[engine.id]?.flags.length || 0), 0);
      return el("tr", {}, el("td", {}, engine.label), per.map((p) => el("td", {}, p)), el("td", {}, all.length ? (all.reduce((a, b) => a + b, 0) / all.length).toFixed(2) : ""), el("td", {}, String(flags)));
    });
    return el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Engine"), tiers.map((t) => el("th", {}, t)), el("th", {}, "Overall"), el("th", {}, "Flags"))), el("tbody", {}, rows));
  }

  const tierSelect = document.getElementById("tier");
  for (const [tier, about] of Object.entries(data.tiers)) tierSelect.append(el("option", { value: tier }, tier + ": " + about));
  tierSelect.addEventListener("change", draw);

  function draw() {
    stop();
    document.getElementById("blind").classList.toggle("on", state.blind);
    const root = document.getElementById("samples");
    root.replaceChildren();
    for (const [tier, about] of Object.entries(data.tiers)) {
      if (tierSelect.value && tierSelect.value !== tier) continue;
      const samples = data.samples.filter((s) => s.tier === tier);
      if (samples.length === 0) continue;
      root.append(el("div", { class: "tier" }, el("h2", {}, tier), el("p", {}, about)), ...samples.map(sampleCard));
    }
    const box = document.getElementById("summary");
    if (!box.hidden) box.replaceChildren(summary());
  }

  document.getElementById("meta").textContent = data.samples.length + " samples · " + data.engines.length + " engines · rendered " + new Date(data.generated).toLocaleString();
  document.getElementById("blind").addEventListener("click", () => { state.blind = !state.blind; state.revealed = {}; save(); draw(); });
  document.getElementById("scores").addEventListener("click", (e) => {
    const box = document.getElementById("summary");
    box.hidden = !box.hidden;
    e.currentTarget.classList.toggle("on", !box.hidden);
    draw();
  });
  document.getElementById("export").addEventListener("click", () => {
    const out = { exported: new Date().toISOString(), generated: data.generated, engines: data.engines, ratings: state.ratings };
    const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" })), download: "voice-bakeoff-ratings.json" });
    document.body.append(a); a.click(); a.remove();
  });
  draw();
})();
</script>
</body>
</html>
`;
}
