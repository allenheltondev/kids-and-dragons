/**
 * The cast voice sheet as a page (docs/voice-cast.md): every character, the
 * voice they have, and their own lines to hear it on. Served by the bake-off
 * server at /cast; every change is saved to content/voice/cast.json.
 */

import type { castPageData } from "./routes.ts";

export interface CastLive {
  token: string;
  cap: number;
  envKeys: { elevenlabs: boolean; gemini: boolean };
}

export function renderCastPage(data: ReturnType<typeof castPageData>, live: CastLive): string {
  const boot = JSON.stringify({ data, live }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cast voice sheet</title>
<style>
:root {
  --bg: #faf7f2; --card: #ffffff; --ink: #2b2620; --muted: #6f665b; --line: #e6dfd4;
  --accent: #b5562a; --accent-soft: #f6e6dc; --now: #fff1c2; --bad: #a3322a; --ok: #2f7a4a; --ok-soft: #e3f1e7;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1b1916; --card: #24211d; --ink: #efe9e0; --muted: #a69c8f; --line: #3a352f;
    --accent: #e08a5c; --accent-soft: #3a2a20; --now: #4a3f1c; --bad: #e07a70; --ok: #6cc08b; --ok-soft: #1f3326;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { position: sticky; top: 0; z-index: 2; background: var(--bg); border-bottom: 1px solid var(--line); padding: 12px 16px; display: grid; gap: 8px; }
.top { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
h1 { font-size: 18px; margin: 0; }
a { color: var(--accent); }
.meta, .hint { color: var(--muted); font-size: 13px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
select, input, button, textarea { font: inherit; color: inherit; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; max-width: 100%; min-width: 0; }
button { cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); }
button:disabled { opacity: .5; cursor: default; }
button.primary, button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
button.approved { background: var(--ok); color: #fff; border-color: var(--ok); }
main { max-width: 1400px; margin: 0 auto; padding: 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); gap: 12px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; display: grid; gap: 8px; align-content: start; min-width: 0; }
.card.is-approved { border-color: var(--ok); box-shadow: 0 0 0 1px var(--ok-soft); }
.card h2 { font-size: 16px; margin: 0; }
.badge { display: inline-block; font-size: 12px; padding: 1px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); margin-left: 6px; vertical-align: 2px; font-weight: normal; }
.badge.ok { background: var(--ok-soft); color: var(--ok); }
.who { color: var(--muted); font-size: 14px; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { font: 12px ui-monospace, monospace; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 0 6px; color: var(--muted); }
.clash { color: var(--bad); font-size: 13px; }
.lines { display: grid; gap: 6px; }
.line { display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: start; padding: 6px; border-radius: 8px; border: 1px solid transparent; }
.line.now { background: var(--now); border-color: var(--accent); }
.line .words { font-size: 14px; }
.line .from { font: 11px ui-monospace, monospace; color: var(--muted); overflow-wrap: anywhere; }
.line .controls { display: flex; flex-direction: column; gap: 4px; }
.line button { padding: 3px 8px; font-size: 13px; }
.standin { font-size: 12px; color: var(--accent); }
.err { color: var(--bad); font-size: 12px; overflow-wrap: anywhere; }
textarea { width: 100%; min-height: 38px; font-size: 13px; background: var(--bg); }
label.inline { display: flex; gap: 6px; align-items: center; font-size: 13px; color: var(--muted); }
</style>
</head>
<body>
<header>
  <div class="top">
    <h1>Cast voice sheet</h1>
    <span class="meta" id="meta"></span>
    <a href="/">Bake-off</a>
  </div>
  <div class="row">
    <input id="search" type="search" placeholder="Search names, notes, chapters" aria-label="Search">
    <select id="campaign" aria-label="Campaign"><option value="">Every campaign</option></select>
    <select id="filter" aria-label="Show">
      <option value="">Everyone</option>
      <option value="provisional">Still provisional</option>
      <option value="approved">Approved</option>
      <option value="clash">Sharing a voice in a chapter</option>
      <option value="standin">No line from the game yet</option>
      <option value="silent">Doesn't speak</option>
    </select>
    <select id="sort" aria-label="Sort">
      <option value="chapters">Most chapters first</option>
      <option value="name">By name</option>
    </select>
  </div>
  <div class="row">
    <select id="model" aria-label="Gemini model"></select>
    <input id="key" type="password" placeholder="Gemini API key" aria-label="Gemini API key" autocomplete="off" spellcheck="false">
    <button id="renderAll" type="button" class="primary">Render all shown</button>
    <span class="hint" id="budget"></span>
  </div>
</header>
<main id="cards"></main>
<script type="application/json" id="boot">${boot}</script>
<script>
(() => {
  const { data, live } = JSON.parse(document.getElementById("boot").textContent);
  const STORE = "kad.voice-cast";
  const KEYS = "kad.voice-bakeoff.keys"; // shared with the bake-off page: one key, pasted once
  const load = (store, key) => { try { return JSON.parse(store.getItem(key) || "null"); } catch { return null; } };
  const prefs = Object.assign({ model: "gemini-3.8-flash-tts", search: "", campaign: "", filter: "", sort: "chapters" }, load(localStorage, STORE) || {});
  const savePrefs = () => { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch {} };
  const keys = load(sessionStorage, KEYS) || load(localStorage, KEYS) || { elevenlabs: "", gemini: "" };
  const saveKeys = () => { try { sessionStorage.setItem(KEYS, JSON.stringify(keys)); if (localStorage.getItem(KEYS)) localStorage.setItem(KEYS, JSON.stringify(keys)); } catch {} };

  const el = (tag, props = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "value") node.value = v;
      else if (k === "disabled" || k === "checked") node[k] = !!v;
      else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
    return node;
  };
  const money = (n) => n === null || n === undefined ? "no price" : n > 0 && n < 0.005 ? "<$0.01" : "$" + n.toFixed(2);

  async function call(route, body) {
    const response = await fetch(route, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bakeoff-token": live.token, "x-gemini-key": keys.gemini || "" },
      body: JSON.stringify(body || {}),
    });
    const json = await response.json().catch(() => ({ error: "HTTP " + response.status }));
    if (!response.ok) throw Object.assign(new Error(json.error || "HTTP " + response.status), json);
    return json;
  }

  let cells = {};
  let clashes = {};
  let estimate = null;
  let spent = 0;
  let cap = live.cap;
  let job = null;

  const voiceInfo = Object.fromEntries(data.voices.map((v) => [v.id, v]));
  const voiceLabel = (v) => v.id + " · " + v.about + (v.gender ? " · " + (v.gender === "f" ? "woman" : "man") : "");
  const uses = () => {
    const count = {};
    for (const entry of Object.values(data.speakers)) count[entry.gemini.voice] = (count[entry.gemini.voice] || 0) + 1;
    return count;
  };
  const campaignsOf = (entry) => [...new Set(entry.chapters.map((c) => data.chapterCampaigns[c]).filter(Boolean))];

  // ---- Header controls ----
  const modelSel = document.getElementById("model");
  for (const m of data.models) modelSel.append(el("option", { value: m.model }, m.label));
  modelSel.value = prefs.model;
  modelSel.addEventListener("change", () => { prefs.model = modelSel.value; savePrefs(); refresh(); });
  const keyInput = document.getElementById("key");
  keyInput.value = keys.gemini || "";
  if (live.envKeys.gemini) keyInput.placeholder = "Using the Gemini key from your shell";
  keyInput.addEventListener("change", () => { keys.gemini = keyInput.value.trim(); saveKeys(); });
  const campaignSel = document.getElementById("campaign");
  for (const c of [...new Set(Object.values(data.chapterCampaigns))].sort()) campaignSel.append(el("option", { value: c }, c));
  for (const [id, key] of [["search", "search"], ["campaign", "campaign"], ["filter", "filter"], ["sort", "sort"]]) {
    const control = document.getElementById(id);
    control.value = prefs[key];
    control.addEventListener(id === "search" ? "input" : "change", () => { prefs[key] = control.value; savePrefs(); draw(); });
  }

  function shown() {
    const q = prefs.search.trim().toLowerCase();
    return Object.entries(data.speakers)
      .filter(([id, e]) => !q || (e.name + " " + e.who + " " + e.chapters.join(" ") + " " + id).toLowerCase().includes(q))
      .filter(([, e]) => !prefs.campaign || campaignsOf(e).includes(prefs.campaign) || e.kind === "narrator" || e.kind === "party")
      .filter(([id, e]) => {
        switch (prefs.filter) {
          case "provisional": return e.status === "provisional";
          case "approved": return e.status === "approved";
          case "clash": return (clashes[id] || []).length > 0;
          case "standin": return e.speaks && e.lines.length === 0;
          case "silent": return !e.speaks;
          default: return true;
        }
      })
      .sort(([a, x], [b, y]) => {
        const rank = (e) => (e.kind === "narrator" ? 0 : e.kind === "party" ? 1 : 2);
        if (rank(x) !== rank(y)) return rank(x) - rank(y);
        return prefs.sort === "name" ? x.name.localeCompare(y.name) : y.chapters.length - x.chapters.length || x.name.localeCompare(y.name);
      });
  }

  // ---- Playback ----
  let player = null;
  function stop() {
    if (!player) return;
    player.audio.pause();
    player.row.classList.remove("now");
    player.button.textContent = "Play";
    player = null;
  }
  function play(file, row, button) {
    const same = player && player.row === row;
    stop();
    if (same) return;
    const audio = new Audio(file);
    player = { audio, row, button };
    row.classList.add("now");
    button.textContent = "Stop";
    audio.addEventListener("ended", stop);
    audio.play().catch(stop);
  }

  async function save(id, patch) {
    try {
      const json = await call("/api/cast/save", Object.assign({ id }, patch));
      data.speakers[id] = json.entry;
      clashes = json.clashes;
    } catch (error) {
      alert(error.message);
    }
  }

  async function renderLine(id, line) {
    const json = await call("/api/cast/render", { id, line, model: prefs.model });
    (cells[id] ||= [])[line] = json.cell;
    spent = json.spent;
    cap = json.cap;
  }

  function card(id, entry) {
    const lines = data.auditions[id] || [];
    const voice = el("select", { "aria-label": entry.name + " voice" }, data.voices.map((v) => el("option", { value: v.id }, voiceLabel(v))));
    voice.value = entry.gemini.voice;
    voice.addEventListener("change", async () => { await save(id, { voice: voice.value }); await refresh(); });
    const count = uses()[entry.gemini.voice] || 1;
    const approve = el("button", { type: "button", class: entry.status === "approved" ? "approved" : "" }, entry.status === "approved" ? "Approved" : "Approve this voice");
    approve.addEventListener("click", async () => { await save(id, { status: entry.status === "approved" ? "provisional" : "approved" }); draw(); });
    const accent = el("input", { value: entry.accent || "", placeholder: "Accent: " + data.accent, "aria-label": entry.name + " accent" });
    accent.addEventListener("change", async () => { await save(id, { accent: accent.value }); await refresh(); });
    const notes = el("textarea", { placeholder: "Notes", "aria-label": entry.name + " notes" });
    notes.value = entry.notes || "";
    let timer = 0;
    notes.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => save(id, { notes: notes.value }), 600); });

    const audition = el("div", { class: "lines" }, lines.map((line, i) => {
      const cell = (cells[id] || [])[i];
      const take = cell && cell.takes && cell.takes[0];
      const ready = take && !take.pending && take.clips[0];
      const row = el("div", { class: "line" });
      const playButton = el("button", { type: "button", disabled: !ready }, "Play");
      if (ready) playButton.addEventListener("click", () => play(take.clips[0].file, row, playButton));
      const renderButton = el("button", { type: "button", class: ready ? "" : "primary" }, ready ? "Again" : "Render");
      renderButton.hidden = !!ready;
      renderButton.addEventListener("click", async () => {
        renderButton.disabled = true;
        renderButton.textContent = "…";
        try { await renderLine(id, i); } catch (error) { alert(error.message); }
        redraw(id);
        drawBudget();
      });
      row.append(
        el("div", { class: "controls" }, playButton, renderButton),
        el("div", {}, el("div", { class: "words" }, line.text), line.standIn ? el("div", { class: "standin" }, "Stand-in line, not from the game") : el("div", { class: "from" }, line.address), take && take.error ? el("div", { class: "err" }, take.error) : null),
      );
      return row;
    }));

    const mine = clashes[id] || [];
    const chapters = entry.chapters.slice(0, 8).map((c) => el("span", { class: "chip" }, c));
    if (entry.chapters.length > 8) chapters.push(el("span", { class: "chip" }, "+" + (entry.chapters.length - 8)));
    return el("section", { class: "card" + (entry.status === "approved" ? " is-approved" : ""), id: "cast-" + id },
      el("h2", {}, entry.name, el("span", { class: "badge" }, entry.kind), entry.status === "approved" ? el("span", { class: "badge ok" }, "approved") : null),
      el("div", { class: "who" }, entry.who),
      el("div", { class: "chips" }, chapters),
      el("div", { class: "hint" }, [entry.pronouns ? "pronouns " + entry.pronouns : null, entry.aliases.length ? "also " + entry.aliases.join(", ") : null, entry.speaks ? null : "doesn't speak"].filter(Boolean).join(" · ")),
      el("div", { class: "row" }, voice, el("span", { class: "hint" }, count > 1 ? "also on " + (count - 1) + " other" + (count === 2 ? "" : "s") : "only them")),
      mine.map((clash) => el("div", { class: "clash" }, "Same voice as " + clash.with.map((other) => (data.speakers[other] || { name: other }).name).join(", ") + " in " + clash.chapter)),
      lines.length ? audition : el("div", { class: "hint" }, "Nothing to audition: they don't speak."),
      el("div", { class: "row" }, approve, accent),
      notes);
  }

  function redraw(id) {
    const old = document.getElementById("cast-" + id);
    if (old) { if (player && old.contains(player.row)) stop(); old.replaceWith(card(id, data.speakers[id])); }
  }

  function drawBudget() {
    document.getElementById("budget").textContent = "Spent this session: about " + money(spent) + " of a " + money(cap) + " cap." + (estimate ? " Everything not yet rendered: about " + money(estimate.dollars) + " for " + estimate.requests + " lines." : "");
  }

  function draw() {
    stop();
    const list = shown();
    const all = Object.values(data.speakers);
    document.getElementById("meta").textContent = all.length + " speakers · " + all.filter((e) => e.status === "approved").length + " approved · " + Object.values(clashes).filter((c) => c.length).length + " sharing a voice · showing " + list.length;
    document.getElementById("cards").replaceChildren(...list.map(([id, entry]) => card(id, entry)));
    drawBudget();
  }

  async function refresh() {
    try {
      const json = await call("/api/cast/state", { model: prefs.model });
      cells = json.cells;
      clashes = json.clashes;
      estimate = json.estimate;
      spent = json.spent;
      cap = json.cap;
    } catch (error) {
      alert(error.message);
    }
    draw();
  }

  const renderAll = document.getElementById("renderAll");
  renderAll.addEventListener("click", async () => {
    if (job) { job.stop = true; return; }
    const todo = [];
    for (const [id] of shown()) (data.auditions[id] || []).forEach((_, i) => {
      const take = cells[id] && cells[id][i] && cells[id][i].takes && cells[id][i].takes[0];
      if (!take || take.pending) todo.push([id, i]);
    });
    job = { stop: false, done: 0 };
    renderAll.textContent = "Stop";
    const worker = async () => {
      while (todo.length && !job.stop) {
        const [id, i] = todo.shift();
        try { await renderLine(id, i); } catch (error) { job.stop = true; alert(error.message); }
        job.done += 1;
        renderAll.textContent = "Stop (" + job.done + " rendered)";
        redraw(id);
        drawBudget();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    job = null;
    renderAll.textContent = "Render all shown";
    refresh();
  });

  draw();
  refresh();
})();
</script>
</body>
</html>
`;
}
