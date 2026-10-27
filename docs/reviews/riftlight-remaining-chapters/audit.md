# Riftlight: audit of the remaining chapters

Audited 2026-10-26 using [chapter-cohesion](../../../.claude/skills/chapter-cohesion/SKILL.md)
and its [play design reference](../../../.claude/skills/chapter-cohesion/references/play-design.md).
Scope: all 23 campaign chapters other than the already expanded buried bridge.
This is a design and continuity audit of the earlier workspace snapshot, including the
previous interaction improvements. See [implementation.md](implementation.md) for the first implementation batch and findings already resolved on newer main.

## Main finding

The earlier interaction pass improved individual scenes, but most of the long
chapters still retain the same procedural skeleton: plan a small task, choose
between two sound methods, describe the method, resolve it, explain its limits,
then repeat. On the native shortest paths, **all eleven remaining long chapters
have only two authored interaction scenes**, with 14–15 choice points and four
or five dice checks, plus combat in the strand endings and finale. Alternate
interaction scenes in a file are not additional turns in one playthrough.

This is not an argument to shorten those chapters. Preserve roughly thirty
minutes of worthwhile ordinary-chapter play by building stronger story movements,
using more of the runtime, and letting a few important decisions change later
work. Keep deliberately short meetings and connectors short where that is their
actual role. Do not convert every vote or die into a minigame.

There are also genuine strengths to preserve: the island's competing priorities
and recovery costs; the reading room's independent evidence and publication
options; the valley's remembered crossing route; the Bone Yard's prepared combat
objective; the temple's two tactical plans; the wyrm ally; and the finale's use
of earlier discoveries/allies and its distinct futures for Corvane.

## Ranked findings

P1 means a substantial play-design revision is the next priority; P2 means a
specific confusing, weak or missing payoff; P3 is polish. These are judgments
about family play, not claims that a schema failure or production crash exists.
Check numbers refer to the skill's six checks.

