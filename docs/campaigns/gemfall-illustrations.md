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

Voss is a griffin, Brask a female faun, Holloway a griffin, and Mother Thrum a bigfoot: all are already represented in their order reference images. Voss has the direct beaked silhouette; Brask's ears and curls carry her three pencils; Holloway keeps the uniform and tidy ledger on a griffin old flyer; Mother Thrum's elder bigfoot body and bell charms suit a steady ford witch. Skywarden bases use actual species because the faction is absent from manifest entities, as in the approved Pellam pilot. Mother Thrum uses witch_order, which is a valid manifest entity. Group casts remain unchanged.

| id | basis | scale | references |
|---|---|---|---|
| captain_voss | griffin | medium | 1 |
| brask | faun | medium | 6 |
| holloway | griffin | medium | 5 |
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

Final Holloway correction for the narration's explicit old-flyer identity:

Create NEW single individual game cast figure Sergeant Holloway, a FEMALE GRIFFIN Skywarden supply sergeant. Story calls her an old flyer, so she must have eagle head, golden hooked beak, slate-grey feather crest, lion quadruped body, two folded wings, one lion tail; NOT a centaur. Use ONLY griffin at left of supplied mixed-order reference for species and silver/violet uniform, not other people. Calm meticulous older face, neatly groomed crest, practical lighter silver armor with violet tower emblem and small violet shoulder cape. One CLOSED neat purple leather ledger rides visibly in a simple chest harness below her neck, tucked alongside a supply satchel; no writing. All FOUR limbs on ground: TWO eagle forelegs with talons and TWO lion hindlegs with paws. No humanoid arms, no extra legs, no sword or shield. Full character three-quarter LEFT, beak and gaze toward imageLEFT, neutral relaxed pose, readable120px. Crafted warm hand-painted storybook illustration, upper-left light, controlled shading. 1024x1024 RGBA true transparent background, no floor or shadow, no text/border, clear40px margins, feet near y900.

### Mother Thrum generation prompt

NEW single individual game cast figure Mother Thrum; the supplied reference is a GROUP and you must draw ONLY the person specified, not the group. Mother Thrum is ONE elderly female BIGFOOT ford witch, using bigfoot at right of order reference as species, cream body fur and grey-streaked umber mane, kind knowing face. A soft moss-green POINTED HAT, round SPECTACLES on chain, patched ochre and moss robe, bronze BELL CHARMS clustered at belt. One hand rests on a plain short wooden staff, other holds a closed little moss-green book. Exactly TWO arms and TWO big bare feet. No other figures, no magic glow or text. Match supplied warm hand-painted fantasy storybook style, readable at 120px. Complete figure three-quarter LEFT, nose/beak and gaze point image LEFT. Relaxed neutral pose, family friendly, controlled shading, upper-left light, tapered warm brown line. 1024x1024 RGBA actual transparent background, NO floor, ground shadow, text, border, or UI. Figure top around y80, feet around y900, clear 40px margins, all props inside canvas. Verify limb count.

Reference: `assets/entities/witch_order/assembled.png`.

## Gemfall 1 — seven story locations

Generated with the built-in image tool using the existing Exchange biome as the
architecture and painterly style reference. Production exports are 1920×1080 RGB
WebP, quality 88. Sources are 1672×941; a one-row crop at the top yields 1672×940,
then a Lanczos resize provides the export dimensions. The floor band remains at
80%, open across the width; there are no painted characters or creatures.

The outdoor scholar scenes, cupboard-under-stairs rest, market gutter/glint scenes, and moving northbound hired/turnip wagons retain biome art because the requested tavern/quay/yard backdrop would contradict their narration. The tavern interior therefore covers scene_tavern only. Prologue, city-wide views and the Sunward Fields camp also retain existing art.

| Asset | Scenes |
|---|---|
| exchange-lighthouse | `scene_lighthouse` |
| exchange-docks | `scene_night_docks`, `scene_docks`, `check_rumours`, `scene_boggart`, `scene_three_rumours` |
| exchange-noodle-stall | `choice_why_north`, `scene_motive_wealth`, `scene_motive_curiosity`, `scene_motive_prestige`, `scene_motive_duty`, `scene_motive_fresh_start`, `scene_motive_proving` |
| empty-chair-tavern | `scene_tavern` |
| exchange-quay | `choice_ember`, `choice_ember_sell_high`, `scene_sold`, `scene_kept` |
| outfitters-steps | `scene_market`, `scene_market_spot_fakes`, `scene_market_fresh_start`, `scene_market_buy_outright`, `check_haggle`, `scene_laced`, `scene_lace_tangle` |
| caravan-yard | `scene_caravan_yard`, `scene_caravan_yard_banner`, `scene_caravan_yard_race`, `scene_caravan_yard_guard`, `scene_caravan_yard_lift_wagon`, `check_signon` |

All seven new files pass explicit WebP/1920×1080/RGB and manifest/reference checks. Content validation: 55 passed. Existing Gemfall wiring and art-path tests: 37 passed. The shared art-verifier checks pass (725); that verifier does not inspect scene backdrops, so the separate file checks and captures are the evidence for these images. Semantic comparison confirms only 31 scene art fields changed. Before and after Playwright captures passed for all seven locations.

[Backdrops and TV/phone comparison gallery](../review/gemfall-one-places/README.md).

### exchange-lighthouse generation prompt

