# Issue 384: remaining Gemfall cast and group-action overlays

Delivered 14 transparent cast figures and 18 overlay PNGs using built-in `image_gen`.
Final game assets live under `assets/cast/<id>/assembled.png` and `assets/together/<move>/`.
The [prompt and source record](../../../art/source/issue-384/paintings.json) includes the
accepted generation filenames, prompts, corrections and portable source paintings.
The [export script](../../../art/source/issue-384/export.mjs) registers those paintings on
the required canvases; it does not generate the artwork.

![Fourteen cast figures on light and dark](cast.webp)

## Cast decisions and wiring

All figures have `heightCm` and `standing` stance in the manifest. Adult Burrowfolk use
`small_to_medium` because 95 cm is above the `small` band's 75 cm ceiling. The Bell Courier's
160 cm includes her pony, and the Stall Witch's 140 cm includes her hat. The Seal-Keeper is
1800 cm with explicit top overflow and a low resting head so the eyes and embermoths remain
visible. Its whole body is painted, including the wings that overflow the stage.

The masked singer is a Burrowfolk, adding a third people beside the existing bigfoot and
frogfolk choir figures; those figures remain in their scenes. The Warden Clerk is a
frogfolk with a stamp, distinct from Pellam's faun silhouette and quill. The Stall Witch
is also frogfolk, with the Witch Order's hat, herbs, bottles and bell charms, distinct from
Mother Thrum's bigfoot figure. The Brassbuckle colleagues share hats and expedition colors,
but differ in build, expression, spectacles and props. The runner is dark bay with a tied
braid and chest bandolier, distinct from Bracken's chestnut coat and saddle satchel.

165 cast entries across 14 Gemfall chapter files now use these figures. No narration,
choices, flags, checks or encounter data changed. Obsolete `size` overrides were removed
from the replaced figures. File hashes were re-taken with an explanatory comment in
`gemfall-compat.test.ts`; gameplay digests are unchanged.

## Stage review

The existing cast-shot harness was adapted temporarily to preview before/after pairs in
14 chapter-1 scenes on the real dev stack with three player contexts. This tests the stage,
true heights, framing and portrait paging; the chapter-1 narration and backgrounds are
review fixtures, not a playthrough of the characters' authored scenes. Browser ownership
now requires the TV to share the room opener's browser context. The temporary test was
removed after the successful run; the preparation script can recreate it.

The TV captures show both figures at once. Colossal figures overlap in that artificial
two-colossus arrangement; the phone pages isolate each one. The contact sheet above also
shows the complete accepted paintings independently.

