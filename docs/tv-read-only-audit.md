# The TV is read, not driven: an audit of what it asks you to click

Owner direction: the host/TV screen is a mostly read-only experience. Driving a mouse cursor with a
TV remote is clunky, so wherever possible the TV has nothing to click, and notifications go away on
their own. A few controls have to stay, such as removing a player from the lobby.

This lists every clickable or focusable element the shared screen (`/tv/:code`) can draw, as of
`main` @ bca619b. That covers the shell (`App.tsx`: the corner row, the display's column, the
toast and the banner), `PartyLayout surface="world"` → `WorldView` and every panel and overlay it
mounts, and the shared screen's own extras (`display/`). It was checked twice: by reading the code,
and by listing every visible `button, a[href], input, select, textarea, summary, [tabindex],
[role=button]` on a live host TV in the lobby, in a story scene and with Room open.

Verdicts:

- **auto**: it can time out or update itself.
- **phone**: it belongs on a phone, but only where an existing phone flow can carry it without new
  design.
- **keep**: genuinely needed on the TV. It stays, and must work with a remote (arrows and Enter, a
  visible focus ring).
- **owner call**: ambiguous. It is left as it is, with the options set out at the end.

Unchanged owner decisions: the goal tracker updates by itself and is never tapped. The "Last time…"
recap (#378) dismisses on its own. A rendering error stays hidden behind a small red warning icon.

## The corner row (every TV screen)

| # | Element | File:line | What it does | Verdict |
|---|---|---|---|---|
| 1 | Display settings (Aa) | `a11y/A11yControl.tsx:31` | Opens the text size, contrast and motion sheet for this screen. | **keep**: settings are per device, and a phone's settings never reach the TV. The sheet already moves focus in, traps Tab, and closes on Escape. |
| 1a | The sheet's options and Done | `a11y/A11yControl.tsx:104`, `:117`, `:127`, `:131`, `:141` | Pick a setting; close the sheet. | **keep**, as 1. |
| 2 | Read-aloud | `speech/ReadAloudControl.tsx:30` | Turns read-aloud on or off on this screen. | **keep**: the TV is the device that reads aloud. |
| 3 | Sound | `audio/AudioControl.tsx:104` | Turns this screen's sound on or off. | **keep**: the TV's speakers. The host's quiet mode is a separate, room-wide switch. |
| 4 | Tap for sound | `display/DisplayExtras.tsx:142` | Unlocks audio on a browser that holds it back until a gesture. | **keep**: only a gesture on this device can unlock it. A remote's OK (Enter) counts. It is shown only while sound is held back. |
| 5 | About this screen (i) | `display/DisplayExtras.tsx:84` (`:94` outside the row) | Opens the capability report (WebGL, wake lock, audio, service worker). | **keep**: it reports on this device. |
| 5a | The report's Close | `display/DisplayExtras.tsx:186` | Closes the report. | **keep**. On `main`, opening the report unmounted the focused (i), which left a remote focused on nothing. |
| 6 | Help (?) | `help/HelpControl.tsx:30` | The phone's help sheet. | n/a: never drawn on the TV (`:27`). |
| 7 | Room | `screens/HostControls.tsx:216` | Opens the host's room panel (host TV only). | **keep**: in a TV-hosted Party Mode room, no phone holds the host's controls. |

## The display's column (top right, under the corner row)

| # | Element | File:line | What it does | Verdict |
|---|---|---|---|---|
| 8 | Room panel: Make keeper, Remove, per player | `screens/HostControls.tsx:319`, `:330` | Hands a phone the keeper role; takes a player out. | **keep** (Remove is the owner's named example). |
| 9 | Room panel: Let visitors join / Stop new visitors | `screens/HostControls.tsx:449` | Opens the room to visitors. It first opens a grown-up's sign-in on the TV (`SignInFlow`, `HostControls.tsx:271`). | **keep** for the switch. The sign-in it opens is an **owner call** (A below). |
| 10 | Room panel: Lock, Quiet mode, Stop for today (and its confirm), Close the room (and its confirm) | `screens/HostControls.tsx:349`, `:365`, `:385`, `:394`, `:399`, `:408`, `:417`, `:422` | The host's levers (#263, #259, #260). | **keep**: no phone equivalent in a TV-hosted room. |
| 11 | Stop offer at a Rest: Stop here for today, Keep playing | `screens/HostControls.tsx:113`, `:125` | Comes up by itself at a Rest scene and stays until one of them is clicked. It lay over the goal header. | **owner call** (B below). |
| 12 | Host TV's "Player joined" card: Remove, Dismiss (✕) | `screens/ArrivalNotices.tsx:113`, `:123` | One card per arrival, kept until dismissed. #389: at 1024×600, three cards covered the right of the goal header and the guests; in the lobby they covered the QR code. | **auto**. One line ("Pip and Bo joined"), nothing to tap, gone after `noticeMs`. Remove is still a click away in the Room panel (8), which lists everyone who ever joined and survives a refresh. |
| 13 | Host TV's "N more joined" / "Show fewer" | `screens/ArrivalNotices.tsx:80` | Unfolds the arrival cards past three. | **auto**. The one line names up to three people and counts the rest ("Pip, Bo and 3 more joined"). |
| 14 | A non-host display's "Player joined" card: Dismiss (✕) | `screens/ArrivalNotices.tsx:123` | Already went by itself after 8s. | **auto**: no ✕, and the same line as 12. |
| 15 | Flood warning, "A lot of phones are joining…" | `screens/ArrivalNotices.tsx:72` | Shown to a host while arrivals overflow; stays until the screen leaves the room. Nothing to click. | **owner call** (C below). |
| 16 | Error toast's Dismiss (✕) | `ui/ErrorToast.tsx:38` | Already went by itself after 6s. Bottom centre, over the story plate. | **auto**: no ✕ on the TV, in the column (off the plate), gone after `noticeMs`. |
| 17 | Reconnecting banner | `ui/ConnectionBanner.tsx:53` | Shown while the stream is down; goes when it is back. Nothing to click. | **auto** (already). In the column on the TV, so it is never on the chapter title or goal. |
| 18 | "New in the Field Guide" banner (TV) | `screens/FieldGuideNews.tsx:194` | A plain `div`: nothing to click (only the phone's toast, `:123`, is a button). It went after 5s, top centre, over the chapter's title and goal. | **auto** (already). In the column, and up for `noticeMs` of its words. |

## The story, the lobby and the stage (WorldView)

Nothing in these takes a click or focus on the TV. The live inventory found none.

| # | Element | File | Verdict |
|---|---|---|---|
| 19 | Lobby (room code, QR, party, who is ready) | `screens/LobbyContent.tsx` | n/a: nothing to click. |
| 20 | Story plate and its choices | `screens/NarrationPanel.tsx:489` | n/a: the choices are a read-only list on the TV; the phones vote. |
| 21 | Chapter goal | `screens/ChapterGoal.tsx` | n/a: it updates itself (owner decision). |
| 22 | Turn banner, rift status | `screens/TurnBanner.tsx`, `screens/RiftStatus.tsx` | n/a. |
| 23 | Dice card, tier cutscene, rank-up moment | `screens/DiceOverlay.tsx`, `screens/TransformCutscene.tsx`, `screens/RankUpMoment.tsx` | **auto** (already): timed, and the rank-up lets every pointer through. |
| 24 | Chapter complete | `screens/ChapterCompletePanel.tsx` | n/a: nothing to click on the TV. |
| 25 | Renderer failure warning | `world/RendererFallback.tsx` | n/a: a small red icon, not focusable (owner decision). |
| 26 | "Last time…" and "Where you left off" (#378) | `screens/ChapterPreface.tsx` | **auto**: timed, `pointer-events: none` (checked once #378 is on `main`). |

## Screens around the game

| # | Element | File:line | What it does | Verdict |
|---|---|---|---|---|
| 27 | Home: Host a game, Party Mode, Open the lobby here | `screens/HomeScreen.tsx` | Starting the room. | **keep** (the owner's example). |
| 28 | "This part of the game couldn't load": Try again | `ui/ChunkBoundary.tsx:180` | Retries a chunk the TV failed to load (the game, the host controls). | **keep**: only the TV can reload its own code. The quiet boundaries in the corner row already retry by themselves when the network comes back. |
| 29 | Room closed: Back to the start | `App.tsx:315` | Leaves a closed room. | **keep**: the TV has to leave before it can host again. |
| 30 | Stopped for today: Let a hero go | `screens/HostControls.tsx:146`, `:157`, `:173`, `:178` | On the screen that stopped the game, frees a saved hero (#259). | **keep**: host only, no phone equivalent. |

## No "phone" verdicts

No item qualified. Everything a TV asks you to click is either the TV's own business (its settings,
sound, the gesture that unlocks audio, its report, reloading its code) or a host control. In a
TV-hosted room, no phone flow carries the host's controls without new design. The "Player joined"
card's Remove stays on the TV, in the Room panel, where it already was.

## Remote focus for the keep list

- `display/remote-focus.ts`: on the shared screen, the arrow keys move focus to the nearest control
  in that direction. From nothing, an arrow lands on the first control. Focus stays inside an open
  sheet, and an arrow is left alone inside a text field. Enter is the browser's own press. The ring is
  the global `:focus-visible` outline (`styles/theme.css`).
- The About report takes focus on Close when it opens, closes on Escape, and gives focus back to (i).

## Owner calls

**A. The visitor switch's sign-in on the TV** (9). "Let visitors join" opens a grown-up's email
and code sign-in on the TV, which means typing with a remote. Options: (1) leave it; (2) have the TV
show a QR code that opens the sign-in on the grown-up's phone (new design); (3) hide the switch on
a host TV and offer it only on a host phone (a TV-hosted room would then have no visitor switch).

**B. The Rest stop offer** (11). It still waits for a click, but it now stands in the column,
below the goal header and off the plate, so it no longer covers either. Options: (1) leave it;
(2) let it go by itself after a while, since Stop for today stays in the Room panel; (3) make it a
line with nothing to tap ("A good place to stop. Room → Stop for today"), which is new copy.

**C. The flood warning** (15). It has nothing to click, but it stays up while arrivals overflow
and it is a security warning. Options: (1) leave it up, as now; (2) let it go after `noticeMs`
like the other notices, with the roster in the Room panel still showing everyone.
