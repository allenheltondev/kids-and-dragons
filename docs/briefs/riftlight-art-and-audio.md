# Brief: Riftlight's art and audio

**Status:** open; Parts B (cast) and the finale items wait on the owner decisions in §3. For the
image- and audio-generation agents. This brief is the complete specification for everything new
that Riftlight (working name Continental Rift) needs on screen and in the speakers. The design it
serves is in `docs/campaigns/continental-rift/`; read the README and `mechanics.md` before
starting.

**Contains spoilers.** This file names the campaign's secret antagonist so the people making his
art and music know what they are making. Nothing you ship may (§2).

---

## 1. Why, and what already exists

Riftlight is a nonlinear campaign about rifts: ancient magic that moves places and creatures, read
by the colored light it gives off. The game cannot teach that rule set unless the rifts look and
sound like their rules.

A lot of what it needs is already shipped. **Do not redo any of it:**

- **Backdrops** (`assets/biomes/`): every region the campaign visits: `glacier_of_origins`,
  `frostfang_peaks`, `sky_islands`, `sallow_wastelands`, `bone_yard`, `red_sky_foothills`,
  `exchange`.
- **Creatures** (`assets/entities/`): `frost_wyrm`, `snowhorn_goat`, `bone_crawler`,
  `cloud_whale`, `yeti`.
- **Cast** (`assets/cast/`): `old_ossley`.

What is new, in the order it is needed: the rift itself and its sounds (Part A), the people
(Part B), the special places (Part C), the music (Part D), then the finale (Part E).

## 2. The spoiler rule — read this first

`assets/manifest.json` and every file under `assets/` ship to every phone. A file list is readable
by anyone, so **no id, filename, manifest name or path may contain "Corvane", "Pangea",
"emperor" or anything that says there is a hidden ruler.** Use the neutral ids this brief gives
(`cast/the_old_king`, `music/riftlight-finale`, `scenes/riftlight/glacier-deep-ice`). The
manifest `name` of a cast figure is shown to nobody but must follow the same rule. Prompts you
record may name him; they live in docs, not in `assets/`.

## 3. Owner decisions this brief waits on

These are canon calls, not art calls. **Do not decide them; do not start the items they block.**

| Decision | Blocks |
| --- | --- |

Everything else in this brief can start now.

## 4. Read first

- `docs/asset-brief.md` §2 (style) and §9.4–§9.8 (effect sheets, manifest flags, acceptance).
- `docs/briefs/story-cast-art.md` §3 (the figure contract) and §5 (the backdrop composition rule).
  Both apply here unchanged.
- `docs/audio-pipeline.md`: every cue and track is a row in
  `packages/client/src/audio/paths.ts` (`CUE_SPECS`, `MUSIC_SPECS`), and real audio is an upgrade,
  never a requirement.
- `docs/campaigns/continental-rift/mechanics.md` §"The palette" and §"Where a rift goes".

---

## Part A — the rift, and how it sounds (priority 1: the prologue needs it)

### A1. The rift effect

The campaign's signature visual. One rift, built so its **rules** read as color and its
**conditions** read as motion, and so every color also has a **pattern** for players who cannot
tell colors apart.

**The palette (agreed, do not change):**

| Layer | Meaning | Pattern (must read in grayscale) |
| --- | --- | --- |
| Green | A requirement is not met yet | Slow breathing pulse |
| Amber | Single-use: collapses after one crossing | A single candle-like flicker |
| Blue | Persistent: stays open | Steady ripple |
| Violet | One-way | Light spirals inward, like an arrow |

