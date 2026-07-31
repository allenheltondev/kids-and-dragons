# Gemfall — campaign design brief

**Canon id:** `campaign.gemfall` · **Chapters:** 8 story beats (11 authored
chapter files — see [Routes](#routes)) · **Status:** `newly_defined`

A violent eruption from Mount Red Sky scatters powerful gemstones across the
realm, launching the largest treasure rush in living memory. The player runs a
party of three adventurers, each drawn by a different motive — wealth,
curiosity, prestige, duty, survival, the chance to prove something. None of
them begins as a chosen hero. They are simply trying to reach the Gemfall
before everyone else, and the campaign is the story of them finding out what
they were actually racing toward.

The map already knows this story: Mount Red Sky's label reads *"Source of the
Gemfalls, and restless power."*

## The spine, and the one big secret

The gemstones are not volcanic treasure. They are fragments of an ancient seal
holding a titan dormant beneath Mount Red Sky, and every stone carried away
weakens it. The campaign is a treasure hunt for five chapters and a race to
undo a treasure hunt for three.

> **Canon scope:** the titan and the seal are campaign-scoped mysteries
> (`canon_note` on `campaign.gemfall`). Nothing in this brief opens the Hollow
> Gate, populates the Expanse, or names a legend dragon — those stay protected.
> What the campaign lets the party *observe* about the Hollow Gate: its runes
> hum the same note the gemstones hum, the marsh's disturbances run densest
> near it, and it feels older than everything around it — older than the
> modern world. What the Gate *is* — a seal, a doorway, a warning, or
> something else entirely — is never established, by any scene, in any
> branch. Characters may theorize; the campaign confirms nothing.

## Routes: fixed beats, branching country

The reviewers' campaign model, stated plainly: **the story beats are fixed;
the geography is not.** Chapter indexes stay contiguous for the content
pipeline, but chapters 3–5 exist as *paired route variants* — one pair member
per route, same index, same story beat, different country. A playthrough
tours eight chapters; the corpus holds eleven.

At the end of chapter 2 the party chooses at Bramblewood:

- **The River Road** (`route_river`) — east and then north: the Sunward road
  to **Stone Crossing**, across the Great River into the **Eastern Plains**,
  north along the pride routes to the **Northern River Bridge**, and over
  into the foothills. Open country, road people, the realm's traffic laid
  bare.
- **The Wild Road** (`route_wild`) — west and then north: into the
  **Whispering Marsh**, over the river's west branch into the **Enchanted
  Woods**, through **MossHome**, and east along the bigfoot high paths into
  the foothills. Closed country, old country, the realm's memory laid bare.

Both roads deliver the same three beats — **The Toll** (ch. 3), **The Country
That Noticed** (ch. 4), **The Outline of the Truth** (ch. 5) — and converge
in chapter 6 at the foothills. Each route carries its own half of the
evidence, and chapter 6's truth-table scene is authored to work with either
half. Neither route is the "real" one; neither is a detour.

**Echoes:** each road hears the other. Rumors, relay-running centaurs, wisp
gossip, and rush traffic carry garbled news of the country the party didn't
choose — so the unseen route is a living place (and a reason to play again),
never a dead file.

### River geography (per `canon/geography.yaml`)

The branching must respect the rivers, because both signature failures are
rivers doing what rivers do:

- The **Great River main channel** runs north→south, east of the central
  mainland. **Stone Crossing** sits on it, connecting the Sunward Fields to
  the Eastern Plains. Downstream from the crossing is *south*, toward the
  river mouth by the Bone Yard's edge. A failure at Stone Crossing carries
  the party downstream on the main channel — it cannot reach the marsh.
- The **west branch** forks away toward the Whispering Marsh and the western
  sea, separating the Plains from the southern lands. The marsh-sweep
  failure lives *here*, on the Wild Road's attempted crossing — where the
  downstream current genuinely runs into marsh country.

## How failure works

Per the brief and `standard_behavior`: **failure reroutes, it never stops the
campaign.** Each route has a signature crossing, and each failure is an
entrance somewhere real, not a retry:

- **River Road, Stone Crossing (ch. 3):** fail the crossing and the main
  channel sweeps the party downstream — fished out, soaked and toll-less, on
  the *eastern* shore near the river mouth, with the Bone Yard on the skyline.
  They enter the Eastern Plains by the wet southern door (`river_took_us`)
  instead of the dry one (`crossed_dry`).
- **Wild Road, the west branch (ch. 4):** fail the ford at the marsh's
  northern edge and the branch carries the party west toward the sea before
  the channels let go. They enter the Enchanted Woods late, by the flooded
  western paths near MossHome (`marsh_kept_us`) instead of the southeastern
  glades (`forded_clean`).

What branches beyond that is *how each chapter begins*, via flags carried
forward from the previous one.

### Flag summary

| Flag | Set | Read |
| --- | --- | --- |
| `motive_*` (one per member) | ch. 1 | ch. 8 epilogue matrix |
| `route_river` / `route_wild` | ch. 2 exit | selects 3–5 variants; ch. 6 opening; ch. 7 callbacks |
| `crossed_dry` / `river_took_us` | ch. 3 (River Road) | ch. 4A opening, Ossley's debt beat |
| `forded_clean` / `marsh_kept_us` | ch. 4 (Wild Road) | ch. 4B/5B openings |
| `told_wardens` / `told_gatherers` / `kept_close` | ch. 5–6 exit | ch. 7 allies and depots |

## The party

Three adventurers from the six playable species, chosen at start. Species
choices pay off where the lore says they should — and because the middle is
routed, party composition gives the two roads different textures. **No
species is required by either route**; every gate has a patience-or-cleverness
alternative.

Shines on the **River Road**:

- A **manticore** is *coming home*: the Eastern Plains are the pride lands,
  and professional courtesy with centaurs and stone trolls is old (ch. 3A,
  4A).
- A **griffin** carries messages ahead and spots trouble from altitude —
  open country is made for it (ch. 3A, 4A, 5A).

Shines on the **Wild Road**:

- A **kitsune** hears what the marsh and the boggarts are not saying (ch. 3B)
  and has opinions about the mire mimic's technique.
- A **unicorn** feels the wounded glades and the wisps (ch. 3B, 4B).
- A **bigfoot** can read MossHome's path records (ch. 5B) and notice what
  everyone else missed (everywhere).

Shines everywhere:

- A **dragonling** knows gathering law and reads embermoths (ch. 2, 6, 8) —
  and embermoths are misbehaving over *both* roads.

## Chapters

### 1 — The City That Smelled Opportunity

**Where:** `location.exchange` · **Tone:** gold-rush overture

Mount Red Sky erupts in the opening scene — felt in the Exchange as a red
glow on the horizon, a rain of gem-light over the foothills, and then, within
days, a stampede. Merchants, scholars, mercenaries, pilgrims, and thieves pour
into the neutral city where every road, ship, and rumor converges.

- Build the party: pick three, each with a motive (wealth / curiosity /
  prestige / duty / survival / proving themselves). Motive is a flag the
  epilogue reads back.
- Scenes: dockside rumor-trading, outfitting (`item.quickfoot_lace` vendors
  doing brisk trade), a scholar who insists the "gem-light fell *upward* for a
  moment" and is laughed out of the tavern (first foreshadow).
- Exit: sign on with a caravan heading north through the Sunward Fields.
- **No combat.** The Exchange chapter is people, prices, and promises — the
  city's `population_rule` (no native or dominant people) on full display.

### 2 — Green Roads North

**Where:** `biome.sunward_fields` → `location.bramblewood`

The rush hits the realm's food supply first. Caravans trample fields, prices
spike, and the fauns' work-songs keep stopping mid-verse — which every
Sunward child knows means *someone has seen something worth stopping for*.

- Faun cooperatives ask for help re-routing a caravan around an unharvested
  field; harvest sprites (who dislike exactly nobody's crops being trampled)
  reward careful stewardship — the party that walks the rows instead of
  through them gets small unexplained favors for the rest of the chapter.
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
  two credible boasts: the crossing queue is moving again (east), and the
  frogfolk are still ferrying those they like (west). Choosing sets
  `route_river` or `route_wild`, and the campaign genuinely goes where the
  party points it: two different chapters 3, 4, and 5, converging in the
  foothills. The Exchange's rumor mill seeds both honestly — neither is
  advertised as a shortcut, because neither is.

---

### Beat 3 — The Toll

*The land starts charging for passage, and the first true clue lands: the
stones hum an old, old note. On the River Road a stone troll hears it through
a palm on the bridge; on the Wild Road a boggart hears it in a collection
bag. Different listeners, same note.*

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
  and it is *thriving*. Resolutions per canon: name it, or stamp it off its
  patch. A kitsune party member is personally offended by the performance.
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
- Exit: north, toward the west branch and the tree line beyond it.

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
  (the Woods' mosshorns, played in open country).
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
  paths near MossHome. The forest does not care which door they used. It
  cares about their ledger.
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
  that name.
- Quietly planted for chapter 7: the paths that closed on gem-pocketing
  hunters did not just *close*. The Woods has been confiscating. Somewhere,
  the forest is keeping a pile.

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
  is *flinching*. (This is the Wild Road's answer to the sash-map table.)
- The unicorns' finding travels here with the party: the stones predate the
  mountain's name. The archivists can add depth: the paths remember a
  version of this flinch from long, long ago — the records that old are knots
  in cords, and the knots are worn smooth from handling.
- The chapter ends with the party, whatever their motive was in chapter 1,
  in possession of the truth's outline and a decision about who to tell —
  and MossHome's elders asking, mildly, to be told *second*, whoever is
  first.
- Exit east along the bigfoot high paths, down into the foothills from the
  west — with a MossHome runner's knot-cord in hand, redeemable in chapter 7
  for everything the forest confiscated.

---

### 6 — Ashfall *(convergence)*

**Where:** `biome.red_sky_foothills` → `location.redspire_citadel`

Both roads arrive here, by opposite rims — `route_river` parties descend from
the broken bridge in the northeast, `route_wild` parties come off the high
paths in the west — into the rush's ugly end: claim disputes, broken
gathering law, dragonling towns holding a line their whole culture is built
on — *take what the mountain drops, never pry at what it holds* — against
thousands of strangers with picks.

- Environmental wrongness, all through the creature lore: embermoths settling
  *away* from warmth; cinder wolf packs displaced onto roads (their dislike
  of the legend dragon's stirring, played straight: when it turns over,
  nobody eats); a glassback crab "gem deposit" incident the party can defuse
  by reading the threat display that prospectors cannot.
- The Deep Hollow Cult is recruiting in the camps — by kindness, finding the
  rush's ruined and desperate before anyone else does. A named cell contact
  (chapter-scoped character) makes the cult's pitch in its own words: the
  world's laws are broken, the power beneath the mountain can rewrite them,
  and the seal is not protection, it is a *cage on the cure*.
- **Redspire Citadel:** the Skywardens' watch-logs plus the party's evidence
  assemble the whole truth on one table: *the gemstones are fragments of a
  seal; the seal holds a titan; the rush is dismantling it by hand.* The
  scene is authored to work with **either half of the evidence** — troll
  note, sash-maps, and bridge survey, or boggart hum, wounded glades, and
  path archive — because the wardens' logs supply whichever half the party
  didn't walk. (This is the campaign's own protected reveal, scoped by the
  `canon_note`; it says nothing about what the Hollow Gate is.)
- The wardens' rigid honesty cuts both ways — they confirm everything and
  immediately begin planning in terms of acceptable losses.
- Exit choice (flags for 7–8): align with the wardens' containment plan
  (`told_wardens`), work the dragonling gathering-law network instead
  (`told_gatherers`), or keep the truth close (`kept_close`).

### 7 — The Confluence

**Where:** `biome.red_sky_foothills` and the Plains roads below them

The chapter where five chapters of lore pay rent — **without retracing a
single mile of them.** The seal can still be thickened if enough fragments
come *back*, and here is the thing the party knows that no faction does: the
fragments are still *moving*. The rush never stopped. Gems are flowing along
the realm's roads right now — to buyers, to depots, to camps — and every
road north funnels through the Plains into these foothills. The party
doesn't go back down the campaign. The campaign comes up the mountain to
them, and they stand at the confluence and *intercept*.

- **The funnel:** `biome.plains` — the realm's road country — is where the
  intercepts happen: caravan queues, waystation ledgers, a rush's worth of
  traffic compressible to a handful of set pieces on the north roads.
- **Faction plays, by chapter 6 flag:** warden checkpoints turn confiscatory
  overnight (`told_wardens` — effective, and ugly to watch); the dragonling
  towns turn gathering law inside out, intake becoming outtake, every
  gem-buyer in the camps suddenly facing polite, implacable sellers'
  remorse (`told_gatherers`); or the party runs private interceptions on
  their own credit and cunning (`kept_close` — hardest, freest).
- **Callbacks ride in on their own legs — route-specific, consequences of
  the road actually taken:**
  - *River Road:* Old Ossley poles upriver — nobody asks how — with a hold
    of "misplaced" stones and every toll the trolls have taken this season:
    *"stones want to go home; we only kept them until someone was going that
    way."* A centaur relay runs the sash-map network to reroute one fat gem
    caravan straight into the party's checkpoint. If `river_took_us`, this
    is also where Ossley's debt comes due — his price, as ever, not coin.
  - *Wild Road:* a MossHome runner arrives with the knot-cord and a
    pack-train of everything the Woods confiscated from careless hunters.
    A boggart courier trades a catalogue of who bought what in the marsh —
    sidelong, in hints, for a really good overheard sentence. If the party
    walked careful in chapter 2, harvest-sprite favors resurface here,
    small and unexplained to the last.
  - *Both roads:* whatever the party themselves sold in chapter 1 comes back
    north on an Exchange buyer's caravan bound for the camps — and must be
    awkwardly re-acquired at the depot, at rush prices, from a merchant who
    remembers them fondly.
- The cult is running the same confluence in reverse, gathering fragments to
  break the seal "properly, all at once, so it can be *fixed* properly."
  Rival interception scenes, not massacres: cells, masks, and people the
  party may have liked in chapter 6.
- Tremors escalate on a chapter-long clock. Embermoths have left the
  foothills entirely. The last scene is the ground refusing to stay still,
  and the party walking up the mountain everyone else is finally running
  away from.

### 8 — Gemfall

**Where:** `location.mount_red_sky`, interior

The titan begins to wake. The mountain's lava tubes and gem-veined galleries
are the campaign's only true dungeon, and at the bottom of them is the seal —
and its keeper.

- **The legend dragon.** Per canon it may warn, test, or bargain before it
  attacks, and which one is a fact about the individual: *this* individual
  has been the seal's keeper for longer than the realm has had that name, and
  its lore is played to the letter — it notices everything, forgets nothing,
  and asks the party questions it already knows the answers to. The final
  approach is a conversation encounter that can fail into a fight, not a
  fight with dialogue options.
- **The choice.** With the seal exposed and the titan surfacing beneath it:
  - **Restore** — return the recovered fragments; costs the party every gem
    they have, including the personal stakes from chapter 1 motives.
  - **Destroy** — end the titan rather than cage it; the realm keeps its
    treasure and loses whatever the titan *was*, which the campaign has
    deliberately never shown as simply a monster.
  - **Control** — hand the power to a faction (wardens' cage, cult's cure);
    the epilogue belongs to them.
  - **Exploit** — take it; the rush wins; the party is rich, and the red sky
    is no longer the realm's strangest weather.
- Epilogue matrix reads the chapter-1 motives plus the final choice, and
  history files the party accordingly: **Heroes of Red Sky**, or the
  treasure hunters who woke the mountain.

## Build order

The whole thing does not need building now. The intended sequence:

1. `content/campaigns/gemfall.json` + `gemfall-01` (Exchange chapter) as the
   first authored chapter, following the `bramblewood-01` scene-graph shape.
2. **The route-variant pipeline extension**, before any paired chapter is
   authored. Today `campaign.schema.json` + `tools/content/validate.mjs`
   require chapter indexes to run 1..n uniquely, and a chapter carries a
   single `biome` (it drives backdrop, palette, and music) — so a route pair
   like 3A/3B cannot live in one chapter file. The smallest honest change:
   let two chapter files share an index when each declares a distinct
   `routeFlag`, have the loader pick the member matching the party's flag,
   and teach the validator that a routed index is complete only when every
   declared route has a member. Eleven files, eight indexes:
   `gemfall-01`, `-02`, `-03a/-03b`, `-04a/-04b`, `-05a/-05b`, `-06`, `-07`,
   `-08`.
3. Chapters 3A + 3B as the first authored pair — they exercise both the
   route selection and the in-route flag passing (`crossed_dry` /
   `river_took_us`) everything downstream depends on.
4. The remaining pairs (4A/4B, 5A/5B), then the convergence (6), the
   confluence (7), and the mountain (8).

Wiki page: `wiki/content/campaigns/gemfall.md` carries the reader-facing
version of this outline as handwritten content above the generated sections.
