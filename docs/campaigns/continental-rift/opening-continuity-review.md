# Riftlight opening: continuity review

Reviewed 2026-10-17 against the composed scene narration, choices, success/failure branches,
conditional callbacks, and all incoming routes through the three-node preview. All 80 scenes
are accounted for below. This is a review of the authored opening, not the unwritten campaign.

The name sweep found no dangling proper names after corrections. The manual pass also checked
ordinary objects, physical state, and actions that a name-only checker cannot see.

## Corrections

- Establish the ship's early arrival before its choice label calls it early.
- Show hoofprints on the fish-helper route before offering to follow them.
- Keep Thimble's chart open until the pin-it-down choice resolves.
- Introduce the moving rope on every route into the quay; remove the assumed earlier movement.
- Introduce Riftlight in the gated reading without sharing diagnostic colors.
- Put the kid inside the coat and establish wet clothes before the glacier scene.
- Make the first distant bell ring rather than answer an unestablished signal; show its source.
- Show the herd and scraped knees before the shelter and Mend choices.
- Identify the yeti as a herder on both conversation routes; introduce her blanket from the sledge.
- Show the safe footholds before the Songkeeper crossing, warm stones and blankets before using
  them, and the songbook before turning its page.
- Remove the unearned claim that the goat has chewed a sleeve since the Exchange.
- Introduce Orin, Olivia and Seren aloud on the mandatory entry, plus the instruments and ring
  case. Name the ring case explicitly so the two cases cannot be confused.
- Unroll the map before pointing to it, introduce the river and ice shelf before directions,
  and name the Listening Chime before its first action label.

## Editorial revision

The expanded opening adds an all-path displaced supply landing with two rescue approaches,
immediate seller/pilot callbacks, a self-directed snow-drift obstacle, and an interactive
singing-seam experiment that leaves the ice sealed. The changed melt threatens the herd's
grazing route. Orin and Olivia respond to that immediate need, and the party expresses a
priority before receiving two purposeful leads. All added scenes and conditional references
are included in the ledger below. Pacing remains subject to the
[family playtest gate](opening-playtest.md); no measured sessions have been claimed.

## Regression coverage

The five ability-assisted checks explicitly separate the enabling ability from the roller's
task: wings carry the kid or rope, Smash supplies a barrier, Brace steadies a post, and a
Songkeeper supplies the pace. The selected roller manages the line or leads the group. Mixed
parties are tested with a higher-stat hero who lacks the enabling species/class, on both
success and failure; damage belongs to the roller without assigning them someone else's ability.

[continuity.json](../../../content/drafts/riftlight/continuity.json) records each scene's narrative
prerequisites and the introduction wording that establishes them. The chapter walker checks these
against actual engine-composed narration on every explored path, including both check outcomes,
class/species options, and a three-player group check. A merge never borrows a fact from a sibling
path. Each chapter's incoming facts must be established on every preceding ending; the optional
Riftlight callback additionally requires the carried reading flag. Adding a scene without a
review entry fails the tests.

This is an explicit author-reviewed dependency map, not a language model or an automatic proof
of arbitrary prose. Prose changes need the same review; the checks protect the introductions
listed here. The independent proper-name continuity sweep still runs as well.

## Scene ledger

New facts may be introduced in the scene that first uses them. Inherited facts below refer to
observations guaranteed by the preceding chapter, not to lore players are expected to remember
from Gemfall. Local conditional requirements are checked only when their narration is shown.

### riftlight-exchange-rift

Entry facts: none.

| Scene | Needs established on this path | Establishes here |
| --- | --- | --- |
| `market` | none | exchange, noodle_stall, snow |
| `morning` | exchange, snow | fish_stall, gull, captain, early_ship |
| `fish` | fish_stall, snow | white_grass |
| `fish_help` | fish_stall, noodle_stall, white_grass | hoofprints |
| `gull` | gull | hoofprints |
| `gull_help` | gull, hoofprints | — |
| `ship` | captain, early_ship | chart, thimble |
| `ship_help` | chart, thimble | — |
| `ship_cold` | captain, noodle_stall | moving_rope |
| `quay` | lost_landing | crates, fold, moving_rope |
| `check_pattern` | crates, fold, moving_rope | — |
| `pattern_seen` | crates, fold, noodle_stall | wedge, bleat |
| `pattern_missed` | fold | barrel_lid, bleat |
| `clear_quay` | fish_stall, noodle_stall, crates | dock_workers, bleat |
| `shimmer` | fold, bleat | goat |
| `read_light` | fold, goat | riftlight |
| `pull` | fold, moving_rope, crates, goat, wedge (if quay_head_start), fish_stall (if helped_fish_seller), pilot, saved_supper (if saved_barge_supper), pilot, safe_mooring (if found_barge_mooring) | rope, dock_worker |
| `catch` | goat, fold | — |
| `anchor` | rope | — |
| `swoop` | goat, crates | — |
| `smash` | crates, rope | — |
| `brace` | rope | — |
| `caught` | goat, dock_worker, rope | — |
| `together` | goat, rope | — |
| `tumbled` | goat, rope | — |
| `through` | goat, fold | wet_clothes, coat |
| `white` | goat, coat | bell |
| `delivery` | exchange | supply_barge, pilot, lost_landing, supper_sacks |
| `delivery_sacks` | pilot, supply_barge, lost_landing, supper_sacks | saved_supper |
| `delivery_moor` | pilot, supply_barge, lost_landing, supper_sacks | safe_mooring |

