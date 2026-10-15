# Continuous realm atlas

The map is one continuous realm canvas. Twelve region buttons focus areas of that
canvas; they no longer open isolated cropped sheets. The base fills the map pane,
so neighboring terrain replaces the old regional gutters. Native scroll handles
panning, with four zoom steps (1, 1.5, 2, 4). The party still marks the chapter's
canonical location; browsing does not move the party or discover anything.
The real Map tab offers **Atlas** and **Story trail** in Phone and Party Mode.
Region, zoom, route visibility/selection and scroll center survive switching to
the player controls or story trail. Navigation is local to this page's current
run/chapter and resets when either changes; it never changes authoritative state.

The unlabeled base is newly generated artwork guided by the original realm
painting. It has a three-level WebP tile pyramid. At close zoom, four separately
illustrated detailed sections appear over the base, with soft renderer transitions
at their outer edges. Tile boundaries inside every section come from one source
image, so they connect exactly. The continuous base remains beneath every section
and during tile loading. These are illustrations of canon, not survey geometry.

## Discovery labels and routes

Broad region names provide orientation. Named location buttons require a household
Field Guide discovery. They open the existing lore detail inside the map and return
to the same position and zoom. The new artwork contains no baked-in names.

At the closest zoom, a separate SVG layer shows the four existing canonical routes.
Solid lines identify mapped crossings; dashed lines identify approximate courses.
The route list supports selection and centering, travel modes, and a visibility
checkbox. Routes requiring an undiscovered settlement or named crossing stay hidden.
Route ids and topology come from canon. Route descriptions do not expose creator
notes or hidden truths. There are no invented routes through the shifting Woods.

`Route.map_path` is an optional strict object: `accuracy` is `mapped` or
`approximate`; `points` contains 2-256 bounded coordinates in the existing 0-1000
realm frame. It is independent of the label anchor and of travel topology. The
Exchange-Marsh approach remains approximate: the line is not a surveyed road,
safety promise, or a newly fixed path through the marsh. The two bridge courses
follow the illustrated crossings, not the older label-anchor coordinates.
No new lore taxonomy is needed.

## Sources and rebuild

- `art/source/realm-atlas-detail-v1.png`: unlabeled base master.
- `art/source/atlas-*-reference.png`: deterministic quadrant crops for generation.
- `art/source/atlas-*-detail-v1.png`: detailed generated section sources.
- `art/atlas/prompts.md`: base prompt, generation provenance and constraints.
- `art/atlas/detail-prompts.json`: exact prompts for each detailed section.
- `art/atlas/master.json`, `details.json`, `regions.json`: artwork source paths and
  editorial framing. Bounds are not biome borders or traversable polygons.
- `npm run art:atlas`: crop, downsample and encode source artwork. No upsampling
  adds artificial resolution. This writes tiles, overview and manifests.
- `npm run canon:world`: project names, descriptions, atlas manifests and routes
  into `content/world.json`. Public fields are explicitly copied.
- `npm run content:validate`: enforce references, bounds, native-level presence,
  level aspect/order, complete tile coverage, no overlapping tiles and asset presence.
- `npm run atlas:review`: isolated Chromium review on port 5175. Screenshots under
  `test-results/` include desktop, phone, route layer and detail sections.
- `npm exec playwright test e2e/atlas.spec.ts`: real-server integration covering
  both Phone and Party Mode, character creation, chapter discoveries, Map tray,
  live asset loading, routes, screen switching, scroll restoration and lore.
- CI rebuilds atlas manifests and verifies normalized source hashes in
  `art/atlas/build.json` before checking the generated world content. Hashes of
  text inputs are independent of checkout line endings.

The base tool output is 1331 x 1181 pixels. The detailed sources add native detail
within each quadrant; maximum zoom still enlarges finite raster artwork. More
zoom cannot reveal terrain that was never authored. Larger source images can be
substituted and rebuilt without changing route coordinates or the client contract.
Older content packs without `atlas` retain the earlier image/regional-sheet path.
Assets and content use the existing deployment; no additional mapping service.

## Further expansion

Add canon-approved local sites and anchors before placing new named landmarks.
Keep surface, underground and aerial geography distinct. A location cannot be
inferred from a creature's biome association: creature/person encounter pins need
a spatial discovery record. Shared party notes need household/run ownership,
persistence and removal controls distinct from canon. Local place maps, terrain
fog and free travel are separate gameplay work.
