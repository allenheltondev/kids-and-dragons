# First Gemfall wave: 03A and 03B

This is a design brief, not implemented content. It follows the
[campaign audit](audit.md) and uses the chapter-cohesion skill. Each chapter targets
approximately thirty minutes; current declared estimates are 42 and 46 minutes.
Observed family timing is unmeasured.

## 03A: The Long Mile

Keep the closing beat: the toll is paid, the night in the queue is lived, the
humming clue is heard, and the party crosses or is swept to its actual next bank.
The dry/wet crossing state, quest items, rewards and subsequent road stay truthful.

| Movement | Planned minutes | Players do | Consequence to carry |
| --- | ---: | --- | --- |
| Read the road and choose help | 6 | Reconstruct markers from observations; decide which queue job to prioritize | Marker/guide knowledge or a helped correction changes the later preparation, not whether the whole chapter can continue |
| Pay a strange toll | 7 | Contribute a story/riddle, observe the gem/bridge answer and play the checked hum | The old note remains the chapter's clue. Free roleplay is not judged for truth by a low Heart roll |
| Keep a camp and prepare the river | 8 | Play one useful night-rope/helper or river-observation movement, with a rest waypoint | Priority changes the available crossing/recovery job; the camp is not a narrated skip |
| Cross and recover what actually happened | 9 | Use the prepared method, then a different bank/gear recovery if needed | The existing dry/wet and destination consequences survive; no automatic reset of soaked gear or failed preparation |

Start from these concrete candidates:

- `check_markers`: an ordering/observation activity with shared clues, not a die
  deciding whether the numerals were readable. A correction reroutes the work
  and retains the honest helped state.
- `check_kettle`: let children show what the signs protect or propose a useful
  repair. Keep the kettle joke, without adding another generic explanation roll.
- `check_heron` and `check_night_rope`: make watching the river and handling a
  moving load different jobs. Use what the party chose to prioritize later.
- `check_crossing` / `check_crossing_easy`: preserve the earned advantage as an
  actual change to controls or route. A miss should play a different recovery,
  not repeat the crossing or silently end dry on a wet path.

Keep the existing relay, tracking, memory, support and combat work where it serves
the movement. Do not add a minigame after every existing scene. Merge redundant
handoffs and leave room for the family to tell the toll story in their own words.
Decide the exact item/helper tradeoff only after tracing its existing effects;
this brief does not invent a new inventory cost or promise new persistence.

## 03B: What the Marsh Remembers

Keep Gullet's relationship, the lost-things trade, the toll reeds, the fog,
the old steps/note and the actual exit. The Gate remains an observed mystery:
its hum and old appearance can be recorded, but its nature is not explained.
A party taking the walk-over route must still get its required clue and its real
next road. Do not assume it will later play the forest route.

| Movement | Planned minutes | Players do | Consequence to carry |
| --- | ---: | --- | --- |
| Enter and choose a useful exchange | 7 | Quiet ribbon passage, lost-thing observation and an understandable trade | The selected helper/tool has a named later use and a disclosed limit |
| Find a channel through fog | 8 | Track/check visible landmarks and handle raft balance or lookout calls | A poor observation needs a nearer/helper-led route, without falsely crediting independent navigation |
| Read the old steps without owning them | 8 | Play a careful rubbing or listening comparison and preserve a checked account | Helped detail stays helped; no new claim about what the Gate is |
| Take the chosen exit | 7 | Use what was prepared, recover borrowed gear and choose the real road | Existing marsh/ford/walk-over outcomes remain; there is no invisible free restoration of gear or route |

Candidates include `check_ribbon_duck`, `check_fog_lookout`, `check_tussock_haul`,
`check_gate_rubbing` and `check_gate_hum`. They should not all become the same
hold button. Keep the wisp free play, reed timing, lantern relay, stump support
and rune memory, then reshape the connections around them.

## Contracts to demonstrate before opening the content PR

- Read the actual success and failed branches, grants, class/species options and
  route effects before selecting new costs. Preserve every goal and beat.
- Play normal, helped and missed controls in complete solo/two/four-player routes;
  preserve ordinary ways forward beside class or carried-history advantages.
- Test the actual crossing or navigation payoff, recovery and ending callback;
  do not only count scenes, rolls or activities.
- Keep road/crossing/west-branch sets correct on every ending. Gemfall only carries
  its route-set members between chapter runs. New local flags are not permanent
  promises to the next chapter.
- Check old saved roll/interaction prompts, scene ids and mid-fight saves before
  changing a scene type. Retain a compatibility path or make a deliberate tested
  migration; do not make a shipped saved game unresumable by renaming its scene.
- Compare the old and new ending/road/legacy-save probe results, then deliberately
  re-pin content digests with an explanation. Never accept changed gameplay
  digests solely because a new snapshot was generated.
- Validate content, continuity, relevant Gemfall wiring/flow tests, art mappings,
  typechecking and necessary board outcomes. Capture the actual TV and phone
  surfaces; avoid characters or puzzle targets painted into active backdrops.
- Assess new asset needs from the implemented job. Existing Gemfall paintings and
  props are extensive; commission only a demonstrated visual gap.

This wave should produce two coherent sessions and a concrete decision/payoff map,
not a bulk conversion of dice checks. Measure family play before declaring the
thirty-minute target achieved; #511 remains the proposed timing tracker.
