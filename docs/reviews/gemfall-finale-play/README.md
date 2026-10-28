# Finale play, eighth wave (in progress)

This is the next authored wave from the [Gemfall play-design audit](../gemfall-play-design/audit.md). It is stacked on #534 (which includes #531 and #533). The base branch for this work is `917fd393`. **This is a draft first slice**, not a completed finale review.

## Decision and play contract

The chapter's four philosophies stay available: Restore, Destroy, Control and Exploit (Keystone). The sleeping titan's question, the dragon encounter, the existing titan board, the rare loss endings, the pursuer's tether advantage and the collecting party's Keystone advantage are deliberately unchanged. The existing 27 check scenes are retained exactly, including their original target numbers, stats, conditions and effects, for resumed roll prompts.

| Moment | New choice and real action | Consequence / alternative |
| --- | --- | --- |
| Seal-Keeper's verdict | Each player shares something carried, learned or chosen in an `everyone` contribution activity. | The Keeper listens and lets the whole party through; `dragon_satisfied` still records the favorable meeting. The original honest / Heart check and explicit fight choice remain available. An honest contribution no longer *requires* passing a persuasion roll. |
| Restore | If the party carries at least one great facet, compare its hum, fit the matching stone, then steady the seal in a sequence activity. | Success/assistance reaches the last gap. A real wrong sequence reaches the same last gap with the old one-point nonlethal sting; the previous Clever and Might rolls remain alternative routes. Parties with no facets still have both old routes. |
| Destroy | Feel for the wheel latch using a precision action. | Success/assistance turns the wheel gently. A supported miss still turns it with the Keeper's help and causes the same one-point nonlethal sting as the old latch roll. The old Might and Clever choices remain. |
| Control: wardens told | If the party disclosed the truth to the wardens in chapter 06, Captain Voss arrives with a prepared line for a shared leash relay. | The previously earned `told_wardens` route now has a distinct task. The ordinary wardens call still uses the old `check_pass_leash` roll. The cage, oath and regret ending remain the same. |

No new persistent route flags were introduced. The verdict uses the existing local `dragon_satisfied` flag. The existing painted seal chamber and story props are reused; this slice has no new image files.

## Tests and compatibility

- The immutable fixture `tools/content/fixtures/gemfall-finale-legacy-checks.json` snapshots **all 27** pre-wave finale checks, with serialized low/high-roll resume cases at 1, 2 and 4 seats.
- `tools/content/gemfall-finale-play.test.ts` exercises all four philosophy choices; solo/two/four-seat success and assistance; genuine sequence and precision misses; missing carried-stone and warden preparation; the original check alternatives; and existing art asset IDs.
- The Gemfall file-hash pin has been deliberately updated only for chapter 08. The rest of the campaign file hashes and the established gameplay digests are unchanged.
- New interactions do not insert mandatory errands before the seal-chamber vote. The whole-party verdict is offered as an alternative rather than replacing a saved check scene.

These are authored/tests, **not observed family play**. GitHub CI, content validation, graph validation, continuity, full-server campaign routes and TV/phone captures must still be verified on the new head before this draft can be marked ready. No local test run is claimed.

## Finale-specific timing

The original chapter declares 55 minutes. That number remains unchanged in this first slice. A provisional finale-session breakdown to test in a household is:

| Movement | Planning envelope |
| --- | ---: |
| Last climb, mountain signals and crossing | 12–15 min |
| Gallery and Keeper's questions | 10–12 min |
| Seal and titan encounter, if triggered | 7–12 min |
| Philosophy-specific confrontation and goodbye | 10–13 min |
| **Total before optional longer combat/discussion** | **39–52 min** |

These numbers are **planning assumptions**, not measurements or revised runtime predictions. The optional dragon/titan fights and children's discussion can exceed that range. Use the [session timing tracker](../../session-timing.md) on real sittings. The ordinary 30-minute target is not silently applied to this intentionally large campaign finale.

## Remaining work before calling wave eight complete

1. Review the entry-to-chamber spine for repeated errands and compress reading/choice handoffs without dropping route callbacks, lore, encounters or the distinct late clock failures.
2. Trace each ending and rare defeat using real server runs for solo/two/four-player parties, including assisted and missed new activities; compare route flags, XP and campaign completion to the pre-wave baseline.
3. Run content validation, continuity, chapter pacing and chapter graph checks; record before/after shortest and typical readings separately from measured family time.
4. Capture and inspect actual TV and phone layouts for all new activities. Ensure assistance is usable and no single hero can silently speak for the party in the collective verdict.
5. Re-review branch after the three upstream PRs land; settle any compatibility or integration changes before merging this wave.
