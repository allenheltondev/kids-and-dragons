# Gemfall: queue priorities and the road's memory

Second gameplay wave from the [campaign audit](../gemfall-play-design/audit.md),
following the [03A/03B pass](../gemfall-road-marsh-play/README.md). Uses the
[chapter-cohesion skill](../../../.claude/skills/chapter-cohesion/SKILL.md).

## The Ford That Decides (03C)

This chapter already had nine activities, including the runaway goat, card trick,
soup bowls, queue line, camp performance and crossing verse. Keep that variety.
The deeper change is making the queue job matter when the ford becomes difficult,
rather than repeating the previous wave's wider timing-window crossing.

The spilled-chip approach now uses a catch-and-pass line. At the queue's priority
vote, the party chooses one job: level a stuck wagon, brace the fallen marker line,
or help the Brackens. The family keeps its three existing ways to receive help,
including a real honeycake cost when that option is chosen.

| Choice | Immediate result | Later playable consequence |
| --- | --- | --- |
| Level the stuck wagon | The wagon comes free; its existing whistle reward and queue-help credit remain | If the ford surges, its crew brings a brace. Support the tipped load and guide it upright to reach the north bank. The favor also works when the old risky heave succeeds. |
| Restore the marker posts | Raise the checked line with ropes or props | Keep the existing easier ford check. The crew-rescue option does not appear unless the wagon crew was actually helped. |
| Help the Brackens | Swap queue pebbles, spend a honeycake, or repair their wheel | Balance the family's loaded cart across with them. This is a distinct task rather than another label for the easier roll. |
| Use Tamsin's unfair Number 1 | Enter the crossing before it is ready | The actual surge still occurs. The number does not become a safe shortcut or erase the western-road outcome. |
| Let the current take you west | Leave the ford by the existing river route | Keep `marsh_kept_us` and the real `route_wild` reroute. A lost late drake fight retains its separate setback ending. |

The main ford rolls, the crossing verse's actual advantage, the drake alternatives
and all three original endings remain. Assisted actions identify the drover,
runner or family who helped. Successful work is not followed by a die that undoes
it. The surge brace is an earned alternative to the remaining risky recovery.

## The Road That Remembers (04C)

Keep the two traffic lanes, Tib and Ma Ruddle's bill of sale, the mule's unease,
Wend's offer, the wardens, depot, bell courier, Dumpling and the spiral verses.
Shorter transitions give the party room to act and discuss the clues. The road's
behavior remains an observation; this chapter does not reveal the stones' origin.

| Choice | Immediate result | Later playable consequence |
| --- | --- | --- |
| Pass posts with the road crew | A real relay delivers their marker posts | The crew offers a sheltered wind crossing with its own wagon and screen. The crew keeps that gear afterward. |
| Study the detour with the road boss | Check bridge, pond, barn against the route card | Follow that checked route past the nonsense signs without repeating the shared clue puzzle. This does not earn the crew's wind favor. |
| Work for patrol passage | Balance the water tray for the patrol cups | Pass without spending coins. Paying instead still spends exactly two coins; the original arithmetic argument remains a risky option. |
| Sort the relay sign clues | Share the landmarks and assemble their travel order | Reach the depot directly, or reach it with an honestly corrected route after visiting the pig farmer. A helped route remains helped. |
| Use Ma Ruddle's bill | Hand over the document earned by finding Tib | Skip the claim activity and collect the same Depot Stone. Missing Tib does not invent that bill. |
| Make the claim together | Say names and purpose aloud, then each hero makes a mark | Pennywhistle handles form order. The family gets a checked claim without a die judging its handwriting. Assisted recording credits him. The old quick Form 9 roll and its missed-claim branch remain. |
| Echo the courier's message | Play ding, ding, pause, ding through memory controls | A correct or assisted message is acknowledged. A miss keeps the existing cake-message joke and the courier's correction. |
| Face the ash wind | Balance the shared load, use the crew's earned shelter, take the existing free wagon shelter, or risk a fast march | Preparation changes the task. An assisted crossing does not claim independent work, and no screen is silently added to inventory. |

The selected crew priority changes a later job; a new chapter-local flag is not
presented as permanent campaign history. A walked-over marsh party can enter 04C
without having met Mother Thrum: her charm option still requires the actual item.
The original wolf wait, sneak, fight and late setback remain available.

## Session plan and pacing

Both declared targets are approximately thirty minutes. Planned time includes
reading aloud, discussion, family contributions, activity turns and recovery:

