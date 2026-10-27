# Riftlight graphics closeout

Reviewed 2026-10-27 using the chapter-cohesion workflow. Coverage snapshot:
PR #516 at `9c6cbd12` (the accepted final gameplay wave, still awaiting merge at
the time of this audit). The small presentation fixes here apply independently
to main's rescue chapters and do not change the accepted finale work.

## Decision

**No new commissioned images are required for the completed Riftlight design
waves.** Existing setting paintings, separate cast cutouts, props and board art
cover the current jobs. Closeout needed two uses of existing art, not new assets:

1. Bone Yard's `returning_pebble` tracking activity reused an illustration with
   its target pebble already painted into the landscape. The active target then
   appeared again in the interaction layer. The game now uses the neutral
   `bone-yard-ruins` setting. The returning-pebble illustration remains on the
   preceding discovery scene, where it explains the rule without competing with
   a moving target.
2. The goat's sling/lift/crossing activities used a rope loop alone. The existing
   `wind-blanket` and `rope-loop` now appear together, making broad soft support
   visible. No new goat pose, harness animation or baked-in character is added.

## Coverage and limits

The #516 snapshot contains 24 chapters and 314 authored activities, referencing
77 scene backdrops, 56 cast/creature figures and 72 distinct activity/cover props.
All activity mappings and their files are present. The runtime-art and keeper
identity tests pass. Earlier illustration work already supplied the important
comparison, mooring-stone, goat-bank and returning-object views. Convergence and
Finale reuse suitable character-free settings and separate actors.

This is file/mapping coverage plus targeted visual review of the rewritten beats
and known layering risks, not a claim to have photographed all 314 activities or
proved visual comprehension with families. Optional extra paintings should follow
an observed comprehension need; more pictures are not the current blocker.

## Actual game captures

These use the real local server, client and Pixi stage, with a 1920x1080 TV and
390x844 phone. A throwaway preview starts at the selected chapter (index 1 only
there) and uses a playtest jump. Tracking is started in relaxed mode so its target
is visible. Shipped campaign order and household saves are untouched.

| Situation | TV | Phone |
| --- | --- | --- |
| Tracking before: pebble baked into landscape and drawn by activity | [before](before-tv.png) | [before](before-phone.png) |
| Tracking after: neutral setting with only the activity target | [after](returning_pebble-tv.png) | [after](returning_pebble-phone.png) |
| Sling: existing broad cloth and rope props | [sling](sling-tv.png) | [sling](sling-phone.png) |

The phone retains its guest carousel. Known tall-figure overlap with that bar is
an existing layout issue, not a missing-graphics requirement. This pass changes
no renderer, control logic, rewards, goals, campaign flags or encounter statistics.

Validation on the main-based audit branch: 238 relevant art/rescue tests pass;
content validation passes 117 checks with main's two existing custom-Corvane
warnings, and continuity has no new findings or stale allow-list entries. #516's
new brace variants independently bring that warning count to four; this audit
does not add or silence a warning.
