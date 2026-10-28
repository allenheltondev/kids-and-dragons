# Voice narration plan (ElevenLabs or Gemini TTS)

**Status: plan. Built so far: `npm run voice:cost` (§9), the script sidecar schema and join-equals-source check in `content:validate` (§3), the clip key, desired-clip list and `npm run voice:status` (§4: `tools/voice/clip-key.ts`, `desired.ts`, `manifest.ts`), `npm run voice:generate` with direct-to-S3 upload and the shared clip layout (`packages/shared/src/voice-clips.ts`, §4-§5), `npm run voice:extract`, the line inventory (§1, phase 1 minus `narrationParts`), the phase-0 bake-off harness `npm run voice:bakeoff` ([voice-bakeoff.md](./voice-bakeoff.md)), the cast voice sheet `npm run voice:cast` and its `/cast` page ([voice-cast.md](./voice-cast.md)), and read-aloud on by default on the TV (§7).** This covers recorded, multi-voice narration: a narrator plus a
consistent voice for each cast member. It also covers the pipeline that turns authored text into
audio linked to that text, knows what needs (re)generating, and caches hard at every layer.

It builds on what already ships and replaces none of it:

- `speak()` (`packages/shared/src/speak.ts`) is the one seam. Every line the table hears already
  goes through it ([read-aloud.md](./read-aloud.md)). Recorded voice becomes another `Speaker`.
- The browser `SpeechSynthesis` speaker (`synth-speaker.ts`) stays as the fallback, the same way
  `synth.ts` backs every sound cue ([audio-pipeline.md](./audio-pipeline.md)).
- The rule carries over unchanged: **recorded voice is an upgrade, never a requirement.** A missing
  clip, a 404 or no signal means the line is read by the device voice. Nothing here can make the
  game silent or stall a scene.

## What we're working with (measured 2026-10-27)

| | |
|---|---|
| Chapters | 42, 3,232 scenes |
| Authored narration strings | 4,411 (918k characters) |
| Choice labels | 4,044 (112k characters) |
| Check prompts, goal/variant text, hints | ~104k characters |
| **Total voiceable text** | **1.05M characters** without choice labels (1.15M with), about 21 hours at a storyteller's pace (`npm run voice:cost`) |
| Scenes that already quote someone speaking | 1,170 (36%) |
| Tokens in authored text | `{facets}` ×59, `{party}` ×3 |

At 32 kbps mono Opus that's about 300 MB of audio, around 7 MB per chapter. That's too much for
git (`assets/` is already 581 MB, without LFS). Clips go in the site bucket instead (see Caching).

Three facts about the engine shape the design:

1. **Narration is composed at runtime.** `composeSceneNarration` (`engine.ts`) joins the branch's
   lead line, the branch narration and its variants, the scene's base text and whichever variants'
   `when` holds. Then `fillTokens` fills them in. The string on `RunState.narration` is never a
   single authored string, so **audio has to be keyed on the authored pieces, not the composed
   result.**
2. **Some spoken text contains player input.** "X's turn", the decision line ("Ana chose…") and
   fight-log lines contain kids' character names. Those can't be pre-generated, and we shouldn't
   send them to a third party (see Privacy).
3. **Chapters already sketch the cast.** `voiceGuide.npcVoices` (e.g. bramblewood-01's Pib, wisp and
   door voice) and canon's `speech_register` (`canon/individuals.yaml`, layered over the peoples'
   register) are casting notes we can use as they stand.

---

## 1. Every voiceable line gets an address

This is the foundation everything else hangs on. Each authored string that can be spoken gets a
stable **line address**, derived from where it sits in the content:

```
bramblewood-01/scene_pib/narration
bramblewood-01/scene_pib/variants/2
bramblewood-01/check_hum/prompt
bramblewood-01/check_hum/onSuccess/narration
bramblewood-01/scene_hedge_wall/choices/listen/label
bramblewood-01/@goal/text
gemfall/@prologue/3
help/<topic>/text
```

Choices are addressed by `id`, not array index, so reordering choices doesn't re-address them.
Variants are addressed by index, which is the one fragile spot. A variant reorder shows up as
"stale", never as wrong audio, because of the source hash below.

