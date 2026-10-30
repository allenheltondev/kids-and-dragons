/**
 * The cast pages' voice mode (docs/voice-cast.md): Gemini or ElevenLabs.
 *
 * Both pages (page.ts, profile-page.ts) are one HTML string with their script inline, so what they share
 * is a string too: a script that defines `KadMode`, and the header switch and its styles. The logic lives
 * here, once, as plain functions of the page's `prefs`, the sheet's entries and the voices on offer, so a
 * test can run it (mode.test.ts) and the two pages cannot drift apart on what "approved" or "the voice
 * they have" means in a mode.
 *
 * In Gemini mode a character's voice is `entry.gemini.voice`, approved by `entry.status`. In ElevenLabs
 * mode it is `entry.elevenlabs.voiceId`, approved by `entry.elevenlabs.approved`, picked from the account's
 * voices (the page asks the server for them with the account's key). Everything else about a character
 * is the same in both.
 */

/** The switch, a model picker and the key, in the header's row: both pages put this where their model picker was. */
export const MODE_HEADER_HTML = `<div class="mode" role="group" aria-label="Voices from">
      <button id="modeGemini" type="button" aria-pressed="true">Gemini</button>
      <button id="modeEleven" type="button" aria-pressed="false">ElevenLabs</button>
    </div>
    <select id="model" aria-label="Model"></select>
    <input id="key" type="password" placeholder="Gemini API key" aria-label="API key" autocomplete="off" spellcheck="false">
    <span class="hint" id="modeNote" role="status" aria-live="polite"></span>
    <details class="library" id="library" hidden></details>`;

export const MODE_CSS = `
.mode { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.mode button { border: 0; border-radius: 0; background: var(--card); padding: 6px 12px; }
.mode button + button { border-left: 1px solid var(--line); }
.mode button[aria-pressed="true"] { background: var(--accent); color: #fff; }
.provider-tag { font-size: 12px; color: var(--muted); }
.voicepick { display: grid; gap: 4px; min-width: 0; flex: 1 1 260px; }
.voicepick .tools { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.voicepick input[type="search"] { flex: 1 1 140px; }
.voicepick select { width: 100%; }
.library { flex: 1 1 100%; }
.library summary { cursor: pointer; font-weight: 600; }
.library .found { display: grid; gap: 4px; margin-top: 6px; max-height: 280px; overflow: auto; }
.library .found > div { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
.library .found .about { flex: 1 1 200px; color: var(--muted); font-size: 12px; }
`;

