# Gemfall scene illustrations

Six backdrops created with the built-in image generation tool. Production files live in
`assets/scenes/gemfall/`: 1920×1080 WebP, quality 88, about 3.0 MB total. Original generated
PNGs remain in the local Codex generated-images directory. Existing biome art is unchanged.

| Asset | Coverage |
|---|---|
| `sheeple-ridge.webp` | 02: ridge greeting, bigfoot welcome, cleverness check, copying and regathering |
| `hollow-gate.webp` | 03B: arrival at the Gate, hum, shard, route choice |
| `redspire-citadel.webp` | 06: ridge approach, citadel gate, shut-out rest |
| `facet-table.webp` | 06: truth table, whole truth, three readings, allies and pursuit decisions |
| `gem-gallery.webp` | 08: gallery entrance, moth road, bells, remains check, gallery rest, race |
| `seal-chamber.webp` | 08: Keeper's questions, verdict, seal decision, tether and Keystone checks |

These cover 39 scenes. `scene.art` uses an asset-relative id without an extension, such as
`scenes/gemfall/hollow-gate`. The client loads `/assets/<id>.webp` with the existing backdrop
fade and cover sizing. Encounters keep the chapter's biome backdrop and tile sheet. Scenes
without an illustration return to the biome, including epilogues: the incomplete seal should
not illustrate an ending in which it has been restored. Failed image loads fall back to the
biome, and late loads cannot overwrite a newer scene. Assets deploy through the existing
`/assets` pipeline, alongside chapter content and the client bundle.

The titan has no pictured form. The seal's light suggests movement beneath it while preserving
the campaign's mystery. There are no new NPC portraits or changes to encounter character art.

## Generation prompts

### Hollow Gate

Create a single landscape 16:9 fantasy game environment illustration for Kids & Dragons Gemfall. Painterly detailed storybook environment, soft brushwork, dimensional rocks and plants, rich teal-green twilight with warm restrained golden glows, family friendly age 8, mysterious not frightening. Subject: the Hollow Gate, a massive ancient closed stone arch standing in still shallow marsh water, worn undecipherable glowing runes carved into its stone (abstract marks, no readable lettering), tied knotted reeds surrounding its base, mist and enormous age, no view through the gate, no explanation of what it is. Foreground lower third is open gently lit water and muddy bank where character sprites can stand. Strong landmark in upper center, trees and reeds framing edges. No characters, no UI, no typography, no border. Full bleed production backdrop, visually clear center at mobile crop. Save the generated image.

### Redspire Citadel

Single wide 16:9 painterly detailed fantasy storybook game backdrop for children age 8. Redspire Citadel in Gemfall: a single tall black basalt watchtower on a ridge in volcanic foothills, every window angled upward toward the sky, restrained golden morning sunlight on black stone, distant smoking red mountain, warm ash-hazed sky, watch banners without symbols or lettering. Welcoming watchpost rather than evil castle. Tactile painted stone and soft cloud brushwork, polished game environment, rich warm gold and muted violet mineral palette. Upper two thirds landmark and mountain vista; lower third open stone approach for separately rendered character sprites. No people or creatures, no text, UI or frame; no weapons. Center readable in mobile crop.

### Facet table

Single wide landscape 16:9 painterly richly detailed fantasy storybook game illustration for children age 8. Gemfall clue table inside a friendly black basalt watchtower: worn wooden round table in upper middle of composition, scattered jewel facets in amber, teal, violet and blue, a large humming warm amber gem at center, open watch ledgers with indistinct marks not readable writing, hand drawn map diagrams, knotted cord and brass bell. Eight-sided broken seal diagram sketched on parchment makes the gemstone puzzle connection visible, but no labels. Cozy morning light from high tilted window, shelves in shadows, mineral dust, rich warm golden wood and cool stone. Slightly elevated camera, lower third open stone floor for separately rendered game sprites. No humans or creatures, no text, UI, border, weaponry. Emotional tone: satisfying discovery and wonder, polished dimensional painted environment.

Final edit, using the first table illustration as its reference:

Keep this painterly fantasy environment, lighting, camera, open foreground floor, jewel facets, central amber gem, ledgers, bell and parchment seal diagram exactly in spirit. One canon correction: replace the round wooden tabletop and wooden legs with a LONG RECTANGULAR STONE TABLE, thick dark grey basalt slab with stone supports, weathered but friendly. The wardens laid their watch ledgers on a long stone table. No readable text or characters. Keep 16:9 landscape composition.

### Gem gallery

Single wide 16:9 painterly detailed fantasy storybook game environment for Gemfall Kids & Dragons, family friendly age 8. Inside Mount Red Sky: spacious curved volcanic lava-tube gallery whose dark basalt walls glitter with blue teal and amber gem veins like fireworks frozen mid-burst. Small harmless fossil spirals and old bone shapes embedded flush in distant walls, no walking skeletons, no horror. Cool walkable floor in lower third, a gentle winding path centered into depth, orange glow from hidden fissures to sides, tiny embermoths like floating warm gold sparks, warm vs cool contrast, soft atmospheric painted rock details. Upper two thirds brilliant gem-lined gallery arch. Open uncluttered foreground for separately rendered sprites. No character, dragon, titan, typography, UI or border. Awe and discovery, not peril.

### Seal chamber

Single wide 16:9 painterly detailed fantasy storybook game backdrop, Gemfall Kids & Dragons, children age 8. Finale seal chamber beneath Mount Red Sky. Vast vaulted basalt cavern, in upper middle a large ancient circular octagonal mineral seal set into a raised stone dais, eight radial great facet sockets and a warm amber keystone at its crown. Seal visibly incomplete with vacant sockets and fine lines of restrained amber light suggesting something immense stirring beneath it, but DO NOT depict a titan or any recognizable creature under or above the seal; its identity remains a mystery. Floating mineral dust, teal and blue gem veins, tiny gold embermoths, luminous reflected light, awe and gentle tension not horror. Dais viewed at shallow frontal angle; lower third open dark stone floor for game character sprites. Rich warm gold against cool blue charcoal, dimensional soft painted brushwork matching a polished fantasy environment. No people, dragons, readable text, lettering, UI, border or weapons.

### Sheeple ridge

Generated with the built-in image generation tool and exported to `assets/scenes/gemfall/sheeple-ridge.webp` (1920×1080 WebP, quality 88). Wired into `scene_flock_ridge`, `scene_flock_bigfoot`, `check_flock_clever`, `scene_flock_copies`, and `scene_flock_scatters`; registered in `assets/manifest.json`.

Original scene brief from PR 131 was followed, with slate-blue felt wraps and sheep muzzles matching the current NPC artwork. The initial prompt is recorded in `art/source/sheeple-ridge-generation.md`; the final appearance correction used the existing sheeple trio as a visual reference and is documented in `art/source/sheeple-ridge-revision.md`.

## Validation

Content validation checks chapter schemas and scene graphs. Gemfall wiring tests check that
every referenced illustration exists and none is assigned to an encounter. Renderer tests
cover biome fallback and late-load cancellation; asset-path tests cover scene selection,
combat, epilogues, and mismatched chapter content. The original five backdrops were visually reviewed using the real WorldView at
1440×900 and a 390×520 phone-sized world pane.

The sheeple ridge was visually inspected for flock grouping, sheep-folk outfits, jackalopes, empty long grass, and an open foreground. Its WebP dimensions and format were verified; content validation and all 91 Gemfall wiring, flow, and field-guide reach tests passed.
