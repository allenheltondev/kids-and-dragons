# Live stage review

The retained images exercise the real story renderer, height table, backdrop
loading and phone layout. A temporary copy of `e2e/cast-shot.spec.ts` applies a
scene-to-art/cast map to client-fetched Gemfall review fixtures and opens the TV
in the host's authenticated browser context. It does not alter authored narration
or claim to be a Riftlight playthrough. The temporary spec is removed.

The 15-setup run produced all 45 TV, watcher-phone and host-phone PNGs, then timed
out at five minutes while closing contexts/traces (including a truncated trace
error). That is a capture-tool limitation, not a clean test pass. After review,
the crow flock's total pose height changed from 45 to 80 cm so its front-row birds
read at about 48 cm each. A focused Bellow/herder/crow retry **passed in 1.5 minutes**.
The retained images for those three setups are the successful retry's current
captures. The earlier first-batch two-scene run also passed.

[Capture map and fixture context](stage-captures.json).

| Figure | TV before | TV after | Phone before | Phone after |
| --- | --- | --- | --- | --- |
| Master Dunnick | [Before](stage-dunnick-before-tv.webp) | [After](stage-dunnick-after-tv.webp) | [Before](stage-dunnick-before-phone.webp) | [After](stage-dunnick-after-phone.webp) |
| Professor Nettle | [Before](stage-nettle-before-tv.webp) | [After](stage-nettle-after-tv.webp) | [Before](stage-nettle-before-phone.webp) | [After](stage-nettle-after-phone.webp) |
| Aunt Bellow | [Before](stage-bellow-before-tv.webp) | [After](stage-bellow-after-tv.webp) | [Before](stage-bellow-before-phone.webp) | [After](stage-bellow-after-phone.webp) |
| Yeti herder | [Before](stage-herder-before-tv.webp) | [After](stage-herder-after-tv.webp) | [Before](stage-herder-before-phone.webp) | [After](stage-herder-after-phone.webp) |
| The crows | — | [After](stage-crows-after-tv.webp) | — | [After](stage-crows-after-phone.webp) |

| Backdrop | TV | Phone |
| --- | --- | --- |
| Wrong Valley | [View](stage-wrong-valley-tv.webp) | [View](stage-wrong-valley-phone.webp) |
| Convergence Ledge | [View](stage-convergence-ledge-tv.webp) | [View](stage-convergence-ledge-phone.webp) |
| Wyrm Nest | [View](stage-wyrm-nest-tv.webp) | [View](stage-wyrm-nest-phone.webp) |
| Bone Yard Ruins | [View](stage-bone-yard-ruins-tv.webp) | [View](stage-bone-yard-ruins-phone.webp) |
| Singing Hall Camp | [View](stage-singing-hall-camp-tv.webp) | [View](stage-singing-hall-camp-phone.webp) |
| Island Due Back | [View](stage-island-due-back-tv.webp) | [View](stage-island-due-back-phone.webp) |

Dojo, Academy, Conservatory, Singing Hall and Rookery are visible behind their
corresponding teachers above. Captain Thimble's stage review is retained in the
[first-batch record](README.md). All 21 cutouts are also reviewed at a 120 px
visible height on [light](figures-120-light.webp) and [dark](figures-120-dark.webp).
The 15 hero variants have static review and renderer lookup tests; these captures
do not claim to show a live Sworn/Radiant party.
