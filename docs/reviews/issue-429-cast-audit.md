# Remaining cast audit (#429)

Reviewed against main at `222bb4c2`. The Riftlight cast audit is in open PR #431;
this pass does not duplicate its changes or treat them as merged.

## The Hollow Crown / Bramblewood

`the-hollow-crown` is a reference campaign containing only `bramblewood-01`, not
a second chapter. Read all 24 scenes, including check outcomes and the encounter.

- Pib is present in `scene_first_clearing` and `scene_pib`, already cast in both.
  The party leaves him behind when it heads deeper into the wood.
- Three wisps are present in `scene_singing_stream`, `check_wisps`,
  `scene_wisp_friends` and `scene_bundled`. All already have cast; corrected
  `scene_bundled` to show three, matching the group in the preceding encounter.
  The encounter draws its own enemies and cannot take a story cast.
- The lights seen from the canopy are distant, not met. Do not cast them there.
- The humming and door voice remain unseen. Do not reveal a figure behind the
  hedge or door. The door voice already has an art request in
  `docs/briefs/story-cast-missing.md`; its species remains unspecified.
- Lantern moths are background atmosphere, including the moth on the party
  member's nose; no suitable figure is declared. No new speaking character
  needs an art request. Nobody accompanies the party through the remaining
  gate, shrine, rest or door checks.

## Letter messenger: departure and return

Leave the messenger uncast in these two scenes. Their base narration places
the keeper and Pip there; the messenger appears only in flag-dependent variants.
`departure` offers her delivery only when letters were saved without a relay
delay. `return` describes her leaving only when letters were saved without a
relay delay. Other variants discuss a waiting relay rather than a visible
messenger. A fixed cast would assert her presence for every party. Revisit if
conditional casting or dedicated branch scenes are introduced.

## Remaining work

The new `content:cast` report supplies a repeatable advisory reading list, not
an automatic casting decision. It cannot judge whether a mention is physically
present. The Riftlight visual playthrough is still outstanding, and should use
PR #431's cast data once available. No visual playthrough was performed here.

## Verification

`content:validate`, `content:continuity` and `content:proofs` pass; graph proofs
are unchanged. Validation retains the two existing Corvane creature warnings.
The report scans all 42 chapters and its six focused tests pass. The tools
suite has Windows line-ending failures in the unchanged authoring-guide
example matcher and generated figure-size comparison. The latter matches
after CRLF normalization; neither is caused by cast data or this report.
Full tools result: 1,199 tests passed, two failed and eight skipped; 61 files
passed, with the two files above failing plus a validator-suite cleanup hook
that exceeded its 10-second timeout after its test cases completed.
