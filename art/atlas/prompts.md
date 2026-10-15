# Atlas image generation

Built-in `image_gen` was used. The original `assets/world/realm_of_red_sky.webp`
was the base geography/style reference, not an asset to overwrite. The selected
base was copied to `art/source/realm-atlas-detail-v1.png`. The output's actual
native size is 1331 x 1181, despite the larger resolution requested below.
Quadrant references are deterministic crops of that selected base. Exact detail
generation prompts are saved in `detail-prompts.json`.

## Exact base prompt

Use-case: stylized-concept. Create a production game atlas master image based on reference image 1 (geography and painterly style reference). Generate at highest available native resolution, ideally 4096 pixels wide or more, near-square landscape aspect 1400:1243. A richly detailed, hand-painted bird's-eye fantasy map for children, terrain continuous across the entire canvas, no panels, borders, parchment title, compass, labels, words, lettering, symbols or map UI. Keep the reference's exact relative geography and coastline silhouettes, landmark positions, proportions and overall framing. All coordinates below normalized x/y 0..1000, origin top-left. Do not rearrange geography to make a prettier composition. Northwestern floating Sky Islands x165 y235; northern barren layered rocky plateau Expanse x470 y75; northeast glacial mountain source x805 y85, snowy Frostfang range x825 y275. The Great River runs from x720 y105 down through x690 y240, x655 y390 northern bridge, x650 y520, x630 y680 southern bridge, x645 y780 to x625 y900 sea mouth; its westward branch flows near x390 y590 into the western sea. Central volcanic Mount Red Sky at x465 y325, lava dark ochre foothills x440 y410. Ancient responsive forest Enchanted Woods x220 y395 in west-center with enormous layered trees, glowing blue-green hollows, tangled roots, mossy clearings and sparse indistinct paths; MossHome forest settlement at x115 y525, maintained living timber/stone architecture with suspended walkways, moss gardens and warm windows. Plains x455 y520 center, Sunward farm fields x470 y690 southwest-center, Eastern Plains x750 y445 east of river, marsh x205 y660 southwest of forest, coastal trade city Exchange x350 y855 southwestern coast. Stone Crossing bridge near x630 y680 is the only southern river crossing; northern bridge near x655 y390 is the only northern crossing. Remote skull-like sea cave island x945 y370. Southern southeast Sallow Wastelands x800 y840, bone-strewn river delta Bone Yard x875 y805. Coral/reef Mermaid Cove island x690 y925, eastern offshore maelstrom x950 y625. Surface only, no invented underground entrances, no invented villages, no characters. Make the terrain legible and detailed at close zoom: individual tree crowns, roots and rock strata, terraced fields, city rooftops, small watercourses, shore shallows and reef texture, believable geographic transitions. Preserve two canonical bridge crossings and existing city/forest settlement landmarks. Do not paint named routes or arbitrary new bridges: interactive route strokes will be drawn by application code. Remove ALL text and scrolls from reference and fill them with plausible continuing terrain. Use lush deep emerald/teal forest, warm ochre fields, icy blue-white peaks, orange ember volcano, deep blue sea. Crisp detailed illustrative cartography, no photographic terrain, no blank areas, no gutters. Single continuous master so all tile boundaries align exactly.

## Cartographic review

Prompts guide illustration; they do not override canon. The base prompt's bridge
positions initially used approximate label anchors, and the marsh framing used
an illustrative center. Runtime labels retain canon anchors (Whispering Marsh
225,620), and the route `map_path` courses were traced to the illustrated bridge
positions. Approximate route courses retain their explicit accuracy marker.
Detail section edges transition over the shared base in CSS rather than claiming
independently generated paintings have identical border pixels.
