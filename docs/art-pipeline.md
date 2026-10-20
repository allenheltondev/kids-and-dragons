# Character artwork pipeline

Characters are finished transparent illustrations with subtle procedural breathing.
Rive rigs, split body parts, underpainting, and animation contracts are retired.

- Deliver one `assembled.png` per species/tier: RGBA, 1024 x 1024, feet at (512, 900).
- Class figures use the same contract, listed in `assets/manifest.json` under `figureVariants`.
  Their existing `assets/character-rigs/<class>/<tier>/<species>/assembled.png` paths are retained.
- NPCs and enemies remain single transparent cutouts. Opaque gear portraits remain portrait art.
- Review the finished image for seams, silhouette, and background remnants at gameplay size.
  Existing composites can be replaced in place with a polished single illustration.
- Run `npm run art:verify` for format, transparency, ground placement, and shared asset checks.
- Run `npm run art:inventory` to see missing finished illustrations.

Story and combat share a six-second breath of at most 0.8% vertical stretch around
fixed feet, with different phases per actor. Creation uses the same amplitude and
period in CSS. Reduced motion returns figures to their resting scale. Combat owns
travel, falls, numbers, targeting, sound, and spell effects independently of art.

Historical rig briefs and original source paintings may remain as reference. They
are not delivery requirements. Git history retains the retired rigs and parts.
