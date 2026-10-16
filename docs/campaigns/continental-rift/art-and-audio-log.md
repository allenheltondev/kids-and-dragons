# Riftlight art and audio log

## Part A — 2026-10-16

Tracks Part A of #231. Parts B–E remain separate deliveries; Part B requires its pilot review before the remaining cast is drawn. No campaign data, canon, existing art, biome mappings or UI behavior changed here.

### Review polish — Listening Chime at 24px

Addressed PR #233's small-size legibility comment by framing the existing fractured ring and hanging striker closely in `portrait.webp`. The full 1024px assembled illustration is unchanged. The portrait crop ignores barely visible generator alpha dust, removes the long cord from the small-size composition and fits the ring within 460px of the 512px portrait. At 24px its visible silhouette grows from **10×15px to 20×22px** (alpha >32), with clear margins. No new imagery or generation prompt was used. The contact sheet now uses the actual runtime portrait for its 48px and 24px rows; the 256px row still shows the full illustration. Regenerated contact sheet and TV/phone asset previews were visually inspected; the screenshot script's neutral-only TV check passes. Pixel comparison confirms the assembled image is unchanged. This isolated crop/packaging change does not affect code or audio; prior passing CI is recorded on both PRs, with a new CI run triggered by the update.

### Delivered inventory

All eleven `assets/manifest.json` `effects[]` entries have `frames: 12`, `fps: 12`, `size: 256`, `startsOn: null`, and `outOfCombat: true`. Each has matching `assets/effects/<id>.sheet.png` and `<id>.json`. They describe chapter/world effects, so they do not consume a combat rig event. The two one-shots omit `loop`; the remaining nine declare `loop: true`. Every frame has visible alpha, including the endpoints of the one-shots.

| ID | Motion and composition decision |
| --- | --- |
| `rift_neutral` | Quiet charcoal tear with a small internal shimmer. No diagnostic pattern or palette color. TV and non-Starweaver phones use this sheet alone. |
| `rift_base` | Registered charcoal tear with empty interior for composition on the Starweaver phone. |
| `rift_green` | Broad outer brackets breathe in width, position and opacity. |
| `rift_amber` | Exactly one candle tongue at the foot, with irregular tip motion. Copper-orange amber (`#bf7430`), avoiding yellow/gold. |
| `rift_blue` | Two nested travelling elliptical ripples, with offset phases so one always remains visible. |
| `rift_violet` | Inward spiral ending in a broad arrowhead. |
| `rift_shrink` | Tear contracts over the cycle. Lifecycle timing belongs to the UI consumer. |
| `rift_stutter` | Irregular horizontal skips, with several held frames. |
| `rift_sync` | Two connected lobes beat together. Consumers must share phase between linked mouths. |
| `rift_open` | Tear unfolds from a narrow seam, without a flash. |
| `rift_collapse` | Tear folds into a narrow seam, without particles or an explosion. |

The frame builder is `art/source/build_riftlight.py`. It uses deterministic antialiased paths, following the repo's code-based effect packaging approach, to preserve registration and independently readable patterns across all twelve phases. No image-generation prompts were used for effects. Layer colors are fixed rather than tinted at runtime. Charcoal is intentionally dark and matte, with no white/silver highlight. Green is `#3da461`, blue `#467caf`, violet `#8964b5`.

The common-stack contact sheet covers **every phase** of green+amber+violet, amber+violet, green+blue, and blue, in color and grayscale. The animated review places color and grayscale side by side. The broad outer brackets, single foot flame, nested rings and inward arrow carry the distinctions in grayscale. An illustrated stage preview shows only neutral on its TV view. These are review compositions; #229 owns actual private-phone rendering. Nothing is painted into a backdrop.

