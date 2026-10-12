# Home and hero-making scenes

Eight scenes in landscape and portrait orientations generated with the built-in image tool, based on the existing creature
designs and the Exchange's painted environment. Full generation prompts are saved in
[entry-scenes-prompts.json](./entry-scenes-prompts.json) and
[entry-scenes-portrait-prompts.json](./entry-scenes-portrait-prompts.json).

Bigfoot correction: all fourteen scenes containing Bigfoot were edited with the approved
`assets/characters/bigfoot/fledgling/assembled.png` as a direct identity reference. Cream fur
covers torso, arms, and legs; brown hair forms the swept hairstyle and beard/neck mane.
Tan face, hands, large flat feet, and natural upright proportions follow the character art.
The scene activities, props, open control area, and both orientations were preserved.
The two appearance scenes contain no Bigfoot and were not changed. Exact edit prompts:
[entry-scenes-bigfoot-prompts.json](./entry-scenes-bigfoot-prompts.json).

Production images are 1920×1080 landscape and 900×1600 portrait WebP under `assets/scenes/entry/` and declared in
`assets/manifest.json`'s `sceneIllustrations` inventory.

| Screen or step | Illustration |
|---|---|
| Home | `home-market`: gem stalls, arriving griffin, kitsune with a map |
| Species | `creation-species`: creatures meeting in a green courtyard |
| Class | `creation-class`: ward practice, balance platforms, a hand drum |
| Stats | `creation-stats`: stones, puzzles, rope course, watching a moth |
| Appearance | `creation-appearance`: ribbons, scarves, and natural pigments |
| Name | `creation-name`: a token and blank pennant in a lantern courtyard |
| Waiting lobby | `lobby-waiting`: tea, maps, and packing at a roadside camp |
| Everyone ready | `lobby-ready`: a sunrise departure toward the northern road |

`EntryScene` provides a decorative, noninteractive background. CreationFlow and
CreationPreview follow the local draft's five steps. LobbyContent and the lobby controller
switch to the departure image when the party is nonempty and every character is ready;
unreadying returns to the camp. Party Mode phones show their own creation step; the shared
TV continues to show the room's lobby, because drafts are not transmitted to other devices.

Controls keep their existing panels. Home uses a fixed viewport-covering backdrop, so
scrolling through Start, Join, and account controls never runs past the artwork. The old
natural-height image and short-header fade have been removed. A picture source selects
the dedicated portrait composition for portrait or square viewports; landscape windows use
landscape. All surfaces use centered cover sizing rather than stretching. Failed portrait
loads return to landscape before falling back to the plain background.
Desktop lobby cards are constrained to the center so creature activity remains visible at
the edges. No viewport sizing is introduced inside WorldView or PlayerView. Animation is
disabled for reduced motion, decoration is hidden from accessibility APIs, and missing images
leave a dark fallback without affecting controls.

Validation: visual review of all five creation steps and both lobby states at desktop and
390px phone sizes, the real home page at its in-app size and at 390×844 including scrolling
to the account controls, image declarations/existence, readiness
selection, image-error recovery, existing screen/character/controller tests, typecheck, and build.
