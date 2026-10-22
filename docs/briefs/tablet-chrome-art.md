# Brief: painted chrome for the screens (frames, borders, rails and plates)

**Status:** art delivered; CSS integration and device review pending. All 38 filenames enumerated
below (including optional pieces) are in `packages/client/src/assets/chrome/`; prompts and slicing
are recorded in that folder's README. Contact sheets and technical previews are in
[`docs/reviews/tablet-chrome-art/`](../reviews/tablet-chrome-art/). The PR summary's count of 42
does not match the tables' 38 deliverables. The complete set was requested together for this pass.

This brief lists every piece of interface art the game needs so its screens look like the
storybook its pictures are. It covers the frames around and between the panes, the panels that sit
on them, and the controls. The wiring (CSS, slicing, fallbacks) is Claude's and follows delivery.

---

## 1. Why, and what exists today

Since the landscape tablet layout (`packages/client/src/layout/landscape.ts`), a tablet held
sideways shows **two panes side by side**: the world (or the map) and the player's own controls,
with the tray as a **rail down the side**. That is where kids most often play.

**None of the interface is painted.** Every border, panel, button and divider is a CSS gradient or
a 1px hairline (`--kad-border`, `rgba(190, 178, 255, 0.16)`). The painted icons
(`packages/client/src/assets/painted/`) sit on flat purple boxes. On a phone that is acceptable,
since one pane fills the screen. On a tablet:

- **The seam between the two panes is a hairline.** The world's painting runs straight into the
  controls' background with nothing to say "two windows onto one book".
- **The rail is a recolored gradient.** The bottom tray's "leather shelf with a gold rim" turned
  on its side. It reads as a toolbar, not a shelf.
- **Panels are all the same flat card.** The goal card, the "Here we go!" card, the room code card,
  the host's Room bar and the party cards differ only in border color.
- **Buttons are flat pills.** The choices a kid taps are the most-touched thing in the game and the
  least decorated.

**Do not redo:** the painted tray objects and icons (`assets/painted/`, `assets/attributes/`), the
backdrops, scenes, cast and creatures. This brief frames them; it does not replace them.

## 2. The contract every piece follows

### 2.1 Style

Match the painted icons in `packages/client/src/assets/painted/`: warm storybook painting, chunky
readable shapes, old gold and brass, plum and lavender, teal accents. Night-time interior: a
storybook read by lamplight. The materials are **old gold or brass trim, dark plum leather, dark
stained wood and deep-violet cloth.** Parchment is reserved for paper things (the goal list, the
map). Decoration stays at the edges; the middle of every panel is calm, because text goes there.

**The palette to sit on** (`packages/client/src/styles/theme.css`):

| Token | Hex | Use |
|---|---|---|
| `--kad-bg` | `#0d0b1a` | page, deepest background |
| `--kad-bg-raised` | `#1a1730` | panel interiors |
| `--kad-accent` | `#8b6cf5` | primary action violet |
| `--kad-gold` | `#ffc95c` | rewards, the current tab, featured trim |
| tray leather | `#2a1f45` to `#110c22` | the shelf today |
| tray rim | `#6b5430`, `#b08a3e`, `#f5c86c` | the gold edge today |

**Never:** text, letters or numbers baked into any piece; red as a trim color (red means the red
sky, `rift` art); white or silver trim (silver belongs to the Hollow Crown); anything that only
reads in color (a selected state also changes shape or weight, spec §11).

### 2.2 Format and slicing

- **WebP with alpha, at 2x.** Every size below is the delivered pixel size, drawn for a
  2x-density screen (an iPad). It is shown at half that size in CSS pixels.
- **Nine-slice panels** (marked **9S**): deliver one image with the stated **inset** (the corner
  size, the same on all four sides unless stated). Corners are drawn once. Edges between corners
  **stretch or repeat**, so keep them plain lengthwise: no motif that distorts when stretched.
  The center is either transparent or a flat interior that can stretch.
- **Three-slice** (marked **3S**): left cap, a stretchable middle and a right cap, in one image,
  with the cap width stated.
- **Tiles** (marked **T**) repeat seamlessly in the direction stated. Check the seam by tiling it
  4 times before delivering.
- **Corner ornaments** (marked **C**): draw the top-left one only. CSS mirrors it for the others,
  so it must look right flipped.
- **States** are separate files with identical size and insets, so swapping them never moves
  anything.

### 2.3 Weight

The first paint has a hard budget (`tools/perf/bundle-budget.ts`, 315KB, mostly code). Chrome
for the room loads with the room, not the start screen, but it is still downloaded on every
phone. **Target: under 8KB per slice or tile, and under 160KB for this whole brief.**
Low-detail, flat-ish painting compresses best. If a piece cannot get there, say so in the PR
rather than blurring it.

