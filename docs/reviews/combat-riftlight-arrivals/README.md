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
| Frostfang | [Phone](https://assets.kd.readysetcloud.io/sha256/24/243d6cbac490cded0ab7012f5357b80d9c5ddffb8d91ba609a13b9de195f4071.png) | [TV](https://assets.kd.readysetcloud.io/sha256/2b/2b12634546e05be6e448ebd3f7b7494c815a7d1bde825ed19f0b7428bd6591b4.png) |
| Sky Islands | [Phone](https://assets.kd.readysetcloud.io/sha256/03/03edde9e610dff36e14a13f43c7f2ec1b7ac45bfae78693cdfb4b65e5239f9ae.png) | [TV](https://assets.kd.readysetcloud.io/sha256/d6/d62b3ce4b0f452f5b0a4ba6de7773c18c1b200ced5121ab625fc2aad45c94255.png) |

Frostfang also captures [the phone-triggered interruption](https://assets.kd.readysetcloud.io/sha256/9c/9cdb2e400e4df9feea0d449d88e2b110eabb5d96f10bd24c94a15ad67b70af2e.png). Existing authored art is visible in these captures; no replacement paintings were generated.

## Verification

- 1,931 Riftlight tests pass across 40 files. The 17 new encounter tests cover one, two and four support heroes, saved-state round trips, unattended objectives, actual story consequences, a silt mistake and recovery, interruption, damage and recovery, and the basket's required rescue rule.
- 47 focused encounter, caption and persisted-art tests pass after the CI follow-up.
- Three phone/TV browser cases pass, including a real phone Fox Fire interruption. Each checks 320px and large-text 390px phones plus the largest TV text setting, including measured containment of the deadline, mission and forecast.
- Typecheck, content validation (218 passes, five warnings), continuity (zero new or stale findings), voice verification and production-length build/bundle checks pass. Payload remains 331/332 KB first paint and 1802/1802 KB total; no budget increase.

Browser success uses controlled misses to isolate movement, objectives and UI behavior. Separate engine checks use damaging rolls to verify that standing in the claw sweep hurts and recovery remains possible. These checks establish behavior and presentation, not children's enjoyment; no fresh family observation was collected.

The first Linux CI run exposed two regressions: the persisted-art test still manufactured a basket victory by downing every wisp, and the basket's verbose rescue instructions overflowed the largest-text TV panel. The fixture now saves the basket before asserting victory art. The painted rescue line keeps work progress and remaining tugs concise beside the already visible clock, preserving the containment assertions and text size. The browser interruption waits for the confirmed server action, then checks that the crab lowers its claws. Reload restores the actual phone encounter; play continues with reduced motion on every device.

Remaining ordinary Riftlight fights: Ashspan Bridge mimic, Cairnstep Pass cache and Headwaters Washout drake. Hollow Crown's Bramblewood fight also remains in the broader catalog.
