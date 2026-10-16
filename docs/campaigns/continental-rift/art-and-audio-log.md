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

## Part B pilot — Master Orin Vale

**Review gate:** the Riftlight brief's Part B says **“Pilot first and stop for review.”** Orin is the single pilot: he establishes the fellowship cloak, silver fractured-circle emblem and practical scholar equipment, while testing that an older member remains the playable griffin species. The remaining Riftseekers, locals, Skuppers and finale figure have not been drawn. This pilot is a separate Part B PR stacked on Part A, so its diff is limited to the cast pilot and review tooling.

Manifest entry:

```json
{ "id": "orin_vale", "name": "Master Orin Vale", "basis": "griffin", "scale": "medium" }
```

Runtime file: `assets/cast/orin_vale/assembled.png`, 1024² RGBA, feet registered near y=900, complete left-facing quadruped, no ground shadow or text. Scale is `medium`, following the existing named adult griffin cast and leaving the broad silhouette to convey age. The notebook and instruments are strapped to expedition gear, leaving every foot planted. The silver emblem and teal/indigo/violet cloak establish the fellowship; these are cast clothing colors, not rift layers. No character/canon/content mappings were changed because Riftlight chapter data does not exist yet.

Source is `art/source/riftlight/orin_vale.png`; `art/source/package_riftlight_cast_pilot.py` reproducibly registers it and produces a comparison with the species stand-in, including 120px thumbnails. Measurement ignores alpha dust at ≤8 but retains original alpha inside the padded crop. No anatomy or coloration was repainted during packaging.

### Generation prompt

Built-in imagegen, real transparent background. Reference 1: `assets/characters/griffin/fledgling/assembled.png` for anatomy/palette. Reference 2: `assets/cast/old_ossley/assembled.png` for mature cast rendering quality, explicitly not anatomy. Exact prompt:

> Create a NEW complete single story-cast figure on real transparent background for Kids & Dragons. Reference 1 is the griffin SPECIES anatomy and palette; reference 2 is the mature supporting-cast storybook rendering quality, NOT anatomy. Character: Master Orin Vale, he/him, an older methodical griffin scholar of the Riftseekers. Patient, warm, careful, modest spectacles over solid dark eyes, slightly weathered slate-blue feather crest and ruff, pale blue-cream coat, gold feather wings folded at his sides, eagle beak and front talons, lion hind paws and tufted tail. Clearly the same QUADRUPED species as reference 1, older and broad/sturdy, not human or biped. All four feet planted, three-quarter view FACING LEFT, head about one third of total body height. Wears a practical dark TEAL cloak with indigo/violet lining and subtle shimmering seams, SILVER FRACTURED-CIRCLE clasp (one ring with a visible gap), asymmetrical expedition satchels, thick notebook strapped at side and a few resonance rings/chimes. No writing on notebook or clothing. One clear scholar silhouette, relaxed, no weapon, no threat. Warm hand-painted children's picture-book illustration, tapered warm dark brown outlines, soft two-tone shading, upper-left light, low detail density, no photorealism, no shiny 3D. Complete cutout, no background, no ground shadow, no text. Entire crest, tail, wings and all feet visible with ample transparent margin on every side. Square canvas. Figure should occupy central 80 percent of canvas height.

### Real-stage review without editing campaign data

`e2e/cast-shot.spec.ts` now accepts optional `KAD_CAST_PREVIEW` (one `CastMember` JSON object) and `KAD_CAST_SHOT_PREFIX`. The opt-in Playwright route replaces only the selected scene's client-side cast in the fetched chapter response; the server, source JSON, saved campaign and ordinary test run are unchanged. Both the TV and phone contexts receive the same review figure. The figure path is validated and encounter scenes are left alone.

Run Gemfall on an isolated dev server, then capture the stand-in and pilot with the same setup:

```powershell
$env:KAD_CAST_SCENES='scene_tavern'
$env:KAD_CAST_PREVIEW='{"figure":"characters/griffin","name":"Master Orin Vale"}'
$env:KAD_CAST_SHOT_PREFIX='art/review/riftlight-cast/stand-in'
npx playwright test -c playwright.cast-review.config.ts e2e/cast-shot.spec.ts
$env:KAD_CAST_PREVIEW='{"figure":"cast/orin_vale","name":"Master Orin Vale"}'
$env:KAD_CAST_SHOT_PREFIX='art/review/riftlight-cast/pilot'
npx playwright test -c playwright.cast-review.config.ts e2e/cast-shot.spec.ts
```

These are deliberately staged review captures, not an authored Riftlight scene. They use Gemfall's tavern to compare the two figures at identical stage scale and camera framing. TV, watcher phone and host phone images, contact sheet and verification logs are in `art/review/riftlight-cast/`. Human approval of age/readability and the fellowship design is required before extending the cast.

### Pilot verification results

- Full art verifier: **1490 passed**, 24 existing warnings; Orin's opaque foot row is **897**, with **83px** clear margin.
- Rig verifier: **79 passed**, 71/71 rigs read; audio verifier: **33/34 real**, only existing `bonk` synthesized, with FFmpeg decoding enabled.
- Content validator: **55 passed**; repository typecheck passed.
- Review tool: strict standalone TypeScript check passed (`--strict --target es2022 --module esnext --moduleResolution bundler --skipLibCheck --allowImportingTsExtensions`).
- Cast/art-path tests: **35 passed**.
- Real-stage stand-in capture: **1 passed**; pilot capture: **1 passed**.
- Full suite rerun: **3500 passed, 8 failed, 8 skipped**. Same three files and eight baseline failures documented under Part A; no additional failures.
- New shipped filename `assets/cast/orin_vale/assembled.png` and manifest name comply with the spoiler rule.

## Part B continuation — the fellowship, locals and Skuppers

The owner approved the pilot for merge and requested continuation after #233/#234 merged. This completes the remaining Part B inventory for review; it does not change authored chapters or existing artwork.

| Cast ID | Manifest name | Basis | Scale |
| --- | --- | --- | --- |
| `lady_olivia` | Lady Olivia | unicorn | medium |
| `seren_wisp` | Seren Wisp | kitsune | medium |
| `pip_thistledown` | Pip Thistledown | manticore | medium |
| `bram_lock` | Bram Lock | bigfoot | large |
| `yeti_elder` | Reading-room elder | yeti | large |
| `kitsune_temple_keeper` | Temple keeper | kitsune | medium |
| `dragonling_stone_keeper` | Boundary-stone keeper | dragonling | medium |
| `saltrot_guide` | Saltrot guide | skupper | small_to_medium |

Each is `assets/cast/<id>/assembled.png`, a registered 1024² RGBA left-facing figure. The remaining fellowship follows Orin's teal/indigo/violet cloak and silver fractured-circle clasp. Olivia has the most striking cloak; Seren's rings and exposed tails, Pip's short scout cape and step, and Bram's broad shield/staff silhouette separate their roles. Local keepers have practical regional clothing rather than fellowship badges. Olivia's initial eye styling was corrected with imagegen to the solid dark-eye contract; no other manual repainting was used.

**Exact prompts, reference roles and Olivia's correction prompt:** [Part B prompt set](art-and-audio-part-b-prompts.json). Built-in imagegen was used for every source image. Accepted sources live under `art/source/riftlight/<id>.png`; `art/source/package_riftlight_cast.py` reproduces all registrations and the contact sheet. It measures the visible alpha silhouette, retains original alpha in a padded crop, fits within 960×820 and registers the feet near y=900.

### Skuppers: art and canon together

`assets/entities/skupper/assembled.png` is the ordinary elongated state; `puffed.png` is the round defensive state with raised soft spines. Both are complete 1024² transparent cutouts. The manifest declares one supporting people, home `sallow_wastelands`, scale `small_to_medium`, with `states.ordinary` and `states.puffed` asset-relative paths. The second image is not a second people or a duplicate canon entry. The guide uses the ordinary species as its imagegen reference, with mud-weathered clothing, walking pole and route shells. No bright rift rule colors are used in Skupper skin.

