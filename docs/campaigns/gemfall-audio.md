# Gemfall procedural audio

The sound list is `packages/client/src/audio/paths.ts`: the original 13 effects plus five
approved Gemfall effects, and four music beds. Revision 2 was approved and is now wired
into the game through the existing audio sink and sample loader.

## Listening

Run `npm run audio:preview`. The default output is `art/review/gemfall-audio/index.html` with
22 WAV files and a `manifest.json` containing descriptions, durations, peak amplitude, RMS
level, and loop boundary measurements. An optional command-line path selects another output
folder: `npm run audio:preview -- art/review/gemfall-audio-v2`.

The HTML page works as a standalone file or through the local Vite server at
`http://localhost:5173/@fs/C:/git/kids-and-dragons/art/review/gemfall-audio/index.html`.
It has native playback controls, downloads, a volume slider, and Stop all. Starting a sound
pauses any other sound. The four music drafts repeat until paused. No autoplay.

| Group | Drafts |
|---|---|
| Existing effects | dice, attack, heal, down, revive, level-up, transform, scene-enter, choice, encounter-begin, victory, tap, error |
| Gemfall effects | gem pickup, Hollow Gate hum, citadel bell, seal awakening, cavern ambience |
| Music | enchanted forest (45s), marsh mysteries (32s), citadel discovery (32s), under the mountain (32s) |

## Sound design

`packages/client/src/audio/procedural.ts` composes additive sine-wave voices, non-integer bell
overtones, pitch sweeps, seeded noise, low-pass filtering, envelopes, stereo placement, and
short bounded echoes. Wooden cues combine pitched resonance with filtered noise. Musical
cues use a shared major-key palette. The Gate hum uses closely spaced frequencies to pulse;
the seal combines a low rumble with crystal notes, keeping the tone wondrous rather than scary.

Music uses overlapping warm chord voices. The forest draft follows the existing request for
no distracting melody; the Gemfall beds add occasional quiet bell motifs. Contributions and
echoes wrap around the music buffer to make cyclic boundaries rather than fading to silence.

Rendering is deterministic and produces 24 kHz stereo, 16-bit PCM WAV. Effects target RMS
0.12 (tap 0.04); music targets 0.055. Peak limiting caps every file at 0.6 full scale, so
short transient cues can land below their RMS target. This is RMS balancing, not LUFS
normalization. The existing import pipeline can encode approved drafts as Opus/WebM and
apply production loudness normalization later.

## Production wiring

`npm run audio:install` exports all 22 approved sounds to `assets/audio/cues` and
`assets/audio/music`. The production format is stereo Opus/WebM: 64 kbps for effects and
96 kbps for loops, about 1.97 MiB total. Lossless WAVs remain listening/source artifacts.
Existing presentation and UI events automatically use the 13 replacement effect files.

`scene-audio.ts` plays a party-level gem pickup when a new `facet_*` quest item arrives.
It establishes a baseline when joining a run, so existing inventory never triggers pickups.
The Hollow Gate has a hum, the citadel gate and mountain countdown have bells, mountain
gallery scenes have cavern air, and entering the seal chamber or tether scene has the
awakening rumble. The Gate hum and cavern air are sustained, looping location ambience:
their illustrated backdrop selects the loop across story, check, rest, and voting scenes.
They stop on leaving that location or entering combat, rather than on every scene change.
Ambience requested before the unlock gesture starts at unlock; a late sample replaces its
continuous fallback. One-shot effects do not repeat on health/vote patches and fade out on leaving.

`MUSIC_BY_BIOME` maps woods/MossHome to forest, marsh to reeds, Exchange/fields/plains/crossings
to the travelling strings, and foothills/mountain to deep ambience. The citadel's interior
scenes in chapter 6 switch to the citadel bed. Files are shared across biome aliases rather
than duplicated. The loader crossfades from the fallback pad as soon as a loop decodes,
and ignores late downloads for a place the party has left.

Sound still requires a user gesture. Mute/volume preferences and the synthesis fallback remain.
All playback is on WorldView, preserving one speaker on the TV in Party Mode. The music bus
is set to 0.45 so the quiet approved music beds remain audible beneath effects and narration.

Validation covers finite PCM, audible energy, peak limits, full existing-cue coverage,
duration, silent SFX endpoints, and smooth loop boundaries. Browser review decoded all
22 WAVs, checked exclusive playback and Stop all, and checked desktop and phone layouts.
Automated checks do not assess musical taste; the listening page is for that review.

## Revision 2 — listening feedback

Output: `art/review/gemfall-audio-v2/`. The first render remains available for comparison.
The five Gemfall effects are unchanged. Dice now use short irregular dry contacts instead
of a descending pitched sequence. Heal is a simultaneous warm breath-like swell, distinct
from the gem pickup's ascending chimes. Revive keeps its flutter without the final bell.
Level-up is one octave higher. Transform is air and a blooming chord without chimes;
victory is two soft drum pulses and a warm chord resolving home.

The music arrangements differ in both timbre and structure: forest is slowly overlapping
bowed swells with no beat; marsh is answering reed phrases, air, and suspended drones;
citadel is plucked strings with alternating bass and a gentle pulse; mountain is deep
open fifths, mineral breaths, and distant sustained tones. They retain the quiet family
reading-aloud mood, rather than all sharing the first draft's chord-and-bell arrangement.
