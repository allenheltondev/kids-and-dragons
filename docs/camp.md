# The camp: the crew's campsite

**Status: design, nothing built.** Every decision below marked *decided* was made by the
product owner; everything else is a proposal. The decisions so far and the questions still open
are in §11. Implementation recommendations and acceptance criteria are in §§12 and 13.

**Review status:** this revision preserves the product owner's decisions. Recommendations added
during review are proposals, not newly approved decisions. Repository references are
implementation context; names and interfaces below remain proposed.

**Purpose:** make the crew's shared history visible during existing downtime. A successful camp
gives children something to recognize, show and personalize without adding a new obligation or
delaying play.

The camp is the crew's campsite: tents, a campfire, bedrolls and packs, pitched wherever the
heroes stop. The heroes carry it with them from chapter to chapter and campaign to campaign, it
grows as they do, and the kids fill it with things they found, things they bought and creatures
they befriended. It never takes part in the authored story. It is the place the game shows
whenever nothing is being told: the lobby, a rest stop, the chapter's end, the adventure book.

It exists because the game's biggest promise (spec §1.7, *the party is persistent*) is mostly
invisible today. Levels show on the hero, but everything else the crew did lives in a bag, a
Field Guide and a story-so-far. The camp makes "look at all the things we've done" into
something a kid can point at on the TV.

**Why a camp and not a caravan** (*decided*). The heroes cross terrain no wagon could: glaciers,
sky islands, marsh, a volcano. A camp goes on their backs. "Caravan" is also already a story
word: twelve Gemfall chapters narrate a caravan of travelers, with a `caravan_master` and a great
stone called `facet_caravan`, and the crew's own camp must never be confused with it. The story
uses "camp" as an ordinary verb ("the travelers camp for the night"), which fits; narration still
never says "your camp" (§1).

## 1. What it is, and what it is not

| The camp is | The camp is not |
| --- | --- |
| **Cosmetic only** (*decided*). Nothing in it changes a stat, a roll, a fight, a bag slot or a choice. | An equipment system. Spec §9.3 keeps that reward space for the level-up transformation, and the camp respects it. |
| **The crew's** (*decided*). One camp per crew (architecture §4.5, "Crews"), so two groups at one household each have their own. | The household's, or one hero's. |
| **Permanent** (*decided*). A failed campaign takes back levels and items (spec §8.3), never the camp. | A provisional gain. Its rewards survive campaign failure, alongside existing cosmetic souvenirs. |
| **Outside the story** (*decided*). Narration never mentions it, never assumes it and never gates on it. | A place a chapter can send the party, or something a scene can say "back at camp" about. |
| **Seen in downtime** (*decided*): the lobby, rest stops, the chapter's end and the adventure book, online or off. | A destination that competes with a chapter for the 30 minutes. |
| **Always glad to see you.** | A pet to keep alive. Nothing in it gets hungry, sad, dirty or lost. No timers, streaks, daily rewards or "come back tomorrow". |

The last row is a hard rule. Needs meters and streaks work on guilt and compulsion, and this is a
family game for children aged 8 to 12. A camp left alone for a month looks exactly as it did.

## 2. Who it is for

- **The eight-year-old** wants to see Bun again, tap her and watch her hop. Friends and petting
  are this kid's camp.
- **The twelve-year-old** finds petting babyish and wants ownership: *my* tent, *our* banner,
  the upgrade *we* voted for, the trophy that proves we beat the volcano. Customizing and showing
  off are this kid's camp.
- **The grown-up** wants none of it to cost table time or start arguments. That is what the
  downtime-only rule (§3) and the own-space-plus-vote rule (§6) are for.

## 3. Where it appears

The camp is the **default picture outside narration**. Whenever the shared screen has no scene
to tell, it shows the camp, pitched in the terrain the crew is in. Proposed placement:

