Merged PR #499 gave all 16 Gemfall chapters a spine fight and at least four story interactions, and PR #501 completed the reusable chapter-data authoring and validation foundation for painted props. The artwork itself remains to be delivered. **Nothing here blocks play.** `npm run art:inventory` reports 0 outstanding and `art:verify` passes: the new scenes use existing backdrops where they have one, the biome backdrop where they don't, and the six creature cutouts they use already exist. This issue lists **everything** that would make those beats look finished. All of it is requested.

Contents: (1) 16 fight-arc paintings, (2) 49 location backdrops, (3) the complete interaction prop/glyph brief from the later issue comment, and (4) the correct post-#501 wiring, regression checks and staged delivery plan. **No new prop-rendering subsystem is needed.**

## Delivery spec

**Backdrops** follow [docs/campaigns/gemfall-illustrations.md](../blob/main/docs/campaigns/gemfall-illustrations.md): 1920x1080 WebP at quality 88, in `assets/scenes/gemfall/<slug>.webp`. Declare each as `scenes/gemfall/<slug>` in the `scenes` list of `assets/manifest.json`, then set the listed scenes' `art` to that id. Painterly storybook style, soft brushwork, warm and a little spooky, never scary, for children of 8. Keep the lower third open for separately rendered sprites. **No people or creatures in the picture**: the cast and the fight's creatures are drawn on top as cutouts, so paint the *place*, plus any props that belong to the place (the heap of shiny lost things, the loose lantern strings). No text, UI or frame; abstract marks instead of readable lettering.

**Interaction assets use two separate registries.** Props and tracking covers are transparent **512×512 WebP** files in `assets/story-props/<id>.webp`, registered under `storyProps.ids` in `assets/manifest.json` (follow its current canvas/edge-margin checks). Option glyphs for memory, sequence and play are **256×256** painted icons in the existing `packages/client/src/assets/painted/` pipeline, registered in `paintedIcons.ids` and exposed through `PAINTED_ART`. Do not bundle full-size story props into the client JS.

---

## 1. Fight-arc paintings (16)

One painting per chapter's new spine fight. Each is used by the intro scene, the win scene and the loss scene (and the fight itself keeps its biome tiles). Where a scene already has a nearby painting, this replaces it for the fight arc only.