| # | Priority | Scene / evidence | Check | Finding and recommended fix | Kind |
| --- | --- | --- | --- | --- | --- |
| 1 | P1 | [Stone Counters](../../../content/chapters/riftlight-stone-counters.json): `warning`, `warning_1`, `warning_2`; [Whale Road](../../../content/chapters/riftlight-whale-road.json): `waiting_place`; [Wrong Valley](../../../content/chapters/riftlight-the-wrong-valley.json): `bundle_plan` | 3 | Important-sounding tradeoffs frequently have no later gameplay effect. Stone Counters offers one large sign for two approaches, but both outcomes reach `runoff` without recording the placement. Whale Road offers shelter versus visibility, then neither choice affects the later task. Valley offers tools-first versus securing people first, but both proceed through `anchor`, signals, tools and crossing in the same order. Choose a few central priorities and consume them in later tasks, available help, costs or outcomes. Leave other methods as brief flavor rather than presenting them as major decisions. | graph |
| 2 | P1 | [Exchange](../../../content/chapters/riftlight-exchange-rift.json): `delivery_sacks`, `pull`; [Glacier](../../../content/chapters/riftlight-glacier-survival.json): `drift`, `herd`, `seam_response` | 3 | Both ordinary opening chapters claim 15 minutes and contain no authored interactions. On the shortest paths they have 14/19 scenes and one check each. Much of the rescue, carrying, coaxing and singing is narrated as already completed after a choice. The existing opening playtest plan still calls ordinary nodes 30–40 minutes and explicitly exempts the Riftseeker meeting, not these two chapters. Build a fuller opening expedition: hands-on rescue, choosing what help to prepare, and a tested observation whose result matters later. Retain the existing good voices and optional schools. Validate the target with families rather than simply changing minute metadata. | graph |
| 3 | P1 | [Headwaters](../../../content/chapters/riftlight-headwaters-washout.json): `grab`, `early`, `climb`, `rift_choice` | 3 | A successful first ledge roll ends a nominal 20-minute chapter after four scenes, with no ungated binary choice on the native shortest path. More interesting river and rift decisions are downstream of failed rolls. Route consequences are real, but luck determines whether the party gets most of the play. Give an early escape a worthwhile shore-side problem or informed route decision; use varied rescue play rather than requiring failed rolls to see the chapter. Treat the river as a short connector only if that is an explicit session-design decision. | graph |
| 4 | P2 | [Convergence](../../../content/chapters/riftlight-convergence.json): `count`, `count_check` | 1, 3 | The setup says the note changes when **a hanging cord on the screen** is held still. The game instead instructs **“Hold the chime, release it, then compare the sounds.”** Success claims the original cord experiment worked. This teaches the wrong object and muddies the central condition-versus-rule lesson. Manipulate the screen cord in the controls and observe the chime, preferably through direct cooperative hold/release play. | graph + wording |
| 5 | P2 | [Sky arrival](../../../content/chapters/riftlight-sky-islands-arrival.json): `local`, `song` | 1, 3 | The goal is protecting travelers from an unsafe edge. The `song` route only records a difference in where the song is heard, then sets `guarded_the_island_edge`, just like physically moving the warnings. The later scene never establishes a protective marker on that route. Let listening identify the correct warning location, then actually mark it, or distinguish the two accomplishments and pay off each honestly. | graph + wording |
| 6 | P2 | [Cairnstep](../../../content/chapters/riftlight-cairnstep-pass.json): `ledger`, `ridge`, `supplies`, `message` | 1, 4 | `message` always says **“Your party records the changed pass and the possible supply path.”** The ridge branch only compares the mountain outline; the possible supply route is established in the alternative `supplies` branch. Record the branch taken and acknowledge only its discovery, or establish both before merging. A small chapter can still have a specific useful outcome. | graph + wording |
| 7 | P2 | [Whale Road](../../../content/chapters/riftlight-whale-road.json): `sky_repair_1`, `sky_repair_2`; campaign flag `sky_followup_promised` | 3, 4 | The choice to offer a future route report is written and carried, but no later authored scene or campaign condition reads the promise. The test checks that both flag values exist, not that the promise is used. Add a reachable later handoff/help opportunity with an appropriate callback, or frame this as immediate flavor rather than a consequential promise. The separate guided/scattered-whale consequence already works and should remain. | graph |
| 8 | P2 | [Stone Counters](../../../content/chapters/riftlight-stone-counters.json): `road_load_assisted_check`; [Whale Road](../../../content/chapters/riftlight-whale-road.json): `keeper_lesson_assisted_check`; [Wrong Valley](../../../content/chapters/riftlight-the-wrong-valley.json): `tools_return_assisted_check` | 3 | These special class approaches use identical interaction specifications and outcomes to their ordinary equivalents. The former easier TN no longer exists after conversion, leaving an advertised class contribution with no distinct control or later advantage. Give the ability an implemented benefit, a different role or a later saved task while retaining an accessible ordinary route. The island's wider Duskrunner aiming target is a working model; do not invent unsupported stat bonuses. | graph |
| 9 | P2 | [Stone Counters](../../../content/chapters/riftlight-stone-counters.json): `handover_1_check`; [Whale Road](../../../content/chapters/riftlight-whale-road.json): `handoff_sky_1_check`; [Reading Room](../../../content/chapters/riftlight-reading-room.json): `teach_back_1_check` | 3, 6 | Routine explanation/handover is still rolled. Both outcomes tick the same completion flag and merge, usually after an adult character corrects the explanation. These can be short shared demonstrations or useful consequences of earlier evidence quality, without another generic roll. Spend the recovered time on the discovery or a genuine complication. | graph |
| 10 | P2 | [Reading Room](../../../content/chapters/riftlight-reading-room.json): `catalog_cards`, `claim_limit`; [Island](../../../content/chapters/riftlight-the-island-due-back.json): `stone_care`, `carving`, `orientation` | 3, 6 | The central mysteries spend too much time on procedure and caveats. Their choice-card narration totals about 1,132 and 1,439 words across the authored branching files, before result scenes. The reading room's hands-on games are supporting a cradle and rescuing paper, rather than examining the extraordinary memory. Make observation, comparison and a surprising complication the playable center. Keep mystery limits accurate, but say each important limit once rather than making another decision about how to restate it. Preserve the existing meaningful evidence/publication branches. | graph + wording |
| 11 | P2 | [Whale Road](../../../content/chapters/riftlight-whale-road.json): `keeper_lesson_1_check`, `guide`; [Stuttering Flats](../../../content/chapters/riftlight-stuttering-flats.json): `signal_check`, `crossing_check`; [Wyrm Nest](../../../content/chapters/riftlight-wyrm-nest.json): `readers_check` | 3 | Several sequence activities provide the solution in narration, clue text and the displayed option order. “One low note / Quiet pause / Watch the whale” and “Look / Step / Pause” risk becoming ordered button pressing, while the climactic whale movement is then narrated automatically or the goat crossing still resolves with a die. Use information kids actually observe/share, allow the selected plan to change the playable climax, and vary the activity when the fictional job changes. Keep readable clues and assistance; difficulty is not the goal. | graph + wording |
| 12 | P2 | [Exchange](../../../content/chapters/riftlight-exchange-rift.json): `rookery_lesson`; [Glacier](../../../content/chapters/riftlight-glacier-survival.json): `conservatory_sing`; [Sky arrival](../../../content/chapters/riftlight-sky-islands-arrival.json): `dojo_pillows`; [Ashspan](../../../content/chapters/riftlight-ashspan-bridge.json): `academy_stars` | 3 | The class rooms have memorable voices and real class-switch controls, but their lesson actions are narrated instead of played. They are natural optional places for a brief timing, memory, playful or cooperative demonstration suited to each school. Keep them optional and short; do not make the whole chapter's duration depend on taking a class tour. | graph |
| 13 | P2 | [Stone Counters](../../../content/chapters/riftlight-stone-counters.json): `stone`; [Boundary bank](../../../content/chapters/riftlight-boundary-stone-bank.json): `stones`; [Whale Road](../../../content/chapters/riftlight-whale-road.json): `whales` | 2, 5 | The openings present a mystery or location but do not promptly give the children a specific job and human stake in the narration. Stone Counters describes counting and movement; its helping task arrives later. Boundary bank's goal is itself vague. Add a concrete request and reason in the opening, keeping the surprise. Convergence, the strand endings and finale already do this more clearly. | wording; graph if changing the goal |
| 14 | P3 | [Island](../../../content/chapters/riftlight-the-island-due-back.json): `rest` | 6 | Player narration says **“pause this development preview here.”** This is a listed campaign with a continuing temple route. Replace it with an in-world rest/route statement. Internal draft comments can remain internal. | wording |

