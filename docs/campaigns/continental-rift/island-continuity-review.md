# The Island Due Back — implementation and review

This draft continues `whale-road` with the agreed Sky key node. It is an ordinary
regional chapter, followed by an explicit development pause. The returning island's
mooring stone shows a small old arrangement of the land below. The carving has no
readable date, maker or cause. It does not reveal the islands' origin or a full map.

## Entry and exit

`whales-to-island` is available whether the party guided the whales, forced Olivia's
opening, or left her offer undecided. The chapter reintroduces Pip and its unnamed
kitsune keeper. Earlier fellowship and Chime introductions are proved across every
incoming graph route, including the Coast return. `whales` is introduced on every
whale-road ending; the optional whale-assisted method also checks the actual outcome.

The return edge goes to the whale-road hub. Both nodes use pass revisits after
completion. The chapter pays 140 XP once, has no bonus XP, item fragment, combat or
mandatory damage. The new pause pays zero. The preview now has 18 story nodes,
11 pauses and 44 edges; convergence and the finale remain unwritten.

## Scene sweep

| Scene family | Introduction and resulting behavior |
| --- | --- |
| `arrival`, `return_song` | Establish keeper, Pip, bell, board, cloths, song slips and three identification signs before their use. The song predicts a return without providing an exact date. |
| `sightings` | Establish fixed observation marks before comparing movement. Guided whales offer a TN 8 method; scattered whales do not appear or supply a navigation cue. Unresolved whale choices use the ordinary ground methods. |
| `priority`, `letters`, `station` | Introduce the messenger, sealed letters, fence and station before choosing a job. Only one rescue job is played. Success preserves either a ready messenger or a working signal frame; failure leaves wet letters or a station needing repair. A duskrunner can assist the existing bag check. |
| `signal_plan`, `bearings` | Teach both cloth meanings before practicing a relay. The repeated-signal plan unlocks TN 8 for the same gap check. Failure leaves the party's estimate unfinished and requires a keeper's separate observations. |
| `landing` | The keeper lays the board, another keeper crosses first, and the party follows. Verified estimates support Pip's return watch; incomplete estimates need a second lookout. Failed landing checks lead to a party decision: carry equipment in batches and delay the message relay, or leave bulky gear and borrow a small kit. Thornguard Brace assists a normal check. No rope or hero arrests an island's drift. |
| `stone_care`, `carving` | Introduce the mooring eye, grooves, brush, blank sheet and later crack. Failed recording leaves a dotted meeting point; a clear record unlocks an easier later comparison. Nobody removes stone or claims missing marks were recovered. |
| `orientation`, `comparison` | Present raised marks, uncertain grooves and today's separate ridges without the joined-land conclusion. The chosen successful test reveals that pattern. Failure opens a different hands-on comparison: measure two clear marks with the keeper holding a scale, or trace them with Pip pointing from the viewing mark. The party notices the difference and shows its helper. Every path introduces the discovery before `alternative`; none supplies history beyond it. |
| `alternative`, `record` | Challenge decoration versus local view and explicitly retain unknown age/cause. Permission to copy is voluntary; shared records retain credit and gaps, private sketches stay with the party. |
| `departure`, `return`, `rest` | Establish the temple in the moving island's course before the warning choice. The first message is either a course warning or an invitation for another reader. A sent warning is never claimed received without an answer. The return refers to the actual rescued resource, evidence credit and sharing permission. All paths learn the clue. |

The per-scene continuity ledger checks literal introductions on every actual engine
branch, including conditional references to the exclusively visited rescue scene.
The proper-name audit and cross-chapter prerequisite proof run alongside it. No
continuity allow-list was added.

## Persistent consequences

| Flags | Meaning and later use |
| --- | --- |
| `whales_guided`, `whales_scattered` | Existing journey history; changes arrival and availability of the whale-assisted sighting. Never overwritten here. Olivia's trust is preserved. |
| `island_messages_saved`, `island_station_ready` | Mutually exclusive successful work priorities; changes warning resources and final messenger/station reactions. Both may be false after failure. |
| `island_signal_repeated` | Temporary practiced relay; unlocks the easier bearings check, then clears after the check. |
| `island_approach_verified` | Party's own completed gap test; changes who supplies the return observations. |
| `island_carving_clear` | Clear join versus dotted uncertainty; changes the comparison and opens an easier evidence test. |
| `island_land_match` | The initial independent comparison succeeded. False preserves the unfinished initial test even after the party discovers the pattern in its chosen assisted follow-up. Later credit reflects that distinction. |
| `island_relay_delayed` | A failed landing led the party to carry the full kit in batches. Keepers help carry, leaving even a prepared frame without a sender until the return. The departure and return acknowledge the later dispatch. Borrowing a light kit preserves the relay's place. Dry letters remain dry in either case. |
| `island_record_shared` | Permission to retain a copy. It never authorizes private correspondence or transfers the stone. |
| `island_warning_sent` | Course warning chosen as the first message, not confirmation of receipt. False means inspection invitation first and routine warning next. Available for the future temple continuation. |
| `fragment_sky_learned` | Guaranteed knowledge from the key node, not an inventory object. Only this chapter sets it. |

Arrival clears only the nine local investigation flags. Graph pass revisits preserve
the completed result and do not re-enter arrival. Cross-strand fragments, Chime,
whale history and trust flags are retained.

## Pacing and validation

There are 106 authored scenes across alternative methods/outcomes, with 43–47 read
depending on failures: 14–16 decisions and six checks. Recovery choices add no
rerolls. The uncalibrated planning model is about 36 minutes on the shortest
lower-bound route and 39 minutes typical; the brisk-table sensitivity is about
26.9 minutes. Counts are structural checks, not
proof of engagement or observed duration.

`riftlight-island.test.ts` plays complete routes for dry letters, working station,
wet letters and an unfinished station, retaining sharing and warning choices. It
also follows both real rift-opening actions into the island, checks gated methods,
keeps a three-person party at one HP, and tests pass revisits. Mixed-outcome routes
exercise both landing recovery costs and both assisted discoveries. Tests verify
that neither setup nor a failed initial test states the inference before the
party's comparison or chosen follow-up. Simulated routes have six checks and
fourteen to sixteen decisions. These are engine simulations, not family
sessions. Real elapsed timing and the production pacing gate remain open.

The chapter uses the existing Sky Islands biome painting. The mooring face and its
changing views are narrated; the painting is not presented as a clue diagram. A
literal stone illustration is optional future asset work, not a dependency of a
choice or evidence test.
