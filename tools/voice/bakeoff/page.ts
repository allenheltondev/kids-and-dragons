/**
 * The listening page: every sample, every engine, side by side
 * (docs/voice-bakeoff.md).
 *
 * Two ways to open it:
 *  - **live** (`voice:bakeoff -- --serve`): paste API keys, pick models, add
 *    columns, render a cell or a whole column, and change who voices whom. The
 *    page asks its own local server to do the provider calls (server.ts).
 *  - **static** (`voice:bakeoff`): the file written next to the clips after a
 *    command-line run, which opens from disk with no server.
 *
 * Either way it plays a cell's clips in order and highlights the script line
 * being spoken, offers blind A/B/C comparison, and keeps a 1-5 score, quick
 * flags and a note per cell in this browser, with a summary and JSON export.
 */

import type { CastFile, EngineConfig, ModelInfo, VoiceInfo } from "./providers.ts";
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
  /** Some requests not rendered yet. */
  pending?: boolean;
}

export interface Cell {
  takes?: Take[];
  unsupported?: string;
}

export interface ResultEngine {
  id: string;
  label: string;
  provider: string;
  model: string;
  mode: string;
  delivery: string;
  context: boolean;
}

export interface Results {
  generated: string;
  tiers: Record<string, string>;
  samples: Sample[];
  engines: ResultEngine[];
  /** engine id → sample id → cell. */
  cells: Record<string, Record<string, Cell>>;
}

export interface LiveConfig {
  token: string;
  catalog: ModelInfo[];
  presets: EngineConfig[];
  speakers: CastFile["speakers"];
  geminiVoices: VoiceInfo[];
  cap: number;
  envKeys: { elevenlabs: boolean; gemini: boolean };
}

