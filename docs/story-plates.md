# Story plates: the prologue, chapter plates and epilogues

Paintings with the story told over them, shown **before** the table is asked to decide anything,
and once more at the very end.

- A campaign's **prologue**: a short series (3 to 6 plates) before the first scene of its opening
  chapter. It puts the table in the world and raises the question the campaign answers.
- A **chapter plate**: one painting and a sentence or two, before the first scene of a chapter
  that establishes the chapter's setting, mood and immediate situation. It invites children
  into the next problem without revealing an outcome. Riftlight uses one for every chapter
  after its prologue, as does every Gemfall road and pursuit variant.
- A campaign's **epilogues**: a short series (2 to 4 plates) for each way the campaign can end,
  after the ending scene's own words and before the summary's tally. What came after: the
  picture-book's last pages.

Both are skippable and shown once per device. This document is the spec for the **art** (what to
paint, how it is cropped, how to hand it over) and for the **content** that asks for it. The code
that plays them is `packages/client/src/screens/StoryPlates.tsx` (`StoryPlates` at a start,
`EpiloguePlates` at the end).

> **What is owed, live: `npm run art:inventory`** ("Story plates"). **Mechanical check:
> `npm run art:verify`.** **Composition check: `npm run art:plates`** (below).

---

## 1. How it plays

1. A run reaches a chapter's first scene. If the campaign has a `prologue` and this is its opening
   chapter, or the chapter has a `plate`, and this device has not shown it, the painting comes up
   over the whole pane. (A graph campaign's opening chapter is its entry node's, an ordered
   campaign's is index 1.)
2. Each plate crossfades in with a slow push or pull on the painting. Its words are read aloud and
   shown in a band over the lower part. The first plate wears the title: the campaign's for a
   prologue, the chapter's for a plate.
3. **The shared screen turns the pages by itself**, a plate staying up as long as its words take
   to say (about two seconds plus 0.4 s a word, between 6.5 and 22 seconds). It has nothing to
   tap ([the TV is read, not driven](tv-read-only-audit.md)). A remote's OK (Enter) turns a page
   and Escape skips the rest, on any screen. A phone's pane (Travel Mode) shows **Next** and
   **Skip** buttons.
4. When the last plate is done or skipped, this device remembers it (`kad.plates.seen`), and the
   chapter starts as it always did: "Last time…", the goal, then the first scene's story, read
   aloud. Until then they all wait.
5. **A painting that has not been delivered is left out.** Every painting is fetched up front; the
   ones that arrive play, in order. A reel with none is passed over for that page load, without
   being remembered, so the first load after the art ships plays it. Nothing breaks and nothing is
   blocked on the art.

### At the end: the ending's words, then the epilogue

1. An ending scene (`"choices": []`) ends the chapter the moment it opens. The summary that
   follows heads with **the ending scene's own words** (composed for this party, variants and
   all) and reads them aloud first. That is true of every chapter's ending, epilogue or not.
