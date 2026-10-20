# Load and soak test: how to run it

This is the procedure for #319 (part of #321). The script is `tools/load/`;
`npm run load -- --help` lists every option.

**The staging run is for the owner.** It was written without access to staging, so
nothing in `docs/review/` says how many tables the current limits hold yet. The
issue's second "done when" is open until someone runs the ramp and the soak below
and fills in `load-TEMPLATE.md`.

## What it does

N simulated tables, each a host and 2 to 4 phones, play a chapter's start through
the real HTTP API and nothing else:

1. The host opens a room (`POST /api/room`). The others join (`POST /api/room/:code/join`).
2. Everyone makes a hero at once, readies up, and the host starts the campaign
   (`POST /api/action`: `CREATE_CHARACTER`, `READY`, `CONTINUE_CAMPAIGN`).
3. The table plays toward the chapter's fight: story choices, the first check, and
   the fight turn by turn. A phone that loses a race for the run's seq (`STALE_SEQ`)
   reads the state again and taps again, as the client does.
4. **Every seated phone sends `POST /api/presence` every 20 seconds**, out of step
   with the others (#258), from the moment it joins until the room closes.
5. The host closes the room (`POST /api/room/:code/close`). A table that finishes
   opens a new room, until the stage's time is up.

It reports requests per second (average and busiest second, counted by when each
request was *sent*, so it can be set against API Gateway's limit on arrivals), p50/p95/p99/max
latency per route, the rate of 429 and `STALE_SEQ`, and errors.

### What it leaves behind

Nothing permanent. Play is anonymous, so there is no sign-in and no claimed
household. Each table is a **guest household** that expires on its own after
seven days (architecture §3.0) and is deleted by the sweeper; its room is closed
by the script, and a room it could not close expires in six hours. The run says
how many rooms it opened and closed, lists any it could not close, and `--strict`
exits 1 if one is left open. Ctrl-C finishes the step and closes every open room.
The households are named `Loadtest …` and the user agent is `kad-load/1`, so they
are easy to find.

### What it does not measure

- **The realtime channel.** Phones get patches from AppSync Events in production,
  which has limits of its own. Here a table shares one "last seq we heard", which
  is what the channel would have delivered, so `STALE_SEQ` counts only real races.
- **`GET /api/state (script read)`.** The script has to read the state to decide
  what to tap; a real table never polls. These are reported under their own route
  name and counted in the totals, so the totals are a little *high*. A phone's own
  recovery after `STALE_SEQ` is `GET /api/state (resync)`. Read the real load
  as the totals minus the `(script read)` row.
- **Browsers and the TV.** No client code runs, so nothing here says anything
  about first paint or frame time.
- **One client address.** Every phone comes from the machine running the script.
  Nothing the server rations per client counts successful joins (only wrong codes),
  but a CDN or WAF rule per IP would see one very busy client. Say so in the results
  if a 403 or 429 shows up that API Gateway's limit does not explain.

## The CI smoke run

`ci.yml` runs the `load` job beside the others: the dev server and four tables for
a minute, `--strict`. It catches the script, or a route it drives, breaking. It says
nothing about capacity. To run it yourself:

```
npm run dev:server &            # http://localhost:8787
npm run load -- --tables 4 --duration 60 --think 400 --strict
```

## The staging run

Before you start:

- **Staging only.** Not production. Staging is one shared environment that every
  pull request deploys over; run it when nobody is mid-review, and say so on the PR.
- Know your base URL: the staging CloudFront URL, the same one a phone opens (it is
  in the sticky "Staging is serving …" comment on a PR, `docs/deploy.md`). Go through
  CloudFront, as phones do, not the API Gateway URL.
- Run it from a machine with a steady connection, not from a laptop on hotel wifi:
  the numbers include the network between you and staging.
- Have the CloudWatch metrics for the `kad-staging` stack open (API Gateway 429 count
  and latency, Lambda throttles and duration, DynamoDB throttled requests) so the
  script's view can be set against the server's.

### 1. The ramp: 10, 50, 100 tables

```
npm run load -- \
  --base-url https://<staging-domain> \
  --ramp 10,50,100 --duration 300 --cooldown 60 --spread 30 \
  --phones 3 --strict \
  --out docs/review/load-$(date +%F)-ramp.md
```

Each stage runs five minutes with the tables starting spread over thirty seconds,
and a minute's rest between stages, so a stage's numbers are its own. The think time
(1.5 s a tap) and the heartbeat (20 s) are a real table's.

The ramp stops by itself at the first stage that is past a limit: errors above 1% of
requests, 429 on more than 1%, or a p95 over two seconds on `POST /api/action`
(`--max-error-rate`, `--max-429-rate`, `--max-p95` change them). The output names the
stage and which limit it passed, and says the limit lies between that stage and the one
before. Run the stage below it again to make sure, and call that the limit.
`--keep-going` runs every stage regardless. Ctrl-C also stops, and closes every room.

The expected order of things going wrong:

| Load | What to expect, before measuring |
|---|---|
| 10 tables, 30 phones | Heartbeats alone are 1.5 requests/s. Nothing should hurt. |
| 50 tables, 150 phones | Heartbeats 7.5/s, plus actions and the script's reads. Around 30 to 50 requests/s in total. This is where API Gateway's 50/s steady rate gets close. |
| 100 tables, 300 phones | Heartbeats alone are 15/s. The total is likely past 50/s, so expect 429s from the throttle (`infra/template.yaml`, `HttpApi`: rate 50, burst 100). |

That is arithmetic, not a result. Replace it with what you measured.

### 2. The 30-minute soak

At the largest ramp stage that was clean (call it N):

```
npm run load -- \
  --base-url https://<staging-domain> \
  --tables N --duration 1800 --spread 60 \
  --phones 3 --strict \
  --out docs/review/load-$(date +%F)-soak.md
```

Tables go on opening new rooms for the whole half hour, so room creation and close,
heartbeats on rooms of every age, and the household table growing are all in it.
Watch for latency creeping up over the half hour (compare the first and last five
minutes in CloudWatch), for Lambda throttles, and for DynamoDB throttled requests
or a hot partition on `RUN#`/`PRESENCE`.

### 3. Clean up and write it down

1. Check the end of each run says every room was closed. If any were not, they
   expire in six hours; the codes are printed.
2. The guest households expire in seven days. If you would rather not wait on
   staging, find them by the `Loadtest` names; do not delete anything by hand that a
   family could own.
3. Copy `load-TEMPLATE.md` to `docs/review/load-<date>.md`, paste the tables in, and
   fill in the limits and what to change. Commit it on a branch and open a PR that
   references #319. That is what closes the second "done when".

## If a limit is hit

Set the symptom against the fix, then say in the results which one you recommend.

| Symptom | Likely cause | What to raise or change |
|---|---|---|
| 429 from `/api/*` at or just over 50/s | API Gateway's default route throttle | Raise `ThrottlingRateLimit` and `ThrottlingBurstLimit` on `HttpApi` in `infra/template.yaml`, if the account limit allows. Or send fewer requests: the heartbeat interval is the biggest steady source (`client/src/sync/presence-beat.ts`; the server's away window is two minutes, so 30 s would still be safe). |
| High `STALE_SEQ` on `POST /api/action` | A room's actions all share one run's seq | Expected at creation and ready-up, when every phone taps at once. If it stays high mid-chapter, the clients' retry is the thing to look at, not the limit. |
| p95 on `POST /api/action` climbs, Lambda duration up | Cold starts or too little memory | Provisioned concurrency, or more memory for `ApiFunction`. |
| DynamoDB throttled requests | One run's `STATE` and `PRESENCE` items are hot, or the table's capacity mode is too low | Check the table's capacity mode, then look at the write per beat (`touchPresence`). |
| Errors with status 0 | The script's own connection, or CloudFront | Re-run from another machine before drawing a conclusion. |
