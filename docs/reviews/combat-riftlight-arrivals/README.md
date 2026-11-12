# Riftlight arrival encounters

After the final six Gemfall encounters in #753, the next catalog pass covers three ordinary arrival fights. Existing noncombat choices, destinations, rewards and defeat effects stay in place. No Gemfall play shape changes.

| Encounter | Decision | Consequence and recovery |
| --- | --- | --- |
| Saltrot shell-bank | Hold the warm hollow for two round ends; draw pursuing crabs away from it. | Cold silt starts in round two. Stopping there costs two steps next turn. A poor approach can let a crab occupy the bank; lure it downhill before returning. Failure still loses the quick route and luckstone. |
| Frostfang gravel bar | Clear the blocked burrow with two helping turn ends, while avoiding or interrupting committed claw sweeps. | A sweep hits the ground already marked. Fox Fire interrupts one crab while the other can still strike. Taking a hit does not reset burrow work. Failure still costs the afternoon and luckstone before the goat-carry scene. |
| Sky Islands signal basket | Free and steady the basket while distracting its tugger and avoiding the other wisp's committed sparks. | Leaving the basket alone lets the tugger pull it loose. Defeating the wisps does not substitute for saving the beacon. Failure still gets Sorrel's bell rescue and loses the jar; the recovery now shows her catching the pole and rekindling the ember. |

The compact boards reuse existing painted props and terrain. The Frostfang mission replaces the repeated chapter goal in the combat panel, keeping the deadline, objective and forecast visible. Physical basket loss says it is gone, retaining the old rift wording for legacy captives.

## Captured play

| Encounter | 320px phone | Largest-text TV |
| --- | --- | --- |
| Saltrot | [Phone](https://assets.kd.readysetcloud.io/sha256/29/29c31b4b530c779a66cd8cdcf4ef845017bd7eb0b2db2c9cc4589c2d647178d2.png) | [TV](https://assets.kd.readysetcloud.io/sha256/62/629eef8b768540092745cf0b99f717ebb41de7f06c424af5cb5920761b20a31b.png) |
| Frostfang | [Phone](https://assets.kd.readysetcloud.io/sha256/2a/2a28ec20e36348150806f45f256e3b0993c290c4a2cdd7059e065b3906a358ae.png) | [TV](https://assets.kd.readysetcloud.io/sha256/0c/0c54d21bcee8918d12246dec72da9f1b77c7c73c3b46e09ca17779e687896f4c.png) |
| Sky Islands | [Phone](https://assets.kd.readysetcloud.io/sha256/84/84c967f76795aa5ba9499ecf5fa2e4070185d7acddad1f7f5930380ad4f3b514.png) | [TV](https://assets.kd.readysetcloud.io/sha256/65/653bf39983a8dc737f00244737f9ac57b0ed1587614a6c8efa755b6d5bcd3d8d.png) |

Frostfang also captures [the phone-triggered interruption](https://assets.kd.readysetcloud.io/sha256/aa/aa30fd045ee0c69b07ec4063b6d3ec4fb778b5cd25abc66887a45617be3f7aa9.png). Existing authored art is visible in these captures; no replacement paintings were generated.

[Frostfang's recorded sequence](https://assets.kd.readysetcloud.io/sha256/ba/ba65d825f8057c95767f7732eacf1bd6063a645cdcfad7b3207d538773658d58.webm) shows marked claw ground, movement out of it, saved burrow work, interruption and the goat-carry payoff. It was captured from the running TV through CDP frames and encoded afterward; live Playwright video encoding stalled on Windows. Final functional checks disable video locally; CI keeps recording enabled.

## Verification

- 1,931 Riftlight tests pass across 40 files. The 17 new encounter tests cover one, two and four support heroes, saved-state round trips, unattended objectives, actual story consequences, a silt mistake and recovery, interruption, damage and recovery, and the basket's required rescue rule.
- 47 focused encounter, caption and persisted-art tests pass after the CI follow-up.
- Three phone/TV browser cases pass, including a real phone Fox Fire interruption. Each checks 320px and large-text 390px phones plus the largest TV text setting, including measured containment of the deadline, mission and forecast.
- All three reload and reduced-motion playthroughs pass together; subsequent Sky Islands and Frostfang reruns pass after their final caption/presentation corrections.
- Typecheck, content validation (218 passes, five warnings), continuity (zero new or stale findings), voice verification and production-length build/bundle checks pass. Payload remains 331/332 KB first paint and 1802/1802 KB total; no budget increase.

Browser success uses controlled misses to isolate movement, objectives and UI behavior. Separate engine checks use damaging rolls to verify that standing in the claw sweep hurts and recovery remains possible. These checks establish behavior and presentation, not children's enjoyment; no fresh family observation was collected.

The first Linux CI run exposed two regressions: the persisted-art test still manufactured a basket victory by downing every wisp, and the basket's verbose rescue instructions overflowed the largest-text TV panel. The fixture now saves the basket before asserting victory art. The painted rescue line keeps work progress and remaining tugs concise beside the already visible clock, preserving the containment assertions and text size. The browser interruption waits for the confirmed server action and removal of the pending sweep. The engine-to-caption check confirms that the interrupted crab lowers its claws. Reload restores the actual phone encounter; play continues with reduced motion on every device.

Remaining ordinary Riftlight fights: Ashspan Bridge mimic, Cairnstep Pass cache and Headwaters Washout drake. Hollow Crown's Bramblewood fight also remains in the broader catalog.
