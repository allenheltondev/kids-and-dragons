# Bigfoot class rig wave

Built from main after PR #186. Starweaver Radiant/Mythic and Songkeeper Sworn/Radiant/Mythic reuse the reviewed Bigfoot base anatomy and pivots byte-for-byte. Only clothing, focus-stone and ear-chime layers are added. All five configs disable builder underpaint because the base layers already contain their own reviewed seam continuation. Source portraits are unchanged.

The source matte extractions use the built-in imagegen tool, with each approved gear portrait as edit target. Final selected outputs are saved as `art/source/mattes/starweaver_radiant_bigfoot_overlay.png` and `art/source/mattes/starweaver_mythic_bigfoot_overlay.png`. Packaging scripts fit the isolated clothing to the portrait bounds on the canonical stage and rebuild the assembled image; Rive files are built only with the pinned CLI.

## Starweaver Radiant extraction prompt

Precise-object-edit for game animation production. Input is an approved square portrait. Keep ONLY the teal-and-gold astral waistcoat/mantle clothing and the floating teal gemstone at upper right. Remove ALL character anatomy, ALL brown mane/hair, face, ears, arms, legs, body fur, leaves, shadow and navy background to genuine transparency. CRITICAL registration: do not crop, zoom, recenter, rotate or move any retained object; keep the same full square canvas and original pixel positions/proportions. Garment occupies roughly x=0.32..0.67,y=0.30..0.61 of full canvas. Gem occupies x=.68..78,y=.12..25. Keep visible garment stars, gold trim, medallions, pendant and edges exactly unchanged. Complete only the hidden upper neckline underneath the removed mane, continuing the same teal material naturally. No fur fragments, no character, no new ornamentation, no text. Output transparent full square canvas, mostly empty.

## Starweaver Mythic extraction prompt

Precise-object-edit for production game animation. Retain ONLY the existing teal-and-gold astral mantle/waistcoat with medallions and hanging pendant, and the floating teal gemstone at upper right. Remove ALL character anatomy, brown mane/hair including golden hair tips, leaves, face, body, arms, legs, shadow, sparkles and navy background to genuine transparency. Preserve full square canvas and original object positions, scale and perspective; no crop, zoom, recenter or move. Mantle roughly x=.33..65 y=.40..66, gem x=.68..79 y=.14..26. Preserve existing clothing patterns, edging and stars exactly. Complete only hidden neckline under removed hair with same teal fabric. No new ornaments or letters. Keep the garment shape large enough to retain the original gold outer trim and scalloped hems; no floating fur fragments.

## Deferred work

The attempted Unicorn Radiant split revealed detached leg fragments inherited from its base masks in rendered walk and attack frames, despite passing the original contract/rest/motion gates. It is not declared, wired or included in this wave. Diagnostic frames remain locally under `art/review/starweaver-radiant-unicorn-motion.png`. The other species need anatomical mask review and recuts under `docs/briefs/part-recut.md` before repeating the old split method. Bigfoot's base recuts are already complete in main.


## Songkeeper extraction sources

Generated using built-in imagegen and saved under `art/source/mattes/songkeeper_<tier>_bigfoot_overlay.png` for Sworn, Radiant and Mythic. Packaging: `art/source/package_songkeeper_bigfoot_rigs.py [sworn radiant mythic]`. These layers ride the torso, while the Sworn ear chime rides the head. The shawl fits are reviewed against the canonical rest pose and in walk/attack frames.

### Sworn

Precise-object-edit for production animation. Keep ONLY the existing gold-and-cream Songkeeper shoulder shawl with all its fringed tassels, central medallion and hanging chime. Keep the little gold ear ornament as a separate object at its original position. Remove all character anatomy, brown mane/hair, leaves, face, skin, body fur, arms, legs, shadow and gray background to true transparency. Preserve original full square canvas, object positions, scale, perspective and painted details. No recentering, zooming or cropping. Shawl occupies roughly x=.26..71,y=.29..57 of canvas, ear ornament x=.48..52,y=.18..33. Reconstruct only the hidden shawl neckline under removed mane using the same fabric. Preserve the approved chevron embroidery, gold edging, medallion and teardrop fringe. No extra ornaments, no fur fragments, no new instrument, no text.