### Classification: what gets voiced and what doesn't

The extractor sorts every spoken surface into one of four kinds. The `voice:status` report counts
each kind, so "what needs voice" is never a guess:

| Kind | What | How it's heard |
|---|---|---|
| **recorded** | scene/branch narration, variants, check prompts, goal text, hints, story plates and prologue, recap lines, `help.json`, field guide | pre-generated clips |
| **templated** | finite-valued pieces: `{party}` (4 forms), `{facets}` (0–14), number words, "Your goal:", "Last time…" | pre-generated per value; the token's value picks the clip |
| **live** | anything with a player-entered name: turns, decision lines, fight log, transform cutscene | device voice (unchanged), see Privacy |
| **silent** | UI chrome, ids, `$comment`, `voiceGuide`, labels the TV never reads | nothing |

Token expansion: a line containing `{party}` becomes four clips (`#party=1..4`), and `{facets}`
becomes one clip per reachable count. That's finite and cheap (62 strings in total), and it beats
stitching a number into the middle of a sentence.

### The engine tells the client which pieces it composed

`RunState` gets `narrationParts: { line: string; token?: Record<string, string> }[]` next to
`narration`, written by the same `composeSceneNarration` call so the two can't disagree. The
client turns parts into a playlist. A reload mid-scene hears the same pieces, just as it reads the
same words today.

> **Gemfall check, before writing any code:** `gemfall-compat.test.ts` pins gameplay digests.
> Find out whether a new `RunState` field moves them. If it does, the field is excluded from the
> digest, or the parts get their own state key. The digests must not move.

---

## 2. Voices: a registry and a casting sheet

Two files, both in git, both validated by `content:validate`:

**`content/voice/voices.json`**: the voice bank. A voice is a provider-neutral role with a pinned
provider config for each provider:

```jsonc
{
  "narrator.warm": {
    "description": "Warm grown-up storyteller, unhurried, smiling, a little spooky on the quiet bits",
    "sample": "The path ends at a wall of thorns twice your height.",
    "elevenlabs": { "voiceId": "…", "model": "…", "settings": { "stability": 0.55, "similarity": 0.8, "style": 0.2 }, "seed": 1201 },
    "gemini":     { "voice": "…", "style": "Read like a warm bedtime storyteller for an eight-year-old." }
  },
  "sprite.small": { "description": "Tiny, earnest, fast, over-explains", "…": "…" }
}
```

**`content/voice/cast.json`**: who speaks with which voice. This is the cast voice sheet
([voice-cast.md](./voice-cast.md)) and it is the source of truth for speaker ids. Each key under
`speakers` is the id a script's `by` uses: `narrator`, `party`, and one id per speaker as the
sheet already names them (`pib`, `wisp`, `door_voice`; groups such as `sprites`; creatures such as
`drake`). Where a speaker is a canon individual the entry carries `canon: "individual.pib"`, so the
voice is decided once and holds across campaigns and chapters. Chapter `voiceGuide.npcVoices` keys
are recorded as `voiceNotes` and `aliases`. Peoples and unnamed speakers draw from a small pool with a
deterministic pick (hash of speaker id), so the same unnamed captain sounds the same on every visit.

Rules the validator enforces: every speaker a script uses is cast. Every voice cast exists and has
a config for the active provider. No two named speakers in one scene share a voice.

A deliberately small bank (around 12–20 voices, varied with settings and delivery) keeps
consistency manageable. It also makes switching providers a recast of the bank rather than of
hundreds of characters.

**`content/voice/lexicon.json`**: pronunciation. Made-up words are the most common way TTS fails
on this game: Pib, Gemfall, Riftlight, facet names, place names. Each entry gives a respelling
(and IPA where the provider takes it). The pipeline applies it to the *spoken* text only, never
to screen text. `voice:extract` lists every capitalized word not in the lexicon or a dictionary,
which `content:continuity` already knows how to find.

---

## 3. More speaking: scripts that split narration into voices

### The script sidecar

Multi-voice delivery needs to know which words are the narrator's and which are Pib's. That goes
in a **sidecar per chapter**, `content/voice/scripts/<chapterId>.json`, and never in the chapter
JSON:

