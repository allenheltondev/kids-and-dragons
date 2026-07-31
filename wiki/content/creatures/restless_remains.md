---
title: Restless Remains
id: creature.restless_remains
type: creature
status: draft
lastReviewed: "2026-07-31"
canon_status: confirmed
tags: ["supernatural", "bone_yard", "rare", "guardian"]
classification: supernatural_manifestation
danger_level: high
scale: variable
sapience: variable
lore_hook: "Not a monster. A grievance, wearing whatever was available."
likes:
  - id: npc.merfolk
    title: "Merfolk"
    url: "/npcs/merfolk/"
    because: "The songs reach across the water on still nights, and the bones settle a little lower for hearing them."
dislikes:
  - id: creature.bone_crawler
    title: "Bone Crawler"
    url: "/creatures/bone_crawler/"
    because: "Borrowing pieces from the dead is precisely the category of thing it exists to object to. But they are very small. The grievance is noted, indefinitely."
related:
  - id: location.bone_yard
    type: location
    relationship: primary_locations
  - id: biome.sallow_wastelands
    type: biome
    relationship: supernatural_manifestations
  - id: location.bone_yard
    type: location
    relationship: supernatural_manifestations
assets:
  primary: assets/entities/restless_remains/portrait.webp
  primaryFull: assets/entities/restless_remains/assembled.png
ai_context:
  mood: "Ancient bones temporarily animated when the Bone Yard's rest is seriously disturbed."
  themes: "Supernatural, Bone_yard, Rare, Guardian"
  visual_style: "Movement assembled from existing enormous remains, magic appears as current, vibration, light, or shadow joining the bones."
  common_encounters: "Guardian encounter, consequence of grave disturbance, puzzle to resolve."
  lore_highlights: "Not a monster. A grievance, wearing whatever was available."
  related_entities: "location.bone_yard, biome.sallow_wastelands, location.bone_yard"
  writing_guidance: "Stays dormant under normal conditions. Each manifestation reflects the remains and cause involved."
  generation_hints: "When awakened by grave magic or theft, moves to remove, reclaim, expose, or stop the cause."
layout: creatures
infobox: creature
---


<!-- BEGIN GENERATED: lore -->
## Lore

> *Not a monster. A grievance, wearing whatever was available.*

The Bone Yard mostly sleeps, and prefers to. But when the rest is seriously disturbed, something rises in whichever remains are nearest — not the dead themselves, but the cause: the taken thing, the broken promise, given shape and momentum until it is put right. It does not chase you out of the Yard. It walks toward the wrong until the wrong stops, and then, with visible relief, it lies back down.

### For Fun

- Being still. Between manifestations it is nothing at all, which every account agrees is how it prefers things.
- Settling back down in a slightly different arrangement each time, to the lasting despair of everyone who maps the Yard.
- Listening, if bones can listen, to merfolk song carrying over calm water. The Yard is measurably quieter on singing nights.

### Getting Along

It answers a wrong, not a person. Put back what was taken and it settles mid-stride; speak gently and there is sometimes enough of someone left in it to answer. It has never once pursued anyone past the water line.

### Likes

- **[Merfolk](/npcs/merfolk/)** — The songs reach across the water on still nights, and the bones settle a little lower for hearing them.

### Dislikes

- **[Bone Crawler](/creatures/bone_crawler/)** — Borrowing pieces from the dead is precisely the category of thing it exists to object to. But they are very small. The grievance is noted, indefinitely.
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

- **Restoring Habitat** (Heart, normal) — It woke because something was taken or disturbed. Put it back and it settles.
- **Conversation** (Heart, hard) — There is enough of a person left to answer, if you are gentle about asking.
<!-- END GENERATED: encounter -->

<!-- BEGIN GENERATED: relationships -->
## Related Entities

### Biomes
- [The Sallow Wastelands](/biomes/sallow_wastelands/) `Supernatural Manifestations`

### Locations
- [The Bone Yard](/locations/bone_yard/) `Primary Locations` `Supernatural Manifestations`
<!-- END GENERATED: relationships -->