| Chapter | Planned movements in minutes |
| --- | --- |
| 03C | 5 road/market; 8 queue job and camp; 7 charm and overnight clue; 10 ford and recovery |
| 04C | 6 observations and finding Tib; 8 patrol/signs/depot; 8 courier and relay discovery; 8 wind, bend and camp |

These are plans, **not measured family timing**. No artificial waits or mandatory
replays were added. The older uncalibrated model does not budget interaction time
and still predicts longer routes, especially with optional fights:

| Chapter | Shortest: checks / fights / predicted minutes before → after | Typical predicted minutes before → after |
| --- | --- | --- |
| 03C | 6 / 1 / 35.2 → 4 / 1 / 31.5 | 39.1 → 35.2 |
| 04C | 11 / 1 / 37.1 → 5 / 1 / 34.3 | 40.0 → 38.3 |

Scene counts remain 39 on the modeled shortest success routes. The reductions
come from clearer, shorter narration and changing selected dice jobs, not from
cutting the middle of the adventure. Family timing, including solo reading pace
and four-player discussion, remains necessary before calling these thirty-minute
sessions. The proposed timing tracker remains issue #511.

## Save and outcome contracts

The immutable legacy-check fixture comes from pre-wave commit `fb22e067`.
All 21 shipped check definitions remain exactly equal: ids, prompts, stats, TNs,
rollers, branches, effects and art. Tests JSON-round-trip every open roll prompt,
then resume both outcomes at one, two and four seats against the new chapter.
Old scene and choice ids remain available.

The old/new compatibility probe matched ending, road and setback digests. Fresh
mid-fight play-on matched after normalizing only the generated hero ids; the
fixed legacy-save replay remains pinned independently. Only 03C and 04C file
hashes are re-pinned. No gameplay digest constant, campaign route set, terminal
effect, encounter number, map or reward amount changes.

New complete-route tests exercise successful, missed and assisted controls at one,
two and four seats; queue-job exclusivity; the real northern/western destinations;
paid versus worked passage; bill versus claim; earned screen versus route-card
preparation; missing evidence; the two late losses; and efficient griffin/songkeeper
routes. Failure of an old preparation roll does not grant the new favor. The
real-server campaign suite plays the unchanged combat boards.

Two continuity allow-list entries became obsolete because the revised scenes
introduce the relevant terms or no longer use them. They were removed rather than
adding exceptions for the new work.

The existing ensemble rumor-fire exchange remains intact so its multi-speaker
voice audition stays valid. The cast sheet's chapter quotes are refreshed from
the current content, including the preceding wave. All 207 speaker identities,
assigned voices, approval states and histories are preserved.

## Visual review

Existing settings, separate family/clerk figures, sacks, wagon wheel, rope posts,
plank, papers, water tray, bells and blanket cover this wave. No new commissioned
images are needed. Neutral papers replace a misleading scroll prop that includes
an unrelated orange-hatted messenger. The Bracken crossing uses the ford setting
with the family's separate figures. No target or character is added to a backdrop.

The captures use the real local server/client, a 1920×1080 TV and a 390×844 phone.
The phone's **Your turn** controls are scrolled into view; long lists scroll normally.
Isolated throwaway saves and a temporary index-1 preview leave campaign order and
household saves untouched.

| Activity | TV | Phone controls |
| --- | --- | --- |
| Bracken cart crossing | [TV](interaction_bracken_crossing-tv.png) | [phone](interaction_bracken_crossing-phone.png) |
| Shared depot claim | [TV](interaction_form_nine-tv.png) | [phone](interaction_form_nine-phone.png) |

## Validation

- Typecheck passes.
- 74 new complete-route, preparation and resumed-prompt tests pass; all 21
  shipped roll definitions match their immutable pre-wave fixture.
- 445 Gemfall content/control/compatibility and voice checks pass. The real-server
  campaign suite and all 131 validator tests also pass in the full run.
- Content validation: 117 checks pass, with four existing Riftlight custom-Corvane
  warnings. Continuity: no new findings or stale allow-list entries. Concept
  removal sweeps find no leak for the tuned charm or the depot clerk.
- Full `npm test -- --testTimeout=20000 --hookTimeout=60000` ran: 9,987 passed,
  six failed, 11 skipped, with a dev-server cleanup timeout. Four failures came
  from the rewritten rumor-fire voice sample and were resolved by preserving
  its original ensemble exchange. The voice suites pass afterward. The remaining
  two reproduce the previous wave's untouched Windows-specific failures:
  `spawnSync npx ENOENT` in canon projection, and the dev-server SIGTERM/flush
  assertion plus cleanup hook. Local full-suite green is not claimed; CI remains
  required. No unrelated platform changes are included to hide those failures.
