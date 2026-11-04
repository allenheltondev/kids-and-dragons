# The caravan

**Status: design, nothing built.** Every decision below marked *decided* was made by the
product owner; everything else is a proposal. The decisions so far and the questions still open
are at the end (§11).

The caravan is the crew's traveling camp. It follows the heroes from chapter to chapter and
campaign to campaign, it grows as they do, and the kids fill it with things they found, things
they bought and creatures they befriended. It is never part of the story. It is the place the
game shows whenever nothing is being told: the lobby, a rest stop, the chapter's end, the
adventure book.

It exists because the game's biggest promise (spec §1.7, *the party is persistent*) is mostly
invisible today. Levels show on the hero, but everything else the crew did lives in a bag, a
Field Guide and a story-so-far. The caravan makes "look at all the things we've done" into
something a kid can point at on the TV.

## 1. What it is, and what it is not

| The caravan is | The caravan is not |
| --- | --- |
| **Cosmetic only** (*decided*). Nothing in it changes a stat, a roll, a fight, a bag slot or a choice. | An equipment system. Spec §9.3 keeps that reward space for the level-up transformation, and the caravan respects it. |
| **The crew's** (*decided*). One caravan per crew (architecture §4.5, "Crews"), so two groups at one household each have their own. | The household's, or one hero's. |
| **Permanent** (*decided*). A failed campaign takes back levels and items (spec §8.3), never the caravan. | A provisional gain. It is the one thing a campaign earns that is kept on failure, which is safe only because it is cosmetic. |
| **Outside the story** (*decided*). Narration never mentions it, never assumes it and never gates on it. | A place a chapter can send the party, or something a scene can say "back at the caravan" about. |
| **Seen in downtime** (*decided*): the lobby, rest stops, the chapter's end and the adventure book, online or off. | A destination that competes with a chapter for the 30 minutes. |
| **Always glad to see you.** | A pet to keep alive. Nothing in it gets hungry, sad, dirty or lost. No timers, streaks, daily rewards or "come back tomorrow". |

The last row is a hard rule. Needs meters and streaks work on guilt and compulsion, and this is
a family game for 8 to 12 year olds. A caravan left alone for a month looks exactly as it did.

## 2. Who it is for

- **The eight-year-old** wants to see Pepper again, tap her and hear her snort. Friends and
  petting are this kid's caravan.
- **The twelve-year-old** finds petting babyish and wants ownership: *my* tent, *our* banner,
  the upgrade *we* voted for, the trophy that proves we beat the volcano. Customizing and showing
  off are this kid's caravan.
- **The grown-up** wants none of it to cost table time or start arguments. That is what the
  downtime-only rule (§3) and the own-space-plus-vote rule (§6) are for.

## 3. Where it appears

The caravan is the **default picture outside narration**. Whenever the shared screen has no
scene to tell, it shows the caravan, parked in the terrain the crew is in. Proposed placement:

