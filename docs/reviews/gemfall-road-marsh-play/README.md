# Gemfall: the Long Mile and the marsh

First implementation wave from the [campaign audit](../gemfall-play-design/audit.md)
and [03A/03B design brief](../gemfall-play-design/first-wave.md), using the
[chapter-cohesion skill](../../../.claude/skills/chapter-cohesion/SKILL.md).

## What changes at the table

The main hands-on approaches now use direct play. Dice remain on uncertain risks
and optional shortcuts. Every shipped check scene stays intact, including its id,
stat, TN, roller, branches and rewards. A save paused at one of those rolls can
still finish it. This is a deliberate graph change, not a wording-only re-pin.

The Long Mile offers shared road-marker clues, following the heron's last perch,
balancing the Brassbuckles' rescue rope, waiting for a river lull, and balancing
Ossley's loaded ferry. Its existing plank relay, pot support, cup tracking, hum
memory, camp, encounters and toll story remain. The toll explicitly invites the
family to tell its own story aloud. Shorter handoffs keep room for that play;
Parsnip, the queue passes and Dilly still have their own outcomes.

The marsh adds a bell-ribbon timing gap, tracking a clear-water channel, balancing
the prospectors' boarding, a supported rune rubbing, shared sound practice, and
timed weir crossings. The pretend barge can be tested from the bank by the whole
table: challenge a barnacle to a staring contest, count its breaths, or ask its
rope to wag. Those authored reactions expose the mimic without a die undoing
the investigation. Taking its gem still requires the existing separate decision.
The optional risky approaches and their actual fights stay available.

## Decisions that pay off

| Decision or earned preparation | Later change |
| --- | --- |
| Rebuild markers, return signs, follow the heron, or watch the river from camp | Unlock the prepared crossing with a wider timing window: width 0.50 instead of 0.22. Ordinary crossing and the ferryman remain available. |
| Brace the Brassbuckles' rescue rope | They lend that rope for the prepared crossing. The nearby camp can stop their scheme without this task; that does not invent a borrowed rope. |
| Camp with the goat family | Gain the existing honeycake, useful for the drake trade, instead of the water-camp preparation or nearby-rope intervention. |
| Accept Ossley's price | Receive the existing river charm, make the promise, and balance the ferry load. The scene no longer describes a boat and then plays a wading roll. |
| Help the ribbon crew | Earn their existing dry weir crossing. Ducking under the ribbon does not earn that favor. |
| Check the fog channel, with or without help, or use the mosslight jar | Find the broad landing and avoid the narrow raft-boarding activity. Steering by the distant bells still works but does not reveal that landing. |
| Bring the prospectors aboard, or send them home through the shallows | Rescued passengers can help at the road cart. The safe trip home does not falsely promise that they will be waiting there. |
| Make a braced rubbing | Keep a checked shape in the ending account. Assisted work credits Gullet; neither version explains the Gate. |
| Practice a shared beat instead of making the rubbing | Gain a wider weir timing window: width 0.50 instead of 0.24. Carry a memory, without claiming a paper record. |
| Miss either crossing | Take the actual wet/swept route and its existing campaign flag. Preparation improves the window; it does not cancel every miss. |

These new preparation/record flags are local to the chapter. No new route-set
members or promises of future persistent callbacks were added. The original
crossing and west-branch outcomes still choose the next evening honestly,
including the walk-over route to the rush road. Rewards, goals, protected reveals,
encounter statistics, inventory costs and terminal effects are preserved. The
existing late compound setbacks remain.

## Session budget and limits

Both declared targets are now thirty minutes. The planned movements remain
6 / 7 / 8 / 9 minutes for the Long Mile and 7 / 8 / 8 / 7 for the marsh, including
reading, discussing, playing and recovery. No artificial waiting was added.

**This target is not observed family timing.** The old pacing model still flags
longer routes, particularly optional fights and risky shortcuts. It does not
budget authored interaction time, so it cannot certify these sessions:

| Chapter | Shortest route before: checks / fights / predicted minutes | After | Typical prediction before → after |
| --- | --- | --- | --- |
| 03A | 6 / 1 / 37.9 | 3 / 1 / 33.9 | 41.9 → 37.6 |
| 03B | 8 / 2 / 43.7 | 3 / 1 / 36.0 | 44.6 → 41.0 |