| Moment | Shared screen (TV, or a phone's World pane) | Phones |
| --- | --- | --- |
| **Lobby**, while seating and getting ready | The full camp, pitched where the crew last stopped. It replaces the lobby's current backdrop; the room code, ready ticks and adventure vote stay on top. | A **Camp** button beside Ready: tap a friend, change your own space (§6.1). |
| **Outdoor rest scene** (§3.2) | The picture crossfades to the full camp, pitched in this chapter's terrain, as the rest scene opens. The scene's narration, when it has any, is shown on the camp screen's plate and read as usual (*decided*). | Trading and stat points as now, plus the Camp button. |
| **Indoor rest scene** (§3.2) | The scene keeps its own picture. The camp is packed down into it: each hero's bedroll and pack, and the friends. Narration as usual. | As outdoors, but only your own space can change. |
| **Chapter's end** (`chapter_complete`) | After the recap and XP, a short camp beat in the full camp: the chapter's Dash Cash counted in (§5.2), anything found this chapter shown beside the campfire (§12.5), and a purchase vote if the crew can afford something (§6.2). | The vote, and the Camp button. |
| **Adventure book** (`/journal`, spec §2.3) | n/a | A fifth tray object, **Camp**: the crew's camp to look at and tap, online or offline, from the last copy this phone read. |
| **In a scene, a check or a fight** | Never. The story owns the screen. | Never. |

**Nothing waits on the camp.** The lobby's Begin, the rest scene's Go on and the chapter end's
"back to the lobby" all work exactly as they do now. Begin closes any camp panel a phone has open.
Leaving the chapter's end cancels an unfinished vote without spending, and the balance waits for
a future chapter-end shop (§6.2). This keeps the session budget untouched: the camp only fills
time that already exists.

**Travel Mode** has no TV, so the camp view lives behind the same Camp button on each phone
during downtime, and in the World pane during the lobby.

### 3.1 Pitched in the right place

Each terrain family (`assets/manifest.json` → `biomeFamilies`, twelve of them) gets one camp
backdrop: a wide, calm campsite painting with room for the camp in the middle third and its
hotspots (§4.2) on a fixed layout. The view picks the backdrop from the chapter's biome, and in
the lobby from the chapter the crew would pick up from. The lobby and the chapter's end always
show the full, outdoor camp.

Painting all twelve is a lot of art, so they ship in order of how often a party rests outdoors
there. These are all rest scenes, counted from the repo on 2026-11-04; once rest scenes are
tagged (§3.2), recount the outdoor ones before commissioning art:

| Terrain family | Rest scenes | Ships |
| --- | --- | --- |
| `red_sky_volcanic` | 31 | First wave |
| `frozen_north` | 26 | First wave |
| `open_plains` | 25 | First wave, and the fallback for every family not painted yet |
| `enchanted_forest` | 7 | Second wave |
| `sky_islands` | 6 | Second wave |
| `whispering_marsh` | 5 | Second wave |
| `cliffside_exchange`, `great_river` | 4 each | Third wave |
| `bone_yard` | 1 | Third wave |
| `expanse`, `skullwater_caverns`, `mermaid_cove` | 0 | When a chapter rests there |

(`sallow_wastelands`, with 3 rest scenes, is in no family today; it falls back to `open_plains`
until it is given one.)

### 3.2 Indoor and outdoor rest scenes

*Decided:* rest scenes are marked indoor or outdoor, and an indoor rest packs the camp down to
backpacks and sleeping bags instead of tents.

Not every rest happens where a tent could go. The party sleeps in bunks in a warden's room
(Gemfall 6), in a cupboard or hayloft (Gemfall 1), on warm stone under silent bells (Gemfall
5C). A campsite painting would contradict those scenes, so every rest scene declares its setting:

- **`"setting": "outdoor"`**: somewhere a campsite could be pitched. The TV crossfades to the full
  camp in this terrain (§3).
- **`"setting": "indoor"`**: everywhere else, including outdoor places no campsite fits (a boat
  deck, a narrow ledge). The scene keeps its own illustration, and the camp appears packed down
  inside it: each hero's bedroll and pack along the front of the picture, and the friends beside
  them. No tents, no campfire and no shared hotspots. Each hero's own bedroll can still change
  (§4.5), and friends can still be tapped.

The field is **required on every rest scene**, so `npm run content:validate` refuses a rest scene
without it and nothing has to guess. Tagging today's 112 rest scenes is a one-time pass: a keyword
scan already flags 31 of them as possibly indoor (rooms, bunks, cupboards, "inside"), but every
scene gets a human read, since "under the bridge" is outdoors and "a warm room" is not. Tagging
a Gemfall chapter re-takes its hashes (§10, "Gemfall is pinned").

## 4. What is in it

### 4.1 The frame: it grows with the crew

The camp's size is its **frame**, and the frame grows a stage each time the crew finishes a full
campaign. This cosmetic ladder is separate from character tiers, which are level-derived (spec
§8.1). Everything at every stage is something the heroes could carry:

| Stage | Frame | Reached |
| --- | --- | --- |
| 1 | Bedrolls around a small campfire | The crew's first chapter |
| 2 | A tent for each hero and a cookfire | First full campaign finished |
| 3 | A bigger camp: an awning, lantern strings and a lookout post | Second full campaign finished |
| 4 | A grand camp: a big shared tent, banners and a lookout | Third full campaign finished |

The frame is **earned, never bought**, so a crew that spends nothing still watches its camp grow.
Each stage adds hotspots (§4.2), so a bigger camp also has more room. When a stage arrives at the
chapter's end it gets its own short moment: the heroes pitch the new camp. That's a small cousin
of the transformation cutscene, never longer than it.

**Only full campaigns count** (*decided*). The Practice Meadow (`first-steps`) is the tutorial and
never grows the frame. Today's full campaigns are Gemfall and Riftlight. The campaign file says
so (`"growsCamp": true`), so a new campaign is a deliberate choice rather than an accident.
The Hollow Crown (`the-hollow-crown`, the one-chapter reference campaign) does not grow the frame
either (*decided*). Both still pay Dash Cash and can hand over finds and friends.

Only a *finished* campaign moves the frame. A failed campaign keeps everything already in the camp
(§1) but does not grow it. A crew still working toward its first finished campaign keeps the camp
changing through the shop, and that is enough (*decided*).

### 4.2 Hotspots, not free placement

The camp is a fixed layout of **hotspots**: the banner pole, the cookfire, the awning, the lantern
hooks, the friends' corner, each hero's tent. Changing the camp is tapping a hotspot and picking
from what the crew owns for it. There is no dragging, no rotating and no free placement.

Hotspots keep it doable for an eight-year-old on a phone, keep every combination looking painted
rather than cluttered, and let the art be composed once per frame stage rather than for every
possible arrangement. They also make the stored state small (§9).

### 4.3 Pieces

A **piece** is anything that goes on a hotspot. Every piece belongs to one hotspot kind and comes
from one of three places:

| Source | How the crew gets it | Examples |
| --- | --- | --- |
| **Found** (§5.1) | A chapter hands it over as part of normal play | A striped awning from the Saltrot market, a cracked bell from the Ashspan Bridge, a pinecone wreath |
| **Bought** (§5.2) | Dash Cash, by vote at the chapter's end (§6.2) | A cookfire with a kettle, a lookout ladder, a second lantern string |
| **Kept** | Something the game already gives that has nowhere to show | Souvenirs from a failed campaign (spec §8.3), the crew's banner and name (`CrewIdentity`), trophies for each finished campaign |

### 4.4 Friends

A **friend** is a creature the crew befriended in a chapter, who now travels with the camp.
Friends stand in the friends' corner and by the campfire, idle with the existing motion system
(`world/idle-motion.ts`), and react when a kid taps them, using the same reaction model as the
`play` story interaction (content/README.md, "Interactivity"). The reactions are words today; the
camp is a good reason to give them a little animation.

**A friend must belong to nobody in the story.** A creature that has an owner, a job or a later
scene of its own cannot also live at the camp. Pepper was the first idea and fails this test: she
is Nim's pony, Nim needs her to carry news north (Gemfall 5A), and she appears again in Gemfall
7H. The candidates that pass:

| Friend | Met in | What befriending already is |
| --- | --- | --- |
| Bun | The Practice Meadow (`first-steps-01`) | "Offer Bun something nice" |
| The mosshorn | Gemfall 4B | Being gentle until it lowers its antlers |
| A duckling | Riftlight, Ashspan Bridge | Settling the ducklings |
| The kid goat | Riftlight, Exchange Rift | Warming it up together |

*Decided:* more friends will be new characters written for the purpose: a creature met in a
chapter, with a befriending moment, and no claim on it anywhere else in the story.

**At most four friends are out at once** (*decided*). For a crew with more than four, the display
rotates them automatically: each downtime moment (a lobby, a rest stop, a chapter's end) brings
out a different four, favoring whoever has been out least, and a friend just befriended is always
out at its first chance (§12.5). Letting the kids choose who is out is left open (§11) in case
families ask for it.

Following the continuity rules, a friend joins because a **choice** says so ("Ask the kid goat to
come along" beside "Say goodbye"), never because of a variant. Saying goodbye costs the story
nothing and is never sad: the friend waves off, and the chapter goes on.

### 4.5 Each hero's space

Every hero seated with the crew has **one space of their own**: a tent outdoors, and a bedroll
and pack indoors (§3.2), in their own color (the palette rule heroes already use), with two or
three small slots for things they choose. Only that hero's player changes it. It shows whenever
the hero is seated, and a hero sitting with another crew brings their space along, because it
belongs to the hero, not the crew (§9, §12.1). At frame stage 1, before tents, it is the bedroll
and pack everywhere.

## 5. How the crew earns things

There are two ways in, and both happen during normal play.

### 5.1 Finds: pieces handed over in a chapter

*Decided:* chapters drop camp pieces as part of normal gameplay, the way they drop items now.

A find is a new chapter effect, `findForCamp: { pieceId }`, beside `grantItem`. It does not go in
a bag, never takes a slot and never vanishes, unlike a quest item (spec §9.2). The phone says "For
the camp!" with the piece's picture. The piece is the crew's the moment the effect is applied
(§12.2), and the chapter's end shows it off beside the campfire.

Authoring rules, so finds keep to the house rules:

- **A find is a bonus, never a gate.** Nothing in the story checks whether the crew has a piece.
- **A find is a reward for something done**, not a thing lying on the floor: helping at the
  Saltrot steps earns the striped awning; calming the ducklings earns a feather for the banner.
  It lands on the scene that shows the result, like any other choice.
- **The scene names the thing, not the camp.** "Grandmother Winkle presses a striped awning into
  your hands" reads true for every party. "For your camp" in narration does not, so that line
  belongs to the phone's notice, outside the narration.
- **A find the crew already owns** turns into Dash Cash instead (§5.2), and the notice says so.
- **In a graph campaign, offered on every way in, given once** (*decided*). Riftlight can reach a
  place in more than one order, so a find or friend there is offered on every way into it. The
  crew gets it the first time and never again from that place, whichever way it came (§12.2).
- **Finds are a few per campaign, not per chapter.** Roughly one every two chapters keeps each one
  an event.

The pieces live in a catalog of their own, `content/camp.json` (§9), validated like the rest of
`content/`. They are not world canon in `canon/items.yaml`: a camp piece is a game object the crew
owns, not an object in the realm's lore.

### 5.2 Dash Cash: points for the crew to spend

*Decided:* chapter points the crew collects and spends on the camp, called **Dash Cash**.

Dash Cash is paid to the **crew**, once, at the chapter's end, from things the chapter already
measures:

| Earned for | Dash Cash |
| --- | --- |
| Finishing a chapter, any ending | 2 |
| Each completed goal step (content/README.md, "The chapter's goal") | 1 each; chapters define 2 to 4 steps |
| Each optional objective met (spec §8.2) | 1 each |
| A find the crew already owns (§5.1) | 1 |

A chapter with all its 2 to 4 goal steps complete earns 4 to 6 Dash Cash before optional
objectives and duplicate finds; a setback may earn less. For planning, target roughly 5 to 8 a
chapter, with a purchase costing around 10 to 15: one purchase every couple of chapters, with the
cadence to be checked in playtests. Every purchase goes through the same vote (§6.2); there is no
separate flow for cheaper pieces. The numbers are a starting point for playtest.

Rules, borrowed from what already works for XP:

- **Party-wide, never individual.** Like story XP and objective bonuses, Dash Cash goes to the
  crew, so no kid is behind on the camp.
- **Paid once per crew per chapter.** A chapter the crew has been paid for pays no Dash Cash again,
  the way a chapter pays each hero once (spec §8.2, #408). A crew replaying for the story can still
  find pieces it does not own.
- **A setback ending still pays its finishing and goal Dash Cash.** Failure reroutes; it doesn't
  zero out.
- **Dash Cash is not coins.** The story's purse (`grantCoins` / `spendCoins`) stays separate, so
  "costs cost" in the story stays a real choice and nobody refuses to pay the ferryman to save up
  for an awning. The TV and phones never show the two side by side.
- **Kept on a failed campaign**, with the rest of the camp (§1).

### 5.3 The first reward comes in the first session

*Decided:* children see something that is theirs in their very first session, so the camp's
purpose is clear before anyone has to wait. Frame growth takes a whole campaign, and Dash Cash
takes a couple of chapters to buy anything, so neither can be the first reward.

- **A personal choice at the first downtime moment.** The first time a hero is seated with a crew
  that has a camp, their kid picks their own space's style and color (§4.5) from the free catalog
  (§12.1). It takes one tap, can be skipped, and is the first thing the camp asks of anyone.
- **A recognizable find in the first chapter.** The Practice Meadow and the first chapter of every
  `growsCamp` campaign each hand over one find on their spine, so every path to every ending gets
  it. It is something the kids will remember from that chapter (a pinecone wreath from the meadow,
  say), and the chapter's end shows it beside the campfire and highlights where it can go.
- *Proposed:* **a starter piece the first chapter can almost buy.** Each shop list has one cheap
  piece (around 5 Dash Cash), so a crew can make its first purchase at the end of its first or
  second chapter.

## 6. Who changes what

*Decided:* anyone in the crew can update the camp; each hero has their own space; purchases go to
a vote.

### 6.1 Free changes: any time it is on screen

Tap a hotspot, pick from what the crew owns. These are free, immediate and reversible by picking
another owned piece (subject to the shared-change limit below):

- **Shared hotspots** (banner, awning, lanterns, cookfire, friends' corner): any seated player, in
  the full camp only. An indoor rest has none (§3.2).
- **A hero's space:** only that hero's player, indoors or out.

If two phones pick for one hotspot at once, the later pick wins and the TV shows it; there is
nothing to lose, because the crew still owns both pieces. Their own space is unlimited.

**The shared-edit limit is a playtest question, not a settled rule** (*decided*). The starting
proposal is that each seated player may change **one shared hotspot per downtime moment** (per
lobby, per rest stop, per chapter end), to keep one kid from redecorating everything while another
watches. It may also frustrate a child who picks the wrong thing, so it ships with two softeners
to test (§12.5):

- **Undo is free.** Undo puts back what the hotspot showed before that player's change, during the
  same downtime moment, and does not use up their change, so a wrong pick can be fixed and
  re-made.
- **Placing something new is free.** Putting a piece found or bought this chapter on its hotspot
  at the chapter's end does not count against the limit.

Playtests decide whether the limit stays, loosens or goes (§13).

### 6.2 Buying: spend Dash Cash, by vote

Buying a piece costs Dash Cash and adds something new to the crew's collection. Spending is a crew
decision:

1. At the **chapter's end**, if the crew can afford something, the phones show up to three pieces
   it can buy, plus "Save our Dash Cash."
2. Every seated player votes, the way a choice point works: most votes wins, and a tie goes to
   the turn marker (spec §6.1). "Save our Dash Cash" is always an option and always free.
3. The winner joins the collection and is shown beside the campfire on the TV, and the crew can
   place it right away (§12.5).

The vote lives only at the chapter's end, never in the lobby (which already has the adventure
vote and should not hold up Begin) and never at a rest stop (which is for trading and stat
points). If the group leaves the chapter-end screen before the vote finishes, nothing is bought
and the Dash Cash waits.

The shop is a short, fixed list for each frame stage, so a crew is choosing between a few things
it can picture, never browsing.

## 7. In the adventure book, and offline

The adventure book (spec §2.3) gets a **Camp** tray object: the crew's full camp, with friends to
tap and every piece's name and where it came from ("Found at the Ashspan Bridge"). The camp's
record rides in the same `GET /api/journal` read and is saved with the book, so it opens without a
signal like the rest of it.

**The book is look-only** (*decided*), keeping its rule that nothing in it can change anything. A
phone between games belongs to one kid, not a crew, so if families ask, the natural exception is
letting that kid change **their own hero's space** from the book while online. That is parked in
§11. Votes and shared hotspots stay at the table.

## 8. Movement: a camp that is alive

*Decided:* characters walk and move around the camp and use the things in it. Not much more than
walking and moving, but it has to look clean.

This is what makes the camp a place rather than a picture. A hero crawls out of their tent when
their kid sits down, wanders over to warm up at the cookfire, and the kid goat trots over when
someone taps it. None of it needs new figure art.

### 8.1 Paper-puppet motion, from the art we already have

Every figure is one finished transparent cutout (docs/art-pipeline.md: the Rive rigs and split
parts are retired). The camp does not bring rigs back. It moves cutouts the way a paper puppet
theater does: the whole figure steps, leans, turns and settles, and **the motion, not the
drawing, says what it is doing**. This is the look to hold the line on. Done carefully it reads
as charming and deliberate. Done carelessly it reads as sliding stickers.

The parts already exist and are shared by the story lineup and the combat board
(`world/actor-art.ts`):

- **Facing.** Art is drawn facing left, and a figure turns by easing `scale.x` through zero to
  `-1`, as combat already does (`facingFor`, `board.ts`).
- **Smoothing.** `approach` moves a value toward its target at a fixed rate, so nothing snaps.
- **Grounding.** Feet sit at the canvas's ground contact (512, 900), with a contact shadow
  (`drawContactShadow`) that follows them.
- **Idle by stance.** `stanceIdle` already breathes standing figures and bobs hovering, flying
  and swimming ones (`world/idle-motion.ts`, #362).
- **Walking a route.** The combat board walks a figure one square at a time at a steady pace and
  leaves fading footprints. The camp walks the same way along its own paths (§8.3).

### 8.2 The walk

A standing figure walks as a series of **steps**, never a glide:

- **Each step is a small hop**: rise about 3% of the figure's height and land. The shadow
  tightens at the top and spreads on landing, so the feet are plainly on the ground between steps.
- **A lean into the walk**: a couple of degrees forward while moving, easing upright on stopping,
  with an alternating wobble of about 1.5° per step for the gait.
- **A tiny squash on landing** (about 2% shorter and wider, back within a tenth of a second).
  It's the one cartoon touch, and it's what keeps the hop from looking mechanical.
- **Starts and stops ease.** The first step and the last are shorter, and a figure arriving
  settles: one small dip, then it breathes. It never brakes to a halt.
- **Speed and step size come from size.** True size is already known (`figure-scale.ts`,
  `height_cm`). A duckling patters with quick, tiny hops; a hero steps at a walking pace; the
  mosshorn lumbers with slow, long ones. Speed grows more slowly than height, so big things don't
  rush.
- **By stance.** Hovering and flying figures don't hop: they glide along the path with their
  existing bob and a little lean. Swimmers stay near water.

### 8.3 Where figures can go

Each camp backdrop (§3.1) declares its ground in the manifest. Each frame stage declares the
camp's spots on that ground.

- **Ground lanes.** The walkable floor is two or three horizontal lanes at fixed depths (near,
  middle, back), not a free 2D field. Lanes make depth order trivial (a nearer lane always draws
  in front), keep figures from overlapping in ugly ways, and make every route a short, readable
  line. A nearer lane draws its figures slightly bigger, so depth reads without a perspective
  engine.
- **Stand points.** Every hotspot (§4.2) has one or more stand points: a place on a lane, the way
  to face, and what to do there (§8.4). The cookfire might have three, the banner one, each hero's
  tent one at its door.
- **Paths, not pathfinding.** A figure gets from one stand point to another along its lane, and
  changes lanes only at the ends of a crossing marked on the layout. It walks around the tents,
  never through them. All of it is authored data on a fixed layout, keeping route planning small
  and testable.
- **One figure per stand point**, and passing figures in one lane take turns: one waits a beat
  rather than walking through another.
- **Clear of the words.** Stand points never sit under the parts of the screen the lobby, the vote
  and the narration plate cover. `stage-inset.ts` already reports how much of the pane the
  narration plate covers, so the story stage stands figures above it; the lobby and vote panels
  would report the same way.
- **Indoors, one lane.** A packed-down camp (§3.2) uses a single generic layout laid over the
  scene's own picture: one near lane along the bottom, a bedroll stand point for each hero and a
  spot for each friend. No per-scene authoring.

### 8.4 What figures do there

A stand point's **action** is a short, looped pose made of the same transforms as the walk, with
the hotspot's piece doing its half:

| Action | The figure | The piece |
| --- | --- | --- |
| **Warm up** (cookfire, campfire) | Faces the fire, settles a little lower, slow breath | Flames flicker while they stand there; a spark rises now and then |
| **Look up** (banner, lookout) | Leans back a few degrees and holds | The banner ripples |
| **Peek** (supply chest, pack) | Leans in, hops once, leans back | The lid or flap lifts and drops |
| **Rest** (own tent or bedroll) | Turns to it, dips and holds still | The tent flap sways |
| **Greet** (another figure) | Turns to face them, one hop | n/a |
| **Pet** (a friend) | Steps close, leans in | The friend hops, turns toward them and its reaction shows (§4.4) |

**A piece moves only while a figure is using it** (*decided*). Everything else is static: a
cookfire nobody is warming up at is a painting, and its flames flicker only while someone stands
at it. A piece that a stand point uses gets its moving part as a small cutout of its own (a flag,
a flame, a lid, a tent flap) on top of the painted piece, with simple motion: sway, ripple,
flicker, lift. Pieces no stand point uses need no moving part at all, which keeps the shop cheap
to paint. The backdrop is static too.

### 8.5 When things move

The camp should feel calm, like watching a campsite, not a busy screen:

- **Wandering.** Each figure stays at a stand point for a while (roughly 8 to 20 seconds), then
  picks another nearby free one and walks there. **At most two figures are walking at once**, so
  the eye always has something to follow and never everything. Indoors nobody wanders: the heroes
  rest on their bedrolls, and a friend moves only when it's tapped.
- **Moments the game already has** take priority over wandering, and each is a little scene:

| Moment | What happens |
| --- | --- |
| A kid sits down in the lobby | Their hero crawls out of their tent (or sits up on their bedroll, at stage 1), looks around and waves (a hop and a turn toward the screen) |
| A kid taps Ready | Their hero shoulders their pack and walks to the trailhead at the edge of camp |
| A player steps away (#258) | Their hero walks back to their own tent and fades the way the lineup already fades a stepped-away hero |
| Begin | Everyone sets off together down the trail as the chapter's first scene fades in, at the start of every chapter (*decided*) |
| An outdoor rest scene opens (§3.2) | The heroes walk in from the edge, and each settles at a spot |
| An indoor rest scene opens (§3.2) | Bedrolls and packs fade in along the front of the scene, with each hero on their own |
| A find or a purchase is shown (§5.1, §6.2) | It appears beside the campfire, the crew gathers round, and its hotspot is highlighted for placing (§12.5) |
| A kid taps a friend on their phone | The friend reacts on the TV, then walks over to that kid's hero |

- **Taps on a phone show on the TV.** A tap is a short-lived message, never saved, sent to the
  room's screens the way room cheers already are (#388, `RoomCheers`). It's rate-limited per
  phone, and the TV queues and drops extra taps, so a kid hammering the button gets a happy friend
  rather than a jittering one.
- **Movement is the screen's own, not the game's.** The server stores where pieces and friends are
  placed (§9), never where anybody is standing. Wandering runs on each screen from a seed taken
  from the downtime moment (§12.6), so the TV and a phone looking at it mostly agree, and nothing
  has to sync. It's the same reasoning as the victory flourish (`world/victory.ts`): spectacle is
  read from state, never put in the protocol.

### 8.6 What "clean" means: the rules

A movement that breaks one of these is a bug, not a matter of taste:

1. **Nothing slides.** A standing figure only moves across the ground while stepping. Every pixel
   of travel belongs to a hop.
2. **Feet stay on the ground line**, and the contact shadow is always under them, including
   mid-turn (combat already keeps the shadow under the feet on a turn).
3. **Nothing snaps.** Every change of position, angle, scale and opacity eases (`approach`). A
   figure that has to be somewhere else at once (a lane full, a resize) fades out and back in
   rather than jumping.
4. **Nothing overlaps badly.** Depth order comes from the lane, one figure per stand point, and
   figures in one lane don't pass through each other.
5. **Calm by default.** Slow walk speeds, long holds, two walkers at most, no idle fidgeting
   beyond the breath.
6. **Small, consistent amounts.** Hop, lean and squash use the same few constants for every
   figure, scaled by size, so the whole cast moves like one family.
7. **Smooth on the slowest screen.** Movement runs on frame time, not frame count, so a dropped
   frame advances the animation by elapsed time without changing its overall speed. A long pause
   resumes without replaying missed movement. It runs at 60 fps on a living room mini-PC and stays
   readable at 30 on an older phone, checked with the frame meter (`?perf`, docs/hardware.md) with
   a full camp: four heroes, four friends and the pieces they are using.

### 8.7 Reduced motion and no WebGL

- **Reduced motion** (`a11y/prefs.ts`, the device preference or the in-game setting): nobody
  wanders and nothing hops. Figures stand at their stand points, as the idle already does when
  `still`. A moment like a hero arriving or a friend being tapped becomes a soft fade at the new
  spot, and the reaction's words show as usual.
- **No WebGL** (`RendererFallback`, `StaticStage`): the camp is drawn as a still picture with
  everybody at their stand points. Nothing is lost but the movement.
- **A hidden or backgrounded screen** stops the movement and picks it up fresh, rather than
  catching up on everything it missed.

### 8.8 How it is built and tested

- **A third stage beside the story lineup and the combat board.** `world/camp.ts` draws it, both
  the full camp and the packed-down indoor one, sharing `actor-art.ts` with the other two, under
  WorldView's usual rules: nothing reads the room mode, nothing uses a viewport unit.
- **The thinking is Pixi-free.** Lanes, stand points, routes, the wander planner and the step
  curve live in pure modules (like `cast.ts`, `board-math.ts` and `idle-motion.ts`), so "nothing
  slides", "one figure per stand point" and "two walkers at most" are things a test can hold
  without a WebGL context.
- **Frame-by-frame tests** run against the fake stage (`testing/fake-stage.ts`) with hand-driven
  frames, as `scene-motion.test.ts` already does.
- **Looking at it** uses `npm run play:jump` with `--record MS` (extended to open the lobby with a
  camp in it, and an indoor and an outdoor rest scene) to film the camp on a TV and phones side by
  side. "Clean" is judged on those recordings at real speed, not on stills.

## 9. The data

New records (architecture §3), each versioned like every stored shape. The sketch below includes
fields that exist only to serve §12's proposals (`revision`, `grownBy`, `rewardId`, receipts);
they stand or fall with those proposals. Phase 1 writes none of it (§10).

| Record | PK | SK | What it holds |
| --- | --- | --- | --- |
| Camp, first crew | `HH#<hhId>` | `CAMP` | The first crew's camp (the first crew has no `CREW#` row or id, architecture §4.5). |
| Camp, other crews | `HH#<hhId>` | `CAMP#<crewId>` | The same shape, one per `CREW#<crewId>`. |

```ts
// packages/shared/src/types/camp.ts (proposed)
interface CampRecord {
  version: number;
  revision: number;                              // conditional writes (§12.4)
  frameStage: 1 | 2 | 3 | 4;
  grownBy: string[];                             // full campaigns that grew it, once each (§12.3)
  dashCash: number;
  owned: Record<PieceId, { from: "found" | "bought" | "kept"; rewardId?: string; at: string }>;
  placed: Record<HotspotId, PieceId>;            // shared hotspots only
  friends: Record<FriendId, { rewardId: string; at: string }>;
  // Receipts (§12.2): paid chapters and claimed reward ids. Storage shape to be chosen
  // after checking transaction and record-size limits.
}

// on Character (domain.ts, stored at CHAR#<charId>), because the space follows the hero (§4.5)
interface CampSpace {
  style: SpaceStyleId;                           // tent and matching bedroll
  slots: (PersonalDecorationId | null)[];        // two or three, from the free catalog (§12.1)
}
```

- **Written only by the server**, as every authoritative change is: phones send intents
  (`campPlace`, `campVote`, `spacePlace`), and the server checks the piece is owned, the hotspot
  fits it, the sender may change it and the intent is not stale.
- **Outside the commitment rule.** Dash Cash, finds and friends go straight onto the record, not
  into provisional gains, so `failCampaign()` never touches them (§1). A find or friend is written
  when its effect is applied, even if the room closes before the chapter's end; Dash Cash is
  written with the chapter's end (§12.2).
- **On the run state**, a slim `camp` view for the screens in the lobby, at rest and at the
  chapter's end, and nothing during scenes.
- **Content**:
  - `content/camp.json` (pieces, personal decorations, hotspots, frame stages, shop lists, friends
    and their reactions) with a schema in `schemas/`, checked by `npm run content:validate`: every
    `findForCamp` names a real piece, every friend a real cast figure, every shop list prices
    pieces of its own stage.
  - On every rest scene, a required `setting: "indoor" | "outdoor"` (§3.2).
  - On a campaign, `growsCamp: true` for the full campaigns (§4.1).
- **Art**: a `camp` section in `assets/manifest.json` (backdrops per terrain family, frames per
  stage, pieces, tent and bedroll styles), owed in `npm run art:inventory` like story plates.
- **Deleting**: the camp goes with its crew and its household, and a hero's space goes with the
  hero. It names no kid, so a kid's own delete (#252) leaves the crew's camp alone.

## 10. Building it in phases

*Decided:* Phase 1 stays small. It proves the animated lobby is appealing before anything else is
built, and each later phase expands only once children notice and recognize their camp.

**Phase 1: an animated lobby.** One backdrop (`open_plains`) at frame stage 1, the seated heroes,
and movement: the walk and its rules (§8.2, §8.6), lanes and stand points, wandering, and the lobby
moments (a hero getting up when their kid sits down, heading to the trailhead on Ready, setting off
on Begin). Reduced motion and the still fallback come with it (§8.7), since they are how some
children will see it. Nothing is stored: a stage-1 camp with the seated heroes needs no camp record,
no catalog and no new intents. Not in Phase 1: the adventure book, offline caching, souvenirs, other
stages, Dash Cash, finds and friends. The test: do children look at the TV during the lobby, point
at their hero and talk about the camp?

**Phase 2: the camp is yours.** The camp record (§9); each hero's own space and the first-session
choice (§5.3); the first-chapter finds (§5.3); Dash Cash at the chapter's end, the shop and the
vote; shared hotspot changes, with the edit limit and Undo under test (§6.1); the chapter-end camp
beat; frame stage 2; souvenirs and the crew banner as kept pieces. Finds go into Riftlight and the
Practice Meadow first. The test: can children find their own space, place a piece without help, and
recognize where their finds came from?

**Phase 3: friends and places.** The four friends in §4.4 and the first new ones, each with a
befriend choice in its chapter; tapping friends on a phone and seeing them react and walk over on
the TV (§8.5); tagging every rest scene indoor or outdoor (§3.2), then the outdoor crossfade and
the packed-down indoor camp; the first-wave backdrops (`red_sky_volcanic`, `frozen_north`); frame
stages 3 and 4; Travel Mode's Camp button.

**Phase 4: the camp between games.** The adventure book's look-only Camp tray (§7) and offline
caching of the camp and its art.

**Later:** the remaining backdrops in the order of §3.1, editing your own space from the adventure
book, more friends and finds as chapters are written.

**Gemfall is pinned.** `gemfall-compat.test.ts` hashes every Gemfall file, so adding a find, a
befriend choice or a rest scene's `setting` to a Gemfall chapter is a deliberate re-hash with its
reason in the commit. Re-taking those hashes for the camp is approved (*decided*). Nothing here
may move the gameplay digests below the hashes: `findForCamp` and `setting` change nothing the
digests measure (no flag, XP, item or route), and that should be checked when the mosshorn is
added and the rest scenes are tagged.

## 11. Decisions and open questions

Settled by the product owner:

| Question | Decision |
| --- | --- |
| What it is | A **camp**, not a caravan: carried on the heroes' backs, and clear of Gemfall's story caravan (intro) |
| The currency's name | **Dash Cash** (§5.2) |
| Rest scenes | Every rest scene is marked indoor or outdoor. Outdoor crossfades to the camp, with its narration on the camp screen; indoor keeps its picture with bedrolls and packs (§3, §3.2) |
| Editing from the adventure book | Not now: the book stays look-only (§7). Left open below |
| A crew with no finished campaign | The shop is enough; the frame still grows only on a finished full campaign (§4.1) |
| The tutorial and The Hollow Crown | Neither grows the frame; only `growsCamp` campaigns do (§4.1) |
| Gemfall's pinned hashes | Re-taking them for the camp's content changes is approved; the gameplay digests must still not move (§10) |
| Friends | Only creatures that belong to nobody in the story; Pepper is out, and new characters will be written (§4.4) |
| How many friends at once | Four at most, rotating on their own (§4.4). Choosing is left open below |
| Finds in a graph campaign | Offered on every way in, given once (§5.1) |
| How much the pieces move | Only a piece a figure is using moves; everything else is static (§8.4) |
| Setting off on Begin | At the start of every chapter (§8.5) |
| Phase 1 | Small: the animated lobby only, expanding once children notice their camp (§10) |
| The first reward | Arrives in the first session: a personal choice and a first-chapter find (§5.3) |
| The shared-edit limit | Tested in playtest, with an Undo that does not use up a change (§6.1) |
| Proposals and requirements | Kept apart: §12 stays proposed until approved, and §13 marks the checks that depend on it |

Still open, parked until families ask:

1. **Editing your own space from the adventure book.** It would break the book's look-only rule
   and needs a write path from a device binding with no room (§7).
2. **Choosing which friends are out.** Friends rotate automatically under this proposal (§4.4). If
   kids want to pick, it is a shared-hotspot change at the friends' corner, under §6.1's
   one-change-per-moment rule.

## 12. Implementation recommendations requiring review

These recommendations close gaps in the draft. They are **proposed**, and should be reviewed
before implementation. The two parked features in §11 do not block the initial release.

### 12.1 Personal pieces follow the hero

Crew inventory and hero-owned spaces need separate ownership rules. A reference to a piece in one
crew's inventory cannot by itself authorize that piece in a hero's space at another crew.

**Recommendation:** initially give every hero the same free catalog of personal decorations and
tent styles. Store their selected style and slots on the character. Reserve earned and purchased
pieces for shared hotspots. Personal decorations then travel with the character without copying
crew property. If earned personal decorations are added later, give them an explicit
character-owned unlock record and transfer and delete rules. Never infer ownership from the
current crew's catalog.

### 12.2 Rewards are permanent, once, and independent of presentation

The once-per-place rule and duplicate conversion need separate identities:

- Give each authored find or friend offer a stable `rewardId` shared across every route into the
  same place. Claiming it writes a crew-scoped receipt atomically with the reward.
- First claim: grant the piece, or 1 Dash Cash if the crew already owns it from another reward. An
  existing receipt grants neither a second piece nor more Dash Cash. Different routes and replays
  cannot farm the same offer.
- Pay chapter-completion Dash Cash and write its paid-chapter receipt together. Replaying an
  already-paid chapter grants no completion, goal or optional-objective payment, including
  objectives missed the first time. Unclaimed finds remain available.
- Persist finds when their authored effect is applied, even if the room closes before the
  chapter's end. Showing a find at the chapter's end celebrates an owned piece; it is never the
  act that saves it. Declining a friend writes no receipt; that friend may be offered on a later
  visit.
- Snapshot completed goal steps for payment. Steps backed by an item must still count if the party
  completed them and later handed over the item. A goal step and an optional objective that
  describe the same deed need an explicit authoring rule: proposed default is one bonus, not two.

Use stable award identities rather than scene ids that can change during editorial revisions. The
record sketch in §9 needs these receipts; choose their storage shape after checking transaction
and record-size limits. A content version update must not reset claims.

### 12.3 Progression has a ceiling and a replay rule

**Recommendation:** count each distinct `growsCamp` campaign the crew successfully completes once
(`grownBy`), capped at stage 4. Failed or abandoned attempts do not advance the frame and do not
remove anything. Replaying a campaign does not advance it again. Later successful campaigns may
add cosmetic trophies after stage 4.

Existing crews need a migration policy: derive the starting stage and kept trophies from their
recorded successful `growsCamp` campaigns, initialize Dash Cash to zero, and do not back-pay
historical chapter rewards. Keep that migration idempotent. Confirm this policy before release.

Every frame must support the full seated party and the four visible friends. Frame growth can add
decorative hotspots, but cannot be required to display a hero's personal space. Early phases must
render a safe fallback for a crew whose derived stage exceeds the available frame art.

### 12.4 The chapter-end purchase is optional and atomic

**Recommendation:** allow at most one purchase per chapter-end visit. Show up to three eligible,
unowned pieces for the current stage, in a stable catalog order, plus **Save our Dash Cash**. Show
the price and resulting balance. If none is affordable, show the balance without starting a vote.
Confirm whether lower-stage pieces remain in later shops; proposed default is yes.

A vote belongs to one chapter-end instance and one crew. Use the existing choice-vote rules for
connected and stepped-away players, including the turn-marker tie break. Leaving the screen
cancels it; there is no pending vote to resume. On resolution the server rechecks eligibility,
ownership and balance, then debits and grants in one commit. Retried messages cannot buy twice.

Two rooms can potentially reach one crew. Use the record's `revision` or an equivalent conditional
write for purchases and placements. A losing concurrent purchase refreshes the offer and balance
without spending. A stale intent from a closed vote or a previous downtime moment is rejected.

### 12.5 Shared edits and automatic display do not discard anything

**Recommendation:** identify each downtime moment on the server, and count shared edits by seated
player rather than device. Reconnecting or using a second phone does not reset the limit. Invalid
changes do not count. Explain the limit before the first edit and disable further shared edits
with a short message; personal edits remain available. Undo (§6.1) restores the hotspot's previous
piece, only for that player's own latest change in the same downtime moment, and gives the change
back; it never undoes another child's pick. Placing a piece first owned this chapter is not
counted. All of this is under test (§6.1), so keep the limit one server-side constant.

Awarding a piece never silently replaces a decoration another child chose. It joins the
collection, is shown beside the campfire, its matching hotspot is highlighted, and a player may
place it during downtime. If its hotspot is not available yet (a later frame stage), it stays in
the collection with a note saying when it can be displayed.

Choose the visible friends once per downtime moment, with a stable tie break and newly acquired
friends first. Persist enough rotation history for "least seen" to survive reconnects; do not
write positions or animation frames. More than four new friends at once queue their first
appearance for later downtime moments. Friends not currently out remain visible in the
collection; rotation never suggests that they left or were lost.

### 12.6 Story independence and presentation take precedence

Rest scenes are resolved by their `setting` (§3.2): only an outdoor rest crossfades to the full
camp, and an indoor one keeps its own picture. When tagging, an outdoor place no campsite fits
(a boat deck, a narrow ledge) is tagged indoor.

Friend invitations name the creature and offer "Come along" without naming the camp. A friend
must belong to nobody in the story (§4.4): check every later chapter for the creature before
adding it, and treat a later authored appearance as a reason to pick another friend, never a
reason to rewrite the story. Cosmetic collection state must never rewrite story continuity.

"Nothing waits" applies to animation too: Begin and Go on interrupt any gathering, purchase
celebration or setting off immediately. There is no countdown and no animation completion gate.
Local animation may differ between screens; use a downtime-moment seed rather than the wall
clock, and do not depend on matching positions to resolve a tap.

Every phone action also needs a named, keyboard-accessible control outside the canvas. Friends
have text reactions; pieces have labels, source and selected state. Follow
[accessibility settings](accessibility.md) for touch targets, largest text, contrast and reduced
motion. Still rendering keeps every interaction. Cache the camp snapshot and its required art for
the look-only book, label its last-sync time, and provide a useful first-visit empty state. If the
device can reach more than one crew, name the selected crew explicitly in the book.

## 13. Acceptance criteria and playtest questions

### 13.1 Required: checks of decided design

These follow from decisions in §11 and the existing rules the camp lives under, and hold whatever
happens to §12.

- Failed campaigns keep every camp gain (§1).
- The tutorial, The Hollow Crown and any other campaign without `growsCamp` never grow the frame
  (§4.1).
- A find or friend in a graph campaign is offered on every way in and given once (§5.1).
- Every rest scene has a `setting`, and validation fails without one. An indoor rest never shows
  the campsite backdrop or tents (§3.2).
- The first session offers each kid a choice for their own space, and the first chapter of the
  Practice Meadow and of every `growsCamp` campaign hands over a find on every path (§5.3).
- No purchase can overspend, buy a piece twice or charge after the chapter's end has been left.
  Placements the sender may not make are refused (§6).
- A hero's own space survives changing crews and moving the hero home (§4.5). Household and
  character deletion follow existing lifecycle rules.
- Begin, Go on and return to lobby remain available with panels open and during every animation
  (§3, §8).
- At most four friends are out, and four heroes and four friends fit each frame, and the indoor
  layout, without covering required controls or narration (§4.4). Review recordings for walking,
  crossings, occlusion and layout at phone and TV sizes (§8.6). Verify largest text, reduced
  motion and the still fallback (§8.7), and keyboard access as docs/accessibility.md already
  requires.
- The book opens offline after an online read with its saved pieces and friend reactions (§7).

### 13.2 Conditional: checks that apply only if §12 is approved

Each of these tests a proposal. If its proposal is rejected or changed, the check goes or changes
with it.

- *If §12.2 is approved:* a reward reached through two routes, replayed, retried or reconnected
  grants once, by its `rewardId` receipt; a duplicate owned piece converts to Dash Cash once per
  distinct reward offer; skipping a celebration does not lose its reward, because finds are saved
  when found.
- *If §12.3 is approved:* each `growsCamp` campaign grows the frame at most once per crew, however
  often it is replayed, and the frame stops at stage 4; existing crews migrate idempotently.
- *If §12.1 is approved:* personal decorations come from the free catalog, and crew-owned pieces
  never appear in a hero's space at another crew.
- *If §12.4 is approved:* at most one purchase per chapter-end visit; a losing concurrent purchase
  refreshes the offer without spending; a stale intent is refused.
- *If §12.5 is approved:* shared edits are counted per seated player, not per device; Undo gives
  the change back; placing a piece first owned this chapter is not counted.
- *If §12.6 is approved:* the book names the crew and how fresh its saved copy is, and its first
  use without a cache is clear.

### 13.3 Playtest questions

Playtest each phase with children in both target age groups and a grown-up. Observe whether children
recognize a past adventure, can find their own space and can place a piece without help. Record
whether the shared-edit limit causes arguments or frustration, how often children use Undo, and
whether automatic friend rotation feels fair. Note whether children understand what the camp is for
after their first session (§5.3). Measure added time before Begin and Go on: the technical target is
no forced delay; voluntary time spent decorating should be reported separately.

Before expanding art production, verify the first phase's central question: do children notice
and care about their crew's camp? Before tuning shop prices, measure actual first-play rewards,
time to the first affordable purchase and how often a crew chooses to save. The economy targets in
§5.2 are hypotheses until those observations exist.
