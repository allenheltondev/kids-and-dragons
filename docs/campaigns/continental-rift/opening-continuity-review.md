# Riftlight opening: continuity review

Reviewed 2026-10-17 against the composed scene narration, choices, success/failure branches,
conditional callbacks, and all incoming routes through the three-node preview. All 67 scenes
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

## Regression coverage

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
| `quay` | none | crates, fold, moving_rope |
| `check_pattern` | crates, fold, moving_rope | — |
| `pattern_seen` | crates, fold, noodle_stall | wedge, bleat |
| `pattern_missed` | fold | barrel_lid, bleat |
| `clear_quay` | fish_stall, noodle_stall, crates | dock_workers, bleat |
| `shimmer` | fold, bleat | goat |
| `read_light` | fold, goat | riftlight |
| `pull` | fold, moving_rope, crates, goat, wedge (if quay_head_start) | rope, dock_worker |
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

### riftlight-glacier-survival

Entry facts: exchange, goat, rope, wet_clothes, coat, bell.

| Scene | Needs established on this path | Establishes here |
| --- | --- | --- |
| `arrival` | goat, bell | scraped_knees, herd, melt_channel |
| `shelter` | goat, wet_clothes, bell, scraped_knees | snow_bank, dark_rocks |
| `windbreak` | snow_bank, goat, dark_rocks | footprints |
| `rocks` | dark_rocks, bell | footprints, sledge_tracks |
| `mend` | goat, scraped_knees, coat, dark_rocks | footprints |
| `tracks` | goat, footprints | herder, sledge |
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
| `changing` | herder, learned_note, seam, hall, bell | travelers |
| `blankets` | blankets, herder, rope, goat, herd, travelers | — |
| `departure` | hall, goat, herd, travelers | griffin, unicorn, map |

### riftlight-riftseekers-departure

Entry facts: exchange, goat, rope, bell, hall, glacier, learned_note, travelers, griffin, unicorn, map.

| Scene | Needs established on this path | Establishes here |
| --- | --- | --- |
| `map` | griffin, unicorn, map | orin, olivia, seren, instruments, ring_case |
| `arrival_story` | orin, olivia, goat | — |
| `arrival_question` | orin, olivia, seren | — |
| `fellowship` | orin, olivia, seren, ring_case | riftseekers, rifts |
| `seren` | seren, orin, map, riftlight (if starweaver_read_first_rift), instruments (unless starweaver_read_first_rift) | — |
| `lead` | orin, map | frostfang, cairnstep |
| `olivia` | olivia, orin, rifts | — |
| `route` | orin, seren, frostfang, hall | great_river, ice_shelf |
| `chime` | orin, rifts | listening_chime, chime_rules |
| `test_chime` | listening_chime, orin, chime_rules | — |
| `ring` | listening_chime, orin, seren, rifts | — |
| `wrap` | listening_chime, orin, chime_rules | — |
| `parting` | olivia, seren, orin, map, cairnstep, ring_case, instruments | — |
| `camp` | hall, glacier, ice_shelf, frostfang, listening_chime | — |
