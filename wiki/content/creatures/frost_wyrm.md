---
title: Frost Wyrm
id: creature.frost_wyrm
type: creature
status: draft
lastReviewed: "2026-07-31"
canon_status: confirmed
tags: ["dangerous", "mountain", "ice", "predator"]
classification: dangerous_creature
danger_level: high
scale: large
sapience: animal
lore_hook: "The glacier's other tenant. It was here first, and the receipts are frozen."
likes:
  - id: npc.yeti
    title: "Yeti"
    url: "/npcs/yeti/"
    because: "Their songs carry through the ice. It has opinions on the repertoire, all favorable, none shared."
dislikes:
  - id: character.griffin
    title: "Griffin"
    url: "/characters/griffin/"
    because: "A shadow crossing the snow is the one shape it has never argued with."
related:
  - id: biome.frostfang_peaks
    type: biome
    relationship: primary_locations
  - id: biome.glacier_of_origins
    type: biome
    relationship: primary_locations
  - id: biome.glacier_of_origins
    type: biome
    relationship: dangerous_creatures
  - id: biome.frostfang_peaks
    type: biome
    relationship: dangerous_creatures
assets:
  primary: assets/entities/frost_wyrm/portrait.webp
  primaryFull: assets/entities/frost_wyrm/assembled.png
ai_context:
  mood: "Large serpentine ice predator that burrows through deep snow and fractured glacier ice."
  themes: "Dangerous, Mountain, Ice, Predator"
  visual_style: "Long low body, digging forelimbs, ice-ridged scales, and a wedge-shaped head."
  common_encounters: "Mountain chase, blocked pass, sign that the glacier is warming or shifting."
  lore_highlights: "The glacier's other tenant. It was here first, and the receipts are frozen."
  related_entities: "biome.frostfang_peaks, biome.glacier_of_origins, biome.glacier_of_origins, biome.frostfang_peaks"
  writing_guidance: "Avoids griffin aeries, defends nesting tunnels aggressively."
  generation_hints: "Avoids griffin aeries but defends nesting tunnels aggressively. Unusual warmth can force them onto paths."
layout: creatures
infobox: creature
---


<!-- BEGIN GENERATED: lore -->
## Lore

> *The glacier's other tenant. It was here first, and the receipts are frozen.*

Frost wyrms tunnel the deep ice along seams older than any map, spiraling their nests around things frozen far below — whether they guard those things or simply like the company is one of the north's politely unasked questions. A wyrm's whole idea of a good year is one in which nothing at all happens near its tunnel, and it enforces this idea with total commitment.

### For Fun

- Coiling beneath the yetis' singing halls to feel the low notes come down through forty feet of ice. The yetis do not know. The wyrm is counting on that.
- Polishing tunnel walls to glass with its ridged scales, for reasons that may be maintenance and may be pride.
- Sleeping through entire seasons, on purpose, starting from a good one.

### Getting Along

A frost wyrm defends the tunnel, never the mountain. It holds no grudges because it takes no notes: leave, and you have solved the entire relationship.

### Likes

- **[Yeti](/npcs/yeti/)** — Their songs carry through the ice. It has opinions on the repertoire, all favorable, none shared.

### Dislikes

- **[Griffin](/characters/griffin/)** — A shadow crossing the snow is the one shape it has never argued with.
<!-- END GENERATED: lore -->

<!-- BEGIN GENERATED: encounter -->
## In a Fight

**Sentinel** — The hardest thing in an ordinary fight. Slow, very well armoured, and it does not leave.

| | |
|---|---|
| Health | 20 |
| Guard | 14 — how hard it is to hit |
| Attack | +4 |
| Speed | 3 steps, 0 initiative |
| Usually | alone |

### Ways Past It That Are Not Fighting

- **Escape** (Quick, normal) — It defends the tunnel, not the mountain. Leave the tunnel and it stops.
- **Observation** (Clever, hard) — Telling a nesting tunnel from an ordinary one, before you are standing in it.
<!-- END GENERATED: encounter -->

<!-- BEGIN GENERATED: relationships -->
## Related Entities

### Biomes
- [Frostfang Peaks](/biomes/frostfang_peaks/) `Primary Locations` `Dangerous Creatures`
- [Glacier of Origins](/biomes/glacier_of_origins/) `Primary Locations` `Dangerous Creatures`
<!-- END GENERATED: relationships -->