| Moment | Shared screen (TV, or a phone's World pane) | Phones |
| --- | --- | --- |
| **Lobby**, while seating and getting ready | The caravan, parked where the crew last stopped. It replaces the lobby's current backdrop; the room code, ready ticks and adventure vote stay on top. | A **Caravan** button beside Ready: tap a friend, change your own space (§6.1). |
| **Rest scene** | The picture crossfades to the caravan, parked in this chapter's terrain, as the rest scene opens. The rest scene's narration, when it has any, is shown on the caravan screen's plate, read as usual (*decided*). | Trading and stat points as now, plus the Caravan button. |
| **Chapter's end** (`chapter_complete`) | After the recap and XP, a short caravan beat: the chapter's Dash Cash counted in (§5.2), anything found this chapter unpacked onto the caravan, and a big-upgrade vote if the crew can afford one (§6.2). | The vote, and the Caravan button. |
| **Adventure book** (`/journal`, spec §2.3) | n/a | A fifth tray object, **Caravan**: the crew's caravan to look at and tap, online or offline, from the last copy this phone read. |
| **In a scene, a check or a fight** | Never. The story owns the screen. | Never. |

**Nothing waits on the caravan.** The lobby's Begin, the rest scene's Go on and the chapter
end's "back to the lobby" all work exactly as they do now. Begin closes any caravan panel a phone
has open, and an unfinished vote is simply left for next time (§6.2). This keeps the session
budget untouched: the caravan only fills time that already exists.

**Travel Mode** has no TV, so the caravan view lives behind the same Caravan button on each
phone during downtime, and in the World pane during the lobby.

### 3.1 Parked in the right place

Each terrain family (`assets/manifest.json` → `biomeFamilies`, twelve of them) gets one caravan
backdrop: a wide, calm campsite painting with room for the caravan in the middle third and its
hotspots (§4.2) on a fixed layout. The view picks the backdrop from the chapter's biome, and in
the lobby from the chapter the crew would pick up from.

Painting all twelve is a lot of art, so they ship in order of how often a party rests there.
Counting `rest` scenes across today's 42 chapters:

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

## 4. What is in it

### 4.1 The frame: it grows with the crew

The caravan's size is its **frame**, and the frame grows a stage each time the crew finishes a
campaign, matching spec §8.1's one tier per campaign:

| Stage | Frame | Reached |
| --- | --- | --- |
| 1 | A handcart and a campfire | The crew's first chapter |
| 2 | A covered wagon | First campaign finished |
| 3 | A small caravan: two wagons and a lead animal | Second campaign finished |
| 4 | A traveling camp: wagons, a lookout and banners | Third campaign finished |

The frame is **earned, never bought**, so a crew that spends nothing still watches its caravan
grow. Each stage adds hotspots (§4.2), so a bigger caravan also has more room. When a stage
arrives at the chapter's end it gets its own short moment: the old frame is wheeled off and the
new one rolls in. That's a small cousin of the transformation cutscene, never longer than it.

Only a *finished* campaign moves the frame. A failed campaign keeps everything already in the
caravan (§1) but does not grow it. A crew still working toward its first finished campaign keeps
the caravan changing through the shop, and that is enough (*decided*).

### 4.2 Hotspots, not free placement

The caravan is a fixed layout of **hotspots**: the banner pole, the cookfire, the awning, the
lantern hooks, the pen, each hero's space. Changing the caravan is tapping a hotspot and picking
from what the crew owns for it. There is no dragging, no rotating and no free placement.

Hotspots keep it doable for an eight-year-old on a phone, keep every combination looking painted
rather than cluttered, and let the art be composed once per frame stage rather than for every
possible arrangement. They also make the stored state small (§9).

### 4.3 Pieces

A **piece** is anything that goes on a hotspot. Every piece belongs to one hotspot kind and
comes from one of three places:

| Source | How the crew gets it | Examples |
| --- | --- | --- |
| **Found** (§5.1) | A chapter hands it over as part of normal play | A striped awning from the Saltrot market, a cracked bell from the Ashspan Bridge, a pinecone wreath |
| **Bought** (§5.2) | Dash Cash, at the chapter's end, by vote if it is a big upgrade | A cookfire with a kettle, a lookout ladder, a second lantern string |
| **Kept** | Something the game already gives that has nowhere to show | Souvenirs from a failed campaign (spec §8.3), the crew's banner and name (`CrewIdentity`), trophies for each finished campaign |

### 4.4 Friends

A **friend** is a creature the crew befriended in a chapter, who now travels with the caravan.
Friends stand on the pen and campfire hotspots, idle with the existing motion system
(`world/idle-motion.ts`), and react when a kid taps them, using the same reaction model as the
`play` story interaction (content/README.md, "Interactivity"). The reactions are words today;
the caravan is a good reason to give them a little animation.

The first friends almost write themselves, because the story already makes kids care about them:

| Friend | Met in | What befriending already is |
| --- | --- | --- |
| Bun | The Practice Meadow (`first-steps-01`) | "Offer Bun something nice" |
| Pepper | Gemfall 5A | Calming her until her ears come forward |
| The mosshorn | Gemfall 4B | Being gentle until it lowers its antlers |
| A duckling | Riftlight, Ashspan Bridge | Settling the ducklings |
| The kid goat | Riftlight, Exchange Rift | Warming it up together |

**At most four friends are out at once** (*decided*). A crew with more than four rotates them on
its own: each downtime moment (a lobby, a rest stop, a chapter's end) brings out a different four,
favoring whoever has been out least, and a friend just befriended is always out at its first
chance. Letting the kids choose who is out is left open (§11) in case families ask for it.

Following the continuity rules, a friend joins because a **choice** says so ("Ask Pepper to come
along" beside "Say goodbye"), never because of a variant. Saying goodbye costs the story nothing
and is never sad: the friend waves off, and the chapter goes on.

### 4.5 Each hero's space

Every hero seated with the crew has **one space of their own**: a tent, a bedroll or a wagon
corner, in their own color (the palette rule heroes already use), with two or three small slots
for things they choose. Only that hero's player changes it. It shows whenever the hero is seated,
and a hero sitting with another crew brings their space along, because it belongs to the hero,
not the crew (§9).

## 5. How the crew earns things

There are two ways in, and both happen during normal play.

### 5.1 Finds: pieces handed over in a chapter

*Decided:* chapters drop caravan pieces as part of normal gameplay, the way they drop items now.

A find is a new chapter effect, `findForCaravan: { pieceId }`, beside `grantItem`. It does not
go in a bag, never takes a slot and never vanishes, unlike a quest item (spec §9.2). The phone
says "For the caravan!" with the piece's picture, and the piece is unpacked onto the caravan at
the chapter's end (§3).

Authoring rules, so finds keep to the house rules:

- **A find is a bonus, never a gate.** Nothing in the story checks whether the crew has a piece.
- **A find is a reward for something done**, not a thing lying on the floor: helping at the
  Saltrot steps earns the striped awning; calming the ducklings earns a feather for the banner.
  It lands on the scene that shows the result, like any other choice.
- **The scene names the thing, not the caravan.** "Grandmother Winkle presses a striped awning
  into your hands" reads true for every party. "For your caravan" in narration does not, so that
  line belongs to the phone's notice, outside the narration.
- **A find the crew already owns** turns into Dash Cash instead (§5.2), and the notice says so.
- **In a graph campaign, offered on every way in, given once** (*decided*). Riftlight can reach
  a place in more than one order, so a find or friend there is offered on every way into it. The
  crew gets it the first time and never again from that place, whichever way it came.
- **Finds are a few per campaign, not per chapter.** Roughly one every two chapters keeps each
  one an event.

The pieces live in a catalog of their own, `content/caravan.json` (§9), validated like the rest
of `content/`. They are not world canon in `canon/items.yaml`: a caravan piece is a game object
the crew owns, not an object in the realm's lore.

### 5.2 Dash Cash: points for the crew to spend

*Decided:* chapter points the crew collects and spends on upgrading the caravan, called **Dash
Cash**.

Dash Cash is paid to the **crew**, once, at the chapter's end, from things the chapter already
measures:

| Earned for | Dash Cash |
| --- | --- |
| Finishing a chapter, any ending | 2 |
| Each step of the chapter's goal ticked (content/README.md, "The chapter's goal") | 1 each, so 2 to 4 |
| Each optional objective met (spec §8.2) | 1 each |
| A find the crew already owns (§5.1) | 1 |

That is about 5 to 8 Dash Cash a chapter, and a big upgrade costs around 10 to 15: one big upgrade
every couple of chapters, and plenty of small ones. The numbers are a starting point for playtest.

Rules, borrowed from what already works for XP:

- **Party-wide, never individual.** Like story XP and objective bonuses, Dash Cash goes to the crew,
  so no kid is behind on the caravan.
- **Paid once per crew per chapter.** A chapter the crew has been paid for pays no Dash Cash again,
  the way a chapter pays each hero once (spec §8.2, #408). A crew replaying for the story can
  still find pieces it does not own.
- **A setback ending still pays its finishing and goal Dash Cash.** Failure reroutes; it doesn't
  zero out.
- **Dash Cash is not coins.** The story's purse (`grantCoins` / `spendCoins`) stays separate, so
  "costs cost" in the story stays a real choice and nobody refuses to pay the ferryman to save up
  for an awning.
- **Kept on a failed campaign**, with the rest of the caravan (§1).

## 6. Who changes what

*Decided:* anyone in the crew can update the caravan; each hero has their own space; big
upgrades go to a vote.

### 6.1 Free changes: any time it is on screen

Tap a hotspot, pick from what the crew owns. These are free, instant and undoable:

- **Shared hotspots** (banner, awning, lanterns, cookfire, pen): any seated player.
- **A hero's space:** only that hero's player.

If two phones pick for one hotspot at once, the later pick wins and the TV shows it; there is
nothing to lose, because the crew still owns both pieces. To keep one kid from redecorating
everything while another watches, a phone may change **one shared hotspot per downtime moment**
(per lobby, per rest stop, per chapter end). Their own space is unlimited.

### 6.2 Big upgrades: spend Dash Cash, by vote

A **big upgrade** is a bought piece: it costs Dash Cash and adds something new to the crew's
collection. Spending is a crew decision:

1. At the **chapter's end**, if the crew can afford something, the phones show two or three
   upgrades it can buy, plus "Save our Dash Cash."
2. Every seated player votes, the way a choice point works: most votes wins, and a tie goes to
   the turn marker (spec §6.1). "Save our Dash Cash" is always an option and always free.
3. The winner is unpacked onto the caravan on the TV, and the crew can place it right away.

The vote lives only at the chapter's end, never in the lobby (which already has the adventure
vote and should not hold up Begin) and never at a rest stop (which is for trading and stat
points). If the chapter ends before the vote finishes, nothing is bought and the Dash Cash waits.

The shop is a short, fixed list for each frame stage, so a crew is choosing between a few things
it can picture, never browsing.

## 7. In the adventure book, and offline

The adventure book (spec §2.3) gets a **Caravan** tray object: the crew's caravan, with friends
to tap and every piece's name and where it came from ("Found at the Ashspan Bridge"). The
caravan's record rides in the same `GET /api/journal` read and is saved with the book, so it
opens without a signal like the rest of it.

**The book is look-only** (*decided*), keeping its rule that nothing in it can change anything.
A phone between games belongs to one kid, not a crew, so if families ask, the natural exception
is letting that kid change **their own hero's space** from the book while online. That is parked
in §11. Votes and shared hotspots stay at the table.

## 8. Movement: a caravan that is alive

*Decided:* characters walk and move around the caravan and use the things in it. Not much more
than walking and moving, but it has to look clean.

This is what makes the caravan a place rather than a picture. A hero comes out of their tent when
their kid sits down, wanders over to warm up at the cookfire, and Pepper trots over when someone
taps her. None of it needs new figure art.

### 8.1 Paper-puppet motion, from the art we already have

Every figure is one finished transparent cutout (docs/art-pipeline.md: the Rive rigs and split
parts are retired). The caravan does not bring rigs back. It moves cutouts the way a paper puppet
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
- **Walking a route.** The combat board walks a figure one square at a time at a steady pace
  and leaves fading footprints. The caravan walks the same way along its own paths (§8.3).

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

Each caravan backdrop (§3.1) declares its ground in the manifest. Each frame stage declares the
caravan's spots on that ground.

- **Ground lanes.** The walkable floor is two or three horizontal lanes at fixed depths (near,
  middle, back), not a free 2D field. Lanes make depth order trivial (a nearer lane always draws
  in front), keep figures from overlapping in ugly ways, and make every route a short, readable
  line. A nearer lane draws its figures slightly bigger, so depth reads without a perspective
  engine.
- **Stand points.** Every hotspot (§4.2) has one or more stand points: a place on a lane, the
  way to face, and what to do there (§8.4). The cookfire might have three, the banner one, each
  hero's space one at its door.
- **Paths, not pathfinding.** A figure gets from one stand point to another along its lane, and
  changes lanes only at the ends of a crossing marked on the layout. It walks around the caravan,
  never through it. All of it is authored data on a fixed layout, so there's no navigation code
  to get wrong.
- **One figure per stand point**, and passing figures in one lane take turns: one waits a beat
  rather than walking through another.
- **Clear of the words.** Stand points never sit under the parts of the screen the lobby, the
  vote and the narration plate cover. `stage-inset.ts` already reports how much of the pane the
  narration plate covers, so the story stage stands figures above it; the lobby and vote panels
  would report the same way.

### 8.4 What figures do there

A stand point's **action** is a short, looped pose made of the same transforms as the walk, with
the hotspot's piece doing its half:

| Action | The figure | The piece |
| --- | --- | --- |
| **Warm up** (cookfire) | Faces the fire, settles a little lower, slow breath | Flames flicker while they stand there; a spark rises now and then |
| **Look up** (banner, lookout) | Leans back a few degrees and holds | The banner ripples |
| **Peek** (wagon, chest) | Leans in, hops once, leans back | The lid lifts and drops |
| **Rest** (own space) | Turns to the door, dips and holds still | The tent flap sways |
| **Greet** (another figure) | Turns to face them, one hop | n/a |
| **Pet** (a friend) | Steps close, leans in | The friend hops, turns toward them and its reaction shows (§4.4) |

**A piece moves only while a figure is using it** (*decided*). Everything else is static: a
cookfire nobody is warming up at is a painting, and its flames flicker only while someone stands
at it. A piece that a stand point uses gets its moving part as a small cutout of its own (a flag,
a flame, a lid, a tent flap) on top of the painted piece, with simple motion: sway, ripple,
flicker, lift. Pieces no stand point uses need no moving part at all, which keeps the shop cheap
to paint. The backdrop is static too.

### 8.5 When things move

The caravan should feel calm, like watching a campsite, not a busy screen:

- **Wandering.** Each figure stays at a stand point for a while (roughly 8 to 20 seconds),
  then picks another nearby free one and walks there. **At most two figures are walking at
  once**, so the eye always has something to follow and never everything.
- **Moments the game already has** take priority over wandering, and each is a little scene:

| Moment | What happens |
| --- | --- |
| A kid sits down in the lobby | Their hero steps out of their own space, looks around and waves (a hop and a turn toward the screen) |
| A kid taps Ready | Their hero walks to the wagon and waits there |
| A player steps away (#258) | Their hero walks back to their own space and fades the way the lineup already fades a stepped-away hero |
| Begin | Everyone gathers at the wagon, and the caravan rolls off as the chapter's first scene fades in, at the start of every chapter (*decided*) |
| A rest scene opens (§3) | The heroes walk in from the edge, and each settles at a spot |
| A find is unpacked (§5.1) | A hero carries it to its hotspot, and it pops into place |
| A big upgrade is bought (§6.2) | The crew gathers round as it's put up |
| A kid taps a friend on their phone | The friend reacts on the TV, then walks over to that kid's hero |

- **Taps on a phone show on the TV.** A tap is a short-lived message, never saved, sent to the
  room's screens the way room cheers already are (#388, `RoomCheers`). It's rate-limited per
  phone, and the TV queues and drops extra taps, so a kid hammering the button gets a happy
  friend rather than a jittering one.
- **Movement is the screen's own, not the game's.** The server stores where pieces and friends
  are placed (§9), never where anybody is standing. Wandering runs on each screen from a seed
  (the caravan and the minute), so the TV and a phone looking at it mostly agree, and nothing has
  to sync. It's the same reasoning as the victory flourish (`world/victory.ts`): spectacle is read
  from state, never put in the protocol.

### 8.6 What "clean" means: the rules

A movement that breaks one of these is a bug, not a matter of taste:

1. **Nothing slides.** A standing figure only moves across the ground while stepping. Every
   pixel of travel belongs to a hop.
2. **Feet stay on the ground line**, and the contact shadow is always under them, including mid-
   turn (combat already keeps the shadow under the feet on a turn).
3. **Nothing snaps.** Every change of position, angle, scale and opacity eases (`approach`). A
   figure that has to be somewhere else at once (a lane full, a resize) fades out and back in
   rather than jumping.
4. **Nothing overlaps badly.** Depth order comes from the lane, one figure per stand point, and
   figures in one lane don't pass through each other.
5. **Calm by default.** Slow walk speeds, long holds, two walkers at most, no idle fidgeting
   beyond the breath.
6. **Small, consistent amounts.** Hop, lean and squash use the same few constants for every
   figure, scaled by size, so the whole cast moves like one family.
7. **Smooth on the slowest screen.** Movement runs on frame time, not frame count, so a
   dropped frame shortens a step rather than stopping it. It runs at 60 fps on a living room
   mini-PC and stays readable at 30 on an older phone, checked with the frame meter (`?perf`,
   docs/hardware.md) with a full caravan: four heroes, four friends and the pieces they are using.

### 8.7 Reduced motion and no WebGL

- **Reduced motion** (`a11y/prefs.ts`, the device preference or the in-game setting): nobody
  wanders and nothing hops. Figures stand at their stand points, as the idle already does when
  `still`. A moment like a hero arriving or a friend being tapped becomes a soft fade at the new
  spot, and the reaction's words show as usual.
- **No WebGL** (`RendererFallback`, `StaticStage`): the caravan is drawn as a still picture with
  everybody at their stand points. Nothing is lost but the movement.
- **A hidden or backgrounded screen** stops the movement and picks it up fresh, rather than
  catching up on everything it missed.

### 8.8 How it is built and tested

- **A third stage beside the story lineup and the combat board.** `world/caravan.ts` draws it,
  sharing `actor-art.ts` with the other two, under WorldView's usual rules: nothing reads the room
  mode, nothing uses a viewport unit.
- **The thinking is Pixi-free.** Lanes, stand points, routes, the wander planner and the step
  curve live in pure modules (like `cast.ts`, `board-math.ts` and `idle-motion.ts`), so "nothing
  slides", "one figure per stand point" and "two walkers at most" are things a test can hold
  without a WebGL context.
- **Frame-by-frame tests** run against the fake stage (`testing/fake-stage.ts`) with hand-driven
  frames, as `scene-motion.test.ts` already does.
- **Looking at it** uses `npm run play:jump` with `--record MS` (extended to open the lobby with
  a caravan in it) to film the caravan on a TV and phones side by side. "Clean" is judged on
  those recordings at real speed, not on stills.

## 9. The data

New records (architecture §3), each versioned like every stored shape:

| Record | PK | SK | What it holds |
| --- | --- | --- | --- |
| Caravan, first crew | `HH#<hhId>` | `CARAVAN` | The first crew's caravan (the first crew has no `CREW#` row or id, architecture §4.5). |
| Caravan, other crews | `HH#<hhId>` | `CARAVAN#<crewId>` | The same shape, one per `CREW#<crewId>`. |

```ts
// packages/shared/src/types/caravan.ts (proposed)
interface CaravanRecord {
  version: number;
  frameStage: 1 | 2 | 3 | 4;
  dashCash: number;
  owned: Record<PieceId, { from: "found" | "bought" | "kept"; chapterId?: string; at: string }>;
  placed: Record<HotspotId, PieceId>;           // shared hotspots only
  friends: Record<FriendId, { chapterId: string; at: string }>;
  paidChapters: string[];                        // Dash Cash paid once per chapter (§5.2)
}

// on Character (domain.ts, stored at CHAR#<charId>), because the space follows the hero (§4.5)
interface CaravanSpace {
  style: SpaceStyleId;                           // tent, bedroll, wagon corner
  slots: (PieceId | null)[];                     // two or three
}
```

- **Written only by the server**, as every authoritative change is: phones send intents
  (`caravanPlace`, `caravanVote`, `spacePlace`), and the server checks the piece is owned, the
  hotspot fits it and the sender may change it.
- **Outside the commitment rule.** Dash Cash, finds and friends go straight onto the record in the
  chapter's commit, not into provisional gains, so `failCampaign()` never touches them (§1).
- **On the run state**, a slim `caravan` view for the screens in the lobby, at rest and at the
  chapter's end, and nothing during scenes.
- **Content**: `content/caravan.json` (pieces, hotspots, frame stages, shop lists, friends and
  their reactions) with a schema in `schemas/`, checked by `npm run content:validate`: every
  `findForCaravan` names a real piece, every friend a real cast figure, every shop list prices
  pieces of its own stage.
- **Art**: a `caravan` section in `assets/manifest.json` (backdrops per terrain family, frames per
  stage, pieces, hero-space styles), owed in `npm run art:inventory` like story plates.
- **Deleting**: the caravan goes with its crew and its household, and a hero's space goes with the
  hero. It names no kid, so a kid's own delete (#252) leaves the crew's caravan alone.

## 10. Building it in phases

Each phase is playable on its own, and the first one tests the whole idea cheaply.

**Phase 1: the caravan exists, and it is alive.** The record and its view; the `open_plains`
backdrop for everywhere; frame stage 1 and 2; souvenirs and the crew banner as kept pieces; the
lobby showing it on the TV; the adventure book's look-only tray. Movement ships here, not later,
because it is most of the appeal: the walk and its rules (§8.2, §8.6), lanes and stand points,
wandering, and the lobby moments (a hero stepping out on sitting down, walking to the wagon on
Ready, the roll-off on Begin). No Dash Cash, finds or friends yet. The test: do kids point at the
TV during the lobby?

**Phase 2: earning and changing it.** Dash Cash at the chapter's end; the shop and the vote;
free hotspot changes; each hero's space; the caravan beat on the chapter's end; the first
`findForCaravan` finds, in Riftlight and the Practice Meadow first (Gemfall is pinned, below).

**Phase 3: friends and places.** The five friends above, each with a befriend choice in its
chapter; tapping friends on a phone and seeing them react and walk over on the TV (§8.5); the
rest-scene crossfade; the first-wave backdrops (`red_sky_volcanic`, `frozen_north`); frame stages 3 and 4; Travel Mode's Caravan button.

**Later:** the remaining backdrops in the order of §3.1, editing your own space from the
adventure book, more friends and finds as chapters are written.

**Gemfall is pinned.** `gemfall-compat.test.ts` hashes every Gemfall file, so adding a find or a
befriend choice to a Gemfall chapter is a deliberate re-hash with its reason in the commit. A new
effect must not move the gameplay digests below the hashes: `findForCaravan` changes nothing the
digests measure (no flag, XP, item or route), and that should be checked when Pepper and the
mosshorn are added.

## 11. Decisions and open questions

Settled by the product owner:

| Question | Decision |
| --- | --- |
| The currency's name | **Dash Cash** (§5.2) |
| Rest-scene timing | Crossfade to the caravan as the rest scene opens; its narration shows on the caravan screen (§3) |
| Editing from the adventure book | Not now: the book stays look-only (§7). Left open below |
| A crew with no finished campaign | The shop is enough; the frame still grows only on a finished campaign (§4.1) |
| How many friends at once | Four at most, rotating on their own (§4.4). Choosing is left open below |
| Finds in a graph campaign | Offered on every way in, given once (§5.1) |
| How much the pieces move | Only a piece a figure is using moves; everything else is static (§8.4) |
| The roll-off on Begin | At the start of every chapter (§8.5) |

Still open, parked until families ask:

1. **Editing your own space from the adventure book.** It would break the book's look-only rule
   and needs a write path from a device binding with no room (§7).
2. **Choosing which friends are out.** Friends rotate on their own today (§4.4). If kids want to
   pick, it is a shared-hotspot change at the pen, under §6.1's one-change-per-moment rule.