Use case illustration-story. NEW wide landscape 16:9 game environment backdrop, 1920x1080 intended export. Use supplied Exchange city image for house painted style, cream-stone architecture and blue roofs, but draw this distinct LOCATION: The TOP viewing deck INSIDE the Exchange lighthouse, a circular cream stone lantern room with brass lens and lamp high at one side, broad arched windows in upper half overlooking deep blue harbor at night and far northern horizon faintly cherry-red with a few threads of gem-light. No bathtub or keeper. A broad level stone floor spans full width from 70% down, with the standing floor row at exactly80%. Painterly dimensional warm storybook craft, soft brushwork and rich controlled colors, family friendly age8. Landmark in TOP HALF, unobstructed level standing band bottom30% across FULL WIDTH, floor line80% down. Bottom fifth will be under narration, top edge may be cropped, keep crucial elements away from edges. No characters, people, creatures, animals, statue figures, lettering, border, UI or shadow silhouettes. The stage adds its own actors, so environment only.

### exchange-docks generation prompt

Use case illustration-story. NEW wide landscape 16:9 game environment backdrop, 1920x1080 intended export. Use supplied Exchange city image for house painted style, cream-stone architecture and blue roofs, but draw this distinct LOCATION: Exchange harbor docks in soft blue twilight, tied sailing ships, timber piers, cream-stone warehouses and lanterns, closed wooden rumor jars and rope coils arranged on stalls at far edges. Ships masts and warehouse skyline in upper half. Broad empty level stone-and-timber dock apron across full width from70% down, floor row at80%. No prices, signs, text, fish, birds or other creatures. Painterly dimensional warm storybook craft, soft brushwork and rich controlled colors, family friendly age8. Landmark in TOP HALF, unobstructed level standing band bottom30% across FULL WIDTH, floor line80% down. Bottom fifth will be under narration, top edge may be cropped, keep crucial elements away from edges. No characters, people, creatures, animals, statue figures, lettering, border, UI or shadow silhouettes. The stage adds its own actors, so environment only.

### exchange-noodle-stall generation prompt

Use case illustration-story. NEW wide landscape 16:9 game environment backdrop, 1920x1080 intended export. Use supplied Exchange city image for house painted style, cream-stone architecture and blue roofs, but draw this distinct LOCATION: A cozy Exchange noodle stall under ochre fabric awning, oversized cook's iron pot and ladle hanging behind a service counter, wooden dining tables and a single conspicuously empty chair tucked at back SIDE, shelves with bowls and noodles. Warm inviting cream stone market arches behind. Stall and awning in upper half, tables far back, spacious EMPTY level cobbled foreground across entire width70% to bottom, standing row80%. No cook, diners, lettering or menu text. Painterly dimensional warm storybook craft, soft brushwork and rich controlled colors, family friendly age8. Landmark in TOP HALF, unobstructed level standing band bottom30% across FULL WIDTH, floor line80% down. Bottom fifth will be under narration, top edge may be cropped, keep crucial elements away from edges. No characters, people, creatures, animals, statue figures, lettering, border, UI or shadow silhouettes. The stage adds its own actors, so environment only.

### empty-chair-tavern generation prompt

Use case illustration-story. NEW wide landscape 16:9 game environment backdrop, 1920x1080 intended export. Use supplied Exchange city image for house painted style, cream-stone architecture and blue roofs, but draw this distinct LOCATION: INSIDE the Empty Chair tavern at the Exchange, warm timber beams, cream-stone walls, amber lamps, wooden tables well behind the action area each with an empty chair, a broad open doorway to rainy blue night at one side, room cozy but spacious. Main architectural landmark fireplace and empty tables in upper half. Clear EMPTY level wooden floor runs entire width from70% to bottom, standing row80%. No patrons, scholars, staff, creatures, menu, signage or text. Painterly dimensional warm storybook craft, soft brushwork and rich controlled colors, family friendly age8. Landmark in TOP HALF, unobstructed level standing band bottom30% across FULL WIDTH, floor line80% down. Bottom fifth will be under narration, top edge may be cropped, keep crucial elements away from edges. No characters, people, creatures, animals, statue figures, lettering, border, UI or shadow silhouettes. The stage adds its own actors, so environment only.

### exchange-quay generation prompt

Use case illustration-story. NEW wide landscape 16:9 game environment backdrop, 1920x1080 intended export. Use supplied Exchange city image for house painted style, cream-stone architecture and blue roofs, but draw this distinct LOCATION: Exchange gem-buyers' quay, elegant cream-stone harbor arcade and colorful jewel merchant canopies high in background, bowls of subtle red blue amber polished gems on distant counter, sea glimpsed through arches, blue city roofs above. Mooring bollards at far margins only. Spacious level sunlit cobbled quay across full width from70% down, standing row80%, left and right halves completely clear. No merchant, barrel character, gulls, prices, writing or text. Painterly dimensional warm storybook craft, soft brushwork and rich controlled colors, family friendly age8. Landmark in TOP HALF, unobstructed level standing band bottom30% across FULL WIDTH, floor line80% down. Bottom fifth will be under narration, top edge may be cropped, keep crucial elements away from edges. No characters, people, creatures, animals, statue figures, lettering, border, UI or shadow silhouettes. The stage adds its own actors, so environment only.

### outfitters-steps generation prompt

Use case illustration-story. NEW wide landscape 16:9 game environment backdrop, 1920x1080 intended export. Use supplied Exchange city image for house painted style, cream-stone architecture and blue roofs, but draw this distinct LOCATION: Outfitters' Steps at the Exchange, stepped shopping lane rises in upper half between cream-stone shops, boots rope and thick colorful laces displayed at distant stalls, blue tile roofs, warm daylight. Steps begin WELL BEHIND the standing area, never under characters. Broad level stone landing spans entire foreground full width70% to bottom, standing row80%. No cobbler, shoppers, pony, text or sign lettering. Painterly dimensional warm storybook craft, soft brushwork and rich controlled colors, family friendly age8. Landmark in TOP HALF, unobstructed level standing band bottom30% across FULL WIDTH, floor line80% down. Bottom fifth will be under narration, top edge may be cropped, keep crucial elements away from edges. No characters, people, creatures, animals, statue figures, lettering, border, UI or shadow silhouettes. The stage adds its own actors, so environment only.

