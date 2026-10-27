# Voice bake-off

Phase 0 of the [voice narration plan](./voice-narration-plan.md): render real lines from the game
with each engine and listen to them side by side before choosing a provider.

## Paste keys and go

```
npm run voice:bakeoff -- --serve
```

Open the address it prints (`http://127.0.0.1:5199/`), then:

1. **Paste your keys.** Each one is checked right away by listing that provider's speech models.
   "Key works: N speech models" means you're ready; otherwise you see the provider's own error.
2. **Pick columns.** The page starts with the seven recommended columns (below). **Add a
   column** offers a provider, a model, a mode and how delivery is asked for. The model list
   has the researched models, plus any other speech model your key can use, under "Also on your
   key". A model your key doesn't have is flagged.
3. **Press Render all** on a column, or **Render** on a single cell. Each column shows its price
   before you spend anything, and anything rendered before is free.
4. **Listen and rate**, blind if you like.

Rendering every sample on all seven recommended columns comes to about $1.64. The server
refuses any render that would take the session past its spending cap: $5 by default, raised
from the page or with `--max-dollars`.

**Keys:** they go from the page to the bake-off server on your computer, and from there to the
provider. They're never written to disk.

- Unless you tick "Remember on this computer", they last only as long as the browser tab.
- The server listens on 127.0.0.1 only.
- Every API call has to carry a token printed into the page, so another site open in the same
  browser can't spend your credits.
- Keys in `ELEVENLABS_API_KEY` / `GEMINI_API_KEY` are used when the page leaves a field empty.

### Without the page

```
npm run voice:bakeoff -- --dry-run          # every request the recommended columns would send, and the price
npm run voice:bakeoff -- --engines fake     # tones, not voices: try the static page with no keys
ELEVENLABS_API_KEY=… GEMINI_API_KEY=… npm run voice:bakeoff
npm run voice:bakeoff -- --samples pib-intro,pib-gift,pib-hedge-mob --takes 3
```

This writes `art/review/voice-bakeoff/index.html`, which opens from disk. It also refuses to
start if its estimate is over `--max-dollars`. Both ways share one cache.

## The models (researched 2026-10-27)

`tools/voice/bakeoff/engines.json` lists them. `tools/voice/pricing.json` holds the prices
`voice:cost` and the bake-off use.

| Provider | Model id | What it is | Audio tags | One-request scene | Price |
|---|---|---|---|---|---|
| ElevenLabs | `eleven_v4` | newest; built for expressive long-form narration | yes | — | $0.08 / 1k chars |
| ElevenLabs | `eleven_v4_turbo` | v4 for real-time use | yes | — | $0.04 / 1k chars |
| ElevenLabs | `eleven_v3` | previous generation; the text-to-dialogue default | yes | yes (`/v1/text-to-dialogue`) | $0.10 / 1k chars |
| ElevenLabs | `eleven_multilingual_v2` | steady and proven | no (takes neighboring lines as context) | — | $0.10 / 1k chars |
| ElevenLabs | `eleven_flash_v2_5` | lowest latency | no | — | $0.05 / 1k chars |
| Gemini | `gemini-3.8-flash-tts` | newest Flash TTS | yes | yes, two voices at most | $9 / M audio tokens to 2026-12-31, then $18 |
| Gemini | `gemini-3.8-flash-lite-tts` | cheaper 3.8, same API | yes | yes, two voices | $6 / M audio tokens to 2026-12-31, then $12 |
| Gemini | `gemini-3.1-flash-tts-preview` | the first Gemini TTS with audio tags | yes | yes, two voices | $20 / M audio tokens |

What the research found:

- **ElevenLabs:** Eleven v4 came out after the first plan, and ElevenLabs now calls v3 the
  previous generation. v4 has no style slider and no SSML; delivery comes from inline tags like
  `[whispers]`. Text-to-dialogue still defaults to `eleven_v3` and takes up to 10 voices; under
  about 2,000 characters a request is recommended. v3 takes stability only at 0, 0.5 or 1, and
  the harness sends 0.5.
- **Gemini:** TTS runs through `models/<id>:generateContent` with
  `responseModalities: ["AUDIO"]`, and the audio comes back as base64 16-bit PCM, wrapped here as
  WAV. Since 3.1, Gemini also follows bracketed audio tags in the text (`[whispers]`, pacing tags,
  pause tags), as well as natural-language style prompts. Multi-speaker mode takes two speakers.
- **Gemini 3.8's price is said to double on 2027-01-01.** `voice:cost -- --on 2027-01-15` shows
  the difference.

**Still unverified:** this environment can't reach either provider. The model ids, request
shapes and premade ElevenLabs voice ids come from current documentation and search, not a live
call. Every rate in `pricing.json` is marked `confirmed: false` until someone checks the
provider's own price page. The page's live model list is the real check: pasting a key shows
what that key can use today. A wrong id or field fails only its own cells, with the provider's
message, which is also kept in `errors.json`.

