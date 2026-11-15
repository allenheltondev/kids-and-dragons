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
use the approved Starweaver cutout where available. New coat masks are deferred,
so heroes without custom colors draw in their approved colors. Heroes with a
selected coat or accent temporarily keep their colored Mythic painting until the
new painting's mask ships; the fallback retires automatically per painting. The aura decision remains open;
this batch does not add an effect or alter effect behavior. Issue #490 remains open.

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