**Not allowed anywhere in a rift:** red (it means the red sky), white or silver (silver is the
Hollow Crown's), gold (too close to amber on a TV).

**Sheets to make**, all `effects[]` entries with `loop`/`outOfCombat` flags as §9.7 of the asset
brief defines them:

| id | Kind | Frames | Notes |
| --- | --- | --- | --- |
| `rift_base` | loop | 12 | The tear itself, colorless and quiet, so color layers compose over it |
| `rift_green`, `rift_amber`, `rift_blue`, `rift_violet` | loop | 12 | One color layer each, with its pattern. Any two or three stack over `rift_base` and must still read |
| `rift_shrink` | loop | 12 | Timed: the rift visibly contracts |
| `rift_stutter` | loop | 12 | Unstable: it skips and jolts, irregular |
| `rift_sync` | loop | 12 | Linked: a steady beat, so two rifts can pulse together |
| `rift_open` | one-shot | 12 | |
| `rift_collapse` | one-shot | 12 | Amber's end: folds closed, gentle, never an explosion |

Acceptance: §9.8 of the asset brief, plus a contact sheet showing every common stack (green +
amber + violet; amber + violet; green + blue; blue) in color **and** grayscale side by side. **The
grayscale column is the review.**

### A2. Two icons

Item-icon format, as `assets/items/*`:

- `listening_chime`: a small Riftseeker resonance chime: silver fractured-circle emblem,
  teal or indigo cord. A quest item.
- `riftspark`: a +2 spark of rift light for the buff list. It must not use a palette color, so
  it never reads as a rift rule.

### A3. Sound cues

Each is a new `CUE_SPECS` row and `CueId`; each needs a synth recipe in `synth.ts` like every cue
(audio pipeline rule).

| Cue | Brief | Seconds |
| --- | --- | --- |
| `rift-open` | A soft inward rush of air and a glassy rising shimmer, like a breath held. Wonder, not threat. | 2.0 |
| `rift-collapse` | The same shimmer folding closed and settling into silence. Gentle, never a bang. | 1.6 |
| `chime-sour` | One small Riftseeker chime struck, its note bending flat and wobbling: "not yet". | 1.4 |
| `chime-echo` | The same chime struck, and its note coming cleanly back a moment later: "you can come back". | 1.8 |
| `attune-hum` | A low warm hum that answers someone, swelling in once. Distinct from `gate-hum`. | 3.0 |
| `riftspark` | A quick bright sparkle and a small rising tone: you got a boost. | 0.9 |
| `anchor` | A deep, steady settling tone, like a stone set into place: the land holding still. | 2.0 |

The two chime cues must be told apart by ear alone, by a child, from across a room.

---

## Part B — the people (priority 2)

Figure contract: `story-cast-art.md` §3, unchanged (1024², feet at y = 900, three-quarter view
facing left, no text). Pilot first and stop for review, as there.

### B1. The Riftseekers

Art direction from canon (`faction.riftseekers`): mystical aura; dark teal, indigo and violet
cloaks; asymmetrical practical expedition gear; a silver fractured-circle emblem; shimmering
seams; instruments, resonance rings and chimes. A fellowship that looks like one, and five people
you can tell apart from across a room.

A mixed fellowship from across the realm, so the rifts visibly touch everyone; with B2's locals, every playable species appears on stage.

| id | basis | Who | Read at a glance |
| --- | --- | --- | --- |
| `orin_vale` | `griffin` | Master Orin Vale (he/him), methodical scholar | Patient, careful, notebooks and instruments, older |
| `lady_olivia` | `unicorn` | Lady Olivia (she/her), ambitious rival | Bright, confident, mischievous; the most striking cloak. Never sinister |
| `seren_wisp` | `kitsune` | Seren Wisp (she/her), attunement specialist | Calm, listening; resonance rings |
| `pip_thistledown` | `manticore` | Pip Thistledown (he/him), eager scout | Young, quick, lightly packed, always mid-step |
| `bram_lock` | `bigfoot` | Bram Lock (he/him), Orin's guard | Broad, steady, protective; a shield or staff, not a weapon that wounds |

### B2. Locals the strands need

| id | basis | Who |
| --- | --- | --- |
| `yeti_elder` | `yeti` | An elder of the reading rooms; old, gentle, frost in the fur |
| `kitsune_temple_keeper` | `kitsune` (species) | A Sky Islands temple keeper. Kind and dignified: kitsune are never drawn as tricksters by default |
| `dragonling_stone_keeper` | `dragonling` (species) | A grown dragonling who keeps the Red Sky Foothills boundary stones |
| `saltrot_guide` | `skipperfolk` (B3) | A Skipperfolk guide of the brackish flats, crest half raised, mud-wet and weathered |

An adult of a playable species must be unmistakably that species (`story-cast-art.md` §2).

### B3. A new people: the Skipperfolk (entity and canon in one PR)

The Saltrot's own people, approved by the owner: amphibious **mudskipper-and-pufferfish** folk
found **only in brackish water**. Canon keeps every people 1:1 with its art
(`packages/canon/src/canon.test.ts`, "asset_id is a real join"), so the entity and the canon entry
land **in the same PR**, as `story-cast-art.md` Part C does for new peoples.

**The entity** (`assets/entities/skipperfolk/`, scale `small_to_medium`, the §6.4 entity
contract): an upright mudskipper body on strong front fins used as forearms; big round eyes set
high on the head; a tall dorsal crest; a small fused beak; mottled **olive and gold** skin with
dark spots, wet with mud. Keep the skin off bright rift green, amber, blue and violet so a
Skipperfolk never reads as a rift rule. Draw two states: **ordinary**, and **puffed**, perfectly
round with soft spines standing out (a startle, never a threat). Friendly, nosy, a little comic.

**The canon, to land with it:**
- Add `skipperfolk` to `people_ids` in `canon/npcs.yaml`, and this entry before `npc.boggart`:

```yaml
  - id: npc.skipperfolk
    asset_id: skipperfolk
    title: "Skipperfolk"
    canon_status: newly_defined
    classification: supporting_people
    sapience: sapient
    featured: false
    tags: [supporting_people, saltrot, amphibious, brackish, guide]
    scale: small_to_medium
    short_description: >-
      Amphibious mudskipper-and-pufferfish people of the Saltrot's brackish
      flats, who guide travelers across mud nobody else can stand on.
    visual_identity: >-
      Upright mudskipper-like body on strong front fins used as forearms, with
      big round eyes set high on the head that pop up to watch the flats, a
      tall dorsal crest raised to signal, and a small fused beak. Mottled olive
      and gold skin with dark spots, kept wet with mud. When startled or
      delighted they puff up perfectly round, soft spines standing out.
    common_story_uses: >-
      Saltrot guide, flood-namer, retriever of travelers who tried the flats
      alone, first to notice that the floods are changing.
    canon_constraints: >-
      Found only in brackish water: fresh water and dry land dry them out, and
      the open sea is too salty, so they do not live anywhere but the
      Saltrot's flats and channels. They are the Saltrot's guides; the guides'
      lore in biome.sallow_wastelands is theirs. No poison, ever: their spines
      are soft and harmless, and puffing up is a startle, never an attack.
    speech_register: >-
      Quick and chatty, with cheerful bluntness and times given by the tide
      rather than the sun ("two crabs past the ebb"). A guide who has gone
      quiet and very round is a guide who has just seen something.
    standard_behavior: >-
      Memorizes each season's safe paths, names the great floods, signals
      across the flats with raised crests, cracks shellfish on the shell-banks,
      and keeps the flats crossable for travelers who respect them.
    lore:
      hook: "The only people who can walk on the Saltrot, and the only ones who would want to."
      story: >-
        Skipperfolk move in quick little skips across mud that swallows
        boots, and they live in burrow towns dug into the flats with air kept
        in pockets below. Every great flood resets the town, so nothing they
        build is meant to last and nobody minds. Puffing up is not a choice: a
        startled skipper goes round and floats, which on the flats is useful.
        A puffed guide bobbing in a flooded channel is a buoy for anyone stuck,
        and the polite thing is to hold on and not mention it afterward.
      pastimes:
        - "Crab clocks. Fiddler crabs wave at the turning tide, and a good skipper can tell the time to the minute by how many are waving."
        - "Crest signaling. Greetings, warnings and gossip travel across the flats faster than anyone can walk them."
        - "Flood naming, argued over for a whole season. A flood is not properly over until it has a name everyone can live with."
      social: >-
        Friendly, nosy and frank. A skipperfolk guide will tell you your boots
        are wrong, your route is wrong and your lunch smells interesting, all
        before you have finished saying hello. Some guides are generous, some
        strict, a few famously grumpy, and every one of them refuses to take
        anybody to the buried bridge.
      likes:
        - of: npc.frogfolk
          because: "The neighbors at the fresher edge of the flats. Frogfolk boats bring the river's news down, and skipperfolk guides take it the rest of the way."
      dislikes:
        - of: creature.bone_crawler
          because: "They swarm anything with fresh magic in it, and the flats are the only way to the Bone Yard, so it is the guides who keep pulling travelers out of the swarm."
    relationships:
      primary_locations: [biome.sallow_wastelands]
      secondary_locations: []
      creatures: [creature.bone_crawler]
      items: []
```

- In `canon/npcs.yaml`, add `biome.sallow_wastelands` to `npc.frogfolk`'s `secondary_locations`.
- In `canon/biomes.yaml`, `biome.sallow_wastelands` → `inhabitants`: `primary_peoples:
  [npc.skipperfolk]`, `supporting_peoples: [npc.frogfolk]`.
- Run `npm run canon:check`, `canon:field-guide`, `canon:world`, `canon:bestiary`, and add
  `npc.skipperfolk` to `EXPECTED_UNREACHABLE` in `tools/content/field-guide-reach.test.mjs` (no
  chapter reveals them yet). The full test suite must pass.

---

## Part C — special places (priority 3)

Backdrops for the scenes that need more than their biome. 1920 × 1080 WebP at
`assets/scenes/riftlight/<id>.webp`, listed in `manifest.sceneIllustrations`, composed by
`story-cast-art.md` §5 (floor line 80% down, landmark in the top half, no figures, no lettering).

| id | Place | Landmark |
| --- | --- | --- |
| `ice-shelf-headwaters` | The ice shelf above the Great River where it leaves the glacier | The young river far below, roaring out of the ice |
| `reading-room` | A yeti reading room cut into memory ice | Ice walls with faint shapes frozen inside |
| `cairnstep` | A Frostfang pass marked by griffin watch cairns | A line of cairns climbing to a notch in the peaks |
| `buried-bridge` | The Saltrot's buried bridge, newly uncovered | An old stone bridge spanning mud, where no river runs |
| `temple-island-squall` | A Sky Islands temple island in a storm | A second island drifting too close |
| `stuttering-flats` | The Saltrot mudflats around an unstable rift | Empty space where the rift will be composited; leave it clear |

Leave the rift itself out of every backdrop: it is the A1 effect, composited live.

---

## Part D — music (priority 3)

Each track is a `MUSIC_SPECS` row. Music is keyed by **biome**, and Gemfall never uses any of the
biomes below, so mapping them changes nothing in Gemfall. `sky_islands` currently borrows
`forest`; it moves to its own track.

Every track carries the **rift motif**: a short, simple, slightly unresolved phrase, four or five
notes, that a child could hum. It is the campaign's signature, the way the rift effect is.

| Track | Biomes (`MUSIC_BY_BIOME`) | Brief | Seconds |
| --- | --- | --- | --- |
| `riftlight-theme` | none (see the note below) | The rift motif stated plainly over warm strings and a soft glassy shimmer. Curious, a little wondering, gentle enough to talk over. | 40 |
| `riftlight-paths` | `glacier_of_origins`, `frostfang_peaks` | Slow, cold and still: sustained low tones, ice-like bell overtones, the motif carried by a low voice of the ensemble. Memory and patience. | 40 |
| `riftlight-sky` | `sky_islands` | Airy and drifting: high breathy winds, slow swells like whale song in the distance, the motif floating in and out. | 40 |
| `riftlight-coast` | `sallow_wastelands`, `bone_yard` | Brackish and restless: low reeds, a slightly uneven pulse, wet percussion, the motif slipping in rhythm. | 40 |

**Code needed, outside this brief:** music is chosen only by a chapter's biome today, so
`riftlight-theme` (meant for the prologue at the Exchange) and `riftlight-finale` (Part E, at the
glacier) have no way to play until the per-chapter music override in
[#226](https://github.com/allenheltondev/kids-and-dragons/issues/226) lands. Deliver the tracks anyway.

---

## Part E — the finale (priority 4)

### E1. `the_old_king`

Corvane: an ancient ruler, newly woken after a millennium, who wants his old world back and
does not understand why everything is "wrong". **Confused above all**, courtly, sad and certain:
an old king, not a monster. **A faun** (`basis: faun`): half person, half goat, but
**exceptionally big** (`scale: very_large`; ordinary fauns are `medium`), barrel-chested and
stocky, with a **long, sweeping mustache** and old curling horns. Gruff and grand on the
outside, bewildered underneath. Robes and regalia of a realm that no longer exists, a little
weathered by ice. He must read as the same species as `assets/entities/faun`, older and far
bigger. Nothing frightening, no weapon that wounds. Cast figure contract as Part B. Do not name
or imitate any existing film character in prompts; describe him from this text.

### E2. `glacier-deep-ice`

The finale backdrop, in the deep ice at the heart of the Glacier of Origins: the place the story
began. Wide, open floor for a battle, with a clear space where his final rift is composited.
**Not** the summer crevasse (no green light, no warmth): that stays a separate, unexplained place.

### E3. `riftlight-finale` and the `anchor` cue

His theme: the rift motif played **old and slightly out of step**, like a song remembered wrong.
Slow, regal, a little sorrowful, never menacing. 45 seconds. The `anchor` cue (A3) plays as each
Pangea fragment holds the land still; it should sound like the finale's answer to his theme.

---

## 5. What you must not change

| Path | Rule |
| --- | --- |
| `assets/biomes/**`, `assets/entities/**`, `assets/characters/**`, `assets/cast/**` (existing), `assets/effects/**` (existing) | Never modified; you add new entries |
| `canon/*.yaml` | Not at all. Canon questions go to the owner (§3) |
| `content/**` | Not at all: Riftlight's chapters do not exist yet |
| `packages/**` | Only the `CUE_SPECS`, `MUSIC_SPECS`, `CueId`, `MUSIC_BY_BIOME` rows and synth recipes Part A3 and Part D name |

## 6. Reporting

One PR per Part, A first. Each PR: every id with its manifest entry, every "you decide" call and
why, the verify output (`npm run art:verify`, and the audio gate), contact sheets (A1's grayscale
column included), and the prompts used, recorded in `docs/campaigns/continental-rift/` under a new
`art-and-audio-log.md`. Check every filename against §2 before opening the PR.
