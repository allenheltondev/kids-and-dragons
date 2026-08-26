# Audio pipeline

How a sound gets from an idea into the game. The companion to
`docs/art-pipeline.md`, and deliberately much shorter: there are fourteen
sounds, not two hundred pictures.

## The rule everything else follows

**Real audio is an upgrade, never a requirement.** Every cue has a synthesized
recipe (`packages/client/src/audio/synth.ts`), and the game plays it whenever
there is no file — not sourced yet, a 404, bytes that will not decode, a phone
with no signal. Nothing in this pipeline can make the game silent, and no cue
has to wait for the whole set to be finished. Drop in `dice.webm` and the dice
are real while everything else is still a sine wave.

## The one list

`packages/client/src/audio/paths.ts` holds `CUE_SPECS` and `MUSIC_SPECS`: for
each sound, a **brief** (what it is, in the words a person or a model needs)
and a **target length**. The generator prompts from it, the gate checks
against it, and the game loads by it. Adding a sound means adding a row there
and a `CueId`.

Music is keyed by biome, like the backdrops. A biome with no entry still plays
— `synth.ts`'s default pad — so a new destination is playable before anybody
composes for it.

## Making sounds

```
npm run audio:generate                 # everything still synthesized
npm run audio:generate -- dice         # one cue
npm run audio:generate -- music:forest # one biome loop
npm run audio:generate -- dice --force # replace an existing file
```

Needs two things:

- **`ffmpeg`** on the path. Providers return whatever they return (usually
  MP3); the tool encodes to Opus-in-WebM at one loudness target
  (`-18 LUFS`), mono, so no cue is startling next to another.
- **A provider key.** `ELEVENLABS_API_KEY` for the implemented provider.

### Changing provider

`PROVIDERS` in `tools/audio/generate.ts` is the whole seam: a function from
`(brief, seconds, kind)` to bytes. `kind` is `"sfx"` or `"music"` because every
service that does both has two endpoints, and a sound-effects model asked for
forty-five seconds of ambience returns forty-five seconds of noise.

Adding one is a function beside the existing one. A model in your own Bedrock
account is a provider too — nothing above that line knows the difference. (The
chapter generator goes through Bedrock because the model it wants is an
Anthropic one; audio has no such tie, which is why this is a seam rather than a
decision baked into the tool.)

## Checking them

```
npm run audio:verify
```

Prints what is real and what is still synthesized, and **fails only on a file
that would reach a table broken**: empty, over budget (512KB a cue, 4MB a
loop), silent, or wildly longer than its brief. Absence is reported, never
fatal — a gate that failed on missing files would have been red the day the
sound system shipped, with every cue missing by design.

Runs in CI beside `art:verify`. Length checks need `ffprobe`; without it those
are skipped and the size and emptiness checks still run.

## Where files live

```
assets/audio/cues/<cue-id>.webm      # dice, attack, heal, …
assets/audio/music/<biome>.webm      # forest, …
```

`assets/` is synced to the site bucket by `scripts/deploy.sh`, so a new file is
live on the next deploy with no code change.

## What the client does with them

`packages/client/src/audio/samples.ts` fetches and decodes on the **first user
gesture** — a display client that never makes a sound never spends a byte —
caches each buffer, and hands them to the engine. Nothing ever waits: a cue
fired before its file has arrived plays the recipe and uses the file from the
next time onward.

Music swaps only at a scene change, never mid-bed: a loop that cut over to a
recorded version halfway through would be a jump-cut in the one sound that is
supposed to be continuous.
