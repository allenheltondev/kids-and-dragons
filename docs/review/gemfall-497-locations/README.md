# Gemfall remaining artwork — #497

This delivery fills all 45 location paintings left after the four-location pilot,
40 new story props, and 66 painted option IDs (52 new paintings, 14 documented
reuses). Together with the merged pilot and fight passes, the requested inventory
is 16 fight paintings, 49 locations, 46 unique story props and 27 option sets.

## Review by chapter

These sheets pair real 1920×1080 TV and 390×844 phone captures. They show the
location in the story's ready/idle state, before the interaction starts. Cast
figures remain separate from the scenery. The original full-resolution captures
are disposable Playwright output; these sheets are the retained review record.

| Chapter | TV and phone location sheet |
|---|---|
| 03b: marsh road | [Seven locations](gemfall-03b.webp) |
| 04b: forest road | [Forest locations](gemfall-04b.webp) |
| 05b: Mosshome | [Archive and bridge locations](gemfall-05b.webp) |
| 05c: boundary stones | [Tally house and bell house](gemfall-05c.webp) |
| 06: Ashfall | [Camp, wagon road and tea table](gemfall-06.webp) |
| 07h: collection pursuit | [Cabinet, boxes and hairpin](gemfall-07h.webp) |
| 07l: tether pursuit | [Table, choir, tea and sliding boxes](gemfall-07l.webp) |
| 07r: returning pursuit | [Stone chain, shelter and caravan](gemfall-07r.webp) |
| 08: finale | [Bell hut, cart and chimney](gemfall-08.webp) |

The [location ledger](../../../art/source/gemfall-497-locations.json) lists all
49 requested paintings and every use site. `delivered: true` marks the four
previously delivered pilot locations; every other row is created here. The
explicitly excluded existing backdrops and epilogues keep their prior art.

## Interaction art

[Story props on light and dark grounds](props.webp) are shown at 100px;
[option icons on both grounds](options.webp) are shown at 40px. All are RGBA
WebP with transparent margins. Story props use a 512×512 canvas with at least
24px margin; options use 256×256 with 16px margin.

The [eleven active TV/phone examples](../gemfall-497-interactions/active-interactions.webp)
show cooperation, balance, tracking, sequence, relay and play. Play buttons now
draw their existing authored `icon` field through the shared `Icon` component;
the control previously displayed only their labels. A test covers the painted
button, its unchanged action payload and continued operation after image failure.

Review follow-up: distinct wagon and rock covers now use Left/Middle/Right slot
labels consistently under the paintings, in the relaxed hint, and on answer
buttons. The paintings still move; the server still receives the same slot
indices. Tests use the shipped wagon/rock scenes through every swap and verify
their correct final choices in normal, relaxed and reduced-motion modes. The
two additional TV/phone examples show these positional labels.

All three contact-sheet generators share `art/source/review_font.py`: Segoe UI,
DejaVu Sans, macOS Arial, then Pillow's bundled default (including older Pillow).
The fallback was checked with platform fonts made unavailable.

The [prop ledger](../../../art/source/gemfall-497-props.json) gives every shared
use site; the pilot's straw hat is additionally retained. The
[option ledger](../../../art/source/gemfall-497-options.json) gives each ordered
option set and each reuse source. Hums/lullabies share the musical-note motif;
rumble cues share the mountain motif; note, boot and luckstone art are reused
where they already convey the requested idea. Three existing bells, acorn,
moon, flame and leaf are used directly. Nothing changes option IDs, labels,
answers, timings, reactions, clues or outcomes.

Story props use `presentation.interactions` and the existing warming/validation
pipeline. Timing paintings decorate the shared interaction, as the brief requests;
they do not introduce a different action-button system. Tracking covers retain
labels and a neutral fallback. An optional existing `props[0]` paints the sun
card only during the peek or relaxed hint, never during the shuffle.

## Source and revisions

All new paintings used the built-in `image_gen` tool. Original PNG exports remain
in the Codex generated-images directory recorded by each source entry. Pillow
only crops, resizes, packages and lays out review sheets. Locations are 1920×1080
WebP quality 88; story props are quality 88; option exports are quality 90 or
byte copies of already suitable reused paintings.

- [Location prompts, generation paths and hashes](../../../art/source/gemfall-497-location-generations.json)
- [Location correction prompts and exports](../../../art/source/gemfall-497-location-revisions.json)
- [Prop prompts, exports and hashes](../../../art/source/gemfall-497-prop-generations.json)
- [Prop correction prompts](../../../art/source/gemfall-497-prop-revisions.json)
- [All 52 option generation prompts and export paths](../../../art/source/gemfall-497-option-generations.json)
- [Final option sources, reuse decisions and production hashes](../../../art/source/gemfall-497-option-exports.json)

Corrections remove baked-in wisps, move Pellam's tea inside the stone citadel,
add the required wagon queues, replace unrelated floor-map objects with actual
clues, show forty cabinet stones, and replace decorative boxes with shipping
crates. The tall-grass prop also explicitly shows a creeping boot.

## Validation

`python art/source/audit_gemfall_497.py` verifies every location, prop and option
use against the ledgers and compares all chapter data with `origin/main` after
removing only `art`, `presentation` and option `icon` fields. The fourteen affected
chapter file hashes are deliberately re-pinned; gameplay digests remain unchanged.

The combined Gemfall/content/presentation/prefetch, icon-registry, interaction
and service-worker run passes all 128 tests. Typecheck and content validation
pass (117 checks; two existing warnings), and all 1,570 art checks pass.
The 13 production offline/cache/performance browser cases pass. One initially
lost its trace file because concurrent capture runs shared an output directory;
it passed when rerun with a separate output directory. The complete location
capture and eleven active-interaction capture also pass; play examples were
refreshed after the icon rendering fix.

The production bundle retains the existing 320KB first-paint and 1460KB total
caps. Repeated icon namespaces are built with a small prefix helper; bundled
assets and internal shared chunks use their existing content hashes without
repeating long source names. Dynamic entry names and named diagnostic/failure
boundaries remain readable. No browser support floor or gameplay changes.
After the tracking-label fix, the measured bundle is 320KB first paint and
1458KB total, within those unchanged caps.

Reproduce location captures with `npx playwright test -c
playwright.cast-review.config.ts e2e/gemfall-art-shot.spec.ts -g "chapter remaining"`,
then `python art/source/package_gemfall_497_review.py`. Use `-g "chapter interactions"`
for the active phone/TV examples. These are presentation captures using the
playtest jump, not a claim that every combat turn was replayed. Earlier fight
deliveries retain their introduction/outcome review records.
