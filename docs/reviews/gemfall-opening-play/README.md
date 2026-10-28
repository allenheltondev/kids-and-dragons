# Gemfall opening: a crew, a city, and a road

Fifth wave from the [campaign audit](../gemfall-play-design/audit.md), using the [chapter-cohesion skill](../../../.claude/skills/chapter-cohesion/SKILL.md). Covers 01 The City That Smelled Opportunity and 02 Green Roads North. Main, including merged #530, is integrated; this PR adds only the opening wave.

## Play and payoff

| Choice | Immediate play or cost | Later consequence |
| --- | --- | --- |
| 01: help the newcomers carry bags | Balance the family load, keeping its fishbowl level | The existing family-at-inn invitation remains available. Walking them to the founder plaques still gives the different existing charm reward. |
| 01: check the post's route cards | Share clues and arrange the labeled mail bags; earn the existing whistle | When the sack splits, use the checked bags for a catch-and-pass mail rescue. Missing the card puzzle does not unlock this prepared route. The original precision catch remains available. |
| 01: feed the couriers instead | Spend real supper or honeycake | Keep their existing friendship and the returning courier's sky-stone account. Feeding them does not invent checked bags. |
| 01: tell a story at the inn | Each hero contributes a memory or harbor sound | Get warm shelter through participation; a hurried speech remains a separate risky roll, with its existing hayloft outcome. |
| 01: introduce the party to Hesper | Each hero explains a reason to travel or offers a job | Join as crew without a roll judging the child's answer. The original hurried pitch can still lead to the turnip wagon; motive, Mortar and class/species shortcuts remain. |
| 02: check the price board | Shared cost/neighbor/rush clues build the separate-price board | A checked or assisted board grants the existing fair-price flag and later egg-cart ride. A miss gets the seller's correction without that favor. Buying eggs still costs three coins. |
| 02: repair the canal bridge | Balance the replacement beam | The bridge crew's brace becomes an available cooperative hedge job with Pib. Existing successful repair/class/species routes can earn the same help. |
| 02: carry the hay instead | Catch and pass bales to the barn | The hay crew brings long-handled thorn brushes to the hedge. Their assistance gives a different entry route without the original unprepared trimming choice's scratch. They do not grant bridge-mended recognition. |
| 02: ask the hedge politely | Each hero contributes a request, reason or offer of help | Pib and the hedge hear the whole answer. Neither farm favor is required. The old hurried speech and longer path remain. |

Existing meaningful preparation stays: fishing supplies the gull's sardine, orange work earns sailors' road news, Old Wick shows the quiet bridge ledge, newcomers can offer a bed, and Hob's song can call bridge help. Free supplies, inventory costs, six motives, Ember sale/keep, sprite friendship/wronging and all three road commitments remain. New mail/farm preparation flags are local; campaign persistence is not implied.

The city still introduces the realm, rush, three roads, Tidewell's theory, the first humming stone, supplies and caravan life. Tidewell's explanation remains a theory; later discoveries are not rewritten as already confirmed. Shorter transitions keep concrete jokes: the watching sardine, an envelope for THE DUCK, Flint's covered bidding bell and a turnip applying for a crew job. Existing art-pilot activities and their presentation remain.

## Thirty-minute plan and limits

Both declared targets are approximately thirty minutes. Planned movements include reading, discussion, every hero's contribution and activity turns:

| Chapter | Planned minutes |
| --- | --- |
| 01 | 6 red night and motive; 8 newcomers/post/sky-stone; 8 Ember/supplies/shelter; 8 farewell, crew and departure |
| 02 | 7 fields and egg stall; 8 creatures and canal priority; 7 night/Harvest Stone; 8 hedges, road news and final vote |

These are **plans, not measured family timing**. The older uncalibrated model does not budget authored activity time and still predicts more than thirty minutes:

| Chapter | Shortest predicted minutes before → after | Typical predicted minutes before → after | Shortest scenes after |
| --- | --- | --- | --- |
| 01 | 42.5 → 34.7 | 41.9 → 35.3 | 46 |
| 02 | 37.6 → 33.0 | 40.6 → 35.8 | 41 |