```jsonc
{
  "scene_first_dock/narration": {
    "source": "sha256:…",          // hash of the authored text this was cut from
    "lines": [
      { "by": "narrator", "text": "You pass crates down a long line of sailors until your arms smell like breakfast." },
      { "by": "npc.yeti#captain", "text": "\"We owe you one,\"", "delivery": "hearty" },
      { "by": "narrator", "text": "says the captain, a cheerful yeti with orange peel in his fur." },
      { "by": "npc.yeti#captain", "text": "\"Sailors always pay their debts.\"" }
    ]
  }
}
```

Why a sidecar:

- **Screen text stays the single truth.** The validator checks that the lines, joined, equal the
  source text (quotes and whitespace normalized). A script can't make the audio say something
  the screen doesn't, which keeps `speak.ts`'s promise: "read-aloud says exactly what the screen
  shows".
- **Edits are detected, not trusted.** If the source hash no longer matches, the script is stale.
  `voice:status` reports it, and the scene plays with the device voice until it's re-cut.
- **Gemfall's pinned hashes don't move** when we add audio to it.
- Lines without a script entry just mean "narrator reads it all", so a sidecar is never required.

`delivery` is a short closed vocabulary (`whisper`, `excited`, `hearty`, `nervous`, `sing-song`,
…) that each provider adapter maps to its own controls (audio tags, style prompt). It's metadata,
never spoken.