| Icon ID | Runtime files | Choice |
| --- | --- | --- |
| `listening_chime` | `assets/items/listening_chime/{assembled.png,portrait.webp}` | Silver fractured circle, internal striker, closed dark teal cord. |
| `riftlight_indicator` | `assets/items/riftlight_indicator/{assembled.png,portrait.webp}` | Rose light in a charcoal eye-shaped stone bezel, three short rays. Rose carries no rift rule. |
| `riftspark` | `assets/items/riftspark/{assembled.png,portrait.webp}` | Broad rose glint and two small sparks. No palette color or numeral baked into the art. |

Icons follow the existing item convention: 1024² RGBA assembled cutout and 512² alpha WebP portrait. Existing item art has no manifest category; no new parallel icon registry was invented. Source cutouts live in `art/source/riftlight/`; `art/source/package_riftlight_icons.py` preserves their alpha and colors, fits the complete silhouette within 820px and produces the 256/48/24px review.

### Icon generation prompts

Built-in imagegen was used. The complete accepted prompts follow. One initial chime candidate was rejected because its cord met the canvas edge; it is not packaged or shipped.

**Listening Chime:**

> One complete isolated Listening Chime inventory icon for a warm hand-painted children's storybook game on transparent background. A small antique SILVER fractured-circle resonance chime: incomplete thick silver ring with gap at right, a small silver striker hanging within, suspended from a SHORT CLOSED LOOP of thick dark teal cord. The entire cord loop MUST be visible, including its top rounded turn. Object takes only central 65 percent of square canvas, large transparent margins above and below. No cord or object touches any canvas edge. Three-quarter view, thick readable silhouette at 48px, warm dark brown tapered outlines, soft cel painted shading, light upper left, restrained texture. Silver metal with cool gray highlights, not golden metal. No text, numerals, border, background, or ground shadow.

**Riftlight indicator:**

> One isolated tiny menu icon for a hand-painted children's storybook game, transparent background: a small charcoal stone bezel shaped as a rounded eye, containing a neutral SOFT ROSE pink luminous almond, with three chunky short dark rays indicating it is lit. This is a Riftlight sensing indicator, not an actual character eye. Legible at 24px: simple bold silhouette, broad pink center, warm dark brown tapered outline, two-tone soft painted shading, light upper left. Use ONLY charcoal, dark brown and dusty ROSE PINK (hue 340). Absolutely NO green, amber/orange, blue, violet/purple, gold, silver. No lettering, numbers, borders, background, shadow, or extra objects. Center complete object well within a square canvas with 15 percent transparent margin on all sides.

**Riftspark:**

> One isolated inventory buff icon for a warm hand-painted children's storybook game, transparent background. A Riftspark: one chunky soft ROSE PINK spark shaped as an irregular four-point glint, with two tiny matching pink drifting sparks. Broad thick points, dark warm-brown tapered outline, two-tone softly painted shading, upper-left light. Charming magical boost, legible at 32px. Use ONLY dusty rose pink hue 340, dark charcoal and warm brown. NO blue, green, amber/orange, violet/purple, gold, silver. No words, plus sign, numerals, border, background, ground shadow, or other objects. Center complete silhouette, 15 percent clear margin all sides.

Rejected chime prompt:

> Create one isolated inventory item icon for a warm hand-painted children's storybook game, transparent background. Listening Chime: a small antique SILVER fractured-circle resonance chime pendant, an incomplete ring with a clear gap, suspended from a thick dark teal cord, and a small hanging silver striker. Three-quarter view, chunky legible silhouette at 48 pixels. Warm dark brown tapered outlines, soft cel painted shading, light upper left, restrained texture, no photorealism or rendered 3D. Center entire item with generous clear margins on square canvas. No letters, numbers, symbols, border, ground shadow, or background.

### Audio

Seven `CueId`, `CUE_SPECS`, fallback `CUE_TONES` and procedural synthesis recipe additions. The procedural recipes are the source for the new WebM samples and the repo's existing all-briefs audio tests. Existing recipes remain unchanged.

