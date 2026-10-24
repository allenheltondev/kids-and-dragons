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
- **owner call**: ambiguous, so put to the owner. The owner's decisions are at the end.

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
| 4a | Full screen (⛶) | `display/DisplayExtras.tsx` (`FullscreenPrompt`) | Drops the TV browser's address bar off the top of the scene. | **keep**: the Fullscreen API only answers a gesture, so only a control on this device can ask, and only once — the screen takes the button away while it is full, and a device that has been full asks for itself on the next load's first remote press (`display/fullscreen.ts`). |
| 5 | About this screen (i) | `display/DisplayExtras.tsx:84` (`:94` outside the row) | Opens the capability report (WebGL, wake lock, full screen, audio, service worker). | **keep**: it reports on this device. |
| 5a | The report's Close | `display/DisplayExtras.tsx:186` | Closes the report. | **keep**. On `main`, opening the report unmounted the focused (i), which left a remote focused on nothing. |
| 6 | Help (?) | `help/HelpControl.tsx:30` | The phone's help sheet. | n/a: never drawn on the TV (`:27`). |
| 7 | Room | `screens/HostControls.tsx:216` | Opens the host's room panel (host TV only). | **keep**: in a TV-hosted Party Mode room, no phone holds the host's controls. |

## The display's column (top right, under the corner row)

