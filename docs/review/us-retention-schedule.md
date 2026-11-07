# Retention schedule (#524, part of #320)

Dated 2026-10-27, updated 2026-11-07. Status: **enforced in code for the rows marked "Enforced"**
(branch `privacy/retention-524`); the rest are as they were. Not yet checked against the deployed
account (see the end). This is an engineering document, not legal advice, and the rule citations in
[us-coppa-data-consent.md](./us-coppa-data-consent.md) are still unverified.

The rule's idea, as the author understands it and **unverified**, is that child data is kept only
as long as reasonably necessary for the purpose it was collected for, with a written policy and a
safe disposal method. A period is only defensible if the purpose behind it is real, so each row
names one. Where the purpose is a guess, the row says so.

## Schedule

"Idle" means since **that kid** last joined a room (`notePlayed`), counted per kid (owner decision
2026-11-07): siblings who still play do not keep a kid who stopped. A kid who was added and never
played counts from when she was added (`createProfile`), or from when her household was kept by
signing in (`linkAccount` → `startClocks`). "Swept" means the daily sweeper (`lambda/sweep.ts`,
`GuestSweepSchedule`, every 24 hours, 25 per batch) deletes the DynamoDB rows. "TTL" means the row
carries the table's `ttl` and DynamoDB deletes it, normally within a few days of the time.