### caravan-yard generation prompt

Use case illustration-story. NEW wide landscape 16:9 game environment backdrop, 1920x1080 intended export. Use supplied Exchange city image for house painted style, cream-stone architecture and blue roofs, but draw this distinct LOCATION: Exchange caravan yard at DAWN, several stationary wooden wagons pointed north, one lantern wagon with many unlit brass lanterns and a tall plain teal banner with no writing, cream-stone city gate and blue roofs high behind, warm pale sunrise. All wagons and landmarks in upper half, carts at rear and margins. Broad empty LEVEL hard-packed earth staging apron across entire width from70% to bottom, standing row80%. No horses, oxen, people, animals, wheels in foreground, text or creatures. Painterly dimensional warm storybook craft, soft brushwork and rich controlled colors, family friendly age8. Landmark in TOP HALF, unobstructed level standing band bottom30% across FULL WIDTH, floor line80% down. Bottom fifth will be under narration, top edge may be cropped, keep crucial elements away from edges. No characters, people, creatures, animals, statue figures, lettering, border, UI or shadow silhouettes. The stage adds its own actors, so environment only.

## Gemfall 1 — expansion locations

Three additional backdrops cover the Long Bridge, Griffin Post and North Gate episodes. The prologue stays on the established docks image except Old Wick's bridge-lamp scene; the plaque walk and single rooftop discovery use biome art because they are brief transitions with no recurring set.

| Asset | Coverage |
|---|---|
| `exchange-long-bridge.webp` | `scene_prologue_party_lamps`, `scene_long_bridge`, `check_bridge_squeeze`, `scene_long_bridge_barge`, `scene_long_bridge_lamp_path`, `scene_long_bridge_wade` |
| `exchange-griffin-post.webp` | `scene_griffin_post`, `check_post_sort`, `scene_griffin_post_feed`, `scene_griffin_post_shop` |
| `exchange-north-gate.webp` | `scene_north_gate`, `check_leaving_bell`, `scene_north_gate_wave`, `scene_north_gate_look`, `scene_north_gate_tidewell` |

Generated with the built-in image tool. Each is a new 16:9 Exchange location, exported as 1920×1080 WebP at quality 88. Composition keeps the landmark in the top half and a clear level floor in the lower 30 percent; no characters or readable text.

### Long Bridge generation prompt

Create a polished landscape 16:9 fantasy storybook game backdrop for the Long Bridge in the Exchange. A broad ancient cream-stone arch bridge crosses a blue canal, with round lamp posts, blue-roofed cream-stone buildings and the harbor beyond. Camera at character eye-height on the bridge, perspective toward a distant noodle stall; lower 30 percent is broad unobstructed flat stone walkway, floor contact around 80 percent. Bridge arch and lamps in top half. Warm dimensional storybook painting, soft pale morning light. No people, creatures, animals, silhouettes, signage, words, UI, border, foreground props or shadows. Full bleed, mobile-safe crop.

### Griffin Post generation prompt

Create a polished landscape 16:9 fantasy storybook game backdrop of the Griffin Post in the Exchange. A tall elegant cream-stone tower with round windows and slate-blue roof rises in the upper half, with a small rooftop landing ledge, blank mail sacks on a distant bench and brass weather vane; neighboring blue-roofed buildings frame it. Sunny late afternoon with harbor haze. View from open courtyard looking up; lower 30 percent is unobstructed pale cobblestone plaza, floor around 80 percent. No people, griffins, birds, creatures, silhouettes, readable marks, signage, lettering, UI or border.

### North Gate generation prompt

Create a polished landscape 16:9 painterly fantasy storybook game backdrop of the North Gate of the Exchange, viewed from inside the city toward a great open cream-stone archway with a bronze leaving bell and worn rope. Beyond the arch, a green road winds through fields toward a distant enormous mountain with a tiny red summit glow; blue-roofed city towers frame it. Hopeful early morning farewell, warm detailed painting. Keep arch, bell, mountain in top half and a broad level cobbled road in the lower 30 percent, floor around 80 percent. No characters, creatures, animals, silhouettes, signage, words, UI, border or weapons.
## Gemfall 03A — Great River crossing

Generated with the built-in image-generation tool. Production files are WebP, 1920×1080, quality 88. Every illustration has an open level foreground band for the party and cast; landmarks sit above it. No people or creatures are painted into the backdrops.

| Asset | Coverage |
|---|---|
| `east-road-markers.webp` | East road, missing marker stump, and river approach |
| `stone-crossing-queue.webp` | Queue and waiting camp before the Great River stepping stones |
| `lintel-toll-stone.webp` | First toll stone and the old stone crossing |
| `drake-rock-shelf.webp` | Empty shelf under the bridge with the humming gem and discarded finds |
| `drowned-crossing-bank.webp` | Submerged final stones and ferry landing |
| `river-mouth-shore.webp` | Eastern river-mouth beach and distant Bone Yard ridge |
| `eastern-shore-camp.webp` | Driftwood camp after the crossing |

### Generation prompts

**East road markers**

Wide 16:9 Kids & Dragons Gemfall environment backdrop: the old east road runs beside the Great River through broad open grassland, with a little stump where a mile marker was removed and a plain porridge pot resting on it. The road bends toward distant crossing stones. Tactile watercolor and gouache storybook painting, warm natural light, muted green, river blue, earth and stone palette. Road and river in the upper half; keep the walkable band from 70% to the bottom broad, level and open across the width. No people, creatures, animals, readable marks, UI, border or watermark.

**Stone crossing queue**

