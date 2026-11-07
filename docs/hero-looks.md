# Hero looks: a colour and a name style of her own

**Status: design approved (2026-11-07), nothing built.** Every decision in §11 is *decided*: the
product owner's own on 2026-11-07, and the rest approved with this doc after two design reviews
the same day. Nothing is still only proposed. The second revision answered the first review: the gear portraits (§4), book edits against the revision (§3.2), every
hero drawing path (§9), the nameplate's geometry (§7.2), offline prefetch (§5.4), the tinter's
cache and edge cases (§5.3, §5.5), and the shelf's name (§8.1).

**Review status:** repository references are implementation context. File names, type names and
interfaces below are the intended shape, and may be refined during implementation as long as the
behavior they describe holds.

**Purpose:** a kid makes a hero once and plays them for months. Today the only personal touches
are the name and the accent colour the server assigns. The camp gave each hero a kit to make her
own; this does the same for the hero herself. She chooses the **colour** of one part of her (her
coat, her mane, her scales) and the **style of her name**: a nameplate frame and a title earned
in play.

## 1. What it is, and what it is not

- **It is** one recoloured region per painting, a nameplate frame, and a title line under the
  name. All of it is chosen in the adventure book or at the table, from a starter set plus looks
  earned in play.
- **It is not** worn accessories, expressions, poses, animation variants, or new body shapes.
  The spec's old step 4 (horn shape, wing style, markings) stays removed, and `hornStyle`,
  `wingStyle` and `markings` on `Appearance` stay dead fields.
- **It is not** at character creation (*decided*). Creation stays as quick as it is, and draws
  every hero as painted. The first look is chosen the first time she opens the book or sits at a
  rest.
- **It never changes play.** No look has a rule attached, and the story never names one.

## 2. The proof of concept (2026-11-07)

Before writing this doc we tinted two paintings with throwaway masks: the fledgling unicorn
(light lavender coat, purple mane) and the fledgling Bigfoot (cream coat, dark brown mane), each
in five colours per region, and compared the camp kit's tint with a new one.

- **The colour swap works.** Recolouring in OKLab, keeping each pixel's step of lightness from
  the region's middle (§5.2), keeps the painted shading, the fur strokes and the outlines, for a
  light coat going dark (Midnight unicorn) and a dark mane going light (silver Bigfoot).
- **The camp kit's tint is not enough.** Multiplying luminance by the colour, as the tent cloth
  does, is fine going darker but cannot go lighter: a silver Bigfoot mane comes out a dull grey.
- **The masks are the work.** Picked out by colour alone, they bleed wherever two parts share a
  colour: Bigfoot's tan skin and cream coat, his brown mane and brown outlines. Every shipped mask
  is hand-cleaned and reviewed (§4.3).
- **The best region differs by species.** The unicorn's coat is clearly hers. Bigfoot's mane
  changes his look more, and masks cleanly, while his coat runs into his skin.

## 3. The data

### 3.1 The look

A new `look` on the hero, beside `kit`, not inside `Appearance`. `Appearance` is
set by the server and its `accent` is the player's identity colour; the look is the kid's.

```ts
/** `Character.look`: what she has chosen to look like (docs/hero-looks.md). */
interface HeroLook {
  v: number;                        // LOOK_VERSION
  revision: number;                 // bumped by every write (§3.2)
  coat: CoatId | null;              // null: as painted
  nameplate: NameplateId | null;    // null: the plain plate
  title: TitleId | null;            // null: no title line
  unlocked: Record<LookId, LookUnlock>;
}

interface LookUnlock {
  from: "starter" | "found" | "milestone";
  rewardId?: RewardId;              // the find that gave it (§6)
  at?: string;                      // ISO; absent on a backfilled milestone
  /** Where it came from, as the book says it: "Finished The Gemfall". */
  source?: string;
}
```

- **`coat` is the code's name, never the kid's.** The field is `coat` whichever part of the
  species it colours; the book and the table call it **Color** (§8.1).
- **Absent until chosen.** A hero with no `look` draws exactly as today. Nothing is backfilled on
  write, so old heroes, saved runs and the Gemfall gameplay digests do not move. Starter looks
  are implied (§6), not stored; milestone looks are backfilled on read, as the kit's are
  (camp.md §12.3).
