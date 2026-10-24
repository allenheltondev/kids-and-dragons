# Installed-app device QA (#414)

The last step of the installable-app epic (#410). Run it by hand, on real phones, before the
epic closes and again after any change to the manifest, the service worker or room rejoin.

## Why this exists

Headless Chromium is not an iPhone. It cannot show Safari's Add to Home Screen sheet, and it
cannot tell us that an iOS Home Screen app may keep its storage apart from Safari's, so a hero
made in a Safari tab can be missing from the installed app. The real install prompt, the audio
unlock that needs a finger tap, and what the OS does when an app is backgrounded or killed are
device-only too. The automated suites (named in the table) cover what a browser can prove: the
manifest, its icons, installability, and the book opening offline. Everything else is here.

## Platforms

Run every row on each of these. A row that does not apply to a platform (for example, the
Chromium prompt on iPhone) is marked "n/a" in the results, never skipped silently.

| Platform | Mode |
|---|---|
| Android phone, Chrome | Installed app, and a plain Chrome tab |
| iPhone, Safari | Added to Home Screen, and a plain Safari tab |
| iPad, iPadOS Safari | Added to Home Screen, and a plain Safari tab |
| Any laptop or smart-TV browser | The TV for Party Mode, in a plain tab, never installed |

Use a staging or production build whose commit you know, and write it down.
Start each pass with a fresh install, and with no saved site data for the site.

## Checklist

"Installed" means launched from the Home Screen or launcher icon. "Plain tab" means the browser.

| Check | How to do it | Expected | Automated coverage |
|---|---|---|---|
| Install | Android: open the site in Chrome, accept the install prompt or use menu, Install app. iOS and iPadOS: Share, Add to Home Screen, Add. | The icon lands on the Home Screen or launcher. Nothing blocks or nags before the install. | Manifest and icons: `e2e/installable.spec.ts`, `packages/client/src/sw/manifest.test.ts`. The prompt and the iOS sheet: device only. |
| Icon, name and splash | Look at the icon and its label on the Home Screen. Launch it and watch the first second. | The dragon icon is not cropped or letterboxed (Android masks it to a circle or squircle). The label reads "Kids & Dragons". The splash is dark, not white. | Icon sizes, maskable safe zone and colors: `manifest.test.ts`. How it looks on a real launcher: device only. |
| Launch with no browser chrome | Open the installed app. | No address bar or browser tabs. The status bar matches the dark theme color. | Manifest says `standalone`: `manifest.test.ts`. Device only for what the OS shows. |
| Safe areas and notch | In the installed app, on a phone with a notch or home bar, open the lobby, a scene and the book. On the iPad, do the same held sideways. | No text or button sits under the notch, the camera cutout or the home bar. The commit button is fully tappable. On the iPad, the rail's controls and the corner controls at its foot clear the home bar. | Device only. |
| Rotation | Rotate the phone and the iPad in the lobby, in a scene and in the book. On the iPad, open the map while held sideways, wait for a question, then turn it upright. | Layout refits with nothing cut off. Nothing resets: same screen, same room. The iPad held sideways shows the tray as a rail down the side (help, text, read-aloud and sound at its foot) and the world or the map beside the hero's controls, which are a drawer: tapping You slides it away and the picture takes the whole width, and tapping it again brings it back; upright, one pane at a time with the tray along the bottom. A phone held sideways shows a slimmer rail down the side, the world or the map beside the same drawer, and help, text, read-aloud and sound in a column on the far edge (the back button at its foot); one-handed play swaps the two sides. Upright it is the tray along the bottom again, and a question that came while sideways is the pane showing. | Layout fit at fixed sizes, a landscape iPad among them: `e2e/layout-fit.spec.ts`. Which pane shows, and the question coming forward on turning upright: `packages/client/src/layout/travel-layout.test.tsx`, `party-layout.test.tsx`. The turn itself: device only. |
| In-app back and navigation | In the installed app, move between the book's tabs, open a menu, then use the system back gesture or button. | Back goes to the previous view, or does nothing harmful. It never drops a player out of a room or lands on a blank page. There is a way back to the lobby without a browser button. | Device only. |
| Update after a deploy, room open | Join a room on the installed app. Deploy a new build (or redeploy the same ref). Wait, then background and reopen the app. | The room keeps working. The new build takes over at a calm moment, not mid-decision. No reload loop, no error screen. | Tab open across a deploy can still open the book: `e2e/offline.spec.ts`. With a question open the page does not reload; once it is answered it reloads into the same room on the new build (`e2e/worker-update.spec.ts`, #456). Wake asks the worker for updates at most every five minutes. |
| Broken cache recovers | On a phone with the installed app, open it once online. In desktop Chrome DevTools or by clearing site data in a way that leaves the worker, break the saved bundle (or serve a bad build), then open the app. | After a few seconds it reloads on its own, clears its saved files and starts. Never a loop: if it still cannot start, it says "Kids & Dragons could not start. Check the Wi-Fi and open it again." The hero is still there. | `e2e/boot-heal.spec.ts`, `packages/client/src/boot/policy.test.ts`. A real phone's broken cache: device only. |
| Leave and rejoin a room | Join as a player, leave the room, then rejoin with the same code. | The same hero returns. The TV shows one player, not two. | "PWA 3 (#413)" planned. Device only for installed-app behavior. |
| Background then foreground, mid-room | In a room, press Home or switch apps for 30 seconds, then return. | The phone shows the current scene, still in the room. If a vote closed meanwhile, the phone says so and catches up. No duplicate player. | "PWA 3 (#413)" planned. Device only for what the OS suspends. |
| Phone stays awake in a room | Join a room and leave the phone untouched past its normal screen timeout. Then leave the room and wait again, and do the same on the lobby and the journal. | The screen stays on while the room is open (a refused or missing lock is silent, and the screen sleeps as usual). In the lobby and the journal it sleeps on schedule. A shared family tablet that is only watching sleeps too. | Hold and release decision: `packages/client/src/display/phone-wake.test.ts`. Request and release with a stubbed lock: `e2e/phone-wake.spec.ts`. Whether a real phone stays lit: device only. |
| App killed, then relaunched | In a room, swipe the installed app away from the app switcher. Reopen it. | It opens to the hero and offers the room again, or the lobby. It never shows a blank screen or a second copy of the hero. | "PWA 3 (#413)" planned. Device only. |
| Audio unlock and read-aloud | In the installed app, tap into a scene with sound and turn on read-aloud. Do it once after a fresh launch. | Sound plays after the first tap. Read-aloud speaks. Silent mode and volume behave as they do in the browser (note any difference). | Read-aloud logic: `e2e/read-aloud.spec.ts`. The unlock on a real phone: device only. |
| Adventure book, online then offline | Open the book with a signal (hero, Map, Field Guide). Turn on airplane mode. Close and reopen the installed app, then open the book. | The hero, the map painting and the Field Guide all show. Nothing is a broken image. | `e2e/offline.spec.ts` (reload and new tab, offline art). On an installed app: device only. |
| Airplane mode inside a room | Join a room. Turn on airplane mode, then try to commit a decision. Turn it off. | While offline, no decision is accepted and the phone says "No signal. Waiting for Wi-Fi…" with no Try again button. After reconnecting, it reads "Reconnecting…" until synced, then the phone resyncs to the current scene without a double vote. | "PWA 3 (#413)" planned. Device only. |
| Safari hero to installed app, by pairing | Make a hero in a Safari tab. Install. In Safari, open Account and get a pairing code. In the installed app, open Account and enter it. | The installed app shows the same hero. If the Home Screen app started empty, this is the way across, and the steps are clear. | Pairing flow: `e2e/pairing.spec.ts`. Storage split on iOS: device only. |
| Installed hero to browser, by pairing | Make a hero in the installed app. In the installed app, open Account and get a pairing code. In a plain tab, open Account and enter it. | The plain tab shows the same hero. Both can join rooms. | `e2e/pairing.spec.ts`. Device only for the installed side. |
| First launch in the installed app, starting fresh | Install without ever making a hero in the browser. Open the installed app. | A clean first run: no error, no half-saved hero. Making a hero works and survives a relaunch. | `e2e/first-playable.spec.ts` in a plain tab. Installed: device only. |
| QR join to a browser TV | Open the TV in a browser. On the installed phone, scan the QR code with the camera (or the in-app join). | The phone joins that room. Where `launch_handler` is supported (Chrome on Android and desktop), the already-installed app is focused and joins; elsewhere it opens in the browser or the app, and either way the join works. Note which one opens. | "PWA 2 (#412)" planned for link handling. Device only for the scan. |
| Join link from another app | Send the join link in Messages (iOS) and in a chat or email app (Android). Tap it on each. | It opens and joins the room, with the room code intact. Where `launch_handler` is supported the installed app is focused, not a second window. Note whether it lands in the browser or the installed app, and that a player is never stuck on a blank page. | Join link in a plain tab: `e2e/installable.spec.ts`. From another app: device only. |
| Share invite from the installed app | In the installed app, start a Phone Mode room. Open Running this room and tap Share invite. Pick Messages or another app. Then try a browser with no share sheet. | The share sheet opens with "Join our Kids & Dragons game:" and the join link. Without a share sheet the button says Copied, or shows the link to select. The TV never shows the button. | Decision and wording: `packages/client/src/ui/share-invite.test.ts`. Stubbed share and copy: `e2e/host-controls.spec.ts`. The real sheet: device only. |
| Share to Kids & Dragons | On the TV, copy the join link or room code. On an installed Android phone, share it from Messages or Chrome, and pick Kids & Dragons in the share sheet. Then share some text with no code in it. | The app opens on the join screen for that room, code filled in. A share with no code lands on the home screen. iOS has no share target: N/A. | Parser: `packages/client/src/install/share-target.ts` tests; manifest member: `manifest.test.ts`. The share sheet: device only. |
| TV never asked to install | Open the TV and the host screens in a browser on each device. Play a full scene. | No install banner, prompt or "Add to Home Screen" nudge appears on the TV. | `e2e/installable.spec.ts` (nothing asks to install in a plain tab). Install guidance: "PWA 2 (#412)" planned. |

## Recording a pass

A pass is two tables, copied into a comment on #414 (or a file linked from it): the result of every
check on every device and mode, and a summary row per device. Write the commit of the build you
tested, not "latest".

### Results, per check

Mark every cell **Pass**, **Fail**, **N/A** (the check cannot apply there, such as installing the
TV) or **Not run**. Never leave one blank. Every Fail links the issue filed for it in Notes, and
every N/A or Not run says why there.

| Check | Android, installed | Android, Chrome tab | iPhone, Home Screen | iPhone, Safari tab | iPad, Home Screen | iPad, Safari tab | TV, browser tab | Notes / issues |
|---|---|---|---|---|---|---|---|---|
| Install |  |  |  |  |  |  |  |  |
| Icon, name and splash |  |  |  |  |  |  |  |  |
| Launch with no browser chrome |  |  |  |  |  |  |  |  |
| Safe areas and notch |  |  |  |  |  |  |  |  |
| Rotation |  |  |  |  |  |  |  |  |
| In-app back and navigation |  |  |  |  |  |  |  |  |
| Update after a deploy, room open |  |  |  |  |  |  |  |  |
| Broken cache recovers |  |  |  |  |  |  |  |  |
| Leave and rejoin a room |  |  |  |  |  |  |  |  |
| Background then foreground, mid-room |  |  |  |  |  |  |  |  |
| Phone stays awake in a room |  |  |  |  |  |  |  |  |
| App killed, then relaunched |  |  |  |  |  |  |  |  |
| Audio unlock and read-aloud |  |  |  |  |  |  |  |  |
| Adventure book, online then offline |  |  |  |  |  |  |  |  |
| Airplane mode inside a room |  |  |  |  |  |  |  |  |
| Safari hero to installed app, by pairing |  |  |  |  |  |  |  |  |
| Installed hero to browser, by pairing |  |  |  |  |  |  |  |  |
| First launch in the installed app, starting fresh |  |  |  |  |  |  |  |  |
| QR join to a browser TV |  |  |  |  |  |  |  |  |
| Join link from another app |  |  |  |  |  |  |  |  |
| Share invite from the installed app |  |  |  |  |  |  |  |  |
| Share to Kids & Dragons |  |  |  |  |  |  |  |  |
| TV never asked to install |  |  |  |  |  |  |  |  |

### Summary, per device

| Date | Tester | Device | OS | Browser/mode | Build (commit) | Pass / Fail / N/A / Not run | Notes / issues filed |
|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  /  /  /  |  |
|  |  |  |  |  |  |  /  /  /  |  |
|  |  |  |  |  |  |  /  /  /  |  |

## Closing the epic

#410 closes only after one recorded pass, with every check passed or explained in the per-check table, on at least one
Android phone and at least one iPhone or iPad. A pass on a laptop's device emulation does not
count.
