# Issue 170: Gemfall expansion cast review

Nine left-facing transparent figure assets for eight characters, declared in `assets/manifest.json` and wired into five Gemfall chapters. The [brief audit](../../briefs/story-cast-art.md#9-gemfall-expansion-cast-audit--issue-170) lists every named stand-in found, the visual briefs, existing expansion deliveries and the remaining occupational/group figures. [Prompts and references](../../campaigns/gemfall-illustrations.md#issue-170--remaining-expansion-speakers-2026-10-15) record the built-in image-generation calls.

![Eight new cast figures](https://assets.kd.readysetcloud.io/sha256/83/832295482778245f44d93a6d8f5d2cc0029b6b5067b0ddba5359e3667b2e00b8.webp)

## Figures

| Figure | Basis | Scale | Cast entries |
|---|---|---|---|
| Odo | burrowfolk | medium | 5 |
| Corbin (on foot) | burrowfolk | medium | 1 |
| Posy (on foot) | burrowfolk | small | 1 |
| Corbin carrying Posy | burrowfolk | very_large (combined height) | 4 |
| Rook | burrowfolk | medium | 5 |
| Selkie Grandmother | selkie | medium | 5 |
| Path-Keeper | bigfoot | large | 3 |
| Young Gatherer | dragonling | small | 4 |
| Courier Griffin | griffin | medium | 4 |

The boulder claimants gain ten cast entries across five scenes: a Burrowfolk Claimant and a Faun Claimant using distinct existing species figures. Linnet is restored to the scouts' fib scene. Total: 43 entries added or replaced. Odo's barrow, the path-keeper's book, and the courier's sack belong to their cutouts; no existing species art was replaced. Posy rides on Corbin’s shoulders in all four introduction scenes; their separate figures are used for the later downhill reunion on foot.

## Before and after

Each comparison puts **before on the left, after on the right**, with a 1920x1080 TV capture above a 390x844 Travel Mode phone capture. Original PNG captures remain in local `art/review/`; these committed WebP sheets keep the review portable.

Captured twice with the existing `e2e/cast-shot.spec.ts` against the real dev stack and three player contexts. For convenient visual review, a temporary content tree copied the six later-chapter scenes into chapter 1, preserving their narration and cast and replacing their outgoing choices with a review Continue. Consequently those six captures show chapter 1's heading and default Exchange backdrop; they verify the figures, standing line, labels and phone/TV framing, not the later chapters' environments or playthrough. The two chapter-1 scenes use their authored backgrounds. This fixture and its temporary Playwright config are not production changes.

| Scene | Characters | Comparison |
|---|---|---|
| `gemfall-01:scene_newcomers` | Selkie Grandmother | [TV + phone](https://assets.kd.readysetcloud.io/sha256/36/36c4e13a005ae0eee1c38bee056afa79bdc1665867047dbde0beccb9beecdfc8.webp) |
| `gemfall-01:scene_griffin_post_feed` | Courier Griffin | [TV + phone](https://assets.kd.readysetcloud.io/sha256/5e/5e789e76504f13135c8ea3845126103cd54e632f3e0733e034ceb6c89001b885.webp) |
| `gemfall-05b:scene_halfway_hut` | Path-Keeper | [TV + phone](https://assets.kd.readysetcloud.io/sha256/1e/1e5fd788767d70d54b3a5058debfa0b020ce9cd50b513ac5e7ec52fe9902bf0f.webp) |
| `gemfall-05b:scene_cloud_gatherer` | Young Gatherer | [TV + phone](https://assets.kd.readysetcloud.io/sha256/9d/9d2fa84a5e5da101ee9dbbd99f6b6c39aa89074e01c969e46e756fdcec77164a.webp) |
| `gemfall-06:scene_claim_boulder` | Both claimants | [TV + phone](https://assets.kd.readysetcloud.io/sha256/8e/8e7f529f824562bac83618241e218b73fa33eae32051fef53aa46bf36fb347a1.webp) |
| `gemfall-07r:scene_glitter_barrow` | Odo | [TV + phone](https://assets.kd.readysetcloud.io/sha256/73/73c84a3301745056069dfd5c4bb352ae1925885fb8cf49e1894a53363c8c04ec.webp) |
| `gemfall-07r:scene_posy` | Corbin and Posy | [TV + phone](https://assets.kd.readysetcloud.io/sha256/56/566e2bed15a2733e3a1e3785de8382e93dfb3ace6753d7cf4b97d075eb778445.webp) |
| `gemfall-07l:scene_two_scouts` | Linnet and Rook | [TV + phone](https://assets.kd.readysetcloud.io/sha256/95/95124770d2008d83a62214ddde3854c65b8d5218cdbcce23da21ff2406f8dc4b.webp) |

## Validation

- `npm run art:verify -- odo corbin posy rook selkie_grandmother path_keeper young_gatherer courier_griffin`: **749 passed**, including shared effects and gear. Each new figure passes basis, RGBA canvas, alpha/margin and feet at y=900.
- `npm run content:validate`: **55 passed**, including figure-file resolution.
- `npm test -- packages/client/src/world/cast.test.ts packages/client/src/world/art-paths.test.ts`: **31 passed**.
- `npx playwright test -c cast-review.local.ts`: **1 passed before, 1 passed after**, eight scenes each, TV and phone screenshots.
- Semantic comparison with the original chapter JSON: every scene field except `cast` is identical.
- `git diff --check`: clean.

Allen approved the original character designs; the shoulder-riding variant addresses the subsequent continuity feedback. Remaining generic role figures are explicitly catalogued in the brief; this delivery completes the named recurring expansion speakers requested in #170.

## Continuity follow-up and main update

Merged main at `ab97f082` without conflicts. The updated PR includes every commit from that main revision. The introduction now uses `cast/corbin_carrying_posy` in all four scenes; the downhill reunion still has separate figures. No narration or mechanics changed.

[Shoulder-pose correction, previous versus corrected TV + phone](https://assets.kd.readysetcloud.io/sha256/37/379378bd4c09c16704eaa478d5c3ae40394629be3d6049371dd79e4703b18454.webp). The introduction comparison above is refreshed with the corrected pose. [The downhill reunion remains on foot](https://assets.kd.readysetcloud.io/sha256/eb/eb92275e2db8c7104fd19298dd1edb6c19d6d3edf8cc840fde9c198cc5a5bc11.webp). These captures use the same review-only chapter-1 fixture described above, with an additional pause for the phone's entrance animation.

Validation after merging main and adding the pose:

- `npm run art:verify -- corbin_carrying_posy`: **728 passed**, including shared effects and gear.
- `npm run content:validate`: **55 passed**.
- `npm run typecheck`: passed.
- Full unit suite: **2665 passed, 1 skipped**, with one existing Windows CRLF-sensitive authoring-guide test failure. Neither that test nor its guide differs from main. Normalizing the guide's local line endings made its six tests pass; the guide normalization is not part of this PR. The targeted rerun of that file plus cast/art-path tests passed **37 tests**.
- TV and phone review captures passed for both the introduction and the downhill reunion.

After main advanced again, merged `ab97f082` (phone interaction feedback). Content validation still passes (55 checks); the new phone interaction tests plus cast/art-path tests pass (36 tests).