A script line can also carry **beats**: `<sigh>`, `<laugh>`, `<gasp>`, `<pause>`, `<long pause>`
written in its text where they fall. They're not on screen, so the join check leaves them out.
Each provider family writes them its own way: `[sighs]` on ElevenLabs v3/v4, `<sigh>` on
Gemini 3.8, an SSML break for a pause on ElevenLabs v2. The bake-off already does this
([voice-bakeoff.md](./voice-bakeoff.md#expression-delivery-and-beats)).

### Drafting scripts

`voice:script --chapter X` drafts entries. It splits on quotation marks and attributes each quote
from the nearest speech tag ("says Pib", "he croaks") and the scene's `cast`. Anything ambiguous
goes to an LLM pass with the chapter's `voiceGuide` and cast. Every draft is marked
`"reviewed": false` until a person (or the `chapter-cohesion` review) confirms it. Re-running it
only touches missing or stale entries.

### Writing more dialogue

36% of scenes already quote someone. The rest often report speech ("She tells you the bridge is
out") or describe a character who never speaks. A writing pass converts some of that to quoted
lines, done with the `chapter-cohesion` skill under the house rules:

- **A new person arrives speaking.** The CLAUDE.md rule that newcomers arrive with a stake gets a
  companion: they say it themselves, in a quoted line, in their `npcVoices`/`speech_register` voice.
- **Attribute in the same sentence** as the quote (`"…," says Pib`), one speaker per quote. This
  keeps scripts unambiguous for the drafting tool and for an eight-year-old listener.
- **Quotes stay short.** One or two sentences, then the narrator again. Long monologues are where
  TTS character voices drift.
- **Spine first.** Dialogue goes on the scenes every path walks (the same rule as new material)
  and on priority-1 reveals, which are retold in the recap.

A new report, `content:dialogue` (reports, never gates, like `content:pacing`), gives each
chapter's share of spine scenes with a spoken line and lists cast members who never speak.
Proposed target: half of spine scenes that have a `cast` include a quoted line.

Order: `bramblewood-01` (the voice reference) → `first-steps` → Riftlight → The Hollow Crown →
Gemfall last, because every Gemfall edit re-takes `gemfall-compat` hashes with a reason in the
commit.

---

## 4. The generation pipeline

New `tools/voice/` (the `tools/audio` pattern), with npm scripts:

| Command | Does | Gates? |
|---|---|---|
| `voice:extract` | builds the line inventory: address, text, kind, token expansions, speakers. Writes nothing to content | no |
| `voice:script` | drafts or refreshes script sidecars (above) | no |
| `voice:status` | desired clips vs. manifest: **missing / stale / unreviewed / approved / orphaned**, per chapter, with a character count and cost estimate for each provider | no |
| `voice:generate` | renders only missing clips. `--chapter`, `--speaker`, `--provider`, `--dry-run`, `--max-chars` budget cap, concurrency, retries with backoff | no |
| `voice:review` | a listening page per chapter (like `audio:preview`): play a scene's playlist, approve, reject with a note, regenerate a take | no |
| `voice:verify` | CI: every manifest entry points at a clip that exists, the script sidecars match their source, every speaker is cast, durations are sane | **yes, on broken, never on missing** |

As with `audio:verify`, **absence is reported, never fatal**. A gate that failed on missing clips
would be red from day one.

### The clip key: what makes caching and regen exact

Each rendered clip is named by a hash of **everything that affects the sound and nothing else**:

```
clipKey = sha256(
  provider, model, voiceConfig (voice id + settings + seed + style),
  delivery, spokenText (after lexicon + normalization), pipelineVersion
)
```

What follows from that:

- **A text edit regenerates exactly that line.** Its key changes. Nothing else's does.
- **Retuning a voice regenerates exactly that speaker's lines.** Changing the lexicon entry for
  "Pib" regenerates only lines that say "Pib".
- **Moving or renaming a scene costs nothing.** The address changes, the key doesn't, and the clip
  is reused.
- **Two scenes with identical words in the same voice share one clip.** That's common for choice
  labels like "Keep going".
- **A provider or model change is a deliberate, visible full re-render.** It shows up in
  `voice:status` as stale with its cost before anyone spends anything.
- Neighboring lines (providers' previous/next-text context, if used) are **not** in the key. This
  way, editing one line doesn't regenerate the paragraph around it.

### Running it: `npm run voice:generate`

Renders what `voice:status` says is owed, and **spends nothing unless you pass
`--render`**. Without it, it reads the destination, prints what is already there
and what the rest would cost, and stops.

```bash
npm run voice:generate -- --chapter bramblewood-01                       # plan and price only
npm run voice:generate -- --chapter bramblewood-01 --fake --dir /tmp/clips --render   # fake tones, no key, no AWS
GEMINI_API_KEY=… npm run voice:generate -- --chapter bramblewood-01 --stage staging --render
… --stage staging,prod        # render once, upload to both buckets
```

- **Straight to S3.** `--stage` finds the site bucket from the `kad-<stage>` stack's
  `SiteBucketName` output (as `deploy.sh` does); `--bucket NAME` names one. It uses your own AWS
  credentials, like `timing:export`. Each clip goes to `voice/<key[0:2]>/<key>.webm` with
  `Cache-Control: public,max-age=31536000,immutable`, `Content-Type: audio/webm` and its length in
  object metadata, by a conditional write (`If-None-Match: *`): a clip that exists is never replaced,
  even by two runs racing. A `HEAD` before the provider call is the generation cache.
- **Caps.** `--max-dollars` (default 75) and `--max-chars` stop the run *before* the request that
  would cross them, priced with the same model as `voice:cost`, with in-flight requests reserved
  against the cap. Every provider call counts, retries included, and a failed call is not refunded
  (it may have been billed), so a clip's retries cannot spend past the cap. The total is an
  estimate of spend, not a billing ceiling. What is left is the next run's.
- **The destination decides what is owed.** Every clip the game wants is checked against the
  bucket (a `HEAD`), not only the ones the manifest does not list: the manifest says a clip was
  rendered somewhere, never that *this* bucket has it. A new production bucket, a half-uploaded
  staging one or a deleted object is repaired by running the same command against it.
- **Manifests.** After a real run, `content/voice/manifest/<chapter>.json` maps each line to its
  clips once *all* of them are confirmed at the destination. An entry always describes the words a
  line says now: if a line's text, voice or delivery changed and its new clips are not all there yet,
  its old entry is omitted (the old audio stays in the bucket) so the line is read by the device
  voice, never by outdated words. A line whose script went stale loses its entry the same way. Commit
  the manifests: they deploy with `content/` and the client reads them at
  `/content/voice/manifest/<chapter>.json`. `--prune` also drops entries for addresses the game no
  longer has.
- **Referencing.** `packages/shared/src/voice-clips.ts` is the one place that knows the layout
  (`clipPath`, `manifestPath`, `variantKey`, `playlistFor`). The tool that uploads and the client that
  plays share it. `playlistFor(narrationParts, manifest)` returns the clips to play, or `null` when any
  part is unrecorded, so the whole utterance falls back to the device voice.
- **Deploys leave `voice/` alone.** `deploy.sh` syncs `--delete` only into `bundle/`, `assets/` and
  `content/`, and a test pins that. CloudFront serves `/voice/*` from the site bucket with no SPA
  router, so a missing clip is a 403/404 and never an `index.html`.

### Manifest and lock (in git)

- `content/voice/manifest/<chapterId>.json`: address (+ token value) → `{ clip, ms, words? }`.
  This is what the client loads, about 50–100 KB per chapter. `words` holds optional word timings
  (see Linking).
- `content/voice/voice.lock.json`: approvals. An approved take is pinned to its clip key and
  source hash. If someone regenerates and gets a worse take, the approved one stays until a new
  one is approved. `voice:status` shows "approved", "rendered, awaiting review" and "never
  rendered" separately.

### Rendering steps per clip

1. Normalize the text: curly → straight quotes for the provider, apply the lexicon, expand tokens.
2. Call the provider adapter (one interface, two implementations: `elevenlabs.ts`, `gemini.ts`).
   Multi-voice scenes render line by line, each in its own voice. Where the provider supports
   it, pass the neighboring lines as context so the prosody flows.
3. Encode with the existing `tools/audio/encode.ts` path (ffmpeg → Opus/WebM, mono). Voice gets a
   loudness target of its own (around -16 LUFS) and trimmed leading/trailing silence, so playlists
   don't have gaps.
4. Upload to the site bucket under `voice/<key[0:2]>/<key>.webm`, then write the manifest entry.
   The upload is idempotent: a key that already exists is skipped without calling the provider.
   **That check is the generation cache.**

---

## 5. Caching, layer by layer

| Layer | Mechanism |
|---|---|
| **Generation** | content-addressed clip store: a key that exists is never rendered again, across branches, machines and CI |
| **Storage** | the existing site bucket (the one `deploy.sh` syncs `assets/` into), under its own top-level `voice/` prefix, not git. **Not under `assets/`**: deploy runs `aws s3 sync assets … --delete`, which would delete every clip that isn't in the repo. Clips are immutable, so a re-render never overwrites one |
| **CDN** | `voice:generate` uploads each clip with `public,max-age=31536000,immutable`, like `/bundle`. Deploy never syncs or deletes `voice/`. The 300 s `assets/` policy doesn't apply, since a changed line has a new URL. CloudFront already serves the bucket, so no new behavior is needed unless `/voice/*` wants its own cache policy |
| **Service worker** | a new `voice` strategy in `sw/policy.ts`: cache-first, no fingerprint lookup needed (the URL is the hash), in its own `kad-voice-v1` cache with an LRU cap (around 150 MB) |
| **Prefetch** | when a scene opens, the speaking device fetches the clips for this scene and for every `goto` one step ahead (the choices, both check branches). In a 30-scene chapter that's a handful of small files, and nobody waits on a click |
| **Offline** | Travel Mode can "Keep this chapter's voices" (around 7 MB), precached from the manifest |
| **Manifest** | loaded alongside the chapter JSON through the existing content fingerprint path |

---

## 6. Linking audio to text

- **Address → clip** is the link: the manifest says which clip says which authored words, and the
  script sidecar says which speaker says which span.
- **Word timings:** providers that return character/word alignment (ElevenLabs' timestamped
  endpoint) give us `words: [startMs…]` for free. For a provider that doesn't, a forced-alignment
  pass runs after rendering. This enables **following along on the TV**: the current sentence, or
  word, is highlighted as it's read. That's a real reading aid for this age, and a stretch goal,
  not phase-one.
- **Speaker → face:** a script line `by` a cast member can pulse that member's figure on the stage
  while they speak. It's cheap once the playlist knows who is talking.

---

## 7. The client

- **`clip-speaker.ts`**, a new `Speaker`: `speak(text, { parts })` resolves the parts through the
  manifest into a playlist of clips. If **every** clip is present, it plays them. If any is
  missing, the **whole utterance** goes to the device voice. Half Pib, half robot would be worse
  than consistently robot. `speak()`'s queue/interrupt rules are unchanged.
- **Playback through the existing audio engine** (`packages/client/src/audio/`), not an
  `<audio>` tag. Music ducks around 10 dB while a voice plays and comes back afterwards. Cues
  still fire over it.
- **On by default on the TV (built).** The shared screen reads aloud unless somebody has
  switched it off on that device. Turning it off (or back on) is remembered in `localStorage`
  (`kad.readaloud`) and beats the default. Phones stay off by default. See
  [read-aloud.md](./read-aloud.md).
- **Who speaks:** unchanged. The TV in Party Mode, the phone in Travel Mode. Phones in Party Mode
  keep the device voice for their own choice labels. Labels can come later; it means phones
  downloading clips.
- **A spoken-line cue:** the TV shows a small "speaking" state on the narration panel, plus the
  cast pulse above.

---

## 8. Privacy and live lines

Lines that contain a player's character name stay on the **device voice**, so the name never goes
to ElevenLabs or Google. These are children's names, often their real ones. The quality hit is
limited: these lines are short, and many can be reworded to avoid the name. For example, the TV
can play a recorded "Your turn!" while the name shows on screen. A server-side live-TTS proxy
with caching is possible later, but it's a privacy decision first and an engineering one second.

---

## 9. Choosing a provider

Both are plausible. The plan doesn't depend on which, because of the adapter and the
provider-neutral voice bank. Decide with the **bake-off** (`npm run voice:bakeoff`,
[voice-bakeoff.md](./voice-bakeoff.md)): 16 real lines from five chapters, from a single narrator
up to a five-voice flock, rendered by every engine and rated blind side by side. `voice:bakeoff -- --serve` opens it as a live page: paste the keys, pick models, press Render. Scored on:

1. **Consistency.** Does Pib sound like Pib across 20 lines rendered on different days? This is
   the requirement that matters most. Pinned voice ids, settings and seeds favor ElevenLabs.
   Gemini voices are steered by a style prompt, which may drift more. Measure it, don't assume.
2. **Character range** from a small bank (sprite, yeti, rhyming wisp, narrator).
3. **Alignment/timestamps.** Native, or does it need the forced-alignment pass?
4. **Cost.** `npm run voice:cost` prices it (below).
5. **Delivery controls** (whisper, excited) and pronunciation-dictionary support.
6. **Terms** for a kids' product, and whether generated audio can be stored and redistributed.

### What it costs: `npm run voice:cost`

This counts every line the game would record (`tools/voice/inventory.ts`, the same list the
generator will use) and prices it with each model in `tools/voice/pricing.json`. It calls no API.
Each distinct text is counted once (one narrator reads them all), `{party}`/`{facets}` lines are
counted once per value, and retakes are padded in (`--retakes`, default ×1.25). Gemini bills
audio tokens (25 a second), so its price depends on reading speed: 14 characters a second, set
in `pricing.json`.

The whole game, choice labels excluded, ×1.25 for retakes, `{facets}` expanded 0–14 (every great stone the content can hand out), priced 2026-10-28:

| Model | Whole game | Gemfall | Riftlight | Fits the $75 first run? |
|---|---|---|---|---|
| ElevenLabs v4 | $114.45 | $66.33 | $46.45 | no: one campaign at a time |
| ElevenLabs v4 Turbo | $57.22 | $33.16 | $23.23 | yes |
| ElevenLabs v3 / Multilingual v2 | $143.06 | $82.91 | $58.07 | no: Gemfall alone is over |
| ElevenLabs Flash v2.5 | $71.53 | $41.45 | $29.03 | yes |
| Gemini 3.8 Flash TTS | $24.18 | $14.01 | $9.81 | yes, 3× over |
| Gemini 3.8 Flash-Lite TTS | $15.92 | $9.22 | $6.46 | yes |
| Gemini 3.1 Flash TTS | $52.28 | $30.29 | $21.22 | yes |

Every rate is marked unconfirmed in `pricing.json`. They came from third-party summaries,
because the provider pages couldn't be fetched from here. Check them before spending. Two things
change the numbers:

- **Gemini 3.8 doubles on 2027-01-01** ($9 → $18 per million audio tokens for Flash). A first
  render before then is half the price: `voice:cost -- --on 2027-01-15` shows the difference.
  `--batch` prices Gemini's batch discount.
- **ElevenLabs' rate depends on the model and the plan.** Eleven v4 (its newest, built for
  long-form narration) is quoted at $0.08 per thousand characters and v4 Turbo at $0.04, below
  v3's $0.10. Plan overage has been quoted anywhere from $0.10 to $0.30.

**Budget: $75 cap on the first run.** `voice:generate` will take `--max-dollars 75` and stop before
the request that would cross it, priced with the same model. On Gemini 3.8 Flash the cap covers
the whole game with room for a second pass, and on ElevenLabs v4 Turbo the whole game once. On
ElevenLabs v4 it covers Gemfall ($66.33) or Riftlight ($46.45) with the small campaigns, and on v3
Riftlight but not Gemfall ($82.91).

---

## 10. Phases

Each phase ships on its own and leaves the game working.

| # | Phase | Delivers | Done when |
|---|---|---|---|
| 0 | **Spike** | `voice:bakeoff` (built): 16 real lines from simple to ensemble, rendered by every engine, rated blind side by side ([voice-bakeoff.md](./voice-bakeoff.md)) | provider chosen, voice bank v1 drafted |
| 1 | **Addresses & inventory** | line addresses, `voice:extract`, classification report, `narrationParts` on `RunState` (Gemfall digests checked first) | every spoken line in the game has an address and a kind |
| 2 | **Voices** | `voices.json`, `cast.json`, `lexicon.json`, schema + validation, casting for all named NPCs | every speaker in every chapter is cast |
| 3 | **Scripts** | sidecar schema, the join-equals-source validator, `voice:script` drafting | bramblewood-01 and first-steps-01 scripted and reviewed |
| 4 | **Pipeline & cache** | provider adapter, `voice:generate` (with `--max-dollars`), clips in the site bucket's `voice/` prefix, manifests, `voice:status`, `voice:verify` in CI | changing one word regenerates one clip, and status says so first |
| 5 | **Client** | `clip-speaker`, ducking, prefetch, SW `voice` strategy, CDN policy, device-voice fallback | bramblewood-01 plays fully voiced on a TV, and a 404 falls back cleanly |
| 6 | **Review & lock** | `voice:review` page, approvals, `voice.lock.json` | a regenerated take never replaces an approved one silently |
| 7 | **Dialogue pass** | `content:dialogue` report, house-rule additions to content/README and CLAUDE.md, chapter-by-chapter rewrites | the dialogue target met on the reference chapters, then campaign by campaign |
| 8 | **Full render** | campaigns rendered and reviewed in the phase-3 order, first run capped at $75 | `voice:status` clean for a whole campaign |
| 9 | **Stretch** | word-highlight follow-along, cast pulse, offline chapter packs, voiced choice labels on phones | — |

Phases 2–3 and the dialogue writing (7) can run alongside 4–5. The writing doesn't need the
pipeline, and rewriting before the full render (8) avoids paying to render text twice.

## Decided (2026-10-27)

- **American accents for every voice**: the game is for American children. The accent is part of
  every Gemini style ([voice-cast.md](./voice-cast.md)).
- **Gemini is the leading provider.** The cast voice sheet (`content/voice/cast.json`, `/cast`)
  casts the whole game in Gemini voices; ElevenLabs stays in the bake-off for comparison.

- **The TV reads aloud by default**, with the switch to turn it off remembered per device. Built.
- **Budget:** $75 cap for the first render run (`--max-dollars 75`).
- **Storage:** clips go in the existing site bucket, under a `voice/` prefix next to `assets/`
  (not inside it, so deploy's `--delete` never touches them).
- **One narrator voice** for the whole game.
- **Names:** text on screen can say a player's name; audio always says "hero", from the recorded voice and the device voice alike. A name never reaches any speaker or provider; every name-bearing surface gets a sweep (section 8).
- **Provider and model:** Gemini 3.8 Flash TTS (`gemini-3.8-flash-tts`), decided by the owner. ElevenLabs stays in the bake-off for comparison only.
