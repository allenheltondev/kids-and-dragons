# Riftlight route slice: implementation and continuity review

This slice extends the prologue through the first nonlinear routes. There are **12 authored
story nodes**, **23 edges** and **five development pause endings** in the preview. The new
chapters add 78 story scenes and five pause scenes (163 scenes overall including the original
80). The six arrival episodes are deliberately short; they are not completed regional strands.

## What is playable

- **Shelf traverse:** inspect the broken path, choose a high/low or ability-assisted line,
  and reach the Cairnstep or fall into the washout. Both outcomes are chapter successes.
- **Hidden glacier opening:** follow a separate ticking passage, test the chime or light,
  and sing the learned note or return to camp. This is separate from the hall seam and the
  protected summer crevasse. No diagnostic colors appear in shared narration.
- **Washout:** Might TN 16 at the ledge; Quick TN 12 with everyone rolling at the tree;
  then the optional unknown rift; finally Quick or Heart TN 12 near Ashspan Bridge.
  Species options lower one TN step through an explicitly cooperative task.
- **Arrival episodes:** Frostfang shore leads uphill to the Cairnstep. The stones and
  Ashspan Bridge connect by road; Ossley's ferry reaches the Saltrot. The Cairnstep offers
  a griffin flight to the Sky Islands. The Saltrot rift can return to the glacier.
- **First regional teaching:** Seren and Pip are introduced on either regional arrival.
  The first lesson earns Attune as journey state; later arrivals acknowledge that lesson.

The river's rift appears after the failed tree escape and before the rapids. Its sensory
glimpse is thin air and distant song, never a destination name. The chime warns that no
return can be counted on. All river destinations remain on the approved east bank or
pass through this explicit rift. No washout drifts to the Saltrot or the Bone Yard.

## Guarantees and engine support

Each shelf ending unconditionally sets one ice-shelf route member. Each washout ending
unconditionally sets one river-exit member. Normal endings always pay 140 XP once, with no
new bonus objectives; pauses pay zero. Failed river stages deal one damage with
`nonlethal: true`: standing characters stay at least at 1 HP, and downed characters are
never revived by damage. Ordinary story damage retains its existing behavior. The rescue
heals and grants a supper bundle; no items are lost.

The graph lint records the disjunction of flags unconditionally set by terminal onEnter
effects. It removes the impossible completion where a route chapter sets none of them;
other flag writes remain conservatively explored. A later clear of the same flag defeats
the guarantee. The synthetic journey driver honors both this guarantee and route-set
exclusivity, including after a replayed edge enters a route chapter.

Both glacier rift mouths are linked, persistent, hidden until crossed, and wake on the
sung-note flag. Their first-crossing-only Riftspark grant is shared across the pair: a
spent spark cannot be farmed by returning. Attune is capped at its first teaching state
until future convergence content is authored.

The Saltrot remains `sallow_wastelands`, not a renamed marsh or Stone Crossing. Its
background-only art contract is accepted only for chapters without encounters and with
explicit art on every scene. Ashspan Bridge uses the Eastern Plains bank; it is not
Stone Crossing. Existing scene art is reused; no new art assets were generated.

## Testing and unfinished work

The content gate validates the staged preview alongside shipped content. The graph walk
covers its nodes/edges and keeps an ending reachable. Real-engine chapter walkers cover
all new scenes, class/species routes, and three-person river parties starting at 1–3 HP.
The linked return is tested after the initial spark has been spent. The independent name
sweep covers the entire preview. The explicit dependency ledger below covers all added
scenes; it is author-reviewed, not an automatic proof of arbitrary prose.

The [family pacing gate](opening-playtest.md) remains unpassed. No measured play times are
claimed. The chapter budgets and short arrivals need real-table review. The next work is
stone-counters, whale-road and buried-bridge substance, then the other regional nodes and
full-campaign XP/revisit acceptance. Never copy the five pause endings into production.

## Added scene ledger

Prerequisites below are carried observations or introductions made in the current scene.
Conditional entry variants are also checked by the proper-name graph sweep.

### riftlight-ice-shelf-traverse

Entry facts: hall, great_river, frostfang, cairnstep, rope.

| Scene | Requires | Introduces |
| --- | --- | --- |
| `shelf` | hall, great_river, frostfang | shelf, gap |
| `inspect` | shelf, gap, rope | rocks, low_lip |
| `high` | rocks, rope | — |
| `low` | low_lip, rocks, rope | — |
| `brace` | rocks, rope | — |
| `wing` | gap, rope | — |
| `cross` | shelf | — |
| `assisted` | rope, shelf | — |
| `across` | rope | cairns |
| `rest_safe` | great_river, cairnstep, cairns | — |
| `fall` | shelf, rope, great_river | river_ledge |
| `rest_river` | rope, river_ledge | — |

### riftlight-hidden-glacier-rift

Entry facts: hall, seam, learned_note, listening_chime.

