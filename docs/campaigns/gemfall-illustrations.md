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

Anatomy correction after pilot review, using the packaged Ashby as the edit reference:

Edit this existing Great-Gran Ashby dragon illustration to fix an anatomical error: she currently has FIVE legs (four planted feet plus an extra raised foreleg holding the stick). Remove the extra planted FRONT leg on the far side, the leftmost planted foot directly behind the walking stick. Keep the raised near foreleg resting on the stick, ONE planted front leg below the shoulder, and TWO planted hind legs below the hips. EXACTLY FOUR limbs total: one raised foreleg, one planted foreleg, two planted hind legs. No fifth limb, no extra paw. Fill the removed limb area with transparent background and natural torso contour. Preserve her face, elder proportions, shawl, walking stick, tail, wings, scales, left-facing pose, colors, and painted style. One complete dragon on a true transparent background, no ground shadow, no text. Square canvas with clear margins. This is a targeted anatomy correction, not a redesign.

The first pilot accidentally showed four planted legs plus the raised foreleg. The
corrected production image has exactly four legs: one raised foreleg, one planted
foreleg, and two planted hind legs. The TV and phone after-captures were refreshed.

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


## Cast figures — elders and adults (A1)

Ten figures complete A1 after the approved Ashby pilot. Generated with the built-in
image generation tool using the approved species and Ashby references. Production
PNGs are 1024×1024 RGBA, feet at y=900, facing left. Packaging uses the same uniform
alpha-bounds fit as the pilot; scale words are applied to every matching cast entry.

| id | basis | scale | references |
|---|---|---|---|
| grandmother_tull | dragonling | medium | 1 |
| dragonling_grandmother | dragonling | medium | 21 |
| mosshome_archivist | bigfoot | large | 12 |
| oldest_archivist | bigfoot | large | 3 |
| mosshome_eldest | bigfoot | large | 4 |
| mosshome_runner | bigfoot | medium_to_large | 8 |
| flood_warden | bigfoot | large | 1 |
| elder_sefa | manticore | large | 9 |
| elder_unicorn | unicorn | large | 6 |
| tamsin | kitsune | medium | 4 |

Design calls: Tull wears a blue wrap and night bell; the gate-town grandmother wears
spectacles and a book satchel, so neither duplicates Ashby. Tamsin carries three blank
cards in a chest pouch, preserving four-legged fox anatomy. The runner pauses mid-jog,
with one foot providing the stage baseline. Sefa retains the approved wingless
manticore anatomy and folds her tail away along the far flank. Archivist hair is
tied back; the oldest has the bird and cord box; the Eldest has silver fur and tea.

[Figure sheet and TV/phone review](../review/story-cast-elders/README.md).

### Grandmother Tull generation prompt

Use case: illustration-story. NEW single game cast character Grandmother Tull. Reference image is for species identity and house painted style, do not copy the reference's props. Elder dragonling bell-keeper grandmother, cosy and brisk. Faded pale mint scales, emerald spines, orange small folded wings, mature long muzzle, kind wrinkles. Wears a muted blue wool shoulder wrap. A small bronze NIGHT BELL hangs from a simple neck cord, ringing freely beside her chest. EXACTLY FOUR planted legs, one tail, two small folded wings; no hands or fifth leg. Warm crafted storybook illustration, tapered warm brown outlines, restrained soft cel shading, subtle brush texture, upper-left light, family friendly age 8. Solid dark eyes with one highlight, simple brows, no eyelashes. Full complete single figure, three-quarter view facing LEFT, gaze toward image left. True transparent background, no floor, no ground shadow, no text, no UI. 1024x1024 square RGBA; figure top about y80, feet around y900, generous 40px clear margins. All defining props fully inside canvas. Readable at 120px height. Check correct limb count, no duplicate limbs.

Reference: `assets/cast/great_gran_ashby/assembled.png`.

### Grandmother generation prompt