Shortest routes retain sixteen votes each, four/one checks respectively, and a fight. Reading runs stay at two scenes or fewer. There are no added waits or required retries. The remaining risk is session length, especially first-time onboarding and four-player discussion. Use the [revision-aware family-session tracker](../../session-timing.md) to decide what needs further trimming; no observed household timing was fetched here. These revisions do not establish that either chapter consistently fits thirty minutes.

## Compatibility and test evidence

The immutable fixture is extracted from pre-wave `8b32d2fe`. All **20 shipped check definitions** remain exactly equal, including prompts, TNs, rollers, outcomes and effects. Tests serialize open prompts and resume low/high rolls with one/two/four seats. Original scene/choice IDs, encounter numbers and terminal effects remain. Only the two chapter file hashes were re-pinned; gameplay digests and the fixed legacy-save fixture remain unchanged.

The before/after campaign probe loads both content trees through the real loader, including encounter normalization. Ending, road and setback digests match; fresh-save fight play-on matches after normalizing generated hero IDs. The fixed pre-epic save replay also passes. Raw JSON is not substituted for loader-normalized encounters in this comparison.

There are 70 opening route/art/legacy cases. The `miss-supported` profile submits incorrect timing/sequence/memory/tracking answers and checks actual failure results. Cooperation, balance, relay and free play have no failing player action; those complete successfully in this mixed profile, and their defensive `onFailure` edges are not claimed as executable failure coverage. Premature-completion tests confirm no preparation award. Cases also cover true six-coin city starts, sale proceeds, actual food consumption, absent favors, species/class shortcuts, every motive, all roads and sprite outcomes.

675 targeted content/voice/compatibility tests passed. The full local suite initially found three new campaign-seed stalls: the test driver did not help up a fallen ally occupying a narrow mimic-bridge attack position. It now uses the real legal `help_up` action when no enemy attack is available. Encounter rules, maps and numbers are unchanged. All 53 real-server campaign playthrough tests pass after that fix; the combined campaign/opening/compatibility rerun passed 134 tests. Final small dialogue/assertion polish passed another 158 relevant tests and all 70 opening cases. Typecheck passes.

The broad pre-fix local run recorded 10,274 passed, 11 skipped, nine failed tests. Three were the driver stalls above, now fixed. The other six are known Windows issues: traits/voice-clean CLI launches (`npx`/`.bin/tsx` ENOENT), dev-server SIGTERM save/cleanup, and three CRLF-sensitive guide/profile/generated-size tests. The three CRLF-sensitive suites pass all 22 tests against the exact LF Git blobs; original local bytes were restored afterward. The complete broad suite was not repeated after the driver fix. CI must check the final branch on its normal host.

Content validation: 117 pass with four pre-existing Riftlight warnings. Continuity: four allowlisted candidates, no new/stale entries. The obsolete Old Wick allowlist entry was removed because the revised first introduction is sufficient. Voice source lines were refreshed while profiles, assignments and review history remain identical to main. Curated audition passages are unchanged.

## Visual review

No new artwork was needed. Existing post, dock, inn, caravan and hedge environments/cast plus bag, letter, plank, hay and fern props cover the new activities. The canal beam uses the Sunward Fields biome instead of borrowing a misleading deep-gorge backdrop. Borrowed braces and brushes are not silently granted as inventory.

Actual TV (1920×1080) and phone (390×844) captures were inspected:

- [Post route cards TV](interaction_post_routes-tv.png) / [phone](interaction_post_routes-phone.png): Quill, the labeled-bag prop and sufficient shared clues.
- [Prepared hedge brace TV](interaction_hedge_brace-tv.png) / [phone](interaction_hedge_brace-phone.png): Pib, the branch brace, support control and solo prop alternative.

Captures use an isolated temporary solo preview; ordinary household saves were not used. Chapter 02 displays as chapter 1 only because the preview stages one chapter. Shipped ordering is unchanged. Phone captures show actual Your turn controls, with normal scrolling for content below the viewport.