| Figure | Entries | Height | TV comparison | Phone before | Phone after |
|---|---:|---:|---|---|---|
| Seal-Keeper | 50 | 1800 cm | [TV](seal_keeper-tv.webp) | [Before](seal_keeper-phone-before.webp) | [After](seal_keeper-phone-after.webp) |
| Brassbuckle scout | 17 | 95 cm | [TV](brassbuckle_scout-tv.webp) | [Before](brassbuckle_scout-phone-before.webp) | [After](brassbuckle_scout-phone-after.webp) |
| Brassbuckle recordkeeper | 17 | 95 cm | [TV](brassbuckle_recordkeeper-tv.webp) | [Before](brassbuckle_recordkeeper-phone-before.webp) | [After](brassbuckle_recordkeeper-phone-after.webp) |
| Relay Runner | 11 | 230 cm | [TV](relay_runner-tv.webp) | [Before](relay_runner-phone-before.webp) | [After](relay_runner-phone-after.webp) |
| Masked choir singer | 13 | 95 cm | [TV](masked_choir_singer-tv.webp) | [Before](masked_choir_singer-phone-before.webp) | [After](masked_choir_singer-phone-after.webp) |
| Bell-Code Expert | 8 | 70 cm | [TV](bell_code_expert-tv.webp) | [Before](bell_code_expert-phone-before.webp) | [After](bell_code_expert-phone-after.webp) |
| Gullet's Cousins (foreman) | 8 | 110 cm | [TV](gullets_cousin-tv.webp) | [Before](gullets_cousin-phone-before.webp) | [After](gullets_cousin-phone-after.webp) |
| Road-Warden | 7 | 230 cm | [TV](road_warden-tv.webp) | [Before](road_warden-phone-before.webp) | [After](road_warden-phone-after.webp) |
| Fishmonger | 5 | 280 cm | [TV](fishmonger-tv.webp) | [Before](fishmonger-phone-before.webp) | [After](fishmonger-phone-after.webp) |
| Road Boss | 5 | 250 cm | [TV](road_boss-tv.webp) | [Before](road_boss-phone-before.webp) | [After](road_boss-phone-after.webp) |
| Warden Clerk | 5 | 110 cm | [TV](warden_clerk-tv.webp) | [Before](warden_clerk-phone-before.webp) | [After](warden_clerk-phone-after.webp) |
| Rush/Muddy/Burrowfolk prospector | 11 | 95 cm | [TV](rush_prospector-tv.webp) | [Before](rush_prospector-phone-before.webp) | [After](rush_prospector-phone-after.webp) |
| Bell Courier and pony | 4 | 160 cm | [TV](bell_courier-tv.webp) | [Before](bell_courier-phone-before.webp) | [After](bell_courier-phone-after.webp) |
| Stall Witch | 4 | 140 cm | [TV](stall_witch-tv.webp) | [Before](stall_witch-phone-before.webp) | [After](stall_witch-phone-after.webp) |

Counts reflect this checkout after the later Gemfall rewrites, rather than the issue's older audit.

## Overlays

![All overlay states on bright and dark scenes, with TV and phone tokens](overlays.webp)

Each move has two 1600×360 bands and four 192×192 tokens, declared under
`togetherOverlays` exactly with the dimensions and state names from brief §7.3.
Bands have a clear top 90 rows and fading sides; tokens have a clear 62 px radius centre
and 8 px edge. Tokens use shape changes, no hands or feet, and no painted text. The export
registers the five painted tiptoe prints separately on a common circle so no print is cut
by the portrait hole. A star and a small helper circle distinguish the final two states.
The largest band is 221,112 bytes; the largest token is 23,490 bytes.

**Implementation status:** the approved group-action design from #360 merged in
[PR #361](https://github.com/allenheltondev/kids-and-dragons/pull/361), which changed the
design brief only. This branch includes that merge and current main (`efbc019c`). The
runtime, schema/types, `content:validate` gate and integrated art verifier/contact-sheet
support described by the brief are still absent from main. Accepting an authored
`together.move` requires implementing that approved design. This art delivery does not
enable group actions or opt gameplay checks in. The direct acceptance script below covers
all 18 files until those integrated checks land; #360 itself is already complete.

## Validation

- `python tools/art/verify.py`: **628 checks passed**.
- `node art/source/issue-384/verify-overlays.mjs`: **18 files passed** dimensions, RGBA,
  byte caps, clear regions, fades, nonblank/distinct states and centroid registration.
- `npm run content:validate`: **62 checks passed**.
- `npm run art:figures`: regenerated the committed height/stance table.
- Focused Vitest: canon, figure sizes and Gemfall compatibility: **62 tests passed**.
- Adapted Playwright cast-shot review: **1 passed**, all 14 figure comparisons, TV and phone.
- Full `npm test`: **4986 passed, 10 skipped, 3 failed** in unchanged tests:
  authoring-guide fenced-block parsing (CRLF sensitivity), `PlayerProfile` source parsing
  (CRLF-sensitive interface terminator), and Riftlight preview Ctrl-C process cleanup
  (20 s timeout on Windows). These tests and their input sources were not edited.
- Semantic comparison to HEAD: every non-cast chapter field is unchanged.
- `git diff --check`: clean.

Sources and prompts were made with built-in `image_gen`; no API/CLI fallback was used.
Review PNGs and HTML remain in ignored local `art/review/issue-384/`; the WebP review
images here are portable. `archive-review.py` encodes screenshots only, never game assets.
