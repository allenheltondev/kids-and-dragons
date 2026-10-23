# Phone and tablet experience audit

Date: 2026-10-23. Audience: kids ages 8+, with grown-up setup and account tasks.

## Scope and method

Reviewed the client route map (`/`, `/account`, `/guide`, `/journal`, `/p/:code`, `/tv/:code`, and unknown-route recovery), shared UI primitives, screen styles, and existing end-to-end coverage. Measured rendered controls in Chromium with touch emulation, inspected the illustrated home screen and Field Guide screenshots, and exercised the real local client/server with the existing responsive-layout and accessibility suites. Phone coverage includes 320, 360 and 390px widths, normal through largest text, and left/right one-handed settings. Tablet coverage includes 768×1024 portrait, 1024×768 and 1180×820 landscape; shared display checks include 1024×600.

This is a code and browser audit. It does not replace physical iPad/iPhone Safari testing or observation of children using the game. Account authentication, native install prompts, and every campaign scene were not manually walked end to end.

## Findings fixed

| Experience | Finding | Change |
| --- | --- | --- |
| Personal and family home | Join instructions assumed a television, although Phone Mode has none. | Ask for the room code from a grown-up, then type it here. |
| Home/account navigation | Secondary home links measured about 27px high. | Minimum 44px height, with vertically centered text. |
| Grown-up guide | Contents links measured about 21px high, making adjacent links easy to mistap. | Each contents link gets its own full-width, minimum 44px row. |
| Field Guide | Small text reduced the tabs to about 35px high at the 15px pane font size. | Minimum 44px for tabs and entry links, while preserving the 3+2 phone arrangement. |
| Field Guide first visit | A page of disabled question marks gave no explanation of how to fill it. | Empty sections explain that discoveries appear while playing. No hidden entries or spoilers are revealed. |
| Map | Several controls used 2.75em with reduced text, yielding targets below 44px. | A 44px floor for landmarks, place links, route controls and reading controls. |
| Story illustrations | Plate navigation could fall below 44px in small panes. | Preserve relative sizing with a 44px floor. |
| Hero sheet and bag | Narrow-screen vital labels fell to 10.8px; bag names to 10.8px and item types to 9.3px in a 15px pane. | Vital labels and bag names use 0.85em, item types 0.8em. Quest-item controls and the folded player dock have a 44px floor. |
| Bottom navigation | Labels were 11.52px at standard text size. | Raise to 13px while retaining the illustrated objects and selected-state cues. |

## Art review

The inventory-only conclusion below was incomplete. The follow-up [runtime art audit](runtime-art.md) found and fixed 19 published guide entries without wired art, an unknown story-choice icon, letterboxed place illustrations, and omitted story cast/rifts in the still-image renderer.


`node tools/art/inventory.ts` reports zero outstanding deliverables: character illustrations, class figures, gear portraits, effects, biomes, locations, story scenes, campaign covers, story plates, badges, icons and entity cutouts are present. The loaded home screen has no broken image elements. This does not establish that every screen uses its available art: the runtime follow-up found 19 guide entries silently using generic glyphs and fixed them. Undiscovered question marks and basic navigation SVGs remain intentional. Existing artwork was sufficient for these fixes.

## Experience coverage

| Area | Evidence |
| --- | --- |
| Joining, character creation, returning heroes | Real rooms at 320/360/390px, larger text, stat controls, name fields and forward buttons. |
| Lobby, room controls, notices, catch-up, rest | Existing layout checks measure clipping, corner-control overlap and broken words. |
| World/story, class fitting and confirmation | Existing layout suite exercises the Exchange, shared display and sound controls. |
| Map and exploration | Real map navigation in Party and Phone modes, landmarks, details, zoom and restored position. |
| Field Guide | New rendered touch-target regression at small-phone and portrait/landscape tablet sizes; existing component behavior coverage. |
| Help and accessibility | Remembered preferences, device preferences, largest text, one-handed controls and contextual help checks. |
| Journal, profile and bag | Journal end-to-end checks plus hero-sheet and player-panel component checks; styles reviewed for text and target sizes. |
| Setup, sign-in, shared tablet, pairing, install/recovery | Source review of dedicated screens and shared controls; layout suite covers failed chunks and sign-in loading failures. External authentication and native installation are outside this local browser run. |

## Review images

- [Small phone Field Guide](field-guide-320.png)
- [Portrait tablet Field Guide](field-guide-768.png)
- [Landscape tablet Field Guide](field-guide-1024.png)

## Validation results

- Production client build passed.
- All 19 responsive-layout/accessibility scenarios passed across the initial run (17) and tablet rerun (2); together with map/help/journal/touch-target checks, 29 distinct end-to-end scenarios passed.
- 202 component tests passed across home/screens, hero sheet, Field Guide and player controls; the 7 Field Guide tests also passed after the empty-section hint was added.
- Both real-map end-to-end scenarios passed (Phone and Party modes).
- All 8 help, journal and new touch-target end-to-end checks passed.
- The first responsive-suite run passed 17 checks but caught two tablet measurements during initial layout. A fresh diagnostic run measured the intended 64.5px choice height. Tablet assertions now retry for up to 10 seconds while keeping the original font, height and visibility limits. Both tablet cases passed on rerun.
- `git diff --check` passed.

## Remaining validation

On physical Safari devices, check the software keyboard during room-code/name entry, rotation with an open dialog, safe areas and installed-app launch. With children ages 8–10, observe whether they can join, create a hero, identify their turn, find the bag/map/guide, and return from details without instruction. The dense combat grid intentionally has smaller cells; changing its interaction requires a separate gameplay design review, rather than enlarging cells until the board no longer fits.