### 2.4 What the code guarantees (so the art does not have to)

- **High contrast** (`html[data-contrast="high"]`) drops every piece back to flat, solid borders.
  The art never has to carry contrast.
- **Larger text** (up to 1.5x) does not scale the trim: corner insets stay their CSS-pixel size
  while the panel grows. Design corners that look right on a panel 2 or 3 times taller than your
  mock-up.
- **Reduced motion:** nothing in this brief animates. A shimmer, if wanted later, is CSS.

### 2.5 Where the files go

`packages/client/src/assets/chrome/<id>.webp`, bundled with the client like the painted icons.
Add one line per file to a `README.md` in that folder recording the prompt, as
`assets/painted/README.md` does.

---

## Part A: the frame around the two panes (priority 1: what the tablet layout made visible)

| id | What | Type, delivered size | Where it shows |
|---|---|---|---|
| `pane-spine` | The seam between the world and the controls: a carved gold strip, like the spine where a storybook's two pages meet. Plain enough to repeat for any height. | T vertical, 32×256 | Between the panes, full height (`[data-side-by-side] > [data-pane="player"]`'s inline-start edge) |
| `pane-spine-cap` | The spine's top and bottom ends: a small finial. One image; CSS flips it for the bottom. | 32×64 | Ends of `pane-spine` |
| `pane-spine-boss` | A round brass boss or small gem set into the middle of the spine, for something to look at. Optional, but it is what makes the seam read as made, not cut. | 64×64 | Vertical middle of the spine |
| `pane-corner` | A filigree corner on the inside of the world pane, so the painting reads as a window in a frame. Small: it must not cover the scene. | C, 96×96 | Four inner corners of the world and map panes |
| `rail-wood` | The rail's material: dark plum leather or stained wood, running top to bottom, with the faint worn shine a shelf has. | T vertical, 208×256 | The tray as a side rail (`.kad-tray` in the landscape media query in `components.css`) |
| `rail-rim` | The gold edge where the rail meets the game. Replaces the CSS gradient rim. | T vertical, 8×256 | Rail edge facing the panes |
| `tray-wood` | The same material laid horizontally, for the phone's bottom tray, so phone and tablet match. | T horizontal, 256×144 | `.kad-tray` on phones and upright tablets |
| `tray-rim` | The same gold edge, horizontal. | T horizontal, 256×8 | Top edge of the bottom tray |
| `rail-socket` | A shallow round well each tray object sits in, so the objects sit *on* the shelf. | 112×112 | Behind every `.kad-tray__object` |
| `rail-current` | The mark on the tab now showing: a brass bracket or ribbon on the edge facing the game. Replaces today's gold inner shadow. | 3S vertical, 24×160, caps 24 | The current tab, on the rail |
| `tray-current` | The same mark for the bottom tray, horizontal. | 3S horizontal, 160×24, caps 24 | The current tab, on phones |
| `rail-foot` | A small inset tray at the foot of the rail where the four corner controls sit, two by two. | 9S, 208×208, inset 32 | Behind `.kad-corner` when it is in the rail |
| `corner-bezel` | A round brass bezel for each corner control (help, text size, read-aloud, sound). | 96×96 | Behind each corner button |

## Part B: panels that sit on the panes (priority 2: on every screen, both layouts)

Two weights. **Standard** is a dark raised card with a thin brass edge, for everyday panels.
**Featured** has heavier gold trim and corner flourishes, for the moments that matter. Both are
nine-slice with transparent or flat dark centers.