- **The colour follows the hero, not the painting** (*decided*). One `coat` tints whichever
  painting she is drawn with: every tier, every class, the world figure and the portrait (§4).
- **One catalog** (`content/looks.json`, validated by a new schema): coats, frames and titles,
  each with its name, its unlock rule, and for a coat its colour or effect.

### 3.2 Edits from two places

The look is edited exactly as the kit is (camp.md §7, §11), with the same two rules:

- **At the table: optimistic concurrency.** `LOOK_EDIT` names the look's `revision`, and a look
  changed since (from the book, another phone) refuses it as stale. The phone is online and
  sees the refusal at once, and the editor shows the look as it now stands.
- **From the book: a field-level merge, the device winning.** A book write carries no revision.
  Each field it changes applies over whatever the server has by then, and fields it does not
  change are left alone. Queued edits are sent one at a time, oldest first, so **the last choice
  for each field wins**: blue then purple, both made offline, ends purple.
- **The server always checks** that the hero is the writer's own, that every look named is
  unlocked for her, and that a colour named is one of **her species'** colours (each species has
  its own set, §7.1). On the book route a look that is not hers is skipped and the rest apply, and
  the book says it could not be saved (as `merge` does for the kit).
- **A book edit and a table edit to the same field:** whichever reaches the server last stands.
  Both bump the revision, so a table editor open on the old look is refused once and refreshes.
