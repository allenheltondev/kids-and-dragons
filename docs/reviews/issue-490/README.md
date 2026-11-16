# Hero maturity tiers: base and Starweaver wave

Part of #490. The owner approved all 36 paintings individually in Codex, including
the recovered Unicorn and Dragon base work. Ascendant, Starborn and Legendary show
maturity, wisdom and mastery after the first three tiers' power progression.
Manticore's mantle covers the entire rump in every new class figure.

Delivered: 18 base figures, their 18 derived portraits, and 18 Starweaver figures.
All have full-size WebP copies; untouched originals and exact prompts are retained
in the asset store and `docs/hero-maturity-prompts.json`.

Songkeeper, Duskrunner and Thornguard intentionally use the new base figures until
their class waves arrive. New opaque gear portraits are deferred; portrait surfaces
use the approved Starweaver cutout where available. All 36 new paintings include
reviewed main/accent/figure masks, so selected colors follow the hero into the new
maturity art. The temporary colored-Mythic fallback has been removed. The aura decision remains open;
this batch does not add an effect or alter effect behavior. Issue #490 remains open.

The 36 RGB masks were reviewed channel by channel and with main-only, accent-only
and paired color previews. The cleanup includes hand-bounded silver plumage,
Unicorn mane and far-leg repairs, Manticore nose exclusions, and protection of
Bigfoot's teal mantle. `docs/hero-maturity-mask-records.json` records their derivation.

[All 36 custom-colored paintings on TV](https://assets.kd.readysetcloud.io/sha256/1c/1cc6e43fae7c554954fce4060e6d718505a9840f2d4ae8e85dd4bccd31c47d03.png)
and [on a phone](https://assets.kd.readysetcloud.io/sha256/c2/c275eb7d40e952ae0b600cbc5b4f60bbba97f9bd05f3dbbc6f31507c28db58c2.png)
were rendered through the real CharacterPortrait/tinter components without browser
or asset errors. Regression tests protect the color regions and untinted landmarks.

Final local validation: 12,334 tests passed (27 skipped), 2,107 art checks passed,
inventory complete, asset verification clean, all 943 WebP copies current, typecheck
and production build passed. The full Windows suite used four workers and a 120s
per-test timeout after an earlier concurrent image-processing run hit timeouts.

## Visual review

Playwright reviewed the real CharacterPortrait and TransformCutscene components in
a temporary review harness, at 1920 × 1080 and 390 × 844 browser viewports. All 24
Mythic-to-Legendary Starweaver images loaded without browser or asset errors, and
before/after captures were taken for all three Manticore transformation boundaries.
This is browser viewport coverage, not a physical-device sign-off.

![Starweaver progression across all six species](https://assets.kd.readysetcloud.io/sha256/dc/dc5c2c8ec31699b00e70e8de96c16002a19241edf178c49e1f482827dd69c269.png)

[Phone Legendary transformation](https://assets.kd.readysetcloud.io/sha256/bf/bf9d0a49921c446f2359fb4cbcd217f2635777f9cf4d65d9df1c5812d651667c.png)
and [TV Legendary transformation](https://assets.kd.readysetcloud.io/sha256/27/27e434965a02d3f6403196f5fa4b0d01c001cf2f1643eb031b70a975e6ba038a.png).

The CharacterSheet already includes all seven tiers. Camp hero paint bounds were
remeasured so the new silhouettes fit their gear. Runtime tests cover each species,
new tier, delivered Starweaver path and undelivered-class fallback.

The PR's character-art gate still requires the owner to add `art-approved`; the
agent never applies that label.