| # | Slug | Scenes that use it | Paint |
|---|---|---|---|
| 1 | `exchange-quay-wisps` | 01 `scene_quay_wisps`, `scene_quay_wisps_shooed`, `scene_quay_wisps_scattered` | Exchange quay at lamp-lighting, a ferry drifting loose on its rope, lamp strings tangled and swinging, warm red glow from nowhere in particular. |
| 2 | `ditch-plank-mimics` | 02 `scene_mimic_ditch`, `scene_mimic_gone`, `scene_mimic_squelched`, `scene_ditch_hay_home`, `scene_ditch_cake` | A muddy hay-lane ditch with two suspiciously plank-shaped planks (one big, one little) lying across it, a hay cart waiting, a table of honeycakes on the far bank. |
| 3 | `queue-camp-crabs` | 03a `scene_crab_dusk`, `scene_crabs_turned`, `scene_crabs_sent_home` | Dusk at the stone-crossing queue: blankets and a soup pot, a bank sloping to the river, gem carts humming with a faint glow, orange sky. |
| 4 | `marsh-steps-crabs` | 03b `scene_crab_shallows`, `scene_crabs_shooed`, `scene_crabs_rescue` | Marsh shallows with an old stone step and a gleaming heap of lost things on it: spoons, buttons, a teapot lid. |
| 5 | `ford-reed-crabs` | 03c `scene_reed_crabs`, `scene_crabs_cleared`, `scene_crabs_coaxed` | Morning at the west ford, the first stepping stones in reeds, a lead wagon at the water's edge, mist. |
| 6 | `mud-wallow-mimic-posts` | 04a `scene_mud_posts`, `scene_mimics_unmasked`, `scene_mimics_took_boots` | Rain-filled marker holes and mud on the pride-stone plain, two tall marker posts standing a little too proudly, tufts of tail fur on them. |
| 7 | `brook-log-mimics` | 04b `scene_stepping_logs`, `scene_logs_cleared`, `scene_logs_slipped` | A woodland brook crossed by two mossy logs side by side like a bridge, ferns, dappled light, the worst glade dark beyond. |
| 8 | `depot-barn-strongboxes` | 04c `scene_box_ten`, `scene_boxes_gone`, `scene_boxes_sulking` | The rush-depot barn: shelves of numbered strongboxes, a clerk's stool and ledger table, scattered paper, ink puddles. |
| 9 | `bridge-lantern-wisps` | 05a `scene_lantern_wisps`, `scene_wisps_shooed`, `scene_wisps_scattered` | The cracked Northern River Bridge at the evening ration: lit lanterns on poles, a gem cart with swinging lantern strings, a tethered mule. |
| 10 | `high-stream-drake` | 05b `scene_drake_ford`, `scene_drake_bank`, `scene_drake_shooed`, `scene_drake_splashed` | A cliffside stream with slick stepping stones, then a narrow rocky streambed slot, steam puffing from a wallow in the middle, towels and a tin kettle by the path. |
| 11 | `tally-porch-crawlers` | 05c `scene_crawlers_porch`, `scene_crawlers_shooed`, `scene_crawlers_scattered` | The tally-house porch at dusk: boards, a door of ledgers, a row of hand bells hanging from the eaves, gaps under the boards. |
| 12 | `citadel-cellar-hall` | 06 `scene_crawlers_hall`, `scene_crawlers_home`, `scene_crawlers_rescued` | Redspire's records hall: a long captain's table piled with 400-year logs, cellar stairs open at one end, brooms in a rack. |
| 13 | `echo-cutting` | 07h `scene_echo_cutting`, `scene_echo_quiet`, `scene_echo_lost` | A rocky cutting below the tree line where the walls look like they answer back, two big pots on a flat rock, a village far below. |
| 14 | `pinch-box-crawlers` | 07l `scene_box_crawlers`, `scene_crawlers_scattered`, `scene_crawlers_boxed` | The Pinch bend: a burst numbered box with chewed tags, a wagon waiting below, a soup sack on a hook. |
| 15 | `spring-drake-ledge` | 07r `scene_drake_ledge`, `scene_drake_drinks`, `scene_drake_rescued` | A dry creek bed and damp moss where the stair meets the old path, a small spring bubbling from the rock, first trees. |
| 16 | `crab-field-guards` | 08 `scene_crab_guards`, `scene_crabs_bumped`, `scene_crabs_herded` | The ash-grey crab field: warm patches, glassy burrow mouths, a narrow path up through the ash, a fresh-dug hollow with a glint. |

---

## 2. Location backdrops for the other new scenes (49)

Each is a new painting for scenes that currently show only their biome backdrop. Scenes that already have a painting are listed at the end of this section and keep it.

### 02 Green Roads North (4)
| Slug | Scene | Paint |
|---|---|---|
| `egg-stall-baskets` | `interaction_egg_baskets` | The egg stall in the lane, empty baskets lined along a trestle, a crowd's worth of baskets on the ground. |
| `jackalope-meadow-hats` | `interaction_jackalope_hats` | A meadow of jackalopes sitting still, a lone straw hat on the track. |
| `moth-bell-wagons` | `interaction_moth_bells` | Wagon bells hanging along a wagon rail, moths glowing on a few. |
| `stuck-wagon-lane` | `interaction_stuck_wagon` | A lone wagon with a wheel sunk in a rut at the end of a lane, hedges just ahead, a long steering pole. |

### 03b What the Marsh Remembers (4)
| Slug | Scenes | Paint |
|---|---|---|
| `toll-reeds-tunnel` | `scene_toll_reeds_coin`, `interaction_reed_gap` | A tunnel of tall knotted reeds over dark water, swinging shut and open like doors. |
| `wisp-raft-crowd` | `interaction_wisp_crowd` | A flat marsh raft bumped by a swarm of tiny pale wisps, hanging moss, a ribbon strung overhead. |
| `fog-raft-lantern` | `interaction_lantern` | The raft at dusk in thickening fog, a lantern hook at the bow, a pole at the stern. |
| `stump-river-fog` | `interaction_stumps` | A slow river with a drifting stump like a sleeping cow, fog, the Hollow Gate faint in the distance. |