The approved brief's exact canon block is added to `canon/npcs.yaml`; frogfolk gain the Saltrot secondary location, and the Saltrot gains Skupper/frogfolk inhabitants. `register_riftlight_people.py` reproduces these narrow changes without rewriting existing lore. Ran `canon:field-guide`, `canon:world` and `canon:bestiary`; only the field guide's generated bytes change. Added the matching `ENTITY_SIZES` line and `npc.skupper` to `EXPECTED_UNREACHABLE`, since no authored chapter reveals this people yet.

**Contract correction:** the art verifier previously allowed only tactical biomes as an entity's `primaryBiome`, although `sallow_wastelands` is explicitly declared in `backgroundOnlyBiomes`. It now accepts either declared category and continues rejecting undeclared homes. The Saltrot remains background-only; no tactical kit or tiles were invented. The verifier also checks every declared alternate state for existence, location inside its entity directory, dimensions, RGBA transparency and margins. Six regression cases cover good/missing/out-of-directory/opaque alternates and valid background-only/invalid homes. These are the tooling changes the requested Skupper delivery needs, as brief §5 allows.

The assets declare both appearances; live state-to-sprite switching is outside this art delivery. Existing gameplay's PUFFED indicator remains as implemented in #227.

### Review and verification

`art/review/riftlight-people/people-contact.png` shows all ten new cutouts at large size and 120px in color/grayscale. Three real `e2e/cast-shot.spec.ts` runs photograph the fellowship, elders and locals on TV, watcher phone and host phone. Its opt-in preview now accepts one to three cast members, so group silhouettes and nameplates can be reviewed without editing campaign data. These are staged Gemfall-tavern captures, not new Riftlight scenes.

- Full art verifier: **1518 passed**, 24 existing warnings; all eight cast feet registrations and both Skupper states pass.
- Canon check: **99 entities, 598 edges**, passed. Content validation: **55 passed**.
- Repository typecheck and strict review-tool typecheck: passed.
- Targeted canon, field-guide reach, cast and new verifier tests: **66 passed**, including six new contract cases.
- Rig verifier: **79 passed**, 71/71 rigs read. Audio gate with FFmpeg: **33/34 real**, only existing `bonk` synthesized.
- All three TV/phone capture runs passed. The full suite's known Windows CLI/CRLF failures are documented under Part A. One resource-load timeout in the first concurrent full run passed its standalone retry (**22/22 motion tests**); a reduced-worker full rerun is recorded beside the other logs.
- New asset filenames and manifest names comply with the spoiler rule. Human visual review remains the final art acceptance step.

The reduced-worker full run finished with **3780 passed, 8 failed, 9 skipped**. All failures are the same Windows CLI/CRLF baseline cases in three unchanged content-tool test files; the rig-motion timeout did not recur. No tests were skipped, weakened or deleted to obtain this result.

## Part C — six special places

Built-in imagegen produced six new region-specific backdrop paintings, using the existing glacier, Saltrot and Sky Islands images as material/style references. [Exact prompts and references](art-and-audio-part-c-prompts.json). Source PNGs are under `art/source/riftlight/scenes/`; `package_riftlight_scenes.py` reproducibly fits the almost-16:9 generated canvases to 1920×1080 and exports WebP at quality 88. All six manifest `sceneIllustrations` entries are new; existing backdrop files are unchanged.

| Manifest entry / file under `assets/` | Landmark and standing space |
| --- | --- |
| `scenes/riftlight/ice-shelf-headwaters.webp` | River roaring out of an ice arch below a broad, safe foreground shelf. |
| `scenes/riftlight/reading-room.webp` | Recessed book niches and layered memory ice, open ice-stone floor; no frozen figures. |
| `scenes/riftlight/cairnstep.webp` | Watch cairns climbing toward the notch in the upper mountains, open pass terrace below. |
| `scenes/riftlight/buried-bridge.webp` | Old stone arches spanning exposed mud, not a flowing river; firm foreground mud shelf. |
| `scenes/riftlight/temple-island-squall.webp` | Second island drifting close beyond a wet temple courtyard; rain, no painted creatures. |
| `scenes/riftlight/stuttering-flats.webp` | Broad empty mudflat for a separately composed rift, with channels and roots behind the standing area. |

