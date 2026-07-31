# Gemfall — campaign design brief

**Canon id:** `campaign.gemfall` · **Chapters:** 8 · **Status:** `newly_defined`

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
> The connection this campaign draws is: *the seal predates the volcano, and
> the world has other old seals* (the Hollow Gate is one). It implies; it does
> not resolve.

## How failure works

Per the brief and `standard_behavior`: **failure reroutes, it never stops the
campaign.** The signature example is Stone Crossing — a failed crossing sweeps
the party down the west branch into the Whispering Marsh instead of retrying
the bridge. The chapter order below is fixed (the content pipeline requires
contiguous chapter indexes); what branches is *how each chapter begins*, via
flags carried forward from the previous one.

## The party

Three adventurers from the six playable species, chosen at start. Species
choices pay off exactly where the lore says they should:

- A **dragonling** knows gathering law and reads embermoths (ch. 2, 6, 8).
- A **unicorn** feels the wounded glades and the wisps (ch. 4, 5).
- A **bigfoot** can read MossHome's path records (ch. 5) and notice what
  everyone else missed (everywhere).
- A **kitsune** hears what the marsh and the boggarts are not saying (ch. 4)
  and has opinions about the mire mimic's technique.
- A **griffin** carries messages ahead and spots trouble from altitude
  (ch. 3, 6, 7).
- A **manticore** gets professional courtesy from centaurs, trolls, and every
  road-person between here and the mountain (ch. 3, 7).

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
- Exit choice: the direct Plains route toward Stone Crossing, or west toward
  the Enchanted Woods. Either way the campaign passes through chapters 3–5;
  the choice sets which side of the story the party hears first and the flags
  each chapter opens with.

### 3 — The Long Mile

**Where:** `biome.plains` → `location.stone_crossing` (`route.stone_crossing`)

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
- `individual.old_ossley` ferries when the stones are under — his price is
  never coin. What he asks each party member is a character beat.
- **Branch:** succeed and the party crosses; word arrives that the northern
  bridge (`route.northern_river_bridge`) is closed by tremor damage, and
  every eastern route to the foothills now runs back west — sets flag
  `crossed_dry`. Fail, and the river sweeps the party down the west branch
  (`feature.great_river_west_branch`) into the marsh — sets flag
  `river_took_us`. **Both flags lead to chapter 4.** A failed crossing is an
  entrance, not a retry.

### 4 — What the Marsh Remembers

**Where:** `biome.whispering_marsh` → `location.hollow_gate`

Opens differently by flag: swept in soaked and boatless (`river_took_us`), or
poling in deliberately because Marda's rumor board pointed here
(`crossed_dry`). Either way, the marsh since the eruption is *louder*.

- The frogfolk have closed channels — not around danger, but around **new
  wisps**. Memories are tangling into lights at many times the usual rate,
  and nobody local will say the obvious out loud: something is leaking.
- The boggarts know what the gems sound like. One will trade the fact —
  sidelong, in hints, for something the party is carrying anyway — that the
  stones *hum*, and that the hum is the same note the Hollow Gate runes make.
  (A boggart's whole culture of listening to lost things pays the campaign's
  first real clue.)
- Encounter: a mire mimic has spent three weeks being an abandoned gem barge,
  and it is *thriving*. Resolutions per canon: name it, or stamp it off its
  patch. A kitsune party member is personally offended by the performance.
- Wisp scene: a wisp leads toward the Hollow Gate. Following with patience
  (or a please — nobody has ever said please to a wisp) earns the sight
  rather than the trap version.
- **The Hollow Gate:** runes glowing brighter than any living witness has
  seen. The revelation, delivered by witness and not by lecture: *the world
  has seals, the seals predate the red sky, and the Gemfall is behaving like
  one of them coming apart.* The Gate itself cannot and does not open —
  constraint preserved. Optional: a `item.hollow_crown_shard` turns up, hums
  once at the party's gem-dust-covered boots, and goes silent.

### 5 — The Forest Takes Attendance

**Where:** `biome.enchanted_woods` → `location.mosshome`

The western route to the foothills. The Woods have been redirecting careless
treasure hunters for weeks — parties that damaged glades on the way in are
finding that the way out has opinions.

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
- **MossHome:** the bigfoot path archives — records of every route the Woods
  has moved since the eruption — line up with the marsh clue. Plotted on the
  archive table, the rerouting spirals around the fragment falls. The Woods
  is *flinching*. Chapter ends with the party, whatever their motive was in
  chapter 1, in possession of the truth's outline and a decision about who
  to tell.

### 6 — Ashfall

**Where:** `biome.red_sky_foothills` → `location.redspire_citadel`

The foothills are the rush's ugly end: claim disputes, broken gathering law,
dragonling towns holding a line their whole culture is built on — *take what
the mountain drops, never pry at what it holds* — against thousands of
strangers with picks.

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
  (marsh hum, forest archive, moth behavior) assemble the whole truth on one
  table: *the gemstones are fragments of a seal; the seal holds a titan; the
  rush is dismantling it by hand.* The wardens' rigid honesty cuts both ways
  — they confirm everything and immediately begin planning in terms of
  acceptable losses.
- Exit choice (flags for 7–8): align with the wardens' containment plan, work
  the dragonling gathering-law network instead, or keep the truth close.

### 7 — The Race Back Up the Mountain

**Where:** `biome.red_sky_foothills`, realm-wide callbacks

The chapter where five chapters of lore pay rent. The seal can still be
thickened if enough fragments come *back* — and the party knows, better than
any faction, where gems have gone: sold, hoarded, swallowed, tolled, and
collected, all the way back down their own road.

- Recovery beats built on established opinion edges: the river drake's hoard
  shelf (it can be bargained with — it *learns routines*); a boggart
  collection (traded sidelong, for stories of where each stone has been); the
  mire mimic that ate a prospector's satchel; Marda Thorn's lost-and-found in
  Bramblewood; whatever the party themselves sold in chapter 1 and must now
  awkwardly re-acquire.
- The cult is running the same race in reverse, gathering fragments to break
  the seal "properly, all at once, so it can be *fixed* properly." Rival
  recovery scenes, not massacres: cells, masks, and people the party may have
  liked in chapter 6.
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
2. Chapters 2–3 next — they exercise the flag-passing (`crossed_dry` /
   `river_took_us`) the campaign's branching depends on.
3. The marsh/forest/foothills middle in canon order, then the mountain.

Wiki page: `wiki/content/campaigns/gemfall.md` carries the reader-facing
version of this outline as handwritten content above the generated sections.