- **A family tablet keeps nothing offline.** Its picked kid has no device token, and nothing of
  hers is kept on the tablet (#661): her change is shown at once from memory, sent with her room
  session straight away, in tap order, or not at all. This limitation is kept, not lifted.

Both routes reuse #661's code: the device-bound queue (`kit-queue.ts`), its sender
(`book-kit-sync.ts`) and its endpoint, with look changes as new change kinds; and the tablet's
in-memory pending list.

## 4. The coloured region

### 4.1 Which paintings: three families, 168 in all

A hero is drawn from three families of painting, and every one needs a mask:

| Family | Path | Count | Used for |
|---|---|---|---|
| Base | `assets/characters/<species>/<tier>/assembled.png` | 24 | Fledglings everywhere; the fallback for every hero |
| Class (world) | `assets/character-rigs/<class>/<tier>/<species>/assembled.png` | 72 | Classed heroes on the TV stage and in-play screens (`characterWorldArtUrl`) |
| Gear portrait | `assets/gear-portraits/<class>/<tier>/<species>.png` | 72 | Classed heroes' still portraits on phones and in the book (`characterPortraitArtUrl`) |

The gear portraits are separate commissioned paintings: the same hero and gear, painted again on
a full painted background (opaque, 1254 square). We keep them, and mask them too,
rather than show the world figure in their place; they are better portraits, and already paid
for. So a classed hero's colour appears on both of her paintings, and a test draws one classed
hero at Sworn, Radiant and Mythic on the TV, the book and a phone, side by side, to check the two
families agree.

A painting with no mask yet draws as painted. On a classed hero that can mean her portrait shows
her colour and her world figure does not, or the other way round, for as long as one family is
ahead of the other; the art waves (§10) ship a species' class paintings and gear portraits
together to keep that window short.

### 4.2 The format

- **One mask per painting:** `coat-mask.png` beside an `assembled.png`, and
  `<species>.coat-mask.png` beside a gear portrait.
- **8-bit greyscale, on the painting's own canvas,** registered pixel for pixel. White is
  coloured, black is not, and the edges are soft (fur is fluffy; a hard edge reads as cut out).
- **One region per species** (*decided*: one region), chosen **per species** (from §2). A first pass, confirmed on each species' clean masks:

  | Species | Region | Why |
  |---|---|---|
  | Unicorn | Coat | The light coat is most of her; the mane stays her painted accent |
  | Bigfoot | Mane | The changed mane reads from the couch; the coat runs into his skin |
  | Dragonling | Scales | To confirm on the masks |
  | Griffin | Feathers | To confirm on the masks |
  | Kitsune | Fur | To confirm on the masks |
  | Manticore | Mane | To confirm on the masks |

  Every painting of a species, in all three families, colours the same part of her.
- **What never takes the colour:** eyes, outlines, skin, horns and claws, gear, the class
  costume, and a gear portrait's background.

### 4.3 How the art pipeline makes and checks them

1. `npm run art:coat-draft -- <species>` writes a draft mask for every painting of the species,
   picked out by colour as in §2. It is a starting point, never shipped as is.
2. An artist cleans each mask by hand (any editor; the mask is a plain PNG).
3. `npm run art:sheet` gains a colour page: each painting, its mask overlaid, and four test tints
   (one light, one dark, one saturated, one grey), for review before it ships.
4. `npm run art:verify` gates every mask: its size matches its painting's; its coverage is sane
   (neither empty nor the whole canvas); and on a transparent painting, it lies inside the
   painting's own alpha. A gear portrait is opaque, so the review sheet is its only check that
   the background stays out.
5. `assets/manifest.json` lists which paintings have masks, so the client never asks for a mask
   that does not exist (as `figureVariants` does for class art).

## 5. The tinter

### 5.1 One resolver, one tinter, two outputs

- **One hero-aware resolver** (`world/hero-art.ts`) answers "what does this hero
  look like here", for the two kinds of place a hero is drawn: `world` (the figure on a stage)
  and `portrait` (a still). It wraps `characterArtUrl`, `characterWorldArtUrl` and
  `characterPortraitArtUrl`, picks the painting as today, and applies her colour when the
  painting has a mask. Every surface that draws **a player's hero** goes through it (§9).
  Character creation and non-player art (the cast, enemies, other creatures) do not.
- **One tinter** (`world/hero-coat.ts`) turns a painting, its mask and a coat into a tinted
  canvas, and from it:
  - **for Pixi,** a texture, as `campKitCanvas` does for the kit;
  - **for the DOM,** an object URL, for `CharacterPortrait` and the `<img>`s that take a URL
    today, through a `useHeroArt(hero, place)` hook.

Both come from one pass, so the TV and every phone show the same hero.

### 5.2 The colour swap

For each coloured pixel, in OKLab:

- **Lightness:** the coat's target lightness, plus the pixel's own step from the region's mean
  lightness, so shadows stay shadows and highlights stay highlights. Going from a light region to
  a dark coat, the steps are softened a little (×0.85) so it does not go muddy. The result is
  clamped to 0.04–0.98, so nothing goes to pure black or blows out to pure white.
- **Hue:** the coat's.
- **Chroma:** the coat's, varied gently with the pixel's own (square root of its ratio to the
  region's mean, clamped to 0.6–1.4), so a painted gradient keeps some life. **A near-grey
  region** (mean chroma under 0.02, a white or grey coat) has no ratio to keep: every pixel takes
  the coat's chroma as is.
- **Out of gamut:** a colour sRGB cannot show is brought in by lowering its chroma at the same
  lightness and hue, never by clipping each channel (which shifts the hue).
- **Blend:** by the mask's value, so soft edges stay soft.

The region's mean lightness and chroma are computed once per mask. A unit test pins the
arithmetic (as `shadedPixel` does for the camp's shadows), including the near-grey, gamut and
clamping cases, and a sheet like §2's is kept as the reference.

### 5.3 Its cost, and its cache

- **Off the main thread.** The pass runs in a worker with an `OffscreenCanvas` where the browser
  has one, else in small slices between frames. The hero draws as painted until it is done.
- **Each request is deduplicated:** two surfaces asking for the same painting and coat at once
  share one pass.
- **The latest choice wins.** Each hero's request carries a sequence number; a pass that
  finishes after she has picked another colour is thrown away, not shown, and a queued pass for
  a colour no longer wanted is cancelled.
- **A bounded cache, by memory.** Each entry counts its real size: a tinted 1024 canvas
  (a world figure or base painting) is about 4 MiB, a 1254 gear portrait about 6 MiB. The cache
  holds at most 48 MiB, enough for four heroes' world figures and portraits with room for the
  book's preview, and evicts the least recently used first.
- **What is on screen is kept.** An entry in use, by a Pixi sprite or by a mounted DOM image
  (`useHeroArt` holds it while the image is mounted), is never evicted; the cache goes over its
  bound before it pulls art out from under the screen, and settles back once those let go. An
  evicted entry revokes its object URL and destroys its Pixi texture. The source painting and mask are not held
  once the pass is done; the region's means are, as numbers.
- **A test switches colour ten times in a row,** quickly, on a throttled midrange phone profile:
  the last colour shows, no earlier one flashes after it, and the evictable entries (those
  nothing on screen holds) never total more than the bound. Entries held on screen may take the
  total over it for as long as they are held, and are evicted once let go.

### 5.4 Offline

A mask is art like the painting and is cached by the service worker, but being cached is not
the same as being fetched before the signal goes. So **the prefetch fetches the mask with the
painting**, wherever a hero's painting is prefetched today:

- the chapter's art (`sw/chapter-art.ts`), for every seated hero, both her world figure and her
  portrait;
- the book's warm step (#661), for her look shelves' preview.

A test opens a hero the phone has seen before, offline, and finds her chosen colour on her.

### 5.5 Special coats

A few earned coats are more than a colour (*decided*):

- **Two-tone:** the region's lighter half takes one colour, its darker half the other, with a
  soft step between. A still image, so it costs nothing extra.
- **Shimmer:** a plain or two-tone coat with a slow highlight sweeping across the region every
  few seconds. On the TV it is a sprite over the hero, masked by the region mask. In the DOM it
  is an element laid **over** the image (never behind it: a gear portrait is opaque and would
  hide it), its moving gradient clipped by the region mask (`mask-image`), so it lights only her
  coloured part. **Under reduced motion** it is a still sheen, and no sweep.

## 6. Unlocks

- **Starter looks** are free from the start, for every hero, old or new.
- **Earned looks** come the ways the camp's things do:
  - **finds** in chapters, as content effects (camp.md §5.1);
  - **milestones** for tiers, class ranks and finishing a campaign;
  - **the camp:** a first friend, a full camp.
- **Each unlock keeps a receipt** (`LookUnlock`), so the book can say where it came from, and a
  new one is announced once, where the kit's are.
- **Once, forever, and only cosmetic.** An unlock is never taken back, whatever happens to the
  run: a lost fight, a setback ending, a chapter replayed (camp.md §12.2).
- **Gemfall is pinned.** A look find in a Gemfall chapter re-takes its hashes deliberately, with
  the reason in the commit, and its gameplay digests must not move.

## 7. Palettes, frames and titles

### 7.1 Colours

- **Starter colours:** about six per species, natural for it (a unicorn's are pale; a Bigfoot
  mane's are browns, black, ginger and grey). Free from the start.
- **Earned colours:** new hues, and the special coats (§5.5).
- **Checked by a test, on the rendered hero,** not on swatches: each colour applied to the
  species' base painting, and measured as the mean colour of the region, at the size a phone's
  portrait draws it.
  - **Against the backdrops:** OKLab distance ≥ 0.10 from every backdrop's ground colour, so a
    hero never disappears into the scenery.
  - **Against each other:** within one species' starter set, every pair is told apart under
    normal vision and under simulated deuteranopia, protanopia and tritanopia, by an OKLab
    distance ≥ 0.08 **or** a lightness difference ≥ 0.10. Natural sets (two browns) pass on
    lightness, as real browns are told apart.
- The player's accent is untouched, so a colour never clashes with "whose hero is whose".

### 7.2 Nameplates

**The name is drawn exactly as today.** The player's identity accent is unchanged, and hero looks
do not change the name's typography or colours (*decided*): on the TV that is the light ink
(`0xf6f3ff`) with the dark stroke and the tuned `NAMEPLATE_FONT`, sized for the lineup and the
combat board, and wherever a screen already shows the player's colour, it still does. The frame
and the title are the kid's to choose. The look adds two things around the name, and
neither may cost it any size:

- **A frame,** UI art rather than hero art (#665): plain (the default, which is today's look),
  ribbon, leafy, starry, plus earned ones. Drawn behind the name, nine-sliced to its width, with
  the stroke kept, on the TV (`world/nameplate.ts`) and in every DOM nameplate.
- **A title line** under the name, everywhere, the TV lineup included (*decided*): "Pip" over
  "the Brave". The title is drawn at 0.6 of the name's size. **When the room is short, the title
  is hidden, never shortened:** on the TV a title that would draw under 14 pixels tall at 720p,
  or would overlap a neighbour's plate, is not drawn, and the name keeps its place. The book
  always shows it.

The existing nameplate collision tests (the lineup and the board) are extended to two rows and
the frame: four heroes with 16-character names and the longest titles in the catalog, at every
party size, never overlap and never draw a name under its current minimum.

### 7.3 Titles

Titles come from things the game already tracks:

| Source | Example |
|---|---|
| Starter (free) | the Bold, the Kind, the Curious |
| Tier | the Sworn, the Radiant |
| Class rank | Thornguard Master |
| Campaign finished | of the Gemfall |
| The camp | Friend of Bun, Keeper of the Fire |

Titles are kept short, and the collision test (§7.2) uses the longest in the catalog. A title
that still does not fit a crowded lineup is hidden there (§7.2), never cut.

## 8. Where it is changed

### 8.1 The adventure book

A **Look** page beside Camp, built like #661's dressing room:

- her hero at the top, large, wearing the look as she taps;
- shelves: **Color**, **Nameplate**, **Title**, each a row of tiles, the chosen one marked by
  more than colour. "Color", not "Coat", because the part that changes is her mane on some
  species and her coat on others; the tiles show her hero wearing each one, so she sees which
  part it is;
- earned looks she does not have yet are not shown. Nothing is a locked tease;
- every tap is a save, silently, online or queued offline (§3.2). Nothing says "saving".

### 8.2 At the table

A compact Look editor in her phone's panel during downtime (the lobby and rests), next to the
kit's. `LOOK_EDIT`, unlimited, as `KIT_EDIT` is (*decided*), naming the look's `revision`
(§3.2). The TV shows the change at once.

## 9. Where she is drawn

**Every surface that draws a player's hero shows her colour and name style.** The inventory is a
deliverable of #666, not a guess: the list below is where the paintings are picked today, and a
test enumerates it (below).

| Surface | Today | Family |
|---|---|---|
| TV stage: scene, lineup | `world/scene.ts`, `world/actor-art.ts` | world |
| TV combat board | `world/board.ts` | world |
| Camp and the lobby's camp | `world/camp.ts`, `world/lobby-camp.ts` | world |
| Still stage (no WebGL) | `world/StaticStage.tsx` | world |
| Still camp (no WebGL) | `world/StillCamp.tsx` | world |
| Story interactions | `screens/InteractionArt.tsx`, `screens/InteractionExtras.tsx` | world |
| Minigames | `screens/SkillGame.tsx`, `screens/RelayGame.tsx`, `screens/RelayFlightGame.tsx` | world |
| Portraits: phones, the book, arrivals | `screens/CharacterPortrait.tsx` and its callers | portrait |
| Offline prefetch | `sw/chapter-art.ts`, `sw/prefetch.ts` | both, plus masks (§5.4) |

**Not through the resolver:** character creation (she has no look yet), and non-player art.

**The check:** a test lists every call of `characterArtUrl`, `characterWorldArtUrl`,
`characterPortraitArtUrl` and `gearPortraitUrl` in the client, and fails on one outside the
resolver, the creation screens and the service worker, unless an allow-list names it with a
reason. A new screen that draws a hero cannot skip her colour by using a different helper.

## 10. Building it in phases

Each phase is playable on its own.

1. **Name style** (#664, #665): frames and titles, data, intents, both editors, drawn everywhere.
   No hero art is needed.
2. **Colours on the base paintings** (#666, #667): the resolver and the inventory (§9), the
   tinter, colour data, starter palettes and editors; masks for the 24 base paintings.
3. **Colours on the classed heroes** (#668): the 72 class paintings and the 72 gear portraits,
   in waves, a species' two families together (§4.1).
4. **Earned looks** (#669): unlock effects, milestones, receipts, special coats.
5. **Playtest** (#670).

## 11. Decisions

| Decision | Status |
|---|---|
| Body colours and name style; no accessories, expressions, poses or animation variants | *decided* |
| A starter set free, the rest earned in play | *decided* |
| Changed in the book and at the table, not at creation | *decided* |
| One coloured region per painting | *decided* |
| The colour carries over to every tier and class painting | *decided* |
| Titles show everywhere, the TV lineup included, under the name | *decided* |
| The player's accent is unchanged; looks do not change the name's typography or colours; the frame and title are the kid's | *decided* |
| Some earned coats are special: shimmer or two-tone | *decided* |
| Unlimited edits at the table | *decided* |
| The colour swap in OKLab, keeping lightness steps (§5.2), not the kit's multiply | *decided* (POC §2) |
| The region is chosen per species (§4.2) | *decided* (POC §2) |
| Masks are drafted by a tool and hand-cleaned, never shipped raw | *decided* (POC §2) |
| The gear portraits are kept and masked too: 168 masks (§4.1) | *decided* (review) |
| Table edits name a revision; book edits merge per field, last choice wins; the server checks owner, unlock and species (§3.2) | *decided* (review; as the kit) |
| A family tablet keeps nothing offline, as in #661 | *decided* (review) |
| One hero-aware resolver, and a test that no hero painting bypasses it (§9) | *decided* (review) |
| The name drawn exactly as today; a title hidden, never shortened, when short of room (§7.2) | *decided* (review) |
| Masks prefetched with their paintings (§5.4) | *decided* (review) |
| A tint cache bounded by real memory, never evicting what is on screen; the latest choice wins (§5.3) | *decided* (review) |
| The shelf is called Color; the field stays `coat` | *decided* (review) |
| `look` beside `kit`, absent until chosen | *decided* |
| One catalog for coats, frames and titles (`content/looks.json`) | *decided* |
| Locked looks are not shown | *decided* |
| A few titles are free starters | *decided* |

## 12. Acceptance criteria

- **The tinter:** a unit test pins the colour swap, with its near-grey, gamut and clamping cases;
  the reference sheet is regenerated and compared.
- **Masks:** `art:verify` passes every shipped mask (§4.3); a painting without one draws as
  painted, without errors or a request for a missing file.
- **Palettes:** the backdrop and colour-blind tests (§7.1) pass for every colour.
- **The inventory:** the resolver test (§9) passes.

| Case | Expected |
|---|---|
| Two colour edits made offline in the book | After sync, the later one stands |
| A book edit and a table edit to the same field | Whichever reached the server last stands; the stale table editor is refused once and refreshes |
| A look she has not unlocked, or another species' colour, from the table or the book | Refused (table) or skipped and said (book) |
| A family tablet's taps, quickly, then a refusal | Shown at once, sent in order, the refused one rolled back |
| A classed hero at Sworn, Radiant and Mythic | The same colour on the TV, the book and a phone, world figure and portrait |
| A class painting or gear portrait with no mask | Drawn as painted, without errors |
| Offline, a hero seen before | Her chosen colour shows: painting and mask were prefetched |
| Four heroes with 16-character names and the longest titles | No overlap; no name smaller than today; titles hidden rather than cut |
| Ten colour switches in quick succession, throttled phone | The last shows, none flashes after it; unpinned entries stay within the bound, pinned ones are released once let go |
| An unlock earned in a campaign already under way | Announced once, kept through a lost fight or setback, changes nothing in play |
| An old hero with no look | Drawn and played exactly as today; the Gemfall gameplay digests do not move |
| A shimmer coat on a gear portrait | The sweep shows over the painting, only on her coloured part |
| A shimmer coat under reduced motion | A still sheen, no sweep |

## 13. Playtest questions (#670)

- Do kids notice their own colour on the TV, and do they find their hero faster or slower?
- Do they change looks often, or pick once and keep it?
- Do titles get read aloud, or ignored?
- Does an earned coat feel like a reward, or go unnoticed?
- Does anyone lose track of whose hero is whose?