### 04b The Forest Takes Attendance (6)
| Slug | Scene | Paint |
|---|---|---|
| `sapling-ring` | `interaction_sapling_rhyme` | A ring of boot-high saplings in a clearing, leaves rustling. |
| `hedge-knit-gate` | `interaction_hedge_gate` | A hedge knitting its branches into a neat green gate with one thorny latch. |
| `gray-moss-patch` | `interaction_herd_friends` | A patch of gray moss at the edge of a green one, a strawberry patch behind. |
| `fern-spring-glade` | `interaction_spring_cup` | A dry glade with a small clear spring in a mossy dip, a hollow leaf for a cup. |
| `fern-calf-hide` | `interaction_calf_hide` | Three big ferns in a row, dappled light. |
| `beech-squirrel-boughs` | `scene_beech_squirrel` | An enormous old beech with a knot-hole and a branch for a squirrel to sit on. |

### 05b MossHome and the High Paths (9)
| Slug | Scene | Paint |
|---|---|---|
| `mosshome-archive-doorstep` | `check_archive_door` | The MossHome archive doorstep: springy welcome moss, a round door, shelves seen through it. |
| `archive-yarn-table` | `check_plot` | A table with a ball of yarn, a fistful of thorns, and a cloth map to pin them on. |
| `archive-leaning-chair` | `check_chair_sit` | A tall tilted chair that will not stand up, string and a ruler laid beside it. |
| `rope-bridge-spare-planks` | `check_bridge_test` | A swaying rope bridge with a gap, a stack of spare planks tied to the rail with a tag. |
| `runners-post-stump` | `interaction_post_relay` | The runners' post: a hollow stump for news cords, pegs of knotted cords. |
| `runner-cord-knots` | `interaction_cord_knots` | A runner's hands (no figure) tying a cord against a MossHome wall, a bundle of cords. |
| `halfway-hut-tin` | `scene_hut_honeycake` | The halfway hut: a shelf of honeycakes, a path-keeper's tin on the counter. |
| `stream-stepping-stones` | `interaction_stones` | Slick stepping stones up a cliff stream, waves rolling down in a rhythm. |
| `foothills-rim-camp` | `interaction_camp` | A flat rock at the edge of the foothills at the last of the sun, bare and a little cold. |

### 05c The Boundary Stones (5)
| Slug | Scene | Paint |
|---|---|---|
| `tally-house-floor-map` | `check_outline` | The tally house floor with a big chalked map, four clue objects set on it. |
| `pry-bar-wall` | `interaction_pry_bars` | A long wall of pry bars hung on pegs by turned-back prospectors, a line of them climbing the hill. |
| `bell-cart-stones` | `interaction_bell_cart` | A hand bell on a little cart with a wheel stuck in a rut on the way down to the boundary stones. |
| `bell-house-supper` | `scene_bell_house_supper_honey` | The bell house's long table at supper, a pot of honey the size of a head. |
| `bell-house-tuck-in` | `interaction_bell_tuck` | The bell house at night: rows of bells hung low, cloths, a lamp. |

### 06 Ashfall (5)
| Slug | Scene | Paint |
|---|---|---|
| `moth-slope-rocks` | `interaction_moth_trail` | A hillside slope with three flat rocks, one cracked, a single bright glow. |
| `wagon-road-rut` | `interaction_wagons` | The road at the foot of the slope, a lead wagon with a dropped wheel in a deep rut, forty wagons queueing behind it. |
| `hessa-soup-camp` | `interaction_soup_pots` | The edge of the camp at dusk: a hundred tents, Hessa's heavy soup pots on trestles. |
| `morning-bells-baker` | `scene_morning_bells_bought` | A baker's stall by a bench, flour, warm honeycakes in a basket. |
| `pellam-tea-table` | `interaction_tea` | Pellam's table: a bucket-sized kettle, thimble-sized cups, a plate of shortbread. |

### 07h The Collection (4)
| Slug | Scene | Paint |
|---|---|---|
| `fleecewick-cabinet-road` | `interaction_cabinet` | A glass cabinet of forty stones on a cart, one wheel stuck in a rut. |
| `checkpoint-box-shelf` | `interaction_boxes` | A checkpoint table with a stamp, boxes piled beside it, a long shelf by the road. |
| `hairpin-wagons` | `interaction_hairpin` | The mountain hairpin with a line of slow wagons rolling around it. |
| `tidewell-knock-rock` | `interaction_tidewell_knocks` | A flat rock on a mountain path with a pencil beside it. |

