# Static figure cleanup

The 71 delivered base and class figures were screened at gameplay size on a dark
background. Three images received targeted repairs using the built-in image_gen
tool; the other 68 were left unchanged. This screening is not a claim that every
pixel of the remaining artwork is defect-free.

- Duskrunner Mythic griffin: closed the hood crown over stray head feathers,
  tucked protruding chest feathers beneath the cloak, and gave the tail a visible
  continuous connection clear of the cape. The user approved the chest candidate.
- Duskrunner Mythic kitsune: restored the clipped face silhouette, repaired the
  discontinuous cape and cutout holes, and separated the three tails from cloth.
  A follow-up revision shortens the rear cloak above the rump so no train wraps
  around or crosses the lowest tail. The short-cloak source is the installed
  version; the preceding cleaned source is retained as its edit reference.
- Thornguard Radiant griffin: repaired ragged extraction edges and small cutout
  defects, preserving its wood armor, tree emblem, folded wings, and visible tail.

The generated sources and prompts are retained here. Installation records include
source hashes and transforms. Runtime images remain at their existing
`assets/character-rigs/.../assembled.png` URLs. Normalization uses uniform Lanczos
resampling onto a transparent 1024px canvas with the lowest visible pixel at
y=900. The two later repairs retain the original figure height and horizontal
silhouette center; normalization adds no retouching or procedural animation.

Validation: `python tools/art/verify.py --strict` passed all 586 checks. The final
installed images were also inspected on a dark background at gameplay size.

The hood/tail candidate is the input to the approved chest correction, not a
second runtime figure. No rigs, layers, or new runtime code are introduced.
