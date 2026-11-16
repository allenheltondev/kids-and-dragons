# Older hero mask audit

Audited 2026-11-15 against branch `codex/art-490-hero-tiers`, after delivery of the 36 maturity masks in c6b7fe77. This audit covers the **168 earlier masks**: 24 base figures, 72 class figures and 72 opaque gear portraits. The new Ascendant, Starborn and Legendary masks are outside this audit.

## Findings

1. **Whole-figure masks include portrait background between legs.** The Manticore portrait sheets show broad filled bridges beneath the body and between feet. In `assets/gear-portraits/thornguard/sworn/manticore.coat-mask.png`, for example, B includes background around the far feet and closes most of the leg gaps. This affects gold and sparkle specials, even when ordinary coat and mane colors look correct. The Manticore portraits need a silhouette cleanup, including the gaps under cloaks; retain actual fabric and remove the backdrop.

2. **Whole-figure masks fill the empty spaces around floating magical focuses.** A confirmed example is `assets/gear-portraits/starweaver/mythic/griffin.coat-mask.png`: B fills large areas between the crystal and its orbit rings. Similar coarse focus envelopes are visible in other Starweaver portrait sheets. Keep the crystal, rings and painted glow, but remove the dark backdrop between them. Check all 18 older Starweaver portraits when repairing this family; the audit does not assert that all 18 have the same defect.

3. **Coat selection leaks into gear and a companion.** In `assets/gear-portraits/thornguard/radiant/kitsune.coat-mask.png`, R catches portions of the circular shield rim, nearby gear details and small parts of the squirrel's paws. These visibly take the main coat color. Remove the gear and companion pixels from R, preserve the exposed fur, and retain both in B where they belong to the portrait figure. B also bridges the dark gap between the squirrel's ears.

These are semantic selection errors, not a general canvas shift. They require local correction rather than moving or rescaling all masks.

## Scope and verification

- Pulled the current asset lock before inspection.
- Ran `coat.mask_problems` at original resolution on all 168 masks using the manifest tolerances: **168 passed, zero structural errors**.
- Compared B with painting alpha for all 96 transparent figures: **exact pixel equality** on every figure.
- Visually inspected all 168 originals, main/accent overlays, cyan main-color previews and magenta accent previews in 18 species/family sheets.
- Inspected B and gold previews for all 72 opaque portraits in six additional sheets.
- Checked the findings above against original-resolution painting and mask crops.

The suspected Unicorn Mythic Songkeeper cape embroidery and Griffin Duskrunner Radiant ear were cleared by the close-up inspection. The Griffin Sworn crescent's opening correctly reveals recolored fur; its cyan interior alone is not evidence of a gear leak. Kitsune white tail tips taking the main fur color is intentional under the species contract. No broad defect was identified in the 24 base masks.

The current validators check dimensions, mode, coverage, containment and overlap. They cannot recognize gear or backdrop in opaque paintings, so a passing result does not clear these findings. The visual audit is not a guarantee that every individual edge pixel is correct.

## Local evidence

The audit left the paintings and masks unchanged. Review images and statistics are retained in ignored `staging/mask-audit/`:

- `<species>-base.png`, `<species>-class.png`, `<species>-gear.png`: original, part overlay and independent recolors.
- `<species>-figure.png`: portrait original, B and gold preview.
- `detail-manticore-thornguard-sworn.png`: background included between feet.
- `detail-griffin-starweaver-mythic.png`: background included inside the crystal's orbit.
- `detail-kitsune-thornguard-radiant.png` and `detail-kitsune-shield.png`: companion/gear selection errors.
- `checks.json` and `<species>-stats.json`: structural results and figure/alpha measurements.

Repair priority: clean the portrait B silhouettes first, then the confirmed Kitsune R spill. Review the corresponding transparent class figures beside any changed portrait, but do not replace their exact B/alpha alignment with an opaque silhouette estimate. Recheck independent main/accent colors and specials after each repair.