### 07l The Tether (4)
| Slug | Scene | Paint |
|---|---|---|
| `pinch-door-table` | `interaction_set_table` | An old door laid across two barrels in the middle of the Pinch. |
| `choir-warmup-masks` | `interaction_choir_warmup` | A row of painted masks hung on posts, a leader's mask tapped. |
| `warden-fire-tea` | `interaction_tea_cups` | Two lines of fires, wardens' side and masks' side, a stack of tin mugs at the near one. |
| `box-stack-slide` | `interaction_box_slide` | Tall stacks of numbered boxes leaning and sliding down a bend toward waiting sacks. |

### 07r The Returning (4)
| Slug | Scene | Paint |
|---|---|---|
| `stone-chain-road` | `interaction_stone_chain` | A road with runaway stones rolling across it, sacks lined up at the far side. |
| `way-shelter-stack` | `interaction_shelter_stack`, `scene_evening_cakes` | A dragonling way-shelter's gate, a board for stacking, a paper bag of honeycakes. |
| `trickling-slide-road` | `interaction_trickle` | A hillside still letting go, small red stones trickling across the road in bursts. |
| `caravan-bells-hairpin` | `interaction_wagon_bells` | A caravan coming around a hairpin, harness bells ringing, a tired lead wagon. |

### 08 Gemfall (4)
| Slug | Scene | Paint |
|---|---|---|
| `bell-code-hut` | `check_bell_code` | The inside of a warden hut: a nibbled code card, a bell rope. |
| `washed-out-step-cart` | `interaction_bundles` | A slope with a washed-out step, a cart parked across it, bundles piled. |
| `warden-post-tin` | `scene_warden_post_tin` | A warden post with a tin on a shelf, a sign-in book. |
| `warm-rock-chimney` | `interaction_chimney` | A steep chimney of warm rock with a hanging rope and a painted sign. |

### Scenes that keep their existing painting (no new request)
01 `interaction_quay_line`, `interaction_letters` (`exchange-docks`), `interaction_jars` (`exchange-quay`), `interaction_lantern_pole`, `scene_caravan_yard_thornguard` (`caravan-yard`) · 03a `interaction_planks`, `interaction_pot` (`east-road-markers`), `interaction_hats`, `interaction_hum`, `scene_wake_fee_pay_coin` · 03b `interaction_runes` (`hollow-gate`) · 03c all five converted checks · 04a `check_sashes`, `interaction_ridge_creep`, `interaction_plates`, `interaction_post_hole`, `interaction_lost_moths`, `scene_waystation_lesson` · 04c `check_relay`, `check_search`, `interaction_last_post`, `interaction_gate`, `interaction_pony`, `interaction_verses` · 05a `check_pony`, `check_rubbing`, `check_string`, `interaction_bowls`, `interaction_level`, `scene_rim_lookout_pay` · 06 `interaction_tags` · 08 `check_hum_note`, `check_hear_titan`.

---

## 3. Interaction props and glyphs — ready for art delivery after #501