| Record | Purpose | Retention | Disposal | State |
| --- | --- | --- | --- | --- |
| Guest household, with its kids, heroes, runs, devices, field guide | A family keeps playing across the week without signing in | 7 days after last play, renewed whenever a room opens (`GUEST_HOUSEHOLD_TTL_MS`) | Swept; whole household deleted | Unchanged |
| A kid in a kept household, with her heroes, phones, visits, push subscriptions | Heroes continue across a campaign, which takes weeks, and across breaks | **365 days idle** (`DEFAULT_RETENTION_DAYS`), or the 30, 90 or 180 days an owner chose. No "never": `retentionChoice` refuses `null` | Idle sweep (`sweepIdleProfiles`), which also scrubs her names from other tables' saves | **Enforced** |
| Kept household (rows, saves, field guide, camp, owner rows, account pointers) | Same | **Deleted when the idle sweep removes its last kid** (`retireIfLast`, fenced: see below). A household with any kid left stays | Swept with the last kid; `repo.deleteRetiringHousehold` | **Enforced** |
| Cognito owner (parent email, passkeys) | Let a grown-up sign in and manage the household | **Deleted with a kept household the idle sweep empties**, if that grown-up owns no other household (`CognitoDirectory`, `AdminDeleteUser` by `sub`) | Cognito `AdminDeleteUser` | **Enforced for the sweep.** See gaps: not on an owner's own delete |
| Hero (character row) | The hero's progress | Lives with the kid | Deleted with her | Unchanged |
| Saved game state, chapter progress | Pick a game up another day | Lives with the household | Deleted with the household | Unchanged |
| Event log (`EVT#` rows), any run | Let a phone that dropped catch up mid-run; nothing else reads it (checked 2026-11-07, below) | **30 days after the store writes each event** (`EVENT_TTL_SECONDS`); a forget's rewrite keeps the original expiry | TTL; expired rows are also filtered out of reads | **Enforced** |
| Room, presence | Run a live table | 6 hours | TTL | Unchanged |
| Device binding (id, kind, user agent, last seen) | Recognize a returning phone; let a grown-up tell tablets apart | With the household | Deleted with the household or the kid | Unchanged (user agent depends on #522) |
| Device login token | Stay signed in to a device | 30 days, renewed after 15 | Expires | Unchanged |
| Visit rows (`VISIT#`) | Find a kid's saves at other tables so deleting her can scrub them | Until she or the visited household is deleted | Deleted with her | Unchanged |
| Forget job (`FORGET#`) | Finish a scrub that failed part-way | Until every table is clean; retried daily | Deleted when done | Unchanged (no alert: owner decision 2026-11-07) |
| Push subscription | "It's your turn" notice | **30 days after it was last confirmed**: a push the service accepted (`touchPushSubscription`), or the phone subscribing again, which the push switch does whenever it is shown. Also until switched off, or the kid or device is deleted | TTL; expired rows are also filtered out of reads | **Enforced** |
| Invite, transfer, pairing, screen codes | One-time actions | 3 days, 1 day, 10 minutes, 10 minutes | TTL | Unchanged |
| Wrong-code counters | Stop guessing room codes | 15-minute windows, about half an hour kept | TTL | Unchanged |
| Session timing marks | Operator measures how long chapters take | 180 days, no player id | TTL | Unchanged; 180 vs 90 still undecided |
| Lambda logs (`/aws/lambda/<stack>-*`) | Debug and operate | **A stream is deleted at the first monthly sweep after its newest line is 30 days old: at most about two months** | `LogSweepFunction` (`lambda/log-sweep.ts`, `LogSweepSchedule`, 04:00 UTC on the 1st), `DeleteLogStream`. No `RetentionInDays`: owner decision, see below | **Enforced** once deployed |
| Backups and exports | Disaster recovery | Point-in-time recovery is **off** by owner decision (`template.yaml`); other backups unknown | To verify | Unchanged |

## What a family sees

- A kid who stops playing in a kept household is deleted, with her heroes, a year after she last
  played (or the shorter window chosen). When the last kid goes, the household and the sign-in of
  each grown-up who runs nothing else go too. **There is no warning email** (declined 2026-10-27);
  the policy and "What we store" say so.
- The "until a grown-up deletes them" choice is gone from Run a group.
- Nothing changes for a kid who keeps playing.

## How retiring a household stays safe (review of #681)

Deleting a household and a sign-in is irreversible, so the decision is fenced against anything
being added while it is made (`retireIfLast` in `handlers/retention.ts`):

1. **The household is marked** (`beginRetiring`, `retiring` on `META`). From then on no kid can be
   made in it (`createPlayer`, a transaction with a check on `META`), moved into it (the move's
   check), or given an owner (`putOwner`).
2. **Only then is emptiness read**, strongly consistent (`hasPlayers`). A kid added before the mark
   is seen and the mark comes off; one after is refused.
3. **The owners are read** (strongly consistent, after the mark) **and written onto the kid's forget
   job** before anything is deleted.
4. **The delete needs the mark** (`deleteRetiringHousehold`): a write that replaced `META` since
   (a rename) took the mark, so the job goes back to step 1 on the next sweep.
5. **Each owner's sign-in is marked** (`ACCT#<sub>` / `RETIRING`, 7-day `ttl`), which refuses every
   new household pointer for it (`putAccountPointer`, `putOwner`, and `claimHousehold`, now one
   transaction with its pointer). **Only then is ownership read**, strongly consistent
   (`ownsAnyHousehold`): a pointer written before the mark keeps the sign-in, one after is refused.
   Then `AdminDeleteUser`.
6. **Retryable throughout.** The kid's forget job stays until all of this and the scrub finish;
   `retryForgets` runs `retireIfLast` for every `idle` job, from wherever it stopped, including
   after the last kid's row is already gone.

## Who reads old events (checked 2026-11-07)

Only two code paths read `EVT#` rows (`repo.listEvents`):

- **Reconnect catch-up** (`handlers/state.ts`, `getState` with `sinceSeq`): replays at most
  `MAX_REPLAY_EVENTS` (50) and returns a full snapshot when the events are not all there. A missing
  event degrades to a snapshot.
- **Forgetting a kid** (`retention.ts`, `forgetInLog`): scrubs her names from each event. An event
  already gone has nothing to scrub; `rewriteEvent` is conditional on the row existing.

The journal, the adventure book's crew backfill, save and resume, campaign completion and the
"later campaigns need Gemfall" check, characters, the Field Guide and the camp all read the `STATE`
row or their own records. No run has an "ended" marker (`RunRecord.status` is only ever `active`),
which is why the expiry counts from each event's write rather than from the end of the run.

## Gaps this does not close

- **Kids already in a kept household with no window set** are not on the clock until they next
  play, are added, or an owner picks a window: the index the sweep reads only holds kids with a
  date. No backfill was written (owner decision 2026-11-07: the only such kid is the owner's own).
- **A household that never had a kid** (an owner made a group and added nobody) is never swept: the
  sweep only finds households through their kids.
- **An owner who deletes a household themselves keeps their Cognito sign-in.** They are signed in at
  that moment and may start another; deleting the sign-in under them would break Run a group. If
  they never do, the sign-in (an email) stays. Options: a "delete my sign-in too" choice on that
  delete, or a sweep of sign-ins that own nothing after some period. Undecided.
- **No alarms**, by owner decision: a retirement that keeps failing is retried every day from the
  kid's forget job and logged (`[sweep] could not…`), and nothing else tells anyone.
- **Whether the sweeper keeps up.** 25 households and 25 idle kids per daily run; no alarm or backlog
  metric (owner decision: no alarms).
- **Log groups outside `/aws/lambda/<stack>-*`.** The stack configures no API Gateway access logs,
  AppSync logs or CloudFront logs; if the account has any, the sweeper does not touch them.
- **Third-party copies.** Push services and browser voices keep nothing the operator can delete
  (see [us-third-party-flows.md](./us-third-party-flows.md)).
- **Anything legally required to be kept.** None has been identified. If counsel names one, add it
  here with the reason.

## Still to do

1. Deploy, after redeploying the deploy-role stack (`infra/github-oidc.yaml`), which now allows the
   `kad-log-sweep-<stage>` schedule.
2. Check the real account for log groups, their current retention, backups and exports, and record
   dated evidence here (#525).
3. Decide the owner-deleted sign-in gap above.

## Decision record

| Date | Decision | By |
| --- | --- | --- |
| 2026-10-27 | Proposed the schedule. | Claude |
| 2026-10-27 | Approved: 365 days idle as the kept-household default, with the owner able to shorten it. | Owner |
| 2026-10-27 | Approved: trim finished runs' event logs (30 days after the run ends), after checking what reads old events. | Owner |
| 2026-10-27 | Declined for now: the pre-deletion email. Households are deleted without warning, so the policy must say so plainly. | Owner |
| 2026-11-07 | Existing kept households are never deleted on the spot: their kids' 365 days start no earlier than the deploy (in practice, from their next play, since no backfill runs). Only inactive kids are deleted, counted per kid. | Owner |
| 2026-11-07 | Event logs: checked (above); each event expires 30 days after it is written, since no run has an end marker and nothing reads old events. | Claude, on the owner's approval of the trim |
| 2026-11-07 | Push subscriptions: 30 days with no successful send. | Owner |
| 2026-11-07 | Logs: 30 days, by a **monthly** sweeper Lambda, not `RetentionInDays` in SAM (which has caused deploy problems). Public wording: up to about two months. | Owner |
| 2026-11-07 | No alarms. No backfill script. | Owner |