| Cue / sample filename under `assets/audio/cues/` | Seconds | Recipe direction |
| --- | --- | --- |
| `rift-open.webm` | 2.0 | Swelling filtered air and rising glass partials. |
| `rift-collapse.webm` | 1.6 | Same partials settle downward; no impact. |
| `chime-sour.webm` | 1.4 | One 784Hz strike bending to 698Hz with six-Hz vibrato. Fallback uses beating descending sine voices. |
| `chime-echo.webm` | 1.8 | Clean 784Hz strikes at 0 and 0.85s, with silence between. No stereo dependency. |
| `attune-hum.webm` | 3.0 | Single warm swelling D/A/D answer; distinct from the Gate's eight-second beating drone. |
| `riftspark.webm` | 0.9 | Small glass spark and rising tone. |
| `anchor.webm` | 2.0 | Deep E settling to D, supported by D/A; a steady answer for the future motif. |

No provider or audio model was used; the exact sound briefs are the `CUE_SPECS` rows in `packages/client/src/audio/paths.ts`. Render with `npm run audio:install -- --only=rift-open,rift-collapse,chime-sour,chime-echo,attune-hum,riftspark,anchor` (FFmpeg required; `KAD_FFMPEG` can name it). All seven samples together occupy about 119 KiB. Every cue retains its synth recipe when a sample cannot load.

`tools/audio/riftlight.test.ts` checks the actual rendered mono waveform: the clean echo's gap remains quiet while the sour note continues, its returning strike is audible, and attunement swells once within three seconds. Child/across-room listening remains a human acceptance check; automated tests cannot establish that result.

### Verification and review

Review artifacts are committed under `art/review/riftlight/` despite the normal generated-review ignore rule. Open `index.html` for animated phone stacks, grayscale toggle and all seven samples; append `?mode=tv` for the neutral-only composition. `node tools/art/riftlight-shot.mjs` reproduces the asset preview screenshots and checks that the TV preview contains exactly the neutral layer.

- Art verifier: **1487 passed**, 24 existing warnings, no failures. Python executable was `python` because this machine's `python3` is the Windows Store alias; verifier code and arguments are otherwise identical to `npm run art:verify`.
- Rig verifier: **79 passed**, 71/71 rigs opened and compared.
- Content validator: **55 passed**.
- Audio verifier with FFmpeg decoding and silence checks: **33/34 real**, only existing `bonk` remains synthesized. FFprobe was unavailable, so the gate's optional duration probe did not run.
- Typecheck: **passed**.
- Audio tests including the new perceptual regression checks: **102 passed**.
- Full suite: **3498 passed, 8 failed, 8 skipped**, before adding the two new passing audio tests. All eight failures reproduce on unmodified `main` (`5e6d4eb8`): seven CLI tests launch the extensionless `.bin/tsx` shim via `spawnSync`, which cannot execute on Windows; one authoring-guide example extraction fails on this checkout's CRLF line endings. The targeted baseline run reports **81 passed, 8 failed, 6 skipped**. No unrelated content/tooling repairs are included.
- `e2e/cast-shot.spec.ts`, Gemfall `scene_tavern`, isolated ports 5183/8793: **1 passed**. TV, watcher phone and host phone captures included as unchanged-stage regression evidence. Riftlight chapters do not yet exist, so these captures do not pretend to demonstrate private rift UI. Separate asset compositions are labelled as such.
- New shipped filenames and manifest effect entries checked against the spoiler rule: no forbidden names or ruler hints. Neutral effects have only charcoal RGB; rule layers have only their own fixed hue (plus transparent antialias pixels).

Logs: `art-verify.txt`, `rig-verify.txt`, `content-validate.txt`, `typecheck.txt`, `audio-verify.txt`, `audio-tests.txt`, `tests.txt`, `baseline-tests.txt`, `cast-shot.txt` in the review folder. Visual/taste review and listening approval are outstanding; the implementation does not claim those human checks have passed.