| # | Element | File:line | What it does | Verdict |
|---|---|---|---|---|
| 8 | Room panel: Make keeper, Remove, per player | `screens/HostControls.tsx:319`, `:330` | Hands a phone the keeper role; takes a player out. | **keep** (Remove is the owner's named example). |
| 9 | Room panel: Let visitors join / Stop new visitors | `screens/HostControls.tsx:449` | Opens the room to visitors. It first opens a grown-up's sign-in on the TV (`SignInFlow`, `HostControls.tsx:271`). | **keep** for the switch. The sign-in it opens stays on the TV, by owner decision (A below); a remote can reach and fill it. |
| 10 | Room panel: Lock, Quiet mode, Stop for today (and its confirm), Close the room (and its confirm) | `screens/HostControls.tsx:349`, `:365`, `:385`, `:394`, `:399`, `:408`, `:417`, `:422` | The host's levers (#263, #259, #260). | **keep**: no phone equivalent in a TV-hosted room. |
| 11 | Stop offer at a Rest: Stop here for today, Keep playing | `screens/HostControls.tsx:113`, `:125` | Comes up by itself at a Rest scene and stays until one of them is clicked. It lay over the goal header. | **auto**, by owner decision (B below): on the TV it keeps playing by itself after 15s. |
| 12 | Host TV's "Player joined" card: Remove, Dismiss (✕) | `screens/ArrivalNotices.tsx:113`, `:123` | One card per arrival, kept until dismissed. #389: at 1024×600, three cards covered the right of the goal header and the guests; in the lobby they covered the QR code. | **auto**. One line ("Pip and Bo joined"), nothing to tap, gone after `noticeMs`. Remove is still a click away in the Room panel (8), which lists everyone who ever joined and survives a refresh. |
| 13 | Host TV's "N more joined" / "Show fewer" | `screens/ArrivalNotices.tsx:80` | Unfolds the arrival cards past three. | **auto**. The one line names up to three people and counts the rest ("Pip, Bo and 3 more joined"). |
| 14 | A non-host display's "Player joined" card: Dismiss (✕) | `screens/ArrivalNotices.tsx:123` | Already went by itself after 8s. | **auto**: no ✕, and the same line as 12. |
| 15 | Flood warning, "A lot of phones are joining…" | `screens/ArrivalNotices.tsx:72` | Shown to a host while arrivals overflow; stays until the screen leaves the room. Nothing to click. | **auto**, by owner decision (C below). |
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
| 26 | "Last time…" and "Where you left off" (#378) | `screens/ChapterPreface.tsx:240`, `screens/ChapterPreface.css:21` | **auto** (already): goes by itself on a word-count timer, and `pointer-events: none`. Nothing to click; not reworked here. |

## Screens around the game

| # | Element | File:line | What it does | Verdict |
|---|---|---|---|---|
| 27 | Home: Host a game, Party Mode, Open the lobby here | `screens/HomeScreen.tsx` | Starting the room. | **keep** (the owner's example). A remote reaches all of it: the arrows wake on the start screen at a remote's first press, and the Party Mode and Phone Mode cards take focus and OK. A keyboard keeps the browser's own radio arrows. |
| 28 | "This part of the game couldn't load": Try again | `ui/ChunkBoundary.tsx:180` | Retries a chunk the TV failed to load (the game, the host controls). | **keep**: only the TV can reload its own code. The quiet boundaries in the corner row already retry by themselves when the network comes back. |
| 29 | Room closed: Back to the start | `App.tsx:315` | Leaves a closed room. | **keep**: the TV has to leave before it can host again. |
| 30 | Stopped for today: Let a hero go | `screens/HostControls.tsx:146`, `:157`, `:173`, `:178` | On the screen that stopped the game, frees a saved hero (#259). | **keep**: host only, no phone equivalent. |

## No "phone" verdicts

No item qualified. Everything a TV asks you to click is either the TV's own business (its settings,
sound, the gesture that unlocks audio, its report, reloading its code) or a host control. In a
TV-hosted room, no phone flow carries the host's controls without new design. The "Player joined"
card's Remove stays on the TV, in the Room panel, where it already was.

## Remote focus for the keep list

- `display/remote-focus.ts`, installed by `App.tsx` (a lazy chunk off the first paint). It is always on
  on the shared screen. On the start screen, where a TV hosts its room, it waits for a remote to show
  itself: an arrow pressed with nothing focused, which is how a remote begins. A keyboard Tabs in
  first and a screen reader keeps its own arrows, so for them the start screen is as it was. Once on,
  the arrow keys move focus to the nearest control
  in that direction. From nothing, an arrow lands on the first control. Focus stays inside an open
  sheet, or a dialog it is in (the visitor sign-in over the Room panel). Enter is the browser's own
  press. The ring is the global `:focus-visible` outline (`styles/theme.css`).
- Fields are reachable: the visitor sign-in's email and code fields (9) take focus as each step opens,
  and the arrows reach them too. Inside a field, Left and Right move the caret. Up and Down leave a
  one-line text field, and Escape and then any arrow leaves any field, so a remote is never stuck in
  one.
- In a group of radios (the start screen's Party Mode and Phone Mode), selection follows focus, as
  the browser's own radio arrows do: an arrow to the next radio of the same name checks it. Past the
  group's last radio that way, the arrow leaves the group (where a browser would wrap round), and
  arriving from outside only focuses. A radio hidden inside the card that draws it stands where its
  card is, and OK (Enter) checks it, as Space does. A hidden one with no card is skipped.
- When OK puts away the control it was on (Host a game opening its card), the next arrow picks up
  at the control nearest where focus stood, not back at the top of the page.
- The About report takes focus on Close when it opens, closes on Escape, and gives focus back to (i).

## Owner decisions

These three were put to the owner as owner calls, and the owner has decided them.

**A. The visitor switch's sign-in on the TV** (9). It stays on the TV as it is. A remote can get
through it: the arrows reach the email and code fields, each field takes focus as its step opens,
and Up/Down or Escape and then an arrow leave a field (`display/remote-focus.ts`). A QR code that
opens the sign-in on a phone is a separate follow-up issue, not built here.

**B. The Rest stop offer** (11). On the TV it keeps playing by itself after 15 seconds
(`STOP_OFFER_MS`, `screens/HostControls.tsx`).
- The countdown is quiet: a thin bar runs down under the buttons, with "Keeping going…". Nothing
  has to be tapped.
- Either button still works, by click or a remote's Enter, before the time runs out. Stop for
  today stays in the Room panel.
- Under reduced motion the bar stands still and full, and the timer still runs.
- The timeout does exactly what Keep playing does, which is this screen's own business: it puts the
  offer away for this Rest and sends nothing. So it happens once, the clock goes with the offer, and
  no phone or other screen is affected. While a stop is on its way, the clock waits.
- A host's phone (Phone or Travel Mode) still waits for an answer: it is not driven by a remote.

**C. The flood warning** (15). On the TV it goes after `noticeMs`, like the other notices, and comes
back if more phones fall off the list afterwards. The Room panel's roster lists everyone meanwhile.
A host's phone keeps it up, as before.