Wide 16:9 Kids & Dragons Gemfall storybook environment: a very long, slow queue gathers before Stone Crossing, where enormous flat stepping stones span the Great River's narrowest point; a simple rope guides the line, a tiny empty soup counter and blank rolled map stand far at the edges. River and broad crossing are the upper-half landmark. Hand-painted gouache, warm daylight, tactile river stone and grass, friendly humor. Keep lower 30% and center foreground open and level for separate characters. No people, creatures, animals, text, signs, UI, frame or watermark.

**Lintel toll stone**

Wide 16:9 storybook environment: the first giant flat basalt slab of Stone Crossing rests at the broad river edge, with a wide palm-shaped patch of moss from years of use; enormous flat stones extend across the river. A small empty nest rests on a far ledge. Warm sunlight, dimensional watercolor and gouache, riverbank plants. Landmark upper-middle; lower 30% is open level stone and bank for separate cast. No people, characters, creatures, animals, writing, UI, frame or watermark.

**Drake rock shelf**

Wide landscape 16:9 Kids & Dragons environment: beneath a high river bridge is an empty broad rock shelf above flowing water; scattered fish bones, three rusted boat hinges, one smooth polished pebble, and a softly glowing humming gem sit on it. A plain blank slate leans against the rock. Cool bridge shadow, sunlight shimmering from the river; detailed painted storybook landscape. Upper-half bridge and shelf landmark; lower 30% open, flat riverbank floor. No drake, animals, people, creatures, text or symbols, UI, frame or watermark.

**Drowned crossing bank**

Wide 16:9 storybook scene: a shallow river crossing, giant flat stones marching into fast brown water with the final stretch submerged; a simple flat-bottom ferry nudges a reed-lined bank. Clear, lively but safe water. Painted reeds, rounded stones, soft reflections and warm overcast light. Upper-half landmark; lower 30% broad, level and unobstructed for separate figures. No people, animals, boatman, characters, creatures, text, UI, border or watermark.

**River mouth shore**

Wide 16:9 Kids & Dragons backdrop: a quiet sandy beach at the river mouth, shallow river and reeds, with a distant mist-softened Bone Yard ridge and pale fossils in a few neat spirals. An empty flat-bottom boat may rest at the reed edge. Warm soft morning light, inviting gouache and watercolor, calm curious mood. Open level beach foreground from 70% to bottom; fossil landmark in upper half and away from center foreground. No people, animals, creatures, skeletons, text, UI, border or watermark.

**Eastern shore camp**

Wide 16:9 Kids & Dragons backdrop: quiet evening camp on the eastern shore after crossing the Great River; driftwood lies beside a small safe glowing campfire, wet sand and shallow water catch amber light, distant open Eastern Plains fade northward, reeds and smooth stones frame the sides. Warm, slightly damp, peaceful storybook environment, detailed hand-painted gouache and watercolor. Upper-half landmark; lower 30% broad, level, open shore. No tent, building, people, animals, creatures, text, UI, frame or watermark.

## Gemfall 03A — eastern landing

`eastern-bank-landing.webp` covers `scene_east_landing`, `scene_east_landing_move_crates`, and `scene_east_landing_ask_question`. It shows the far bank where travelers and gem carts gather after Stone Crossing; the adjacent short overlook remains on biome art.

Generated as a 16:9 painterly riverbank backdrop and exported 1920×1080 WebP, quality 88. It has flat open landing ground across the lower 30 percent, with the river and ford in the upper two thirds. No foreground characters or readable signage.

### Eastern landing generation prompt

Create a polished wide 16:9 painterly fantasy storybook game backdrop for the eastern landing at Stone Crossing on the Great River. A broad calm blue-brown river, flat stepping stones, a dry far bank, reeds and a dirt road with distant wagons arriving after the ford; soft morning after rain. Keep river and stones in the upper two thirds and a broad level bank in the lower 30 percent for sprites. No people, animals, creatures, signage, lettering, UI or border.

## Gemfall 03C — Ford queue and camp

Generated with the built-in image-generation tool. Each scene illustration is a 1920×1080 WebP at quality 88. The paintings contain no characters or creatures; each keeps a level open foreground for the stage. The queue moves from the rutted caravan road, through its roadside market and camp, to the west branch ford.

| Asset | Coverage |
|---|---|
| `caravan-road-ruts.webp` | Northbound rutted road and marker line |
| `ford-queue-market.webp` | West branch queue market |
| `wend-soup-tent.webp` | Soup tent at the edge of camp |
| `bracken-cart.webp` | Cracked cart beside the queue road |
| `queue-dusk-camp.webp` | Dusk campfires along the queue |
| `ford-witch-stall.webp` | Mother Thrum's roadside remedy stall |
| `west-branch-ford.webp` | Wide brown ford and crossing approach |

### Generation prompts

**Caravan road ruts:** Wide 16:9 storybook environment: a northbound road through open grassland with deep wagon ruts, empty campfire rings on low rises, and a flattened line of road markers toward the west river branch. No vehicles. Tactile watercolor/gouache, warm natural light. Upper-half landscape landmark; lower 30% open level ground. No people, creatures, animals, text, marks, UI, border or watermark.

**Ford queue market:** Wide 16:9 environment at the west branch ford: an empty provisioner's table with a bucket of plain unmarked pebbles and tiny honeycakes, plus an upturned barrel for a simple card game; broad brown river ford and standing stones in upper half. Friendly storybook gouache/watercolor. Lower 30% open and level. Rural horizon with no buildings. No people, creatures, animals, text, signs, UI or watermark.

**Wend soup tent:** Wide 16:9 rural roadside soup tent at the edge of a river-crossing camp: open canvas flaps, iron kettle, bowls, ladle, dark wool robes hung to dry, one tiny crystal on a cord. Tent is the only structure; horizon is wooded hills and grassland. Warm handcrafted storybook watercolor/gouache. Tent in upper half; lower 30% open, level grass. No characters, creatures, animals, symbols, lettering, signs, UI or watermark.