export function renderPage(results: Results, live?: LiveConfig): string {
  const data = JSON.stringify({ results, live: live ?? null }).replace(/</g, "\\u003c");
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
.meta, .hint { color: var(--muted); font-size: 13px; }
header .tools { min-width: 0; max-width: 100%; margin-left: auto; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
select, input { max-width: 100%; min-width: 0; }
button, select, input { font: inherit; color: inherit; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; }
button { cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); }
button:disabled { opacity: .5; cursor: default; }
button.on, button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
main { max-width: 1400px; margin: 0 auto; padding: 16px; }
.panel { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin: 0 0 16px; display: grid; gap: 14px; }
.panel h2 { font-size: 15px; margin: 0; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.field { display: grid; gap: 2px; font-size: 13px; color: var(--muted); }
label.field input, label.field select { color: var(--ink); }
.columns { display: grid; gap: 6px; }
.column { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
.column .label { font-weight: 600; flex: 1 1 260px; min-width: 0; }
.column .price { font-size: 13px; color: var(--muted); flex: 1 1 200px; }
.bad, .err { color: var(--bad); }
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
.cell { border: 1px solid var(--line); border-radius: 10px; padding: 10px; display: grid; gap: 8px; align-content: start; min-width: 0; }
.cell.playing { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.cell .name { font-weight: 600; overflow-wrap: anywhere; }
.cell .stats { font-size: 12px; color: var(--muted); }
.cell .err { font-size: 12px; overflow-wrap: anywhere; }
.score button { width: 32px; padding: 4px 0; }
.flags { display: flex; flex-wrap: wrap; gap: 4px; }
.flags button { font-size: 12px; padding: 2px 8px; border-radius: 999px; }
textarea { width: 100%; min-height: 44px; font: inherit; font-size: 13px; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 6px; }
table { border-collapse: collapse; width: 100%; background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
th, td { padding: 6px 10px; border-bottom: 1px solid var(--line); text-align: left; font-variant-numeric: tabular-nums; vertical-align: top; }
th { font-size: 13px; color: var(--muted); font-weight: 600; }
.scroll { overflow-x: auto; }
#summary { margin: 0 0 16px; }
details summary { cursor: pointer; font-weight: 600; }
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
  <div id="setup"></div>
  <div id="summary" class="scroll" hidden></div>
  <div id="samples"></div>
</main>
<script type="application/json" id="data">${data}</script>
<script>
(() => {
  const boot = JSON.parse(document.getElementById("data").textContent);
  const data = boot.results;
  const live = boot.live;
  const STORE = "kad.voice-bakeoff";
  const KEYS = "kad.voice-bakeoff.keys";
  const FLAGS = ["wrong voice", "mispronounced", "delivery off", "robotic", "clipped", "read the prompt"];
  const PROVIDERS = { elevenlabs: "ElevenLabs", gemini: "Gemini", fake: "Fake (no key)" };

  const load = (store, key) => { try { return JSON.parse(store.getItem(key) || "null"); } catch { return null; } };
  const state = Object.assign({ blind: false, salt: Math.random().toString(36).slice(2), ratings: {}, revealed: {}, columns: null, takes: 1, cast: {}, remember: false }, load(localStorage, STORE) || {});
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} };
  // Keys live for this tab only unless "Remember" is ticked; either way they go nowhere but the local server.
  const keys = load(sessionStorage, KEYS) || load(localStorage, KEYS) || { elevenlabs: "", gemini: "" };
  const saveKeys = () => {
    try {
      sessionStorage.setItem(KEYS, JSON.stringify(keys));
      if (state.remember) localStorage.setItem(KEYS, JSON.stringify(keys)); else localStorage.removeItem(KEYS);
    } catch {}
  };
  save();

  const el = (tag, props = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k === "value") node.value = v;
      else if (k === "checked" || k === "disabled") node[k] = !!v;
      else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
    return node;
  };
  const money = (n) => n === null || n === undefined ? "no price" : n > 0 && n < 0.005 ? "<$0.01" : "$" + n.toFixed(2);
  const rating = (sample, engine) => ((state.ratings[sample] ||= {})[engine] ||= { score: 0, flags: [], notes: "" });

  async function call(route, body) {
    const response = await fetch(route, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bakeoff-token": live.token, "x-elevenlabs-key": keys.elevenlabs || "", "x-gemini-key": keys.gemini || "" },
      body: JSON.stringify(body || {}),
    });
    const json = await response.json().catch(() => ({ error: "HTTP " + response.status }));
    if (!response.ok) throw Object.assign(new Error(json.error || "HTTP " + response.status), json);
    return json;
  }

  // ---- Columns, models and voices (live only) ----
  const liveModels = { elevenlabs: null, gemini: null };
  const liveVoices = { elevenlabs: null };
  const modelNotes = { elevenlabs: "", gemini: "" };
  let estimates = {};
  let spent = 0;
  let cap = live ? live.cap : 0;
  const busy = {};
  const pickerState = { provider: "elevenlabs", model: "", castOpen: false };

  const columns = () => state.columns || (live ? live.presets : []);
  const columnId = (c) => [c.provider, c.model, c.mode, c.delivery].join(":") + (c.context ? ":context" : "");
  const modelInfo = (provider, model) =>
    (liveModels[provider] || []).find((m) => m.model === model) || (live ? live.catalog : []).find((m) => m.provider === provider && m.model === model) || { provider, model, label: model };

  async function refresh() {
    if (!live) return;
    const json = await call("/api/columns", { engines: columns(), takes: state.takes, cast: state.cast });
    data.engines = json.engines;
    data.cells = json.cells;
    estimates = Object.fromEntries(json.estimates.map((e) => [e.engine, e]));
    spent = json.spent;
    cap = json.cap;
    draw();
  }

  async function loadModels(provider) {
    if (!keys[provider] && !live.envKeys[provider]) { liveModels[provider] = null; modelNotes[provider] = ""; drawSetup(); return; }
    modelNotes[provider] = "Checking the key…";
    drawSetup();
    try {
      liveModels[provider] = (await call("/api/models", { provider })).models;
      modelNotes[provider] = "Key works: " + liveModels[provider].length + " speech models.";
      if (provider === "elevenlabs") liveVoices.elevenlabs = (await call("/api/voices", { provider })).voices;
    } catch (error) {
      liveModels[provider] = null;
      modelNotes[provider] = "Could not list models: " + error.message;
    }
    drawSetup();
  }

  async function renderOne(config, engineId, sampleId) {
    try {
      const json = await call("/api/render", { engine: config, sample: sampleId, takes: state.takes, cast: state.cast });
      (data.cells[engineId] ||= {})[sampleId] = json.cell;
      spent = json.spent;
      cap = json.cap;
      return true;
    } catch (error) {
      if (error.spent !== undefined) { spent = error.spent; cap = error.cap; }
      alert(error.message);
      return false;
    }
  }

  async function renderColumn(index) {
    const config = columns()[index];
    const engine = data.engines[index];
    if (!engine) return;
    if (busy[engine.id]) { busy[engine.id].stop = true; return; }
    const todo = data.samples.filter((s) => {
      const cell = data.cells[engine.id] && data.cells[engine.id][s.id];
      return cell && !cell.unsupported && (cell.takes || []).some((t) => t.pending);
    });
    busy[engine.id] = { done: 0, of: todo.length, stop: false };
    drawSetup();
    for (const sample of todo) {
      if (busy[engine.id].stop) break;
      const ok = await renderOne(config, engine.id, sample.id);
      busy[engine.id].done += 1;
      drawSetup();
      drawSample(sample.id);
      if (!ok) break;
    }
    delete busy[engine.id];
    await refresh();
  }

  function addColumn(config) {
    if (columns().some((c) => columnId(c) === columnId(config))) return;
    state.columns = [...columns(), config];
    save();
    refresh();
  }

  function picker() {
    const providerSel = el("select", { "aria-label": "Provider" }, Object.entries(PROVIDERS).map(([id, name]) => el("option", { value: id }, name)));
    const modelSel = el("select", { "aria-label": "Model" });
    const modeSel = el("select", { "aria-label": "Mode" });
    const deliverySel = el("select", { "aria-label": "Delivery" });
    const context = el("input", { type: "checkbox" });
    const contextLabel = el("label", { class: "row" }, context, "neighboring lines as context");
    const about = el("div", { class: "hint" });
    providerSel.value = pickerState.provider;
    const fillModel = () => {
      const provider = providerSel.value;
      const info = modelInfo(provider, modelSel.value);
      const onKey = liveModels[provider];
      const missing = onKey && !onKey.some((m) => m.model === modelSel.value);
      about.replaceChildren(info.about || "", missing ? el("span", { class: "bad" }, " Not in this key's model list.") : "");
      modeSel.replaceChildren(el("option", { value: "lines" }, "One request per line"), info.dialogue ? el("option", { value: "dialogue" }, "One request for the whole scene") : null);
      deliverySel.replaceChildren(
        info.tags || provider === "fake" ? el("option", { value: "tag" }, "Delivery as audio tags") : null,
        provider === "gemini" ? el("option", { value: "instruction" }, "Delivery as instructions") : null,
        el("option", { value: "none" }, "No delivery hints"),
      );
      contextLabel.hidden = !(provider === "elevenlabs" && info.context);
      context.checked = !contextLabel.hidden;
    };
    const fill = () => {
      const provider = providerSel.value;
      pickerState.provider = provider;
      const curated = live.catalog.filter((m) => m.provider === provider);
      const fromKey = (liveModels[provider] || []).filter((m) => !curated.some((c) => c.model === m.model));
      modelSel.replaceChildren(
        el("optgroup", { label: "Researched" }, curated.map((m) => el("option", { value: m.model }, m.label + " (" + m.model + ")"))),
        fromKey.length ? el("optgroup", { label: "Also on your key" }, fromKey.map((m) => el("option", { value: m.model }, m.label + " (" + m.model + ")"))) : null,
      );
      if ([...modelSel.options].some((o) => o.value === pickerState.model)) modelSel.value = pickerState.model;
      fillModel();
    };
    providerSel.addEventListener("change", fill);
    modelSel.addEventListener("change", () => { pickerState.model = modelSel.value; fillModel(); });
    fill();
    const add = el("button", { type: "button", class: "primary" }, "Add column");
    add.addEventListener("click", () => addColumn({ provider: providerSel.value, model: modelSel.value, mode: modeSel.value, delivery: deliverySel.value, context: !contextLabel.hidden && context.checked }));
    return el("div", { class: "row" }, providerSel, modelSel, modeSel, deliverySel, contextLabel, add, about);
  }

  function keyField(provider, name) {
    const input = el("input", { type: "password", placeholder: live.envKeys[provider] ? "Using the key from your shell" : "Paste key", value: keys[provider] || "", autocomplete: "off", spellcheck: "false" });
    input.addEventListener("change", () => { keys[provider] = input.value.trim(); saveKeys(); loadModels(provider); refresh(); });
    return el("div", { class: "field" }, el("label", { class: "field" }, name + " API key", input), el("span", { class: modelNotes[provider].startsWith("Could not") ? "bad" : "hint", role: "status" }, modelNotes[provider]));
  }

  function castPanel() {
    const rows = Object.entries(live.speakers).map(([id, speaker]) => {
      const choice = state.cast[id] || {};
      const defaultEleven = speaker.elevenlabs.voiceId;
      const eleven = el("select", { "aria-label": id + " ElevenLabs voice" });
      const accountVoices = liveVoices.elevenlabs || [];
      if (!accountVoices.some((v) => v.id === defaultEleven)) {
        eleven.append(el("option", { value: defaultEleven }, (speaker.elevenlabs.name || defaultEleven) + (liveVoices.elevenlabs ? " (default, not on this account)" : " (default)")));
      }
      for (const v of accountVoices) eleven.append(el("option", { value: v.id }, v.name + (v.about ? " (" + v.about + ")" : "")));
      eleven.value = choice.elevenlabs || defaultEleven;
      const gemini = el("select", { "aria-label": id + " Gemini voice" }, live.geminiVoices.map((v) => el("option", { value: v.id }, v.name + " (" + v.about + ")")));
      gemini.value = choice.gemini || speaker.gemini.voice;
      const change = () => {
        const next = {};
        if (eleven.value !== defaultEleven) next.elevenlabs = eleven.value;
        if (gemini.value !== speaker.gemini.voice) next.gemini = gemini.value;
        if (Object.keys(next).length) state.cast[id] = next; else delete state.cast[id];
        save();
        refresh();
      };
      eleven.addEventListener("change", change);
      gemini.addEventListener("change", change);
      return el("tr", {}, el("td", {}, el("b", {}, id.replace(/_/g, " ")), el("div", { class: "hint" }, speaker.describe)), el("td", {}, eleven), el("td", {}, gemini));
    });
    const reset = el("button", { type: "button" }, "Back to cast.json");
    reset.addEventListener("click", () => { state.cast = {}; save(); refresh(); });
    const changed = Object.keys(state.cast).length;
    const panel = el("details", { open: pickerState.castOpen || undefined }, el("summary", {}, "Cast: who voices whom" + (changed ? " (" + changed + " changed)" : "")),
      el("p", { class: "hint" }, "A changed voice is a new request and renders fresh. The old clips stay cached, so switching back costs nothing. With an ElevenLabs key pasted, the list is your account's voices."),
      el("div", { class: "scroll" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Speaker"), el("th", {}, "ElevenLabs"), el("th", {}, "Gemini"))), el("tbody", {}, rows))), reset);
    panel.addEventListener("toggle", () => { pickerState.castOpen = panel.open; });
    return panel;
  }

  function drawSetup() {
    const root = document.getElementById("setup");
    if (!live) { root.replaceChildren(); return; }
    const remember = el("input", { type: "checkbox", checked: state.remember });
    remember.addEventListener("change", () => { state.remember = remember.checked; save(); saveKeys(); });
    const takes = el("select", { "aria-label": "Takes" }, [1, 2, 3].map((n) => el("option", { value: String(n) }, n === 1 ? "1 take" : n + " takes")));
    takes.value = String(state.takes);
    takes.addEventListener("change", () => { state.takes = Number(takes.value); save(); refresh(); });
    const capInput = el("input", { type: "number", min: "0", step: "1", value: String(cap), style: "width: 90px", "aria-label": "Spending cap in dollars" });
    capInput.addEventListener("change", async () => { cap = (await call("/api/cap", { cap: Number(capInput.value) })).cap; drawSetup(); });
    const left = data.engines.reduce((s, e) => s + ((estimates[e.id] && estimates[e.id].dollars) || 0), 0);

    const list = el("div", { class: "columns" }, columns().map((config, i) => {
      const engine = data.engines[i];
      if (!engine) return null;
      const est = estimates[engine.id];
      const job = busy[engine.id];
      const finished = !job && est && est.requests === 0;
      const go = el("button", { type: "button", class: job || finished ? "" : "primary", disabled: finished }, job ? "Stop" : finished ? "All rendered" : "Render all");
      go.addEventListener("click", () => renderColumn(i));
      const remove = el("button", { type: "button" }, "Remove");
      remove.addEventListener("click", () => { const next = [...columns()]; next.splice(i, 1); state.columns = next; save(); refresh(); });
      const needsKey = engine.provider !== "fake" && !keys[engine.provider] && !live.envKeys[engine.provider];
      const price = job ? "Rendering " + job.done + " of " + job.of + " samples…"
        : est ? (!est.requests ? "Everything rendered" : est.dollars === null ? est.requests + " requests; no price for this model in pricing.json" : "About " + money(est.dollars) + " for " + est.requests + " requests") + (est.cached ? " (" + est.cached + " cached)" : "") : "";
      return el("div", { class: "column" }, el("span", { class: "label" }, engine.label),
        el("span", { class: "price" }, price, needsKey ? el("span", { class: "bad" }, " · needs a " + PROVIDERS[engine.provider] + " key") : ""), go, remove);
    }));
    const restore = el("button", { type: "button" }, "Restore recommended columns");
    restore.addEventListener("click", () => { state.columns = null; save(); refresh(); });

    root.replaceChildren(el("section", { class: "panel" },
      el("h2", {}, "Keys"),
      el("div", { class: "row" }, keyField("elevenlabs", "ElevenLabs"), keyField("gemini", "Gemini"), el("label", { class: "row" }, remember, "Remember on this computer")),
      el("p", { class: "hint" }, "Keys go only to the bake-off server on this computer, which passes them to the provider. Nothing writes them to disk."),
      el("h2", {}, "Add a column"),
      picker(),
      el("h2", {}, "Columns"),
      list,
      el("div", { class: "row" }, takes,
        el("label", { class: "row" }, "Spending cap $", capInput),
        el("span", { class: spent > cap ? "bad" : "hint" }, "Spent this session: about " + money(spent) + ". Left to render: about " + money(left) + "."),
        restore),
      castPanel()));
  }

  // ---- Listening and rating ----
  const hash = (text) => { let h = 2166136261; for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

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
      if (!player || player.audio !== audio) return;
      if (i >= clips.length) { stop(); return; }
      const clip = clips[i++];
      clip.lines.forEach((line) => script.children[line] && script.children[line].classList.add("now"));
      audio.src = clip.file;
      audio.play().catch(() => stop());
    };
    // A short breath between lines, as the game would leave between clips.
    audio.addEventListener("ended", () => setTimeout(next, 150));
    next();
  }

  function cellFor(sample, engine, index, letter, script) {
    const cell = data.cells[engine.id] && data.cells[engine.id][sample.id];
    const revealed = !state.blind || state.revealed[sample.id];
    const box = el("div", { class: "cell" }, el("div", { class: "name" }, revealed ? engine.label : "Engine " + letter));
    if (!cell) { box.append(el("div", { class: "stats" }, "Not rendered yet.")); return box; }
    if (cell.unsupported) { box.append(el("div", { class: "err" }, cell.unsupported)); return box; }
    const takes = cell.takes || [];
    let take = 0;
    const stats = el("div", { class: "stats" });
    const err = el("div", { class: "err" });
    const playButton = el("button", { type: "button" }, "Play");
    const renderButton = live ? el("button", { type: "button", class: "primary" }, "Render") : null;
    const showTake = () => {
      const t = takes[take];
      err.textContent = t.error || "";
      playButton.disabled = !!t.pending;
      if (renderButton) {
        renderButton.hidden = !t.pending;
        renderButton.textContent = t.error ? "Try again" : "Render";
      }
      const chars = t.clips.reduce((s, c) => s + c.chars, 0);
      const ms = t.clips.reduce((s, c) => s + (c.renderMs || 0), 0);
      stats.textContent = t.pending
        ? (t.clips.length ? t.clips.length + " of its requests rendered" : "Not rendered yet.")
        : chars + " chars · " + t.clips.length + (t.clips.length === 1 ? " request" : " requests") + (ms ? " · rendered in " + (ms / 1000).toFixed(1) + "s" : "");
    };
    playButton.addEventListener("click", () => play(takes[take].clips, box, script, playButton));
    if (renderButton) renderButton.addEventListener("click", async () => {
      renderButton.disabled = true;
      renderButton.textContent = "Rendering…";
      await renderOne(columns()[index], engine.id, sample.id);
      await refresh();
    });
    const controls = el("div", { class: "row" }, playButton, renderButton);
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
      b.addEventListener("click", () => {
        r.score = r.score === n ? 0 : n;
        save();
        score.querySelectorAll("button").forEach((x, j) => x.classList.toggle("on", r.score === j + 1));
        drawSummary();
      });
      score.append(b);
    }
    const flags = el("div", { class: "flags" }, FLAGS.map((flag) => {
      const b = el("button", { type: "button", class: r.flags.includes(flag) ? "on" : "" }, flag);
      b.addEventListener("click", () => { r.flags = r.flags.includes(flag) ? r.flags.filter((f) => f !== flag) : [...r.flags, flag]; save(); b.classList.toggle("on"); drawSummary(); });
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
    // A stable shuffle per sample when blind, so the letters do not move between reloads.
    const shown = data.engines.map((engine, index) => ({ engine, index }));
    if (state.blind) shown.sort((a, b) => hash(state.salt + sample.id + a.engine.id) - hash(state.salt + sample.id + b.engine.id));
    const grid = el("div", { class: "grid" }, shown.map((x, i) => cellFor(sample, x.engine, x.index, String.fromCharCode(65 + i), script)));
    const head = el("div", { class: "row" }, el("h3", {}, sample.title, sample.group ? el("span", { class: "badge" }, "same voice: " + sample.group) : null));
    if (state.blind) {
      const reveal = el("button", { type: "button" }, state.revealed[sample.id] ? "Hide names" : "Reveal");
      reveal.addEventListener("click", () => { state.revealed[sample.id] = !state.revealed[sample.id]; save(); drawSample(sample.id); });
      head.append(reveal);
    }
    return el("section", { class: "sample", id: "sample-" + sample.id }, head, el("p", { class: "tests" }, sample.tests), el("div", { class: "addr" }, sample.address), script,
      data.engines.length ? grid : el("p", { class: "hint" }, live ? "Add a column above to render this sample." : "No engine has rendered this yet."));
  }

  function drawSample(id) {
    const old = document.getElementById("sample-" + id);
    const sample = data.samples.find((s) => s.id === id);
    if (!old || !sample) return;
    if (player && old.contains(player.cell)) stop();
    old.replaceWith(sampleCard(sample));
  }

  function drawSummary() {
    const box = document.getElementById("summary");
    if (box.hidden) return;
    const tiers = Object.keys(data.tiers);
    const scoreOf = (s, engine) => (state.ratings[s.id] && state.ratings[s.id][engine.id]) || { score: 0, flags: [] };
    const rows = data.engines.map((engine) => {
      const per = tiers.map((tier) => {
        const scores = data.samples.filter((s) => s.tier === tier).map((s) => scoreOf(s, engine).score).filter(Boolean);
        return scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) + " (" + scores.length + ")" : "";
      });
      const all = data.samples.map((s) => scoreOf(s, engine).score).filter(Boolean);
      const flags = data.samples.reduce((n, s) => n + scoreOf(s, engine).flags.length, 0);
      const name = state.blind ? "(hidden while blind)" : engine.label;
      return el("tr", {}, el("td", {}, name), per.map((p) => el("td", {}, p)), el("td", {}, all.length ? (all.reduce((a, b) => a + b, 0) / all.length).toFixed(2) : ""), el("td", {}, String(flags)));
    });
    box.replaceChildren(el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Engine"), tiers.map((t) => el("th", {}, t)), el("th", {}, "Overall"), el("th", {}, "Flags"))), el("tbody", {}, rows)));
  }

  const tierSelect = document.getElementById("tier");
  for (const [tier, about] of Object.entries(data.tiers)) tierSelect.append(el("option", { value: tier }, tier + ": " + about));
  tierSelect.addEventListener("change", () => draw());

  function draw() {
    stop();
    document.getElementById("blind").classList.toggle("on", state.blind);
    document.getElementById("meta").textContent = data.samples.length + " samples · " + data.engines.length + " columns" + (live ? "" : " · rendered " + new Date(data.generated).toLocaleString());
    drawSetup();
    const root = document.getElementById("samples");
    root.replaceChildren();
    for (const [tier, about] of Object.entries(data.tiers)) {
      if (tierSelect.value && tierSelect.value !== tier) continue;
      const samples = data.samples.filter((s) => s.tier === tier);
      if (samples.length === 0) continue;
      root.append(el("div", { class: "tier" }, el("h2", {}, tier), el("p", {}, about)), ...samples.map(sampleCard));
    }
    drawSummary();
  }

  document.getElementById("blind").addEventListener("click", () => { state.blind = !state.blind; state.revealed = {}; save(); draw(); });
  document.getElementById("scores").addEventListener("click", (e) => {
    const box = document.getElementById("summary");
    box.hidden = !box.hidden;
    e.currentTarget.classList.toggle("on", !box.hidden);
    drawSummary();
  });
  document.getElementById("export").addEventListener("click", () => {
    const out = { exported: new Date().toISOString(), engines: data.engines, cast: state.cast, ratings: state.ratings };
    const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" })), download: "voice-bakeoff-ratings.json" });
    document.body.append(a);
    a.click();
    a.remove();
  });

  draw();
  if (live) {
    refresh().catch((error) => alert(error.message));
    loadModels("elevenlabs");
    loadModels("gemini");
  }
})();
</script>
</body>
</html>
`;
}
