# Wave 1 image prompts

Generated with the built-in imagegen tool. References are style references, not edit targets. Final assets: `packages/client/src/assets/painted/supper.webp`, `assets/biomes/open_sea/bg.webp`, `assets/biomes/the_whirlpool/bg.webp`. Backdrops are story-only; no tactical tiles or prop kits are implied. The Whirlpool is not declared identical to the Eastern Maelstrom.

## supper

undefined

## sea

Use case: illustration-story. Production Kids & Dragons environmental game backdrop, wide 16:9 1920x1080 composition. The Open Sea: open horizon, long ocean swells, no landmarks but light and weather. Beautiful expansive deep teal and blue ocean beneath a broad luminous partly cloudy sky, pale warm sunlight breaking through cloud banks, distant rain veil only far to one side. Hand-painted storybook gouache, rich softly textured colors, soft painterly highlights and warm inviting family-adventure mood, matching reference rendering only. Lower third visually quiet open water with broad gentle swells for overlay, clear distant horizon near upper half. No land, coast, islands, buildings, boats, people, animals, creatures, rocks, floating magical objects, whirlpool, text, border, UI or watermark. Ocean is ordinary water, not a magical being.

## whirlpool

Use case: illustration-story. Production Kids & Dragons environmental game backdrop, wide 16:9 1920x1080 composition. The Whirlpool: wide turning ring of dark ocean water, calm at its rim and loud at its center. Elevated oblique view from offshore, showing a broad natural spiral current in upper middle, concentric dark teal swells and white foam rotating into a modest shadowed depression. No bottomless black hole. Ocean horizon and softly clouded blue sky visible above. Lower third quiet open ocean at the calm outer rim, broad simple water shapes leaving space for gameplay overlay. Rich hand-painted storybook gouache texture and luminous painterly highlights match reference's rendering only; blue-green sea, restrained cream foam, natural warm daylight, family-friendly adventure, readable grand silhouette. It is a dangerous water current, not a creature or supernatural portal. No eyes, mouths, monsters, magic, glowing runes, people, boats, coastline, buildings, islands, text, border, UI or watermark.


## Using the backdrops in gameplay

A story scene may set `"art": "biomes/open_sea/bg"` or `"art": "biomes/the_whirlpool/bg"`. Both the player panel and shared world stage use this lookup. Existing chapters retain their authored scene illustrations and biome fallbacks. Cast images use `"figure": "cast/marda_thorn"`, `"cast/old_ossley"`, or `"cast/pib"`; entity figures keep `entities/<asset_id>`. The Supper Bundle is selected automatically by its existing `supper` item icon.

These ocean images are story backdrops. Combat continues to use the chapter biome and needs its tactical tiles; the new backdrops do not constitute ocean encounter kits. Wiki and gameplay read the same files under assets, but wiki entries do not automatically place characters or places into chapters.