The manifest strings omit `.webp`, following the existing convention. Each source prompt reserves the full-width standing band from 70% down, with the figures' floor at 80%; major landmarks remain above the figures. No rifts, figures, lettering, UI or diagnostic rift-color lighting are painted into any of these images. Normal blue ice and sky are environmental color, not Riftlight layers.

`e2e/cast-shot.spec.ts` now accepts an optional `KAD_SCENE_ART_PREVIEW`: a single scene-art path or a JSON scene-id-to-art map. The review route validates paths and changes only client-fetched review chapter data. It never edits authored content. Two cast-shot runs photograph all six backgrounds on TV, watcher phone and host phone with Orin, Olivia and the guide, using three existing Gemfall scenes per run. The unchanged narration is fixture text and does not represent Riftlight story authorship. The 18 stage screenshots and the full painting contact sheet are committed under `art/review/riftlight-places/`.

All images were visually checked for floor/landmark placement and absence of figures/rifts. `scene-audit.txt` records each exact output dimension and byte count; total delivered WebP size is about 2.2 MiB. The strict standalone review-tool TypeScript check and content validator pass. Full art and test outputs accompany the PR; the same Windows baseline test limitations apply. This Part needs no rig, audio, canon or chapter changes.

Part C validation: **1518 art checks passed**, 24 existing warnings; **55 content checks passed**; repository/review typechecks and unchanged audio/rig gates passed. Both three-scene cast-shot runs passed. The concurrent full Windows run reported **3776 passed, 12 failed, 9 skipped**: eight known CLI/CRLF failures and four default-timeout cases under load. All affected files plus environment/art-path checks then passed an isolated serial run (**138 passed**) without changing tests or timeouts. Field-guide regeneration after the Part B image-pointer correction is idempotent.
## Review follow-up — three-guest phone composition (2026-10-16)

Addressed #242's phone clipping finding: when two or three guests share the stage, the renderer fits complete figure canvases to their allotted slots using one common scale, preserving relative species sizes. A solo guest and the party-only lineup keep their existing scale. Nameplate width caps account for that scale and their debug bounds use the same transform. The six-person phone lineup necessarily has smaller figures; the committed `three-cast-phone-fixed.png` shows that density for human signoff.

The regular browser suite now includes a 390×844 phone regression with three actual Riftseeker figures and three heroes. It checks six rendered figure bounds inside the viewport and all six nameplates for collisions, then saves a screenshot. This runs in CI rather than only in the optional art capture helper. The targeted browser run passed (42.6 seconds). Cast/scene unit tests passed 42/42; repository and strict review-test typechecks passed. A pure regression also checks full canvas boundaries and separation with mixed species sizes at two stage widths. No tests or timeouts were weakened.

## Second review follow-up — readable narrow stages (2026-10-16)

The earlier scale-to-fit phone arrangement solved clipping but made the six figures and their names too small. It is superseded by guest paging below a 600px **pane** width: the three heroes remain full size beside one guest, with Previous/Next controls exposing every other guest. Wide stages still show the full cast. The pager follows the scene and resets when its cast changes; resizing restores the full cast or the selected guest without recreating WebGL. This is container sizing, never room-mode detection.

Long names wrap on narrow stages at the original type size instead of shrinking to fit a single line. Extra gutters separate the wrapped text blocks. The party is inset enough to keep its entire rig canvases inside the phone. The browser regression checks every guest page and backward navigation, viewport bounds, figure canvases at least 110px high and rendered font size at least 10px on a 390px phone, plus label collisions and wide/narrow resizing. The shared unit tests cover the compact rig margins. Earlier tiny composition fixtures are replaced with current paged captures; the additional phone guest images show each person rather than only the first page.

Merged current main into Part B, preserving its Skywarden cast additions and resolving the manifest conflict. The field-guide generator remains idempotent; 55 content checks pass. Cast/scene/nameplate unit checks: 57 passed. Repository and standalone review-tool typechecks pass. Capture logs and current phone fixtures accompany this change. Human visual/listening approval remains outstanding.
The final stricter phone regression passed (49.4 seconds), including all three guest pages, Previous, resize to 960px and return to 390px. All three cast-shot group runs also passed; their TV/phone/host and per-guest phone captures replace the earlier previews.