**Bracken cart:** Wide 16:9 roadside queue meadow with an empty small wooden family cart, its cracked wheel looped with spare rope; crumbs and a honeycake piece on folded cloth. Road continues toward a distant ford. Warm quiet storybook gouache/watercolor. Cart in upper half to one side; lower 30% open and walkable. Natural hills only. No family, people, animals, creatures, text, UI, frame or watermark.

**Queue dusk camp:** Wide 16:9 dusk at a roadside queue camp in open grassland; empty campfire rings and gentle amber coals dot the distant rises, with simple supplies beside the far fires. Muted twilight, first stars, safe and calm watercolor/gouache. Natural field horizon only. Lower 30% open, level ground. No wolves, animals, people, creatures, wagons, text, UI, border or watermark.

**Ford witch stall:** Wide 16:9 rural remedy stall beside a queue: pointed hat hanging off the awning, tiny bell charms, a thick wool sock wrapped around a softly ringing stone, unmarked medicine bottles. Warm storybook watercolor/gouache. Modest stall in upper half toward one side; lower 30% open level ground. Natural hill and tree horizon only. No witch, people, creatures, animals, text, signs, UI, border or watermark.

**West branch ford:** Wide 16:9 storybook environment: a wide brown, fast but fordable river branch through open grassland, with a sequence of low stones and gravel bars showing where a wagon may cross one at a time. Roads approach from both banks; a few blank wooden route posts. Bright overcast light, watercolor/gouache. River in upper half; lower 30% open bank. Natural plains only. No people, wagons, creatures, animals, lettering, UI, border or watermark.
## Gemfall 04A — Pride country

Generated with the built-in image-generation tool. Six character-free 1920×1080 WebP backdrops at quality 88; prompts below. The Eastern Plains palette shifts from day gold to night indigo. The foreground stays open and level for the stage.

| Asset | Coverage |
|---|---|
| `pride-marker-road.webp` | Curved pride-country road markers |
| `sefa-ridge-camp.webp` | Manticore pride ridge camp |
| `centaur-sash-barn.webp` | Centaur road-warden waystation |
| `pride-stone-crater.webp` | Humming gem in the small crater |
| `abandoned-caravan-rest.webp` | Empty old caravan rest stop |
| `pride-night-fire.webp` | Night fire below the pride ridge |

### Generation prompts

**Pride marker road:** Wide 16:9 Kids & Dragons storybook environment of golden Eastern Plains at sunset. A dirt road makes a graceful wide curve around an unseen hot spot. Along the curve are low, plainly inanimate stone cairns and painted flat rocks with tiny rust-red fur tufts tied flat to stones; no upright posts. Tiny embermoth lights float above the grass. Warm gouache and watercolor; curve and cairns in upper half; lower 30% open level grass. No upright objects, figures, statues, scarecrows, people, animals, creatures, buildings, signs, text, UI, border or watermark.

**Sefa ridge camp:** Open manticore-pride camp on a low grass ridge in the Eastern Plains: empty fire ring, neatly placed cushions, shared honeycake on a wooden tray, warm plains beyond; road markers below bend away from camp. No den or building. Gentle evening light, welcoming storybook gouache/watercolor, gold grasses and sage shadows. Upper-half landmark; lower 30% open level grass. No people, cubs, animals, creatures, text, UI, border or watermark.

**Centaur sash barn:** Inside a long timber waystation barn, a wall of colorful stitched road-map sashes is being unpicked and resewn; spools and needles on shelves, large shared worktable with blank folded maps, hay lofts at sides. No readable writing or map labels. Warm daylight, tactile storybook gouache/watercolor. Sashes and beams upper half; clear wood floor lower 30%. No centaurs, people, animals, creatures, text, UI, frame or watermark.

**Pride stone crater:** Open golden pride-country grassland with a small round impact crater, no bigger than a wash tub; surrounding grass leans outward. A single warm amber gem rests in shallow crater, with a few tiny paw prints pressed in ash nearby. Mysterious but safe. Painted gouache/watercolor, late-afternoon gold and sage. Crater in upper half and off-center; lower 30% open level grass. No animals, creatures, people, buildings, text, UI, border or watermark.

**Abandoned caravan rest:** Old grassland rest stop with a few long-unused empty wooden carts and covered wagons parked off-road, quiet broken fence posts, and a cold fire ring; open plains beneath blue night sky. Gentle tension, safe storybook gouache/watercolor. Landmark upper half, lower 30% open level grass and dirt. No wolves, creatures, characters, buildings, text, UI, border or watermark.

**Pride night fire:** Single warm campfire on open pride-country grass below a low dark ridge; stars above distant gold plains, ridge curves around the camp, small amber gem glows faintly near the far horizon. Peaceful storybook watercolor/gouache, indigo night and amber firelight. Ridge and fire upper half; lower 30% open level earth. No people, animals, cubs, creatures, shelters, text, UI, frame or watermark.
## Gemfall 04C — The road that remembers

Eight character-free backdrops for the Great River road chapter. Generated at 1920×1080 WebP, quality 88; open foreground is reserved for the stage. The images support the scene progression without adding named characters or creatures.

| Asset | Coverage |
|---|---|
| `north-rush-road.webp` | Split upbound and downbound wagon lanes |
| `quiet-road-stretch.webp` | Empty road and silent jackalope warrens |
| `downbound-wagon-auction.webp` | Ma Ruddle's abandoned wagon auction |
| `downbound-soup-tents.webp` | Deep Hollow's three roadside rest tents |
| `warden-supply-stop.webp` | Skywarden supply stop on the plains road |
| `rush-depot.webp` | Strongbox barn, forms desk and ringing box |
| `relay-route-fire.webp` | Empty route-song campfire and trail tokens |
| `road-bend-grass.webp` | Night road bend marked by warm pawprints |