**This section replaces the original Section 3 and the outdated technical instructions in the October 26 issue comments.** The complete requested painting list below is preserved from [the later, authoritative art list](https://github.com/allenheltondev/kids-and-dragons/issues/497#issuecomment-6405876097); that comment superseded the original descriptions but predated PR #501. Proposed `prop_*`, `glyph_*`, and `play_*` IDs are suggestions, not registered existing assets. Resolve duplicates or rename consistently when registering them.

The rendering/validation infrastructure was merged in **#501**. Use `chapter.presentation.interactions[sceneId]` for painted scene props and per-cover tracking paintings. **Do not** add `prop` or `icons` fields to `scene.interaction` specs; those were superseded before #501 merged.

```json
"presentation": {
  "interactions": {
    "interaction_lantern_pole": { "props": ["prop_rope_pole"] },
    "interaction_jackalope_hats": {
      "coverIcons": ["prop_straw_hat", "prop_straw_hat", "prop_straw_hat"]
    }
  }
}
```

Each story-prop ID in `props`/`coverIcons` must be registered in `storyProps.ids` and correspond to `assets/story-props/<id>.webp`. Tracking `coverIcons` must have one entry per authored cover, in the same order. The existing renderer handles timing, cooperate, balance and relay props, as well as tracking cover motion and accessibility. The warmer discovers these presentation assets automatically; do not duplicate them into `warmUrls`. `fights` and `warmUrls` may be omitted if unused.

For memory, sequence and play *choice icons*, instead register each `glyph_*` / `play_*` asset as a painted icon and set its existing `scene.interaction.options[].icon` value to the registered ID. These 256px icons use the existing client icon pipeline; reuse existing glyphs where possible, and watch the first-paint / total bundle budgets carefully, which were already at **319/320 KB** and **1460/1460 KB** on #501. If the full glyph set pushes the budget over, split deliveries or add a separately reviewed lazy-loading approach rather than raising the cap without review.

When painting tracking covers, preserve the game's concealment mechanic: the visual treatment must not mark the correct answer or expose it during movement. The original cover labels remain legible and missing images must retain a visible neutral fallback. In memory and sequence sets, distinguish shapes as well as colors for young players and accessibility.

### Objects for cooperate and balance (14, shared across scenes)

| Id | Paint | Used by |
|---|---|---|
| `prop_rope_pole` | Coil of rope around a wooden pole | cooperate: 01 `interaction_lantern_pole`, 02 `interaction_stuck_wagon`, 03a `interaction_pot`, 03b `interaction_stumps`, 06 `interaction_wagons`, 08 `interaction_chimney` |
| `prop_post_ropes` | A tall marker post with two ropes | cooperate: 04a `interaction_post_hole`, 04c `interaction_last_post` |
| `prop_wagon_wheel_rut` | A wagon wheel stuck in a rut | cooperate: 05c `interaction_bell_cart` |
| `prop_linked_arms` | Linked arms | cooperate: 03c `check_block_jumpers` |
| `prop_leaning_chair` | A tall chair tilted over | cooperate: 05b `check_chair_sit` |
| `prop_knotted_string` | A knotted string stretched over a crack | cooperate: 05a `check_string` |
| `prop_hedge_latch` | Hedge branches knitting round a thorny latch | cooperate: 04b `interaction_hedge_gate` |
| `prop_plank` | A long wooden plank | relay 03a `interaction_planks`; balance 05b `check_bridge_test` |
| `prop_water_tray` | A wide tray of brimming water with a cork boat | balance: 05a `interaction_level` |
| `prop_jar_tray` | A tray of wobbling jars | balance: 01 `interaction_jars` |
| `prop_leaf_cup` | A leaf cup of spring water | balance: 04b `interaction_spring_cup` |
| `prop_glass_cabinet` | A glass cabinet of forty stones | balance: 07h `interaction_cabinet` |
| `prop_door_barrels` | An old door across two barrels | balance: 07l `interaction_set_table` |
| `prop_stone_board` | A board stacked with humming stones | balance: 07r `interaction_shelter_stack` |

### Objects for relay (13, one each)

| Id | Paint | Scene |
|---|---|---|
| `prop_pear_crate` | A crate of pears | 01 `interaction_quay_line` |
| `prop_egg_basket` | A basket of fresh eggs | 02 `interaction_egg_baskets` |
| `prop_lantern` | A lit lantern | 03b `interaction_lantern` |
| `prop_cake_plate` | A plate of spiced grass-cake | 04a `interaction_plates` |
| `prop_word_scroll` | A rolled message with a small boy in an orange hat | 04c `check_relay` |
| `prop_soup_bowl` | A bowl of hot soup | 05a `interaction_bowls` |
| `prop_knotted_cords` | A bundle of knotted cords | 05b `interaction_post_relay` |
| `prop_pry_bar` | A heavy iron pry bar | 05c `interaction_pry_bars` |
| `prop_soup_pot` | A heavy pot of soup | 06 `interaction_soup_pots` |
| `prop_numbered_box` | A humming numbered box | 07h `interaction_boxes` |
| `prop_tea_mug` | A hot tin mug of tea | 07l `interaction_tea_cups` |
| `prop_humming_stone` | A humming stone | 07r `interaction_stone_chain` |
| `prop_faun_bundle` | A faun family's bundle | 08 `interaction_bundles` |

(`prop_plank` above also serves 03a `interaction_planks`.)

### Covers for tracking (9, painted so each trio reads as a set)

| Scene | Ids |
|---|---|
| 02 `interaction_jackalope_hats` | `prop_straw_hat` |
| 03a `interaction_hats` | `prop_brass_cup`, with a shiny button |
| 03c `check_expose` | `prop_playing_card` (face-down), plus `prop_sun_card` for the reveal |
| 04b `interaction_calf_hide` | `prop_fern` |
| 04c `check_search` | `prop_pickle_wagon`, `prop_hay_wagon`, `prop_mule_cart` |
| 06 `interaction_moth_trail` | `prop_rock`, `prop_cracked_rock` |

### Memory and sequence glyphs (one icon per option; these work today)

Reuse a glyph where two scenes share an option (the low/middle/high notes serve three scenes).

| Scene | Options and proposed ids |
|---|---|
| 02 `interaction_moth_bells` | little bell `glyph_bell_little`, big bell `glyph_bell_big`, brass bell `glyph_bell_brass` |
| 03a `interaction_hum`; 07l `interaction_choir_warmup`; 08 `check_hum_note` | low `glyph_note_low`, middle `glyph_note_middle`, high `glyph_note_high` |
| 03b `interaction_runes` | `glyph_rune_tall`, `glyph_rune_wavy`, `glyph_rune_round` |
| 03c `check_learn_verse` | `glyph_slow` (a snail or a long note), `glyph_wait` (a raised paw or an hourglass) |
| 04a `check_sashes` | `glyph_sash_river`, `glyph_sash_pride`, `glyph_sash_bridge` |
| 04b `interaction_sapling_rhyme` | `glyph_fern`, `glyph_acorn`, `glyph_bluebell` |
| 04c `interaction_verses` | `glyph_bridge`, `glyph_stone`, `glyph_pond` |
| 05a `check_rubbing` | `glyph_spiral`, `glyph_wave`, `glyph_step` |
| 05b `check_plot` (sequence) | `glyph_path_river`, `glyph_path_marsh`, `glyph_path_trees` |
| 05b `interaction_cord_knots` | `glyph_knot_loop`, `glyph_knot_twist`, `glyph_knot_pull` |
| 05c `check_outline` | `glyph_clue_note` (the one note), `glyph_clue_spiral` (the curling songs), `glyph_clue_jackalope` (the quiet jackalopes), `glyph_clue_tally` (the broken tallies) |
| 06 `interaction_tags` | `glyph_moon`, `glyph_flame`, `glyph_leaf` |
| 07h `interaction_tidewell_knocks` | `glyph_knock_thump`, `glyph_knock_tap`, `glyph_knock_rumble` |
| 07r `interaction_wagon_bells` | `glyph_bell_low`, `glyph_bell_high`, `glyph_bell_brass` (or reuse the 02 bells) |
| 08 `check_bell_code` (sequence) | `glyph_ring_long`, `glyph_ring_short` |
| 08 `check_hear_titan` (sequence) | `glyph_sound_rumble`, `glyph_sound_chime`, `glyph_sound_sigh` |

### Play options (30, one icon per option; these work today)

| Scene | Options |
|---|---|
| 03b `interaction_wisp_crowd` | `play_lullaby`, `play_cattails`, `play_lantern_held` |
| 03c `check_play_mountain` | `play_rumble`, `play_red_blanket`, `play_pinecones` |
| 04a `interaction_lost_moths` | `play_warm_hand`, `play_soft_hum`, `play_cupped_hands` |
| 04b `interaction_herd_friends` | `play_slow_tune`, `play_scratch`, `play_clover` |
| 04c `interaction_pony` | `play_mane_brush`, `play_water_bucket`, `play_hum_tune` |
| 05a `check_pony` | `play_slow_tune` (shared), `play_stroke_nose`, `play_apple` |
| 05b `check_archive_door` | `play_stomp_marsh`, `play_splash_river`, `play_tiptoe_thorns` |
| 05b `interaction_camp` | `play_little_fire`, `play_blankets`, `play_moss_tea` |
| 05c `interaction_bell_tuck` | `play_bell_cloth`, `play_bell_lullaby`, `play_bell_polish` |
| 06 `interaction_tea` | `play_pour_tea`, `play_stir`, `play_shortbread` |

### Timing action glyphs (9)

| Scene | Id and paint |
|---|---|
| 01 `interaction_letters` | `prop_letters` (fluttering letters) |
| 03b `interaction_reed_gap` | `prop_reed_gate` (a pole through swinging reeds) |
| 03c `check_goat_chase` | `prop_goat_bucket` (a goat with a bucket on its head) |
| 04a `interaction_ridge_creep` | `prop_tall_grass` (a creeping step in tall grass) |
| 04c `interaction_gate` | `prop_striped_gate` (a striped gate pole) |
| 05b `interaction_stones` | `prop_stepping_stones` (stones with waves) |
| 07h `interaction_hairpin` | `prop_wagon_wheels` (rolling wheels) |
| 07l `interaction_box_slide` | `prop_box_stack` (leaning stacks of boxes) |
| 07r `interaction_trickle` | `prop_red_stones` (trickling red stones) |

**Timing-glyph placement note:** #501 lets authors attach a decorative visual to the shared interaction display via `presentation.interactions[sceneId].props`. It **does not** automatically replace the phone action button's icon. Paint the nine timing assets for the shared scene art first. If an individually illustrated action *button* is still required, that UI addition is a separate scoped change, not something `coverIcons` or `props` already provides.

---

## 4. Current wiring and validation checklist

### Backdrops (16 fight-arc + 49 location paintings)

1. Save each approved 1920×1080 scene painting at `assets/scenes/gemfall/<slug>.webp` (quality 88) and register `scenes/gemfall/<slug>` in the `scenes` manifest list.
2. Set each listed scene's existing `art` field to the correct ID, including fight introduction / victory / loss destinations as specified in Section 1. Do not change encounter rules, board geometry, combat results or creature cutouts.
3. Update `docs/campaigns/gemfall-illustrations.md` so it records actual coverage, artwork locations and approved source/revision details. Preserve existing backdrops in the explicitly excluded scenes.

### Interaction paintings and option icons

4. Produce 512×512 transparent story-prop WebPs in `assets/story-props/`, register in `storyProps.ids`, and author scene-keyed `presentation.interactions[sceneId].props` or tracking `coverIcons` in each Gemfall chapter JSON. Match the exact tracking cover count. No new client renderer, `spec.prop` / `spec.icons`, or manual `warmUrls` duplication.
5. For 256×256 memory, sequence and play option icons, register with `paintedIcons.ids`, add to the current painted client artwork mapping and change only the relevant `scene.interaction.options[].icon` strings. Compare generated/built bundle sizes before merging these groups.
6. Include a negative/fallback test where painted assets fail to load; retain labels, timing/reduced-motion/relaxed-play behavior, tracking concealment, and the original plain presentation when no painting is declared. Show key scenes on both TV and a 390px phone.

### Protect gameplay

7. Gemfall is pinned. Changes should be presentation-only: re-pin affected chapter file hashes in `packages/server/src/handlers/gemfall-compat.test.ts` with a clear `Re-pinned for ...` note **only after confirming the gameplay digests are unchanged**. No adjustments to story routing, narration, encounter state, rewards, XP, choices or completion outcomes in an art PR.
8. Run `npm run art:inventory`, `npm run art:verify`, `npm run content:validate`, `npm run typecheck`, `npx vitest run tools/content/gemfall-interactions.test.ts`, Gemfall compatibility tests, client presentation/prefetch tests and the production build/bundle gate. Include screenshots or a short visual review catalog, not only automated green checks.

## 5. Delivery order

Ship **chapter-sized, reviewable PRs**, not a single asset dump:

1. **Pilot:** Gemfall chapters 01 and 02. Deliver their relevant fight and location paintings and interaction art with actual TV/phone screenshots. Settle style, registration and chapter presentation workflow here.
2. **Fight pass:** Fill the remaining fight-arc paintings, with each intro/outcome consistent and readable.
3. **Location pass:** Fill the 49 location-backdrop requests in chapter groups, preserving the explicit exclusions.
4. **Interaction pass:** Paint/reuse the requested props, tracking covers, memory/sequence symbols and play options by chapter, verifying all of their use sites and prefetch behavior.
5. **Final visual playthrough:** Inspect both paths of each fight, phone interactions, fallback states and longer-story pacing. Close only when the specific painting inventory is delivered or individual omissions are explicitly accepted.

## Done when

- [ ] All **16 fight-arc** paintings delivered and wired to the specified intro/outcome scenes
- [ ] All **49 other location** backdrops delivered and mapped; previously approved scene art is preserved
- [ ] The latest requested Gemfall interaction asset list above is fulfilled (or each intentionally reused/omitted item is documented), using separate story-prop versus painted-option-icon pipelines
- [ ] New story art uses `Chapter.presentation` and #501's authoring/validation and warming, not a parallel hard-coded catalog
- [ ] Scene IDs, registered prop IDs, cover counts and backing art pass validation; tracking never reveals the hidden answer
- [ ] Story/encounter/gameplay digests remain unchanged after deliberate Gemfall hash updates
- [ ] Art inventory, tests, full build and payload gates pass; TV/phone screenshots are reviewed