The model's predictions are guesses, not measurements. The new barge inspection
lets an ordinary party avoid the optional mimic fight through observation rather
than luck. Further timing adjustment needs family sessions, particularly a solo
reading pace and a group that takes every optional challenge. Issue #511 remains
the proposed session tracker. This wave improves play and removes repetition;
it does not establish that every route fits thirty minutes.

## Saves and verification

The immutable legacy-check fixture was extracted from pre-wave commit
`97bc8126`. Tests compare all 29 shipped check definitions exactly and round-trip
their open prompts through JSON, then roll success and failure at one, two and
four seats against the new content.

The old/new compatibility probe produced identical ending, road and setback
digests. Freshly generated mid-fight probe saves contain different random hero
ids; their play-on results matched after normalizing only those ids. The actual
fixed pre-epic save replay still matches its pinned digest. Only the two chapter
file hashes were re-pinned; no gameplay digest constant changed.

New complete-route tests exercise normal, assisted and missed controls at one,
two and four seats. They check the actual dry/wet destination, checked versus
helped evidence, available landing, ferry charm, borrowed rope, ribbon favor,
prospector help and road choice. Timing tests send the same near-edge tap to the
ordinary and prepared crossings and demonstrate failure versus success.
The existing real server campaign suite plays the unchanged combat boards.

The validator now includes `onAssisted` when collecting branch effects and
destinations. It previously rejected a valid flag earned only with a helping
hand, while overlooking invalid assisted item effects. Positive and negative
regression tests cover that omission.

The full-campaign narration test retains its seeds and audit rules. A real
chapter-7 setback may occur before three count-gated scenes; that route must
prove its specific setback ending. Successful routes still require three, and
the seed group must retain three-scene coverage. No chapter-7 content changed.

## Graphics and real surfaces

No new images are required by this wave's controls. Existing neutral settings,
separate cast, reed covers, stepping stones, rope, pole and scroll props support
the activities. The barge tests use authored text reactions rather than pixel
spotting or a promised animation. The mimic is discovered in the result, not
painted into the inspection backdrop. Tracking targets stay in the widget layer.

These captures use the real local server/client with isolated throwaway saves,
a 1920×1080 TV and a 390×844 phone. The phone shows the **Your turn** controls,
scrolled into view. The temporary preview sets chapter index 1 only there;
shipped order remains chapter 3.

| Activity | TV | Phone controls |
| --- | --- | --- |
| Shared marker clues | [TV](interaction_markers-tv.png) | [phone](interaction_markers-phone.png) |
| Testing the pretend barge | [TV](interaction_barge_audience-tv.png) | [phone](interaction_barge_audience-phone.png) |

Long phone control lists scroll normally; these screenshots do not claim every
button fits simultaneously. Unit/route tests exercise the actual authoritative
controls, including the untimed helping hand.

## Validation results

- Typecheck passes.
- 312 Gemfall content, interaction, route and compatibility tests pass in six
  files, including 76 new preparation/legacy-prompt checks.
- All 53 real-server campaign playthrough/narration tests pass after correcting
  the setback coverage assumption described above.
- All 131 validator tests pass with longer local test/cleanup timeouts.
- Content validation: 117 checks pass, with the four existing custom-Corvane
  warnings from the merged Riftlight finale. Continuity: zero new findings and
  zero stale allow-list entries.
- Full `npm test` was run: 9,909 passed, eight assertions failed and two cleanup
  hooks timed out. Follow-ups resolved the two campaign coverage failures;
  the validator suite passes with local timeouts. Three failures were Windows
  CRLF checkouts of otherwise untouched LF inputs and pass with the exact Git
  blobs restored locally. The remaining two reproduced in untouched platform
  tests: `spawnSync npx ENOENT` in the canon projection test, and the dev-server
  SIGTERM/flush assertion plus its cleanup hook on Windows. No platform-test or
  unrelated production changes are included to conceal those failures. The full
  suite is therefore not claimed green locally; CI remains required.