### Generation prompts

- `north-rush-road`: Wide 16:9 storybook painting of a Great River north road split into two broad dirt lanes, one busy with distant wagons, one slower with returning wagons. Open level foreground road, golden plains, no legible signage, no named figures, no foreground characters or creatures.
- `quiet-road-stretch`: Empty dirt road with several small jackalope burrow entrances and a clear uncanny silent gap around a distant gem depot. Gentle late-afternoon plains, open foreground, no jackalopes or other animals, no people, no text.
- `downbound-wagon-auction`: Quiet roadside wagon auction with several empty wagons, a plain auction table and scattered bundles, golden plains beyond, open foreground. No people, lettering, numbers or animals.
- `downbound-soup-tents`: Three simple Deep Hollow roadside soup tents with cots, folded blankets and bowls on tables, generous open foreground and warm dusk light. No people, readable text or animals.
- `warden-supply-stop`: Neat roadside patrol supply stop with ration crates, folded canvas and brass scales near an open plains road. No people, uniforms, emblems, animals or writing.
- `rush-depot`: Interior of a timber strongbox depot barn, rows of secured boxes and a long counter with an ink stamp and blank forms; one box glows softly. Open floor foreground, no clerk, no legible writing or creatures.
- `relay-route-fire`: Open night campfire beside a road with empty benches, route tokens and blank bark strips on a stone table. Peaceful indigo plains, foreground clear, no people, animals or text.
- `road-bend-grass`: Empty night road bending through tall grass, faint warm pawprints and tiny ember flecks crossing the dirt. Gentle suspense, open foreground, no wolves, animals, people, structures or text.

## Gemfall 04C — road episodes

Three new location backdrops keep the expanded road episodes visually continuous.

| Asset | Coverage |
|---|---|
| `north-road-detour.webp` | `scene_road_crew`, `check_haul_posts`, `scene_road_crew_ask_why`, `scene_road_crew_charm`, `scene_road_crew_fly` |
| `north-signpost-fork.webp` | `scene_signposts`, `check_read_signs`, `scene_signposts_buy_map`, `scene_signposts_outsell` |
| `north-noon-stop.webp` | `scene_rumor_fire`, `check_tall_tale`, `scene_rumor_fire_true_news`, `scene_rumor_fire_ford_news`, `scene_rumor_fire_marsh_news` |

All three are new 16:9 painterly road locations exported as 1920×1080 WebP at quality 88. The storybook compositions place landmarks in the upper half and leave the lower 30 percent clear for sprites; no characters or readable text.

### North road detour generation prompt

Create a painterly fantasy storybook game backdrop of a northbound caravan road rerouted around a scorched hollow. A graceful curve of road and newly planted marker posts skirts a dark circular patch where a gemstone fell; open gold-green plains, distant wagon line and blue foothills. Quiet mystery, late afternoon. Keep the curved road and posts in the upper half and a clear level packed-earth verge across the lower 30 percent. No characters, animals, signs with marks, text, UI or border.

### North signpost fork generation prompt

Create a painterly fantasy storybook game backdrop of a confusing fork on the northbound caravan road. A tall wooden signpost surrounded by many small blank direction boards has arrows pointing in contradictory directions; the road divides around a low grassy island and rejoins in the distance. Open grassland and distant wagons. Warm late morning. Signpost in upper half; lower 30 percent is a broad level dirt apron. All boards blank. No people, animals, creatures, lettering, UI or border.

### North noon stop generation prompt

Create a painterly fantasy storybook game backdrop for a midday caravan rest stop on the northbound road. A grassy turnout beside a packed-earth road has a cold stone fire ring, empty log seats and a kettle stand, distant wagons at the horizon, open plains and blue sky. Friendly afternoon. Keep the rest stop in the upper half and the lower 30 percent clear and level for sprites. No people, animals, creatures, signs, text, UI or border.
## Gemfall 05A — The bridge in the river

Five character-free backdrops for the northern bridge and its broken crossing. Generated at 1920×1080 WebP, quality 88; foreground remains open for the stage.

| Asset | Coverage |
|---|---|
| `northern-bridge-foot.webp` | North-bank approach and old bridge |
| `hollis-soup-queue.webp` | Soup queue and repair barrow |
| `bridge-engineers-tent.webp` | Engineers' tent and blank plans |
| `cracked-bridge-span.webp` | Cracked but passable bridge span |
| `bridge-pillar-shallows.webp` | Shallows beneath the bridge pillar |

### Generation prompts

- Northern bridge foot: Great River north-bank road approach to a broad old stone bridge, wagon ruts and repair bundles, river beyond, open dirt foreground; warm storybook watercolor and gouache; no people, animals, signs or text.
- Hollis soup queue: Roadside soup pots, bowls, blankets, canvas awnings and a plain barrow with a loose wheel beside the Great River; open foreground; no people, animals or lettering.
- Bridge engineers' tent: Open canvas engineer tent with timber braces, ropes, measuring rods, blank diagram sheets and tools on a table, river bridge beyond; no people, animals or text.
- Cracked bridge span: Old stone bridge over shallow blue-green water, one section cracked and tilted but passable, uneven paving and open stone path; no people, animals, signs or text.
- Bridge pillar shallows: Smooth stones and shallow water beneath a massive bridge pillar, reeds and ripples with a shadowed pocket; open shallow foreground; no people, wolves or other animals.

## Gemfall 05A — rim lookout

`redspire-rim-lookout.webp` covers `scene_rim_lookout`, `check_fires`, `scene_rim_lookout_send_word`, and `scene_rim_lookout_fly_redspire`. The view shows the road marker above the foothill campfires with Redspire in the distance.

Generated as a painterly 16:9 storybook environment and exported 1920×1080 WebP, quality 88. The lower 30 percent is a clear level rocky-grass platform; no characters or readable sign text.

