# Voice bake-off

Phase 0 of the [voice narration plan](./voice-narration-plan.md): render real lines from the game
with each engine and listen to them side by side before choosing a provider.

```
npm run voice:bakeoff -- --dry-run          # every request it would send, and the price
npm run voice:bakeoff -- --engines fake     # try the page with no keys (tones, not voices)
ELEVENLABS_API_KEY=… GEMINI_API_KEY=… npm run voice:bakeoff
open art/review/voice-bakeoff/index.html
```

Rendering the full set on all six real engines costs about $1.65 (`--dry-run` gives the current
figure). Each run stops before sending anything if its estimate is over `--max-dollars`
(default $5).

## The samples

`tools/voice/bakeoff/samples.json` has 16 real lines in five tiers. Each one names its
**address** in `content/` (the same addresses as `voice:cost`), not a copy of the words. The
harness reads the text at run time, so it always renders what the table would hear.

A sample's `script` splits the words into speakers, the way the plan's script sidecars will
(§3). It has to join back to exactly the authored text. `bakeoff.test.ts` checks this, so a
chapter edit that changes a sample fails the test with the new words to re-cut from.

| Tier | What it tests | Samples |
|---|---|---|
| 1-simple | narrator only: pace, warmth, comic timing | `hedge-wall`, `closer-look`, `check-prompt` |
| 2-tokens | `{facets}` and `{party}` filled in; made-up names | `facets-token`, `party-token`, `north-gate` |
| 3-one-voice | narrator plus one character, with a delivery (whisper, shout) | `pib-intro`, `pib-gift`, `faun-whisper`, `quill-squawk` |
| 4-ensemble | three or more voices, crowds in unison, the party speaking | `pib-hedge-mob`, `seal-keeper`, `sheeple-ridge`, `rumor-fire`, `hessa-soup` |
| 5-long | 700 characters with two guides: does each voice hold? | `riftseekers-route` |

Three samples share Pib (`group: pib`) across two campaigns. Listen to them one after another:
it's the closest test of the requirement that matters most, a character sounding like
themselves every time. `--takes 3` renders extra takes of each sample, with a new seed on
ElevenLabs, and the page lets you switch between them to hear how much a voice drifts:

```
npm run voice:bakeoff -- --samples pib-intro,pib-gift,pib-hedge-mob --takes 3
```

## The engines

`tools/voice/bakeoff/engines.json` holds:

- ElevenLabs v3
- ElevenLabs Multilingual v2
- Gemini 3.8 Flash
- Gemini 3.8 Flash-Lite
- `fake`

Each engine runs in one of two modes:

- **lines**: one request per script line in its speaker's voice, played back in order. This is
  how the game would play them, and it's the fair comparison.
- **dialogue**: the whole sample in one request to the provider's multi-speaker endpoint
  (ElevenLabs text-to-dialogue, Gemini's multi-speaker config). Gemini's takes at most two
  voices, so its cell says so for the ensemble samples rather than faking it.

`cast.json` holds:

- the voice each speaker gets on each provider;
- a one-sentence description of the character, which goes into Gemini's style prompt;
- what each delivery word becomes: an ElevenLabs v3 audio tag or a Gemini instruction.

The `party` speaker ("you say") reads in the narrator's voice.

**Unverified:** this environment couldn't reach either provider's API. The request shapes,
model ids (`gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`) and the premade ElevenLabs voice
ids are from the providers' documentation as of this writing. Check them on the first real run.
A wrong one fails its own cells with the provider's error message (also in
`art/review/voice-bakeoff/errors.json`); the run carries on.

## Caching

Every request is cached under a hash of exactly what it sends: endpoint, model, voice,
settings, text and take. Clips land in `art/review/voice-bakeoff/clips/` (git-ignored, like
the rest of `art/review/`). A request rendered before is never sent again. Adding a sample, an
engine or a take costs exactly that, and changing a voice in `cast.json` re-renders only that
speaker's lines. API keys are added at send time and never written to disk.

## The page

`art/review/voice-bakeoff/index.html` opens from disk:

- **One card per sample, engines side by side.** **Play** runs a cell's clips in order, and the
  script line being spoken is highlighted.
- **Blind** shuffles the engines on each card and labels them A, B, C… until you press
  **Reveal**.
- **Rating:** a score from 1 to 5, quick flags (wrong voice, mispronounced, delivery off,
  robotic, clipped, read the prompt aloud) and a note for each cell. Ratings are kept in this
  browser.
- **Scores** shows each engine's average by tier.
- **Export ratings** downloads them as JSON, to compare between listeners or keep with the
  decision.