## Chapter-by-chapter disposition

“SP” below is the native pacing tool's shortest success path with its normal
synthetic party and gates excluded. Games are authored interaction scenes on
that path. A check, combat, debate or free narrative choice may also be worthwhile
play; this table does not equate “games” with all possible fun. All numbers are
reproducible snapshots in [evidence.json](evidence.json).

| Chapter | Target / SP scenes / games | Assessment and next design pass |
| --- | --- | --- |
| Exchange Rift | 15m / 14 / 0 | **Rebuild as an ordinary session.** Keep the snowy breakfast, gull, captain, goat and barge callbacks. Turn rescuing/loading into actual play, then let preparation change the final rescue. See #2, #12. |
| Glacier Survival | 15m / 19 / 0 | **Rebuild as an ordinary session.** Strong goat/herder humor and visible drift feedback. Coaxing, warmth and repeated singing need more participation and a later payoff; preserve the sealed seam and Conservatory. See #2, #12. |
| Riftseekers' Departure | 10m / 14 / 0 | **Keep a short meeting.** The opening playtest plan explicitly makes this an exception. The help-now / safe-routes choice still delivers food and follows the same route either way; treat it as a brief values conversation or give it a later specific use. Four-scene reading run. Let the chime demonstration be a little playable experiment rather than adding lecture length. |
| Ice Shelf Traverse | 15m / 6 / 0 | **Clarify connector versus full session.** High/low routes use the same normal crossing roll; abilities lower the TN, and success/failure genuinely selects the next route. Keep that consequence. If this is a full chapter, add route preparation and direct crossing play; otherwise treat the fifteen-minute field as unverified. |
| Hidden Glacier Rift | 15m / 5 / 0 | **Good consequential short connector; limited participation.** Waking versus leaving the rift changes what can be crossed, and return visits remember it. The actual song and chime test are narrated. Make them a small experiment if expanding, without turning a good short discovery into procedural padding. |
| Headwaters Washout | 20m / 4 / 0 | **High-priority route/play redesign.** Five meaningful exit outcomes and useful species options, but successful play ends fastest; failures unlock most decisions. See #3. |
| Frostfang Shore | 8m / 3 / 0 | **Keep as a recovery connector if intentional.** A clear ladder/shore transition, not currently a full-session adventure. Moving the rung is a kind gesture, not a lasting mechanical branch. Avoid inflating it merely to thirty minutes. |
| Cairnstep Pass | 10m / 4 / 0 | **Short discovery connector with a merge error.** Give the compared ridge versus supply route distinct, truthful results. The new pass and signal exchange are good hooks. See #6. |
| Boundary Stone Bank | 8m / 4 / 0 | **Short hub needing a clearer job.** Compare the old mountain or reset today's marker; both currently set the same helper flag and end. Keep it light if this is a hub; make the chosen contribution visible when the party next meets the keepers. See #13. |
| Ashspan Bridge | 14m / 4 / 0 | **Short ferry/class hub.** Existing no-roll help and duck/telescope humor are improvements. Plank and rope methods converge; the optional Academy carries most additional content. Keep it a hub or author a consequential ferry outing if it should fill a whole evening. Preserve #12's optional school opportunity. |
| Sky Islands Arrival | 12m / 6 / 0 | **Short arrival hub with an inaccurate achievement.** Listening versus markers should change what is learned without falsely claiming both protect the edge. Keep the arrival-by-flight variant and Dojo. See #5, #12. |
| Saltrot Arrival | 12m / 5 / 0 | **Short arrival hub.** The Skupper's shell-bank lesson is clear. Bag versus path is valid flavor but has the same helper flag and no later distinction. Good place for a small relay/route activity, not an excuse for another long school lesson. |
| Stone Counters | 35m / 44 / 2 | **First major regional redesign.** Four checks and fourteen decisions sit around a moved-stone mystery; many alternatives are mechanically identical. The sign budget, cart and changed land should drive consequences, not repeated record demonstrations. See #1, #8–10, #13. |
| Whale Road | 35m / 42 / 2 | **First major regional redesign.** Protect its real gentle-versus-early-opening consequence. Much of the preparation is procedural; guiding the whales is still narration. Play the greeting/turning response, make visibility/shelter matter, and pay off the promised report. See #1, #7–11. |
| The Wrong Valley | 35m / 44 / 2 | **Major regional redesign.** Good river-return revelation and actual remembered high/low crossing. Tools-first versus people-first does not change task order. Let the river's return make the chosen preparation useful and require different recovery work. See #1, #8. |
| Reading Room | 35m / 42 / 2 | **Preserve good consequences; move play into the discovery.** Separate observers, signed co-reading, filing success, publishing and privacy have real later uses. Keep those. Reduce the repeated catalog/claim-limit discussions and unnecessary teach-back roll. See #9–10. |
| The Island Due Back | 35m / 43 / 2 | **Strongest existing consequence scaffold.** Mail versus station, repeated signals, copied detail, borrowed tools versus delayed relay, and warning priority all affect later options/text. Its eight authored activity scenes include alternatives: a normal path sees two. Play the return song/carving and reduce repeated viewpoint/protection/setup discussion. Remove preview wording. See #10, #14. |
| Stuttering Flats | 35m / 43 / 2 | **Good rescue premise; too much procedural rehearsal.** The goat and Skupper voices are clear, with a credible rescue across two banks. Most approach, ground, sling and signal methods rejoin the same controls. Make route/signal preparation affect the rescue climax rather than another generic crossing roll. See #11. |
| Bone Yard | 35m / 43 / 2 + fight | **Keep its rule and objective combat; deepen preparation.** Preparing the seam shortens the closing objective from three turns to two. The spare-mat decision and many report/return methods do not affect later work. Use the rule that objects return as a playable investigation, then let selected gear or path matter. |
| Wyrm Nest | 35m / 45 / 2 + fight | **Keep the humane objective and ally.** Driving off versus holding the hollow remains available on the board; objective victory and defeat alter the room and ally state. A long setup and post-combat furniture/report sequence dilute the creature encounter. Give shelter/noise choices useful roles in moving the wyrm, and make the aftermath respond to its result. See #11. |
| Squall Temple | 35m / 45 / 2 + fight | **Preserve distinct tactical plans.** Turning the island versus holding shelter has different objectives and outcomes. Most preliminary methods and later gutter/board/repair tasks remain linear. Let preparation choose which job can be done well, then carry the cost into the chosen board objective and repairs. |
| Convergence | 35m / 45 / 2 | **High-priority pre-finale redesign and lesson correction.** The genuine central decision affects Olivia and Pip, but is surrounded by thirteen same-mechanics candidates. Make shared discoveries into an actual comparison experiment and let the party practice holding its condition. Correct the cord/chime mismatch. See #4. |
| Finale | 40m / 48 / 2 + fight | **Targeted tension/pacing pass.** Preserve the reveal, ally/third-discovery support, objective victory, loss recovery and Corvane's futures. Many retreat/map/shelter/signal choices change only their immediate description. Make earlier preparation useful during the confrontation; avoid resetting tension with another sequence of mandatory check-and-report chores. A forty-minute finale may remain appropriate. |