### Rim lookout generation prompt

Create a painterly fantasy storybook game backdrop for a high rim lookout above the foothills on the road to Redspire. A simple freshly painted wooden road marker stands at a rocky ridge above tiny warm foothill campfires; far away, a black citadel catches the last red-orange light. Wind-bent gold grass, layered blue mountains and a dramatic but gentle twilight. Keep the marker and citadel in the upper half and a broad level platform in the lower 30 percent. No characters, animals, readable signs, text, UI or border.


## Cast figures

- **Mrs. Tuft** (`assets/cast/mrs_tuft/assembled.png`): One older sheeple provision-barge grocer, cream and smoke-grey wool, gentle age creases, spectacles, teal shawl, jar satchel, tiny blank price tags. Three-quarter left, full-body, transparent background.
- **Old Wick** (`assets/cast/old_wick/assembled.png`): One very old moss-green frogfolk lamplighter with age spots, a cloudy eye, faded indigo coat, brass lamp charms and walking stick. Three-quarter left, full-body, transparent background.
- **Postmaster Quill** (`assets/cast/postmaster_quill/assembled.png`): One individual tawny griffin postmaster with spectacles on a chain and a leather mail satchel holding blank envelopes. Three-quarter left, full-body, transparent background.

- **Bracken** (`assets/cast/bracken_swiftmile/assembled.png`): Chestnut centaur relay runner, green road sash and letter-filled saddle satchel.
- **Burdock** (`assets/cast/burdock/assembled.png`): Russet faun provisioner with leafy vest, bucket and abacus.
- **Mother Bracken** (`assets/cast/mother_bracken/assembled.png`): Tired, polite faun mother with travel shawl, braid and bags.
- **Littlest Bracken** (`assets/cast/littlest_bracken/assembled.png`): Small cinnamon faun child, oversized blue scarf and walking stick.

These figures follow the existing painted storybook cast style. Source prompts specify species silhouette, individual role, left-facing pose, full-body framing and no scenery. The four fauns/centaurs were generated on one transparent 2×2 sheet and cropped into individual cutouts.

- **Innkeeper Flint** (`assets/cast/innkeeper_flint/assembled.png`): Broad, gentle slate-grey stone troll with nightcap and apron.

- **Granny Ash** (`assets/cast/granny_ash/assembled.png`): Older manticore grandmother with silver-streaked rust fur, folded wings, curled tail and patched violet shawl.
- **Old Corran** (`assets/cast/old_corran/assembled.png`): Elderly dapple-grey centaur relay singer with silver mane and beard, wine-red shawl and wooden flute.
- **Nim** (`assets/cast/nim/assembled.png`): Small dragonling child with vivid mint-green scales, cream belly, mint wings, horns and bell collar.
- **Corporal Tibbet** (`assets/cast/corporal_tibbet/assembled.png`): Slate-blue griffin Skywarden with cream chest, green sash, bronze badge and clipboard.
- **Pib** (`assets/cast/pib/assembled.png`): Tiny bramble sprite made of dark twigs, thorns and fresh leaves.

## Expanded Gemfall cast figures

- **Brisk** (`assets/cast/brisk/assembled.png`): Alert bay centaur scout with a blue road sash, map and feather markers.
- **Perrin Nine-Verse** (`assets/cast/perrin_nine_verse/assembled.png`): Russet centaur poet with sandy mane, plum coat and verse book.
- **Bryony** (`assets/cast/bryony/assembled.png`): Mint-green dragonling collector with wings, horns and a cream pouch of tokens.

The figures were generated in two isolated 2×2 cutout sheets, then separated into individual 1024×1024 RGBA figures with feet set at y=900.
- **Lady Fleecewick** (`assets/cast/lady_fleecewick/assembled.png`): Elegant older sheeple collector with lavender curls, teal coat, jeweled brooch and ledger satchel.
- **Cadet Linnet** (`assets/cast/cadet_linnet/assembled.png`): Slate-blue griffin Skywarden with cream face, green cadet cloak and bronze badge.
- **Tansy** (`assets/cast/tansy/assembled.png`): Small russet faun child with yellow scarf and pink humming stone.

## Issue 170 — remaining expansion speakers (2026-10-15)

Generated with the built-in image-generation tool, one reference-based call per figure, with `transparent_background: true`. The source cutouts are retained in the generation library; project-ready figures are in `assets/cast/<id>/assembled.png`. The packaging script `art/source/package_gemfall_expansion_cast.py` trims transparent padding, proportionally resizes and registers the generated alpha on a 1024×1024 canvas at y=900. No painted pixels were retouched.

Odo, Corbin and Posy are Burrowfolk travelers; Rook is a Burrowfolk member of the mixed-peoples Deep Hollow faction. His bark mask and crystal distinguish allegiance. Posy has a separate standing figure because her later scene puts her on foot. The selkie grandmother keeps the established seal-cloak anatomy; the path-keeper is an elder bigfoot; the young gatherer remains a quadrupedal dragonling. The courier's navy sack and lack of spectacles distinguish him from Quill.

### Prompts and references

**`odo`** — reference: `assets/entities/burrowfolk/assembled.png`; source: `exec-c89584e7-fa19-4427-8b48-c7c6d041f4fe.png`.

Use case: illustration-story. Asset: one transparent full-body game cast cutout, 1024x1024 RGBA, three-quarter facing LEFT, relaxed standing, feet at y=900, generous transparent margin. Warm painterly storybook, hand drawn warm brown outlines, simple soft cel shading, expressive age-8-friendly face. No text, background, ground or shadow. Reference is species and house style only. Odo, a cheerful stocky adult Burrowfolk badger prospector with brown fur, cream face stripes, battered russet cap, patched indigo waistcoat. Standing beside his little wooden wheelbarrow heaped with brightly painted gravel and one warm glowing pebble. One badger only.