| Scene | Requires | Introduces |
| --- | --- | --- |
| `search` | hall, seam | passage |
| `passage` | passage | glacier_opening, coast_glimpse |
| `chime` | glacier_opening, listening_chime | — |
| `read` | glacier_opening | — |
| `listen` | glacier_opening, learned_note | — |
| `decide` | hall, seam, learned_note, glacier_opening | — |
| `sing` | learned_note, glacier_opening | — |
| `test_open` | glacier_opening, listening_chime | — |
| `ready` | glacier_opening, hall, coast_glimpse | — |
| `leave` | passage, hall | — |

### riftlight-headwaters-washout

Entry facts: great_river, frostfang, rope, listening_chime.

| Scene | Requires | Introduces |
| --- | --- | --- |
| `current` | rope, frostfang | river_ledge |
| `ledge` | river_ledge, rope | — |
| `grab` | river_ledge, rope | — |
| `smash` | river_ledge, rope | — |
| `lift` | river_ledge, rope | — |
| `early` | frostfang, rope | — |
| `tree` | rope | tree, boundary_stones |
| `tree_choice` | tree, rope | — |
| `climb` | tree, rope | — |
| `guide` | tree, rope | — |
| `call` | tree, rope | — |
| `middle` | boundary_stones | — |
| `rift` | rope | river_rift, sky_glimpse, rapids |
| `rift_choice` | river_rift, listening_chime | — |
| `river_chime` | river_rift, listening_chime | — |
| `river_read` | river_rift, sky_glimpse | — |
| `rift_decision` | river_rift, rope | — |
| `rift_end` | river_rift, rope, sky_glimpse | — |
| `rapids` | rope | bridge, gravel, boat |
| `swim` | gravel, rope | — |
| `signal` | boat | — |
| `mend_signal` | boat | — |
| `late` | boat, bridge | ossley, ashspan |
| `rescue` | boat, rope | ossley, blanket |
| `rescued` | ossley, boat, bridge | ashspan, supper_bundle |

### riftlight-frostfang-shore

Entry facts: rope, frostfang, cairnstep.

| Scene | Requires | Introduces |
| --- | --- | --- |
| `bank` | frostfang | shore_griffin |
| `help` | shore_griffin | ladder |
| `ladder` | ladder, shore_griffin | — |
| `climb` | ladder, cairnstep, rope | — |

### riftlight-cairnstep-pass

Entry facts: cairnstep, herder, grazing_route.

| Scene | Requires | Introduces |
| --- | --- | --- |
| `cairns` | cairnstep | keeper, ledger |
| `ledger` | keeper, ledger, herder, grazing_route | — |
| `ridge` | keeper, ledger | — |
| `supplies` | keeper, ledger, grazing_route | — |
| `message` | keeper | signal_island |

### riftlight-boundary-stone-bank

Entry facts: none.

| Scene | Requires | Introduces |
| --- | --- | --- |
| `stones` | none | boundary_stones, stone_keeper, cloth |
| `markings` | boundary_stones, stone_keeper | carving, record_board |
| `carving` | carving, stone_keeper | — |
| `marker` | stone_keeper, record_board | — |
| `bank_rest` | stone_keeper, carving | bridge_road, ashspan |

### riftlight-ashspan-bridge

Entry facts: none.

| Scene | Requires | Introduces |
| --- | --- | --- |
| `bridge` | none | ashspan, ossley, boat |
| `landing` | ossley, boat | plank, mooring_rope, travelers |
| `plank` | plank, travelers, ossley | — |
| `rope` | plank, mooring_rope, travelers, ossley | — |
| `routes` | ossley | saltrot_lead |

### riftlight-sky-islands-arrival

Entry facts: learned_note.

| Scene | Requires | Introduces |
| --- | --- | --- |
| `island` | none | island, temple_keeper |
| `lesson` | learned_note | seren, pip |
| `local` | temple_keeper | marker_posts, distant_song |
| `markers` | temple_keeper, marker_posts | — |
| `song` | distant_song, temple_keeper | — |
| `island_rest` | temple_keeper, distant_song | — |

### riftlight-saltrot-arrival

Entry facts: learned_note.

| Scene | Requires | Introduces |
| --- | --- | --- |
| `flats` | none | saltrot, skupper, shell_bank |
| `lesson` | learned_note | seren, pip |
| `local` | skupper, shell_bank | silt, bag |
| `bag` | skupper, shell_bank, bag | — |
| `path` | skupper, shell_bank, bag | — |
| `flats_rest` | skupper, silt | — |

### riftlight-preview-pause-ashspan-bridge

Entry facts: none.

| Scene | Requires | Introduces |
| --- | --- | --- |
| `pause` | none | — |

### riftlight-preview-pause-boundary-stone-bank

Entry facts: none.

| Scene | Requires | Introduces |
| --- | --- | --- |
| `pause` | none | — |

### riftlight-preview-pause-cairnstep-pass

Entry facts: none.

| Scene | Requires | Introduces |
| --- | --- | --- |
| `pause` | none | — |

### riftlight-preview-pause-saltrot-arrival

Entry facts: none.

| Scene | Requires | Introduces |
| --- | --- | --- |
| `pause` | none | — |

### riftlight-preview-pause-sky-islands-arrival

Entry facts: none.

| Scene | Requires | Introduces |
| --- | --- | --- |
| `pause` | none | — |