The short connector/hub descriptions above describe current content, not a new
approval to reduce ordinary campaign session lengths. Establish which nodes are
full sessions in the campaign's playtest plan; metadata ranging from eight to
fifteen minutes does not itself establish that design decision. The two opening
chapters already have an unresolved ordinary-session length gate in
[opening-playtest.md](../../campaigns/continental-rift/opening-playtest.md).

## Campaign-level risks and strengths

### Most activity variety still sits outside the central mystery

The interaction conversion repeatedly chose a sliding bag/tray, a load to level,
or something to hold. Those are useful breaks but leave the extraordinary events
mostly in prose: whales turning through folds, river courses changing, memory
ice revealing another landscape, and a wyrm deciding where to settle. The next
pass should spend the thirty minutes on those events, using the built shared
world, classes, rifts, clue sharing and boards. Do not add all mechanics to every
chapter; an activity should express a fictional action the children care about.

### Repeated safety and evidence language crowds out voice

Necessary boundaries often recur before every small method choice: stay on firm
ground, do not assume a cause, do not claim a date, do not cross, do not promise
someone else's help. Those truths should remain, but can usually be established
once and then demonstrated. In the longer investigations, a short reading run
can still contain very long decision cards. A vote every two scenes does not
solve listening fatigue. Keep the goat chewing, the muddy cloakroom, the raincoat
on the bell rope and the awkward map paperweights; use these character details
around concrete action instead of expanding the cautions.

