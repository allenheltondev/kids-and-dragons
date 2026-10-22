# Story plates: the prologue and chapter plates

Paintings with the story told over them, shown **before** the table is asked to decide anything.

- A campaign's **prologue**: a short series (3 to 6 plates) before the first scene of its opening
  chapter. It puts the table in the world and raises the question the campaign answers.
- A **chapter plate**: one painting and a sentence or two, before the first scene of a chapter
  that begins somewhere new. It says where we are.

Both are skippable and shown once per device. This document is the spec for the **art** (what to
paint, how it is cropped, how to hand it over) and for the **content** that asks for it. The code
that plays them is `packages/client/src/screens/StoryPlates.tsx`.

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

### The rules (`content:validate` and `tools/content/story-plates.test.mjs` enforce them)

- A prologue has **3 to 6** plates. Go for 4.
- Each plate's narration is **at most 45 words**: two or three short sentences. It is read aloud
  from a TV to a child of about eight, over a painting that is the point.
- **The same words for every party.** No `{tokens}`, no counting the party ("all three of you"),
  no great stone (`facet_*`), no em dashes. Nothing may depend on a choice the party made.
- `art` is `plates/<campaign id>/<name>`: no extension, in the campaign's own folder, and no
  painting used twice. Name prologue plates `prologue-1` to `prologue-N` and a chapter's plate for
  the chapter without the campaign prefix (`riftlight-finale` → `finale`).
- **Every `art` is declared in `assets/manifest.json` → `storyPlates.ids`, and nothing else is.**
  Adding a plate to content without adding it there fails the test, which is how the art tools
  know what is owed.
- A campaign's opening chapter takes **the prologue or a plate, never both**.

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

### What belongs in a chapter plate

A place and a feeling, not an event. The chapter's own first scene does the introducing; the plate
only sets the stage, so it names no people and nothing a party might not know. Because a graph
campaign can be entered in more than one order, a plate must read true for every way in.

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

## 4. Riftlight: what is owed

Nine paintings. The narration is already in the content; the prompts are in
[story-plates-prompts.json](story-plates-prompts.json).

**Prologue** (`content/campaigns/riftlight.json`, plays once, before *Snow on the Quay*):

| File | Shows | Narration |
|---|---|---|
| `prologue-1` | The Exchange quay on a golden morning, busy and warm | The Exchange is the busiest harbor in the realm… |
| `prologue-2` | A bell hung in a cut face of blue glacier ice | Far to the north, a glacier shines in the sun… |
| `prologue-3` | A thin ribbon of snow wind crossing the realm, south | Nobody at the Exchange can hear that bell… |
| `prologue-4` | The quay again, snowing out of a clear sky, everyone looking out at us | By breakfast it arrives… |

**Chapter plates** (each before that chapter's first scene):

| File | Chapter | Shows |
|---|---|---|
| `sky-islands-arrival` | Land Under an Unfamiliar Sky | Drifting stone islands, gold-roofed temples, hanging roots |
| `saltrot-arrival` | Mud Where Ice Should Be | Gray-green brackish mudflats, silt banks, drowned trees |
| `cairnstep-pass` | A Pass Not in the Ledger | Stacked cairns climbing a notch between snowy peaks |
| `reading-room` | The River in the Memory Ice | A room carved from blue glacier ice, lantern-lit |
| `finale` | The Glacier Remembers | The glacier quiet and enormous, the wind holding its breath |

## 5. Adding plates to another campaign

1. Write the `prologue` (and any chapter `plate`s), following section 2.
2. Add each `art` id to `assets/manifest.json` → `storyPlates.ids`.
3. Add the prompts to [story-plates-prompts.json](story-plates-prompts.json).
4. `npm run content:validate`. For a **graph** campaign, also `npm run content:proofs` and commit
   what it writes (it re-fingerprints the campaign).
5. Gemfall is pinned (`gemfall-compat.test.ts` hashes every Gemfall file). Adding a prologue to it
   is a deliberate content edit: re-take those hashes and say why in the commit.
