# Load and soak: results, <date>

Copy this to `docs/review/load-<date>.md`. Procedure: `docs/review/load-README.md`.

## Setup

| | |
|---|---|
| Date and time (UTC) | |
| Run by | |
| Commit deployed on staging | |
| Base URL | |
| Script commit (`tools/load/`) | |
| Run from (machine, network) | |
| Live narration layer on staging | off / on |
| API Gateway throttle at the time | rate 50, burst 100 (`infra/template.yaml`) |
| Options | `--phones 3 --think 1500 --heartbeat 20000` unless noted |

## Ramp

One block per stage: paste the stage's section from the script's output.

### 10 tables

```
(paste)
```

### 50 tables

```
(paste)
```

### 100 tables

```
(paste)
```

| Tables | Phones | Avg req/s | Busiest second | 429 | STALE_SEQ | Errors | `POST /api/action` p95 ms | Clean? |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 10 | | | | | | | | |
| 50 | | | | | | | | |
| 100 | | | | | | | | |

## Soak

`--tables <N> --duration 1800`

```
(paste)
```

First five minutes against the last five (from the dashboard): p95 latency, Lambda
duration, DynamoDB consumed capacity. Did anything creep?

## What the server saw

Peak API Gateway request rate and 429 count, Lambda throttles and p95 duration,
DynamoDB throttled requests, anything in the logs. Does it agree with the script?

## Cleanup

Rooms opened / closed / left open. Guest households created (they expire in seven
days).

## How many simultaneous tables the current limits support

**<N> tables (<3N> phones)**, because <the first limit that was hit and the stage it
showed at>.

## What to raise or change

1. <change, where, and what it should buy>
