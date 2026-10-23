# Riftlight figures (#433)

Built-in `image_gen` produced these 18 source cutouts from the approved species
and entity figures. `prompts.json` records the final prompts and generated paths;
`figures.json` records each runtime identity and height. The PNGs here are the
generated sources, not the registered runtime images.

`package.mjs` crops only transparent margins, proportionally fits the original
painting to the canvas, and registers its lowest point at y=900. It preserves
the generated alpha; no chroma key, repainting or recoloring is applied. It
also installs the manifest entries and creates the light/dark 120px review
sheet at `art/review/issue-433/contact.png`.

Run with Node and Sharp installed (or supply the path to a Sharp module):

```sh
node art/source/riftlight-433/package.mjs [path-to-sharp]
node art/source/riftlight-433/install-cast.mjs
npm run art:figures
```

The cast installer is based on PR #431. It preserves nameplates, carries the
new figures through their check scenes, and refuses a fourth cast entry.
It does not change narration, choices, flags, or graphs.

## Art decisions

- Separate green-cloaked island keeper and indigo-cloaked new keeper, so the two
  whale-road keepers differ. The temple keeper in sky-islands-arrival gets the
  same island-keeper figure as the later squall-temple visit.
- Yetis differ by build, hair, clothing and work props: slate, travel roll,
  guide rope, watch chime, reading slates and a student's songbook.
- The unnamed dock workers and fisher are frogfolk; the travelers are burrowfolk.
  These are local visual choices, not additions to the creature canon. The
  student is explicitly frogfolk and the memory readers are yetis.
- The ordinary gull is a `stageFigures` entry at `entities/quay_gull`, following
  the donkey/pony convention. It is not falsely declared to be a mythical
  people's `basis` just to fit `castFigures`.
- The allied wyrm remains recognizably a frost wyrm, with a relaxed protective
  curl instead of the hostile figure's attacking pose.

## Intentional limits

- Stuttering Flats explicitly calls its rescued goat an **adult, not the kid**.
  Its original snowhorn-goat art stays. The small goat in `glimpse_2` is in a
  background herd and the three cast slots are already occupied.
- The finale's two successful epilogues already cast the watcher, Orin and
  Seren. The goat asset is delivered and used in the loss epilogue; adding it
  to the other two needs an authored scene split or a change to the cap. This
  art pass does not hide an existing cast member to make room.
- Convergence already marks all seven requested rift scenes with `rift:
  open/steady`. The dedicated stage effect is the opening; it does not consume
  a character slot or need a new PNG.
- Variant-only characters are not forced into a scene's unconditional cast.