/** Defines `KadMode`. Pure but for `mountSwitch`, which wires the header's buttons. */
export const MODE_SCRIPT = `
const KadMode = (() => {
  const NAMES = { gemini: "Gemini", elevenlabs: "ElevenLabs" };
  const PROVIDERS = ["gemini", "elevenlabs"];
  const providerOf = (prefs) => (prefs.provider === "elevenlabs" ? "elevenlabs" : "gemini");
  const isEleven = (prefs) => providerOf(prefs) === "elevenlabs";

  /** Fills in what an older saved page has no word of: the mode, and a model for each. */
  function normalize(prefs, data) {
    prefs.provider = providerOf(prefs);
    prefs.models = Object.assign({}, prefs.models);
    // The one model an old page remembered was a Gemini one.
    if (!prefs.models.gemini && typeof prefs.model === "string" && prefs.model.startsWith("gemini-")) prefs.models.gemini = prefs.model;
    for (const provider of PROVIDERS) {
      const offered = modelsFor({ provider }, data);
      if (!offered.some((m) => m.model === prefs.models[provider])) prefs.models[provider] = data.defaultModels[provider];
    }
    delete prefs.model;
    return prefs;
  }

  const modelsFor = (prefs, data) => data.models.filter((m) => m.provider === providerOf(prefs));
  const model = (prefs) => prefs.models[providerOf(prefs)];

  /** The voice a character has in a mode: a Gemini voice's name, or an ElevenLabs voice id. "" when they have none. */
  const voiceId = (entry, provider) => (provider === "elevenlabs" ? (entry.elevenlabs && entry.elevenlabs.voiceId) || "" : entry.gemini.voice);
  /** What to call that voice: Gemini's own name for it, or the name the account gives an ElevenLabs voice (its id if it has none). */
  const voiceName = (entry, provider) => (provider === "elevenlabs" ? (entry.elevenlabs && (entry.elevenlabs.name || entry.elevenlabs.voiceId)) || "" : entry.gemini.voice);
  const approved = (entry, provider) => (provider === "elevenlabs" ? !!(entry.elevenlabs && entry.elevenlabs.approved) : entry.status === "approved");

  /** The decisions made in this mode, oldest first: a decision with no provider is a Gemini one. */
  const history = (entry, provider) => (entry.history || []).filter((d) => (d.provider || "gemini") === provider);
  const lastRejected = (entry, provider) => {
    const list = history(entry, provider);
    return !approved(entry, provider) && list.length > 0 && list[list.length - 1].decision === "rejected";
  };
  const untouched = (entry, provider) => !approved(entry, provider) && history(entry, provider).length === 0;
  const historyLine = (d) => (d.decision === "approved" ? "Approved " : "Rejected ") + (d.voiceName || d.voice) + (d.notes ? ': "' + d.notes + '"' : "") + " · " + d.at.slice(0, 10);

  /** How many characters have each voice in this mode. */
  function uses(speakers, provider) {
    const count = {};
    for (const entry of Object.values(speakers)) {
      const voice = voiceId(entry, provider);
      if (voice) count[voice] = (count[voice] || 0) + 1;
    }
    return count;
  }

  /**
   * What the voice picker offers a character: Gemini's thirty, or the account's own voices. A character's
   * ElevenLabs voice that is not on the account any more is still listed, so the picker never lies about it.
   * Their rejected ElevenLabs voices are left out: they were heard and turned down.
   */
  function voiceOptions(provider, entry, geminiVoices, elevenVoices) {
    if (provider === "gemini") return geminiVoices.map((v) => ({ value: v.id, label: v.id + " · " + v.about + (v.gender ? " · " + (v.gender === "f" ? "woman" : "man") : ""), gender: v.gender || undefined }));
    const turnedDown = new Set(history(entry, "elevenlabs").filter((d) => d.decision === "rejected").map((d) => d.voice));
    const current = voiceId(entry, "elevenlabs");
    const listed = elevenVoices.filter((v) => v.id === current || !turnedDown.has(v.id));
    const options = [{ value: "", label: "No voice yet: pick one" }, ...listed.map((v) => ({ value: v.id, label: v.name + (v.about ? " · " + v.about : ""), preview: v.preview, gender: v.gender }))];
    if (current && !elevenVoices.some((v) => v.id === current)) options.splice(1, 0, { value: current, label: voiceName(entry, "elevenlabs") + " (not on this account)" });
    return options;
  }

  /**
   * The voices that match a search: every word typed must be somewhere in a voice's label (its name, and what the
   * provider says about it: category, accent, gender, age, what it is for). The voice already picked, and the blank
   * "no voice yet", always stay, so a search never hides what is saved or the way to take it back.
   */
  function filterOptions(options, query, keep) {
    const words = String(query || "").toLowerCase().split(/\\s+/).filter(Boolean);
    if (!words.length) return options;
    return options.filter((o) => o.value === "" || o.value === keep || words.every((word) => o.label.toLowerCase().includes(word)));
  }

  /** The voices of one gender ("f", "m", or "" for any). The voice already picked and the blank stay, as in a search. */
  function filterGender(options, gender, keep) {
    if (!gender) return options;
    return options.filter((o) => o.value === "" || o.value === keep || o.gender === gender);
  }

  /** The audio playing a voice's sample, if any: one at a time, so samples never talk over each other. */
  let sample = null;
  function stopSample() { if (sample) { sample.pause(); sample = null; } }

  /**
   * The picker for a long list of voices: a search box that narrows the list as you type, the list, how many are
   * showing, and a Preview of the highlighted voice's own sample (free to play, unlike an audition). \`onPick\` gets
   * the voice's id, or "" for none.
   */
  function voicePicker(opts) {
    const { options, value, label, onPick } = opts;
    const wrap = document.createElement("div");
    wrap.className = "voicepick";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search " + (options.length - 1) + " voices: name, accent, gender, age…";
    search.setAttribute("aria-label", "Search ElevenLabs voices");
    const gender = document.createElement("select");
    gender.className = "gender";
    gender.setAttribute("aria-label", "Filter by gender");
    for (const [value, text] of [["", "Any gender"], ["f", "Women"], ["m", "Men"]]) { const node = document.createElement("option"); node.value = value; node.textContent = text; gender.append(node); }
    const select = document.createElement("select");
    select.setAttribute("aria-label", label);
    const preview = document.createElement("button");
    preview.type = "button";
    preview.textContent = "▶ Preview";
    const count = document.createElement("span");
    count.className = "hint";
    const previewOf = (id) => { const found = options.find((o) => o.value === id); return found ? found.preview : undefined; };
    // A page can hold a card for every character, each with a list of hundreds: a card starts with only its own
    // voice in the list, and builds the rest when somebody reaches for it (focus, a click, or a search).
    let full = false;
    const own = options.filter((o) => o.value === "" || o.value === value);
    function syncPreview() {
      preview.disabled = !previewOf(select.value);
      preview.title = previewOf(select.value) ? "Hear this voice's own sample (free)" : "This voice has no sample to play";
    }
    function fill(keep) {
      const shown = full ? filterGender(filterOptions(options, search.value, keep), gender.value, keep) : own;
      select.replaceChildren(...shown.map((o) => { const node = document.createElement("option"); node.value = o.value; node.textContent = o.label; return node; }));
      select.value = shown.some((o) => o.value === keep) ? keep : "";
      count.textContent = search.value.trim() || gender.value ? (shown.filter((o) => o.value !== "").length) + " of " + (options.length - 1) : "";
      syncPreview();
    }
    const open = () => { if (!full) { full = true; fill(select.value || value); } };
    search.addEventListener("input", () => { open(); fill(select.value || value); });
    gender.addEventListener("change", () => { open(); fill(select.value || value); });
    select.addEventListener("focus", open);
    select.addEventListener("mousedown", open);
    select.addEventListener("change", () => { stopSample(); preview.textContent = "▶ Preview"; syncPreview(); onPick(select.value); });
    preview.addEventListener("click", () => {
      const url = previewOf(select.value);
      if (!url) return;
      if (sample && sample.src === url && !sample.paused) { stopSample(); preview.textContent = "▶ Preview"; return; }
      stopSample();
      sample = new Audio(url);
      preview.textContent = "■ Stop";
      sample.addEventListener("ended", () => { preview.textContent = "▶ Preview"; });
      sample.play().catch(() => { preview.textContent = "▶ Preview"; });
    });
    wrap.append(el2("div", "tools", search, gender, preview, count), select);
    fill(value);
    wrap.select = select;
    return wrap;
  }
  function el2(tag, cls, ...kids) { const node = document.createElement(tag); node.className = cls; node.append(...kids); return node; }

  /** The request that saves a voice the person picked, in the mode they are in. */
  function pickBody(provider, id, value, elevenVoices) {
    if (provider === "gemini") return { id, provider, voice: value };
    const found = elevenVoices.find((v) => v.id === value);
    return { id, provider, elevenlabs: value ? { voiceId: value, name: found ? found.name : undefined } : null };
  }

  const keyHeaders = (keys) => ({ "x-gemini-key": keys.gemini || "", "x-elevenlabs-key": keys.elevenlabs || "" });
  const keyLabel = (prefs) => NAMES[providerOf(prefs)] + " API key";

  /**
   * The public Voice Library, beside the account's own voices. The account's list (the picker) is only what has been added
   * to it, which for a new account is a couple of dozen; the library has thousands. Searching it changes nothing.
   * Adding a voice does change the account (and may use one of the plan's voice slots), so it takes a click on that voice.
   */
  function mountLibrary(ctx) {
    const { call, onAdded } = ctx;
    const box = document.getElementById("library");
    const summary = document.createElement("summary");
    summary.textContent = "Find more voices in the ElevenLabs library";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search the library: warm grandmother, pirate, young boy…";
    search.setAttribute("aria-label", "Search the ElevenLabs voice library");
    const gender = document.createElement("select");
    gender.setAttribute("aria-label", "Library gender");
    for (const [value, text] of [["", "Any gender"], ["female", "Women"], ["male", "Men"]]) { const node = document.createElement("option"); node.value = value; node.textContent = text; gender.append(node); }
    const go = document.createElement("button");
    go.type = "button";
    go.textContent = "Search";
    const status = document.createElement("span");
    status.className = "hint";
    status.setAttribute("role", "status");
    const found = el2("div", "found");
    let page = 0;
    const more = document.createElement("button");
    more.type = "button";
    more.textContent = "More";
    more.hidden = true;
    async function run(next) {
      page = next;
      status.textContent = "Searching…";
      try {
        const result = await call("/api/voices/library", { search: search.value, gender: gender.value, page });
        if (!page) found.replaceChildren();
        for (const v of result.voices) found.append(row(v));
        status.textContent = (result.total !== undefined ? result.total + " in the library" : "") + (result.voices.length ? "" : "Nothing found");
        more.hidden = !result.hasMore;
      } catch (error) {
        status.textContent = "Could not search the library: " + error.message;
      }
    }
    function row(v) {
      const play = document.createElement("button");
      play.type = "button";
      play.textContent = "▶";
      play.title = "Hear this voice's own sample (free)";
      play.disabled = !v.preview;
      play.addEventListener("click", () => { stopSample(); sample = new Audio(v.preview); sample.play().catch(() => {}); });
      const add = document.createElement("button");
      add.type = "button";
      add.textContent = "Add to my account";
      add.title = "Adds this voice to your ElevenLabs account, where it may use one of your plan's voice slots";
      add.addEventListener("click", async () => {
        if (!confirm("Add " + v.name + " to your ElevenLabs account?\\n\\nThis changes your account, and may use one of your plan's voice slots.")) return;
        add.disabled = true;
        add.textContent = "Adding…";
        try {
          await call("/api/voices/add", { ownerId: v.ownerId, voiceId: v.id, name: v.name });
          add.textContent = "Added";
          await onAdded();
        } catch (error) {
          add.disabled = false;
          add.textContent = "Add to my account";
          status.textContent = "Could not add " + v.name + ": " + error.message;
        }
      });
      const name = document.createElement("strong");
      name.textContent = v.name;
      const about = el2("span", "about");
      about.textContent = v.about || "";
      return el2("div", "", play, name, about, add);
    }
    go.addEventListener("click", () => run(0));
    search.addEventListener("keydown", (event) => { if (event.key === "Enter") run(0); });
    gender.addEventListener("change", () => run(0));
    more.addEventListener("click", () => run(page + 1));
    box.replaceChildren(summary, el2("div", "tools", search, gender, go, status), found, more);
    // Nothing is fetched until the panel is opened for the first time.
    let started = false;
    box.addEventListener("toggle", () => { if (box.open && !started) { started = true; run(0); } });
  }

  /** Wires the header's two buttons, model picker and key box to a page's prefs. \`onChange\` runs after the mode changes. */
  function mountSwitch(ctx) {
    const { prefs, data, keys, live, savePrefs, saveKeys, onChange } = ctx;
    if (ctx.call) mountLibrary({ call: ctx.call, onAdded: ctx.onAdded });
    const gemini = document.getElementById("modeGemini");
    const eleven = document.getElementById("modeEleven");
    const modelSel = document.getElementById("model");
    const keyInput = document.getElementById("key");
    function paint() {
      const provider = providerOf(prefs);
      gemini.setAttribute("aria-pressed", String(provider === "gemini"));
      eleven.setAttribute("aria-pressed", String(provider === "elevenlabs"));
      modelSel.replaceChildren(...modelsFor(prefs, data).map((m) => { const o = document.createElement("option"); o.value = m.model; o.textContent = m.label; return o; }));
      modelSel.value = model(prefs);
      keyInput.value = keys[provider] || "";
      keyInput.placeholder = live.envKeys[provider] ? "Using the " + NAMES[provider] + " key from your shell" : keyLabel(prefs);
      keyInput.setAttribute("aria-label", keyLabel(prefs));
      modelSel.setAttribute("aria-label", NAMES[provider] + " model");
      document.getElementById("library").hidden = provider !== "elevenlabs" || !ctx.call;
    }
    const choose = (provider) => () => { if (providerOf(prefs) === provider) return; prefs.provider = provider; savePrefs(); paint(); onChange(); };
    gemini.addEventListener("click", choose("gemini"));
    eleven.addEventListener("click", choose("elevenlabs"));
    modelSel.addEventListener("change", () => { prefs.models[providerOf(prefs)] = modelSel.value; savePrefs(); onChange(); });
    keyInput.addEventListener("change", () => { keys[providerOf(prefs)] = keyInput.value.trim(); saveKeys(); onChange(true); });
    paint();
    return { paint };
  }

  return { NAMES, providerOf, isEleven, normalize, modelsFor, model, voiceId, voiceName, approved, history, lastRejected, untouched, historyLine, uses, voiceOptions, filterOptions, filterGender, voicePicker, pickBody, keyHeaders, keyLabel, mountSwitch };
})();
`;