Sources:
- [ElevenLabs models](https://elevenlabs.io/docs/overview/models)
- [Eleven v4](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4)
- [Create dialogue](https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert)
- [List models](https://elevenlabs.io/docs/api-reference/models/list.md)
- [Gemini 3.8 Flash TTS](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts)
- [Gemini speech generation](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation)
- [Cloud TTS multi-speaker config](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/Shared.Types/MultiSpeakerVoiceConfig)
- [Gemini 3.1 Flash TTS audio tags](https://cloud.google.com/blog/products/ai-machine-learning/gemini-3-1-flash-tts-on-google-cloud/)
- [Eleven v4 pricing](https://www.glbgpt.com/hub/eleven-v4-pricing/)
- [Google Cloud TTS pricing](https://cloud.google.com/text-to-speech/pricing)

## Columns: model, mode, delivery

A column is a model plus two choices, and each choice is worth hearing on its own:

- **Mode.**
  - *One request per line* sends each script line in its speaker's voice, and the page plays
    them in order. This is how the game would play them.
  - *One request for the whole scene* hands the provider the whole sample: ElevenLabs
    text-to-dialogue, or Gemini's multi-speaker config. Gemini takes two voices at most, so on
    the ensemble samples its cell says so rather than faking it.
- **Delivery.** How a line's `whisper`, `shout` or `chorus` is asked for:
  - *audio tags* puts `[whispers]` in the words (`cast.json` → `delivery.*.tag`);
  - *instructions* (Gemini only) puts a sentence in the style prompt;
  - *no hints* sends the words bare.

  Comparing Gemini with tags against Gemini with instructions is one of the recommended pairs.

The recommended seven columns:

1. v4 with tags
2. v3 as one dialogue request
3. Multilingual v2 with context
4. Gemini 3.8 Flash with tags
5. Gemini 3.8 Flash with instructions
6. Gemini 3.8 Flash as one two-voice request
7. Gemini 3.8 Flash-Lite with tags

**Restore recommended columns** brings them back.

## Cast: who voices whom

`tools/voice/bakeoff/cast.json` holds:

- each speaker's ElevenLabs voice (premade voices) and Gemini voice (its 30 prebuilt ones);
- a one-sentence description of the character, which goes into Gemini's prompt.

`party` ("you say") reads in the narrator's voice. On the page, the **Cast** panel changes any
of these. With an ElevenLabs key pasted, it lists your account's own voices, including cloned
and Library voices, and flags a default your account doesn't have. A changed voice is a new
request; the old clips stay cached, so switching back is free.

## The samples

`tools/voice/bakeoff/samples.json` has 16 real lines in five tiers. Each one names its
**address** in `content/` (the same addresses as `voice:cost`), not a copy of the words, so it
always renders what the table would hear. A sample's `script` splits the words into speakers,
the way the plan's script sidecars will (§3). `bakeoff.test.ts` fails if a script stops joining
back to the authored text.

| Tier | What it tests | Samples |
|---|---|---|
| 1-simple | narrator only: pace, warmth, comic timing | `hedge-wall`, `closer-look`, `check-prompt` |
| 2-tokens | `{facets}` and `{party}` filled in; made-up names | `facets-token`, `party-token`, `north-gate` |
| 3-one-voice | narrator plus one character, with a delivery (whisper, shout) | `pib-intro`, `pib-gift`, `faun-whisper`, `quill-squawk` |
| 4-ensemble | three or more voices, crowds in unison, the party speaking | `pib-hedge-mob`, `seal-keeper`, `sheeple-ridge`, `rumor-fire`, `hessa-soup` |
| 5-long | 700 characters with two guides: does each voice hold? | `riftseekers-route` |

Three samples share Pib (`same voice: pib`) across two campaigns: listen to them one after
another. More takes (the page's take picker, or `--takes 3`) re-roll each sample with a new seed
on ElevenLabs, so you can hear how much a voice drifts.

## Caching

Every request is cached under a hash of exactly what it sends: endpoint, model, voice, settings,
words, prompt and take. Clips land in `art/review/voice-bakeoff/clips/`, which is git-ignored
like the rest of `art/review/`. A request rendered before is never sent again, so:

- adding a sample, a column or a take costs exactly that;
- recasting one speaker re-renders only their lines;
- two columns that send identical requests share the clips. For example, Gemini with tags and
  with instructions send the same request for a line that has no delivery.

## Listening

- **Play** runs a cell's clips in order, and the script line being spoken is highlighted.
- **Blind** shuffles the columns on each card and labels them A, B, C… until you press
  **Reveal**. The score table hides names while blind.
- **Rating:** a score from 1 to 5, quick flags (wrong voice, mispronounced, delivery off,
  robotic, clipped, read the prompt aloud) and a note for each cell. Ratings are kept in this
  browser.
- **Scores** shows each column's average by tier.
- **Export ratings** downloads the ratings, the columns and any recasting as JSON.
