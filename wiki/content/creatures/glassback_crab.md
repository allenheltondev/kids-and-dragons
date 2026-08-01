---
title: Glassback Crab
id: creature.glassback_crab
type: creature
status: draft
lastReviewed: "2026-08-01"
canon_status: confirmed
tags: ["dangerous", "foothills", "territorial", "burrower"]
classification: dangerous_creature
danger_level: moderate
scale: medium_to_large
sapience: animal
lore_hook: "The most patient misunderstanding in the foothills."
likes:
  - id: creature.embermoth
    title: "Embermoth"
    url: "/creatures/embermoth/"
    because: "It finds the warm ground first and charges nothing for the information."
  - id: character.dragonling
    title: "Dragonling"
    url: "/characters/dragonling/"
    because: "They knock on the burrow stone and wait. The only people who do."
dislikes:
  - id: creature.cinder_wolf
    title: "Cinder Wolf"
    url: "/creatures/cinder_wolf/"
    because: "In deep winter a pack will dig into someone else's warm burrow without so much as a wave."
related:
  - id: biome.red_sky_foothills
    type: biome
    relationship: primary_locations
  - id: location.mount_red_sky
    type: location
    relationship: primary_locations
  - id: biome.red_sky_foothills
    type: biome
    relationship: dangerous_creatures
  - id: campaign.gemfall
    type: campaign
    relationship: creatures
  - id: item.crimson_shard
    type: item
    relationship: dropped_by
  - id: location.mount_red_sky
    type: location
    relationship: dangerous_creatures
assets:
  primary: assets/entities/glassback_crab/portrait.webp
  primaryFull: assets/entities/glassback_crab/assembled.png
ai_context:
  mood: "Large territorial crab-like burrower with a translucent mineral shell."
  themes: "Dangerous, Foothills, Territorial, Burrower"
  visual_style: "Broad crab body with a crystal-like shell that refracts nearby color, heavy digging claws and heat-darkened legs."
  common_encounters: "Cave obstacle, mistaken gemstone formation, sign of a newly warmed tunnel."
  lore_highlights: "The most patient misunderstanding in the foothills."
  related_entities: "biome.red_sky_foothills, location.mount_red_sky, biome.red_sky_foothills, campaign.gemfall, item.crimson_shard, location.mount_red_sky"
  writing_guidance: "Threatens before charging, usually stops pursuing once intruder leaves territory."
  generation_hints: "Defends warm burrows and exposed mineral deposits."
layout: creatures
infobox: creature
---


<!-- BEGIN GENERATED: lore -->
## Lore

> *The most patient misunderstanding in the foothills.*

A glassback's shell refracts whatever color is nearby, which in the foothills is usually gemstone, which is why every treasure rush in history has included somebody trying to mine one. The crab minds enormously. It gives one warning, which is more than most prospectors deserve, and it holds no grudge afterward — off its warm ground, you have never existed.

### For Fun

- Rearranging the mineral garden at its burrow mouth. Taste in arrangement appears to be hereditary.
- Following embermoth swarms to freshly warmed ground, like a prospector who reads the news.
- Holding threat displays at boulders that turned out not to be rival crabs. It takes a while to be sure.

### Getting Along

Solitary and formal. Neighbouring crabs maintain exact, invisible borders that are renegotiated once a year in a ceremony that looks exactly like two rocks facing each other for a day.

### Likes

- **[Embermoth](/creatures/embermoth/)** — It finds the warm ground first and charges nothing for the information.
- **[Dragonling](/characters/dragonling/)** — They knock on the burrow stone and wait. The only people who do.

### Dislikes

- **[Cinder Wolf](/creatures/cinder_wolf/)** — In deep winter a pack will dig into someone else's warm burrow without so much as a wave.
<!-- END GENERATED: lore -->

<!-- BEGIN GENERATED: encounter -->
## In a Fight

**Brute** — Slow, heavy, and hard to move past. Takes a while to bring down and hits hard when it lands.

| | |
|---|---|
| Health | 14 |
| Guard | 12 — how hard it is to hit |
| Attack | +4 |
| Speed | 3 steps, 1 initiative |
| Usually | 2 of them |

### Ways Past It That Are Not Fighting

- **Observation** (Clever, easy) — It threatens before it charges, so the warning is the whole encounter if somebody reads it.
- **Escape** (Quick, normal) — It stops pursuing once you are off its patch of warm ground.
<!-- END GENERATED: encounter -->

<!-- BEGIN GENERATED: relationships -->
## Related Entities

### Biomes
- [Red Sky Foothills](/biomes/red_sky_foothills/) `Primary Locations` `Dangerous Creatures`

### Campaigns
- [Gemfall](/campaigns/gemfall/) `Creatures`

### Items
- [Crimson Shard](/items/crimson_shard/) `Dropped By`

### Locations
- [Mount Red Sky](/locations/mount_red_sky/) `Primary Locations` `Dangerous Creatures`
<!-- END GENERATED: relationships -->


