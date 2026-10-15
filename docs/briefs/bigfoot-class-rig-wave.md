# Bigfoot class rig wave

Starweaver Radiant/Mythic and Songkeeper Sworn/Radiant/Mythic reuse the canonical Bigfoot base anatomy and pivots byte-for-byte. Only costume, focus-stone and ear-chime layers are added. Source portraits and the golden motion baseline are unchanged. All five configs retain `underpaint: 0`.

## Correction after visual review

The first PR previews used imagegen costume extractions resized into separate bounding boxes. Those extractions reconstructed fabric and the resizing changed its proportions. In particular, Songkeeper Radiant acquired a cream neck fold absent from its approved portrait. Those five generated matte files have been removed from the deliverable.

The replacement pipeline, `art/source/package_bigfoot_portrait_layers.py`, defines ownership masks over the original 1254px gear portraits and samples their existing pixels. It applies one uniform scale and translation to each complete portrait; clothing and accessories are never independently stretched. Songkeeper fringe masks follow the original gold pixels, while focus-stone alpha removes the estimated navy backdrop. No garment or neckline is generated or repainted. The three class packaging entry points delegate to this pipeline. Reproduction requires Pillow, NumPy and SciPy, as does the existing anatomical recut tooling.

The visible Starweaver costume now draws above the mane, with its neckline mask retaining the open fur area. This keeps the original medallions visible without replacing the base anatomy. The Sworn Songkeeper ear chime follows the head; the other costume layers follow the torso.

An additional built-in imagegen extraction was attempted during correction and rejected because it still enlarged and redrew the shawl. Its prompt requested an exact registered cutout of only the existing shawl, medallion and three chimes, with the fur opening transparent and no cream fill, recentering, enlargement or reconstruction. That generated image is not a production input.

## Review artifacts

[Overview](../reviews/bigfoot-class-wave.webp) shows idle and attack for all five variants.
[Portrait comparison](../reviews/bigfoot-radiant-portrait-comparison.webp) shows the approved Songkeeper Radiant portrait beside its corrected rig.

Full idle, walk and attack sheets: [Starweaver Radiant](../reviews/starweaver-radiant-bigfoot-motion.webp), [Starweaver Mythic](../reviews/starweaver-mythic-bigfoot-motion.webp), [Songkeeper Sworn](../reviews/songkeeper-sworn-bigfoot-motion.webp), [Songkeeper Radiant](../reviews/songkeeper-radiant-bigfoot-motion.webp), and [Songkeeper Mythic](../reviews/songkeeper-mythic-bigfoot-motion.webp).

## Contour exceptions

The approved costumes hide different portions of the unchanged base seams. [Contour inspection](../reviews/bigfoot-class-seam-contours.webp) highlights the missing band pixels in pink: Songkeeper Radiant on the left and Starweaver Radiant on the right. They lie at the lower armpit silhouette, outside the existing torso, rather than at either shoulder pivot. Adding torso paint there would grow a slab into the natural arm gap.

- Starweaver Radiant `body/arm_l`: measured 97.4%, class-specific floor 97%.
- Songkeeper Radiant `body/arm_r`: measured 68.3%, class-specific floor 68%, replacing the base's 88% floor for the longer unobscured seam.

Both exceptions are explicit in the class seam files and reproduced by the packaging script. All other base exceptions are retained. Shoulder pivot checks remain at 98%; no global threshold or motion baseline is changed. Inspect these contours with the attack sheets during PR review.

## Deferred work

The Unicorn Radiant attempt exposed detached limb fragments inherited from its base masks in rendered walk and attack frames. It is not declared, wired or included. Other species need anatomical mask review under `docs/briefs/part-recut.md` before repeating the old split method. Bigfoot's base recuts are already complete in main.

## Validation

The corrected files were rebuilt and checked locally:

- Five seam checks pass with the two class contour exceptions above; direct duplicate-fragment checks pass for all five new sets.
- All 16 Bigfoot rigs reproduce assembled art at 100.00% at rest. Five new rigs rebuild byte-identically using the pinned CLI.
- Contract check: 71/71 rigs, 79 checks passed.
- Motion sweep: 208 clips measured, no hard failures. The 117 baseline-change notices concern existing rigs; the golden baseline is unchanged. The new variants' 65 clip hashes are not blessed into the baseline.
- Art check: 837 passed, three existing Bigfoot palette warnings.
- Runtime, config, unchanged-anatomy and manifest/config draw-order checks: 34 tests passed.

## Songkeeper Sworn shawl follow-up

The broad mask below Sworn's fringe retained a strip of the portrait's differently posed chest fur and several dark shadow flecks. That strip produced a stiff lower edge across the canonical torso. The Sworn-only mask now follows the gold tassels, excludes the arm/torso crease beside the pendant, and retains the one connected shawl-and-pendant component. No scale, placement, ear ornament, anatomy, or other variant changed.

[Before and after the boundary correction](../reviews/songkeeper-sworn-shawl-fit.webp) and the refreshed Sworn motion sheet show the resulting fit.

Removing the false fur strip exposes the original lower armpit silhouette. The Sworn `body/arm_r` band measures 85.2%; a class-specific 85% contour floor is proposed with the art, replacing the base's 93% floor for the longer visible seam. [The highlighted contour](../reviews/songkeeper-sworn-seam-contour.webp) shows the missing band outside the unchanged torso, not at the shoulder pivot. This is a third class-specific contour exception in this wave; global thresholds and base art remain unchanged.

Sworn follow-up validation: all 65 clips across the five Bigfoot Sworn rigs pass (39 existing baseline notices; baseline unchanged); five rest checks pass at 100%; the changed rig rebuilds byte-identically. The 34 regression tests, 71-rig contract check, direct recomposition, and duplicate-fragment checks pass. The 85% Sworn contour floor remains proposed for visual acceptance with the art.