### Keep what already has real effects

- The valley's actual high/low crossing gets an accurate reading-room callback.
- The reading room's observer choice unlocks a comparison; different evidence
  quality affects what the party can claim and whether a visitor guide works.
- Island priorities determine whether mail or a signal station is available;
  failed landing recovery can delay a relay or require borrowing a smaller kit.
  Practicing repeated signals and clearer recorded carving also help later checks.
- Bone Yard preparation improves its seam objective; lost combat takes a longer
  return route rather than inventing a win.
- Temple push/shelter fights have different board objectives and resulting land
  positions. The wyrm's objective outcome can create an ally.
- Convergence changes Olivia's standing and Pip's behavior, including a bridge
  chime-sharing option. The finale can use allies/another discovery to weaken
  the encounter, and retains three distinct overall endings.

These are better patterns for additional consequences than merely adding flags
or extra ending adjectives.

## Verification and limits

Commands run for this audit:

- `npm run content:validate`: **116 passed, two existing warnings** about Corvane's
  encounter creature references. Schemas and scene graphs pass.
- `npm run content:continuity`: **zero new findings and zero stale allow-list
  entries**, with seven existing allowed candidates across four campaigns.
- `npm run content:pacing -- --chapter riftlight- --json`: inspected shortest and
  typical path metrics and openings. Predictions are uncalibrated and exclude
  dedicated interaction time; none are family observations.
