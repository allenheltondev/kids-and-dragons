# Runtime art audit — 2026-10-23

The initial inventory check established that commissioned files existed. It did not establish that screens actually used them. This follow-up inspects the runtime URL builders, authored content, rendered Field Guide pages and the renderer-failure experience.

## Missing art fixed

19 of the 67 published Field Guide entries had no `art` field and showed a generic category icon even though suitable artwork already existed:

- Creatures: Loftmire.
- Peoples: Sheeple.
- Folk: Marda Thorn, Old Ossley, Pib.
- Factions: The Skywardens, The Deep Hollow Cult.
- Places: The Open Sea, The Sallow Wastelands, The Bone Yard, Bramblewood, The Exchange, The Hollow Gate, MossHome, Mount Red Sky, Redspire Citadel, Skullwater Cave, Stone Crossing, The Whirlpool.

The generator only considered species, biomes with explicit asset IDs, creatures and peoples. It now resolves delivered art using the canon slug when no asset ID exists; supports locations, individuals and factions; and prefers the existing portraits. Hollow Gate uses its authored scene painting. The Cult uses its existing cult-member illustration rather than inventing a new faction emblem. These generated entries also feed map-place cards and discovery announcements, so those experiences gain the same art.

The `song` icon in Riftlight's glacier-survival choices was not registered, so it silently rendered the neutral unknown glyph. It now resolves to the painted musical note. The source scan found no other unknown authored content icons. Creation's pre-selection `unknown` glyph is intentional.

Landscape paintings in Field Guide cards/details were contained inside square/arched portrait frames, reducing them to thin strips. Place illustrations now fill those frames; character cutouts retain their contain layout.

The still-image fallback used when WebGL/Pixi fails drew party and enemy art, but omitted story guests and scene rifts. It now draws resolved scene cast (including split ensembles) and a still frame of a visible neutral rift. The fallback also positioned the party underneath the narration and centered guests on the rift; its figures now occupy separate left/right spaces above the story panel. Collapsed rifts stay absent. No animation or character-only Riftlight information is introduced there.

## Checks beyond the inventory

`e2e/runtime-art.spec.ts` derives URLs from actual content and the same helpers used by the application, rather than trusting the manifest's delivery counts. It checks scene paintings, cast references, encounter art, every species/class/tier portrait and world figure combination, campaign covers, prologue/chapter plates, world-map image/tile references, entry-screen variants, effect sheets, and images imported or referenced by UI stylesheets. Browser `Image.decode()` catches failed delivery and invalid images, not merely missing files on disk. The actual Vite-served `hasIcon` function checks authored content icon names.

The rendered-guide check opens every one of the 67 discovered entries on a 390×844 phone and 1024×768 tablet. It verifies an image with that entry's own art URL is visible and loaded. Discoveries are test fixtures only; normal play's discovery gates remain intact.

A separate browser scenario forces the animated renderer to fail, then verifies the still stage loads story cast art and shows the scene's rift. Component tests cover the same behavior and prevent published guide entries from silently reverting to category glyphs.

## Validation results

- 746 distinct runtime image URLs successfully decoded in Chromium, including all referenced scene/cast art, character variants, UI images, map images and effect sheets.
- All 67 discovered guide entries rendered loaded art at both phone and tablet sizes (134 entry views).
- All 3 runtime-art browser scenarios passed. The still-stage scenario passed again after correcting figure placement.
- 39 targeted component/generator tests passed, including the fallback renderer and guide-art coverage.
- Client TypeScript check and production build passed.
- [Reviewed still-stage tablet screenshot](still-stage-tablet.png).

## Boundaries

These checks validate all referenced image sources and every published guide detail, not the visual composition of every branch of every campaign. A same-name file can still be artistically wrong, and untagged scene art cannot be detected from a URL alone. Existing scene/cast composition tests and manual story reviews remain relevant. Empty undiscovered cards, unavailable campaigns, basic navigation SVGs and the creation silhouette before choosing a species are intentional; they are not counted as missing commissioned paintings.
