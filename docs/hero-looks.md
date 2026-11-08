# Hero looks: her colours and a name style of her own

**Status: design approved (2026-11-07); phase 1, the name style, built (#664); phase 2, colours (the tinter, data, editors and offline), built (#666), waiting on masks (#667, #668); phase 4, earned looks, built (#669), its frame art owed (#680); two parts and whole-figure specials (owner, 2026-11-07; #662), built.** Every decision in §11 is *decided*: the
product owner's own on 2026-11-07, and the rest approved with this doc after two design reviews
the same day. Nothing is still only proposed. The second revision answered the first review: the gear portraits (§4), book edits against the revision (§3.2), every
hero drawing path (§9), the nameplate's geometry (§7.2), offline prefetch (§5.4), the tinter's
cache and edge cases (§5.3, §5.5), and the shelf's name (§8.1).

**Review status:** repository references are implementation context. File names, type names and
interfaces below are the intended shape, and may be refined during implementation as long as the
behavior they describe holds.

**Purpose:** a kid makes a hero once and plays them for months. Today the only personal touches
are the name and the accent colour the server assigns. The camp gave each hero a kit to make her
own; this does the same for the hero herself. She chooses the **colours** of two parts of her
(a unicorn's coat and mane, a Bigfoot's fur and skin), earns **specials** that go over her whole
figure (sparkles, gold), and picks the **style of her name**: a nameplate frame and a title earned
in play.

## 1. What it is, and what it is not

- **It is** two recoloured parts per painting, a main part and an accent part, each the kid's
  colour (*decided*, owner 2026-11-07: any pair is hers, with no rule against a clash); a few
  earned **specials** that apply across her whole figure, never a colour (sparkles over her, or
  gold that ignores her colours and makes her a gold statue); a nameplate frame; and a title line
  under the name. All of it is chosen in the adventure book or at the table, from a starter set
  plus looks earned in play.
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
  changes his look more, and masks cleanly, while his coat runs into his skin. *Since (owner,
  2026-11-07):* every species has two parts, and that seam is now the boundary between Bigfoot's
  two: his fur (his cream body and his brown mane) and his skin (his tan face, hands and feet).

## 3. The data

### 3.1 The look

A new `look` on the hero, beside `kit`, not inside `Appearance`. `Appearance` is
set by the server and its `accent` is the player's identity colour; the look is the kid's.

```ts
/** `Character.look`: what she has chosen to look like (docs/hero-looks.md). */
interface HeroLook {
  v: number;                        // LOOK_VERSION
  revision: number;                 // bumped by every write (§3.2)
  coat: CoatId | null;              // her main part's colour; null: as painted
  accent: CoatId | null;            // her accent part's colour; null: as painted
  special: SpecialId | null;        // a whole-figure special; null: none
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

- **`coat` is the code's name, never the kid's.** The field is `coat` for her main part's colour
  whichever part that is, kept so that older looks stay valid, and `accent` is her accent part's;
  the book and the table name each shelf for its part: "Coat" and "Mane", "Fur" and "Skin" (§8.1).
- **A special is not a colour** (*decided*, owner 2026-11-07). It covers her whole figure, gear
  included: sparkles over her, or gold, which ignores `coat` and `accent` while she wears it
  (they are kept, and show again when she takes it off).
- **Absent until chosen.** A hero with no `look` draws exactly as today. Nothing is backfilled on
  write, so old heroes, saved runs and the Gemfall gameplay digests do not move. Starter looks
  are implied (§6), not stored; milestone looks are backfilled on read, as the kit's are
  (camp.md §12.3).
- **The colour follows the hero, not the painting** (*decided*). Her `coat` and `accent` tint
  whichever painting she is drawn with: every tier, every class, the world figure and the portrait
  (§4).
- **One catalog** (`content/looks.json`, validated by a new schema): coats (each a colour for one
  part of one species), specials, frames and titles, each with its name and its unlock rule.

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
  unlocked for her, that a colour named is one of **her species'** colours (each species has its
  own sets, §7.1) **for that part** (`coat` a main-part colour, `accent` an accent-part one), and
  that a special named is one she has earned. Her two colours are never checked against each
  other. On the book route a look that is not hers is skipped and the rest apply, and
  the book says it could not be saved (as `merge` does for the kit).
- **A book edit and a table edit to the same field:** whichever reaches the server last stands.
  Both bump the revision, so a table editor open on the old look is refused once and refreshes.
- **A family tablet keeps nothing offline.** Its picked kid has no device token, and nothing of
  hers is kept on the tablet (#661): her change is shown at once from memory, sent with her room
  session straight away, in tap order, or not at all. This limitation is kept, not lifted.

Both routes reuse #661's code: the device-bound queue (`kit-queue.ts`), its sender
(`book-kit-sync.ts`) and its endpoint, with look changes as new change kinds; and the tablet's
in-memory pending list.

*As built (#664, phase 1):*

- **The data.** `Character.look` (`HeroLook`, `LookUnlock`; shared `types/look.ts`) beside the
  kit, character schema v10 (a v9 build would narrow it away), absent until something is chosen.
  The rules are shared `hero-look.ts`: `readLook`, `lookView` (the slim `HeroLookView` the screens
  read, on `ResolvedCharacter.look` only when she has a look), `lookEditProblem` (in the catalog,
  hers to wear, a coat her species' own), `mergeBookLook`, `migrateLook`. Starters are implied by
  the catalog, never stored.
- **The catalog** is `content/looks.json` (schema `schemas/looks.schema.json`, checked by
  `content:validate` through `tools/content/looks-catalog.mjs`): `coats` (empty until #666),
  `nameplates` (plain, ribbon, leafy, starry) and `titles` (the three starters and the earned ones
  #669 will grant), each with an `unlock` rule. The client bundles it (`world/hero-name.ts`).
- **The table.** `LOOK_EDIT` (server `handlers/look-edit.ts`), downtime only (the lobby, rests and
  the chapter's end, as `KIT_EDIT`), her own player only, carried by the run's commit like
  `KIT_EDIT`. A stale revision is refused; when the
  table's view of her look is behind her row, the refusal still commits the refreshed view, so the
  refused phone shows the look as it now stands and its next tap lands. A live room also reads her
  look afresh as each downtime moment begins (`syncCampDowntime`).
- **The book.** The kit's queue, sender and endpoint (`POST /api/journal/kit`), with `coat`,
  `nameplate` and `title` as change kinds beside the kit's (shared `BookEditField`); the answer
  carries `look`. Her look is written first (`mutateLook`), then her kit.
- **The frames' art** is declared in `assets/manifest.json` → `nameplateFrames`, whose `ids` list
  only what is delivered (none yet); `art:inventory` owes the rest. Until a frame is listed the
  plain plate is drawn and nothing is requested.
- **The TV** (`world/nameplate.ts` `dressNameplate`, `fitNameDress`, `crowdedTitles`): the name
  untouched, the title a sibling `Text` under it at 0.6 of its drawn size, the frame a nine-slice
  sprite behind both. On the lineup a title shows at 14px at 720p and up; on the board, framed by
  the fight camera's seven-tile window, the same rule hides it at today's type sizes.
- **The DOM** (`screens/HeroName.tsx`): the lobby cards, the phone's sheet and party strip, the
  character sheet, the chapter's end, the book's hero picks and profile. A hero with no look
  renders her name alone, as before.
- **The editors** (`screens/LookEditor.tsx`): `BookLook` on the book's Look page
  (`screens/LookPane.tsx`, beside Camp on the tray) and the compact `LookEditor` in the phone's
  camp panel.

*As built (two parts and specials, owner 2026-11-07, #662):* `LOOK_VERSION` 2 adds `accent` and
`special` to `HeroLook` and `HeroLookView`; `migrateLook` reads a v1 look (one `coat`) as her main
colour with no accent and no special, so an old look still draws. `LookCatalog` gains `specials`
(`CatalogSpecial`: `id`, `name`, `unlock`, `effect` `{ kind: "sparkle" }` or `{ kind: "gilded",
color }`), and every `CatalogCoat` names its `part` (`"main"` or `"accent"`). `LookEdit`,
`BookLookField` and `BOOK_LOOK_FIELDS` gain `accent` and `special`: `LOOK_EDIT` carries them, and
the book sends them as new change kinds, merged field by field as the others are.
`lookEditProblem` refuses a colour of the wrong part ("a main color, not an accent one"), another
species' colour, and a special she has not earned. `LookUnlockNews.kind` gains `"special"`.

## 4. Her coloured parts

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
- **8-bit RGB, no alpha, on the painting's own canvas,** registered pixel for pixel (*decided*,
  owner 2026-11-07):
  - **R** her **main part**, **G** her **accent part** (a pixel is never strongly in both), each
    white where coloured, black where not, with soft edges (fur is fluffy; a hard edge reads as
    cut out);
  - **B** her **whole figure**: the painting's alpha on a transparent painting; everything but
    the backdrop on an opaque gear portrait. Specials are drawn on it (§5.5).
- **Two parts per species** (*decided*), named in `assets/manifest.json` → `coatMasks.regions`
  (`{ main: { region, draftFrom, confirmed }, accent: { ... } }`). A part's name is the kid's
  shelf label, capitalised:

  | Species | Main (R) | Accent (G) | Confirmed |
  |---|---|---|---|
  | Unicorn | Coat | Mane | yes |
  | Bigfoot | Fur: his cream body and his brown mane | Skin: his tan face, hands and feet | yes |
  | Dragonling | Scales | Wings | yes |
  | Griffin | Coat | Feathers (the blue crest, ruff and tail tuft) | yes |
  | Kitsune | Fur | Tails | yes |
  | Manticore | Fur | Mane | yes |

  `draftFrom` names the palette slot (or slots, for a part painted in two: Bigfoot's fur is his
  `coat` and `mane`) the draft picks a part out by. Every painting of a species, in all three
  families, colours the same two parts of her.
- **What never takes a colour:** eyes, outlines, horns and claws, gear, the class costume, and a
  gear portrait's background. Skin only where it is the species' accent (Bigfoot). A special
  covers her whole figure, gear included.

### 4.3 How the art pipeline makes and checks them

1. `npm run art:coat-draft -- <species>` drafts all three channels of every painting of the
   species: R and G picked out by colour from each part's palette slot, the two competing so a
   pixel goes to the nearer part; B from the painting's alpha, or by a flood fill in from the
   edges on a gear portrait. It is a starting point, never shipped as is.
2. An artist cleans each mask by hand, channel by channel (any editor; the mask is a plain PNG).
   `npm run art:coat-clean -- <species>` is that cleaning written down for the base family
   (unicorn and Bigfoot, #667): per-species rules and a per-painting table of hand-placed fix
   boxes in `tools/art/coat-clean.py`, reading the drafts from `staging/coat-drafts` (or
   `--drafts DIR`). The class and gear waves (#668) add their rules to it.
3. `npm run art:sheet`'s colour page shows each painting, its three channels overlaid (main pink,
   accent blue, figure yellow), four main and accent pairings (light and dark, dark and light,
   saturated and grey, grey and saturated) and gold over the figure, for review before it ships.
4. `npm run art:verify` gates every mask: 8-bit RGB; its size its painting's; R's and G's coverage
   within `minCoverage`..`maxCoverage`; each part inside B (`maxSpill`); the parts' overlap at most
   `maxOverlap` of the smaller; B non-empty and at most `maxFigureCoverage` of the canvas; and on a
   transparent painting, B inside the painting's own alpha. A gear portrait is opaque, so the
   review sheet is its only check that the backdrop stays out.
5. `assets/manifest.json` lists which paintings have masks, so the client never asks for a mask
   that does not exist (as `figureVariants` does for class art).

Built in #673, and made two parts and a figure in #662: `assets/manifest.json` → `coatMasks` holds
the species' parts (`regions`), the gate's bounds (`tolerance`) and the listed paintings
(`paintings`, paths under `assets/`); `tools/art/coat.py` is the library under the draft tool,
the gate and the sheet, and `packages/client/src/world/coat-masks.ts` is the client's lookup
(`coatPartsOf`, `coatRegionOf`, `coatPartLabel`, `coatPartSlots`, `hasCoatMask`, `coatMaskUrl`,
`paintingIsCutOut`). A drafted mask fails `art:verify` until its painting is listed, so a draft
cannot ship by accident. The sheet's colour pages are `art/review/<species>/coat-<family>.png`
and include unlisted drafts.

## 5. The tinter

### 5.1 One resolver, one tinter, two outputs

- **One hero-aware resolver** (`world/hero-art.ts`) answers "what does this hero
  look like here", for the two kinds of place a hero is drawn: `world` (the figure on a stage)
  and `portrait` (a still). It wraps `characterArtUrl`, `characterWorldArtUrl` and
  `characterPortraitArtUrl`, picks the painting as today, and applies her colour when the
  painting has a mask. Every surface that draws **a player's hero** goes through it (§9).
  Character creation and non-player art (the cast, enemies, other creatures) do not.
- **One tinter** (`world/hero-coat.ts`) turns a painting, its mask and her look into a tinted
  canvas, and from it:
  - **for Pixi,** a texture, as `campKitCanvas` does for the kit;
  - **for the DOM,** an object URL, for `CharacterPortrait` and the `<img>`s that take a URL
    today, through a `useHeroArt(hero, place)` hook.

Both come from one pass, so the TV and every phone show the same hero.

### 5.2 The colour swap

Each of her parts is swapped on its own: her main colour on the mask's R, her accent colour on its
G, each by **its own region's** lightness and chroma, in one pass. A part with no colour chosen
stays as painted, and nothing outside both parts changes. Where the soft edges of the two parts
reach one pixel, their weights are shared out, so a pixel is never more than wholly recoloured.
**Gold** (a gilded special, §5.5) is the same swap over her whole figure (B), her colours
ignored: she keeps her lightness steps, so she reads as a statue of it.

**The chosen colour lands on most of the part** (#662). A part can be painted in two very
different lightnesses: Bigfoot's fur is his cream body (about 60% of it, lightness about 0.9) and
his brown mane (about 0.35). Anchored on the part's *mean* (0.67), every colour landed where
almost no pixels are: a pale yellow clamped his body to white and turned his mane olive, a navy
went slate on his body and near-black on his mane. So the swap anchors on the part's **median**
lightness and chroma (mask-weighted), and fits the part's spread around the colour.

For each coloured pixel of a region, in OKLab:

- **Lightness:** the colour's, plus the pixel's own step from the region's **anchor** (its
  weighted median lightness), so shadows stay shadows and highlights stay highlights:
  - a region whose **spread** (its weighted 5th to 95th percentile of lightness) is wider than
    0.30 has its steps scaled to fit 0.30;
  - going darker than the anchor, the steps are softened a little (×0.85) so it does not go
    muddy;
  - the steps are scaled again, above and below the anchor on their own, so the spread stays
    inside 0.14–0.95 around the colour: a dark choice never crushes the part's darkest pixels to
    black, and a light one never clamps its fur strokes to white;
  - a narrow region away from the ends keeps its steps exactly as painted. The result is clamped
    to 0.04–0.98 at last, for the few pixels outside the spread.
- **Hue:** the colour's.
- **Chroma:** the colour's, varied gently with the pixel's own (square root of its ratio to the
  region's weighted median chroma, clamped to 0.6–1.4), so a painted gradient keeps some life.
  **A near-grey region** (median chroma under 0.02, a white or grey coat) has no ratio to keep:
  every pixel takes the colour's chroma as is.
- **Out of gamut:** a colour sRGB cannot show is brought in by lowering its chroma at the same
  lightness and hue, never by clipping each channel (which shifts the hue).
- **Blend:** by the mask's value, so soft edges stay soft.

Each region's anchors and spread are computed once per mask, from 1024-bin histograms (each
value the bin's centre), the same in `hero-coat.ts` (`coatRegionStats`, `swapLightness`,
`COAT_SWAP`) and coat.py (`region_stats`, `_lightness`). A unit test pins the arithmetic (as
`shadedPixel` does for the camp's shadows), including the near-grey, gamut and clamping cases
and a part painted in two lightnesses, and a sheet like §2's is kept as the reference.

On Bigfoot's fledgling fur (a local draft mask, not committed), where the colour lands on his body
and his mane, before and after:

| Colour | Target L | Body L before → after (ΔE to the colour) | Mane L before → after |
|---|---|---|---|
| Pale yellow #F7E9A8 | 0.93 | 0.98, 97% clamped (0.066) → 0.94, none clamped (0.007) | 0.63 olive → 0.71 |
| Navy #23264A | 0.29 | 0.45 slate (0.164) → 0.31 (0.020) | 0.08 near-black → 0.17 |
| Grey #9A9A9A | 0.69 | 0.88 near-white (0.192) → 0.70 (0.018) | 0.40 → 0.50 |
| Raspberry #E8326E | 0.62 | 0.78 light pink (0.184) → 0.64 (0.018) | 0.37 → 0.43 |

### 5.3 Its cost, and its cache

- **Off the main thread.** The pass runs in a worker with an `OffscreenCanvas` where the browser
  has one, else in small slices between frames. The hero draws as painted until it is done.
- **Each request is deduplicated:** two surfaces asking for the same painting and look (both
  colours, or the gold) at once share one pass.
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

### 5.5 Specials

Specials are whole-figure effects, not colours (*decided*, owner 2026-11-07). Each is every
species', earned only, and drawn from the mask's figure channel (B), with no new art:

- **Sparkle:** small stars twinkling over her whole figure, each on its own beat. On the TV it is a
  child of her sprite, so it moves with every transform the stage gives her, clipped by her
  figure. In the DOM it is an element in the image's own box, laid **over** the image (never behind
  it: a gear portrait is opaque and would hide it), clipped by her figure (`mask-image`, read by
  alpha). **Under reduced motion** (the device's setting or `data-motion="reduced"`) the stars rest
  at a steady glow, with no twinkle. Her colours show under it.
- **Gold (gilded):** her whole figure swapped toward the special's colour by the §5.2 swap,
  keeping its lightness steps, so she reads as a gold statue. Her chosen colours are ignored while
  she wears it. A still image: a tint like any other, with its own cache key.

The two-tone coat and the region-masked shimmer coat are gone (#662): the earned two-tone coat
became Gold, and the found shimmer coat became the Aurora sparkle.

*As built (#666, phase 2; no real mask ships yet, so every hero still draws as painted until
#667 and #668 list theirs in `coatMasks.paintings`):*

- **The data.** `look.coat` is a catalog id (`content/looks.json` → `coats`): `id`, `name` (the
  tile's word), `unlock`, `species` (one each), `color`, and since #662 `part`. Six starters per
  species and part (§7.1). How the tinter paints her is shared `CoatPaint` (§5.5, as built);
  `speciesCoat`, `coatPaintOf` and `coatPaintKey` are in shared `hero-look.ts`.
- **The resolver** (`world/hero-art.ts`): `HeroArtSubject` carries `look` (a `Character` or a
  `ResolvedCharacter` passes it whole). `heroCoatOf(hero, place)` is the tint request
  (`{ painting, mask, paint, key }`) or null: no colour, not her species', or no mask listed.
  `heroArtUrl` stays the painting as painted (what a figure is keyed and built on); her colour
  reaches a surface only through the doors that hold it: `useHeroArt` / `HeroImage` (and
  `CharacterPortrait` on it) and `loadHeroTexture`. `heroOfflineArt(hero)` lists her paintings
  and masks for saving. A test holds that `CharacterPortrait`'s `species` prop (no look) is
  creation's alone.
- **The tinter.** `world/oklab.ts` (the matrices coat.py uses); `world/hero-coat.ts`
  (`coatRegionStats`, `coatTarget`, `swapPixel`, `tintCoatPixels`, `COAT_SWAP`): §5.2's swap,
  held to coat.py within one 8-bit step on `tools/art/fixtures/coat-reference.json` (and its
  `.png` sheet), which `tools/art/coat-reference.py --check` regenerates and compares.
  `world/hero-coat-pass.ts`: one pass (`runTint`) fetches and decodes both files, swaps a slice at
  a time and encodes an image (for Pixi) and a PNG (for the object URL); `defaultTintRunner()`
  runs it in `hero-coat.worker.ts` on an `OffscreenCanvas`, else on the page in slices
  (`canvasIO`); a mask off its painting's canvas fails the pass (drawn as painted).
- **The cache** (`world/hero-coat-cache.ts`, loaded by `hero-coat-load.ts` only when a hero
  with a colour stands on a masked painting, never in the first paint): `heroCoats()` is a
  `CoatCache`; a surface asks through `cache.slot(show)` → `slot.want(request | null)`,
  `slot.shown`, `slot.close()`. One pass per painting and paint, shared, one at a time. A new
  want supersedes the last: a queued pass nobody wants is dropped, a running one aborted and its
  result thrown away; the slot keeps showing what it showed until the new one is ready, so an
  older colour never shows after a newer one. Entries count `width × height × 4` bytes; over
  `COAT_CACHE_BUDGET` (48 MiB) the least recently used unpinned entry is evicted (URL revoked,
  texture destroyed, bitmap closed); a slot pins what it shows. A failed pass is remembered for
  the page's life and that hero draws as painted.
- **The stages.** `loadHeroTexture` returns a handle: call it to let go (the lineup, the board
  and the camp now call it whenever a figure is torn down or the stage is), `handle.update(hero)`
  to retint the same figure when her colour changes (a new painting is still a new figure). A
  stage's `use` swaps the texture on the existing sprite. A colour already tinted is on her
  before her painting can be.
- **Offline.** `art-paths.ts` `maskPathBeside` / `coatMaskFor(painting, masked)`, pure, so
  `sw/chapter-art.ts` (`heroPaintingsWithMasks`) adds every seated hero's world figure, portrait
  and their listed masks. The page passes the manifest's list (`coat-masks.ts`
  `coatMaskPaintings()`); the service worker, which cannot import JSON, is handed it by
  `sw-build.ts` as `__KAD_COAT_MASKS__`, and its overnight `swNextChapterArt` passes it. The scenes
  ahead (`prefetch.ts`) warm figure masks too, and the book's fresh read warms every hero's
  paintings and masks (`heroOfflineArt`, JournalScreen). The tint itself is not stored: it is made
  again, on the device, from those two files.
- **The editors.** A colour shelf for each of her two parts (since #662, named for the part),
  first in the book's Look page and in the table's compact editor: "As painted" and her species'
  colours for that part, each tile `CharacterPortrait` of her wearing it, her other colour kept
  (and a dot of the colour by its name). They are offered only once one of her paintings has a
  mask; before that every tile would look the same.

*As built (#662, the specials):*

- **The data.** `content/looks.json` → `specials`: Aurora (`{ kind: "sparkle" }`, found in
  `riftlight-hidden-glacier-rift`) and Gold (`{ kind: "gilded", color: "#E2B13C" }`, reaching
  Radiant). Shared `hero-look.ts`: `coatPaintOf(catalog, species, look)` is how she is painted
  (`CoatPaint` `{ kind: "parts", main, accent }` or `{ kind: "gilded", color }`, or null as
  painted), `coatPaintKey` its cache key (both colours, or the gold), `lookSparkles` whether the
  stars go over her, `lookSpecial`, and `speciesCoat(catalog, species, id, part)`.
- **The tinter.** `hero-coat.ts` `tintHeroPixels` (her two parts or the gold, in one pass),
  `heroRegionStats` (each region's means), `tintCoatPixels` (one region, the single-mask call, as
  coat.py `tint`); `MASK_CHANNEL`. coat.py has `tint` (one channel), `tint_parts` (both) and
  `gild` (the figure), held to the client within one 8-bit step on
  `tools/art/fixtures/coat-reference.json`, whose stand-in now has an RGB mask and covers one
  part, both parts, each alone, and two golds.
- **Gold with no mask.** On a cut-out painting (every `assembled.png`, base and class) the
  painting's own alpha is her figure, which is what B is there, so gold needs no mask: the pass
  reads the alpha (`FIGURE_FROM_ALPHA`). A painting that turns out to be opaque fails the pass and
  she draws as painted. An opaque gear portrait with no mask draws as painted; until its mask is
  listed a classed hero's portrait can be ungilded while her world figure is gold, the same window
  as her colours (§4.1). Her colours always need the mask.
- **Sparkles.** `hero-art.ts` `heroSparkleOf` (null with no sparkle special, or on an opaque
  portrait with no mask), `SPARKLE`, `sparkleAt`, `sparklePlace`. On the TV, `loadHeroTexture`'s
  handle `dress(sprite)` lays `hero-sparkle-pixi.ts`'s layer as a child of the sprite, clipped by a
  sprite of its own texture read by alpha (so the figure needs no mask there), its stars twinkled
  by the ticker, or still. In the DOM, `HeroSparkles` (`hero-art-dom.tsx`, `hero-sparkle.css`) is
  clipped by the painting itself on a cut-out, and on a gear portrait by her figure, which the
  tinter makes from the mask's blue channel (a `{ kind: "figure" }` pass: white, alpha = B, since
  CSS cannot pick a channel). `CharacterPortrait` lays it in the image's own grid cell.
  `HeroImage` with sparkles is a `.hero-sparkle-host`: one grid cell holding the image and the
  stars, wearing the image's `className` and `style`, so whatever moves, scales or animates her
  (a game's bob, a strain shake, a hello pop) moves the stars with her, and nothing is measured or
  placed by hand. The image inside fills the host and inherits its `object-fit` and
  `object-position`; stylesheets that reach a hero's image by element (`> img`) reach the host too.

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

*As built (#669, phase 4):*

- **The rules** are shared `look-unlocks.ts`: `earnedLooks` (the milestone looks a standing meets:
  a tier reached, a class rank held, a campaign in her `finished`, and, given her crew's camp, a
  friend by name, a first friend, a grand camp, which is frame stage 4), `foundLookGrants` (what a
  find gives one hero: every special, frame and title it names, and the coat of her own species),
  `withLookGrants` (receipts only ever added, the first kept, `revision` untouched) and
  `readEarnedLook` (her stored look with every milestone her row holds, no `at`: the backfill on
  read). Each receipt's `source` is the book's words: "Reached Sworn", "Became a Thornguard
  Master", "Finished The Gemfall", "Made friends with Bun", "Found in The Note Under the Ice".
- **Finds** are a chapter effect, `findLook: { looks, rewardId }` (content/README.md, "Look
  finds"). The engine only records it (`RunState.lookFinds`, once per reward a chapter, with who
  was seated), as it does a kit find.
- **Written when it lands.** After each step's commit, beside the kit's milestones, server
  `look-unlocks.ts` `claimLookUnlocks` writes to each hero the step concerns (a find's heroes, a
  hero whose tier or rank moved or whose chapter XP reached a tier, every seated hero when the step
  finished a campaign, made a friend, or opened a downtime moment on a camp that can earn
  something), on her row at her home, conditional and retried (`grantLooks`; the write bumps her
  look's `revision`). A tier reached by the setback that fails the campaign is written from the
  settlement's awards, as `failCampaign` keeps the kit's tent. Lost fights, setbacks, reverts and
  replays never touch her look, so a receipt is hers for good.
- **Announced once, where the kit's are.** What this step earned (never a catch-up of something
  held before) rides the broadcast as `lookUnlocks` (`LookUnlockNews`), live only; the phone queues
  it in the kit's news (`store/kit-news.ts` `announceLookNews`, its own watermark) and the kit's
  toast says it ("New title for you: the Tracker"), after the transformation for a tier, after the
  rank-up moment for a rank, otherwise after a breath. It changes nothing in play: no engine read.
- **Read with it everywhere** (`heroLookOf`): the table's downtime sync (with the moment's camp),
  `LOOK_EDIT`'s check, the book's edits and its hero list, so a hero who already held a milestone
  is offered it before anything was written for her, and her next look write stores it. The book
  carries each receipt's `source` (`HeroLookView.sources`, the book's copy only) and shows it under
  the tile. Looks not yet earned are still never shown.
- **The first earned set** (`content/looks.json`): Aurora, the sparkle special (found in
  `riftlight-hidden-glacier-rift`, answering the seam: "tiny sparkles drift off the frost and
  settle on all of you"); Gold, the gilded special (reaching Radiant); Bluebell, an accent colour
  for every species (reaching Sworn); the Songbird frame (found in `riftlight-ashspan-bridge`, with
  Tilly's ribbon) and the Golden frame (reaching Mythic), both owed art (#680) and drawn as the
  plain plate until listed; the Tracker (found in `riftlight-exchange-rift`, reading the tracks)
  and the Friendly (a first friend), beside the titles #664 declared. No Gemfall chapter changed.

## 7. Palettes, frames and titles

### 7.1 Colours

- **Starter colours:** about six per part per species, natural for it (a unicorn's coat is pale,
  her mane bolder; a Bigfoot's fur runs through creams, gingers and browns, his skin through
  peach, tan and cocoa). Free from the start.
- **Earned colours:** new hues for either part (the first: Bluebell, an accent for every species).
  Specials are not colours (§5.5).
- **Checked by a test, on the rendered hero,** not on swatches: each colour applied to its part of
  the species' base painting, and measured as the mean colour of the part, at the size a phone's
  portrait draws it.
  - **Against the backdrops, her main part:** OKLab distance ≥ 0.10 from every backdrop's ground
    colour, so a hero never disappears into the scenery. The accent is the smaller part, and is
    not held to it.
  - **Against each other, within a part:** within one species' set for one part, every pair is
    told apart under normal vision and under simulated deuteranopia, protanopia and tritanopia,
    by an OKLab distance ≥ 0.08 **or** a lightness difference ≥ 0.10. Natural sets (two browns)
    pass on lightness, as real browns are told apart.
  - **Never across her parts** (*decided*, owner 2026-11-07): her main and accent colours are never
    held against each other. If the pair is odd, that is her choice.
- The player's accent is untouched, so a colour never clashes with "whose hero is whose".

*As built (#666; two parts #662):* six starters per part per species in `content/looks.json`
(checked by `tools/content/looks-catalog.mjs`: four to eight per part, named and coloured apart
within a part). `packages/client/src/world/coat-palette.test.ts` holds the rules **on a stand-in
for the rendered hero**, since no real mask ships yet: a body and a mane painted in the species'
own part colours (the manifest palette slots each part's draft picks by; a part painted in two
slots, as Bigfoot's fur is, on each of them), shaded, with soft-edged parts, at 96 pixels, tinted
by the real tinter and averaged in linear light. The backdrops are
`coat-backdrops.fixture.json`, the mean of the bottom 30% of every biome background and camp
backdrop (`tools/art/backdrop-grounds.py`; a test fails when a backdrop is missing from it).
Colour-blind vision is Machado et al. (2009) at full severity. When the base masks land (#667),
measure on the base painting and its mask instead; some colours may need nudging then. The
starters were found by a search that kept each near a natural target and moved it only as far
as the rules needed, which is why the darkest main colours are a deep navy "Midnight" rather than
black (black on a light part sits too close to the red-sky grounds) and why a few are brighter
than a painter would pick. Gold is checked to read as its colour over the figure, not against the
backdrops: every gold sits near some ground (a pale one near the snow, a deep one near
Bramblewood), and it is a statue's look she picks on purpose.

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
- shelves: one for each of her two parts, named for it and capitalised ("Coat" and "Mane" for a
  unicorn, "Fur" and "Skin" for a Bigfoot), then **Special**, **Nameplate**, **Title**, each a
  row of tiles, the chosen one marked by more than colour. The colour tiles show her hero wearing
  each one with her other colour kept, so she sees the pair. The colour shelves show only once
  one of her paintings has a mask; the Special shelf only once she has earned a special;
- earned looks she does not have yet are not shown. Nothing is a locked tease;
- every tap is a save, silently, online or queued offline (§3.2). Nothing says "saving".

### 8.2 At the table

A compact Look editor in her phone's panel during downtime (the lobby, rests and the chapter's
end, where what a chapter earned is first hers to try on; *decided*, owner 2026-11-08), next to the
kit's, with the same shelves as the book's (her two parts, Special once earned, Nameplate,
Title). `LOOK_EDIT`, unlimited, as `KIT_EDIT` is (*decided*), naming the look's `revision`
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
| A main part and an accent part per painting, the kid's choice of both; no pairing rule | *decided* (owner, 2026-11-07) |
| The colour carries over to every tier and class painting | *decided* |
| Titles show everywhere, the TV lineup included, under the name | *decided* |
| The player's accent is unchanged; looks do not change the name's typography or colours; the frame and title are the kid's | *decided* |
| Specials are whole-figure effects (sparkle, gold), not colours | *decided* (owner, 2026-11-07) |
| Unlimited edits at the table | *decided* |
| The colour swap in OKLab, keeping lightness steps (§5.2), not the kit's multiply | *decided* (POC §2) |
| The two parts are chosen per species (§4.2); Bigfoot's are his fur (body and mane) and his skin, split where the POC found his coat running into his skin | *decided* (owner, 2026-11-07) |
| Masks are drafted by a tool and hand-cleaned, never shipped raw | *decided* (POC §2) |
| The gear portraits are kept and masked too: 168 masks (§4.1) | *decided* (review) |
| Table edits name a revision; book edits merge per field, last choice wins; the server checks owner, unlock and species (§3.2) | *decided* (review; as the kit) |
| A family tablet keeps nothing offline, as in #661 | *decided* (review) |
| One hero-aware resolver, and a test that no hero painting bypasses it (§9) | *decided* (review) |
| The name drawn exactly as today; a title hidden, never shortened, when short of room (§7.2) | *decided* (review) |
| Masks prefetched with their paintings (§5.4) | *decided* (review) |
| A tint cache bounded by real memory, never evicting what is on screen; the latest choice wins (§5.3) | *decided* (review) |
| Each colour shelf is named for its part ("Coat", "Mane", "Fur", "Skin"); the main field stays `coat` | *decided* (owner, 2026-11-07) |
| `look` beside `kit`, absent until chosen | *decided* |
| One catalog for coats, specials, frames and titles (`content/looks.json`) | *decided* |
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
| Two colours on one hero | Each part its own colour, swapped by its own region; nothing outside both changes |
| Gold with colours chosen | Her whole figure gold, her colours ignored; they show again when she takes it off |
| Sparkles on a gear portrait | The stars show over the painting, clipped by her figure |
| Sparkles on a moving or animated image | The stars move with her: one box, no measuring |
| Sparkles under reduced motion | Still stars, no twinkle |
| A main colour sent as her accent, or the other way round; another species' accent; a special not earned | Refused (table) or skipped and said (book) |
| An old look with only `coat` | Drawn as her main colour |

## 13. Playtest questions (#670)

- Do kids notice their own colour on the TV, and do they find their hero faster or slower?
- Do they change looks often, or pick once and keep it?
- Do titles get read aloud, or ignored?
- Does an earned colour or a special feel like a reward, or go unnoticed?
- Do kids enjoy picking two colours, or find two shelves too many?
- Does anyone lose track of whose hero is whose?