- `npm run content:graph`: regenerated the scene-graph reading artifacts.
- `cohesion.mjs opening`, `merges`, `setbacks`, `idioms` for Riftlight; concept
  sweeps for the departure's Listening Chime and the reading room's memory ice.
  No idiom hits. The chime's introduction dominates its later references on that
  non-interaction route.
- `npx vitest run tools/content/riftlight`: **201 tests passed; one failed**. The
  failed preview Ctrl-C/process-cleanup test timed out after twenty seconds.
  It timed out again when run alone; the other three preview tests passed.
  This does not establish a chapter-story failure, but the full test group is
  not green. No test was disabled or changed for this audit.

### The older cohesion helper has an interaction blind spot

`tools/content/cohesion.mjs` recognizes check and encounter result edges, but not
interaction edges. Its merged-path, concept and setback output stops at an
interaction. In this audit it incorrectly reported the finale loss epilogue as
unreachable and reading-room scenes after the first interaction as unreachable.
Those outputs are **not** evidence of a real softlock or absence of leaks. The
shared scene-graph code understands interactions, the content validator passes,
and the engine path tests reach those outcomes. Before using the helper as a
complete audit gate, extend its edge and branch-text handling for interactions
and exercise the corresponding regressions. This is an audit-tool follow-up,
not a proposed chapter change.

The evidence collector's same-mechanics candidates ignore prose/art/cast and
follow deterministic result chains to their next decision or activity. They are
review aids, not automatic defects: alternate roleplay methods, tactical intent,
optional lessons and humor can be worthwhile without changing resources. The
ranked findings above distinguish concrete missing consequences from those
judgment calls. The audit reviewed the openings, task/control flow, major
branches and representative merges; it does not claim a human playthrough of
every combination of all twenty-three chapters.

No family timing or enjoyment observations were created. Planning budgets and
successful tests cannot establish that children will enjoy a chapter for thirty
minutes.

## Recommended order for the next implementation pass

1. Fix the cord/chime lesson, inaccurate sky-edge achievement, Cairnstep merge
   wording and preview narration; implement or retire the unconsumed promise.
2. Redesign Stone Counters, Whale Road and The Wrong Valley around a few explicit
   priorities with later uses, preserving about thirty minutes of varied play.
3. Build the two opening chapters into the intended session length, then give
   Headwaters a worthwhile success route instead of hiding most play after misses.
4. Preserve and refine Reading Room / Island's stronger consequences; put more
   interaction into their discoveries. Give class-specific methods real benefits.
5. Tune rescue/strand endings and Convergence, then the finale, around the new
   setup and payoff structure. Keep short hubs as hubs where intentionally brief.
6. Family-playtest per act, solo and multiplayer, before accepting any claimed
   session duration. Update tests to assert changed tasks and costs rather than
   enforcing more scenes, votes or rolls.