Use case: illustration-story. NEW single game cast character Grandmother. Reference image is for species identity and house painted style, do not copy the reference's props. Gate-town elder dragonling grandmother, welcoming but observant. Pale mint spotted scales, emerald spines, orange small folded wings, mature long muzzle and gentle wrinkles. Round spectacles on a bronze chain, a tidy leather tally-book satchel at her shoulder with a closed small book and one pencil visible. EXACTLY FOUR planted legs, no arms, no extra paw; book supported by satchel rather than hand. A soft moss-green collar wrap distinguishes her from Ashby. Warm crafted storybook illustration, tapered warm brown outlines, restrained soft cel shading, subtle brush texture, upper-left light, family friendly age 8. Solid dark eyes with one highlight, simple brows, no eyelashes. Full complete single figure, three-quarter view facing LEFT, gaze toward image left. True transparent background, no floor, no ground shadow, no text, no UI. 1024x1024 square RGBA; figure top about y80, feet around y900, generous 40px clear margins. All defining props fully inside canvas. Readable at 120px height. Check correct limb count, no duplicate limbs.

Reference: `assets/cast/great_gran_ashby/assembled.png`.

### Archivist generation prompt

Use case: illustration-story. NEW single game cast character Archivist. Reference image is for species identity and house painted style, not child age. Brisk adult FEMALE bigfoot archivist with cream furry body and umber mane, mature proportions longer torso and arms than child reference, sternly attentive but kind eyes, neatly tied mane, simple leather belt hung with thick knotted archival cords. Two big bare feet, TWO arms only, one hand gently gathering cords at belt. One individual, no books or glasses required. Warm crafted storybook illustration, tapered warm brown outlines, restrained soft cel shading, subtle brush texture, upper-left light, family friendly age 8. Solid dark eyes with one highlight, simple brows, no eyelashes. Full complete single figure, three-quarter view facing LEFT, nose and gaze toward image left. True transparent background, no floor, no ground shadow, no text, no UI. 1024x1024 square RGBA; figure top about y80, feet around y900, generous 40px clear margins. All defining props fully inside canvas. Readable at 120px height. Check correct limb count, no duplicate limbs.

Reference: `assets/characters/bigfoot/fledgling/assembled.png`.

Final eye-style correction using the generated figure:

Make one tiny house-style correction to this character: BOTH eyes must be entirely solid warm dark brown (#2B2118) ovals with ONE small round highlight dot in upper left of each eye. Remove white sclera, colored iris rings, eyeliner, and eyelashes. Keep eyes the same size and preserve the direction of gaze toward image LEFT, expression, face shape and everything else: fur, limbs, props, pose, palette, transparent background, and hand-painted illustration. No redesign, no added objects, no ground shadow, no text. Preserve true transparency.

### Oldest Archivist generation prompt

Use case: illustration-story. NEW single game cast character Oldest Archivist. Reference image is for species identity and house painted style, not child age. Very old slow male bigfoot archivist, cream fur and faded grey-umber mane, long greying beard, gently stooped mature body, kind creased face. ONE small friendly brown bird nestles in his beard, not a second main character. Both hands support one shallow wooden BOX of thick knotted cords at waist. EXACTLY TWO legs and TWO arms, two big bare feet planted. No staff, no extra arms. Warm crafted storybook illustration, tapered warm brown outlines, restrained soft cel shading, subtle brush texture, upper-left light, family friendly age 8. Solid dark eyes with one highlight, simple brows, no eyelashes. Full complete single figure, three-quarter view facing LEFT, nose and gaze toward image left. True transparent background, no floor, no ground shadow, no text, no UI. 1024x1024 square RGBA; figure top about y80, feet around y900, generous 40px clear margins. All defining props fully inside canvas. Readable at 120px height. Check correct limb count, no duplicate limbs.

Reference: `assets/characters/bigfoot/fledgling/assembled.png`.

Final eye-style correction using the generated figure:

Make one tiny house-style correction to this character: BOTH eyes must be entirely solid warm dark brown (#2B2118) ovals with ONE small round highlight dot in upper left of each eye. Remove white sclera, colored iris rings, eyeliner, and eyelashes. Keep eyes the same size and preserve the direction of gaze toward image LEFT, expression, face shape and everything else: fur, limbs, props, pose, palette, transparent background, and hand-painted illustration. No redesign, no added objects, no ground shadow, no text. Preserve true transparency.

### The Eldest generation prompt

Use case: illustration-story. NEW single game cast character The Eldest. Reference image is for species identity and house painted style, not child age. Mild elderly bigfoot town elder, cream body fur, umber mane streaked with silver, adult longer torso, gentle age lines and calm soft smile, broad sturdy build. Holds ONE small ceramic cup of moss tea in both hands at chest. Simple ochre woven shoulder shawl. EXACTLY TWO legs and TWO arms, big bare feet planted. No bird, no cords or book; dignified contemplative individual. Warm crafted storybook illustration, tapered warm brown outlines, restrained soft cel shading, subtle brush texture, upper-left light, family friendly age 8. Solid dark eyes with one highlight, simple brows, no eyelashes. Full complete single figure, three-quarter view facing LEFT, nose and gaze toward image left. True transparent background, no floor, no ground shadow, no text, no UI. 1024x1024 square RGBA; figure top about y80, feet around y900, generous 40px clear margins. All defining props fully inside canvas. Readable at 120px height. Check correct limb count, no duplicate limbs.

Reference: `assets/characters/bigfoot/fledgling/assembled.png`.

Final eye-style correction using the generated figure:

Make one tiny house-style correction to this character: BOTH eyes must be entirely solid warm dark brown (#2B2118) ovals with ONE small round highlight dot in upper left of each eye. Remove white sclera, colored iris rings, eyeliner, and eyelashes. Keep eyes the same size and preserve the direction of gaze toward image LEFT, expression, face shape and everything else: fur, limbs, props, pose, palette, transparent background, and hand-painted illustration. No redesign, no added objects, no ground shadow, no text. Preserve true transparency.

### MossHome Runner generation prompt

Use case: illustration-story. NEW single game cast character MossHome Runner. Reference image is for species identity and house painted style, not child age. Cheerful young ADULT bigfoot courier, cream body fur and dark umber mane, mature lean longer torso and limbs, out of breath and alert, mouth slightly open. Bundle of thick knotted cords slung over ONE shoulder on a wide leather strap. A relaxed mid-jog pause: one knee slightly bent, both broad bare feet still touching ground for stage placement, arms naturally balanced. EXACTLY TWO arms and TWO legs. No child head proportions. Warm crafted storybook illustration, tapered warm brown outlines, restrained soft cel shading, subtle brush texture, upper-left light, family friendly age 8. Solid dark eyes with one highlight, simple brows, no eyelashes. Full complete single figure, three-quarter view facing LEFT, nose and gaze toward image left. True transparent background, no floor, no ground shadow, no text, no UI. 1024x1024 square RGBA; figure top about y80, feet around y900, generous 40px clear margins. All defining props fully inside canvas. Readable at 120px height. Check correct limb count, no duplicate limbs.

Reference: `assets/characters/bigfoot/fledgling/assembled.png`.

### Flood-Warden generation prompt

Use case: illustration-story. NEW single game cast character Flood-Warden. Reference image is for species identity and house painted style, not child age. Adult bigfoot flood warden, cream body fur with dark umber mane, sturdy mature broad build, very tall muddy leather WADING BOOTS up to knees. Holds one glass jar of softly luminous green mosslight securely in both hands, no lettering. Simple practical reed belt. EXACTLY TWO arms and TWO legs, both boot soles grounded. Calm responsible and helpful. Warm crafted storybook illustration, tapered warm brown outlines, restrained soft cel shading, subtle brush texture, upper-left light, family friendly age 8. Solid dark eyes with one highlight, simple brows, no eyelashes. Full complete single figure, three-quarter view facing LEFT, nose and gaze toward image left. True transparent background, no floor, no ground shadow, no text, no UI. 1024x1024 square RGBA; figure top about y80, feet around y900, generous 40px clear margins. All defining props fully inside canvas. Readable at 120px height. Check correct limb count, no duplicate limbs.

Reference: `assets/characters/bigfoot/fledgling/assembled.png`.

### Elder Sefa generation prompt

Use case: illustration-story. NEW single game cast character Elder Sefa. Reference image is for species identity and house painted style, not child age. Elder Sefa, elderly FEMALE manticore pride elder, formal and kind. Same lion quadruped anatomy as reference, pale rose coat with subtle markings, deep crimson mane now streaked with grey at temples, mature longer lion muzzle and gentle creases. ONE green segmented scorpion tail curled safely LOW around far flank, stinger pointing away from viewer and party. Simple small bronze pride medallion. EXACTLY FOUR paws on ground, no arms, NO wings (match reference). Dignified adult lion proportions, not a cub. Warm crafted storybook illustration, tapered warm brown outlines, restrained soft cel shading, subtle brush texture, upper-left light, family friendly age 8. Solid dark eyes with one highlight, simple brows, no eyelashes. Full complete single figure, three-quarter view facing LEFT, nose and gaze toward image left. True transparent background, no floor, no ground shadow, no text, no UI. 1024x1024 square RGBA; figure top about y80, feet around y900, generous 40px clear margins. All defining props fully inside canvas. Readable at 120px height. Check correct limb count, no duplicate limbs.

Reference: `assets/characters/manticore/fledgling/assembled.png`.

Final eye-style correction using the generated figure:

Correct ONLY the eyes to the approved game house style: entirely SOLID warm dark brown (#2B2118) ovals with ONE small round highlight dot in each eye, like a painted storybook animal. NO white sclera, no colored iris or iris ring, absolutely NO eyelashes or eyeliner, simple single brow line above. Preserve the kind elder expression and left-facing gaze. Everything else stays identical: exactly four planted legs, species anatomy, mature body proportions, hair, tail, horn or medallion, bags, colors, brushwork and true transparent background. No added limbs or objects, no ground shadow, no text.

### Elder Unicorn generation prompt

Use case: illustration-story. NEW single game cast character Elder Unicorn. Reference image is for species identity and house painted style, not child age. Older FEMALE unicorn, calm, expresses a thoughtful frown with ears gently angled back. Pale violet-white coat, violet mane streaked with silver, blue bold cone horn, subtle star markings same as reference. Mature equine longer muzzle, adult sturdy body and longer neck, gentle eye-corner age creases, no eyelashes. Pair of practical moss-brown leather SADDLEBAGS across back without saddle rider. EXACTLY FOUR planted hooves, one horn, one tail. No human arms. Warm crafted storybook illustration, tapered warm brown outlines, restrained soft cel shading, subtle brush texture, upper-left light, family friendly age 8. Solid dark eyes with one highlight, simple brows, no eyelashes. Full complete single figure, three-quarter view facing LEFT, nose and gaze toward image left. True transparent background, no floor, no ground shadow, no text, no UI. 1024x1024 square RGBA; figure top about y80, feet around y900, generous 40px clear margins. All defining props fully inside canvas. Readable at 120px height. Check correct limb count, no duplicate limbs.

Reference: `assets/characters/unicorn/fledgling/assembled.png`.

Final eye-style correction using the generated figure:

Correct ONLY the eyes to the approved game house style: entirely SOLID warm dark brown (#2B2118) ovals with ONE small round highlight dot in each eye, like a painted storybook animal. NO white sclera, no colored iris or iris ring, absolutely NO eyelashes or eyeliner, simple single brow line above. Preserve the kind elder expression and left-facing gaze. Everything else stays identical: exactly four planted legs, species anatomy, mature body proportions, hair, tail, horn or medallion, bags, colors, brushwork and true transparent background. No added limbs or objects, no ground shadow, no text.

### Tamsin Three-Cards generation prompt

Use case: illustration-story. NEW single game cast character Tamsin Three-Cards. Reference image is for species identity and house painted style, not child age. Tamsin Three-Cards, adult kitsune card-sharp. Cream coat, vermilion mane and facial markings, EXACTLY THREE large fluffy teal tails with pale tips, clearly same fox species as reference, mature narrow clever muzzle. Tall slightly crooked dark plum hat, sly friendly expression. Fan of EXACTLY THREE blank ivory playing cards tucked visibly in a small leather chest harness pouch, no text or suits. Cards are fanned prominently below chin, held by pouch, not an extra hand. EXACTLY FOUR planted paws, no arms or fifth leg. Warm crafted storybook illustration, tapered warm brown outlines, restrained soft cel shading, subtle brush texture, upper-left light, family friendly age 8. Solid dark eyes with one highlight, simple brows, no eyelashes. Full complete single figure, three-quarter view facing LEFT, nose and gaze toward image left. True transparent background, no floor, no ground shadow, no text, no UI. 1024x1024 square RGBA; figure top about y80, feet around y900, generous 40px clear margins. All defining props fully inside canvas. Readable at 120px height. Check correct limb count, no duplicate limbs.

Reference: `assets/characters/kitsune/fledgling/assembled.png`.

y.

## A1 figure revisions after review

### Grandmother Tull

Revised: broad compact body silhouette and a clear mint-green dragonling coat distinguish Tull from the taller, long-necked gate-town grandmother. Great-Gran Ashby remains the deliberately faded pale elder.

### Grandmother

Revised: taller, narrower build, longer neck and legs distinguish her from compact Tull. The mint-green palette follows the dragonling species; age reads from gentle creases rather than near-white scales.

### Archivist

Revised: broad silver streaks through the tied mane and clear age lines make her read as an older woman while preserving her brisk, attentive character.

### Elder Unicorn

Revised: age now reads at a glance through a long creased muzzle, lowered lids, mature shoulders, and prominent silver-white mane and forelock.

## Cast figures — Recurring individuals (A2)

Generated with the built-in image generation tool against the existing species/order
references. Production PNGs are 1024×1024 RGBA, facing left, feet at y=900.
The pilot alpha-bounds fit is used without repainting or recoloring.

Existing peoples are retained. Hesper's embroidered road sash and Marda's grey-dappled coat and apron distinguish the centaur hosts. Gullet has the notched ferry hat and long pole; Ossley has an old floppy hat and short pole. Tidewell keeps her seal-skin cloak with an owl-feather clasp and ink-stained notes. Mortar has a pot and ladle; Lintel has moss, a nest and an open palm. Tobble sings with laces and a shoe; Hob waves his hat. Nan holds mittens, a teapot lid and a folded umbrella.

| id | basis | scale | references |
|---|---|---|---|
| tidewell | selkie | medium | 3 |
| mortar | stone_troll | very_large | 7 |
| gullet | frogfolk | small_to_medium | 18 |
| old_ossley | frogfolk | small_to_medium | 9 |
| old_lintel | stone_troll | very_large | 8 |
| hesper | centaur | large | 8 |
| marda_thorn | centaur | large | 7 |
| tobble | faun | medium | 7 |
| hob | faun | medium | 6 |
| nan_rummage | boggart | small | 3 |

[Figure sheet and TV/phone captures](../review/story-cast-recurring/README.md).

### Professor Tidewell generation prompt

NEW single game cast figure Professor Tidewell. Match the supplied species reference and its crafted painted storybook style. Adult female selkie scholar, dark teal tousled hair, warm brown seal-marked face, modest cream and teal scholarly coat with seal-skin cloak and OWL-FEATHER clasp. Ink stains on BOTH elbows, armful of soggy blank notes. Two bare feet and exactly two arms. Thoughtful earnest expression. Complete figure three-quarter LEFT: nose and gaze point toward image left. One complete character, defining props included, relaxed noncombat pose, readable at 120px. Warm brown tapered line, controlled shading, upper-left light, family friendly. 1024x1024 RGBA with TRUE TRANSPARENCY, no ground shadow or floor, no text or border. Clear 40px margins, head top around y80 and lowest feet around y900. No cropped props or duplicate limbs.

Reference: `assets/entities/selkie/assembled.png`.

### Mortar generation prompt

NEW single game cast figure Mortar. Match the supplied species reference and its crafted painted storybook style. One massive stone troll NOODLE COOK, grey rough cobblestone skin and moss at joints, broad quiet kind face, sturdy indigo cooking apron. Holds one huge wooden LADLE in one hand and a round iron soup POT in the other, pale noodles peek out. Exactly two arms and two rock feet, very still and relaxed. No masonry block or tools. Complete figure three-quarter LEFT: nose and gaze point toward image left. One complete character, defining props included, relaxed noncombat pose, readable at 120px. Warm brown tapered line, controlled shading, upper-left light, family friendly. 1024x1024 RGBA with TRUE TRANSPARENCY, no ground shadow or floor, no text or border. Clear 40px margins, head top around y80 and lowest feet around y900. No cropped props or duplicate limbs.

Reference: `assets/entities/stone_troll/assembled.png`.

### Gullet generation prompt

NEW single game cast figure Gullet. Match the supplied species reference and its crafted painted storybook style. One adult female frogfolk ferrywoman, green speckled frog skin, broad frog mouth, big gold-dark eyes, teal patched travelling coat. Wears a soft brown brimmed hat with large carved NOTCHES along brim but no writing. Holds a long straight wooden ferry POLE upright within canvas. Exactly two arms and two broad webbed feet, no extra fingers or legs. Friendly practical expression. No lantern or backpack. Complete figure three-quarter LEFT: nose and gaze point toward image left. One complete character, defining props included, relaxed noncombat pose, readable at 120px. Warm brown tapered line, controlled shading, upper-left light, family friendly. 1024x1024 RGBA with TRUE TRANSPARENCY, no ground shadow or floor, no text or border. Clear 40px margins, head top around y80 and lowest feet around y900. No cropped props or duplicate limbs.

Reference: `assets/entities/frogfolk/assembled.png`.

### Old Ossley generation prompt

NEW single game cast figure Old Ossley. Match the supplied species reference and its crafted painted storybook style. Very elderly frogfolk ferryman with green faded speckled skin, heavy brow and subtle age folds, slow gentle expression, very old floppy weathered felt hat, faded ochre vest over teal shirt. One hand rests on a SHORT wooden ferry pole, other hangs relaxed. Exactly two arms and two broad webbed feet. No lantern or backpack. Complete figure three-quarter LEFT: nose and gaze point toward image left. One complete character, defining props included, relaxed noncombat pose, readable at 120px. Warm brown tapered line, controlled shading, upper-left light, family friendly. 1024x1024 RGBA with TRUE TRANSPARENCY, no ground shadow or floor, no text or border. Clear 40px margins, head top around y80 and lowest feet around y900. No cropped props or duplicate limbs.

Reference: `assets/entities/frogfolk/assembled.png`.

### Old Lintel generation prompt

NEW single game cast figure Old Lintel. Match the supplied species reference and its crafted painted storybook style. Ancient stone toll troll, grey cobblestone skin almost covered in thick green MOSS, half a small empty BIRD NEST on one shoulder, patient slightly amused heavy stone face. One hand held palm up FLAT to request toll, other relaxed. Exactly two rock legs and two arms. No masonry block, no apron, no tools. One individual. Complete figure three-quarter LEFT: nose and gaze point toward image left. One complete character, defining props included, relaxed noncombat pose, readable at 120px. Warm brown tapered line, controlled shading, upper-left light, family friendly. 1024x1024 RGBA with TRUE TRANSPARENCY, no ground shadow or floor, no text or border. Clear 40px margins, head top around y80 and lowest feet around y900. No cropped props or duplicate limbs.

Reference: `assets/entities/stone_troll/assembled.png`.

### Hesper Longstride generation prompt

NEW single game cast figure Hesper Longstride. Match the supplied species reference and its crafted painted storybook style. One adult female centaur caravan master, chestnut equine body and braided brown hair, composed capable expression. Broad teal caravan SASH embroidered with winding road lines and landmarks without lettering. Practical cream blouse and travel belt. Four equine legs with four grounded hooves, exactly TWO humanoid arms, one horse tail. No extra horse legs or rider. Complete figure three-quarter LEFT: nose and gaze point toward image left. One complete character, defining props included, relaxed noncombat pose, readable at 120px. Warm brown tapered line, controlled shading, upper-left light, family friendly. 1024x1024 RGBA with TRUE TRANSPARENCY, no ground shadow or floor, no text or border. Clear 40px margins, head top around y80 and lowest feet around y900. No cropped props or duplicate limbs.

Reference: `assets/entities/centaur/assembled.png`.

### Marda Thorn generation prompt

NEW single game cast figure Marda Thorn. Match the supplied species reference and its crafted painted storybook style. One mature female GREY-DAPPLED centaur innkeeper, warm brown humanlike upper torso and greying braid, grey equine coat with large darker dapples. Broad plain cream kitchen APRON around torso and forward horse chest, warm welcoming smile, hands resting relaxed near waist. Exactly four equine legs with four grounded hooves and two humanoid arms, one horse tail. No rider or extra leg. Complete figure three-quarter LEFT: nose and gaze point toward image left. One complete character, defining props included, relaxed noncombat pose, readable at 120px. Warm brown tapered line, controlled shading, upper-left light, family friendly. 1024x1024 RGBA with TRUE TRANSPARENCY, no ground shadow or floor, no text or border. Clear 40px margins, head top around y80 and lowest feet around y900. No cropped props or duplicate limbs.

Reference: `assets/entities/centaur/assembled.png`.

### Tobble Reedpipe generation prompt

NEW single game cast figure Tobble Reedpipe. Match the supplied species reference and its crafted painted storybook style. One adult faun COBBLER mid-song, curled horns and goat ears, chestnut curls and beard, cream shirt under moss vest, simple leather work apron. Bundle of colorful thick shoelaces draped over ONE forearm, other hand holds one small unfinished leather shoe. Cheerful mouth open singing. Exactly TWO humanoid arms and TWO furry goat legs with hooves. Complete figure three-quarter LEFT: nose and gaze point toward image left. One complete character, defining props included, relaxed noncombat pose, readable at 120px. Warm brown tapered line, controlled shading, upper-left light, family friendly. 1024x1024 RGBA with TRUE TRANSPARENCY, no ground shadow or floor, no text or border. Clear 40px margins, head top around y80 and lowest feet around y900. No cropped props or duplicate limbs.

Reference: `assets/entities/faun/assembled.png`.

### Hob Thistledown generation prompt

NEW single game cast figure Hob Thistledown. Match the supplied species reference and its crafted painted storybook style. One adult faun field foreman, curled horns, goat ears, chestnut hair, cream shirt and ochre waistcoat, muddy hems, friendly brisk expression. Waving a plain brown felt HAT in one raised hand, other hand relaxed. Exactly TWO arms and TWO furry goat legs with hooves. No instrument or weapon. Complete figure three-quarter LEFT: nose and gaze point toward image left. One complete character, defining props included, relaxed noncombat pose, readable at 120px. Warm brown tapered line, controlled shading, upper-left light, family friendly. 1024x1024 RGBA with TRUE TRANSPARENCY, no ground shadow or floor, no text or border. Clear 40px margins, head top around y80 and lowest feet around y900. No cropped props or duplicate limbs.

Reference: `assets/entities/faun/assembled.png`.

### Nan Rummage generation prompt

NEW single game cast figure Nan Rummage. Match the supplied species reference and its crafted painted storybook style. One older female boggart with dark olive skin, enormous pointed ears, scruffy grey-brown fur, amber eyes, patched teal clothes. Both arms cradle an untidy bundle of LOST THINGS: a pair of wool mittens, a small teapot LID, one folded UMBRELLA tucked diagonally beside shoulder fully within canvas. Kind mischievous smile. Exactly two arms and two big feet planted, no key or lantern. Complete figure three-quarter LEFT: nose and gaze point toward image left. One complete character, defining props included, relaxed noncombat pose, readable at 120px. Warm brown tapered line, controlled shading, upper-left light, family friendly. 1024x1024 RGBA with TRUE TRANSPARENCY, no ground shadow or floor, no text or border. Clear 40px margins, head top around y80 and lowest feet around y900. No cropped props or duplicate limbs.

Reference: `assets/entities/boggart/assembled.png`.

## Cast figures — Individual order members (A3)

Generated with the built-in image generation tool against the existing species/order
references. Production PNGs are 1024×1024 RGBA, facing left, feet at y=900.
The pilot alpha-bounds fit is used without repainting or recoloring.

Voss is a griffin, Brask a female faun, Holloway a centaur, and Mother Thrum a bigfoot: all are already represented in their order reference images. Voss has the direct beaked silhouette; Brask's ears and curls carry her three pencils; Holloway keeps the uniform and tidy ledger on a caravan-ready centaur; Mother Thrum's elder bigfoot body and bell charms suit a steady ford witch. Skywarden bases use actual species because the faction is absent from manifest entities, as in the approved Pellam pilot. Mother Thrum uses witch_order, which is a valid manifest entity. Group casts remain unchanged.

| id | basis | scale | references |
|---|---|---|---|
| captain_voss | griffin | medium | 1 |
| brask | faun | medium | 6 |
| holloway | centaur | medium | 5 |
| mother_thrum | witch_order | medium | 16 |

[Figure sheet and TV/phone captures](../review/story-cast-orders/README.md).

### Captain Voss generation prompt

NEW single individual game cast figure Captain Voss; the supplied reference is a GROUP and you must draw ONLY the person specified, not the group. Captain Orla Voss is ONE adult female GRIFFIN Skywarden, eagle head and lion quadruped body, hooked gold beak, slate-grey feather crest, folded dark violet wings, silver shoulder and chest armor with violet tower emblem, restrained rust-red cape. Rigid honest direct expression. Exactly FOUR grounded limbs: TWO eagle forelegs/talons and TWO lion hindlegs/paws, plus TWO folded wings and ONE lion tail. No humanoid arms, no shield or weapon. Full figure facing LEFT, beak points LEFT. Match supplied warm hand-painted fantasy storybook style, readable at 120px. Complete figure three-quarter LEFT, nose/beak and gaze point image LEFT. Relaxed neutral pose, family friendly, controlled shading, upper-left light, tapered warm brown line. 1024x1024 RGBA actual transparent background, NO floor, ground shadow, text, border, or UI. Figure top around y80, feet around y900, clear 40px margins, all props inside canvas. Verify limb count.

Reference: `assets/entities/skywardens/assembled.png`.

### Engineer Brask generation prompt

NEW single individual game cast figure Engineer Brask; the supplied reference is a GROUP and you must draw ONLY the person specified, not the group. Engineer Brask is ONE adult faun Skywarden engineer, curled ram horns, pointed ears and short chestnut beard, silver/violet practical uniform over cream shirt, modest leather tool belt. ONE pencil behind EACH ear and a forgotten THIRD pencil tucked above forehead curls, all three visible without lettering. Holds a rolled blank engineering diagram in one hand, other relaxed. Exactly TWO arms and TWO furry goat legs with hooves. Blunt honest expression, no weapon. Match supplied warm hand-painted fantasy storybook style, readable at 120px. Complete figure three-quarter LEFT, nose/beak and gaze point image LEFT. Relaxed neutral pose, family friendly, controlled shading, upper-left light, tapered warm brown line. 1024x1024 RGBA actual transparent background, NO floor, ground shadow, text, border, or UI. Figure top around y80, feet around y900, clear 40px margins, all props inside canvas. Verify limb count.

Reference: `assets/entities/skywardens/assembled.png`.

Final identity correction to Brask, using the generated figure:Targeted identity correction: Engineer Brask is referred to as SHE in the story. Keep this exact faun Skywarden engineer, left-facing pose, ram horns, pointed ears, THREE pencils (one behind each ear plus one forgotten in curls), cream shirt, silver/violet armor, rolled diagram, tool belt, two arms and two goat legs. Make the face a mature female faun: remove the beard and moustache, retain short practical chestnut curls and blunt honest expression. Do not add eyelashes, makeup, or exaggerated feminine costume. Preserve everything else, true transparent background, full cutout, no text or shadow.### Sergeant Holloway generation prompt

NEW single individual game cast figure Sergeant Holloway; the supplied reference is a GROUP and you must draw ONLY the person specified, not the group. Sergeant Holloway is ONE adult female CENTAUR Skywarden supply sergeant, chestnut horse body, braided brown hair, neat silver and violet uniform, calm meticulous expression. Holds ONE closed tidy purple leather LEDGER in two humanoid hands at waist, no text. Exactly FOUR equine legs/grounded hooves and exactly TWO humanoid arms, one horse tail. Light silver leg armor, no shield or weapon. Full figure facing LEFT. Match supplied warm hand-painted fantasy storybook style, readable at 120px. Complete figure three-quarter LEFT, nose/beak and gaze point image LEFT. Relaxed neutral pose, family friendly, controlled shading, upper-left light, tapered warm brown line. 1024x1024 RGBA actual transparent background, NO floor, ground shadow, text, border, or UI. Figure top around y80, feet around y900, clear 40px margins, all props inside canvas. Verify limb count.

Reference: `assets/entities/skywardens/assembled.png`.

### Mother Thrum generation prompt

NEW single individual game cast figure Mother Thrum; the supplied reference is a GROUP and you must draw ONLY the person specified, not the group. Mother Thrum is ONE elderly female BIGFOOT ford witch, using bigfoot at right of order reference as species, cream body fur and grey-streaked umber mane, kind knowing face. A soft moss-green POINTED HAT, round SPECTACLES on chain, patched ochre and moss robe, bronze BELL CHARMS clustered at belt. One hand rests on a plain short wooden staff, other holds a closed little moss-green book. Exactly TWO arms and TWO big bare feet. No other figures, no magic glow or text. Match supplied warm hand-painted fantasy storybook style, readable at 120px. Complete figure three-quarter LEFT, nose/beak and gaze point image LEFT. Relaxed neutral pose, family friendly, controlled shading, upper-left light, tapered warm brown line. 1024x1024 RGBA actual transparent background, NO floor, ground shadow, text, border, or UI. Figure top around y80, feet around y900, clear 40px margins, all props inside canvas. Verify limb count.

Reference: `assets/entities/witch_order/assembled.png`.
