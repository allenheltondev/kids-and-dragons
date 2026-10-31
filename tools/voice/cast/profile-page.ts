/**
 * One character at a time (docs/voice-cast.md): their picture, what the game
 * says about them, their voice notes in canon, the voice and what the model
 * is told, and something for them to say. Accept moves straight on to the
 * next character still waiting, with a count of how many are left. Served by
 * the bake-off server at /cast/profile; every change is saved to the sheet,
 * and an edit to the canon to the chapter or canon file it came from.
 */

import { MODE_CSS, MODE_HEADER_HTML, MODE_SCRIPT } from "./mode.ts";
import type { castPageData } from "./routes.ts";
import type { CastLive } from "./page.ts";

export function renderProfilePage(data: ReturnType<typeof castPageData>, live: CastLive): string {
  const boot = JSON.stringify({ data, live }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cast profiles</title>
<style>
:root {
  --bg: #faf7f2; --card: #ffffff; --ink: #2b2620; --muted: #6f665b; --line: #e6dfd4; --stage: #efe8dc;
  --accent: #b5562a; --accent-soft: #f6e6dc; --now: #fff1c2; --bad: #a3322a; --bad-soft: #f8e3e0; --ok: #2f7a4a; --ok-soft: #e3f1e7;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1b1916; --card: #24211d; --ink: #efe9e0; --muted: #a69c8f; --line: #3a352f; --stage: #2e2a24;
    --accent: #e08a5c; --accent-soft: #3a2a20; --now: #4a3f1c; --bad: #e07a70; --bad-soft: #3a2321; --ok: #6cc08b; --ok-soft: #1f3326;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--accent); }
header { position: sticky; top: 0; z-index: 3; background: var(--bg); border-bottom: 1px solid var(--line); padding: 10px 16px; display: grid; gap: 8px; }
.top { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
h1 { font-size: 18px; margin: 0; }
.left { font-size: 15px; }
.left strong { font-size: 20px; color: var(--accent); }
.bar { flex: 1 1 160px; height: 8px; background: var(--line); border-radius: 999px; overflow: hidden; min-width: 120px; max-width: 360px; }
.bar > span { display: block; height: 100%; background: var(--ok); width: 0; transition: width .3s; }
.hint, .meta { color: var(--muted); font-size: 13px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
select, input, button, textarea { font: inherit; color: inherit; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; max-width: 100%; min-width: 0; }
button { cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); }
button:disabled { opacity: .5; cursor: default; }
button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
button.accept { background: var(--ok); color: #fff; border-color: var(--ok); font-weight: 600; }
button.reject { color: var(--bad); border-color: var(--bad); }
button.reject:disabled { color: inherit; border-color: var(--line); }
button.link { border: none; background: none; color: var(--accent); padding: 0 4px; text-decoration: underline; }
kbd { font: 11px ui-monospace, monospace; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; color: var(--muted); }
button.accept kbd { color: #fff; border-color: rgba(255,255,255,.6); }
label.grow { flex: 1 1 260px; }
label.grow input { flex: 1; }
main { max-width: 1200px; margin: 0 auto; padding: 16px; display: grid; grid-template-columns: minmax(0, 340px) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 820px) { main { grid-template-columns: minmax(0, 1fr); } }
.panel { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; display: grid; gap: 10px; min-width: 0; }
.panel h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0; }
/* The face and the player stay on screen while the panels beside them scroll: editing a field and then playing a line
   never means scrolling back up. On a short screen the picture gives way first, and the panel scrolls inside itself
   if it still does not fit. --head is the header's height, measured by the page. */
/* The left column runs the full height of the page, so the sticky face is held in view right to the last panel; the room
   under the last panel, for the decision bar, is the right column's own. */
.leftcol { align-self: stretch; min-width: 0; }
.rightcol { display: grid; gap: 16px; min-width: 0; padding-bottom: 200px; }
.portrait { position: sticky; top: calc(var(--head, 120px) + 12px); max-height: calc(100vh - var(--head, 120px) - 110px); overflow-y: auto; grid-auto-rows: max-content; }
@media (max-width: 820px) { .portrait { position: static; max-height: none; overflow: visible; } .stage { max-width: 260px; width: 100%; justify-self: center; } header { position: static; } }
/* The picture takes what the screen has left after the name and the player (about 490px), between a thumbnail and the full column. */
.stage { max-width: clamp(110px, calc(100vh - var(--head, 120px) - 490px), 310px); justify-self: center; width: 100%; aspect-ratio: 1; border-radius: 10px; background: radial-gradient(circle at 50% 40%, var(--card), var(--stage)); display: grid; place-items: center; overflow: hidden; }
.stage img, .stage canvas { width: 100%; height: 100%; object-fit: contain; }
.stage .initial { font-size: 120px; font-weight: 700; color: var(--line); }
.name { font-size: 24px; font-weight: 700; margin: 0; line-height: 1.2; }
.badge { display: inline-block; font-size: 12px; padding: 1px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); vertical-align: 3px; font-weight: normal; }
.badge.ok { background: var(--ok-soft); color: var(--ok); }
.badge.bad { background: var(--bad-soft); color: var(--bad); }
.facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 12px; margin: 0; font-size: 14px; }
.facts dt { color: var(--muted); }
.facts dd { margin: 0; overflow-wrap: anywhere; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { font: 12px ui-monospace, monospace; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 0 6px; color: var(--muted); }
.note { display: grid; gap: 4px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); }
.note .where { font: 12px ui-monospace, monospace; color: var(--muted); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: space-between; }
.note .text { font-size: 14px; }
.note textarea { width: 100%; min-height: 70px; }
.pinned { color: var(--accent); font-size: 12px; }
.told { font: 12px/1.5 ui-monospace, monospace; white-space: pre-wrap; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; margin: 0; overflow-wrap: anywhere; max-height: 220px; overflow: auto; }
.clash { color: var(--bad); font-size: 13px; }
.line { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: start; padding: 8px; border-radius: 8px; border: 1px solid transparent; }
.line.now { background: var(--now); border-color: var(--accent); }
.line .from { font: 11px ui-monospace, monospace; color: var(--muted); overflow-wrap: anywhere; }
.standin { font-size: 12px; color: var(--accent); }
.err { color: var(--bad); font-size: 12px; overflow-wrap: anywhere; }
.say textarea { width: 100%; min-height: 54px; }
.history { display: grid; gap: 2px; font-size: 13px; }
.history .rejected { color: var(--bad); }
.history .approved { color: var(--ok); }
.decide { position: fixed; left: 0; right: 0; bottom: 0; z-index: 3; background: var(--card); border-top: 1px solid var(--line); box-shadow: 0 -4px 16px rgba(0,0,0,.06); padding: 10px 16px; }
.decide .inner { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; align-items: center; }
@media (max-width: 820px) { .decide .inner { grid-template-columns: minmax(0, 1fr); } }
.decide textarea { width: 100%; min-height: 40px; height: 40px; resize: vertical; }
.toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 110px; z-index: 4; background: var(--ink); color: var(--bg); padding: 8px 14px; border-radius: 8px; font-size: 14px; opacity: 0; pointer-events: none; transition: opacity .2s; max-width: calc(100% - 32px); }
.toast.on { opacity: 1; }
.listen { display: grid; gap: 8px; padding-top: 10px; border-top: 1px solid var(--line); }
.listen .voice { font-size: 13px; color: var(--muted); }
.listen .voice strong { color: var(--ink); }
.listen .pick { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; text-align: center; font-size: 13px; color: var(--muted); }
.listen .pick button { padding: 2px 12px; }
.listen .words { font-size: 14px; min-height: 3em; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.listen .words.standin { color: var(--accent); }
.listen .big { width: 100%; padding: 12px; font-size: 17px; font-weight: 600; background: var(--accent); color: #fff; border-color: var(--accent); border-radius: 10px; }
.listen .big.playing { background: var(--ink); border-color: var(--ink); color: var(--bg); }
.listen .all { width: 100%; }
.listen .takes { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; }
.listen .takes .all { width: auto; white-space: nowrap; }
.progress { height: 6px; background: var(--line); border-radius: 999px; overflow: hidden; }
.progress > span { display: block; height: 100%; width: 0; background: var(--accent); }
.listen .time { font: 12px ui-monospace, monospace; color: var(--muted); display: flex; justify-content: space-between; }
.field { display: grid; gap: 4px; }
.field > span { font-size: 13px; color: var(--muted); }
.field textarea { width: 100%; min-height: 54px; resize: vertical; }
.chips.accents { align-items: center; }
.chip.action { font: 13px system-ui, sans-serif; cursor: pointer; padding: 2px 9px; background: var(--card); color: var(--ink); }
.chip.action:hover { border-color: var(--accent); }
.chip.action[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.places { margin: 0; padding-left: 1.3em; }
.realmmap { position: relative; margin-top: 8px; max-width: 380px; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--stage); }
.realmmap img { display: block; width: 100%; height: auto; }
.pin { position: absolute; transform: translate(-50%, -50%); width: 20px; height: 20px; border-radius: 999px; background: var(--accent); color: #fff; font: 700 12px/20px system-ui, sans-serif; text-align: center; box-shadow: 0 0 0 2px #fff, 0 1px 5px rgba(0,0,0,.55); }
.done { grid-column: 1 / -1; text-align: center; padding: 60px 16px; }
label.inline { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; color: var(--muted); }
${MODE_CSS}</style>
</head>
<body>
<header>
  <div class="top">
    <h1>Cast profiles</h1>
    <span class="left" id="left"></span>
    <span class="bar" aria-hidden="true"><span id="barFill"></span></span>
    <a href="/cast">All cards</a>
    <a href="/">Bake-off</a>
  </div>
  <div class="row">
    <button id="prev" type="button" title="Previous (K or ←)">← Prev</button>
    <span class="hint" id="position"></span>
    <button id="next" type="button" title="Skip to the next one still waiting (J or →)">Skip →</button>
    <input id="jump" list="everyone" placeholder="Jump to…" aria-label="Jump to a character">
    <datalist id="everyone"></datalist>
    <label class="inline"><input type="checkbox" id="waitingOnly"> only those still waiting</label>
    ${MODE_HEADER_HTML}
    <label class="inline"><input type="checkbox" id="autoplay"> play the first line on arrival</label>
    <span class="hint" id="budget"></span>
  </div>
</header>
<main id="main"></main>
<div class="decide" id="decide"></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script type="application/json" id="boot">${boot}</script>
<script>
(() => {
  const { data, live } = JSON.parse(document.getElementById("boot").textContent);
  ${MODE_SCRIPT}
  const STORE = "kad.voice-cast-profile";
  const KEYS = "kad.voice-bakeoff.keys"; // shared with the bake-off and cast pages: one key, pasted once
  const load = (store, key) => { try { return JSON.parse(store.getItem(key) || "null"); } catch { return null; } };
  const prefs = KadMode.normalize(Object.assign({ autoplay: false, waitingOnly: true }, load(localStorage, STORE) || {}), data);
  const provider = () => KadMode.providerOf(prefs);
  const modelId = () => KadMode.model(prefs);
  const savePrefs = () => { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch {} };
  const keys = load(sessionStorage, KEYS) || load(localStorage, KEYS) || { elevenlabs: "", gemini: "" };
  const saveKeys = () => { try { sessionStorage.setItem(KEYS, JSON.stringify(keys)); if (localStorage.getItem(KEYS)) localStorage.setItem(KEYS, JSON.stringify(keys)); } catch {} };

  const el = (tag, props = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "value") node.value = v;
      else if (k === "disabled" || k === "checked" || k === "hidden") node[k] = !!v;
      else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
    return node;
  };
  const money = (n) => n === null || n === undefined ? "no price" : n > 0 && n < 0.005 ? "<$0.01" : "$" + n.toFixed(2);
  const toastEl = document.getElementById("toast");
  let toastTimer = null;
  const toast = (text) => { toastEl.textContent = text; toastEl.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("on"), 3200); };

  async function call(route, body) {
    const response = await fetch(route, {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json", "x-bakeoff-token": live.token }, KadMode.keyHeaders(keys)),
      body: JSON.stringify(body || {}),
    });
    const json = await response.json().catch(() => ({ error: "HTTP " + response.status }));
    if (!response.ok) throw Object.assign(new Error(json.error || "HTTP " + response.status), json);
    return json;
  }

  const GENDER = { female: "Female (a woman's voice)", male: "Male (a man's voice)", nonbinary: "Nonbinary (either voice)", unknown: "Not known (either voice)" };
  const FROM = { canon: "from canon's pronouns", narration: "from how the narration talks about them", notes: "guessed from their notes", person: "set by you", none: "nothing in the content says" };
  const FIELDS = { short_description: "Who they are", visual_identity: "How they look", speech_register: "How they talk", pronouns: "Pronouns" };
  const voiceInfo = Object.fromEntries(data.voices.map((v) => [v.id, v]));
  // Whether a character is still waiting for a voice to be approved, in the mode the page is in.
  const isWaiting = (id) => !KadMode.approved(data.speakers[id], provider());
  // The account's own ElevenLabs voices, fetched once a key is in: Gemini's thirty are on the page already.
  let elevenVoices = [];
  let elevenLoaded = false;
  const note = (text) => { document.getElementById("modeNote").textContent = text || ""; };
  async function ensureElevenVoices(again) {
    if (provider() !== "elevenlabs" || (elevenLoaded && !again)) return;
    note("Loading your ElevenLabs voices…");
    try {
      const json = await call("/api/voices", { provider: "elevenlabs" });
      elevenVoices = json.voices;
      elevenLoaded = true;
      note(elevenVoices.length ? "" : "This ElevenLabs account has no voices to pick from.");
    } catch (error) {
      elevenVoices = [];
      note("Could not list ElevenLabs voices: " + error.message);
    }
  }
  const waitingCount = () => data.order.filter(isWaiting).length;

  let current = null;
  let cells = {};
  let clashes = {};
  let spent = 0;
  let cap = live.cap;
  let told = null;
  let said = { text: "", cell: null };

  // The sticky face and player sit just under the header, whatever height its rows wrap to.
  const headerEl = document.querySelector("header");
  const sizeHead = () => document.documentElement.style.setProperty("--head", headerEl.offsetHeight + "px");
  sizeHead();
  if (window.ResizeObserver) new ResizeObserver(sizeHead).observe(headerEl);

  // ---- Header ----
  KadMode.mountSwitch({
    prefs, data, keys, live, savePrefs, saveKeys, call,
    // A voice added from the library is on the account now: list it.
    onAdded: async () => { await ensureElevenVoices(true); await refreshState(); if (current) { draw(); loadTold(); } },
    // A new mode or model or key: the voices on offer, who is still waiting, and what is rendered all change.
    onChange: async (keyChanged) => {
      note("");
      await ensureElevenVoices(keyChanged);
      await refreshState();
      if (current) { draw(); loadTold(); } else if (data.order.some(isWaiting)) open(data.order.find(isWaiting)); else drawDone();
    },
  });
  const autoplay = document.getElementById("autoplay");
  autoplay.checked = !!prefs.autoplay;
  autoplay.addEventListener("change", () => { prefs.autoplay = autoplay.checked; savePrefs(); });
  const waitingOnly = document.getElementById("waitingOnly");
  waitingOnly.checked = !!prefs.waitingOnly;
  waitingOnly.addEventListener("change", () => { prefs.waitingOnly = waitingOnly.checked; savePrefs(); drawHeader(); });
  const everyone = document.getElementById("everyone");
  everyone.replaceChildren(...data.order.map((id) => el("option", { value: data.speakers[id].name + " (" + id + ")" })));
  const jump = document.getElementById("jump");
  jump.addEventListener("change", () => {
    const match = /\\(([a-z0-9_]+)\\)$/.exec(jump.value) || [null, data.order.find((id) => data.speakers[id].name.toLowerCase() === jump.value.trim().toLowerCase())];
    if (match[1] && data.speakers[match[1]]) open(match[1]);
    jump.value = "";
  });

  // Prev and skip walk the order; with "only those still waiting" they pass over the approved.
  const step = (dir) => {
    const n = data.order.length;
    let i = data.order.indexOf(current);
    for (let tries = 0; tries < n; tries++) {
      i = (i + dir + n) % n;
      if (!prefs.waitingOnly || isWaiting(data.order[i])) return data.order[i];
    }
    return null;
  };
  document.getElementById("prev").addEventListener("click", () => { const id = step(-1); if (id) open(id); });
  document.getElementById("next").addEventListener("click", () => { const id = step(1); if (id) open(id); else drawDone(); });

  function drawHeader() {
    const total = data.order.length;
    const left = waitingCount();
    document.getElementById("left").replaceChildren(el("strong", {}, String(left)), " left of " + total + " · " + (total - left) + " approved");
    document.getElementById("barFill").style.width = (total ? ((total - left) / total) * 100 : 0) + "%";
    document.getElementById("position").textContent = current ? (data.order.indexOf(current) + 1) + " of " + total : "";
    document.getElementById("budget").textContent = "Spent: about " + money(spent) + " of " + money(cap);
  }

  // ---- Playback ----
  let player = null;
  let picked = 0; // the audition line the player under the picture is on
  // Which take each character is being heard on, this visit: 1 is the first rendering, and each
  // "New take" is one fresh call (Gemini has no seed, so the same words come out differently).
  const takeOf = {};
  const MAX_TAKES = 5;
  let playingAll = false;
  function halt() {
    if (!player) return;
    player.audio.pause();
    player.row.classList.remove("now");
    player.button.textContent = player.label;
    player = null;
    syncListen();
  }
  // A stop from the page also ends "play all".
  function stop() { playingAll = false; halt(); }
  function play(file, row, button) {
    const same = player && player.row === row;
    if (same) return stop();
    halt();
    // Clip links are relative to the server's root, and this page lives a level down.
    const audio = new Audio(/^(\\/|[a-z]+:)/.test(file) ? file : "/" + file);
    player = { audio, row, button, label: button.textContent };
    row.classList.add("now");
    button.textContent = "■ Stop";
    audio.addEventListener("timeupdate", syncListen);
    audio.addEventListener("loadedmetadata", syncListen);
    audio.addEventListener("ended", () => {
      const line = row.dataset.line === undefined ? null : Number(row.dataset.line);
      halt();
      if (playingAll && line !== null && line + 1 < (data.auditions[current] || []).length) listen(line + 1);
      else playingAll = false;
      syncListen();
    });
    audio.play().catch(stop);
    syncListen();
  }

  // Plays (or stops) one audition line, from the player under the picture or the line itself.
  async function listen(i) {
    const row = document.querySelector('.line[data-line="' + i + '"]');
    if (!row || !current) return;
    picked = i;
    const big = document.getElementById("listenPlay");
    const needsRender = !clipOf((cells[current] || [])[i]);
    if (needsRender && big) { big.disabled = true; big.textContent = "Rendering…"; }
    await playLine(current, i, row, row.querySelector("button"));
    if (big) big.disabled = false;
    syncListen();
  }

  const clock = (t) => !isFinite(t) ? "0:00" : Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0");
  function syncListen() {
    const box = document.getElementById("listen");
    if (!box || !current) return;
    const lines = data.auditions[current] || [];
    if (!lines.length || !KadMode.voiceId(data.speakers[current], provider())) return;
    const line = lines[picked];
    const on = player && player.row.dataset.line === String(picked) ? player : null;
    box.querySelector(".count").textContent = "Line " + (picked + 1) + " of " + lines.length;
    const words = box.querySelector(".words");
    words.textContent = line.text;
    words.classList.toggle("standin", !!line.standIn);
    words.title = line.standIn ? "A stand-in line, not from the game" : line.address;
    const big = document.getElementById("listenPlay");
    if (!big.disabled) {
      big.textContent = on ? "■ Stop" : clipOf((cells[current] || [])[picked]) ? "▶ Play line " + (picked + 1) : "▶ Render and play";
      big.classList.toggle("playing", !!on);
    }
    const note = document.getElementById("listenNote");
    if (note) note.textContent = clipOf((cells[current] || [])[picked]) ? "" : "Not heard yet in this voice and these words" + ((takeOf[current] || 1) > 1 ? ", on this take" : "") + ": Play renders it first, for a fraction of a cent.";
    const all = document.getElementById("listenAll");
    all.textContent = playingAll ? "■ Stop playing all" : "▶▶ Play all " + lines.length + " lines";
    all.hidden = lines.length < 2;
    const t = on ? on.audio.currentTime : 0;
    const d = on ? on.audio.duration : 0;
    box.querySelector(".progress > span").style.width = d ? Math.min(100, (t / d) * 100) + "%" : "0";
    box.querySelector(".time").replaceChildren(el("span", {}, clock(t)), el("span", {}, d ? clock(d) : ""));
    for (const button of box.querySelectorAll(".pick button")) button.disabled = lines.length < 2;
  }
  // A cell runs through the character's current take; its last take is the one to hear.
  const lastTake = (cell) => cell && cell.takes && cell.takes[cell.takes.length - 1];
  const clipOf = (cell) => { const take = lastTake(cell); return take && !take.pending && take.clips[0] ? take.clips[0].file : null; };
  const errorOf = (cell) => { const take = lastTake(cell); return take && take.error; };

  // One button: plays the clip, rendering it first if it was never heard in this voice.
  async function playLine(id, i, row, button) {
    let file = clipOf((cells[id] || [])[i]);
    if (!file) {
      button.disabled = true;
      button.textContent = "Rendering…";
      try {
        const json = await call("/api/cast/render", { id, line: i, provider: provider(), model: modelId(), take: takeOf[id] || 1 });
        (cells[id] ||= [])[i] = json.cell;
        spent = json.spent; cap = json.cap;
      } catch (error) { toast(error.message); }
      button.disabled = false;
      button.textContent = "▶ Play";
      drawHeader();
      file = clipOf((cells[id] || [])[i]);
      const err = row.querySelector(".err");
      if (err) err.textContent = errorOf((cells[id] || [])[i]) || "";
      if (!file) return;
    }
    play(file, row, button);
  }

  async function say(id, text, row, button) {
    text = text.trim();
    if (!text) return;
    button.disabled = true;
    button.textContent = "Rendering…";
    try {
      const json = await call("/api/cast/say", { id, text, provider: provider(), model: modelId(), render: true });
      said = { text, cell: json.cell };
      spent = json.spent; cap = json.cap;
    } catch (error) { toast(error.message); }
    button.disabled = false;
    button.textContent = "▶ Say it";
    drawHeader();
    const file = clipOf(said.cell);
    row.querySelector(".err").textContent = errorOf(said.cell) || "";
    if (file) play(file, row, button);
  }

  // ---- Saving ----
  async function save(id, patch) {
    try {
      const json = await call("/api/cast/save", Object.assign({ id, provider: provider() }, patch));
      data.speakers[id] = json.entry;
      clashes = json.clashes;
      if (json.moved) toast("Moved to " + json.moved.to + " to fit (was " + json.moved.from + ")");
      // What is sent may have changed (voice, accent, direction, description), and with it which
      // clips exist: look again, so Play offers to render the new words instead of replaying the old.
      await refreshState();
      return json;
    } catch (error) { toast(error.message); return null; }
  }

  async function editCanon(id, patch) {
    try {
      const json = await call("/api/cast/canon", Object.assign({ id, provider: provider() }, patch));
      data.speakers[id] = json.entry;
      data.profiles[id] = json.profile;
      data.auditions[id] = json.auditions;
      clashes = json.clashes;
      toast("Saved to " + json.edit.file + (json.edit.pinned ? ". Gemfall is pinned: re-take its hashes before committing." : ""));
      await refreshState();
      loadTold();
      return true;
    } catch (error) { toast(error.message); return false; }
  }

  async function decide(id, decision, notes) {
    try {
      const json = await call("/api/cast/decide", { id, decision, notes, provider: provider(), model: modelId() });
      data.speakers[id] = json.entry;
      clashes = json.clashes;
      return true;
    } catch (error) { toast(error.message); return false; }
  }

  async function accept() {
    if (!current || !isWaiting(current) || !KadMode.voiceId(data.speakers[current], provider())) return;
    const id = current;
    const notes = document.getElementById("decisionNotes").value;
    if (!(await decide(id, "approved", notes))) return;
    const name = data.speakers[id].name;
    // Straight on to the next one still waiting, whatever the walk filter says.
    const n = data.order.length;
    let i = data.order.indexOf(id);
    let next = null;
    for (let tries = 0; tries < n; tries++) { i = (i + 1) % n; if (isWaiting(data.order[i])) { next = data.order[i]; break; } }
    toast("Approved " + name + " on " + KadMode.voiceName(data.speakers[id], provider()) + ". " + waitingCount() + " left.");
    if (next) open(next); else drawDone();
  }

  async function reject() {
    const id = current;
    const notes = document.getElementById("decisionNotes").value.trim();
    if (!notes) return;
    const from = KadMode.voiceName(data.speakers[id], provider());
    if (!(await decide(id, "rejected", notes))) return;
    // Gemini moves on to the next best voice at once; ElevenLabs has none to suggest, so the pick is cleared for you to make another.
    toast(provider() === "gemini" ? "Turned down " + from + ". Now trying " + data.speakers[id].gemini.voice + "." : "Turned down " + from + ". Pick another voice for them.");
    await refreshState();
    draw();
    loadTold();
    if (prefs.autoplay && KadMode.voiceId(data.speakers[id], provider())) autoPlay();
  }

  // ---- Sections ----
  function editable(label, text, where, onSave, extra, saveLabel = "Save to canon", allowEmpty = false) {
    const box = el("div", { class: "note" });
    const show = () => {
      const edit = el("button", { type: "button", class: "link" }, text || !allowEmpty ? "Edit" : "Add");
      edit.addEventListener("click", editing);
      box.replaceChildren(...[el("div", { class: "where" }, el("span", {}, label + (where ? " · " + where : "")), edit), el("div", { class: "text" }, text || (allowEmpty ? "None." : "—")), extra].filter(Boolean));
    };
    const editing = () => {
      const area = el("textarea", { "aria-label": label }, text);
      const saveButton = el("button", { type: "button", class: "primary" }, saveLabel);
      const cancel = el("button", { type: "button" }, "Cancel");
      cancel.addEventListener("click", show);
      saveButton.addEventListener("click", async () => {
        saveButton.disabled = true;
        if (await onSave(area.value)) draw(); else saveButton.disabled = false;
      });
      box.replaceChildren(...[el("div", { class: "where" }, el("span", {}, label + (where ? " · " + where : ""))), area, extra, el("div", { class: "row" }, saveButton, cancel)].filter(Boolean));
      area.focus();
    };
    show();
    return box;
  }

  // Figures are painted on a stage-sized canvas, so a teapot-sized sprite is a speck: trim the empty margin.
  function trimmed(img) {
    try {
      const n = 256;
      const probe = el("canvas", { width: n, height: n });
      const g = probe.getContext("2d");
      g.drawImage(img, 0, 0, n, n);
      const alpha = g.getImageData(0, 0, n, n).data;
      const rows = new Array(n).fill(0);
      const cols = new Array(n).fill(0);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (alpha[(y * n + x) * 4 + 3] > 60) { rows[y]++; cols[x]++; }
      // A stray speck or two is not the figure.
      const first = (a) => a.findIndex((v) => v >= 2);
      const last = (a) => a.length - 1 - [...a].reverse().findIndex((v) => v >= 2);
      const [y0, y1, x0, x1] = [first(rows), last(rows), first(cols), last(cols)];
      if (y0 < 0 || x0 < 0) return null;
      const side = Math.max(y1 - y0, x1 - x0) * 1.12;
      if (side > n * 0.85) return null;
      const k = img.naturalWidth / n;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const out = el("canvas", { width: 512, height: 512, role: "img", "aria-label": img.alt });
      out.getContext("2d").drawImage(img, (cx - side / 2) * k, (cy - side / 2) * k, side * k, side * k, 0, 0, 512, 512);
      return out;
    } catch { return null; }
  }

  function portrait(id, entry, profile) {
    const stage = el("div", { class: "stage" });
    if (profile.image) {
      const img = el("img", { src: "/art/" + profile.image, alt: entry.name });
      img.addEventListener("load", () => { const fit = trimmed(img); if (fit) img.replaceWith(fit); }, { once: true });
      stage.append(img);
    }
    else stage.append(el("span", { class: "initial", "aria-hidden": "true" }, entry.name.replace(/^the\\s+/i, "").charAt(0).toUpperCase()));
    const status = KadMode.approved(entry, provider()) ? el("span", { class: "badge ok" }, "approved") : KadMode.lastRejected(entry, provider()) ? el("span", { class: "badge bad" }, "rejected, try again") : el("span", { class: "badge" }, "waiting");
    return el("section", { class: "panel portrait" },
      stage,
      profile.image ? null : el("div", { class: "hint" }, "No painting of them yet."),
      profile.imageIsGeneric ? el("div", { class: "hint" }, "Drawn as any " + (profile.facts.basis || "one of their people") + ": they have no figure of their own.") : null,
      el("p", { class: "name" }, entry.name, " ", status),
      el("div", { class: "hint" }, entry.kind + " · " + id + " · " + linesLabel(entry)),
      listenBox(id, entry));
  }

  const linesLabel = (entry) => { const n = entry.lineCount || 0; return n + " line" + (n === 1 ? "" : "s") + " to speak" + (entry.guessedLines ? ", " + entry.guessedLines + " guessed" : ""); };

  // The player under the picture: the voice, one line at a time, and a big button to hear it.
  function listenBox(id, entry) {
    const lines = data.auditions[id] || [];
    const mode = provider();
    const info = mode === "gemini" ? voiceInfo[entry.gemini.voice] : null;
    const name = KadMode.voiceName(entry, mode);
    const voice = el("div", { class: "voice" }, KadMode.NAMES[mode] + " voice: ", el("strong", {}, name || "none yet"), info ? " · " + info.about + (info.gender ? ", " + (info.gender === "f" ? "woman" : "man") : "") : "");
    if (lines.length && !name) return el("div", { class: "listen", id: "listen" }, voice, el("div", { class: "hint" }, "Pick an ElevenLabs voice for them under Voice and model to hear them."));
    if (!lines.length) return el("div", { class: "listen", id: "listen" }, voice, el("div", { class: "hint" }, "They don't speak, so there's nothing to hear."));
    const prev = el("button", { type: "button", "aria-label": "Previous line", title: "Previous line ([)" }, "‹");
    const next = el("button", { type: "button", "aria-label": "Next line", title: "Next line (])" }, "›");
    const move = (by) => { const was = player && player.row.dataset.line === String(picked); stop(); picked = (picked + by + lines.length) % lines.length; syncListen(); if (was) listen(picked); };
    prev.addEventListener("click", () => move(-1));
    next.addEventListener("click", () => move(1));
    const big = el("button", { type: "button", class: "big", id: "listenPlay", title: "P or space" }, "▶ Play");
    big.addEventListener("click", () => { playingAll = false; listen(picked); });
    const all = el("button", { type: "button", class: "all", id: "listenAll" }, "▶▶ Play all");
    // Another rendering of the same words, for when the voice is right and the reading isn't.
    const take = takeOf[id] || 1;
    const fresh = el("button", { type: "button", class: "all", id: "listenTake", disabled: take >= MAX_TAKES, title: "Render this line again, as a new take" }, "↻ New take");
    fresh.addEventListener("click", async () => {
      stop();
      takeOf[id] = Math.min(MAX_TAKES, take + 1);
      await refreshState();
      draw();
      listen(picked);
    });
    const earlier = el("button", { type: "button", class: "link", id: "listenEarlier", hidden: take <= 1 }, "back to take " + (take - 1));
    earlier.addEventListener("click", async () => {
      stop();
      takeOf[id] = Math.max(1, take - 1);
      await refreshState();
      draw();
    });
    all.addEventListener("click", () => {
      if (playingAll) return stop();
      stop();
      playingAll = true;
      picked = 0;
      listen(0);
      syncListen();
    });
    return el("div", { class: "listen", id: "listen" },
      voice,
      el("div", { class: "pick" }, prev, el("span", { class: "count" }), next),
      el("div", { class: "words" }),
      big,
      el("div", { class: "progress", "aria-hidden": "true" }, el("span")),
      el("div", { class: "time" }),
      all,
      el("div", { class: "takes" }, fresh, el("span", { class: "hint" }, "take " + take + " of up to " + MAX_TAKES, " ", earlier)),
      el("div", { class: "hint", id: "listenNote" }));
  }

  // Where their people live: the places in words, and the realm's map with each one marked by its number.
  function homelandView(homeland) {
    const list = el("ol", { class: "places" }, homeland.places.map((place) => el("li", {}, place.title, place.label ? el("span", { class: "hint" }, " (the map calls it " + place.label + ")") : null)));
    const marked = homeland.places.map((place, i) => ({ place, n: i + 1 })).filter((item) => item.place.x !== null);
    const map = marked.length
      ? el("div", { class: "realmmap" },
          el("img", { src: "/art/world/realm_of_red_sky.webp", alt: "The realm's map, with " + marked.map((item) => item.place.title).join(" and ") + " marked", loading: "lazy" }),
          marked.map((item) => el("span", { class: "pin", style: "left:" + item.place.x / 10 + "%;top:" + item.place.y / 10 + "%", title: item.place.title }, String(item.n))))
      : null;
    return el("div", {}, list, map);
  }

  // A plain field, saved as you leave it, like the accent: no Edit button, no second step.
  function field(label, value, placeholder, onSave) {
    const area = el("textarea", { placeholder, "aria-label": label, rows: "2" }, value);
    area.addEventListener("change", () => onSave(area.value));
    return el("label", { class: "field" }, el("span", {}, label), area);
  }

  function about(id, entry, profile) {
    const gender = el("select", { "aria-label": "Gender" }, Object.entries(GENDER).map(([value, label]) => el("option", { value }, label)));
    gender.value = entry.gender || "unknown";
    gender.addEventListener("change", async () => { await save(id, { gender: gender.value }); draw(); loadTold(); });
    const back = entry.genderFrom === "person" ? el("button", { type: "button", class: "link" }, "use the content's") : null;
    if (back) back.addEventListener("click", async () => { await save(id, { gender: "auto" }); draw(); loadTold(); });
    const facts = [
      ["Gender", el("span", {}, gender, " ", el("span", { class: "hint" }, FROM[entry.genderFrom || "none"]), back ? " · " : null, back)],
      ["Pronouns", entry.pronouns || "—"],
      profile.facts.basis || (profile.canon && profile.canon.people) ? ["People", profile.facts.basis || profile.canon.people] : null,
      profile.facts.heightCm ? ["Height", profile.facts.heightCm + " cm" + (profile.facts.stance && profile.facts.stance !== "standing" ? ", " + profile.facts.stance : "")] : null,
      profile.canon && profile.canon.home ? ["Home", profile.canon.home] : null,
      profile.homeland ? [profile.homeland.source === "people" ? "Their people live" : "Lives", homelandView(profile.homeland)] : null,
      profile.canon && profile.canon.role ? ["Role", profile.canon.role] : null,
      profile.facts.look ? ["Looks like", profile.facts.look] : null,
      entry.aliases.length ? ["Also called", entry.aliases.join(", ")] : null,
      ["Speaks", entry.speaks ? ((entry.lineCount || 0) > 0 ? "yes, " + entry.lineCount + " line" + (entry.lineCount === 1 ? "" : "s") + " in the game" + (entry.guessedLines ? " (" + entry.guessedLines + " guessed, from being the only one in the scene)" : "") + (entry.lines.length ? ", " + entry.lines.length + " to audition" : "") : "yes, but no line of theirs found yet") : "no: they don't talk"],
      ["Chapters", el("div", { class: "chips" }, entry.chapters.length ? entry.chapters.map((c) => el("span", { class: "chip" }, c)) : el("span", { class: "hint" }, "every one"))],
    ].filter(Boolean);
    return el("section", { class: "panel" }, el("h2", {}, "About them"), el("dl", { class: "facts" }, facts.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])));
  }

  function canonPanel(id, entry, profile) {
    const notes = profile.voiceNotes.map((note) => editable(
      "Voice note", note.text, note.chapter + " → " + note.key,
      (text) => editCanon(id, { kind: "voiceNote", chapter: note.chapter, key: note.key, text }),
      note.pinned ? el("div", { class: "pinned" }, "Gemfall is pinned: an edit here means re-taking the hashes in gemfall-compat.test.ts.") : null));
    const individual = profile.canon ? Object.entries(FIELDS).map(([field, label]) => editable(
      label, profile.canon.fields[field], "canon/individuals.yaml → " + profile.canon.id,
      (text) => editCanon(id, { kind: "individual", field, text }))) : [];
    const empty = !notes.length && !individual.length;
    return el("section", { class: "panel" },
      el("h2", {}, "Voice notes in canon"),
      empty ? el("div", { class: "hint" }, entry.kind === "narrator" || entry.kind === "party" ? "Described on the sheet itself, not in a chapter: change it under Voice and model." : "No chapter gives a voice note for them yet: they appear only in scene casts.") : null,
      notes, individual,
      el("div", { class: "hint" }, "Edits are written to the file shown, and the sheet is rebuilt so the voice model hears the new words. Your decisions are kept."));
  }

  // One voice for the rest of their people, where it puts nobody on a voice they share a chapter with. Asks first, with the plan.
  async function sharePeople(id) {
    const mode = provider();
    try {
      const plan = await call("/api/cast/people", { id, provider: mode });
      const names = (ids) => ids.map((other) => data.speakers[other].name).join(", ");
      if (!plan.applied.length) {
        toast(plan.already.length && !plan.skipped.length ? "They all have it already." : "None of the rest of their people can have it: " + plan.skipped.map((item) => item.why).join("; "));
        return;
      }
      const kind = (plan.people || "their people").replace(/_/g, " ");
      const sentence = "Give " + KadMode.voiceName(data.speakers[id], mode) + " to " + plan.applied.length + " more of the " + kind + ": " + names(plan.applied) + "."
        + (plan.skipped.length ? "\\n\\nLeft as they are (" + plan.skipped.length + "):\\n" + plan.skipped.map((item) => "• " + item.why).join("\\n") : "")
        + "\\n\\nThey stay unapproved, so each is still yours to hear and judge.";
      if (!confirm(sentence)) return;
      const done = await call("/api/cast/people", { id, provider: mode, apply: true });
      for (const [other, changed] of Object.entries(done.entries)) data.speakers[other] = changed;
      clashes = done.clashes;
      toast("Gave it to " + done.applied.length + " more of the " + kind + ".");
      await refreshState();
      draw();
    } catch (error) { toast(error.message); }
  }

  function modelPanel(id, entry) {
    const sheetOwned = entry.kind === "narrator" || entry.kind === "party";
    const mode = provider();
    const mine = KadMode.voiceId(entry, mode);
    const pick = async (value) => { await save(id, KadMode.pickBody(mode, id, value, elevenVoices)); draw(); loadTold(); if (prefs.autoplay && value) autoPlay(); };
    const voiceLabel = KadMode.NAMES[mode] + " voice";
    let voice;
    if (mode === "elevenlabs") {
      // An account can have hundreds: search them, and hear each one's own sample before spending anything on an audition.
      voice = KadMode.voicePicker({ options: KadMode.voiceOptions(mode, entry, data.voices, elevenVoices), value: mine, label: voiceLabel, onPick: pick });
      // Nothing in the account fits? Design one from what the sheet knows of them.
      voice.append(KadMode.voiceDesigner({ id, name: entry.name, call, onSaved: async (made, updated) => { data.speakers[id] = updated; elevenVoices = elevenVoices.concat(made); await ensureElevenVoices(true); draw(); loadTold(); } }));
    } else {
      voice = el("select", { "aria-label": voiceLabel }, KadMode.voiceOptions(mode, entry, data.voices, elevenVoices).map((o) => el("option", { value: o.value }, o.label)));
      voice.value = mine;
      voice.addEventListener("change", () => pick(voice.value));
    }
    const others = mine ? Object.entries(data.speakers).filter(([other, e]) => other !== id && KadMode.voiceId(e, mode) === mine).length : 0;
    // The rest of their people: the others who are one of the same kind (a yeti, a griffin), the narrator and party not among them.
    const kindKey = data.profiles[id] && data.profiles[id].people;
    const kin = kindKey ? Object.keys(data.speakers).filter((other) => other !== id && data.profiles[other] && data.profiles[other].people === kindKey && data.speakers[other].kind !== "narrator" && data.speakers[other].kind !== "party").length : 0;
    const share = kin ? el("button", { type: "button", disabled: !mine, title: mine ? "Shows who would get it first, and asks" : "Pick a voice for them first" }, "Use this voice for the other " + kin + " " + kindKey.replace(/_/g, " ") + (kin === 1 ? "" : "s")) : null;
    if (share) share.addEventListener("click", () => sharePeople(id));
    const accent = el("input", { value: entry.accent || "", placeholder: data.accent, "aria-label": "Accent", list: "accent-list" });
    accent.addEventListener("change", async () => { await save(id, { accent: accent.value }); draw(); loadTold(); });
    const suggestions = el("datalist", { id: "accent-list" }, data.accents.map((a) => el("option", { value: a.label, label: a.group + " · " + a.note })));
    // Ideas from where their people live, one click to try; a click on the one in use puts the sheet's own back.
    const ideas = (data.profiles[id] && data.profiles[id].accentIdeas) || [];
    const tryAccent = async (label) => { await save(id, { accent: entry.accent === label ? "" : label }); draw(); loadTold(); };
    const chips = ideas.length
      ? el("div", { class: "chips accents" }, el("span", { class: "hint" }, "Ideas from where their people live:"), ideas.map((idea) => {
          const chip = el("button", { type: "button", class: "chip action", "aria-pressed": String(entry.accent === idea.label), title: idea.note + ". " + idea.because.join("; ") }, idea.label);
          chip.addEventListener("click", () => tryAccent(idea.label));
          return chip;
        }))
      : el("div", { class: "hint" }, "Nothing on the map to suggest from. Start typing for the accents on offer, or write your own.");
    const info = mode === "gemini" ? voiceInfo[entry.gemini.voice] : null;
    const mismatch = info && info.gender && entry.gender && (entry.gender === "female" || entry.gender === "male") && (info.gender === "f") !== (entry.gender === "female");
    return el("section", { class: "panel" },
      el("h2", {}, "Voice and model"),
      el("div", { class: "row" }, voice, el("span", { class: "hint" }, !mine ? "no " + KadMode.NAMES[mode] + " voice yet" : others ? "also " + others + " other" + (others === 1 ? "" : "s") + " in other chapters" : "only them")),
      share ? el("div", { class: "row" }, share, el("span", { class: "hint" }, "where it puts nobody on a voice they share a chapter with")) : null,
      mismatch ? el("div", { class: "clash" }, "This voice reads as a " + (info.gender === "f" ? "woman's" : "man's") + ", and they're marked " + entry.gender + ".") : null,
      (clashes[id] || []).map((clash) => el("div", { class: "clash" }, "Same voice as " + clash.with.map((other) => (data.speakers[other] || { name: other }).name).join(", ") + " in " + clash.chapter)),
      el("label", { class: "inline grow" }, "Accent", accent, suggestions),
      chips,
      sheetOwned ? field("How they sound (on the sheet: the " + entry.name.toLowerCase() + " isn't in any chapter's canon)", entry.who, "A warm grown-up storyteller…", async (text) => {
        if (await save(id, { who: text })) { syncListen(); loadTold(); }
      }) : null,
      field("Your direction for the model", entry.direction || "", "e.g. a touch quicker than usual, or brighter, with a smile in it", async (text) => {
        if (await save(id, { direction: text })) { syncListen(); loadTold(); }
      }),
      el("div", { class: "hint" }, "Saved as you leave the box, and kept on every rebuild. Leave direction empty to remove it."),
      mode === "elevenlabs" ? el("div", { class: "hint" }, "ElevenLabs has no style prompt: it reads the words in the voice you picked. On v3 and later their own accent and a short direction go in front of the line as tags (shown below); the description steers only Gemini.") : null,
      el("div", { class: "hint" }, mode === "elevenlabs" ? "What " + (told ? told.model : modelId()) + " is sent:" : "What " + (told ? told.model : modelId()) + " is told, besides the words:"),
      el("pre", { class: "told", id: "told" }, told && told.id === id ? told.display : "…"),
      el("div", { class: "hint" }, "Changing the description or direction changes what is sent, so each line renders once more in the new words."));
  }

  function hearPanel(id, entry) {
    const lines = data.auditions[id] || [];
    const rows = lines.map((line, i) => {
      const row = el("div", { class: "line", "data-line": String(i) });
      const button = el("button", { type: "button", class: clipOf((cells[id] || [])[i]) ? "" : "primary", disabled: !KadMode.voiceId(entry, provider()), title: KadMode.voiceId(entry, provider()) ? "" : "Pick a voice for them first" }, "▶ Play");
      button.addEventListener("click", () => { playingAll = false; listen(i); });
      row.append(button, el("div", {},
        el("div", {}, line.text),
        line.standIn ? el("div", { class: "standin" }, "Stand-in line, not from the game") : el("div", { class: "from" }, line.address),
        el("div", { class: "err" }, errorOf((cells[id] || [])[i]) || "")));
      return row;
    });
    const sayRow = el("div", { class: "line say" });
    const area = el("textarea", { placeholder: "Type anything for " + entry.name + " to say…", "aria-label": "Something for them to say" }, said.text);
    const sayButton = el("button", { type: "button", class: "primary", disabled: !KadMode.voiceId(entry, provider()), title: KadMode.voiceId(entry, provider()) ? "" : "Pick a voice for them first" }, "▶ Say it");
    sayButton.addEventListener("click", () => say(id, area.value, sayRow, sayButton));
    area.addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) sayButton.click(); });
    sayRow.append(sayButton, el("div", {}, area, el("div", { class: "hint" }, "Cmd/Ctrl+Enter to say it. Rendered once, then free."), el("div", { class: "err" }, errorOf(said.cell) || "")));
    return el("section", { class: "panel" },
      el("h2", {}, "Hear them"),
      rows.length ? rows : el("div", { class: "hint" }, "They don't speak, so there's nothing of theirs to hear."),
      sayRow);
  }

  function historyPanel(entry) {
    const decisions = KadMode.history(entry, provider());
    if (!decisions.length) return null;
    return el("section", { class: "panel" }, el("h2", {}, KadMode.NAMES[provider()] + " history"), el("div", { class: "history" }, decisions.map((d) => el("div", { class: d.decision }, KadMode.historyLine(d)))));
  }

  function decideBar(id, entry) {
    const mode = provider();
    const mine = KadMode.voiceId(entry, mode);
    const approved = KadMode.approved(entry, mode);
    const notes = el("textarea", { id: "decisionNotes", placeholder: approved ? "Notes for reopening" : "Why it works, or what's wrong: too old, more bounce, a woman's voice…", "aria-label": "Decision notes" });
    const acceptButton = el("button", { type: "button", class: "accept", title: "A", disabled: !mine }, mine ? "✓ Accept " + KadMode.voiceName(entry, mode) + " and next " : "Pick a voice first ", el("kbd", {}, "A"));
    acceptButton.addEventListener("click", accept);
    const rejectButton = el("button", { type: "button", class: "reject", disabled: true, hidden: !mine, title: mode === "gemini" ? "Say what's wrong first: it steers the next voice" : "Say what's wrong first: it is kept, and the voice is taken back so you can pick another" }, mode === "gemini" ? "Reject, try another voice" : "Reject, pick another voice");
    rejectButton.addEventListener("click", reject);
    notes.addEventListener("input", () => { rejectButton.disabled = notes.value.trim() === ""; });
    const reopen = el("button", { type: "button" }, "Reopen");
    reopen.addEventListener("click", async () => { await save(id, { status: "provisional" }); draw(); });
    const skip = el("button", { type: "button" }, approved ? "Next waiting →" : "Skip →");
    skip.addEventListener("click", () => { const n = data.order.length; let i = data.order.indexOf(id); for (let t = 0; t < n; t++) { i = (i + 1) % n; if (isWaiting(data.order[i])) return open(data.order[i]); } drawDone(); });
    document.getElementById("decide").replaceChildren(el("div", { class: "inner" },
      notes,
      el("div", { class: "row" }, approved ? [el("span", { class: "badge ok" }, "Approved on " + KadMode.voiceName(entry, mode)), reopen] : [acceptButton, rejectButton], skip)));
  }

  function draw() {
    stop();
    const id = current;
    const entry = data.speakers[id];
    const profile = data.profiles[id] || { image: null, imageIsGeneric: false, facts: {}, canon: null, voiceNotes: [] };
    document.title = entry.name + " · Cast profiles";
    document.getElementById("main").replaceChildren(
      el("div", { class: "leftcol" }, portrait(id, entry, profile)),
      el("div", { class: "rightcol" }, about(id, entry, profile), canonPanel(id, entry, profile), modelPanel(id, entry), hearPanel(id, entry), historyPanel(entry)));
    decideBar(id, entry);
    drawHeader();
    syncListen();
  }

  function drawDone() {
    stop();
    current = null;
    document.getElementById("main").replaceChildren(el("section", { class: "panel done" },
      el("p", { class: "name" }, "Everyone has a voice."),
      el("p", {}, "All " + data.order.length + " characters are approved. Download the review from ", el("a", { href: "/cast" }, "the cards page"), ", and commit content/voice/cast.json.")));
    document.getElementById("decide").replaceChildren();
    drawHeader();
  }

  async function loadTold() {
    if (!current) return;
    const id = current;
    try {
      const json = await call("/api/cast/told", { id, provider: provider(), model: modelId() });
      told = Object.assign({ id, display: provider() === "elevenlabs" ? (json.voice ? "Sent as: " + json.text + "\\n\\nVoice: " + KadMode.voiceName(data.speakers[id], "elevenlabs") : "No voice picked yet.") : json.told + "\\n\\nVoice: " + json.voice }, json);
      const pre = document.getElementById("told");
      if (pre && current === id) pre.textContent = told.display;
    } catch (error) { toast(error.message); }
  }

  async function refreshState() {
    try {
      const json = await call("/api/cast/state", { provider: provider(), model: modelId(), takes: takeOf });
      cells = json.cells;
      clashes = json.clashes;
      spent = json.spent;
      cap = json.cap;
    } catch (error) { toast(error.message); }
  }

  function autoPlay() {
    playingAll = false;
    listen(picked);
  }

  function open(id, push = true) {
    current = id;
    said = { text: "", cell: null };
    told = null;
    picked = 0;
    playingAll = false;
    if (push) history.pushState({ id }, "", "/cast/profile?id=" + encodeURIComponent(id));
    draw();
    window.scrollTo({ top: 0 });
    loadTold();
    if (prefs.autoplay) autoPlay();
  }
  window.addEventListener("popstate", (event) => { const id = (event.state && event.state.id) || new URLSearchParams(location.search).get("id"); if (id && data.speakers[id]) open(id, false); });

  // Keys, unless typing.
  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = (event.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (event.key === "a" || event.key === "A") { event.preventDefault(); accept(); }
    else if (event.key === "j" || event.key === "ArrowRight") { event.preventDefault(); document.getElementById("next").click(); }
    else if (event.key === "k" || event.key === "ArrowLeft") { event.preventDefault(); document.getElementById("prev").click(); }
    else if (event.key === "p" || event.key === " ") { event.preventDefault(); autoPlay(); }
    else if (event.key === "[" || event.key === "]") { event.preventDefault(); const lines = (data.auditions[current] || []).length; if (lines > 1) { stop(); picked = (picked + (event.key === "]" ? 1 : -1) + lines) % lines; syncListen(); } }
  });

  (async () => {
    // Already in ElevenLabs mode from the last visit: the account's voices are needed before the first character draws.
    await ensureElevenVoices();
    await refreshState();
    const asked = new URLSearchParams(location.search).get("id");
    const first = asked && data.speakers[asked] ? asked : data.order.find(isWaiting);
    if (first) { history.replaceState({ id: first }, "", "/cast/profile?id=" + encodeURIComponent(first)); open(first, false); }
    else drawDone();
  })();
})();
</script>
</body>
</html>
`;
}
