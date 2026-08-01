---
title: Echo Hunter
id: creature.echo_hunter
type: creature
status: draft
lastReviewed: "2026-08-01"
canon_status: confirmed
tags: ["dangerous", "underground", "blind", "predator"]
classification: dangerous_creature
danger_level: high
scale: large
sapience: animal
lore_hook: "It has never seen anything in its life, and it knows the tunnels better than you know your own name."
likes:
  - id: npc.stone_troll
    title: "Stone Troll"
    url: "/npcs/stone_troll/"
    because: "They knock on stone before entering a passage — in its language, the height of good manners."
dislikes:
  - id: creature.bone_crawler
    title: "Bone Crawler"
    url: "/creatures/bone_crawler/"
    because: "A crowd of clattering shells is a paragraph with no punctuation. It cannot bear it."
related:
  - id: location.skullwater_cave
    type: location
    relationship: primary_locations
  - id: location.skullwater_cave
    type: location
    relationship: dangerous_creatures
assets:
  primary: assets/entities/echo_hunter/portrait.webp
  primaryFull: assets/entities/echo_hunter/assembled.png
ai_context:
  mood: "Blind underground predator that maps tunnels and tracks movement through sound."
  themes: "Dangerous, Underground, Blind, Predator"
  visual_style: "Pale low-slung body, no functional eyes, broad listening frills, and long gripping limbs."
  common_encounters: "Stealth encounter, evidence of pressure from deeper underground, guardian of an abandoned tunnel."
  lore_highlights: "It has never seen anything in its life, and it knows the tunnels better than you know your own name."
  related_entities: "location.skullwater_cave, location.skullwater_cave"
  writing_guidance: "Designed for darkness without gore or grotesque human features."
  generation_hints: "Remains still while listening, investigates repeated sounds, retreats from overwhelming layered noise."
layout: creatures
infobox: creature
---


<!-- BEGIN GENERATED: lore -->
## Lore

> *It has never seen anything in its life, and it knows the tunnels better than you know your own name.*

An echo hunter's memory is a library of sound: every drip, every chamber, every visitor filed by footfall. It does not patrol so much as proofread — a new sound in a known tunnel is an error in the text, and the hunter will keep returning to the sentence until it parses. It is not cruel. It is thorough, in the dark, which can amount to the same thing for the unprepared.

### For Fun

- Re-listening to favorite chambers the way a person rereads a good book.
- Adjusting a tunnel's drip pattern, one moved pebble at a time, until the chamber sounds right. This can take years. The hunter has years.
- Following an interesting new sound for days at a courteous distance, cataloguing.

### Getting Along

Entirely solitary, and by its own lights entirely polite. Approach making steady, unhurried sounds and it files you under known; approach in chaos and you are a problem the dark now needs to solve.

### Likes

- **[Stone Troll](/npcs/stone_troll/)** — They knock on stone before entering a passage — in its language, the height of good manners.

### Dislikes

- **[Bone Crawler](/creatures/bone_crawler/)** — A crowd of clattering shells is a paragraph with no punctuation. It cannot bear it.
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

- **Distraction** (Clever, normal) — It hunts one repeated sound and retreats from many at once. Make the dark noisy.
- **Escape** (Quick, hard) — Leaving in silence, which is harder than leaving.
<!-- END GENERATED: encounter -->

<!-- BEGIN GENERATED: relationships -->
## Related Entities

### Locations
- [Skullwater Cave](/locations/skullwater_cave/) `Primary Locations` `Dangerous Creatures`
<!-- END GENERATED: relationships -->


