# The camp: the crew's campsite

**Status: design approved, nothing built.** Every decision below marked *decided* was made by the
product owner, and the implementation requirements in §12 are approved as a whole. Nothing is
still only proposed. Every decision is listed in §11; acceptance criteria and playtest questions
are in §13. Prices and payouts remain starting points for playtest (§5.2).

**Review status:** repository references are implementation context. File names, type names and
interfaces below are the intended shape, and may be refined during implementation as long as the
behavior they describe holds.

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
  downtime-only rule (§3) and the own-kit-plus-vote rule (§6) are for.

## 3. Where it appears

The camp is the **default picture outside narration**. Whenever the shared screen has no scene
to tell, it shows the camp, pitched in the terrain the crew is in:

| Moment | Shared screen (TV, or a phone's World pane) | Phones |
| --- | --- | --- |
| **Lobby**, while seating and getting ready | The full camp, pitched where the crew last stopped. It replaces the lobby's current backdrop; the room code, ready ticks and adventure vote stay on top. | A **Camp** button beside Ready: tap a friend, change your own kit or buddy (§4.4, §4.5). |
| **Outdoor rest scene** (§3.2) | The picture crossfades to the full camp, pitched in this chapter's terrain, as the rest scene opens. The scene's narration, when it has any, is shown on the camp screen's plate and read as usual (*decided*). | Trading and stat points as now, plus the Camp button. |
| **Indoor rest scene** (§3.2) | The scene keeps its own picture. The camp is packed down into it: each hero's bedroll and pack, and the friends. Narration as usual. | As outdoors, but only your own kit and buddy can change. |
| **Chapter's end** (`chapter_complete`) | After the recap and XP, a short camp beat in the full camp: the chapter's Dash Cash counted in (§5.2), anything found this chapter shown beside the campfire (§12.5), and a purchase vote if the crew can afford something (§6.2). | The vote, and the Camp button. |
| **Adventure book** (`/journal`, spec §2.3) | n/a | A fifth tray object, **Camp**: the crew's camp to look at and tap, online or offline, from the last copy this phone read. |
| **In a scene, a check or a fight** | Never. The story owns the screen. | Never. |

**Nothing waits on the camp.** The lobby's Begin, the rest scene's Go on and the chapter end's
"back to the lobby" all work exactly as they do now. Begin closes any camp panel a phone has open.
Leaving the chapter's end cancels an unfinished vote without spending, and the balance waits for
a future chapter-end shop (§6.2). This keeps the session budget untouched: the camp only fills
time that already exists.

**Travel Mode** has no TV, so the camp view lives behind the same Camp button on each phone
during downtime, and in the World pane during the lobby. The button is in the You pane at a lobby
visit, a rest scene and the chapter's end (the Camp panel, with the still camp at the crew's stage
in the chapter's terrain), and nowhere else (`travel-layout.test.tsx`; #627).

### 3.1 Pitched in the right place

Each terrain family (`assets/manifest.json` → `biomeFamilies`, twelve of them) gets one camp
backdrop: a wide, calm campsite painting with a wide clearing for the camp, across about the
middle 80 percent of the width, and its hotspots (§4.2) on a fixed layout. The view picks the
backdrop from the chapter's biome, and in the lobby from the chapter the crew would pick up from. The lobby and the chapter's end always
show the full, outdoor camp. (As built, #625: the lobby pitches in the chapter the room last
played, which the run state still names after a chapter; a lobby before any chapter, or a screen
that has not loaded the chapter yet, pitches on the plains. The run state does not yet name the
next chapter's id, so "would pick up from" waits on that.)

One function decides it for every screen (`campFamilyFor` in
`packages/client/src/world/lobby-camp.ts`, through camp-backdrop.ts `campBackdropFamily`; #625, #627): the chapter's biome, through `biomeFamilies`, to
its family's backdrop where one is painted, else `open_plains`. In the lobby the biome is the
next chapter of the campaign the lobby would begin (`CampaignView.next.biome`, sent by the
server); at a rest scene and the chapter's end it is the chapter being played. Every frame stage
is laid over every backdrop (§8.3), and the first-wave backdrops share `open_plains`'s lanes, so
the camp stands the same on each and only the painting changes (`camp-boxes.test.ts` runs the
full matrix once per distinct set of lanes and holds every backdrop to it).

Painting all twelve is a lot of art, so they ship in order of how often a party rests outdoors
there. All rest scenes were counted from the repo on 2026-11-04; the outdoor ones were recounted
once every rest scene was tagged (§3.2, #625, 2026-11-05): 75 of the 112 are outdoors.

| Terrain family | Rest scenes | Outdoor rests | Ships |
| --- | --- | --- | --- |
| `red_sky_volcanic` | 31 | 21 | First wave (painted) |
| `frozen_north` | 26 | 13 | First wave (painted) |
| `open_plains` | 25 | 18 | First wave (painted), and the fallback for every family not painted yet |
| `enchanted_forest` | 7 | 6 | Second wave |
| `sky_islands` | 6 | 4 | Second wave |
| `whispering_marsh` | 5 | 4 | Second wave |
| `great_river` | 4 | 4 | Third wave |
| `cliffside_exchange` | 4 | 1 | Third wave |
| `bone_yard` | 1 | 1 | Third wave |
| `expanse`, `skullwater_caverns`, `mermaid_cove` | 0 | 0 | When a chapter rests there |

(`sallow_wastelands`, with 3 rest scenes, all outdoors, is in no family today; it falls back to
`open_plains` until it is given one.)

One function picks the backdrop for every camp that pitches outdoors, the lobby, an outdoor rest
and the chapter end's beat alike: `campBackdropFamily` in
`packages/client/src/world/camp-backdrop.ts`, from the chapter's biome through `biomeFamilies`,
to `open_plains` when the family has no backdrop in `camp.backdrops` yet. Painting a family is
adding its backdrop to the manifest; nothing else changes.

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
  (§4.5), and friends can still be tapped: a tapped friend says its words over its head where it
  sits, with a hop unless motion is reduced, and does not walk over (indoors nobody wanders). The
  phone says the friend says hi, not that it is coming.

The field is **required on every rest scene**, so `npm run content:validate` refuses a rest scene
without it and nothing has to guess. Tagging today's 112 rest scenes is a one-time pass: a keyword
scan already flags 31 of them as possibly indoor (rooms, bunks, cupboards, "inside"), but every
scene gets a human read, since "under the bridge" is outdoors and "a warm room" is not. Tagging
a Gemfall chapter re-takes its hashes (§10, "Gemfall is pinned").

*Done* (#625): every rest scene is tagged, 75 outdoor and 37 indoor. Besides rooms, huts, caves
and halls, these are indoor because no campsite fits: a raft, a river floe, a ferry deck, a
narrow ice-shelf ledge, a paved city quay, and the climbs up Mount Red Sky. A few outdoor rests
whose words put the party far outside the chapter's terrain (a glacier chapter ending on a
foothills bank or beside Ashspan Bridge, a harbor chapter's glimpse of snow through the rift) are
tagged indoor too, so the camp is never pitched in the wrong terrain (§12.6).

How it shows:

- **Outdoors.** As the rest scene opens, the full camp fades in over the scene's picture (about a
  second; at once under reduced motion), and the scene stops drawing once it is covered. The
  camp is framed above the narration plate, the way the story stage is, and below the goal card:
  nothing of it stands under the card. Where that window is too short even at the figures' 0.6
  floor (a 720p TV, a tall hero, a grown camp), the whole camp is drawn smaller instead of cut off,
  its painting mirrored out to the pane's sides (`campShrunkScale`, #625). The heroes rest at their
  bedrolls or tents; nobody lines up at the trailhead, since Ready is the lobby's. Go on fades it
  off with the next scene already drawn under it. Shared spots can change (`campMoment.outdoor`).
  The host's "Stop here for today?" offer, up for its fifteen seconds at every rest, stands off
  the camp too: beside the goal card where the TV is wide enough, else at the end of the choices'
  row on the plate (`ui/story-dock.ts`). It used to stand in the TV's right-hand column, over the
  camp's heroes, banner pole and crew name (e2e/layout-fit.spec.ts checks it at every TV size).
- **Indoors.** The scene's picture and lineup stay; each hero's bedroll and pack lie on the
  ground at her side, a step behind her feet, in her color (`packed-camp.ts`). Indoors nobody
  sleeps in it, so the bedroll is always rolled up beside the pack, whatever style the kid picked
  for the camp, and it is sized to her like the rest of her gear. The
  phone's Camp panel shows the same bedrolls in a row instead of the campsite picture, and only
  each kid's own kit can change.

Whether a rest is outdoors is the server's to say: it reads the scene's `setting` as the rest
opens and puts it on the moment (`campMoment.outdoor`). A rest it has not said so for is shown
indoors, so a slow or old server never puts a campsite behind a scene that contradicts it.

## 4. What is in it

*Decided:* everything in the camp belongs either to the **crew** or to **one hero**, and the two
never mix:

| | **The crew's camp** | **Each hero's kit** (§4.5) |
| --- | --- | --- |
| What | The frame, the shared hotspots (banner, cookfire, awning, lanterns, friends' corner), the friends, trophies, the crew's banner and name | The hero's tent, bedroll and pack, their personal decorations, and their souvenirs |
| Stored | On the crew's camp record (§9) | On the character (§9) |
| Goes where | Stays with the crew. A hero seated with another crew sees that crew's camp | Goes everywhere the hero goes: any crew, any table, a move to another home |
| Earned by | The crew: shared finds, Dash Cash purchases, finished campaigns, befriending | The hero: the free catalog, kit finds every hero gets a copy of, and the hero's own milestones (§5.4) |
| Changed | At the table, during downtime (§6) | At the table, and from the adventure book between games (§7) |

### 4.1 The frame: it grows with the crew

The camp's size is its **frame**, and the frame grows a stage each time the crew finishes a full
campaign. This cosmetic ladder is separate from character tiers, which are level-derived (spec
§8.1). Everything at every stage is something the heroes could carry:

| Stage | Frame | Reached |
| --- | --- | --- |
| 1 | Bedrolls around a small campfire, with lantern hooks, a friends' corner and a banner pole | The crew's first chapter |
| 2 | A tent for each hero and a cookfire | First full campaign finished |
| 3 | A bigger camp: an awning, lantern strings and a lookout post | Second full campaign finished |
| 4 | A grand camp: a big shared tent, banners and a lookout | Third full campaign finished |

The frame is **earned, never bought**, so a crew that spends nothing still watches its camp grow.
Each stage adds hotspots (§4.2), so a bigger camp also has more room. Stage 1 already has three
shared spots (*decided*, §11): lantern hooks, a friends' corner and a banner pole flying the crew's
banner, so a crew's first finds and its first purchases go up straight away (§5.3). A hotspot
keeps its id as the camp grows, so a piece put up at stage 1 stays up at stage 2, where the bigger
camp lays that spot out in its own place. Stage 1 has no awning: an awning waits for stage 2
(§8.3). When a stage arrives at the chapter's end it gets its own short moment: the heroes pitch the new camp. That's a small cousin
of the transformation cutscene, never longer than it.

**Only full campaigns count** (*decided*). The Practice Meadow (`first-steps`) is the tutorial and
never grows the frame. Today's full campaigns are Gemfall and Riftlight. The campaign file says
so (`"growsCamp": true`), so a new campaign is a deliberate choice rather than an accident.
The Hollow Crown (`the-hollow-crown`, the one-chapter reference campaign) does not grow the frame
either (*decided*). Both still pay Dash Cash and can hand over finds and friends.

Only a *finished* campaign moves the frame. Finished means it reached its end on any ending, a
setback ending included (*decided*, §11). A failed campaign keeps everything already in the camp
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
| **Kept** | Something the game already gives the crew that has nowhere to show | The crew's banner and name (`CrewIdentity`), trophies for each finished campaign |

These are the crew's pieces. A hero's souvenirs from a failed campaign belong to that hero (spec
§8.3 gives them to the character), so they are part of the hero's kit (§4.5), shown at their tent.

### 4.4 Friends

A **friend** is a creature the crew befriended in a chapter, who now travels with the camp.
Friends stand in the friends' corner and by the campfire, idle with the existing motion system
(`world/idle-motion.ts`), and react when a kid taps them, using the same reaction model as the
`play` story interaction (content/README.md, "Interactivity"). The reactions are words today; the
camp is a good reason to give them a little animation.

**A friend must belong to nobody in the story.** A creature that has an owner, a job or a later
scene of its own cannot also live at the camp. Pepper was the first idea and fails this test: she
is Nim's pony, Nim needs her to carry news north (Gemfall 5A), and she appears again in Gemfall
7H. A creature its keeper gives away freely counts as belonging to nobody (*decided*, §11): the
duckling Tilly hands over is the example. The candidates that pass:

| Friend | Met in | What befriending already is |
| --- | --- | --- |
| Bun | The Practice Meadow (`first-steps-01`) | "Offer Bun something nice" |
| The mosshorn | Gemfall 4B | Being gentle until it lowers its antlers |
| A duckling | Riftlight, Ashspan Bridge | Settling the ducklings |
| The spotted kid goat | Riftlight, Glacier of Origins | The yeti herder gives away the spotted kid that takes a shine to the party |

*Decided:* more friends will be new characters written for the purpose: a creature met in a
chapter, with a befriending moment, and no claim on it anywhere else in the story.

**At most four friends are out at once** (*decided*), and **each kid can pick a buddy**
(*decided*):

- **A buddy is one friend a hero picks** from the crew's friends. While that hero is seated, their
  buddy is always out. With up to four heroes and up to four friends out, every kid gets exactly
  one say, and nobody can bench another kid's choice.
- **Seats without a buddy rotate automatically**: each downtime moment (a lobby, a rest stop, a
  chapter's end) fills them with the friends who have been out least, and a friend just
  befriended is always out at its first chance (§12.5). A solo player with a buddy sees the buddy
  plus three rotating friends.
- **Two heroes can pick the same buddy.** The friend is shared, and the spare seat rotates.
- **A buddy is picked from the phone**, at the table or in the adventure book (§7), since it only
  decides that kid's own seat. Friends belong to the crew, so a hero's buddy applies in that
  crew's camp only (§12.1), and a hero who moves home (#251) leaves her buddies behind: they are
  removed from every camp of the old household (*decided*, §11).
- Until a hero picks one, they have no buddy and every seat rotates, exactly as before. Rotation
  stays the default; buddies are an option, never a chore.

Following the continuity rules, a friend joins because a **choice** says so ("Ask the spotted kid goat
to come along" beside "Say goodbye"), never because of a variant. Saying goodbye costs the story
nothing and is never sad: the friend waves off, and the chapter goes on.

*As built (#624):*

- **Befriending** is a `befriend` effect (`{ "type": "befriend", "friendId": "kid_goat",
  "rewardId": "riftlight-glacier-survival.kid_goat" }`) on the "Come along" choice. Like a find
  (§5.1) it names its friend's offer for that very chapter in `content/camp.json` → `friends`, so
  every way into the place shares one `rewardId` and it is given once; `npm run content:validate`
  fails a befriend that names no friend, another friend's offer or another chapter's. The engine
  records it on the run (`RunState.campFinds`, kind `friend`) and the server claims it right
  after the step commits (`handlers/camp-finds.ts`, `claimReward`): the friend and its receipt in
  one conditional write. A friend the crew already has from another offer pays 1 Dash Cash once,
  as a piece does (§12.2). "Say goodbye" records nothing, so nothing is written and the friend
  may be offered again on a later visit.
- **The catalog's friends** are the four above: Bun (`cast/bun`, cast in the Practice Meadow as
  the snowhorn goat she is drawn from, under her own name), the mosshorn (`entities/mosshorn`,
  `"size": "small"`, as Gemfall 4B casts it, so it stands 75 cm), a duckling and the spotted kid goat
  (`cast/snowhorn_kid`).
  Each has a few reactions, its words when tapped. Pepper is not one (above).
- **Where each is befriended (#626)**: a vote on the chapter's spine, "Come along" beside "Say
  goodbye", each on its own result scene (content/README.md, "Camp friends"). Bun at the Practice
  Meadow on the way to the back gate (`scene_bun_gate`), the strawberry mosshorn at 4B's gray
  edge (`scene_mosshorn_friend`), the duckling that picks the party at Ashspan Bridge
  (`duck_friend`). Two friends were written for the purpose: the **harbor gull**
  (`entities/quay_gull`), offered in Gemfall 1 at dawn after the Empty Chair (`scene_gull_dawn`)
  and by the frosty gull of Riftlight's Exchange Rift as the party walks on from the potato rest
  (`gull_friend`), one friend with two offers, since both are the Exchange's gull and two
  friends must never read as the same animal (*decided*, §11); and the **silver
  otter** (`entities/silver_otter`), met as the party leaves Gemfall 2's mimic ditch
  (`scene_ditch_otter`). So every crew that plays Gemfall is offered at least two friends, and
  4B's crews three. **The kid goat** is a different kid from the same herd
  (*decided*, §11): the goat kid of Exchange Rift is the yeti herder's, saving it is a goal step,
  it goes home to its herd in the glacier chapter, and the herder carries it in the Hidden
  Opening, the Stuttering Flats and the finale, so it fails "belongs to nobody" and is never
  offered. Instead, in Glacier of Origins (`riftlight-glacier-survival`), after the herder thanks
  the party for bringing her kid home (`ledge_done`), a younger kid, white with brown spots and
  extra wiggly, takes a shine to the party and the herder gives her gladly (`kid_friend`, its
  results `kid_along` and `kid_goodbye`, under `riftlight-glacier-survival.kid_goat`). The words
  always call her "the spotted kid goat", the ask says outright that she is not the little goat
  the party brought home (asleep in the herd), and the chapter's ending says "the little goat you
  brought home stays with its herd", so no later scene with the herder's goat kid can be read as
  her. She is drawn with the same figure, `cast/snowhorn_kid`.
- **A buddy is on the hero's kit** (`HeroKit.buddies`, kit v3), keyed by the camp it applies in
  (`campKey`: the household, and the crew when it is not the household's first), so it goes where
  she goes and is deleted with her, and applies in that crew's camp only. It is picked through
  `KIT_EDIT` (`buddy`, or null for none) on the phone's kit panel, written with the run's commit
  like every kit edit, and refused unless the friend is one of this crew's. A move home (#251)
  takes the old household's entries off her kit. This replaces the sketch's `CampRecord.buddies`
  (§9, §12.1), which never held anything.
- **Who is out** is the server's, on the downtime moment (`CampMoment.friends`): the rotation is
  chosen once as the moment begins (the friends out least first, by `CampFriend.outs`, then the
  newest, then by id), and who is out (`out`, at most four) is each seated hero's buddy, in seat
  order, then the rotation, worked out again on every step, so a buddy is out the moment her hero
  sits down. Each moment's friends out are counted into the crew's record after the step that
  began it commits, once per moment by its id (`CampRecord.outing`), so the rotation survives
  reconnects, new rooms and new evenings. More than four new friends queue by themselves: the
  ones not yet out have been out least. `cards` lists every friend, out or not; the phone lists
  them all ("Your crew's friends take turns at camp"), and nothing says one has left.
- **Where they stand**: each frame has four friend spots (`standPoints[].friend`, §8.3), and the
  tallest friend out takes spot 0, the roomy one; the rest keep their spots while they stay out.
  A friend wanders like a hero between its own spot and the free wander spots, never to a seat,
  another friend's spot or a piece's action spot.

### 4.5 Each hero's kit

*Decided:* the personal parts of the camp belong to the hero, not the crew, so a kid can look after
them even when nobody else is playing.

A hero's **kit** is their tent, their bedroll and pack, and two or three small slots for personal
decorations, all in their own color (the palette rule heroes already use). Outdoors the tent
stands in its spot in the camp; indoors (§3.2) the bedroll is rolled up beside the pack along the
front of the scene. At frame stage 1, before tents, it is the bedroll and pack everywhere. The hero's
souvenirs (spec §8.3) hang at their tent.

- **Only that hero's player changes it**, at the table during any downtime moment (no limit, §6.1)
  and from the adventure book between games (§7).
- **It goes everywhere the hero goes.** A hero seated with another crew brings their kit along,
  and a hero who moves home (#251) takes it with them, because it is stored on the character (§9).
- **It never borrows from the crew.** Nothing the crew owns can be put in a kit, and nothing in a
  kit can be put on a shared hotspot (§12.1).

Where kit pieces come from is in §5.4.

## 5. How the crew earns things

The crew earns its camp through finds and Dash Cash (§5.1, §5.2). Each hero earns their kit
separately (§5.4). All of it happens during normal play.

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
| Finishing a chapter, any ending | 2 (*decided*) |
| Each optional objective met (spec §8.2) | 1 each |
| A find the crew already owns (§5.1) | 1 |
| A lucky drop: a 1 in 8 chance after each won mini-game or fight (below) | 1 |

**Goal steps pay nothing** (*decided*). Every path to a success ending ticks every goal step by
design (content/README.md, "The chapter's goal"), so a party cannot miss one, and paying for them
would be free money. Optional objectives are different: a party can miss them, so they are the
part of the payout that rewards how the chapter was played.

So a chapter pays 2 to 5: 25 of today's 42 chapters have no optional objectives (2 Dash Cash), 5
have two and 12 have three. That is 4 to 10 after two chapters, plus any lucky drops (below). A
crew whose first chapters had objectives or a lucky drop can buy a 5-Dash-Cash starter piece the
moment the shop opens; one whose first two chapters had none arrives with 4 and makes its first
purchase a chapter later. Either way the money is earned, and a 10-to-15 piece follows every four
or five chapters. Every purchase goes through the same vote (§6.2); there is no separate flow for
cheaper pieces. The numbers are a starting point for playtest.

**Lucky drops** (*decided*): after each mini-game the party succeeds at and each fight it wins,
there is a 1 in 8 chance the crew finds 1 Dash Cash. It is a small surprise on top of the
chapter's pay, not something to grind for:

- **Shown at once, saved at once.** The TV shows a little "Dash Cash!" sparkle as the result
  lands, the phones echo it, and the server writes it to the crew's camp then, the way a find is
  saved when found (§12.2). It is counted again in the chapter's end tally so nobody misses it.
- **The server rolls.** The roll is part of the server's own resolution of the mini-game or fight,
  from the engine's per-action seeded `rng` (`engine/port.ts`), so replaying the event log rolls it
  the same way. A refresh, a reconnect or a retried message cannot roll it again.
- **No near misses.** A drop that doesn't happen shows nothing. There is no "so close!", no meter
  and no odds on screen.
- **Only games a party can fail count** (*decided*). `play` interactions (feeding, petting,
  celebrating, content/README.md) always succeed, so, by the same reasoning as goal steps, they
  never drop. Relaxed play still counts: it is easier, not automatic.
- **At most 2 lucky drops a chapter**, and **none in a chapter already paid for** (*decided*)
  (§12.2), so replaying a chapter is never a way to farm them. The 2 counts every attempt at the
  chapter, an abandoned one included (*decided*, §11).

Across today's 42 chapters there are 184 mini-games a party can fail and 61 fights, about 5 per
chapter in all; a single road through a chapter meets fewer. That makes a lucky drop worth roughly
half a Dash Cash per chapter on average: about one drop every two chapters, which is a treat
rather than a salary, and leaves the economy above unchanged in practice.

Rules, borrowed from what already works for XP:

- **Party-wide, never individual.** Like story XP and objective bonuses, Dash Cash goes to the
  crew, so no kid is behind on the camp.
- **Paid once per crew per chapter.** A chapter the crew has been paid for pays no Dash Cash again,
  the way a chapter pays each hero once (spec §8.2, #408). A crew replaying for the story can still
  find pieces it does not own.
- **A setback ending still pays for finishing.** Failure reroutes; it doesn't zero out.
- **Dash Cash is not coins.** The story's purse (`grantCoins` / `spendCoins`) stays separate, so
  "costs cost" in the story stays a real choice and nobody refuses to pay the ferryman to save up
  for an awning. The TV and phones never show the two side by side.
- **Kept on a failed campaign**, with the rest of the camp (§1).

### 5.3 The first reward comes in the first session

*Decided:* children see something that is theirs in their very first session, so the camp's
purpose is clear before anyone has to wait. Frame growth takes a whole campaign, and the shop
opens only after two chapters, so neither can be the first reward.

- **A personal choice at the first downtime moment.** The first time a hero is seated with a crew
  that has a camp, their kid picks their kit's style and color (§4.5) from the free catalog
  (§5.4). It takes one tap, can be skipped, and is the first thing the camp asks of anyone. Each
  style is shown as the camp will draw it, in the color picked: its tent once the camp has tents
  (stage 2 and up, outdoors), its bedroll and pack before that.
- **A recognizable find in the first chapter.** The Practice Meadow and the first chapter of every
  `growsCamp` campaign each hand over one find on their spine, so every path to every ending gets
  it. It is something the kids will remember from that chapter (a pinecone wreath from the meadow,
  say), and the chapter's end shows it beside the campfire and highlights where it can go. Stage 1
  has a spot for the picnic blanket and the wagon lantern, and for every starter shop piece but the
  striped awning, so they go up the same evening (§4.1); an awning (Riftlight's noodle awning, the
  striped awning) waits for stage 2 with its note (§12.5).
- **The shop opens after two chapters** (*decided*). A crew needs a little skin in the game before
  it can buy anything: the chapter-end shop appears only once the crew has been paid for at least
  two chapters, in any campaign but the tutorial. **The Practice Meadow doesn't count toward the
  two** (*decided*): its chapter still pays Dash Cash like any other, but the shop is earned in
  real adventures. The tutorial says so in data, `"tutorial": true` on its campaign file, so no
  id is written into the rule; The Hollow Crown is not marked and counts. Before the shop opens,
  the chapter's end shows the balance and how far the shop is: "the camp shop opens after the next
  chapter", or after two adventure chapters, and at the meadow's own end that practice doesn't
  count. The first pieces in each shop cost **5 Dash Cash** (*decided*). Most crews can afford
  one when the shop opens; a crew that earned only the 4 for finishing two chapters buys a chapter
  later (§5.2), and one that started in the meadow arrives with its 2 as well.

### 5.4 Each hero's kit pieces

A hero's kit (§4.5) fills from three places, none of them Dash Cash, which stays the crew's:

- **The free catalog** (*decided*, §12.1): a starting set of tent styles, colors and simple
  decorations every hero has from the start, so there is always something to choose.
- **Kit finds** (*decided*): a chapter effect, `findForKit: { pieceId }`, that gives **every
  seated hero their own copy** of a personal piece ("everybody gets a feather for their tent").
  Like every reward, it is party-wide, so no kid misses out. A hero who already has it gets
  nothing more; Dash Cash is the crew's and is never paid for a kit duplicate. The same authoring
  rules as crew finds apply (§5.1): a bonus, never a gate, and the narration names the thing, not
  the kit.
- **The hero's own milestones** (*decided*). Reaching a new appearance tier unlocks a tent style in
  that tier's look, and earning a class distinction unlocks a small decoration in that class's
  colors. These are the hero's own deeds, so they belong in the hero's kit, recorded in
  `HeroKit.unlocked` with `from: "milestone"`. Like souvenirs, they are cosmetic and kept even if a
  failed campaign later puts the tier or distinction back (spec §8.3): the hero earned them once.
  The unlock lands when the tier or distinction does, and the phone says so after the
  transformation, never during it. A tier whose art isn't painted yet (spec §8.1 draws Ascendant
  and above as Mythic until it is) unlocks its tent style when that art ships.

## 6. Who changes what

*Decided:* anyone in the crew can update the camp; each hero has their own kit; purchases go to a
vote.

### 6.1 Free changes: any time it is on screen

Tap a hotspot, pick from what the crew owns. These are free, immediate and reversible by picking
another owned piece (subject to the shared-change limit below):

- **Shared hotspots** (banner, awning, lanterns, cookfire, friends' corner): any seated player, in
  the full camp only. An indoor rest has none (§3.2).
- **A hero's kit:** only that hero's player, indoors or out, and from the adventure book (§7).

On a phone the Camp panel shows the whole camp across, and under it a chip for each shared spot,
each joined to its spot by a thin line straight up (`camp-chips.ts`): in as few rows as keep every
chip apart, every line inside its own chip and never through another chip or along another line,
a two-word name on two lines rather than a row of its own. A phone takes two rows at most (the
awning stands behind the cookfire, so their chips take a row each). The kit's tent choices are the
tents themselves, in her color.

If two phones pick for one hotspot at once, the later pick wins and the TV shows it; there is
nothing to lose, because the crew still owns both pieces. A kid's own kit is unlimited.

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

1. At the **chapter's end**, once the shop is open (two chapters played, the Practice Meadow
   not counted, §5.3), the phones and the TV show up to three of the shop's pieces, plus "Save our
   Dash Cash." **Pieces the crew can't afford yet are shown too** (*decided*), with their price and
   how much more they need ("Needs 3 more"), so there is something to save toward. They are never
   votable: disabled on the phones, and a vote for one is refused. When more than three are
   eligible, the affordable ones come first and the cheapest of the rest fill the list, so it is
   never all out of reach while something is affordable (§12.4). If nothing is affordable, the
   pieces still show, with a kind "you can't buy any of these yet, keep saving", and no vote
   starts.
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

**The crew's camp is look-only in the book; each kid's own things are not** (*decided*). A phone
between games belongs to one kid, not a crew, so the book lets that kid do what is theirs alone:

- **Change their hero's kit** (§4.5): tent style, colors and decorations. Kids want to play even
  when they're by themselves, and this is something they can do on their own that still shows up
  at the next game.
- **Pick their hero's buddy** (§4.4) for each crew the hero plays with.
- **Tap the friends**, as before.

Everything shared stays at the table: shared hotspots, purchases and votes. The book's old promise
narrows rather than breaks: nothing in it can change anything **anybody else** owns, so nothing a
kid does there can upset another kid's game.

**They work offline too** (*decided*). With a signal, an edit goes straight to the server through a
small write path authorized by the phone's device binding, like the book's read (§12.6). Without
one, the book makes the change on screen at once, keeps it in a queue on the phone, says "Saved
on this phone, will share when you're back online", and sends it when the signal returns:

- **What can queue:** only the kid's own kit and buddy changes. Nothing shared is editable in the
  book, so nothing shared can queue.
- **Each change says what it replaced.** A queued edit records, field by field (style, color, each
  slot, the buddy for each crew), the value it was made over.
- **The device wins** (*decided*, #629, replacing the earlier field-by-field merge). A kid's own
  kit is only ever edited on her one phone, so, as most offline-first apps do, every field a book
  edit changed applies over whatever the server has by then, a table's pick of the same field
  included, whether it is sent at once or long after from the queue. Nothing is said about it: what
  she picked is what she has. The write itself is still conditional on her row as read and retried
  on a lost race, so nothing written in between (a table's other fields, a milestone) is lost.
- **Only real pieces.** The server rechecks every queued change: a piece the hero doesn't have, or
  a buddy the crew doesn't have, is skipped, as it would be online.
- **The queue is the phone's.** It lives in the phone's own storage and is sent with the phone's
  binding. If the binding is revoked or the kid is moved off the phone, the queue is dropped
  unsent.

*As built (#629):*

- **The tray.** "Camp" is the book's fifth tray object (the campfire), between Guide and Play
  (`screens/CampPane.tsx`, its own lazy chunk, so nothing of it is in the journal chunk or the first
  paint). It draws the phone Camp panel's still camp (`StillCamp`, `fit="width"`) from a run state
  made of the book: her open hero seated alone at her tent, her kit, the crew's camp, and its
  friends out as a table would choose them (her buddy first, then `friendRotation`), pitched in the
  terrain of the household's last adventure (`whereabouts.biome` through `campBackdropFamily`).
  Under it: the friends, the kit editor and buddy picker (the Camp panel's own `KitEditor`), and
  "In your crew's camp", every piece with where it came from. On a phone-width strip the picture
  shows no name labels or words bubbles (they would cover the figures or be cut short); every name
  and word is in full in the controls under it.
- **Where things came from** is the server's, in the journal (`JournalCrewCamp.sources`,
  `JournalFriend.source`): a find "Found at the Ashspan Bridge" (a graph campaign's place, its map
  label) or "Found in “Green Roads North”" (a chapter of a campaign told in order), "Bought with
  Dash Cash", "Your crew's very own" (the banner), "Came with your camp" (a frame's own piece),
  "For finishing Gemfall" (a trophy), and a friend "Met at …" the same way. An offer the content
  no longer has reads "on an adventure".
- **A friend tap** has no TV: it shows one of the friend's reactions (`CatalogFriend.reactions`,
  carried in the journal so it works offline), round and round, in the words line under the friend
  buttons and, on a wide screen, over its head in the picture. Nothing is sent or relayed.
- **The crews** (*decided*, §11) are every crew any of the kid's heroes is part of at her
  household (`heroCrews`). Each hero's kit records them (`HeroKit.crews`, by `campKey`, kit v4):
  every run commit that writes her row while she is seated at a table (her seat, her creation, a
  chapter's start or end, a kit edit) adds that table's crew (action.ts, camp-book.ts
  `recordCrews`), with no write of its own, and it is never pruned, so a crew from long ago stays.
  Her claim and her buddies count too. A hero from before kit v4 has no record yet, and only for
  her the household's last 40 runs are read as a backfill, until her row is next written at a
  table. That first write seeds her record with the same backfill (the runs she sat in, her claim
  and her buddies) before it adds the table's crew, so no crew the book listed is lost (#656); if
  those runs cannot be read then, the write leaves her unrecorded and a later one tries again. A
  hero made at a table has no past, and her record starts with that table's crew. The first crew
  comes first, then the others oldest first; a hero who has sat with nobody
  yet gets the first crew. With more
  than one, a picker names them, and the heading names the one open ("The Otter Crew's camp"). A
  buddy picked there is kept under that crew's `campKey`.
- **The read** rides `GET /api/journal` as `JournalResponse.camp` (`handlers/camp-book.ts`
  `journalCamp`): each crew's `CampView`, friends and sources, and each of her heroes' kits with a
  buddy per crew (`JournalKit.buddies`, by crew id, "" for the first). A failed camp read leaves the
  rest of the book whole and says so (`JournalResponse.campError`, with no `camp`), so the phone
  keeps the camp its saved book has, saves it with the fresh rest, and the tray says when that camp
  was read (`SavedJournal.campSavedAt`, "Last synced yesterday"); a book with no camp and no marker
  (content with no camp) clears it (#656). Saved with the book in IndexedDB, and on a read with a signal the tray
  has the service worker keep every picture it draws (`sw/warm.ts`: the backdrop, her tent and
  gear, the pieces, the friends and the kit's choices), so it opens offline; it says when
  it last synced ("Synced at 4:05 PM", or "Last synced yesterday" from the saved copy).
- **The write** is `POST /api/journal/kit` (`editKitFromBook`), resolved like the journal read
  (her device token, or a family tablet's picked kid's room session), refused unless the hero's
  `ownerPlayerId` is the bound kid, by the table's own rule (`kitEditProblem`) and with a buddy
  only from that crew's friends. It carries field changes (`BookKitChange`: `style`, `tent`,
  `color`, `slot0`–`slot2`, `buddy`, each with `before` and `after`), and every one applies over
  the kit as it is now (shared `mergeBookKit`; the device wins). Sent straight away, one pick that
  is not hers refuses the whole change, as `KIT_EDIT` does; from the queue (`merge`) that pick is
  skipped (`refused`) and the rest apply. The decoration slots are checked as one arrangement, as
  `KIT_EDIT` checks them: every queued slot laid over the stored ones, so a swap or rotation of
  pieces already hung lands from the queue just as it does straight away (#656). Where that
  arrangement is not hers to have, only the queued slots causing it keep their stored value: a
  piece she has not unlocked, then a piece a queued slot would hang twice. Written with `mutateKit`, conditional on the hero's row
  as read and retried on a lost race, so a book edit and a table edit never lose a write.
- **A table behind the book.** A table that read her kit as its moment began, before a book edit,
  shows an older revision. Her phone's `KIT_EDIT` made over what the table showed is applied over
  her kit as it is now (camp-edit.ts `behindEdit`): every field it changed takes the table's pick,
  the latest edit winning, and every field it did not change keeps what is stored, the book's
  changes included, so nothing is lost. The table's view is refreshed in the same run commit. A
  revision the table itself has left is refused as stale, as before.
- **The queue** (`store/kit-queue.ts`) is in localStorage (`kad.kitQueue`), tied to the device
  token, one entry per hero (and one per crew for a buddy). Every book edit is queued first, so it
  shows at once and survives the book closing mid-send; `store/book-kit-sync.ts` then sends it. An
  entry made with a signal and alone for her is sent straight away; once a send of it finds no
  signal, or it is changed again while queued, it is sent `merge`. A field queued twice keeps the
  value it was first made over. It is sent as the book opens and on the browser's `online`; a 401
  drops the whole queue, and so does a journal read the server refuses or a phone with no binding.
  A change that can never land (a hero gone) is let go with "One of your changes could not be
  saved.", and a pick the server skips "Your buddy pick could not be saved." If the phone's storage
  will not take the queue (out of quota, a private window), it is kept in the page's memory
  instead (`kitQueueUnsaved`), so the change still shows and is sent while the page is open; with
  no signal to send it, the book says "This phone couldn't save that. Try again when you're back
  online." in place of "Saved on this phone", and the note goes once it is sent (#656). A family
  tablet keeps no queue: its change is sent at once or not at all.
- **A live room** reads her kit afresh as its next downtime moment begins (`syncCampDowntime`).
- **First visit.** With no camp in the saved book (a copy from before the camp, or a first read
  that failed), the tray says to open the book once with a signal; with no hero, to make one in the
  next game; a camp with nothing in it yet says finds and friends show up there.

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

- **Ground lanes.** The walkable floor has horizontal lanes at fixed depths. The larger frames add a far lane behind the near, middle and back lanes. Lanes make depth order trivial (a nearer lane always draws
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
  narration plate covers, so the story stage stands figures above it; the lobby reports its
  header and panels the same way. The camp is one painting, edge to edge: it is scaled to cover
  the pane's width (or the window's height, if that needs more) and slid up or down so its focus
  band, from a standing hero's head on the back lane to just below the near lane, sits centered
  in the open window between the header and the panels. Its plain sky is trimmed off the top and
  its plain grass runs on under the panels (`camp-framing.ts`); the backdrop is painted for that
  (docs/briefs/camp.md). **Every hero is seen whole.** When the band is taller than the window
  at that scale (a tall hero seated, a short window on a 16:9 TV), the figures and pieces are
  drawn smaller, never the painting: the camp draws them at the largest factor up to 1 that fits
  the band in the window (`campFigureScale`), and their steps shrink with them. It never goes
  below 0.6; past that the near lane's feet stay in the window and only the tallest heads may
  reach under the header. The factor eases with the framing as heroes sit down and panels change
  height, and the moving camp, the still one and Travel Mode's phone pane all take it from the
  same `campFit`. **Every hero is seen whole across, too.** Near the screen's edge, and where the
  pane crops the painting's sides (a TV narrower than 16:9, a phone's World pane), every stand
  point, crossing and place in the trailhead's line is moved in from the edge by the figure's
  width (`campVisibleSpan`); a line too long for what is left runs on behind the trailhead, and
  one wider than the whole span takes a second row on the next lane back.
- **A hero's own gear fits her** (*decided*, #620). Her bedroll is drawn about 1.2 times her drawn
  body length (the longer of her drawn height and width), so she could lie in it, its pack in
  proportion on the same painting; her tent about 1.1 times her drawn height and at least 1.3
  times her drawn width, so she could fit inside. **A small hero's tent is roomier**
  (*decided*, #620): 1.2 times her height, so a kitsune's ears sit clearly under its top even as
  she stands in front of it at her door. Small and big go by her painted height (`HERO_PAINT`):
  up to 110 cm (kitsune 88, dragonlings 105) is small, from 150 cm (manticores 153, griffins 168,
  unicorns 178, bigfoots 224) big, and a hero between would ramp smoothly from 1.2 to 1.1
  (`tentHeightFit`). A hero at her door stands on her tent's own lane, her feet on its ground, so
  no perspective lifts her head past its top. **A tent is always bigger than its hero, and a
  bedroll longer** (*decided*, #620): every tent, the patched lean-to and the milestone tents
  included, stands taller than she does, its painted height (cloth and poles, `camp-paint.json`)
  over hers, in every species and both renderers; a lean-to may still be much wider than it is
  tall. A tent's shape is its painting's, guy ropes and stakes included. Her drawn box is her species' painted box
  (`HERO_PAINT`, the largest any of her paintings covers), so a bigfoot's gear is about 215/85 of a
  kitsune's and nothing is floored. It is a minimum: gear already bigger keeps its own size. The
  constants live in one place (`camp-ownership.ts`); the moving camp, the still camp and a phone's
  Camp panel all size from it.
- **Every piece is its painting** (#623). A piece is drawn so its painted height is its
  `heightCm`; how wide it then is, and how far its paint sits off its ground contact (a banner's
  flag flies off to one side of its pole), is the painting's. `npm run art:camp-paint`
  (`tools/art/camp-paint.py`) measures every grounded camp painting's opaque bounds on its 1024
  canvas, and the same bounds in six slices of its height, into `camp-paint.json`; the layout's
  boxes, the moving camp and the still camp all read that table (`camp-paint.ts`), and
  `art:verify` and `camp-art.test.ts` fail when it no longer matches the paintings. A shared
  piece's `widthCm` is its painted width at its `heightCm` (tested), so the manifest says what
  is drawn.
- **Nothing overlaps.** Every piece is its painting's footprint, slice by slice (so a short piece
  may stand under a banner's flag but never in it; a hero's gear fitted to her), and at stage 1
  and stage 2 no piece overlaps a hero's bedroll or tent, the campfire, the trailhead post or
  another piece, tall pieces (the banner pole, the lanterns, the awning) stand at the sides or
  behind and never in front of a hero's gear, and no label collides with another or lands on
  somebody else's piece (`camp-boxes.ts`, tested on the real manifest for four bigfoots, four
  kitsune, a mix each way round and four of every species, in every tent or bedroll style a kid
  can pick, at 1280 x 720 and 1920 x 1080, under the lobby's panels with and without the campaign
  picker). The crew's name stands under its banner pole's foot, on one line or two, or failing
  that on the grass beside the pole under the flag, never on the flag. A shared piece's name takes
  two lines where one has no room (two trophies side by side). Four overlaps are allowed, all
  at stage 2 and all decided by the owner (#620), the nearer always drawn in front:
  - **A nearer tent may partly cover a tent further back, never its door or its souvenir line.**
    The door is where its hero rests, and her souvenirs hang beside it.
  - **A tall shared piece may stand partly behind a nearer tent.** The awning, the lanterns and the
    banner pole, and the shop pieces on those spots, still read as themselves: the nearer tents
    (and the souvenir lines on them) together cover less than half of the piece's painted area
    and none of the top half of its painted height, where the crew's flag, the weathervane and
    pinwheel, the lamps and the awning's canopy are painted (`campCoverClashes`, judged slice by
    slice). A banner pole's pennant is kept whole however far down it hangs: the weathervane's
    streamers reach about two thirds of the way down its pole, below that half, so the layout keeps
    clear everything down to the foot of the pennant layer's own painted bounds (`pieceKeepTop`,
    from `camp-paint.json`, which measures each pennant too; a pennant not measured keeps the top
    three quarters). It never stands behind, or in front of, a hero at her door. The hero who goes to look
    at it stands at its stand point, which no nearer tent covers (`campStandBoxes`), and its name
    is set clean like every other.
  - **A short near-lane piece may stand in front of the lower half of a tent further back**, never
    its door: the friends' corner, the trophies and the cookfire.
  - **The lanterns and the banner pole may stand in front of the outer edge of a tent further
    back, never its door.** Only its outer side (away from the middle of the camp), and the tent
    still reads as itself: all they cover of it lies in the outer quarter of its painted width,
    where its guy ropes and stakes are, and below the top half of its painted height, its ridge
    and roof (`campEdgeClashes`, slice by slice). Never over the hero resting at its door, its
    souvenir line or any hero's door box, and the pieces stay readable: nothing stands in front
    of them, so their lamps, flag and pennant are never covered.

  A hero resting at her tent's door is seen whole: nothing on her lane or a nearer one covers her
  (`campDoorBoxes`). The focus band holds the tents, the names over them and the crew's name under
  its pole, not only the heads.
- **Stage 2 is two lanes of tents** (*decided*, #620). The four tents are staggered like stage 1's
  ring of bedrolls: the outer two on the back lane (x 0.195 and 0.787), the inner two on the
  middle lane in front of them (0.365 and 0.644), so each inner tent's side stands in front of
  its neighbour's, up to that neighbour's door. Between the inner two, the awning stands on the
  back lane (0.521), where the inner tents' sides may stand in front of its feet, and the
  cookfire in front of it on the near lane (0.502). The lanterns (0.08) and the banner pole
  (0.905, by the trail) stand at the ends on the near lane, past the outer tents, each free to
  stand in front of the outer edge of the outer tent behind it; the near lane stands them lower
  than the middle lane would, so less of them reaches up beside a back tent's door. The friends'
  corner lies on the near lane in front of the first tents (0.243) and the two trophies on the
  near lane in front of the last (0.735 and 0.804), each free to stand in front of a tent's lower
  half. Each hero rests at her own tent's door, on its lane; her souvenir line hangs on her tent
  beside its door (0.179, 0.39, 0.62, 0.806), where no nearer tent covers it. A hero looks up at
  the lanterns from the middle lane at 0.14 and at the banner from 0.845, pets the friends from
  the near lane at 0.168, and stands under the awning from the middle lane at 0.521, between the
  inner tents, where no tent hides her. The heroes wander on the near lane at 0.08, 0.31, 0.69
  and 0.92 and on the middle lane at 0.5. Tents are wide (a bigfoot's lean-to is twice as wide as
  she is tall), so a party whose tents and the crew's widest pieces cannot all stand at full size
  is drawn smaller (`campRowScale`), never piled up and never under 0.6. With every spot holding
  its widest or tallest piece, in the tent styles their seats pick and in every tent style: four
  kitsune 0.96 and four dragonlings 0.95 to 0.96 (the two trophies side by side on the near lane
  hold every party under 0.96); four manticores 0.81 to 0.82, four griffins 0.77 to 0.84, four
  unicorns 0.75 to 0.86; a mix (bigfoot, kitsune, unicorn, griffin) 0.75 to 0.86, about 0.82 in
  the styles their seats pick, and the other way round 0.82 to 0.87; four bigfoots 0.64 to 0.89,
  about 0.69 in the styles their seats pick. The low end of every big party is the patched
  lean-to in an inner seat beside the crew's widest awning: its door must stay clear of the outer
  tent behind it, and the outer tents can move out only until the lanterns and the banner pole
  would reach a small hero's door. The crew's default camp (the cookfire, its banner and
  trophies only) draws the mix at about 0.82, four unicorns at 0.82, four griffins at 0.87, four
  manticores at 0.92 and four bigfoots at about 0.72. On a 1280 x 720 TV with the campaign picker
  open the window, not the row, holds a party with a bigfoot on the back lane to about 0.72.
- **Stages 3 and 4 stand their own big pieces on the far lane** (#627). Each bigger frame brings
  three pieces of its own (stage 3: an awning, a lantern string and a lookout post; stage 4: a big
  shared tent, banners and a lookout, every one an id ending `_frame`), drawn at their real sizes:
  the lookout post 270 cm and the stage-4 lookout 300 cm, both taller than a bigfoot (215); the
  lantern string 200 cm, its rope at about 165 cm with its lanterns hanging below it; the banners'
  posts 230 cm; the awning 220 cm, tall enough for a bigfoot to stand under; and the shared tent
  280 cm, taller than any hero's own tent. Pieces that big only fit across the clearing behind the
  tents, so they stand on the far lane: the lookout at the far left beside the first tent, the
  awning or the shared tent in the middle between the inner tents' peaks, the lantern string or
  the banners past the last tent, and the crew's own awning spot at the far right. They are
  treated as the tall shared pieces are (*decided*, #627; §11): each may
  stand partly behind a nearer tent, under the same rule (less than half of it covered and none
  of its top half), never behind or in front of a hero at her door, and whoever goes to look at
  one stands where no nearer tent hides her (`isTallFramePiece`, `campCoverClashes`,
  `campStandBoxes`). The far lane draws them at 0.6 of the near lane's scale, so the lookout
  reads as a tall tower behind the camp rather than a prop beside the fire. With the big pieces
  in, the shared spots move to stage 2's places on the near lane (the lanterns at the far left,
  the friends' corner in front of the first tents, the trophies and the banner pole at the
  right), and the crew's awning spot (an awning, a map table, a woodpile, a supply chest or a
  trophy rack) to the far lane's right end. Everything is drawn smaller than at stage 2: with
  every spot holding its widest or tallest piece, in every tent style, four bigfoots at about
  0.61, the mix (bigfoot, kitsune, unicorn, griffin) 0.61 to 0.63 either way round, four
  unicorns, griffins or manticores about 0.66, and four kitsune or dragonlings about 0.67, at
  both stages. What holds the small parties is not their
  tents but the far lane's own pieces side by side (the lantern string or the banners beside the
  crew's awning spot); what holds the big ones is the middle piece between the inner tents.
  The later backdrops (#649: the enchanted forest, sky islands, whispering marsh, cliffside
  exchange, great river and bone yard) draw the far lane a little nearer, at 0.48 where the first
  wave's is at 0.45, so the far lane's pieces sit lower behind the tents. To keep the same rule on
  both grounds, the first tent stands at 0.172 (from 0.166) at stages 3 and 4, the lantern string
  and the banners at 0.836 and 0.841 (from 0.83 and 0.835), and at stage 4 the second tent at
  0.335 (from 0.345), clear of the shared tent's top half (`camp-boxes.test.ts` runs every stage on
  both grounds).
- **Stage 1 is a ring of bedrolls.** A bedroll is longer than its hero lying down, much wider than
  her tent, and too tall to stand in front of another lane's, so at stage 1 everything that
  reaches the back lane stands side by side across the clearing: the lantern hooks at the far
  left on the near lane, two bedrolls (the outer one on the middle lane, the inner on the back
  lane), the campfire on the backdrop's worn patch, two more bedrolls, then the banner pole and the
  trailhead post at the trail. The friends' corner lies on the near lane between the first
  bedroll and the campfire, and what the chapter hands over waits on the near lane by the fire
  (a little smaller where the lane has no room for it at full size). The small parties are drawn
  nearly full size (about 0.93), a mix about 0.83, four bigfoots about 0.76 (`campRowScale`,
  never under 0.75 at stage 1). An awning, the widest tall piece, would shrink every party further,
  so it waits for stage 2's bigger camp (§11).
- **Friend spots** (#624). Each frame stage has four friend spots on the near lane, by the
  friends' corner and the campfire: stage 1 at x 0.6 (spot 0), 0.27, 0.475 and 0.665; stage 2 at
  0.672, 0.35, 0.4 and 0.6; stage 3 at 0.6, 0.395, 0.71 and 0.9; stage 4 at 0.59, 0.42, 0.37 and
  0.9. Spot 0 holds the tallest friend out (the 75 cm mosshorn), the others any friend a kid
  goat's size. A friend at its spot is seen whole: nothing nearer and nothing on its own lane
  covers it, it stands in front of only the lower half of anything further back (a tent, a piece,
  a hero at her door or at a tall piece, never a tall piece's kept top), covers no label that
  shows, and never another friend (`campFriendClashes`), at every frame stage, for every party
  and placement the overlap test tries, inside the window between the lobby's header and panels.
  What waits beside the fire at a chapter's end keeps clear of them too.
- **Indoors, one lane.** A packed-down camp (§3.2) uses a single generic layout laid over the
  scene's own picture: one near lane along the bottom, a bedroll stand point for each hero and a
  spot for each friend. No per-scene authoring. *Built* (#625, `packed-camp.ts`
  `packedCampSpots`): the lane is the story lineup's own ground line, so the heroes stand where
  every scene stands them; each hero's bedroll lies at her right, its middle 0.36 of her lineup
  slot from hers and a step behind her feet (so she and her name are never covered), no wider than
  0.85 of her slot or 0.7 of her drawn height (a rolled-up bedroll, shorter than she is). The friends out (§4.4) sit at the two ends of the row,
  alternating, left first, each further out than the last on its side and turned to face the row,
  at its true height on the lineup's scale, and kept inside the shown stage and clear of any
  guest's share of it (`packedFriends`; drawn on the moving and the still stage since the #624
  and #627 merge). The phone's packed row keeps to the kits: its friends are in the Friends section.

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
  picks another nearby free one it hasn't just stood at and walks there, so over a few minutes
  the crew ranges across the whole clearing rather than pacing by its bedrolls. **At most two
  figures are walking at once**, so
  the eye always has something to follow and never everything. Indoors nobody wanders: the heroes
  rest on their bedrolls, and a friend moves only when it's tapped.
- **Moments the game already has** take priority over wandering, and each is a little scene:

| Moment | What happens |
| --- | --- |
| A kid sits down in the lobby | Their hero crawls out of their tent (or sits up on their bedroll, at stage 1), looks around and waves (a hop and a turn toward the screen) |
| A kid taps Ready | Their hero shoulders their pack and walks to the trailhead at the edge of camp, joining the line there in tap order |
| A kid takes Ready back | Their hero steps out of the line within a beat or two and goes back to wandering: walking off when no lane-mate is in the way, otherwise fading out of the line and back in at home |
| A player steps away (#258) | Their hero walks back to their own tent and fades the way the lineup already fades a stepped-away hero |
| Begin | Everyone sets off together down the trail as the chapter's first scene fades in, at the start of every chapter (*decided*) |
| An outdoor rest scene opens (§3.2) | The heroes walk in from the edge, and each settles at a spot |
| An indoor rest scene opens (§3.2) | Bedrolls and packs fade in along the front of the scene, with each hero on their own |
| A find or a purchase is shown (§5.1, §6.2) | It appears beside the campfire, the crew gathers round, and its hotspot is highlighted for placing (§12.5) |
| A kid taps a friend on their phone | The friend reacts on the TV, then walks over to that kid's hero |

- **Taps on a phone show on the TV.** A tap is a short-lived message, never saved, sent to the
  room's screens the way room cheers already are (#388, `RoomCheers`). It's rate-limited per
  phone, and the TV queues and drops extra taps, so a kid hammering the button gets a happy friend
  rather than a jittering one. *As built (#624):* `POST /api/friend-tap` (handlers/friend-tap.ts)
  takes a friend who is out from a kid with a hero seated, two a phone every 8 seconds
  (`FRIEND_TAP_LIMIT`), picks one of the friend's reactions and relays it as a `friendTap` channel
  message (the friend, the kid's hero, the words). The phone's "Call Bun over" button rests 4
  seconds after each tap. On the TV each friend acts out one tap at a time and holds one more
  (camp-taps.ts): its words go up over its head for 4 seconds, it hops and turns where it stands,
  and after a beat walks to the tapping kid's hero, on her lane at her side, while she waits for
  it; a way still blocked after about four seconds (a lane-mate in it is nudged on) is a
  fade, out where it stands and back in beside her (§8.6, rule 3). In reduced motion the words show and nobody walks.
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
fields that serve §12's requirements (`revision`, `grownBy`, `rewardId`, receipts). Phase 1 writes
none of it (§10).

| Record | PK | SK | What it holds |
| --- | --- | --- | --- |
| Camp, first crew | `HH#<hhId>` | `CAMP` | The first crew's camp (the first crew has no `CREW#` row or id, architecture §4.5). |
| Camp, other crews | `HH#<hhId>` | `CAMP#<crewId>` | The same shape, one per `CREW#<crewId>`. |

```ts
// packages/shared/src/types/camp.ts (intended shape)
interface CampRecord {
  version: number;
  revision: number;                              // conditional writes (§12.4)
  frameStage: 1 | 2 | 3 | 4;
  grownBy: string[];                             // full campaigns that grew it, once each (§12.3)
  dashCash: number;
  owned: Record<PieceId, { from: "found" | "bought" | "kept"; rewardId?: string; at: string }>;
  placed: Record<HotspotId, PieceId>;            // shared hotspots only
  friends: Record<FriendId, { rewardId: string; at: string; outs?: number }>; // outs: moments out (#624)
  outing?: string;                               // the last moment counted into outs (#624)
  paidChapterCount: number;                      // the shop opens at 2, tutorial chapters not counted (§5.3)
  // Receipts (§12.2): paid chapters and claimed reward ids. Storage shape to be chosen
  // after checking transaction and record-size limits.
}

// on Character (domain.ts, stored at CHAR#<charId>), because the kit follows the hero (§4.5)
interface HeroKit {
  version: number;
  revision: number;                              // book and table edits (§7, §12.4)
  style: KitStyleId;                             // tent, bedroll and pack together
  color: KitColorId;
  slots: (KitPieceId | null)[];                  // two or three
  unlocked: Record<KitPieceId, { from: "catalog" | "found" | "milestone"; rewardId?: string; at: string }>;
  buddies: Record<CampKey, FriendId>;            // her buddy in each crew's camp (#624, §4.4)
}
```

*As built (#617):* the shapes are in `packages/shared/src/types/camp.ts` and the server's API in
`packages/server/src/handlers/camp.ts`. Against the sketch: the shape version is `v` (as on
`FieldGuideRecord`), since `version` on a character is its write counter; a kit's `style` and
`color` are `null` until the kid picks (§5.3), and a backfilled milestone has no `at`; the
receipts are a `receipts` map on the camp row (`rewards`, `chapters`, and lucky `drops` keyed by
run and scene), so a claim and its reward are one conditional put, with a paid chapter's drop
receipts pruned to keep the row small. The frame is read as the crew's finished `growsCamp`
campaigns counted once, stored or not, which is also the migration for existing crews.

*As built (#618):* a kit's tent is its own field, `HeroKit.tent`, beside `style` (the bedroll and
pack), since a milestone tent has no bedroll of its own; kit v2 adds it and renames #617's
never-shipped placeholder milestone ids. A hero with no stored `style` is drawn with the style her
id hashes to, as before, and that hash is never stored. `content/camp.json` holds each find's
`offers` (its `rewardId` and chapter), and a chapter's find must name its piece's offer for that
chapter. A find is recorded on the run (`RunState.campFinds`) by the engine and claimed by the
server right after the step commits (`handlers/camp-finds.ts`); a kit find is deduplicated per
hero by the piece she holds, with no crew receipt.

- **Written only by the server**, as every authoritative change is: phones send intents
  (`campPlace`, `campVote`, `kitPlace`, `buddyPick`), and the server checks the piece is owned,
  the hotspot fits it, the sender may change it and the intent is not stale. `kitPlace` and
  `buddyPick` are also accepted from the adventure book, outside any room (§7).
- **Outside the commitment rule.** Dash Cash, finds and friends go straight onto the record, not
  into provisional gains, so `failCampaign()` never touches them (§1). A find or friend is written
  when its effect is applied, even if the room closes before the chapter's end; Dash Cash is
  written with the chapter's end (§12.2).
- **On the run state**, a slim `camp` view for the screens in the lobby, at rest and at the
  chapter's end, and nothing during scenes.
- **Content**:
  - `content/camp.json` (crew pieces, kit pieces, hotspots, frame stages, shop lists, friends and
    their reactions) with a schema in `schemas/`, checked by `npm run content:validate`: every
    `findForCamp` names a real crew piece and every `findForKit` a real kit piece, every friend a
    real cast figure, every shop list prices pieces of its own stage.
  - On every rest scene, a required `setting: "indoor" | "outdoor"` (§3.2).
  - On a campaign, `growsCamp: true` for the full campaigns (§4.1).
- **Art**: a `camp` section in `assets/manifest.json` (backdrops per terrain family, frames per
  stage, pieces, tent and bedroll styles), owed in `npm run art:inventory` like story plates.
- **Deleting**: the camp goes with its crew and its household, and a hero's kit goes with the hero,
  her buddies with it (#624). It names no kid, so a kid's own delete (#252) leaves the crew's camp
  alone.

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

**Phase 2: the camp is yours.** The camp record and each hero's kit (§9); the free kit catalog and
the first-session choice (§5.3, §5.4); the first-chapter finds (§5.3) and the first kit finds;
Dash Cash at the chapter's end, and the shop and the vote once two chapters are played; shared
hotspot changes, with the edit limit and Undo under test (§6.1); the chapter-end camp beat; frame
stage 2; the crew banner as a kept piece and souvenirs at each hero's tent. Finds go into
Riftlight and the Practice Meadow first. The test: can children find their own tent, change their
kit and place a piece without help, and recognize where their finds came from?

**Phase 3: friends and places.** The four friends in §4.4 and the first new ones, each with a
befriend choice in its chapter; tapping friends on a phone and seeing them react and walk over on
the TV (§8.5); buddies (§4.4); tagging every rest scene indoor or outdoor (§3.2), then the outdoor
crossfade and the packed-down indoor camp; the first-wave backdrops (`red_sky_volcanic`,
`frozen_north`); frame stages 3 and 4; Travel Mode's Camp button.

**Phase 4: the camp between games.** The adventure book's Camp tray (§7): the crew's camp to look
at, each kid's kit to change and buddy to pick, online and queued offline, and offline caching of
the camp and its art. The test: do kids open the book on their own to change their kit, and do
they notice the change at the next game?

**Later:** the remaining backdrops in the order of §3.1, more friends and finds as chapters are
written, and milestone tent styles for each tier as its art is painted.

Milestone kit pieces (§5.4) arrive with the kit in Phase 2, for the tiers and distinctions whose art
exists.

**Gemfall is pinned.** `gemfall-compat.test.ts` hashes every Gemfall file, so adding a find, a
befriend choice or a rest scene's `setting` to a Gemfall chapter is a deliberate re-hash with its
reason in the commit. Re-taking those hashes for the camp is approved (*decided*). Nothing here may
move the gameplay digests below the hashes: `findForCamp`, `findForKit` and `setting` change nothing
the digests measure (no flag, XP, item or route), and that should be checked when the mosshorn is
added and the rest scenes are tagged. *Checked* for the rest scenes (#625): all sixteen chapters
were re-hashed and the endings, roads, setbacks and resumed-save digests did not move.

## 11. Decisions and open questions

Settled by the product owner:

| Question | Decision |
| --- | --- |
| What it is | A **camp**, not a caravan: carried on the heroes' backs, and clear of Gemfall's story caravan (intro) |
| The currency's name | **Dash Cash** (§5.2) |
| Rest scenes | Every rest scene is marked indoor or outdoor. Outdoor crossfades to the camp, with its narration on the camp screen; indoor keeps its picture with bedrolls and packs (§3, §3.2) |
| Editing from the adventure book | Each kid can change their own hero's kit and buddy from the book, online or queued offline (§7); the crew's camp stays look-only there (§7) |
| Who owns what | The crew owns the camp's shared parts and friends; each hero owns their kit (tent, bedroll, pack, decorations, souvenirs), which goes wherever the hero goes (§4, §4.5) |
| A crew with no finished campaign | The shop is enough; the frame still grows only on a finished full campaign (§4.1) |
| The tutorial and The Hollow Crown | Neither grows the frame; only `growsCamp` campaigns do (§4.1) |
| Gemfall's pinned hashes | Re-taking them for the camp's content changes is approved; the gameplay digests must still not move (§10) |
| Friends | Only creatures that belong to nobody in the story; Pepper is out, and new characters will be written (§4.4) |
| How many friends at once | Four at most. Each kid may pick one buddy who is always out while their hero is seated; the other seats rotate on their own (§4.4) |
| Finds in a graph campaign | Offered on every way in, given once (§5.1) |
| How much the pieces move | Only a piece a figure is using moves; everything else is static (§8.4) |
| Setting off on Begin | At the start of every chapter (§8.5) |
| Phase 1 | Small: the animated lobby only, expanding once children notice their camp (§10) |
| The first reward | Arrives in the first session: a kit choice and a first-chapter find (§5.3) |
| The shop | Opens once the crew has been paid for two chapters; its first pieces cost 5 Dash Cash (§5.3) |
| Shop opening | The Practice Meadow doesn't count toward the two paid chapters (§5.3) |
| Shop offers | Includes pieces the crew can't afford yet, shown with what they still need, never votable (§6.2) |
| Lucky drops | A 1 in 8 chance of 1 Dash Cash after each won mini-game or fight, rolled by the server. Never from `play` interactions, at most 2 a chapter, none in a chapter already paid for (§5.2) |
| What a chapter pays | 2 for finishing, any ending, plus 1 per optional objective met (§5.2) |
| Milestone kit pieces | A tent style for each new appearance tier and a decoration for each class distinction, kept even if a failed campaign puts the tier back (§5.4) |
| Offline kit edits | Queued on the phone and sent when the signal returns (§7) |
| Book edits: the device wins (#629) | The kid's own kit and buddy edits from the adventure book apply over newer values; the server still checks they are valid (§7). The latest edit of a field wins, whether it was made in the book or at a table, and the fields it did not touch keep what is stored, so nothing is lost. This replaces the field-by-field merge |
| Goal steps | Pay no Dash Cash: every success path ticks them all, so they would be free money. Finishing and optional objectives pay (§5.2) |
| Kit finds | Every seated hero gets their own copy; a duplicate gives nothing, since Dash Cash is the crew's (§5.4) |
| The shared-edit limit | Tested in playtest, with an Undo that does not use up a change (§6.1) |
| Setback campaign endings | Count as finished: they grow the frame (§4.1) |
| Buddies on a move home | Removed from the old household's camps (§4.4) |
| Lucky drops across attempts | The cap of 2 counts every attempt at a chapter (§5.2) |
| Implementation requirements | All of §12 approved, including its defaults: lower-stage pieces staying in later shops, and the migration policy for existing crews (§12) |
| Stage-1 shared spots | Lantern hooks, a friends' corner and a banner pole from the first chapter, so first finds and starter purchases go up straight away (§4.1, §5.3). The awning stays a stage-2 spot: the noodle awning and the striped awning wait for it with their note (§8.3, §12.5) |
| Laid out by the paintings (#623) | Every camp piece is laid out by its painting's measured footprint (`camp-paint.json`), not a guessed width; a tent is 1.1 times its hero's height, and big parties are drawn smaller at stage 2 rather than overlap, down to the 0.6 floor for four bigfoots (§8.3) |
| A tent is bigger than its hero (#620) | Every tent, the patched lean-to and the milestone tents included, stands taller than its hero, and every bedroll is longer than her, in every species and both renderers; the lean-to is no longer fitted by length (§8.3) |
| Stage-2 tents staggered | The four tents stand on two lanes, like stage 1's ring of bedrolls, so parties draw near full size and every tent stands taller than its hero (§8.3) |
| A nearer tent over a farther one (#620) | A tent on a nearer lane may partly cover a tent further back, never its door (where its hero rests) and never its souvenir line (§8.3) |
| Tall shared pieces behind a nearer tent (#620) | The awning, the lanterns and the banner pole, and the shop pieces on those spots, may stand partly behind a nearer tent: never behind or in front of a hero at her door, less than half of the piece's painted area covered and none of its top half (the flag, the vane, the lamps, the canopy) nor any of a banner pole's pennant, the hero who goes to look at it never hidden by a tent, and its name still set clean (§8.3) |
| Short near-lane pieces in front of a tent (#620) | The friends' corner, the trophies and the cookfire may stand on the near lane in front of the lower half of a tent further back, never its door (§8.3) |
| Small heroes get roomier tents (#620) | A small hero's tent is 1.2 times her painted height, a big hero's 1.1: up to 110 cm painted (kitsune, dragonlings) 1.2, from 150 cm (manticores, griffins, unicorns, bigfoots) 1.1, a smooth ramp between; a kitsune's ears sit clearly under her tent's top as she stands at its door (§8.3) |
| Lanterns and banner over a back tent's edge | The lanterns and banner pole may stand in front of the outer edge of a back tent, never its door, so big parties draw near 0.8 at stage 2 (§8.3) |
| Indoor bedrolls are rolled up (#625) | Indoors nobody sleeps in it, so every hero's bedroll is rolled up beside the pack, whatever style the kid picked; it is sized to the hero like the rest of the gear, and need not be longer than they are (§3.2) |
| Big frame pieces behind a nearer tent (#627) | The stage-3 and stage-4 frame pieces (the lookout post and lookout, the lantern string, the awning, the shared tent, the banners) follow the tall-shared-piece rule: each may stand partly behind a nearer tent, never by a hero's door (§8.3) |
| A full camp at stages 3 and 4 (#627) | Parties draw at about 0.61 to 0.67 at stages 3 and 4, smaller than at stage 2, because the back row of frame pieces fills the width. The owner likes the fullness (§8.3) |
| A blocked friend fades over (#624) | In a crowded camp a tapped friend whose way to the hero stays blocked fades over to her rather than walking through anyone (§8.4) |
| Friend-tap limit (#624) | Each phone may tap friends twice every 8 seconds, and its button rests 4 seconds after a tap; the TV acts out one tap per friend at a time, holds one more and drops the rest (§8.4) |
| A friend given freely counts as belonging to nobody (#626) | A creature its keeper gives away freely, as Tilly gives a duckling and the yeti herder a spotted kid, belongs to nobody in the story and may be a friend (§4.4) |
| The kid goat is a different kid from the herd, given by the herder (#626) | The goat kid of Exchange Rift goes home and is met again, so it is never offered; the friend is a younger spotted kid the herder gives away in Glacier of Origins, always named "the spotted kid goat" (§4.4) |
| One harbor gull for both campaigns (#626) | Gemfall 1's dawn gull and Riftlight's frosty Exchange gull are one friend, `harbor_gull`, with two offers: the same bird at the same quay, never two friends that read as one animal (§4.4) |
| Bun and the kid goat look different (#628) | Two friends must never read as the same animal at camp scale: Bun is repainted to stand apart from the kid goat (§4.4) |
| The book's crews (#629) | The adventure book lists every crew any of the kid's heroes is part of, recorded on each hero's kit whenever she is seated at a crew's table (§7). A hero who only sits in a crew's lobby and leaves, without making, seating, starting or editing anything, is not recorded for that crew; the owner confirmed that is the right behavior. For a hero from before the record (kit v4), the one-time backfill reads each past run's last snapshot and counts only runs that left the lobby with her still seated, so a lobby visit is not found there either; it cannot see a lobby where she made or edited something without a chapter starting, which the record counts from then on |

Nothing is open. The two parked questions from earlier (editing from the book, choosing friends)
are settled above as kit and buddy editing in the book and buddies.

## 12. Implementation requirements

These close gaps in the earlier draft, and are **approved** (*decided*): implementation follows
them. Where one says something is under test (the shared-edit limit and Undo, §12.5), the playtest
decides the number, not whether the mechanism is built. The two parked features in §11 do not
block the initial release.

### 12.1 Kit pieces belong to the hero, camp pieces to the crew

Crew inventory and hero-owned kits have separate ownership rules (§4). A piece in one crew's
inventory can never authorize anything in a hero's kit, at that crew or another.

Kit pieces and crew pieces are separate catalogs with separate ids, so one can never be placed as
the other. Every hero starts with the same free catalog. Earned kit pieces (kit finds, and
milestones, §5.4) are recorded on the character in `HeroKit.unlocked`, with where they
came from; that record moves with the hero when they move home (#251) and is deleted with them.
Never infer kit ownership from any crew's catalog. A buddy (§4.4) names a crew-owned friend, so it
is kept per crew: as built (#624) on the hero's kit, keyed by that crew's camp, and accepted only
for one of that crew's friends.

### 12.2 Rewards are permanent, once, and independent of presentation

The once-per-place rule and duplicate conversion need separate identities:

- Give each authored find or friend offer a stable `rewardId` shared across every route into the
  same place. Claiming it writes a crew-scoped receipt atomically with the reward.
- First claim: grant the piece, or 1 Dash Cash if the crew already owns it from another reward. An
  existing receipt grants neither a second piece nor more Dash Cash. Different routes and replays
  cannot farm the same offer.
- Pay chapter-completion Dash Cash and write its paid-chapter receipt together. Replaying an
  already-paid chapter grants no completion or optional-objective payment, including objectives
  missed the first time. Unclaimed finds remain available.
- Persist finds when their authored effect is applied, even if the room closes before the
  chapter's end. Showing a find at the chapter's end celebrates an owned piece; it is never the
  act that saves it. Declining a friend writes no receipt; that friend may be offered on a later
  visit.
- A lucky drop (§5.2) writes a receipt keyed by the run and the scene that dropped it, together
  with the Dash Cash, so a retried, replayed or reconnected result never pays it twice.
- Snapshot met optional objectives for payment. An objective backed by an item must still count if
  the party met it and later handed over the item.

Use stable award identities rather than scene ids that can change during editorial revisions. The
record sketch in §9 needs these receipts; choose their storage shape after checking transaction
and record-size limits. A content version update must not reset claims.

### 12.3 Progression has a ceiling and a replay rule

Count each distinct `growsCamp` campaign the crew finishes, on any ending, once
(`grownBy`), capped at stage 4. Failed or abandoned attempts do not advance the frame and do not
remove anything. Replaying a campaign does not advance it again. Later finished campaigns may
add cosmetic trophies after stage 4.

Existing crews need a migration policy: derive the starting stage and kept trophies from their
recorded finished `growsCamp` campaigns, initialize Dash Cash to zero, and do not back-pay
historical chapter rewards. Existing heroes do get the milestone kit pieces (§5.4) for the tiers
and distinctions they already hold: those are the hero's own record, not a payout. Keep that
migration idempotent.

Every frame must support the full seated party and the four visible friends. Frame growth can add
decorative hotspots, but cannot be required to display a hero's personal space. Early phases must
render a safe fallback for a crew whose derived stage exceeds the available frame art.

### 12.4 The chapter-end purchase is optional and atomic

Allow at most one purchase per chapter-end visit. Show up to three eligible,
unowned pieces for the current stage, affordable or not, in a stable catalog order, plus **Save our
Dash Cash**. When more than three are eligible, take every affordable one first (in catalog
order), then the cheapest the crew cannot afford yet (catalog order between equal prices), and
show the chosen ones in catalog order. Show each piece's price and the resulting balance, or, for
one the crew cannot afford yet, how much more it needs; that one is never votable, and the server
refuses a vote for it. If none is affordable, show the pieces and the balance without starting a
vote. Lower-stage pieces the crew does not own stay in later shops.

The count that opens the shop (§5.3) is derived from the paid-chapter receipts, leaving out the
chapters of a campaign marked `tutorial`, on every read. A crew whose stored count still includes
the Practice Meadow reads corrected, and its next write stores it, however often that happens.

A vote belongs to one chapter-end instance and one crew. Use the existing choice-vote rules for
connected and stepped-away players, including the turn-marker tie break. Leaving the screen
cancels it; there is no pending vote to resume. On resolution the server rechecks eligibility,
ownership and balance, then debits and grants in one commit. Retried messages cannot buy twice.

Two rooms can potentially reach one crew. Use the record's `revision` or an equivalent conditional
write for purchases and placements. A losing concurrent purchase refreshes the offer and balance
without spending. A stale intent from a closed vote or a previous downtime moment is rejected.

### 12.5 Shared edits and automatic display do not discard anything

Identify each downtime moment on the server, and count shared edits by seated
player rather than device. Reconnecting or using a second phone does not reset the limit. Invalid
changes do not count. Explain the limit before the first edit and disable further shared edits
with a short message; personal edits remain available. Undo (§6.1) restores the hotspot's previous
piece, only for that player's own latest change in the same downtime moment, and gives the change
back; it never undoes another child's pick. Placing a piece first owned this chapter is not
counted. All of this is under test (§6.1), so keep the limit one server-side constant.

Awarding a piece never silently replaces a decoration another child chose. It joins the
collection, is shown beside the campfire, its matching hotspot is highlighted, and a player may
place it during downtime. If its hotspot is not available yet (a later frame stage), it stays in
the collection with a note saying when it can be displayed. Stage 1 has the lantern hooks, the
friends' corner and the banner pole (§4.1), so only an awning waits that way at stage 1.

Choose the visible friends once per downtime moment: first each seated hero's buddy (§4.4), then the
rotating seats, with a stable tie break and newly acquired friends first. Persist enough rotation
history for "least seen" to survive reconnects; do not write positions or animation frames. More
than four new friends at once queue their first appearance for later downtime moments. Friends not
currently out remain visible in the collection; rotation never suggests that they left or were lost.

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
the book, label its last-sync time, and provide a useful first-visit empty state. If the device can
reach more than one crew, name the selected crew explicitly in the book.

The book's kit and buddy edits (§7) use a write path authorized by the phone's device binding, as
its read is: the server accepts `kitPlace` and `buddyPick` only for heroes that belong to the kid
the phone is bound to and refuses everything else. Its writes are conditional on the hero's row
as read, so an edit in the book and one at a live table never lose a write; where both pick the
same field, the latest edit wins, book or table (§7, §11). A live room picks up a kit change at its
next downtime moment, or at once when her phone next edits her kit there.

## 13. Acceptance criteria and playtest questions

### 13.1 Required checks

These follow from the decisions in §11, the requirements in §12 and the existing rules the camp
lives under.

- Failed campaigns keep every camp gain (§1).
- The tutorial, The Hollow Crown and any other campaign without `growsCamp` never grow the frame
  (§4.1).
- A find or friend in a graph campaign is offered on every way in and given once (§5.1).
- Every rest scene has a `setting`, and validation fails without one. An indoor rest never shows
  the campsite backdrop or tents (§3.2).
- The first session offers each kid a choice for their own kit, and the first chapter of the
  Practice Meadow and of every `growsCamp` campaign hands over a find on every path (§5.3).
- The shop does not open until the crew has been paid for two chapters, the Practice Meadow not
  counted (§5.3).
- Lucky drops come only from the server's roll, after a won mini-game or fight, at about 1 in 8
  over many trials; each pays once, whatever is retried or reconnected (§5.2, §12.2).
- No purchase can overspend, buy a piece twice or charge after the chapter's end has been left.
  Placements the sender may not make are refused (§6).
- A hero's kit, souvenirs included, goes with the hero to every crew and when moving home (§4.5).
  Household and character deletion follow existing lifecycle rules.
- A kit find gives every seated hero their own copy, and a hero who already has it gets nothing
  more (§5.4).
- A buddy is always out while its hero is seated; the other seats rotate (§4.4).
- From the book, a kid can change only their own hero's kit and buddy; nothing shared can change
  there (§7, §12.6). Offline changes queue, survive closing the book, and apply when sent, over
  anything changed meanwhile (the device wins, §11), each still checked for validity (§7).
- A new tier or class distinction unlocks its kit piece once, and a failed campaign that puts the
  tier back leaves the piece unlocked (§5.4).
- Begin, Go on and return to lobby remain available with panels open and during every animation
  (§3, §8).
- At most four friends are out, and four heroes and four friends fit each frame, and the indoor
  layout, without covering required controls or narration (§4.4). Review recordings for walking,
  crossings, occlusion and layout at phone and TV sizes (§8.6). Verify largest text, reduced
  motion and the still fallback (§8.7), and keyboard access as docs/accessibility.md already
  requires.
- The book opens offline after an online read with its saved pieces and friend reactions (§7).
- A reward reached through two routes, replayed, retried or reconnected grants once, by its
  `rewardId` receipt; a duplicate owned piece converts to Dash Cash once per distinct reward offer;
  skipping a celebration does not lose its reward, because finds are saved when found (§12.2).
- Each `growsCamp` campaign grows the frame at most once per crew, however often it is replayed,
  and the frame stops at stage 4; existing crews migrate idempotently (§12.3).
- Kit pieces and crew pieces never cross: no crew piece ever appears in a kit, and no kit piece on a
  shared hotspot (§12.1).
- At most one purchase per chapter-end visit; a losing concurrent purchase refreshes the offer
  without spending; a stale intent is refused (§12.4).
- Shared edits are counted per seated player, not per device; Undo gives the change back; placing
  a piece first owned this chapter is not counted (§12.5).
- The book names the crew and how fresh its saved copy is, and its first use without a cache is
  clear (§12.6).

### 13.2 Playtest questions

Playtest each phase with children in both target age groups and a grown-up. Observe whether children
recognize a past adventure, can find their own tent and can place a piece without help. Record
whether the shared-edit limit causes arguments or frustration, how often children use Undo, and
whether buddies and the rotating seats feel fair. Watch whether kids open the book alone to change
their kit. Note whether children understand what the camp is for
after their first session (§5.3). Measure added time before Begin and Go on: the technical target is
no forced delay; voluntary time spent decorating should be reported separately.

Before expanding art production, verify the first phase's central question: do children notice
and care about their crew's camp? Before tuning shop prices, measure actual first-play rewards,
time to the first affordable purchase and how often a crew chooses to save. The economy targets in
§5.2 are hypotheses until those observations exist.
