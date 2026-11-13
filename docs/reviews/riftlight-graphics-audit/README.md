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
| Tracking before: pebble baked into landscape and drawn by activity | [before](https://assets.kd.readysetcloud.io/sha256/87/87a09f4485a73d613f8ff97c3d93026e73e7bb7ee85796146461a879de8f6d2a.png) | [before](https://assets.kd.readysetcloud.io/sha256/a1/a1654396a1d20bfb12aebd86479126143dcb578233e531e450189208d799fa53.png) |
| Tracking after: neutral setting with only the activity target | [after](https://assets.kd.readysetcloud.io/sha256/5f/5f0cd679e9181d05b95368ce2c95c05f3ebdcb9987cf8e6483811705cb585241.png) | [after](https://assets.kd.readysetcloud.io/sha256/c4/c42765cf633790dc1dfa88af920c29699dc55f2129d91ecaebada45ba1b21cea.png) |
| Sling: existing broad cloth and rope props | [sling](https://assets.kd.readysetcloud.io/sha256/98/987e2024d6bdaafc00c8d831d69ac0154b2a74d9f4c38bdb4eee443f6d3ca332.png) | [sling](https://assets.kd.readysetcloud.io/sha256/38/3833ee1fcb200cb58a3839d90c7b7903e19e5f0498e446ddfa1be94c022c6148.png) |

The phone retains its guest carousel. Known tall-figure overlap with that bar is
an existing layout issue, not a missing-graphics requirement. This pass changes
no renderer, control logic, rewards, goals, campaign flags or encounter statistics.

Validation on the main-based audit branch: 238 relevant art/rescue tests pass;
content validation passes 117 checks with main's two existing custom-Corvane
warnings, and continuity has no new findings or stale allow-list entries. #516's
new brace variants independently bring that warning count to four; this audit
does not add or silence a warning.
