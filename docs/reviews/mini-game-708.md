# Mini-game gameplay follow-up: tooling and Gemfall 7L

The remaining reading list is completed in [the follow-up report](mini-game-708-remaining.md).
This document records the original 7L/tooling batch and its evidence.

First implementation batch for [#708](https://github.com/allenheltondev/kids-and-dragons/issues/708),
based on main `554cc0cc`. The issue remains open. Its proposed sequence is tooling,
then one PR each for 7L, 7R and 8, followed by the other chapter reviews.

## Reconciliation

The earlier general chapter passes did not finish this gameplay checklist. Most scene names
in the issue omit their `interaction_` prefix; those activities are still live. This inventory
reads the current files, not the retired activities in `resumeInteractions`.

| Batch | Current scenes | Status |
| --- | --- | --- |
| Tooling | `cohesion.mjs shape` | Corrected here: v2 balance and cooperation can fail through strain. Free play cannot. |
| Gemfall 7L | `interaction_set_table`, `interaction_box_slide`, `interaction_tether_team` | Revised and played in this batch. |
| Gemfall 7R | `interaction_haul_team`, `interaction_return_handover`, `interaction_trickle` | Still require a chapter pass. |
| Gemfall 8 | `interaction_chimney`, `interaction_restore_brace`, `interaction_leash_transfer`, `check_hum_note`, `check_hear_titan` | Still require a chapter pass; read the listening games against their gentle story purpose. |
| Gemfall 1 | `interaction_letters`, `interaction_newcomer_load` | Review remaining. |
| Gemfall 3B | `interaction_reed_gap`, `interaction_runes`, `interaction_ribbon_duck` | Review remaining. |
| Gemfall 4A | `interaction_ridge_creep`, `interaction_wolf_trail` | Review remaining. |
| Gemfall 4B | `interaction_calf_hide` | Review remaining. |
| Gemfall 4C | `check_relay`, `interaction_gate`, `interaction_verses`, `interaction_courier_pattern` | Review remaining. |
| Gemfall 5A | `interaction_crossing_signal`, `interaction_level` | Review remaining. |
| Gemfall 5B | `check_bridge_test`, `interaction_stones` | Review remaining. |
| Gemfall 5C | `interaction_bell_cart` | Review remaining. |
| Gemfall 6 / 7H | `interaction_moth_trail`, `interaction_tags` / `interaction_hairpin` | Review remaining. |
| Gemfall 2 | `interaction_jackalope_hats` | Review the hat-peek joke; a soft miss may be intentional. |
| Riftlight | Ashspan `carry_beam`; Boundary `surge_check`; Frostfang `ladder_hold`; Glacier `kid_burrow`, `shelf_cross`; Stone Counters `turnip_relay` | Review remaining. |
| Practice Meadow | `interaction_roots` | Reconcile the split-role cue; the forgiving practice outcomes are intentional. |

That leaves 36 explicitly named activities for review after these three 7L activities.
This is a reading list, not a claim that every soft miss needs punishment. The additional
Riftlight result-narration checks named in the issue also remain. Timing fairness's real-device
acceptance remains separately tracked in #566.

## Gemfall 7L's playable situations

| Activity | Read and act | Consequence and recovery |
| --- | --- | --- |
| Door-table balance | Everyone adjusts their lift before the lead commits each step. The safe lift changes with the load. | A slip keeps completed steps and gives feedback for correction. Exhausted footing bruises toes: one nonlethal HP per hero on continuation. Pellam wedges the table so the meeting still happens. |
| Sliding boxes | Read the opening and dash through it. | A near miss allows recovery. Exhausted footing costs one nonlethal HP per hero before the crawlers arrive. The encounter, its rewards and its recovery routes are unchanged. |
| Joint wagon brace | Each hero chooses a smooth pull. A gentle first pull moves the target for the remaining friends. | Completed efforts remain safe after a jerk; later smooth pulls can recover. A failed brace reaches the existing masks-take-the-wagon branch, sets the late clock and withholds the Caravan Stone. Success and assistance retain the existing stone and steady clock. |

The shared v2 mechanics already support these actions; this pass does not invent another
interaction kind or change their scoring. The wagon's cue describes actual shared pulls,
and the foreground reuses the painted rope loop instead of hoisting a painted wheel.

The authored preparation still earns the shared-brace option. It does not promise an
automatic success regardless of what players do. The quiet council and other conversations
remain story choices, not extra games. Endings, route sets, final XP and alternative tools
retain their existing contracts.

## Saved attempts and the audit tool

The three original activities are retained unchanged in `resumeInteractions`, with new hashes
added to the existing archive fixture. Existing fixture hashes were not retaken. A persisted
prompt whose authored spec matches its archive uses that archive's branches, including after
retry, assistance or a partial team pull. Matching uses canonical JSON so storage key order
does not change the result. Fresh entry uses the revised activity. Validators reject an
archive with a spec indistinguishable from its current interaction.

The deliberate 7L gameplay change retakes only its gameplay pin. The new save tests retain
the shipped no-cost misses and the old shared-brace reward even when current fresh attempts
have different consequences.

`cohesion.mjs` now reasons about current controls. Its engine-backed kind checks generate
real v2 teamwork failures; the Riftlight route walker includes those reachable branches.
Older saved-control contracts remain covered separately.

| Shape diagnostic for 7L | Before | After |
| --- | ---: | ---: |
| Reachable scenes | 102 | 102 |
| Checks / fights / games | 13 / 2 / 8 | 13 / 2 / 8 |
| Structurally inert games | 3 | 0 |
| Games that cannot fail, under current controls | 0 | 0 |
| Echo votes | 1 | 1 |

The old tool incorrectly counted two teamwork activities as unable to fail. The corrected
tool reports zero even on the unchanged chapter. The echo is the quiet council's conversation,
which this minigame pass does not turn into a test.

## Presentation and verification

The TV keeps the chapter goal visible in its folded form while a game is active. Repeated
introductory prose and the large duplicate cue give their room to the painted board, current
feedback and participant status. Knack/snag reminders remain. Phone controls and spoken
introductions remain available. Short-phone and largest-TV checks include physical board
containment, rather than relying on hidden overflow. The four-seat check also exercises a
wide system-font fallback; the TV uses a compact weight cue to avoid an extra wrapped row.

Engine coverage includes one, two and four heroes, actual misses, assistance, nonlethal costs,
team compensation, correction after a slip/jerk, saved progress and original saved outcomes.
Complete-route tests verify that a failed new shared brace still finishes the chapter late
without inventing a stone. The broader Riftlight/interaction checks exercise the updated
failure classification. Browser runs use real lifting/pull controls, refresh, reduced motion,
320px and 390px phones, a read-only TV and the actual earned/lost story branches.

These are implementation and presentation checks, not evidence that children enjoy the games.
Family observation should still check whether they anticipate the changed weight, help with
an under-pull, notice the save and want another turn.

Ten changed narration variants currently use device voice. Obsolete recordings were removed
from the active manifest; unchanged scripts and the existing voice lock remain. No ElevenLabs
key was available for rendering replacement clips in this session.

### Review evidence

- [320px table controls](https://assets.kd.readysetcloud.io/sha256/b0/b00f3f02145ff3a5612d5d9797a17aeb2ddc754257e26b38e1f3e2aeefc1da53.png)
- [Largest-text wagon TV](https://assets.kd.readysetcloud.io/sha256/fe/fe3337b626420be8549908b504b2ed0732505a663ec6cb715439dae0922a6122.png)
- [Four heroes at largest TV text](https://assets.kd.readysetcloud.io/sha256/08/089b22104c7c047c7957641b0bcb6cf255e29680788bd50b100b6a3f8229948a.png)
- [Shared-TV recovery recording](https://assets.kd.readysetcloud.io/sha256/39/39a2a14507833cee87e9a03da0ea4f8cd7d8fc74a966bdb4f6ab9c6dbd0433c7.webm):
  API-driven seats show compensation, a jerk, corrected pulls and the earned stone. The phone
  browser cases separately exercise real controls. The recording and its contact sheet were
  visually reviewed.

Local verification: 1,987 Riftlight/audit/compatibility checks; 153 targeted Gemfall route and
save checks; 281 shared-engine, validator and UI compatibility checks; 88 final minigame/UI
checks. These groups overlap and are not a unique-test total. All three new 7L browser cases
pass, alongside eight existing shared-load, mixed-version, relay and reusable-interaction
regressions. Four-seat TV rendering uses API-driven seats; two-seat tests use real phone
controls. Content validation passes
(218 files, five existing warnings), continuity has no new candidates, all 17 play pins match,
and voice verification reports nothing broken. Typecheck and production build pass; payload
remains 331/332 KB first paint and 1806/1808 KB total, with no budget changes. The full Linux
suite runs in the PR checks; the local Windows suite has unrelated path/line-ending failures.
