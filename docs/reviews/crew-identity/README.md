# Crew identity review

Checked the actual `LobbyContent` and `HostControls` components in a temporary Vite review entry, using the existing state fixtures with the Otter Crew active and the Lantern Crew available. The temporary entry was removed after capture.

- `lobby-720p.png`: 1280 × 720 shared display; crew identity remains subordinate to joining and the party lineup.
- `room-phone.png`: 390px phone width; open Room panel, active crew card, labeled switching actions and creation explanation. No horizontal document overflow.

The new artwork decoded successfully and was visually inspected in both contexts. These captures use fixture state rather than a connected multiplayer session; existing server behavior is unchanged.

Validation: 49 tests across `host-controls.test.tsx` and `lobby-content.test.tsx`, full workspace typecheck, production client build, and `git diff --check` passed. The runtime art is a 256 × 256 RGBA WebP (23,042 bytes), with fully transparent and opaque pixels verified.

## Friends-night handoff

`friends-tv.png` and `friends-phone.png` are from `e2e/crews.spec.ts` against the real stack, with one TV and two independent phone browser contexts. Starting a crew from the TV's Room panel sends both already-connected phones into new-hero creation. Both create fresh heroes; switching back offers their original heroes again. The Room panel closes after a successful crew choice.

The server regression also starts from a paused family campaign, verifies that stored heroes and the family save are unchanged by crew creation, checks that a retried request preserves freshly created heroes, starts the new campaign, and checks the original save again. Setup guidance clears on chapter start and crew switching. Ordinary automatic crew following retains its existing tests.

Follow-up validation: 73 focused server/UI tests, full workspace typecheck, production build, icon registry check, and the TV/two-phone browser test.

## Entry layout and phone footer

- `home-landscape.png`: 1280 × 720 landing page, welcome art beside the join card and secondary links at opposite ends.
- `host-landscape.png`: play modes side by side with balanced guide/back links.
- `lobby-landscape.png`: joining on the left and a full four-hero lineup on the right, at 720p.
- `lobby-phone-footer.png`: 390 × 844 phone with the privacy footer below the navigation tray.

`PhoneFrame` owns the phone footer outside all panes. It appears for seated players waiting between games, including the engine's pregame `creation` phase; phones making heroes and games under way omit it. The footer remains at the bottom when inspecting another pane. The home and document-page footers retain their page placement.

Verified with 91 tests across home, privacy, lobby, Party and Travel layouts; three real-browser layout tests covering both phone modes, landscape rotation, creation and gameplay; the TV/two-phone crew handoff test; workspace typecheck and production build. All passed. Screenshots were visually inspected.

## Choosing and welcoming a hero

The creature cards keep the image/short-summary split, with one signature ability below. Bonuses and matchup notes are in an independent native disclosure, outside the selection button. Class choices lead with a plain-language role and a larger existing emblem. No new art was needed.

Strengths now have short explanations and an optional class-based **Help me choose** suggestion. Suggested points remain editable and do not advance or submit. The footer explains the next missing choice beside disabled actions. `creation-class.png` and `creation-stats.png` show the narrow-phone layouts.

`hero-hello.png` shows the 2.2-second greeting after successful creation. It is nonblocking, is never inferred from reconnects, omits sound in quiet rooms, and skips animation under reduced motion. TV lineup additions have a subtle entrance that also respects reduced motion. Lobby tiles distinguish making a hero, needing to tap Ready, and ready; the next-step message waits for participants still making heroes and handles saved adventures separately. Unseated roster seats have no server presence flag, so a departed maker remains listed until removed or marked as watching.

Validation: 82 focused creation, arrival, lobby and phone-layout tests; five real-browser tests across the crew handoff, entry layouts, disclosure behavior, assisted strengths, reduced motion and reconnect behavior; full workspace typecheck and production build. All passed. Cards and greeting were visually inspected at 390px, and the ready lineup at 720p.

Final portrait adjustment: lobby hero art is 4.5 × 5.4em, with names, levels and readiness to the right. A full four-hero lineup still fits at 720p; all three entry-layout browser checks passed after the change.

Payload check: first paint remains within the unchanged 324KB cap. Total JavaScript is 1518KB; the total cap moves from 1515KB to 1520KB for the new room/creation features, with the measured reason documented beside the limit.
