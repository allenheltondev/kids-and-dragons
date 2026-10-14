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

## Cast figures — story-stage pilot

Generated with the built-in image generation tool on 2026-10-14, using the existing
merfolk, fledgling dragonling, and Skywarden assembled figures as visual references.
Production files are `assets/cast/<id>/assembled.png`: 1024×1024 RGBA with true alpha,
three-quarter left, no ground shadows, baseline y=900. All three use `medium` scale.
Generated outputs were 1254×1254; packaging crops to the alpha>128 figure bounds,
uniformly fits within 940×820, horizontally centers, and places the bottom at y=900.
No painting, alpha removal, recoloring, or replacement of existing art was used.

| id | basis | scene references | design |
|---|---|---|---|
| coralie_fenn | merfolk | 13 | Blue merfolk in a barrel on wheels, waving, holding her green book |
| great_gran_ashby | dragonling | 14 | Faded ivory-green scales, elongated elder muzzle, rust shawl, walking stick |
| pellam | faun | 15 | Individual faun clerk in silver/violet Skywarden uniform, ledger and quill |

Pellam is a faun because the existing mixed-order illustration already includes a
faun, whose upright anatomy accommodates the ledger without inventing human people.
The brief requests `basis: skywardens`, but the verifier accepts only manifest
entities/species and Skywardens are a faction rather than a manifest entity. The
actual species `faun` passes that contract; his order remains visible in the uniform.
Ashby's near forepaw rests on the walking stick, with the other three feet planted;
this is a relaxed walking-stick gesture rather than the rigging source pose.

### Coralie Fenn generation prompt

Create a NEW game cast figure, using the supplied merfolk image as species and house
illustration reference. Madame Coralie Fenn: cheerful mature merfolk gem buyer, blue
turquoise skin, fin ears, dark ocean blue hair, fish tail, riding upright inside a
handsome wooden barrel on four small wheels. Tail belongs inside barrel, no legs.
One hand waves toward viewer left, other holds a little closed green book without
writing. Warm crafted storybook painting with hand drawn brown outlines and controlled
soft cel shading, simplified readable silhouette, family friendly. Full single
character and complete barrel, three quarter facing LEFT. 1024x1024 RGBA actual
transparent background. Subject top around y90, wheel bottoms on y900 exactly, all
props within x50..974. No ground shadow, no floor, no text, no border. Preserve
recognizably merfolk anatomy and palette, modest clothing.

### Great-Gran Ashby generation prompt

Use case illustration-story. NEW transparent game cast figure Great-Gran Ashby, the
oldest dragonling grandmother, same species and anatomy and green ivory scales, dark
emerald dorsal spines, small orange membrane wings as reference dragonling. Clearly
elderly, larger adult proportions, long kind muzzle, faded scales, gentle wrinkles,
brisk tender alert eyes. Stout quadruped dragon, NOT humanoid, four thick legs standing,
long tail and two small folded wings. Wears a cozy faded rust knitted shawl over
shoulders. A gnarled walking stick rests against her near forepaw while all four feet
remain grounded. Warm crafted hand drawn storybook illustration, brown tapered
outlines, restrained two tone soft cel shading, tactile subtle brushwork, upper left
light. One character full body three quarter LEFT, readable silhouette. 1024x1024 RGBA
true transparency, NO ground shadow, no floor, no text. All within 40px margins, head
top around y80, bottom feet at y900. Match reference anatomy and palette family but
unmistakably grandmother.

Final correction, using the first generated Ashby as the edit reference:

Edit Great-Gran Ashby into unmistakably an ELDER ADULT dragon grandmother. Preserve
ivory pale green spotted scales, charcoal emerald spines, orange wings, rust shawl,
walking stick, left facing silhouette, warm hand painted style, transparency. Reduce
head size relative to torso by about 20 percent and lengthen muzzle and neck, give
subtle fine wrinkles on muzzle and eye corners, calmer smaller SOLID dark eyes with
ONE highlight dot and simple single brows, absolutely NO eyelashes, NO white sclera
or iris ring. Four legs remain anatomically quadruped: three planted and near front
paw uses walking stick. Show both small wings folded rather than large open wing.
Brisk tender expression, older and bigger rather than baby dragon in a shawl. Entire
single cutout inside a 1024x1024 transparent canvas with clear margins, lowest
feet/stick row at y900, no shadow or floor or lettering. Keep distinct species anatomy.

### Pellam generation prompt

NEW single character Pellam the Skywarden bridge clerk. Reference image shows mixed
order: use the FAUN in the middle as species and uniform basis, NOT all three people.
One adult faun only, curled ram horns, pointed ears, chestnut curls, small neat beard,
furry brown goat legs with two hooves, dry precise neutral expression. Silver and
violet Skywarden tunic and practical light armor, restrained rust red shoulder cape
and tower emblem, no shield or sword. Huge plain leather ledger cradled securely in
LEFT arm, poised feather pen in RIGHT hand above ledger. Pages blank, no lettering.
Three quarter facing viewer LEFT toward heroes. Crafted warm storybook illustration
matches supplied detailed brushwork and warm brown tapered line, controlled shading,
upper left light. Complete character top y85, hooves exactly y900, x100..924,
1024x1024 RGBA actual transparent background, no ground shadow, no floor, no border or
text. One complete figure, readable at phone scale, family friendly. A conscientious
precise clerk, not a warrior, no human legs.

Final correction, using the first generated Pellam as the edit reference:

Correct ONLY the facing of this single faun Skywarden clerk Pellam: turn head and
torso to a readable three quarter LEFT orientation, his nose points toward image LEFT
and gaze toward party standing image LEFT. Currently facing viewer right, must face
left. Keep character identity, curled horns, two furry goat legs and hooves, silver
violet uniform and red cape, blank huge leather ledger securely in arm and feather
pen. Dry precise neutral expression, no smiling. Maintain full complete cutout and
true transparent background, no ground shadow. 1024x1024 square, hooves end at y900,
at least 40px margin. Preserve house painted illustration style, do not add any text,
person, prop or scenery.

### Pilot review captures

See [before/after TV and phone captures](../review/story-cast-pilot/README.md).
The capture harness is a local copy of `e2e/cast-shot.spec.ts`. For each figure,
a temporary content tree makes the original chapter a single-chapter review campaign
(index 1, route removed), preserving every scene's narration, cast, and biome. The
room-create request selects that review campaign. This avoids playing four chapters
to reach Ashby and Pellam while exercising the real party creation, server, cast
renderer, narration, and playtest scene jump. Production campaigns are unchanged.
