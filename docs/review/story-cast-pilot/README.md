# Story cast pilot review

The pilot adds Coralie Fenn, Great-Gran Ashby, and Pellam. All use medium scale.
Ashby was corrected after review to exactly four legs (one raised foreleg,
one planted foreleg, two hind legs); her after-captures show the corrected figure.
Art verification: **734 passed**, no failures. Content validation: **55 passed**.
Each figure is 1024×1024 RGBA with real alpha, minimum margin 81px, feet at y=900.
Chapter scope comparison: exactly 42 cast figure replacements; all other fields identical.

Captured at 1920×1080 (TV) and 390×844 (phone) through the real app using a local
copy of `e2e/cast-shot.spec.ts`. A temporary review campaign starts each chapter
at index 1 without its route prerequisite. Scene content and biome are unchanged.
See the [generation and capture notes](../../campaigns/gemfall-illustrations.md#cast-figures--story-stage-pilot).

The phone renderer crops party members and long labels; in the longer Pellam scene,
the cast also reaches beyond the right edge and labels overlap the narration.
Left-party clipping is visible before and after. Replacing the large squad stand-in
with the required medium individual exposes additional right-edge clipping in the
Pellam capture. Fenn and Ashby read clearly; Pellam needs a renderer adjustment
owned by the code work before this pilot can be approved on phones.
This art PR preserves the required medium scale and does not change layout.

## Madame Coralie Fenn — Gemfall 1, choice_ember



## Great-Gran Ashby — Gemfall 5C, scene_tallies



## Pellam — Gemfall 5A, scene_clerk


