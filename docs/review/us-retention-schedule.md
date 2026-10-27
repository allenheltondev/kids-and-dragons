# Retention schedule (#524, part of #320)

Dated 2026-10-27. Status: **proposal. Nothing in this file is enforced yet.** The "Today" column is
read from the code; the "Proposed" column is a suggestion from what each record is for, and the
owner has not approved it. This is an engineering document, not legal advice, and the rule
citations in [us-coppa-data-consent.md](./us-coppa-data-consent.md) are still unverified.

The rule's idea, as the author understands it and **unverified**, is that child data is kept only
as long as reasonably necessary for the purpose it was collected for, with a written policy and a
safe disposal method. A period is only defensible if the purpose behind it is real, so each row
names one. Where the purpose is a guess, the row says so.

## Schedule

"Idle" means since the kid, or anyone in the household, last played. "Swept" means the daily
sweeper (`lambda/sweep.ts`, `GuestSweepSchedule`, runs every 24 hours) deletes the DynamoDB rows.

| Record | Purpose | Today | Proposed | Disposal |
| --- | --- | --- | --- | --- |
| Guest household, with its kids, heroes, runs, devices, field guide | A family keeps playing across the week without signing in | 7 days after last play, renewed whenever a room opens (`GUEST_HOUSEHOLD_TTL_MS`) | **No change: 7 days idle** | Swept; whole household deleted |
| Kept household (a grown-up signed in) | Heroes continue across a campaign, which takes weeks, and across breaks | No limit | **Deleted 365 days after anyone last played**; owner may shorten to 30, 90 or 180; no "never" | Swept; whole household, owner rows and account pointer deleted |
| A kid who stops playing, in a kept household | Same | Kid kept until the owner deletes her, or for the 30/90/180/365 days the owner chose (default: never) | **Default 365 days idle**, owner may shorten; same options minus "never" | Existing idle sweep (`retention.ts`), which also scrubs her name from other tables' saves |
| Hero (character row) | The hero's progress | Lives with the kid | Same as her | Deleted with her |
| Saved game state, chapter progress | Pick a game up another day | Lives with the household | Same as the household | Deleted with the household |
| Event log of a **finished** run (`EVT#` rows) | Let a phone that dropped catch up mid-run | Lives with the household | **30 days after the run ends**, if nothing else reads it (not yet checked: recaps, journal, "story so far") | Delete rows; keep run summary |
| Event log of a run in progress | Same | Lives with the household | Same as the household | Deleted with the household |
| Room, presence | Run a live table | 6 hours | **No change** | DynamoDB TTL |
| Device binding (id, kind, user agent, last seen) | Recognize a returning phone; let a grown-up tell tablets apart | With the household | With the household. **Stop storing user agent for visitors** if option B is chosen (#522) | Deleted with the household |
| Device login token | Stay signed in to a device | 30 days, renewed after 15 | **No change** | Expires |
| Visit rows (`VISIT#`) | Find a kid's saves at other tables so deleting her can scrub them | Until she or the visited household is deleted | **No change** | Deleted with her |
| Forget job (`FORGET#`) | Finish a scrub that failed part-way | Until every table is clean; retried daily | **No change**, plus an alert if one is older than 7 days | Deleted when done |
| Push subscription | "It's your turn" notice | Until switched off, or the kid or device is deleted | **Also delete after 90 days with no successful send** | Deleted |
| Invite, transfer, pairing codes | One-time actions | 3 days, 1 day, 10 minutes | **No change** | DynamoDB TTL |
| Wrong-code counters | Stop guessing room codes | 15-minute windows, about half an hour kept | **No change** | DynamoDB TTL |
| Session timing marks | Operator measures how long chapters take | 180 days, no player id | **180 days** is a guess at a useful sample size; **90 if you cannot justify more**. Write the reason here. | DynamoDB TTL |
| Cognito owner (parent email, passkeys) | Let a grown-up sign in and manage the household | Until the household is deleted | Deleted with the household. **Check that household deletion removes the Cognito user**: not verified in the code | Cognito `AdminDeleteUser` (confirm it is called) |
| Lambda and API logs (CloudWatch) | Debug and operate | Unknown; set by a utility outside this repo | **30 days**, declared in the template once the real setting is known | Log group retention |
| Backups and exports | Disaster recovery | Point-in-time recovery is **off** by owner decision (`template.yaml`); other backups unknown | **None** unless the owner decides otherwise; if any exist, they expire within 35 days | To verify |

## What a family would see if this is adopted

- A kept household that nobody plays in for a year is deleted, with its heroes. **There is no
  warning email** (declined 2026-10-27), so the public pages must say this clearly.
- The "until I delete them" choice goes away.
- Nothing changes for a household that is playing.

## Things this schedule cannot promise yet

- **Whether the sweeper keeps up.** It deletes 25 households per run. If a run fails the batch
  waits a day; no alarm was found in the code or template. Needs a failure alarm and a backlog metric.
- **Cross-table cleanup.** A deleted kid is scrubbed from other tables' saves by forget jobs,
  retried daily; this audit found no attempt limit and no alert in the code. An old job would mean her name is still in
  someone else's game.
- **Visitor re-credit.** A kid who played at another table keeps that table's save naming her
  until it is scrubbed. The schedule above depends on the scrub working.
- **Third-party copies.** Push services and browser voices keep nothing the operator can delete
  (see [us-third-party-flows.md](./us-third-party-flows.md)).
- **Anything legally required to be kept.** None has been identified. If counsel names one, add
  it here with the reason.

## To enforce this

Not done. When the numbers are approved:

1. Add `retentionDays` default (365) and remove `null` from `RETENTION_CHOICES` use
   (`shared/types/protocol.ts`, `handlers/retention.ts`, `OrganizerPanel.tsx`).
2. Give kept households an idle expiry and extend the sweeper to delete the household, owner rows
   and Cognito user.
3. Add the event-log trim, after checking what reads old events.
4. Add the pre-deletion email, if approved.
5. Declare log retention in `infra/template.yaml` once the real setting is known.
6. Tests: a household idle past its period is deleted with every row kind
   (the existing `retention-stores.test.ts` and `guest-window.test.ts` are the place to extend); a
   failed forget job is retried and alarmed; the Cognito user is gone.
7. Update the public "What we store" page and the policy (#523), which currently say the household
   is kept "until a grown-up deletes it".
8. Check the real account for logs, backups and exports, and record dated evidence here.

## Decision record

| Date | Decision | By |
| --- | --- | --- |
| 2026-10-27 | Proposed the schedule above. | Claude |
| 2026-10-27 | Approved: 365 days idle as the kept-household default, with the owner able to shorten it. | Owner |
| 2026-10-27 | Approved: trim finished runs' event logs (30 days after the run ends), after checking what reads old events. | Owner |
| 2026-10-27 | Declined for now: the pre-deletion email. Households are deleted without warning, so the policy must say so plainly. | Owner |
| 2026-10-27 | Not yet decided: the other rows (push 90 days, timing 180 or 90, logs 30 days). | Owner |
