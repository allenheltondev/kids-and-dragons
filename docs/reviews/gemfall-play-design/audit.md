# Gemfall play-design audit

Audited 2026-10-27 after Riftlight's deeper chapter passes, using
[chapter-cohesion](../../../.claude/skills/chapter-cohesion/SKILL.md) and its
[play-design reference](../../../.claude/skills/chapter-cohesion/references/play-design.md).
Scope: a structural inventory of all 16 authored files, with targeted source and
merge review for the first proposed wave. They form an eight-evening playthrough
with routed chapters. This is not an exhaustive family playthrough or a claim
that every merge has already been human-reviewed. This audit makes no Gemfall
content or compatibility-golden changes.
Riftlight's [graphics closeout](../riftlight-graphics-audit/README.md) found no need
for new commissioned images and fixes two small uses of existing art.

## Main finding

Gemfall already has a lively voice, strong route changes and important campaign
choices. Its problem is not a lack of consequences everywhere. It is the repeated
small-job rhythm around those choices: explain, select a method, roll, hear the
result, meet the next request. The corpus has **194 authored dice checks and 84
activities**. These are totals across alternate paths, not one family's session.

Examples include putting markers in order, sorting letters, moving a wagon,
watching a herd pattern, carrying a brace, tracing a boundary and passing a leash.
Many are concrete enough to play directly. Keep dice where uncertainty and a
changed outcome are interesting; do not replace every roll with the same minigame.
Keep conversational flavor too, without calling every different reply a major
consequence.

The shorter reading runs look healthy (usually one to three beats), but that
alone does not make the jobs diverse. Most current chapter estimates are 40–46
minutes, and the finale is 55. The older pacing model predicts roughly 34–51
minutes on short success routes *before* budgeting authored activity time.
These are uncalibrated estimates, not family timing. Moving toward approximately
thirty minutes requires fewer mandatory handoffs and repeated explanations,
not simply adding an activity after every existing roll.

The first two chapters have an extensive art pilot, not a completed deep play
redesign. Their four activities each are strengths to build on, not proof that
all their choices or timing already work.

## Ranked findings