| id | What | Type, size | Where it shows |
|---|---|---|---|
| `panel` | Standard card: dark violet cloth interior, thin brass edge, slightly rounded. | 9S, 192×192, inset 40 | Room bar (`.kad-host--inline`), party cards, creation cards, catch-up line, toasts, sheets |
| `panel-featured` | Featured card: the same, with a heavier gold edge and small leaf flourishes at the corners. | 9S, 256×256, inset 64 | "Here we go!" preface, the chapter's goal on the TV, chapter complete, rank-up |
| `panel-sunken` | An inset well: darker than its surroundings, an inner shadow, no trim. | 9S, 128×128, inset 32 | Stat tiles, empty inventory slots, HP track, input fields |
| `plate-story` | The plate the story sits on in the world pane: a wide, low, dark-glass panel with a gold top edge, so text reads over any backdrop. | 9S, 512×192, insets 48 sides and 32 top/bottom | `.narration__plate` (TV and the world pane) |
| `strip-identity` | The nameplate behind the hero's name and level at the top of the controls. | 9S, 256×128, inset 40 | `.sheet` identity strip |
| `heading-ribbon` | A short cloth ribbon or brass label behind section headings ("Everyone in?", "The party", "Everyone", "Your things"). | 3S, 384×96, caps 64 | Section headings, both panes |
| `rule-flourish` | A horizontal divider with a small center ornament (a leaf or a four-point star). | 3S, 512×32, caps 96 | Between the preface's lines, between sheet sections |
| `goal-paper` | The goal list on a slip of parchment pinned at one corner. Paper, so text goes on light: the code switches the goal's ink to dark for it. | 9S, 384×192, inset 48 | `.goal` card, phone and TV |
| `goal-box` / `goal-box-ticked` | The goal's checkboxes: an empty inked square, and the same square with a hand-drawn gold tick. A pair. | 64×64 each | Each goal step |
| `code-coin` | A coin or brass button for each letter of the room code (the letter stays text). | 128×128 | Lobby room code (H X E F) |
| `tag-place` | A small wooden tag on a string, for place names on the atlas. | 9S, 192×96, inset 32 | Atlas labels (`WorldMapPanel`) |
| `tab-flip` / `tab-flip-on` | The Atlas / Story trail switch: two states of a bookmark tab. | 3S, 384×112, caps 56 | `.kad-map__flip-tab` |

## Part C: the things a kid taps (priority 2)

Every button keeps its full touch target (44 CSS px at least). Text and icon sit on top as today.

| id | What | Type, size | Where it shows |
|---|---|---|---|
| `button-choice` | A story choice: a dark wooden or cloth plate with a brass edge and a round socket at the left where the choice's icon sits. | 9S, 384×128, insets 112 left, 32 others | Every `.choice` on the controls |
| `button-choice-picked` | The same plate, chosen: gold edge, slightly lit. | as above | A picked or voted choice |
| `button-choice-pressed` | The same plate, pushed in (darker, edge inset by about 2px). | as above | While a finger is down |
| `button-primary` | The big violet action ("Next", "Your turn", "Play the practice"): a polished violet gem or enamel plate with a gold rim. | 9S, 384×128, inset 48 | `.kad-button--primary` |
| `button-primary-pressed` | Pushed in. | as above | While a finger is down |
| `button-secondary` | Quieter action ("Back to your bag", "Wait, not yet"): dark plate with a thin brass edge. | 9S, 384×112, inset 40 | `.kad-button--secondary` |
| `hp-frame` | A small brass frame for the health bar; the fill stays CSS so it can move. | 3S, 256×40, caps 24 | `.sheet__hp-track` |
| `slot-frame` | A square frame for one inventory slot; the item icon sits inside. | 9S, 160×160, inset 40 | `.inv__slot` |

## Part D: atmosphere (priority 3: nice to have)

| id | What | Type, size | Where it shows |
|---|---|---|---|
| `paper-night` | A very faint texture for the controls pane background: soft cloth or star-flecked night paper, almost flat. Must stay under 6% contrast so text on it never suffers. | T both ways, 512×512 | `.kad-surface--player` background |
| `vignette` | A soft dark edge for the world pane, so the backdrop falls away into the frame. | 512×512, stretched | Over the world pane, under its text |
| `ornament-empty` | A small storybook ornament (a closed lantern, a curled vine) for empty and loading states. | 256×256 | "Nothing here yet" and loading states |

---

## 3. Order of work

1. **Part A** first, together: the spine, the rail, the socket and the current-tab mark are one
   look and should be designed as a set. Deliver them and stop for review: the wiring goes in, and
   the review on a real iPad decides whether Parts B and C keep the same materials.
2. **Part B**, `panel` and `panel-featured` first, since they cover the most screens.
3. **Part C**, choices first.
4. **Part D** if it still feels flat.

## 4. Acceptance

- Every file is WebP with alpha at the stated size, under its weight (§2.3), in
  `packages/client/src/assets/chrome/`, with a line in that folder's README.
- Tiles show no seam when repeated four times; nine-slice edges show no stretch artifacts at 3x
  their drawn length.
- No text, no red trim, no silver (§2.1).
- A contact sheet of every piece on `#0d0b1a` and on a backdrop from `assets/biomes/` goes in the
  PR for review.
- Claude then wires the set and posts before-and-after shots at 1180×820 (iPad), 1024×768 (the
  smallest iPad) and 390×800 (phone), at normal and the largest text, with the layout-fit check
  (`e2e/layout-fit.spec.ts`) green.