### riftlight-glacier-survival

Entry facts: exchange, goat, rope, wet_clothes, coat, bell.

| Scene | Needs established on this path | Establishes here |
| --- | --- | --- |
| `arrival` | goat, bell | scraped_knees, herd, melt_channel |
| `shelter` | goat, wet_clothes, bell, scraped_knees | snow_bank, dark_rocks |
| `windbreak` | snow_bank, goat, dark_rocks | footprints |
| `rocks` | dark_rocks, bell | footprints, sledge_tracks |
| `mend` | goat, scraped_knees, coat, dark_rocks | footprints |
| `tracks` | goat, footprints, drift_markers (if marked_glacier_drift), warm_detour (if sheltered_kid_on_detour), hollow_found (if found_drift_hollow) | herder, sledge |
| `tell_rift` | herder, wet_clothes, rope, exchange, sledge | blanket |
| `ask_help` | herder, goat, sledge, melt_channel | blanket |
| `channel` | herder, herd, melt_channel, sledge, rope | stepping_stone, safe_steps |
| `step` | stepping_stone, melt_channel, herder | — |
| `sledge` | sledge, stepping_stone, herder | — |
| `wing_line` | rope, melt_channel | — |
| `song_step` | herder, safe_steps | — |
| `dry_bank` | goat, herd, herder | — |
| `wet_bank` | goat, herd, herder, melt_channel | — |
| `herd` | herder, herd, goat | hall_entrance, low_note |
| `patient` | goat, herd, herder, hall_entrance | — |
| `sleeve` | goat, herder, hall_entrance | nibbled_cuff |
| `hum` | goat, low_note, hall_entrance | — |
| `hall` | hall_entrance, herder, wet_clothes, low_note | hall, warm_stones, blankets, glacier |
| `listen` | hall, herder, low_note | songbook |
| `song_answer` | herder, hall, low_note | — |
| `learn_note` | hall, herder, low_note | learned_note, seam |
| `changing` | herder, learned_note, seam, hall, bell, seam_tested, snow_bank (if made_glacier_shelter), melt_channel (if crossed_melt_dry) | travelers, grazing_route |
| `blankets` | blankets, herder, rope, goat, herd, travelers | — |
| `departure` | hall, goat, herd, travelers, blankets (if helped_glacier_herder) | griffin, unicorn, map |
| `drift` | footprints, dark_rocks, bell, goat, rope | drift |
| `drift_probe` | drift, rope, bell | drift_markers |
| `drift_detour` | drift, dark_rocks, goat, coat, bell | warm_detour |
| `drift_slip` | drift, goat, rope | hollow_found |
| `seam_response` | seam, learned_note, herder | seam_frost |
| `seam_hum` | seam, learned_note, herder | seam_tested |
| `seam_touch` | seam, learned_note, herder | seam_tested |
| `seam_listen` | seam, learned_note, herder | seam_tested |

### riftlight-riftseekers-departure

Entry facts: exchange, goat, rope, bell, hall, glacier, learned_note, travelers, griffin, unicorn, map, seam, seam_tested, grazing_route, herder, herd, sledge.

| Scene | Needs established on this path | Establishes here |
| --- | --- | --- |
| `map` | griffin, unicorn, map | orin, olivia, seren, instruments, ring_case |
| `arrival_story` | orin, olivia, goat | — |
| `arrival_question` | orin, olivia, seren | — |
| `fellowship` | orin, olivia, seren, ring_case | riftseekers, rifts |
| `seren` | seren, orin, map, riftlight (if starweaver_read_first_rift), instruments (unless starweaver_read_first_rift) | — |
| `lead` | orin, map, grazing_route, herder, herd | frostfang, cairnstep |
| `olivia` | olivia, orin, seren, map, grazing_route, rifts | — |
| `route` | orin, seren, frostfang, hall, seam, learned_note | great_river, ice_shelf |
| `chime` | orin, rifts | listening_chime, chime_rules |
| `test_chime` | listening_chime, orin, chime_rules | — |
| `ring` | listening_chime, orin, seren, rifts | — |
| `wrap` | listening_chime, orin, chime_rules | — |
| `parting` | olivia, seren, orin, map, cairnstep, ring_case, instruments | — |
| `camp` | hall, glacier, ice_shelf, frostfang, listening_chime, cairnstep, herd, seam, learned_note | — |
| `help_now` | olivia, orin, seren, herder, sledge | supper_gift |
| `safe_routes` | orin, olivia, seren, herder, cairnstep | supper_gift |