**`corbin`** — reference: `assets/entities/burrowfolk/assembled.png`; source: `exec-59c93662-6567-4de5-ab65-fb1cb0ca4237.png`.

Use case: illustration-story. Asset: one transparent full-body game cast cutout, 1024x1024 RGBA, three-quarter facing LEFT, relaxed standing, feet at y=900, generous transparent margin. Warm painterly storybook, hand drawn warm brown outlines, simple soft cel shading, expressive age-8-friendly face. No text, background, ground or shadow. Reference is species and house style only. Corbin, a tired but tender adult Burrowfolk badger father, cream face stripes, dark brown fur, faded olive traveling coat, patched leather shoulder pack, worn boots. Broad shoulders, weary kind eyes, hands open. One badger only; no child or barrow.

**`posy`** — reference: `assets/entities/burrowfolk/assembled.png`; source: `exec-0375f0d3-536a-4c96-bd0d-d3c9529c7ac1.png`.

Use case: illustration-story. Asset: one transparent full-body game cast cutout, 1024x1024 RGBA, three-quarter facing LEFT, relaxed standing, feet at y=900, generous transparent margin. Warm painterly storybook, hand drawn warm brown outlines, simple soft cel shading, expressive age-8-friendly face. No text, background, ground or shadow. Reference is species and house style only. Posy, a young Burrowfolk badger girl with brown fur, cream face stripes and rounded ears, worn ochre pinafore, rust-red scarf and small boots. Holding one softly glowing pink stone in both paws at her chest, hopeful serious expression. One complete standing badger child only, no adult.

**`rook`** — reference: `assets/entities/burrowfolk/assembled.png`; source: `exec-1ca12e3e-9c0b-46c6-9c48-064f3544f121.png`.

Rook, a prickly curious young Burrowfolk badger choir scout with cream facial stripes, a short dark plum traveling cloak, painted leaf-bark mask pushed up on the forehead so the friendly face shows, small humming rose crystal on a cord. Young adult, folded arms, curious sideways smile. One character only.

**`selkie_grandmother`** — reference: `assets/entities/selkie/assembled.png`; source: `exec-f773bfdb-522f-46b7-af83-4bf7815372e3.png`.

One elderly selkie grandmother welcoming newcomers, silver wavy hair, kind lined brown face and whisker freckles, seal-skin cloak with seal face and flippers like reference, teal knitted shawl, carrying a small bundled travel blanket. Stand facing LEFT, maternal, steady barefoot stance. No human replacement: visibly the seal-cloaked selkie people.

**`path_keeper`** — reference: `assets/cast/oldest_archivist/assembled.png`; source: `exec-ea410f96-2bde-437b-b8de-cafd57a36e6c.png`.

One old bigfoot path-keeper, sturdy cream-furred bipedal forest elder with shaggy moss-brown mane and greying beard, warm friendly face, holding an enormous open visitors book with knotted cords instead of writing and a ribbon bookmark. Full body standing facing LEFT. No bird, no box, no text.

**`young_gatherer`** — reference: `assets/characters/dragonling/fledgling/assembled.png`; source: `exec-e79239bb-e33a-43e9-a63e-a7b80cb4979e.png`.

One young quadrupedal dragonling girl, unmistakably same anatomy and colours as reference: pale mint scales, charcoal mane spines, orange wing membranes, cream belly. Small gathering bag strapped across back, flat loose pebbles visible at the rim; tail curled gently beside feet, folded wings, hopeful shy expression facing LEFT. Four feet on ground, no hands or clothes.

**`courier_griffin`** — reference: `assets/cast/postmaster_quill/assembled.png`; source: `exec-5bd615f3-0dc9-40e5-a4ea-f5310616d02e.png`.

Courier Griffin: one young working quadruped griffin, cream feather face and chest, russet wings, lion hindquarters, golden eagle forefeet, short tousled crest. No spectacles. Oversized worn navy-blue mail sack with blank envelopes and a neatly patched split seam, sling across body. Sheepish confident expression, wings folded, all four feet grounded. Match reference species but younger and distinct from postmaster.

### Corbin carrying Posy — continuity correction

`assets/cast/corbin_carrying_posy/assembled.png` is a pose variant generated with the built-in image-generation tool and `transparent_background: true`. References: the existing `corbin` and `posy` cutouts. Source: `exec-d640a683-7d79-4e64-9e44-3a90e72e4813.png`.

It appears in `scene_posy`, `check_posy`, `scene_posy_let_keep`, and `scene_posy_medal`. The later `scene_downhill_crowd_posy` keeps the separate on-foot figures. The combined figure uses `very_large` for its occupied height, so the two stacked characters remain readable; this does not redefine the Burrowfolk people's scale. Packaged with the existing registration script; lowest opaque row y=900.

Edit these two reference cast cutouts into ONE complete father-and-child cutout: Corbin carrying his small daughter Posy astride his shoulders. Preserve their exact identities, clothing, colors, painterly storybook style and three-quarter LEFT-facing orientation. Corbin is the adult Burrowfolk badger in worn olive coat, russet scarf, brown trousers and boots, shoulder bag. Posy is the small badger girl in ochre pinafore and russet scarf, boots, holding her glowing pink stone in BOTH paws in front of her chest. Posy's legs drape down either side of Corbin's neck, her seat rests firmly on his shoulders; Corbin supports her calves with both hands. She is clearly a small child, about one third his body height. Both faces visible. Corbin stands solidly with both boots on same floor line. Entire combined pair fits on a square transparent canvas with generous margin around ears, tails and boots. Genuine transparent background, NO floor, shadow, text, border or extra characters. This is one stage figure, feet bottom at y=900 on a 1024x1024 canvas; keep generous headroom.
