# Continental Rift — character and faction bible

## The Riftseekers — agreed
An enigmatic **campaign-only** fellowship formed around the rift crisis; it should not become a permanent generalized world faction. Their art direction is their own: mystical aura, dark teal/indigo/violet cloaks, asymmetrical practical expedition gear, silver fractured-circle emblem, shimmering seams, instruments, resonance rings/chimes. Exact designs TBD.

**First appearance:** brief conversation as the party is **leaving the Glacier of Origins**. They are breaking camp and heading elsewhere, not delivering an extended plot explanation. They offer a practical lead that players may follow or ignore.

### Master Orin Vale — agreed core
A **griffin**: canon griffins keep pass ledgers and watch logs, which suits the methodical scholar and explains his first lead. Methodical, patient scholar. Wants to learn **why** rifts exist and **how** they work before attempting large interventions. Fears reckless manipulation. Provides an early exploration lead. His tentative geographical lead is mountain/griffin disturbances; canonical name/location to confirm.

### Lady Olivia — agreed name and core
A **unicorn**: bright, striking and regal. **Name: Lady Olivia** (no surname). Bright, ambitious, confidently wants to **harness rift power for herself**; a nuanced, mischievous, stubborn rival, not a caricature or simply 'evil.' She believes power could enable her to help or repair the world. She may unknowingly repeat the emperor's dangerous belief that strong enough manipulation gives control. Her arc diverges on player decisions and resolves as an epilogue variant: ally, rival or redeemed ([story.md](story.md#finale-and-endings--agreed)). She is never punished.

### Supporting Riftseekers — agreed
Campaign-only, like the rest of the fellowship. **Not in `canon/individuals.yaml`, by decision:** that file requires a home location that owns the character, and a travelling fellowship has none. Like Gemfall's recurring Hessa and the wardens' captain, they live in each chapter's `llmHints.npcVoices`, kept consistent by `faction.riftseekers`, which records every member with pronouns. Corvane stays in `campaign.riftlight`'s creator-only constraints so his name never reaches the player-facing field guide. None is required: each appears wherever the party is, never in one specific strand.

| Who | First appears | Role | Ties to |
| --- | --- | --- | --- |
| **Seren Wisp** (she/her), kitsune, attunement specialist | The glacier departure, the third face there | If the party's Starweaver uses *Read the Riftlight*, Seren reacts in the next scene: "One of you can see it." She later **teaches Attune** in the first regional strand entered. | The Starweaver progression ([mechanics.md](mechanics.md)) |
| **Pip Thistledown** (he/him), manticore, eager scout | The first regional strand entered, scouting the displacements | Hero-worships Lady Olivia; players see Olivia through Pip's eyes. Pip's late choice of whether to follow Olivia's summoning mirrors the party's. | Olivia's arc |
| **Bram Lock** (he/him), bigfoot, protective guard, skeptical of reckless experiments | The convergence | Orin's protector. When Olivia attempts her summoning, Bram tries to stop her, and the party decides whether to help him. | The finale's choices |

The glacier scene stays short: Orin, Olivia and Seren, one lead, no lectures. **Species — agreed:** a mixed fellowship from across the realm, so the rifts visibly touch everyone; with the strand locals (the kitsune temple keeper, the dragonling stone-keeper), every playable species appears on stage. The pairs mirror the theme without saying it: Orin and Bram understand first and go carefully; Olivia and Pip want to harness it; Seren sits between. Seren's reaction hangs off the **flag set by the Starweaver's choice**, not a class check on narration, so it needs no new engine support.

## How the party's choices decide the Riftseekers — agreed
Four flags: helping Olivia hold the linked rifts (Wandering Sky); sharing the chime's readings with Orin (Restless Coast); helping Bram stop Olivia's summoning (the convergence); and Pip's choice.

| | Helped Bram stop her | Did not stop her |
| --- | --- | --- |
| **Helped her in the Sky** | ***Redeemed:*** friends told her no, and she listens. She joins Orin's study. | ***Ally:*** her summoning goes wrong (the colors surprise her), but the party stood by her. She helps hold the land in the finale, humbled. |
| **Did not, or skipped the Sky** | ***Rival:*** she leaves, unpunished, to try her own way. | ***Rival*** |

- **Pip mirrors the party:** if they helped Bram, Pip stays back; if not, he follows Olivia.
- **Orin's flag** opens a non-combat option at the convergence: Orin talks Olivia down instead of Bram stopping her.
- **Skipping the Sky means meeting Olivia cold at the convergence:** a consequence of route choice, never a block on the endgame.
- **Allies in the finale:** an ally Olivia, or an ally wyrm from Forgotten Paths, **counts as one extra anchor** against Corvane's final rift, so 2 fragments plus an ally reaches "overpowered". The battle keeps its two authored versions.

## Ancient emperor — author-only, secret until final reveal
**Emperor Corvane, of Pangea — agreed** (new canon, pending registration; canon has no emperors or empires yet). The name deliberately does not sound like present-day canon names, which are homely everyday words (Old Ossley, Bracken Swiftmile): his sounds old and a little grand, not villainous. Once ruled a geographically different realm, was held captive for about a millennium and is newly free after events of Gemfall. Has extensive experience summoning/manipulating ancient rifts but **cannot prescribe behavior**. Wants to relocate today's landscapes to the layout of his old realm, however disruptive. His nostalgia and certainty make him dangerous without needing a child-inappropriate simplistic 'evil' frame. His actions are not explained to players until the very end.

### Corvane's voice — agreed
A voice guide for his `npcVoices` entry; chapter authors write around it.
- **Confused above all.** He has woken after a millennium into a world that looks broken to him, and he does not understand why the rivers and valleys are "wrong". He is **certain about what should be and bewildered by what is**: the confusion is what makes him sympathetic, the certainty what makes him dangerous.
- **Courtly, patient, sad:** an old king, not a monster. Short sentences, age-8 vocabulary.
- **He calls today's places by Pangea's names and calls them "mine"** ("my rivers", "my valleys"): his tell, heard only after the reveal.
- **Never threatens the children; never says destroy or hurt.** Forbidden for him, beyond Gemfall's list: conquer, punish, servants, and anything implying the present inhabitants do not matter. He simply does not *see* them yet; in the gentler ending he learns to.
- **Before the reveal, no voice at all:** only the patterns he leaves. The yeti's "do not shout near the old ice" is the closest hint.

| Moment | Line |
| --- | --- |
| The reveal | "Why is the river on the wrong side of the mountain?" Then: "Do you know how long I have waited to see my rivers run the right way again?" |
| A fragment anchors the land | "Those stones are mine. I set them there." As the land answers: "It listens to *you*?" |
| His own rift shows colors he did not choose (the theme in one line) | "That is not the color I asked for." |
| The battle | "I only want to go home." |
| Defeated | "It was a very good map." |
| *The Glacier Keepers* | "Wake me if the rivers ever forget their way." |
| *The Ones Who Listened* | "Then tell me what you call this valley now." |
| *Rivers Wander* (loss) | He does not get the last word: Orin's "Then we learn the new map" is the spark. |

## Character collision — planned
Orin seeks comprehension; Lady Olivia seeks power; the emperor seeks restoration. Their different reactions to limits of magic can affect allegiance, access to tools, and the finale. Do not expose the emperor's identity by having Riftseekers refer to him early: before the reveal he is only "whoever is moving the land".

## Existing-world canon protections
Cloud whales are not combat pets; yetis and kitsune possess distinct regional traditions. Do not retroactively attribute the world's protected mysteries to the emperor without an explicit canon decision.