### Radiant

Precise-object-edit for production animation. Keep ONLY the existing gold-and-cream Songkeeper shoulder shawl with all layered fringes, central paw medallion and three hanging chime tubes. Remove every bit of character anatomy, brown hair/mane, leaves, face, ears, skin, body fur, arms, legs, shadow and gray background to true transparency. Preserve the original full square canvas and original object position, scale, perspective and painted details; do not recenter, zoom or crop. Shawl occupies roughly x=.21..70,y=.25..58 of full square. Reconstruct only hidden neckline beneath removed mane, continuing the same fabric. Preserve exactly the existing chevron embroidery, gold edging, paw medallion, all fringe and all three tubes. No additional ornaments, no animal bits, no new instrument, no letters.

### Mythic

Precise-object-edit for production animation. Retain ONLY the existing richly embroidered gold/cream/leaf-green Songkeeper shoulder shawl, its teardrop fringes, green-centered medallion and the complete existing cluster of hanging chime tubes. Remove all character anatomy, brown mane/hair, golden fur tips, leaves growing in hair, face, ears, skin, arms, legs, body fur, sparkles, shadow and gray background to genuine transparency. Keep the original full square canvas and original object positions, scale and perspective; do not zoom, crop, recenter or move anything. Shawl occupies roughly x=.22..76,y=.28..62 of full canvas. Preserve original embroidery, leafy green motifs and gold trim exactly. Complete only hidden upper shawl neckline under removed hair using same cloth. No new ornament, animal bits, instruments, text or stray particles.



## Review artifacts

[Overview](../reviews/bigfoot-class-wave.webp) shows idle and attack for all five variants.
Full idle, walk and attack contact sheets: [Starweaver Radiant](../reviews/starweaver-radiant-bigfoot-motion.webp),
[Starweaver Mythic](../reviews/starweaver-mythic-bigfoot-motion.webp),
[Songkeeper Sworn](../reviews/songkeeper-sworn-bigfoot-motion.webp),
[Songkeeper Radiant](../reviews/songkeeper-radiant-bigfoot-motion.webp),
and [Songkeeper Mythic](../reviews/songkeeper-mythic-bigfoot-motion.webp).

The golden motion baseline is unchanged. Base anatomy, pivots, seam exceptions and source
portraits are unchanged. New garment fit and the previously hidden neckline continuation
need visual acceptance on these rendered sheets.

## Validation

- Five new sets pass the seam verifier using the unchanged base exceptions. Songkeeper Mythic's right-arm band is 55.4% against the base's reviewed 55% contour floor; no floor was lowered.
- All 16 Bigfoot rigs reproduce their assembled art at 100.00% at rest.
- All five new rigs rebuild byte-identically with the pinned generator.
- Contract check: 71/71 rigs, 79 checks passed.
- Bigfoot motion: 208 clips measured, no hard failures and no comes-apart warnings. 117 baseline-change notices concern unchanged existing rigs; 91 hashes are new to the baseline, including the 65 clips from these five new rigs; the golden baseline is not updated.
- Art verification for Bigfoot Sworn/Radiant/Mythic plus shared assets: 837 checks passed, three existing Bigfoot palette warnings.
- Runtime selection, manifest/config consistency and unchanged-anatomy regression checks: 34 tests passed. Full workspace typecheck and client production build passed.

- Full suite: 157 test files passed, 2,763 tests passed and one skipped (`npm test -- --maxWorkers 2`). The local guide file was normalized to LF for its existing fence parser; no guide content or test threshold was changed.
