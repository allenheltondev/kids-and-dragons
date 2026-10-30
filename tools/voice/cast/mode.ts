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
    <span class="hint" id="modeNote" role="status" aria-live="polite"></span>`;

export const MODE_CSS = `
.mode { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.mode button { border: 0; border-radius: 0; background: var(--card); padding: 6px 12px; }
.mode button + button { border-left: 1px solid var(--line); }
.mode button[aria-pressed="true"] { background: var(--accent); color: #fff; }
.provider-tag { font-size: 12px; color: var(--muted); }
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
    if (provider === "gemini") return geminiVoices.map((v) => ({ value: v.id, label: v.id + " · " + v.about + (v.gender ? " · " + (v.gender === "f" ? "woman" : "man") : "") }));
    const turnedDown = new Set(history(entry, "elevenlabs").filter((d) => d.decision === "rejected").map((d) => d.voice));
    const current = voiceId(entry, "elevenlabs");
    const listed = elevenVoices.filter((v) => v.id === current || !turnedDown.has(v.id));
    const options = [{ value: "", label: "No voice yet: pick one" }, ...listed.map((v) => ({ value: v.id, label: v.name + (v.about ? " · " + v.about : "") }))];
    if (current && !elevenVoices.some((v) => v.id === current)) options.splice(1, 0, { value: current, label: voiceName(entry, "elevenlabs") + " (not on this account)" });
    return options;
  }

  /** The request that saves a voice the person picked, in the mode they are in. */
  function pickBody(provider, id, value, elevenVoices) {
    if (provider === "gemini") return { id, provider, voice: value };
    const found = elevenVoices.find((v) => v.id === value);
    return { id, provider, elevenlabs: value ? { voiceId: value, name: found ? found.name : undefined } : null };
  }

  const keyHeaders = (keys) => ({ "x-gemini-key": keys.gemini || "", "x-elevenlabs-key": keys.elevenlabs || "" });
  const keyLabel = (prefs) => NAMES[providerOf(prefs)] + " API key";

  /** Wires the header's two buttons, model picker and key box to a page's prefs. \`onChange\` runs after the mode changes. */
  function mountSwitch(ctx) {
    const { prefs, data, keys, live, savePrefs, saveKeys, onChange } = ctx;
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
    }
    const choose = (provider) => () => { if (providerOf(prefs) === provider) return; prefs.provider = provider; savePrefs(); paint(); onChange(); };
    gemini.addEventListener("click", choose("gemini"));
    eleven.addEventListener("click", choose("elevenlabs"));
    modelSel.addEventListener("change", () => { prefs.models[providerOf(prefs)] = modelSel.value; savePrefs(); onChange(); });
    keyInput.addEventListener("change", () => { keys[providerOf(prefs)] = keyInput.value.trim(); saveKeys(); onChange(true); });
    paint();
    return { paint };
  }

  return { NAMES, providerOf, isEleven, normalize, modelsFor, model, voiceId, voiceName, approved, history, lastRejected, untouched, historyLine, uses, voiceOptions, pickBody, keyHeaders, keyLabel, mountSwitch };
})();
`;