2. On the completion that **ends the campaign** (`RunState.campaign.ended`), if the campaign
   names an epilogue for the scene the party ended on, and this device has not shown it, the
   summary shows and says the ending's words alone, under its heading, and holds the rest (the
   tally, the recap, "Keep going"). Once they have had time to be read (about two seconds plus
   0.4 s a word, between 6.5 and 60 seconds; a remote's OK brings it up sooner), the epilogue
   comes up over the summary and plays like a prologue: the first plate wears the epilogue's
   `title`, the name history gives the party.
3. Its paintings are fetched the moment it is due, **while** the ending is read, not after. A
   painting that has not been delivered is left out, as at the start; if none arrives (each gets
   PLATE_LOAD_MS, which is shorter than the shortest hold) the epilogue is passed over for this
   page load then and there, and the summary goes on at once.
4. When it is done or skipped, this device remembers it (`epilogue:<campaign>:<id>`) and the
   summary shows and says the rest: the campaign's ending line, the XP, the recap. Skipping
   (Escape, or Skip on a phone's pane) also silences the plate being read, for any reel, so what
   follows is heard at once rather than queued behind it.
5. A run in a campaign the lobby did not launch has its campaign file fetched. Until it lands
   nobody knows whether an epilogue follows, so the summary says nothing and shows the ending
   alone, for at most four seconds (`CAMPAIGN_WAIT_MS`); if the file has not come by then, it
   speaks as if there were none, and that completion goes without an epilogue even if the file
   lands a moment later (it is not remembered as seen, so the next completion still gets one).
6. If a phone taps "Keep going" during the epilogue, play moves on and the reel goes away,
   unmarked, as a prologue does.

Not in v1, on purpose: skipping on the shared screen from a phone (it needs a protocol message),
a way to watch the prologue again, and holding the phones' choices until the reel ends. If a phone
chooses during a reel, play moves on and the reel goes away, unmarked.

## 2. Writing the content

### A prologue (`content/campaigns/<id>.json`)

```json
"prologue": {
  "plates": [
    { "art": "plates/riftlight/prologue-1", "narration": "The Exchange is the busiest harbor…" },
    { "art": "plates/riftlight/prologue-2", "narration": "Far to the north, a glacier shines…" }
  ]
}
```

### A chapter plate (`content/chapters/<id>.json`)

```json
"plate": { "art": "plates/riftlight/sky-islands-arrival", "narration": "High above the realm…" }
```

### An epilogue (`content/campaigns/<id>.json`)

```json
"epilogues": [
  {
    "id": "heroes",
    "title": "The Heroes of Red Sky",
    "chapter": "gemfall-08",
    "endings": ["ending_heroes"],
    "plates": [
      { "art": "plates/gemfall/epilogue-heroes-1", "narration": "The bells ring the happy ring all morning…" }
    ]
  }
]
```

### The rules (`content:validate` and `tools/content/story-plates.test.mjs` enforce them)

- A prologue has **3 to 6** plates. Go for 4. An epilogue has **2 to 4**. Go for 3.
- Each plate's narration is **at most 45 words**: two or three short sentences. It is read aloud
  from a TV to a child of about eight, over a painting that is the point.
- **The same words for every party.** No `{tokens}`, no counting the party ("all three of you"),
  no great stone (`facet_*`), no em dashes. Nothing may depend on a choice the party made.
- `art` is `plates/<campaign id>/<name>`: no extension, in the campaign's own folder, and no
  painting used twice. Name prologue plates `prologue-1` to `prologue-N` and a chapter's plate for
  the chapter without the campaign prefix (`riftlight-finale` → `finale`), and an epilogue's
  plates `epilogue-<id>-1` to `epilogue-<id>-N`.
- **Every `art` is declared in `assets/manifest.json` → `storyPlates.ids`, and nothing else is.**
  Adding a plate to content without adding it there fails the test, which is how the art tools
  know what is owed.
- A campaign's opening chapter takes **the prologue or a plate, never both**.
- An epilogue's `endings` are ending scenes of the campaign's last chapter (for a graph
  campaign, scenes with `endsCampaign`), and **each ending leads into at most one epilogue**.
- An epilogue's words **name nobody its endings have not**: every capitalised name must appear
  in its title, the prologue, the ending scenes' own narration (variants do not count: not every
  party hears them), or the narration of every scene that leads into the ending. A capitalised
  word that opens a sentence counts as a name unless the campaign writes it in lowercase
  somewhere. Like `content:continuity`, it cannot see "the jar"; read for those.

### What belongs in a prologue

It is a picture-book opening, so the same continuity rules as a chapter apply, and a few more:

- **Introduce, don't resolve.** It sets the world and raises the campaign's question. It never
  answers it, never spoils an ending, and never touches a protected mystery.
- **Everything a prologue names, a later scene may use.** It is the first thing a table sees, so a
  person, place or thing introduced here is introduced. But don't introduce what the first chapter
  introduces better (Riftlight's goat is met in the chapter, not the prologue).
- **A sequel's prologue is ending-neutral.** It never says how the previous campaign ended.
- **End on a hook that is a stake for the party**: the last plate hands the question to the table.
- Warm, a little spooky, never scary. One concrete detail a child can picture and repeat.

### What belongs in an epilogue

The ending scene has just said what happened; the epilogue says what happened **next**. It is the
one plate allowed to resolve, because the story is over.

- **Carry on from the ending's words; never repeat them.** The table has just heard them. Plate 1
  starts a little after (the walk home, that summer, the next morning) and the last reaches
  further (years later, every spring).
- **Read true for every party that reached that ending.** Variants on an ending scene (what the
  party carried, why it came) are not heard by everyone, so an epilogue never leans on them.
  Name only who the ending itself names; the validator holds you to it.
- **A setback ending gets an epilogue too**, and it ends on a spark like the scene does: grief
  and consequence, never despair, and a door left open.
- **End on a spark or a small joke** a child can repeat: the goat ringing the bell, the welcome
  mat, the cake shaped like a mountain.
- **Protected mysteries stay protected** in the art even when the words resolve: Gemfall's titan
  is never drawn, only implied by light and warmth.

### What belongs in a chapter plate

A place, a feeling and a concrete invitation to play. Show the chapter's starting situation:
a goat separated from its herd, a griffin lowering a ladder, or an enormous sleepy tenant
blocking a doorway. Creatures and unnamed local helpers can appear when they are present at
the chapter's opening; keep named introductions and explanations in the scene itself. The
painting should let a child anticipate what they might do, while leaving the decision and
outcome unseen. Keep the party offscreen and protected mysteries unrevealed. Because a graph
campaign can be entered in more than one order, the situation must read true for every way in.

## 3. The art

### Format

| | |
|---|---|
| File | `assets/plates/<campaign id>/<name>.webp` |
| Size | **1600 × 900** (16:9), exactly. `art:verify` fails any other size |
| Encoding | WebP, RGB, fully **opaque** (no transparency), Lanczos resize, quality 90, method 6 |
| Weight | Aim for under 400 KB each. A prologue is 4 files, and the TV fetches them all up front |
| Content | **No text** of any kind: no title, letters, numbers, labels, signs with words |

Same hand as the lobby key art (`assets/campaigns/`): a crafted children's storybook painting,
visible brush texture, softly drawn edges, broad gouache-like colour masses, friendly wonder at
age eight. Plates are *bigger* and *quieter* than key art: they are looked at for 10 to 20 seconds
rather than glanced at on a card, so there is room for one beautiful, readable idea and a little
extra to find.

### Safe area (this is the part that matters)

The painting is shown with `object-fit: cover`, centred at 50% across and 45% down, in whatever
shape the pane is, and the narration is printed over its lower band. So:

```
 ┌────────────────────────────────────────────────────────────┐
 │            │                                │              │
 │  atmosphere│     ESSENTIAL SUBJECT          │  atmosphere  │  upper 72%: the picture
 │  (may be   │     middle 42% of the width    │  (may be     │
 │   cropped) │     (x 462 to 1138 of 1600)    │   cropped)   │
 │            │                                │              │
 ├────────────┴────────────────────────────────┴──────────────┤
 │  lower 28% (y 648 to 900): QUIET. Low detail, a little     │  caption band: the narration
 │  darker. Ground, water, snow, shadow. No faces, no focal.  │  is printed here
 └────────────────────────────────────────────────────────────┘
```

- **Essential subject: the middle 42% of the width.** On the TV the whole 16:9 is seen. On a phone's
  pane (3:4) only the middle 42% survives. Everything the plate is *about* lives there.
- **Quiet lower 28%.** The narration sits on a dark gradient over it. Put foreground texture, water,
  snow, planks, shadow there: nothing a child needs to see and no face.
- **Wide atmosphere** (the outer 29% each side) is for sky, scenery and depth. It is seen on the TV
  and cropped on a phone, so nothing needed to understand the plate goes there.
- **Slow push.** The painting scales up to 8% over its time, around the focus point. Keep the
  subject comfortably inside the safe area so the push never crops it, and give the edges some room.
- **Legible at 350 px wide** and at a squint: a strong, simple value structure, one clear focal
  point per plate.

`npm run art:plates` writes a review image per delivered plate to `art/review/plates/` (gitignored):
the TV view with the caption band shaded and the surviving middle outlined, beside the phone crop.
**If the subject is outside the outline, or a face is under the shaded band, redo it.**

### Colour and light

- Warm and cool carry the story. Use a colour change *between* plates in a prologue as the
  storytelling beat (Riftlight: warm harbor → cold glacier → the wrong wind → warm harbor, snowing).
- No purple/cyan neon, no airbrushed 3D, no photorealism, no heavy fine detail.
- Consistent light direction within a prologue (upper-left, as the key art).
- The same world as the game's backdrops: match `assets/biomes/<biome>/bg.webp` and the scene
  illustrations (`assets/scenes/`) for architecture, plants and palette. Existing paintings are the
  reference; attach the nearest one when generating.

### Always

- **No humans.** The realm's people are animal folk: frogfolk, kitsune, griffins, yetis and so on
  (`canon/`). When a crowd appears, it is a crowd of them.
- **Never scary, never violent.** Wonder, a little mystery. Nothing grisly, no weapons drawn.
- **Protected mysteries stay protected.** Nothing inside the ice or the rift, no figures, no faces
  in the glacier. The prompts say so; keep it.
- **Heroes are never drawn.** The party is one to four heroes of any species; a plate can be seen
  *from their point of view*, never show them.

### Delivery

1. Paint to the prompts in [story-plates-prompts.json](story-plates-prompts.json) (full text per
   plate; the file also records each plate's narration and where it plays).
2. Export to `assets/plates/<campaign id>/<name>.webp` as above.
3. `npm run art:verify` (size, format, opaque; refuses an undeclared file), `npm run art:inventory`
   (the count drops), `npm run art:plates` (look at it).
4. Commit the files. Nothing else changes: the manifest and content already name them.

## 4. Coverage

All 85 paintings are delivered: 49 for Gemfall and 36 for Riftlight. Each campaign's four-plate
prologue represents its opening chapter; Gemfall's other 15 authored chapters (including all
road and pursuit variants) and Riftlight's other 23 chapters each have their own representative
plate; and every ending of each campaign's last chapter has a three-plate epilogue (30 for
Gemfall's ten endings, 9 for Riftlight's three; #562). The narration is in the content; the
prompts are in [story-plates-prompts.json](story-plates-prompts.json).

### Gemfall

**Prologue** (`content/campaigns/gemfall.json`, before chapter 1, *The City That Smelled
Opportunity*). The eruption has **not** happened yet when chapter 1 begins (`scene_red_sky` is where
the sky turns red, a few scenes in), so the plates are the quiet before it: the legend, the ordinary
world, the first stir, and the Exchange lighting its lamps. They hand off to chapter 1's own narrated
opening ("This is the Realm of Red Sky…"), which they do not repeat. Nothing here explains the
stones, the seal or the titan.

| File | Shows | Narration |
|---|---|---|
| `prologue-1` | Mount Red Sky by moonlight, huge and sleepy, one ember glowing in the crater | Mount Red Sky has been quiet for longer than anyone can remember… |
| `prologue-2` | A sunny village crossroads: bakers, a mail griffin, a runaway hat | Down in the realm, everybody gets on with things… |
| `prologue-3` | The crater up close, one spark floating into the stars | But tonight, high in the north, the red glow… |
| `prologue-4` | The Exchange harbor at dusk, the Long Bridge's lamps being lit, an empty pier | Far to the south, the Exchange is lighting its harbor lamps… |

**Chapter plates** (15, covering every road and pursuit variant):

Gemfall has eight story beats and 16 authored chapter files. A playthrough sees its prologue
and seven chapter plates; the selected branches each have their own painting.

| File | Chapter | Shows |
|---|---|---|
| `02` | Green Roads North | A stopped faun watering her hoof while a sprite watches the approaching rush |
| `03a` | The Long Mile | A mossy toll-troll listening for a riddle, with a bird nesting on his shoulder |
| `03b` | What the Marsh Remembers | A frogfolk ferrywoman, bell ribbons and curious new marsh wisps |
| `03c` | The Ford That Decides | A muddy wagon and a centaur handing out queue tokens at the ford |
| `04a` | The Pride Roads | A watchful manticore and freshly replanted markers bending the road |
| `04b` | The Forest Takes Attendance | A counting fern, a poised acorn and a waiting bramble curtain |
| `04c` | The Road That Remembers | A seated mule chewing a daisy while its owner pleads |
| `05a` | The Broken Bridge | A griffin engineer examining the cracked bridge with chalk |
| `05b` | MossHome and the High Paths | A bigfoot archivist at a living tree door, carrying knotted record cords |
| `05c` | The Boundary Stones | A dragonling grandmother inspecting a pack with a small bell |
| `06` | Ashfall | A grandmother disputing a prospector's doorstep claim beneath Redspire |
| `07r` | The Returning | A glitter-filled wheelbarrow jammed between rocks in the Pinch |
| `07h` | The Collection | A dragonling lookout and rival buyers watching the approaching caravan |
| `07l` | The Tether | A wobbly door-table and a knitting grandmother between two arguing factions |
| `08` | Gemfall | Two routes up the glowing mountain while a prospector hurries downhill |

**Epilogues** (`content/campaigns/gemfall.json`, after the endings of *Gemfall*, `gemfall-08`).
Every ending of the finale has one, setbacks included. The words carry on from the ending
scene's own, name only who it names, and never show the titan:

| Epilogue | After | Plates |
|---|---|---|
| `heroes`: *The Heroes of Red Sky* | `ending_heroes` | 3 |
| `heroes-destroy`: *The Heroes of Red Sky* | `ending_heroes_destroy` | 3 |
| `quiet-fixers`: *The Quiet Fixers* | `ending_quiet_fixers` | 3 |
| `collectors`: *The Collectors* | `ending_collectors` | 3 |
| `wardens-regret`: *The Wardens' Regret* | `ending_wardens_regret` | 3 |
| `cure`: *The Cure* | `ending_cure` | 3 |
| `new-weather`: *The New Weather* | `ending_new_weather` | 3 |
| `turned-back`: *Turned Back* | `ending_turned_back` | 3 |
| `last-ring`: *The Almost-Heroes* | `ending_last_ring` | 3 |
| `broken-tether`: *Still Holding* | `ending_broken_tether` | 3 |

### Riftlight

**Prologue** (`content/campaigns/riftlight.json`, before *Snow on the Quay*):

| File | Shows | Narration |
|---|---|---|
| `prologue-1` | The Exchange quay on a golden morning, busy and warm | The Exchange is the busiest harbor in the realm… |
| `prologue-2` | A bell hung in a cut face of blue glacier ice | Far to the north, a glacier shines in the sun… |
| `prologue-3` | A thin ribbon of snow wind crossing the realm, south | Nobody at the Exchange can hear that bell… |
| `prologue-4` | The quay again, snowing out of a clear sky, everyone looking out at us | By breakfast it arrives… |

**Chapter plates** (23, each before that chapter's first scene):

| File | Chapter | Shows |
|---|---|---|
| `glacier-survival` | A Bell in the Snow | A bleating goat kid separated from its herd by meltwater |
| `riftseekers-departure` | A Map with a Missing Pass | Map and travel packs on a sledge outside the singing hall |
| `ice-shelf-traverse` | The Path Beside the River | A narrow blue ice path beside the Great River |
| `hidden-glacier-rift` | The Note Under the Ice | A listening chime beside a shivering fold in the air |
| `headwaters-washout` | The River Chooses a Road | A water-level escape view, travel rope and an approaching ice handhold |
| `frostfang-shore` | A Way Back Uphill | A helpful griffin lowering a ladder above the rising water |
| `cairnstep-pass` | A Pass Not in the Ledger | Stacked cairns climbing a notch between snowy peaks |
| `boundary-stone-bank` | The Stones Above the Water | Weathered boundary stones above the river |
| `ashspan-bridge` | When the Ferry Goes Your Way | A flat ferry waiting below the stone bridge |
| `sky-islands-arrival` | Land Under an Unfamiliar Sky | Drifting stone islands, gold-roofed temples, hanging roots |
| `saltrot-arrival` | Mud Where Ice Should Be | Gray-green brackish mudflats, silt banks, drowned trees |
| `stone-counters` | The Stone That Moved | A boundary stone beside an empty hollow in the grass |
| `whale-road` | The Whales' Turning Place | Cloud whales turning above a grassy island |
| `buried-bridge` | A Bridge Without a River | Old stone arches over a dry silt channel |
| `the-wrong-valley` | The River Takes Another Valley | A dry old channel beside a fresh river in the next valley |
| `reading-room` | The River in the Memory Ice | A room carved from blue glacier ice, lantern-lit |
| `the-island-due-back` | The Island Due Back | A lookout bell and a low island emerging from cloud |
| `stuttering-flats` | The Stuttering Flats | An unexpected patch of snow on the coastal mudflats |
| `bone-yard` | The Borrowed Ruins | Pale ancient arches and displaced stone ruins |
| `wyrm-nest` | A Room Already Taken | A sleepy frost wyrm using a bench as a pillow while a yeti builder waits |
| `squall-temple` | The Temple in the Squall | A gold-roofed temple island in sweeping rain |
| `convergence` | The Maps Come Together | A sheltered map table overlooking the blue glacier |
| `finale` | The Glacier Remembers | The glacier quiet and enormous, the wind holding its breath |

**Epilogues** (`content/campaigns/riftlight.json`, after the endings of *The Glacier Remembers*,
`riftlight-finale`). The two success endings share their ending scene's words, so the
epilogue carries what the scene before (`keepers` or `listened`) decided:

| Epilogue | After | Plates |
|---|---|---|
| `keepers`: *The Glacier Keepers* | `keepers_epilogue` | 3 |
| `listened`: *The Ones Who Listened* | `listened_epilogue` | 3 |
| `rivers-wander`: *Rivers Wander* | `loss_epilogue` | 3 |

## 5. Adding plates to another campaign

1. Write the `prologue` (and any chapter `plate`s and `epilogues`), following section 2.
2. Add each `art` id to `assets/manifest.json` → `storyPlates.ids`.
3. Add the prompts to [story-plates-prompts.json](story-plates-prompts.json).
4. `npm run content:validate`. For a **graph** campaign, also `npm run content:proofs` and commit
   what it writes (it re-fingerprints the campaign).
5. Gemfall is pinned (`gemfall-compat.test.ts` hashes every Gemfall file). A change to its campaign
   file or a chapter is a deliberate content edit: re-take that file's hash, say why in the test
   header and the commit, and the gameplay digests must not move. (Its prologue was added this way.)