1. **P1: preserve the campaign's decisions while changing the middle.** Road,
   crossing, forest outcome, faction, pursuit and clock already affect later
   content. Preserve these actual payoffs; give selected equipment, observations
   and helper priorities a later task to change. A new local preparation flag is
   not persistent merely because it was written. See the
   [carryover contract](../../campaigns/gemfall-authoring.md#2-what-survives-between-evenings).
2. **P1: the first implementation wave should be 03A/03B.** These contain 14/15
   checks and 4/5 activities. `check_markers`, `check_heron`, `check_night_rope`,
   `check_ribbon_duck`, `check_fog_lookout` and `check_gate_rubbing` offer direct
   observation/handling opportunities. Replace the repeated jobs around the toll
   and fog movements, rather than changing the established crossing/reroute costs.
3. **P1: keep the chapter-six reveal and finale's philosophical breadth.** Do
   not move confirmed seal/titan knowledge into earlier observation puzzles.
   Restore, Destroy, Control and Exploit stay available to every pursuit in the
   seal chamber. Prior history changes effort and resources, not access. The
   existing titan board and its distinctive play are assets to preserve.
4. **P2: distinguish a child's contribution from persuasion luck.** Checks such
   as 01's `check_signon`, 03A's `check_kettle`, 04B's `check_roll_call_truth`,
   05C's `check_one_rule` and 08's `check_verdict` mix roleplay and a statistical
   gate. Let children make the contribution; put uncertainty in an understandable
   NPC response, practical job or cost. Do not make a low roll mean that an honest
   explanation was false. This is a design opportunity, not a claim that all
   Heart checks should disappear.
5. **P2: turn a few preparations into later capabilities.** 03A already offers
   ordinary/easier crossing checks (`check_crossing`, `check_crossing_easy`).
   08 already varies tether difficulty and Keystone handling by pursuit. Keep
   these real advantages and make their preparation/play observable. Avoid
   calling a changed sentence a new capability.
6. **P2: protect free choices from mandatory chore chains.** 01's crowded-street
   errands and 07R's returning-stone requests have warmth and good individual
   jokes, but repeated meet/help/roll handoffs compete with the main job. Group
   related requests into one movement and let a priority determine later work.
   Keep small funny moments without stretching every one into another check.
7. **P2: regenerate compatibility evidence deliberately.** Gemfall's file
   hashes, ending/route probes and legacy-save behavior are pinned. A planned
   redesign is in scope, but blindly replacing hashes would hide regressions.
   Compare old/new outcomes, explain deliberate changes, and test old saved
   prompts as well as fresh starts. Changing a saved check's scene into an
   interaction without handling its stored roll prompt needs explicit testing.

Sources: [content format and interaction controls](../../../content/README.md),
[Gemfall story/beat ladder](../../campaigns/gemfall.md),
[authoring and persistence](../../campaigns/gemfall-authoring.md),
[compatibility probe contract](../../../packages/server/src/handlers/gemfall-compat.test.ts).

## Chapter-by-chapter pass

Counts below are all authored branches. The estimates are the current declared
values; neither column establishes observed duration or fun.

| Chapter | Current minutes | Checks / activities | Keep | Deeper-pass target |
| --- | ---: | ---: | --- | --- |
| [01: The City That Smelled Opportunity](../../../content/chapters/gemfall-01.json) | 45 | 9 / 4 | Motive, Ember decision, onboarding, outfitting and northbound close | Consolidate dock errands. Play letters/rumor sorting or price rhythm; let a preparation chosen here change later local work. Keep the lantern/tray/relay activities and their art. |
| [02: Green Roads North](../../../content/chapters/gemfall-02.json) | 45 | 11 / 4 | Road fork, sprite relationship, Harvest Stone and land paying for the rush | Keep egg relay, hats, bells and wagon play. Make priorities during the tremor/bridge movement change the next job; trim repeated introductions before the road choice. |
| [03A: The Long Mile](../../../content/chapters/gemfall-03a.json) | 42 | 14 / 4 | Old Lintel's story toll, humming clue, night in the queue, dry/wet crossing cost | Play marker reconstruction, heron observation and night-rope handling. Make queue help/river preparation affect the crossing and recovery. Preserve the drake/crawler alternatives and carried crossing state. |
| [03B: What the Marsh Remembers](../../../content/chapters/gemfall-03b.json) | 46 | 15 / 5 | Gullet, lost-things trade, fog, old-note clue and real choice of exit | Connect a selected helper/tool to fog navigation or raft handling. Play a checked rubbing/listening job without explaining what the Hollow Gate is. Preserve walk-over/rush rerouting and costs. |
| [03C: The Ford That Decides](../../../content/chapters/gemfall-03c.json) | 40 | 9 / 9 | Existing goat/queue/bard activities and clean/failed ford consequences | Use the stronger activity mix as a baseline. Make the chosen queue priority change ford preparation or wet-kit recovery; avoid repeating 03A's whole crossing design. |
| [04A: The Pride Roads](../../../content/chapters/gemfall-04a.json) | 42 | 10 / 5 | Country responding to stones, pride routes and genuine carried callbacks | Play the herd/marker/lullaby jobs in distinct ways. Let the chosen route marker or helper priority change the later road task. Consolidate stand-alone errands. |
| [04B: The Forest Takes Attendance](../../../content/chapters/gemfall-04b.json) | 44 | 11 / 5 | Honest inventory, forest counting, mended/finished glade and noise/silence approaches | Make herd observation, mending and echo handling direct play. Preserve different forest outcomes and do not assume which chapter-three road this party played. |
| [04C: The Road That Remembers](../../../content/chapters/gemfall-04c.json) | 44 | 12 / 6 | Road memory, institutions, choice of help and early cult observations | Make forms, signs and bell patterns understandable shared jobs rather than more arithmetic/reading rolls. A preparation should change the later crowd or wind movement. |
| [05A: The Broken Bridge](../../../content/chapters/gemfall-05a.json) | 40 | 9 / 7 | Logged-gem rule, older-than-mountain clue and decision who to tell | Play a small ledger comparison and make physical crossing preparation matter. Keep disclosure consequences; do not turn the Outline of Truth into the full reveal. |
| [05B: MossHome and the High Paths](../../../content/chapters/gemfall-05b.json) | 45 | 8 / 8 | Archives, knotted records, high paths and disclosure choice | Vary log hauling, rope traversal and page handling; route the next activity through the selected load/shelter priority. Build on its already varied eight activities. |
| [05C: The Boundary Stones](../../../content/chapters/gemfall-05c.json) | 42 | 12 / 4 | Grandmothers, keeping-way rule, old records and faction commitment | Play the gear inspection, crab display and careful carrying. Let a selected warning or crowd priority determine the later bell/evacuation job. |
| [06: Ashfall](../../../content/chapters/gemfall-06.json) | 45 | 7 / 5 | Full reveal, priority scene, pursuit and seal-clock commitments | Make `scene_truth_table_puzzle` an actual evidence comparison. Give children time to debate purpose; remove repeated setup before that choice. Preserve the chapter's route/faction readbacks. |
| [07R: The Returning](../../../content/chapters/gemfall-07r.json) | 45 | 15 / 4 | Debts/allies returning, stones sent home and escalating clock | Combine collection requests into strategic priorities. Haul/return/help choices should alter later transport, helpers or clock cost, not produce another identical favor. |
| [07H: The Collection](../../../content/chapters/gemfall-07h.json) | 45 | 12 / 4 | Competing collectors, caravan race, real Walk endings and early XP | Turn price/cargo/obstacle work into a race with understandable tradeoffs. Preserve both Walk epilogues, their campaign completion and the party's freedom to stop climbing. |
| [07L: The Tether](../../../content/chapters/gemfall-07l.json) | 45 | 13 / 4 | Bargains, competing helpers, stone-holding and question of who keeps the table | Make the bargain and selected helper change the holding job. Physical table/rope/signal work should differ; do not turn every negotiation into another Heart/Clever roll. |
| [08: Gemfall](../../../content/chapters/gemfall-08.json) | 55 | 27 / 6 | All four philosophies, pursuit advantages, titan board, humane outcomes and rare compound losses | Reduce pre-chamber repetition and make preparation useful during the chosen confrontation. Play fit/brace/leash work where it adds agency; keep fate debate, losses and alternative philosophies intact. |

## Existing consequences are not defects

The route data is richer than a superficial two-option scan suggests. Examples:
03A has genuinely easier/ordinary crossing routes; 03B and 03C can redirect the
next chapter; 04B preserves the glade result; 05 commits an audience; 06 chooses
purpose and clock; 07H can end the campaign; 08 changes difficulty and available
resources while leaving all four philosophies open. A cosmetic reply before a
merge can be good roleplay. Do not attach a punitive cost to every line just to
claim it mattered.

## Implementation order

1. **03A + 03B:** toll/river and marsh/fog; see [first-wave.md](first-wave.md).
2. **03C + 04C:** queue priorities and the north road's signs/forms/signals;
   see the [implementation and verification](../gemfall-ford-road-play/README.md).
3. **04A + 04B:** regional behavior, observation and intervention. Implemented in the [third-wave review](../gemfall-pride-forest-play/README.md): marker brace versus checked line, prepared sash clues, herd-map recovery, and mending versus woodland chorus.
4. **05A/B/C:** all three routes to the Outline of Truth and disclosure. Implemented in the [fourth-wave review](../gemfall-outline-play/README.md): survey crossing choices, high-path braces/runoff recovery, shared evidence and bell-duty crowd approaches.
5. **01 + 02:** thirty-minute opening/onboarding pass, preserving the art pilot. Implemented in the [fifth-wave review](../gemfall-opening-play/README.md): checked mail rescue, shared introductions and farm-work hedge help. Timing remains a target requiring family calibration.
6. **06:** evidence and purpose. Implemented in the [sixth-wave review](../gemfall-ashfall-play/README.md): dated evidence, learned-call gate recovery and a purpose council; reveal/continuity and persistent ally/pursuit/clock checks included. Timing still needs family calibration.
7. **07R/H/L:** implemented in the [seventh-wave review](../gemfall-pursuit-play/README.md): earned return handovers, market clues and wagon tracking, table rules and playable tether instruments. Walk, clock economics and all shipped rolls remain. Timing needs family calibration.
8. **08:** final philosophy/confrontation pass, after the upstream payoffs exist.

Ordinary targets are approximately thirty minutes, to be planned and tested rather
than enforced by counting scenes. Review a finale-specific budget explicitly; do
not silently retain 55 minutes or promise thirty without timing its alternatives.
After each wave, run meaningful complete routes for solo/two/four players, assisted
and missed actions, and the relevant real board outcomes. Record actual timings
only from observed sessions; the tracker from #511 is now integrated. See [session timing](../../session-timing.md) for revision-aware exports and reports.

## Baseline and first-wave verification

Audit inputs: all chapter inventories; `content:pacing -- --chapter gemfall`;
03A/03B merge reports; source reads around the selected checks and route payoffs;
the campaign story and authoring contracts; and the existing art-pilot review.
Content validation and continuity are clean on this audit branch. No Gemfall
JSON, story outcome, battle number, campaign flag or compatibility digest changed.
Future deliberate changes need evidence beyond updating a snapshot hash.

Baseline verification: 236 Gemfall content and save-compatibility tests pass across
five test files. Riftlight's presentation fixes pass 238 relevant art/rescue tests;
content validation passes 117 checks and continuity has no new findings.
