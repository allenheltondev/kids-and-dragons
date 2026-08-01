# Gemfall — campaign design brief

**Canon id:** `campaign.gemfall` · **Chapters:** 8 story beats (16 authored
chapter files — see [Routes](#routes-fixed-beats-branching-country)) ·
**Status:** `newly_defined`

A violent eruption from Mount Red Sky scatters powerful gemstones across the
realm, launching the largest treasure rush in living memory. The player runs a
party of three adventurers, each drawn by a different motive — wealth,
curiosity, prestige, duty, survival, the chance to prove something. None of
them begins as a chosen hero. They are simply trying to reach the Gemfall
before everyone else, and the campaign is the story of them finding out what
they were actually racing toward — and of the player finding out what the
party actually wants, which the campaign never asks in a menu and always
reads from play.

The map already knows this story: Mount Red Sky's label reads *"Source of the
Gemfalls, and restless power."*

## The spine, and the one big secret

The gemstones are not volcanic treasure. They are fragments of an ancient seal
holding a titan dormant beneath Mount Red Sky, and every stone carried away
weakens it. The campaign is a treasure hunt for five chapters and a race to
undo a treasure hunt for three — *unless the party decides the treasure hunt
was the point*, in which case chapters 6–8 become something else, and the
campaign lets them.

> **Canon scope:** the titan and the seal are campaign-scoped mysteries
> (`canon_note` on `campaign.gemfall`). Nothing in this brief opens the Hollow
> Gate, populates the Expanse, or names a legend dragon — those stay protected.
> What the campaign lets the party *observe* about the Hollow Gate: its runes
> hum the same note the gemstones hum, the marsh's disturbances run densest
> near it, and it feels older than everything around it — older than the
> modern world. What the Gate *is* — a seal, a doorway, a warning, or
> something else entirely — is never established, by any scene, in any
> branch. Characters may theorize; the campaign confirms nothing.

## The beat ladder

The reviewers' campaign model, extended to the whole arc: **every chapter
ends on the same story beat on every road — but almost never in the same
place, and never by the same actions.** A chapter's beat is a sentence that
must be true when the chapter closes, wherever the party closed it:

| # | Beat | The sentence that ends the chapter |
| --- | --- | --- |
| 1 | **The Spark** | The red sky calls, and the party answers — signed on, outfitted, and northbound. |
| 2 | **The Fork** | The land is already paying for the rush, and the party chooses its road. |
| 3 | **The Toll** | The land charges for passage, and the first true clue lands: the stones hum an old, old note. |
| 4 | **The Country That Noticed** | A whole region is reorganizing itself — and it is not the eruption the land flinches from. It is the stones. |
| 5 | **The Outline of the Truth** | The stones are older than the mountain, the land has been keeping records — and the party decides who to tell. |
| 6 | **The Whole Truth** | Seal, titan, rush — assembled on one table. And the party names what it wants. |
| 7 | **The Gathering** | Everything the road gave comes back — and the mountain will not wait. |
| 8 | **Gemfall** | The mountain answers, and history files the party. |

Chapters 1 and 6–8 are shared country with routed *openings*; chapters 3–5
are fully routed (three variants each); chapter 7 is routed by **pursuit**
rather than by road (see [Pursuits](#pursuits-what-the-party-is-actually-for)).
Chapter 2 is shared country with a three-way exit.

## Routes: fixed beats, branching country

Chapter indexes stay contiguous for the content pipeline, but chapters 3–5
exist as *route-variant triples* — one member per road, same index, same
story beat, different country — and chapter 7 is a triple of its own, keyed
on pursuit instead of road. A playthrough tours eight chapters; the corpus
holds sixteen.

At the end of chapter 2 the party chooses at Bramblewood:

- **The River Road** (`route_river`) — east and then north: the Sunward road
  to **Stone Crossing**, across the Great River into the **Eastern Plains**,
  north along the pride routes to the **Northern River Bridge**, and over
  into the foothills. Open country, road people, the realm's traffic laid
  bare.
- **The Rush Road** (`route_rush`) — straight up the middle: north out of the
  Sunward Fields into **the Plains**, over the west branch at the caravan
  ford, and up the realm's oldest road country to the foothills' front door
  and the **boundary stones**. The shortest road, which is why the rush took
  it first — the party travels *inside* the stampede, among the wagons,
  campfires, grifters, recruiters, and route-songs of the rush itself.
  Crowded country, loud country, the realm's appetite laid bare.
- **The Wild Road** (`route_wild`) — west and then north: into the
  **Whispering Marsh**, over the river's west branch into the **Enchanted
  Woods**, through **MossHome**, and east along the bigfoot high paths into
  the foothills. Closed country, old country, the realm's memory laid bare.

All three roads deliver the same three beats — **The Toll** (ch. 3), **The
Country That Noticed** (ch. 4), **The Outline of the Truth** (ch. 5) — and
converge in chapter 6 at the foothills, each by its own door. Each road
carries its own third of the evidence, and chapter 6's truth-table scene is
authored to work with any third. No route is the "real" one; none is a
detour.

### The weave: how storylines cross

The roads are storylines, not rails, and they touch where the geography says
they touch:

- **Marsh → Plains (voluntary, end of ch. 3).** The Whispering Marsh borders
  the Plains. A Wild Road party leaving the Hollow Gate may strike northeast
  out of the reeds and fall in with the rush traffic instead of attempting
  the west-branch ford — sets `walked_over`, and the campaign continues into
  **4C** with the marsh clue in their pockets and mud on their boots. The
  boggarts think this is very funny.
- **Plains → Woods (involuntary, end of ch. 3).** The Rush Road's caravan
  ford crosses the same west branch the Wild Road must cross, farther
  upstream. Fail it and the branch does what its current actually does:
  carries the party west through the marsh's outermost tangles until the
  channels let go — sets `marsh_kept_us`, and the party enters the
  **Enchanted Woods** late, by the flooded western paths near MossHome,
  continuing into **4B**. A Rush Road party can be two chapters deep in a
  storyline they never chose, which is what rivers are for.
- **The river commits you (River Road).** East of the Great River there is
  no walking back: the main channel is a strategic barrier and the only
  northern crossing is the bridge that chapter 5A is *about*. A River Road
  party weaves by rumor, not by foot — which is honest to the map.
- **After beat 4 the lattice narrows.** Whatever road the party is on at the
  start of beat 5, they finish it: the mountains decide, and every road's
  chapter 5 ends pointed at the foothills.

**Echoes:** every road hears the other two. Rumors, relay-running centaurs,
wisp gossip, and rush traffic carry garbled news of the countries the party
didn't choose — so the unseen routes are living places (and two reasons to
play again), never dead files.

### River geography (per `canon/geography.yaml`)

The branching must respect the rivers, because every signature failure is a
river doing what rivers do:

- The **Great River main channel** runs north→south, east of the central
  mainland. **Stone Crossing** sits on it, connecting the Sunward Fields to
  the Eastern Plains. Downstream from the crossing is *south*, toward the
  river mouth by the Bone Yard's edge. A failure at Stone Crossing carries
  the party downstream on the main channel — it cannot reach the marsh.
- The **west branch** forks away toward the Whispering Marsh and the western
  sea, separating the Plains from the southern lands. Canon says it plainly:
  *the branch cuts the southern Plains and decides, seasonally, which roads
  are roads.* Both remaining signature failures live on it — the Rush Road's
  caravan ford in the southern Plains, and the Wild Road's ford at the
  marsh's northern edge — and both sweep *west*, toward the sea, which is
  why both failures deliver the party to the same flooded country near
  MossHome.

## Pursuits: what the party is actually for

The campaign never opens a goal menu — but it does not pretend the player
has no say, either. From chapter 1 the party accumulates conduct — gems kept
or returned, promises made, who they told, what they mended — and at the end
of chapter 6, with the whole truth on the table, the campaign **reads that
conduct back and names the pursuit it adds up to**. Then it asks. The player
affirms the reading or overrules it — the choice is real, and it is theirs —
but the history is binding either way: conduct keeps its receipts in NPC
reactions, faction support, difficulty, and the epilogue, so a party that
declares against its own record plays the harder, stranger version of the
pursuit it chose, and the room notices. The exit scene sets one **pursuit
flag**, and the pursuit — not the road — selects chapter 7 and frames
chapter 8:

- **The Reckoning** (`pursuit_restore`) — undo the rush. Thicken the seal,
  face what wakes, become the Heroes of Red Sky — or die trying, which is
  now possible (see [Losing](#how-failure-works--and-how-the-campaign-is-lost)).
- **The Collection** (`pursuit_hoard`) — the gems were always the point. The
  titan is somebody else's problem; the **First Facets** (below) are the
  party's. A complete, playable way through the campaign that never swings a
  sword at destiny — the only pursuit with its own exit before the mountain
  (the Walk, chapter 7H) — and whose ending depends brutally on what the
  party did *besides* collect.
- **The Tether** (`pursuit_leash`) — the power beneath the mountain is the
  prize. Not restored, not destroyed: *held*. The wardens have a cage
  doctrine, the cult insists the seal is a cage on the cure, and the party
  can play both against the middle — for a faction, or for themselves.

A party that refuses to declare drifts into the Reckoning by default, with
no allies flag set — hardest and freest, and the scene says so.

Pursuits are not walls. Conduct keeps counting after chapter 6, and a
Collection party that starts handing facets back mid–chapter 7 is doing
something the epilogue matrix knows how to read.

### The First Facets

The collection pursuit needs a collection, and the campaign seeds one from
scene one. The laughed-out-of-the-tavern scholar of chapter 1 has a theory
nobody wants: the original seal had **eight great facets**, and the rush is
retailing seven of them by accident. Every chapter puts exactly one named
facet on the table — held by someone, priced in something — and each routed
beat offers a different facet on each road, so any single playthrough can
reach **seven** before the mountain. The eighth is *in* the mountain, and it
is not for sale.

| # | Facet | Where, and in whose hands |
| --- | --- | --- |
| 1 | **The Ember Facet** | Ch. 1 — passes through the party's own hands at the Exchange; most parties sell it. It comes back north in chapter 7 on a buyer's caravan, at rush prices, from a merchant who remembers them fondly. |
| 2 | **The Harvest Stone** | Ch. 2 — fell in an unharvested corner row. The harvest sprites are guarding it, seriously, with a woven medal on it. |
| 3 | **The Drake's Rate** *(River)* — newest piece on the river drake's hoard shelf · **The Barge Stone** *(Wild)* — the mire mimic's "abandoned gem barge" act has one genuine prop · **The Ford Stone** *(Rush)* — in the ford witch's keeping, and it will not stop ringing her charms. |
| 4 | **The Pride Stone** *(River)* — the fall no pride will den within a day of · **The Glade Stone** *(Wild)* — lodged in the heart of a wounded glade: mending the glade and taking the stone are opposite actions · **The Depot Stone** *(Rush)* — in a rush depot's strongbox on the north roads. |
| 5 | **The Clerk's Stone** *(River)* — logged, tagged, and crossing the broken bridge westbound · **The Confiscated Stone** *(Wild)* — in the pile the Woods has been keeping · **The Unassigned Stone** *(Rush)* — held by the grandmothers, on the list of things never assigned to anyone. |
| 6 | **The Table Stone** | Ch. 6 — the evidence stone on the Redspire truth-table, in warden custody and logged twice. |
| 7 | **The Caravan Stone** | Ch. 7 — the masterpiece stone at the heart of the fattest caravan in the funnel. Every pursuit's chapter 7 collides with it. |
| 8 | **The Keystone** | Ch. 8 — the exposed crown of the seal itself. Taking it *is* the Exploit choice. There is no way to hold all eight facets and an intact realm at once, and the campaign never pretends otherwise. |

Facet flags (`facet_*`) are readable everywhere: NPCs notice a party that
hums when it walks. Prides won't den near their camp. Mosshorns leave.
Bramblewood's hedges take longer. The collection is real, and so is carrying
it.

## How failure works — and how the campaign is lost

Per the brief and `standard_behavior`: **scene failure reroutes, it never
stops a chapter.** Each road has a signature crossing, and each crossing
failure is an entrance somewhere real, not a retry:

- **River Road, Stone Crossing (ch. 3A):** fail the crossing and the main
  channel sweeps the party downstream — fished out, soaked and toll-less, on
  the *eastern* shore near the river mouth, with the Bone Yard on the skyline.
  They enter the Eastern Plains by the wet southern door (`river_took_us`)
  instead of the dry one (`crossed_dry`).
- **Rush Road, the caravan ford (ch. 3C):** fail the west-branch ford and
  the current carries the party west into the marsh's outer tangles — they
  enter the **Enchanted Woods** late by the flooded western paths
  (`marsh_kept_us`) and their storyline has changed under them: chapter 4 is
  4B, in a country they never chose.
- **Wild Road, the west branch (ch. 4B opening):** fail the ford at the
  marsh's northern edge and the same current, farther downstream, does the
  same thing — `marsh_kept_us`, the flooded western paths, the forest
  unimpressed either way.

Combat defeat is the same philosophy at chapter scale: a beaten party is
never dead-ended. They are robbed, rescued, rerouted, or ransomed — and it
costs them **stones and time**, which, from chapter 6 onward, are the two
things the realm is running out of.

### The Seal Clock

From chapter 6 the campaign runs a doom clock, and everything the party has
done seeds its starting hand: fragments returned push it back; facets
hoarded at large, intercepts failed or skipped, chapter defeats, and cult
rite progress push it forward. The clock is never a number on the screen.
It is diegetic, staged through creature canon the earlier chapters taught
the player to read:

1. Embermoths misbehaving — drifting *away* from the mountain.
2. Embermoths gone from the foothills entirely; mosshorns and prides at
   maximum flinch.
3. Cinder wolves off the mountain wholesale; tremors settling into a steady,
   patient cadence; the dragonling towns sleeping with the bells on.
4. **The bells.** The foothill bell-code has one ring that has never been
   used. Everyone knows what it would mean. Nobody has ever said it aloud.

### Losing

The campaign can be lost — not by a bad die roll, but by the accumulated
weight of what the party chose not to do. Three loss endings, each authored,
each an epilogue rather than a game-over screen. Losses stay inside the
child-hero tone: consequence and grief, never gore; the realm endures,
changed; and every loss epilogue ends on a spark someone else might pick up.

- **The Last Ring.** The Seal Clock reaches its final stage before the party
  reaches the seal chamber. The unused ring is finally rung. The titan
  rises with no one at the seal to answer it, and the epilogue tours the
  realm the earlier chapters made the player love — rearranged. History
  files the party by their conduct: rich, absent, almost-heroes, or simply
  too late.
- **Turned Back.** Defeated inside the mountain with nothing left to give,
  trade, restore, or say. The legend dragon does not kill children who came
  up the mountain wrong — it *removes* them, and holds what it can, alone,
  for as long as it can. The party watches the summit from the foothills
  with everyone else. This loss is reached only by entering chapter 8 with
  empty hands and a spent clock; the design guarantees a party that husbanded
  either resource always has a live path.
- **The Broken Tether.** The Tether pursuit's own failure: hand the
  fragments to the Deep Hollow Cult and fail to hold them to the bargain —
  or hold the tether yourself and fail the dragon's questions about it —
  and the "cure" cracks the seal instead of leashing what it holds. The
  cult grieves loudest of anyone, which is the worst part.

## Flag summary

| Flag | Set | Read |
| --- | --- | --- |
| `motive_*` (one per member) | ch. 1 | ch. 8 epilogue matrix |
| `route_river` / `route_rush` / `route_wild` | ch. 2 exit | selects 3–5 variants; ch. 6 door; ch. 7 callbacks |
| `crossed_dry` / `river_took_us` | ch. 3A | ch. 4A opening, Ossley's debt beat |
| `walked_over` | ch. 3B exit | marsh→plains weave; ch. 4C opening |
| `forded_clean` / `marsh_kept_us` | ch. 3C or 4B (west branch, either ford) | 4B/4C/5B openings; storyline switch |
| `facet_*` (eight) | any chapter | collection count; NPC reactions; ch. 7H; the Exploit choice |
| `told_wardens` / `told_gatherers` / `kept_close` | ch. 5–6 exit | ch. 7 allies and depots; hoard-line epilogues |
| `pursuit_restore` / `pursuit_hoard` / `pursuit_leash` | ch. 6 exit | selects ch. 7 variant (7R / 7H / 7L); frames ch. 8 |
| `funded_the_break` | ch. 7H (selling to the cult) | hard clock acceleration; recolors every downstream epilogue |
| `walked_away` | ch. 7H exit | ends the campaign at the tree line; epilogue by clock + ally flags |
| `seal_clock` (staged) | seeded chs. 1–5, runs from ch. 6 | loss checks; ch. 7–8 staging; every epilogue |

## The party

Three adventurers from the six playable species, chosen at start. Species
choices pay off where the lore says they should — and because the middle is
routed three ways, party composition gives the roads different textures.
**No species is required by any route**; every gate has a
patience-or-cleverness alternative.

Shines on the **River Road**:

- A **manticore** is *coming home*: the Eastern Plains are the pride lands,
  and professional courtesy with centaurs and stone trolls is old (ch. 3A,
  4A).
- A **griffin** carries messages ahead and spots trouble from altitude —
  open country is made for it (ch. 3A, 4A, 5A).

Shines on the **Rush Road**:

- A **dragonling** is *coming home the front way*: the caravan road is the
  foothills' door, gathering law is the family trade, and chapter 5C walks
  them up to their own boundary stones at the head of a rush that has never
  heard of the one rule (ch. 3C, 5C — and gathering law everywhere).
- A **kitsune** reads the rush itself — the queue, the grifters, the
  three-card stalls, the news retold as theater around every campfire — and
  can work a crowd no one else can (ch. 3C, 4C).
- A **griffin** is the relay's favorite volunteer: open road, long sight,
  and a rush's worth of lost people to find (ch. 4C).

Shines on the **Wild Road**:

- A **kitsune** hears what the marsh and the boggarts are not saying (ch. 3B)
  and has opinions about the mire mimic's technique.
- A **unicorn** feels the wounded glades and the wisps (ch. 3B, 4B).
- A **bigfoot** can read MossHome's path records (ch. 5B) and notice what
  everyone else missed (everywhere).

## Chapters

### 1 — The City That Smelled Opportunity

**Where:** `location.exchange` · **Beat:** The Spark · **Tone:** gold-rush
overture

Mount Red Sky erupts in the opening scene — felt in the Exchange as a red
glow on the horizon, a rain of gem-light over the foothills, and then, within
days, a stampede. Merchants, scholars, mercenaries, pilgrims, and thieves pour
into the neutral city where every road, ship, and rumor converges.

- Build the party: pick three, each with a motive (wealth / curiosity /
  prestige / duty / survival / proving themselves). Motive is a flag the
  epilogue reads back.
- Scenes: dockside rumor-trading, outfitting (`item.quickfoot_lace` vendors
  doing brisk trade), a scholar who insists the "gem-light fell *upward* for a
  moment" and is laughed out of the tavern (first foreshadow — and, for
  parties who go back and listen, the source of the nine-facets theory the
  Collection pursuit is built on).
- **The Ember Facet** passes through the party's hands — a stone somebody
  pays them to carry across the docks, or their own first find in a gutter,
  glittering. Most parties sell it. The campaign remembers either way.
- Exit: sign on with a caravan heading north through the Sunward Fields.
- **No combat.** The Exchange chapter is people, prices, and promises — the
  city's `population_rule` (no native or dominant people) on full display.

### 2 — Green Roads North

**Where:** `biome.sunward_fields` → `location.bramblewood` · **Beat:** The
Fork

The rush hits the realm's food supply first. Caravans trample fields, prices
spike, and the fauns' work-songs keep stopping mid-verse — which every
Sunward child knows means *someone has seen something worth stopping for*.

- Faun cooperatives ask for help re-routing a caravan around an unharvested
  field; harvest sprites (who dislike exactly nobody's crops being trampled)
  reward careful stewardship — the party that walks the rows instead of
  through them gets small unexplained favors for the rest of the chapter.
- **The Harvest Stone** fell in a corner row — the rows everyone knows to
  leave, and nobody says why. The sprites have organized a guard rotation
  and an award ceremony. A party can trade for it, earn it, steal it (the
  sprites remember for the *entire campaign*), or leave it — and leaving it
  is the first quiet vote toward the Reckoning.
- Displaced wildlife: jackalopes crowding the roads (predators inland — the
  first cinder wolf sign this far south), and an embermoth cloud drifting
  the *wrong way*, away from the mountain. A dragonling party member can say
  out loud that this is impossible.
- **Bramblewood:** `individual.pib` will not open the hedges for the
  treasure-hunter mob camped outside (the hedges genuinely do not listen to
  them otherwise), so getting in is a character test, not a fight.
  `individual.marda_thorn`'s inn is the rumor clearing-house: conflicting
  reports of crystal deposits, blocked routes, unnatural tremors.
- **Exit — the route choice, and it is a real one.** Marda's board carries
  three credible boasts: the crossing queue is moving again (east), the rush
  road is jammed but *moving* — fall in and be carried (north) — and the
  frogfolk are still ferrying those they like (west). Choosing sets
  `route_river`, `route_rush`, or `route_wild`, and the campaign genuinely
  goes where the party points it: three different chapters 3, 4, and 5,
  converging in the foothills. The Exchange's rumor mill seeds all three
  honestly — none is advertised as a shortcut, because none is. (The Rush
  Road is *shorter*. It is not quicker. There is a difference, and the queue
  at the caravan ford is the difference.)

---

### Beat 3 — The Toll

*The land starts charging for passage, and the first true clue lands: the
stones hum an old, old note. On the River Road a stone troll hears it through
a palm on the bridge; on the Rush Road a witch hears it ring her charms in a
ford queue; on the Wild Road a boggart hears it in a collection bag.
Different listeners, same note.*

### 3A — The Long Mile *(River Road)*

**Where:** `biome.sunward_fields` east road → `location.stone_crossing`
(`route.stone_crossing`)

Centaur guides are redirecting caravans around new hazards, and their road
markers are being stolen by rush traffic for firewood — a professional insult
of the highest order. The party earns a guide by helping restore a marker
line (or a manticore party member simply asks; the courtesy between road
peoples is old).

- Set piece: **the crossing.** The Great River narrows to a single passage.
  Ingredients, per canon: the queue, the stone trolls' non-monetary tolls
  (a story or a riddle each — the party's are heard *in full*, slowly), the
  river drake adjusting its rates for the traffic spike, a rival expedition
  quietly sabotaging the queue to jump it, and the current, which is a real
  hazard and not a metaphor.
- **The clue:** a toll-taking troll, one palm flat on the bridge
  (stone-listening, per troll lore), remarks that the stones coming south in
  every pocket and pannier are *humming* — a note older than the bridge, and
  the bridge is not young. It has stopped asking riddles this season. All its
  tolls are the same question in different clothes: *where did you get that,
  and where is it going?*
- **The Drake's Rate:** the river drake's hoard shelf has a new centerpiece,
  and the drake is semi-sapient, transactional, and open — in principle — to
  a trade it judges fair. What it judges fair is the scene.
- `individual.old_ossley` ferries when the stones are under — his price is
  never coin. What he asks each party member is a character beat.
- **Branch:** succeed and the party crosses dry — sets `crossed_dry`. Fail,
  and the current takes them: downstream the *main channel*, south past the
  Sunward banks, fished out at last on the eastern shore near the river
  mouth, Bone Yard haze on the horizon and Old Ossley somehow already there,
  not saying anything — sets `river_took_us`, plus a debt to Ossley the
  chapter 7 confluence remembers. **Both flags lead to chapter 4A**, from
  opposite ends of the Eastern Plains. A failed crossing is an entrance, not
  a retry.

### 3B — What the Marsh Remembers *(Wild Road)*

**Where:** `biome.whispering_marsh` → `location.hollow_gate`

The party poles in deliberately — Marda's rumor board pointed here, and the
frogfolk still ferry those they like. The marsh since the eruption is
*louder*.

- The frogfolk have closed channels — not around danger, but around **new
  wisps**. Memories are tangling into lights at many times the usual rate,
  and nobody local will say the obvious out loud: something is leaking.
- **The clue:** the boggarts know what the gems sound like. One will trade
  the fact — sidelong, in hints, for something the party is carrying anyway —
  that the stones *hum*, and that the hum is the same note the Hollow Gate
  runes make. (A boggart's whole culture of listening to lost things pays the
  campaign's first real clue.)
- Encounter: a mire mimic has spent three weeks being an abandoned gem barge,
  and it is *thriving* — partly because **the Barge Stone** is real, the one
  genuine prop in the act, and the hum draws prospectors like a bell.
  Resolutions per canon: name it, or stamp it off its patch. A kitsune party
  member is personally offended by the performance. The stone is claimable
  only after the act closes, one way or another.
- Wisp scene: a wisp leads toward the Hollow Gate. Following with patience
  (or a please — nobody has ever said please to a wisp) earns the sight
  rather than the trap version.
- **The Hollow Gate:** runes glowing brighter than any living witness has
  seen. What the party *witnesses* — and witness is all this scene deals in:
  the runes' note and the stones' note are the same; the marsh's tangling
  runs densest here; and the Gate feels older than the marsh, older than the
  mountain's name, older than the shape of the world the party knows. What
  it *means* is left entirely to the party — a seal? a door? a warning
  carved by someone who wanted it read? The scene confirms resemblance, not
  identity, and the Gate itself cannot and does not open — constraint
  preserved. Optional: a `item.hollow_crown_shard` turns up, hums once at
  the party's gem-dust-covered boots, and goes silent.
- **Exit — a small weave of its own:** north toward the west branch and the
  tree line beyond it (default, → 4B) — or northeast out of the reeds and
  into the rush traffic on the Plains roads (`walked_over`, → 4C), for
  parties who saw the Gate and decided the answer is wherever the stones are
  *going*, not where the trees are.

### 3C — The Ford That Decides *(Rush Road)*

**Where:** `biome.sunward_fields` north edge → `biome.plains`, the caravan
ford on `feature.great_river_west_branch`

The shortest road north is a parade: gem wagons axle-deep in ruts, campfire
rows at every rise, centaur relay-runners threading the whole thing at a
canter. And then the parade stops — because the west branch cuts the
southern Plains, and canon's line is the chapter's premise: *the branch
decides, seasonally, which roads are roads.* This season, with the rush's
weight on it, the caravan ford is a queue two days long and a economy of its
own.

- The queue is the country: a rush camp with stalls, sharps, a three-card
  kitsune con the party can join or expose, faun provisioners up from the
  Fields selling at bridge-queue prices, and a **Deep Hollow soup line** —
  the cult's first contact on this road, feeding the rush's first failures,
  kindness first, always.
- Displaced **cinder wolves** shadow the queue at dusk — cold, not hunting,
  and pointedly *not* bedding near the gem wagons. Every campfire argues
  about feeding them. The party's call gets remembered by the road.
- **The clue:** a witch works the queue — remedy stall, pointed hat, the
  order's register played straight: *what do you actually want?* Her charms
  have been ringing themselves all season, in sympathy, whenever a gem
  pannier passes; she has tuned one to the note and will show anyone who
  asks a real question. The note is older than the road, and the road —
  the centaurs will tell you — was here before everything. She keeps **the
  Ford Stone** wrapped in wool because she is tired of the ringing, and
  what she wants for it is not money and not simple.
- The tolls of this road are the rush's own: queue positions traded, a
  wagon to un-mire, a centaur marker line trampled by queue-jumpers to
  restore (the relay remembers), a stranded family whose season is over and
  who need exactly what the party has spare.
- **Branch — the ford itself.** Cross with the caravans, with ceremony, at
  the drovers' pace — sets `forded_clean`; chapter 4C opens on the north
  bank in the thick of the rush. Or fail — a queue-jumper's surge, a bad
  season current, a wagon going over — and the branch does what its current
  actually does: carries the party *west*, through the marsh's outermost
  tangles, until the channels let go. Sets `marsh_kept_us`, and the party
  enters the **Enchanted Woods** by the flooded western paths near MossHome
  — chapter 4 is **4B**, and their storyline has changed rivers. The road
  people will hear about it. The road people hear about everything.

---

### Beat 4 — The Country That Noticed

*A whole region is visibly reorganizing itself around the Gemfall, and the
party watches evidence harden: it is not the eruption the land is flinching
from. It is the stones.*

### 4A — The Pride Roads *(River Road)*

**Where:** `biome.eastern_plains`

The manticore homeland, in the rush's off-season shadow: most traffic went
west of the river, so what the party sees here is subtler and stranger — the
open country *rearranging itself*.

- **Pride routes are bending.** Manticore prides will not den within a day's
  walk of any gem caravan's rest stop, and cannot fully say why — the cubs
  sleep badly near the stones. The prides are the chapter's living dosimeter
  (the Woods' mosshorns, played in open country). **The Pride Stone** is the
  fall at the center of the widest bend — unclaimed, unguarded, and
  untouched, which in pride country is itself a message.
- **The centaur waystation.** Road-warden centaurs keep the east-bank relay,
  and their caravan sashes — each one a stitched route-map, per centaur
  lore — are all being re-embroidered this season. Laid side by side on the
  waystation table, the new detours are not random: **the reroutes spiral
  around the fragment falls.** Plotted thread by thread, the realm's roads
  are flinching. (This is the River Road's answer to MossHome's archive
  table.)
- Wrongness in the wildlife: embermoths crossing the plains *away* from the
  mountain; jackalopes massing along the pride edges for protection; first
  cinder wolf sign east of the river in living memory.
- Manticore hospitality beats for a manticore party member — and the pride
  elders' riddle account with the Stone Crossing trolls (maintained for
  generations, lovingly disputed) gives any party a way to trade the troll's
  toll-question east: *where did you get that, and where is it going?* The
  prides have started asking it too.
- Openings by flag: `crossed_dry` parties arrive with the queue's caravan
  traffic from the crossing; `river_took_us` parties walk in from the south
  shore, out of the mouth-lands, and see the bent pride routes *first* —
  the wet door pays a small witness dividend for the dunking.

### 4B — The Forest Takes Attendance *(Wild Road)*

**Where:** `biome.enchanted_woods`

The Woods have been redirecting careless treasure hunters for weeks — parties
that damaged glades on the way in are finding that the way out has opinions.

- **Opens at the west branch.** The marsh's northern edge is the river's
  west branch, and the branch must be crossed to reach the trees. Success —
  a frogfolk weir-ford, poled across with ceremony — sets `forded_clean`;
  the party enters by the southeastern glades. Failure, and the branch does
  what its current actually does: carries the party *west*, toward the sea,
  through the marsh's outermost tangles until the channels let go — sets
  `marsh_kept_us`; the party enters late, bedraggled, by the flooded western
  paths near MossHome. (Rush Road parties the ford already took arrive by
  the same flooded door, having never chosen this forest at all.) The forest
  does not care which door they used. It cares about their ledger.
- The forest reacts to the party's ledger, not their species: repaired harm
  and kept promises open paths; a pocketed gemstone quietly closes them until
  someone works out *what the forest is objecting to* (the stone, and what it
  is doing to the glades where fragments fell).
- Mosshorns will not walk near gem-carrying caravans. The herds are the
  chapter's living dosimeter, and a unicorn or bigfoot party member can read
  them early.
- Unicorns are investigating **wounded glades** — places where fragments
  landed and the forest's magic bruised around them. Helping mend one
  (restoration, not combat) earns the unicorns' finding: the stones are not
  *of* the mountain. The forest remembers them from before the mountain had
  that name. **The Glade Stone** sits at the heart of the worst glade — and
  here the pursuits pull opposite directions in one scene: mending the glade
  returns the stone to the seal's account; pocketing it finishes the glade.
  The unicorns watch what the party does. So does the forest.
- Quietly planted for chapter 7: the paths that closed on gem-pocketing
  hunters did not just *close*. The Woods has been confiscating. Somewhere,
  the forest is keeping a pile.

### 4C — The Road That Remembers *(Rush Road)*

**Where:** `biome.plains`, the north roads

Road country in full flood: the rush going up, the rush's wreckage coming
down, and between them the oldest news network in the realm quietly changing
its mind about the route north.

- **The route-songs are gaining verses.** Plains history lives in the
  centaurs' route-songs — one verse per landmark, hazards in the chorus —
  and this season the songs are growing faster than anyone can memorize
  them. The chapter's table-scene is a **campfire relay-sing**: the party
  hears the new verses sung in road order, and the detours they describe are
  not random. Sung end to end, the realm's roads spiral around the fragment
  falls. (The Rush Road's answer to the sash-map table and the MossHome
  archive — the same map, carried in the realm's oldest heads, performed
  instead of plotted.)
- **The empty stretches.** Canon: *an empty stretch of good road is a
  message; jackalopes are the punctuation.* The warrens have gone silent for
  a mile around every gem depot on the north roads — and a party carrying
  facets notices the silence travels *with them*.
- The downbound lane is the rush's ledger: failed prospectors, sold-out
  camps, auctioned wagons — and the Deep Hollow Cult's soup line from
  chapter 3C, now a rest tent, now three. A named cell contact
  (chapter-scoped) starts learning the party's names. Kindness first,
  always.
- **The Depot Stone** sits in a strongbox at the biggest of the rush depots,
  behind a clerk, a queue, and a bill of sale — the collection pursuit's
  first taste of what acquiring a facet costs when the holder is an
  institution rather than a drake.
- Skywarden supply patrols work the same roads (the foothills border the
  Plains; the citadel provisions by this country), rigid, honest, and
  requisitioning at fixed rates the rush considers theft and the wardens
  consider arithmetic. First warden contact on this road — a full chapter
  before the citadel.
- Openings by flag: `forded_clean` parties ride the queue's momentum north;
  `walked_over` parties fall in from the marsh's edge with the boggart clue
  in hand and no caravan, working passage — the weave's price and its
  dividend in one.

---

### Beat 5 — The Outline of the Truth

*Each road's evidence assembles into the same shape — the stones are older
than the mountain, and the land has been keeping records — and the party
faces the same decision: who do we tell? Then the road bends toward the
foothills.*

### 5A — The Broken Bridge *(River Road)*

**Where:** `biome.eastern_plains` north → `route.northern_river_bridge` →
foothills' eastern rim

The Northern River Bridge is cracked — tremor damage — and the Skywardens
have it: engineers triaging the spans, crossings rationed, a warden clerk
logging every gem that goes over westbound *and confiscating none of them*,
because the wardens don't yet know what the party is starting to know.

- The rush's wreckage flows back south past the queue: failed prospectors,
  sold-out camps, a cult recruiter working the line with soup and patience
  (first Deep Hollow contact on this road — kindness first, always).
- **The Clerk's Stone:** one logged gem crosses westbound with a tagged
  caravan while the party watches — the collection pursuit's cleanest
  possible mark and the reckoning pursuit's cleanest possible test, in the
  same pannier.
- **The outline scene:** the party's evidence — the troll's note, the bent
  pride routes, the spiraling sash-maps — against the warden engineers'
  tremor survey of the bridge. The cracks are not random either. Plotted,
  everything the party has seen since Bramblewood points the same direction:
  *the stones are older than the mountain, and the land knows it.* The
  chapter ends with the outline of the truth in the party's hands and a
  decision about who to tell — the wardens are *right there*, rigid,
  honest, and already talking in acceptable losses.
- Cross by ration, by favor, or by a griffin's shortcut nobody ratified;
  descend into the foothills from the northeast.

### 5B — MossHome and the High Paths *(Wild Road)*

**Where:** `location.mosshome` → foothills' western rim

The western route to the foothills, through the bigfoot capital the maps
don't agree on.

- **MossHome:** the bigfoot path archives — records of every route the Woods
  has moved since the eruption — line up with the marsh clue. Plotted on the
  archive table, the rerouting spirals around the fragment falls. The Woods
  is *flinching*. (This is the Wild Road's answer to the sash-map table and
  the relay-sing.)
- The unicorns' finding travels here with the party: the stones predate the
  mountain's name. The archivists can add depth: the paths remember a
  version of this flinch from long, long ago — the records that old are knots
  in cords, and the knots are worn smooth from handling.
- **The Confiscated Stone** is in the forest's pile — and the archivists
  know where the pile is, and will not say, and the knot-cord that redeems
  it (below) is issued to parties the record trusts. The Woods' ledger,
  cashing out.
- The chapter ends with the party, whatever their motive was in chapter 1,
  in possession of the truth's outline and a decision about who to tell —
  and MossHome's elders asking, mildly, to be told *second*, whoever is
  first.
- Exit east along the bigfoot high paths, down into the foothills from the
  west — with a MossHome runner's knot-cord in hand, redeemable in chapter 7
  for everything the forest confiscated.

### 5C — The Boundary Stones *(Rush Road)*

**Where:** `biome.plains` north → `biome.red_sky_foothills`, the southern
rim and the boundary-stone line

The caravan road is the foothills' front door, and the door has a line: the
boundary stones, older than the dragonlings, marking where gathering law
begins — and this season, for the first time in any tally, holding back a
crowd.

- The dragonling gate towns are running inspection at the stones —
  grandmothers, bells, and the one rule recited to every inbound pick:
  *take what the mountain drops, never pry at what it holds.* The rush
  queues, argues, and mostly does not listen. A dragonling party member is
  home, and home is having the worst season in the tallies.
- **The outline scene:** the party's evidence — the ford witch's tuned
  charm, the spiraling route-songs, the silent warrens — against the
  dragonlings' own records: the eruption tallies, and the Gemfall rhythm
  broken since the great eruption. The grandmothers add the piece no other
  road gets: the boundary stones were *here first* — standing before the
  first families came, already marking the same line gathering law marks
  now. The realm did not draw this border. It inherited it. Plotted,
  everything since Bramblewood points the same direction: *the stones are
  older than the mountain's name, and the land has always known.*
- **The Unassigned Stone:** the grandmothers keep one fresh-fallen facet
  with the list of caves that are never assigned to anyone — a list older
  than every grandmother on record. They are not hiding it. They are
  *keeping* it, and the difference is the scene.
- Optional beat, handled with care: a centaur guide can offer the party the
  **Shortcut** — the nine-generation hypothetical route through the
  foothills that no centaur alive believes in and no centaur alive will
  concede. It is real. Taking it buys a day against the clock and costs the
  road country its favorite argument; the guide asks only that the party
  never, ever say so.
- The chapter ends with the outline in hand and the decision about who to
  tell — and the grandmothers, who have been telling everyone for a
  thousand years, asking the party to make somebody finally *listen*.
- Exit north through the stones into the foothills from the south, with the
  rush around them and the citadel's silhouette ahead.

---

### 6 — Ashfall *(convergence)*

**Where:** `biome.red_sky_foothills` → `location.redspire_citadel` ·
**Beat:** The Whole Truth

All three roads arrive here, each by its own door — `route_river` parties
descend from the broken bridge in the northeast, `route_wild` parties come
off the high paths in the west, `route_rush` parties walk up the caravan
road through the boundary stones in the south — into the rush's ugly end:
claim disputes, broken gathering law, dragonling towns holding a line their
whole culture is built on against thousands of strangers with picks.

- Environmental wrongness, all through the creature lore: embermoths settling
  *away* from warmth; cinder wolf packs displaced onto roads (their dislike
  of the legend dragon's stirring, played straight: when it turns over,
  nobody eats); a glassback crab "gem deposit" incident the party can defuse
  by reading the threat display that prospectors cannot. This is the Seal
  Clock's stage one and two, taught in place.
- The Deep Hollow Cult is recruiting in the camps — by kindness, finding the
  rush's ruined and desperate before anyone else does. A named cell contact
  (chapter-scoped character) makes the cult's pitch in its own words: the
  world's laws are broken, the power beneath the mountain can rewrite them,
  and the seal is not protection, it is a *cage on the cure*.
- **Redspire Citadel:** the Skywardens' watch-logs plus the party's evidence
  assemble the whole truth on one table: *the gemstones are fragments of a
  seal; the seal holds a titan; the rush is dismantling it by hand.* The
  scene is authored to work with **any third of the evidence** — troll
  note, sash-maps, and bridge survey; or boggart hum, wounded glades, and
  path archive; or witch's charm, route-songs, and boundary-stone tallies —
  because the wardens' logs supply whatever the party didn't walk. (This is
  the campaign's own protected reveal, scoped by the `canon_note`; it says
  nothing about what the Hollow Gate is.) **The Table Stone** hums on the
  table throughout, logged twice, in warden custody.
- The wardens' rigid honesty cuts both ways — they confirm everything and
  immediately begin planning in terms of acceptable losses.
- **Exit — the party names what it wants.** Two choices, two flag axes,
  one scene:
  - *Who to tell:* align with the wardens' containment plan
    (`told_wardens`), work the dragonling gathering-law network instead
    (`told_gatherers`), or keep the truth close (`kept_close`).
  - *What for:* the scene reads the campaign back to the party — the facets
    in their pack, the glade mended or finished, the sprites' medal, the
    debts — and names the pursuit that conduct adds up to. Then it asks.
    The player affirms the reading or overrules it: put it back
    (`pursuit_restore`), finish the collection (`pursuit_hoard`), or take
    the leash (`pursuit_leash`). NPCs react in the room — and react again,
    differently, to a party declaring against its own record. History
    starts filing.

### 7 — The Gathering *(routed by pursuit)*

**Where:** `biome.red_sky_foothills` and the Plains roads below them ·
**Beat:** The Gathering

The chapter where five chapters of lore pay rent — **without retracing a
single mile of them.** The fragments are still *moving*: the rush never
stopped, gems are flowing along the realm's roads right now — to buyers,
depots, and camps — and every road north funnels through the Plains into
these foothills. The party doesn't go back down the campaign. The campaign
comes up the mountain to them. What they do at the confluence is the
pursuit; the geography, the callbacks, and the ending beat are shared.
Each pursuit is its own authored chapter file — `gemfall-07r` / `-07h` /
`-07l`, same index, same beat, different objectives, scenes, faction
behavior, and success conditions — selected by the pursuit flag exactly as
the road chapters are selected by the route flag.

**7R — The Returning** (`pursuit_restore`): the seal can still be thickened
if enough fragments come *back*, and the party stands at the funnel and
intercepts.

- **Faction plays, by chapter 6 flag:** warden checkpoints turn confiscatory
  overnight (`told_wardens` — effective, and ugly to watch); the dragonling
  towns turn gathering law inside out, intake becoming outtake, every
  gem-buyer in the camps suddenly facing polite, implacable sellers'
  remorse (`told_gatherers`); or the party runs private interceptions on
  their own credit and cunning (`kept_close` — hardest, freest).
- The cult runs the same confluence in reverse, gathering fragments to
  break the seal "properly, all at once, so it can be *fixed* properly."
  Rival interception scenes, not massacres: cells, masks, and people the
  party may have liked in chapter 6.

**7H — The Collection** (`pursuit_hoard`): the same funnel, worked from the
other side. The party is not intercepting the trade — they are *cornering*
it, racing warden confiscation, gatherer outtake, and cult acquisition to
the last facets on their list.

- **The Caravan Stone** rides the fattest caravan in the funnel, and every
  faction wants that caravan for its own reasons; the chapter's set piece is
  four agendas converging on one wagon at the north road's worst bend.
- The realm reads the party now: hedges slow, mosshorns leave, prides bend
  around their camp, the silence of the warrens travels with them. The
  collection is nearly complete, and the land treats them like weather.
- The cult offers, sweetly, to *buy*. The scene makes the arithmetic
  visible and lets them sell — see the decision tree below for exactly what
  that does and does not open up.

**The Collection's exits — one explicit decision tree.** The Collection is
the only pursuit with a fork of its own, and these are the only supported
paths out of 7H:

1. **Climb for the Keystone.** Enter chapter 8 with up to seven facets and
   intentions the dragon will ask about. Taking the Keystone is the Exploit
   ending. The dragon's questions can still turn a collector around — and
   Restore, at the cost of the entire collection, stays on the table to the
   last.
2. **Walk.** The Collection's authored exit ramp, and it lives *here*, at
   the end of 7H — not in chapter 8. The party turns south at the tree line
   with full pockets and does not climb; sets `walked_away`, the campaign
   ends, and the epilogue rolls from everything else: who they told, what
   the factions manage without them, where the clock stood when they turned
   around. Sometimes the wardens hold it. Sometimes the bell rings behind
   them. The campaign keeps its one promise either way: it never pretends
   they weren't warned. (A walking party never sees `gemfall-08`; there is
   no southbound chapter 8, only the epilogue.)
3. **Fund the break.** Selling to the cult is not a third exit — it is a
   knowing modifier on the other two. `funded_the_break` accelerates the
   Seal Clock hard, and every epilogue downstream of it is recolored: a
   party that funds the break and then walks is walking away from a fuse
   they lit, and the epilogue says so; a party that funds the break and
   then climbs meets a dragon that already knows. There is no supported
   path where selling to the cult resolves the campaign by itself — the
   ending still arrives via Walk, climb, or the clock running out.
4. **Hand it back.** Conduct keeps counting after the declaration: a
   Collection party that starts returning facets mid-chapter is drifting
   into the Returning, and the campaign lets the pursuit bend — the
   epilogue matrix reads the facets' final disposition, not the chapter 6
   speech.

**7L — The Tether** (`pursuit_leash`): brokerage. The wardens' cage doctrine
needs what the cult's resonance choirs know, and neither will sit at a table
— so the party becomes the table.

- Collect the instruments: a cage-doctrine ledger the wardens don't lend, a
  resonance chord the cult doesn't teach, and a witch's question — the ford
  witch's, for Rush Road parties, who has been waiting since chapter 3C for
  the answer: *what do you actually want?*
- Double games have prices: every instrument gained for the tether is a
  fragment or a friend not gathered for the seal. The clock does not care
  how clever the party is being.

**Callbacks ride in on their own legs — route-specific, consequences of the
road actually taken, in every pursuit:**

- *River Road:* Old Ossley poles upriver — nobody asks how — with a hold
  of "misplaced" stones and every toll the trolls have taken this season:
  *"stones want to go home; we only kept them until someone was going that
  way."* A centaur relay runs the sash-map network to reroute one fat gem
  caravan straight into the party's checkpoint — or, for a Collection
  party, past it, because the relay heard what they're for now. If
  `river_took_us`, this is also where Ossley's debt comes due — his price,
  as ever, not coin.
- *Wild Road:* a MossHome runner arrives with the knot-cord and a
  pack-train of everything the Woods confiscated from careless hunters.
  A boggart courier trades a catalogue of who bought what in the marsh —
  sidelong, in hints, for a really good overheard sentence. If the party
  walked careful in chapter 2, harvest-sprite favors resurface here,
  small and unexplained to the last.
- *Rush Road:* the ford witch arrives with the queue's stragglers and her
  wool-wrapped stone, still asking her question. The relay-sing's new verses
  reach the foothills ahead of the caravans they describe — the party can
  hear tomorrow's traffic tonight, an interceptor's (or collector's) dream.
  And the grandmothers send down the Unassigned Stone's list, which turns
  out to be exactly the list of places a seal's keeper would never let
  anyone dig.
- *All roads:* whatever the party themselves sold in chapter 1 comes back
  north on an Exchange buyer's caravan bound for the camps — the Ember
  Facet, at rush prices, from a merchant who remembers them fondly.

**The shared ending, every pursuit:** tremors escalate on a chapter-long
clock. Embermoths have left the foothills entirely — Seal Clock stage
three, and stage four is a bell nobody will name. The last scene is the
ground refusing to stay still, and the party walking up the mountain
everyone else is finally running away from — to give the stones back, to
take the last one, or to put a leash on what wakes. One authored exception:
a Collection party that takes the Walk turns south instead, and their
campaign ends at this chapter's edge, epilogue rolling. For everyone else,
the mountain does not care why they came. The mountain is about to.

### 8 — Gemfall

**Where:** `location.mount_red_sky`, interior · **Beat:** Gemfall

The titan begins to wake. The mountain's lava tubes and gem-veined galleries
are the campaign's only true dungeon, and at the bottom of them is the seal —
and its keeper.

- **The legend dragon.** Per canon it may warn, test, or bargain before it
  attacks, and which one is a fact about the individual: *this* individual
  has been the seal's keeper for longer than the realm has had that name, and
  its lore is played to the letter — it notices everything, forgets nothing,
  and asks the party questions it already knows the answers to. The final
  approach is a conversation encounter that can fail into a fight, not a
  fight with dialogue options. The questions are the campaign's ledger read
  aloud: the sprites' medal, the glade, the ford, the soup line, the facets.
  The dragon grades generously when surprised. It is very rarely surprised.
- **The choice.** With the seal exposed and the titan surfacing beneath it:
  - **Restore** — return the recovered fragments; costs the party every gem
    they have, including the personal stakes from chapter 1 motives — and
    for a Collection party that climbs anyway, the whole collection, which
    is the most expensive sentence in the campaign.
  - **Destroy** — end the titan rather than cage it; the realm keeps its
    treasure and loses whatever the titan *was*, which the campaign has
    deliberately never shown as simply a monster.
  - **Control** — the Tether, cashed in: hand the power to a faction
    (wardens' cage, cult's cure) and the epilogue belongs to them — or hold
    the leash themselves, and the realm gains a new fixed point history is
    not sure what to call.
  - **Exploit** — take the Keystone. The collection is complete; the rush
    wins; the party is rich, and the red sky is no longer the realm's
    strangest weather.

  (There is no Walk choice here: the Walk is the Collection's exit at the
  end of chapter 7H, and a party that took it never enters the mountain.
  Everyone standing in the seal chamber climbed on purpose.)
- **Losing, here at the end:** enter with a spent clock and empty hands and
  the mountain is already answering — see **Turned Back** and **The Last
  Ring** above. The Tether can still shatter in the seal chamber — see
  **The Broken Tether**. Every loss is an authored epilogue, child-hero
  tone, realm enduring, spark left burning.
- **Epilogue matrix** reads the chapter-1 motives, the pursuit, the facet
  count, the ally flags, and the final choice — including the Walk taken
  back in 7H — and history files the party accordingly. Named epilogue
  families: **Heroes of Red Sky** (restore/destroy, clock beaten); **The
  Quiet Fixers** (restore, `kept_close`, no one ever knows); **The
  Collectors** (Walk or Exploit, realm holds); **The Ones Who Weren't
  There** (Walk, realm doesn't); **The Wardens' Regret** / **The Cure**
  (control, by faction); **The New Weather** (self-held tether); **The Last
  Ring** / **Turned Back** / **The Broken Tether** (losses). The treasure
  hunters who woke the mountain — or the ones who put it back to sleep.
  Decided by play, not by the script.

## Build order

The whole thing does not need building now. The intended sequence:

1. `content/campaigns/gemfall.json` + `gemfall-01` (Exchange chapter) as the
   first authored chapter, following the `bramblewood-01` scene-graph shape.
2. **The route-variant pipeline extension**, before any paired chapter is
   authored. Today `campaign.schema.json` + `tools/content/validate.mjs`
   require chapter indexes to run 1..n uniquely, and a chapter carries a
   single `biome` (it drives backdrop, palette, and music) — so a route
   triple like 3A/3B/3C cannot live in one chapter file. The smallest honest
   change: let chapter files share an index when each declares a distinct
   `routeFlag`, have the loader pick the member matching the party's flag,
   and teach the validator that a routed index is complete only when every
   declared route has a member. Chapter 7's variants are separate files
   using the same mechanism keyed on the pursuit flag — Returning,
   Collection, and Tether have different objectives, scenes, faction
   behavior, and success conditions, so they are chapter variants, not one
   oversized scene graph. Sixteen files, eight indexes:
   `gemfall-01`, `-02`, `-03a/-03b/-03c`, `-04a/-04b/-04c`,
   `-05a/-05b/-05c`, `-06`, `-07r/-07h/-07l`, `-08`. (`-07h` carries the
   Walk exit and its epilogue hand-off; there is no `-08` variant for
   walkers because walkers never reach chapter 8.)
3. Chapters 3A + 3B + 3C as the first authored triple — they exercise the
   route selection, the in-route flag passing (`crossed_dry` /
   `river_took_us`), and the cross-route weave (`marsh_kept_us` set from 3C
   landing the party in 4B) that everything downstream depends on.
4. The remaining triples (4A/4B/4C, 5A/5B/5C), then the convergence (6), the
   gathering triple (7R/7H/7L), and the mountain (8), with the Seal Clock
   and facet flags landing alongside 6 and 7.

Wiki page: `wiki/content/campaigns/gemfall.md` carries the reader-facing
version of this outline as handwritten content above the generated sections.
