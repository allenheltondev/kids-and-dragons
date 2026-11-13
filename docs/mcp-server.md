# MCP server

Kids & Dragons exposes a [Model Context Protocol](https://modelcontextprotocol.io)
server for agents and operators. It hands out upload URLs for the asset
store ([asset-store.md](./asset-store.md)), and tells an operator how long real
families take over chapters, mini-games and fights ([session-timing.md](./session-timing.md)). It is built
the way content-tracking's Booked server is (`functions/mcp/` there): spec
revision **2026-07-28** over Streamable HTTP, served statelessly, with 2025-era
clients (those that open with `initialize`) served through the SDK's stateless
fallback.

- **Endpoint:** `POST https://<site>/api/mcp` (stack output `McpServerUrl`;
  `https://kd.readysetcloud.io/api/mcp` in production). One per stage: a staging
  key does nothing on prod.
- **Auth:** `Authorization: Bearer kadmcp_…`, a key from `npm run mcp:keys`.
- **Code:** `packages/server/src/mcp/`: `handler.ts` (auth, origin, the SDK),
  `server.ts` (assembly and scopes), `tools/*.ts` (one module per area),
  `keys.ts` (minting and checking keys), `uploads.ts` (presigned URLs). The
  Lambda adapter is `packages/server/src/lambda/mcp.ts`.

## Keys

| | |
|---|---|
| Mint | `npm run mcp:keys -- create --stage prod --label "codex cloud" --scope assets:write --agent codex [--tag env=codex-cloud] [--days 90]` |
| List | `npm run mcp:keys -- list --stage prod` (label, scopes, expiry, last use; never the key) |
| Revoke | `npm run mcp:keys -- revoke --stage prod <id>`. The next request with it is refused. |

Run with your AWS credentials, against the stage's `kad-mcp-keys-<stage>` table.
Being able to write that table is what makes someone the operator. Unlike
content-tracking, there is no "mint a key" page: sign-in here is open to any
family, so being signed in proves nothing about being the operator. Nothing
reachable over the internet can mint a key, and a key cannot mint another.

A key's label, agent and tags are stamped on every blob it uploads, signed into the upload URL
and public with the blob ([asset-store.md, "Provenance"](./asset-store.md#provenance)). So
they are plain words, checked at mint: a label of letters, digits, spaces and `. _ : / -`, an
agent of one lower-case word (`codex`), up to eight `key=value` tags. Never a person's name,
an email or anything secret.

A key is `kadmcp_<id>.<secret>`, shown once. The row keeps the SHA-256 of the
secret, the scopes, the expiry (90 days by default, at most 366) and when it was
last used. Expired, revoked, unknown and wrong keys are all refused the same way.

**Differences from content-tracking, on purpose:**

- **No signing key.** Booked's tokens are HMAC-signed so its authorizer can verify
  them without a database read, and then it reads the row anyway to check
  revocation. This server reads the row on every request too, so a signature
  would add a secret to manage and buy nothing.
- **The key is checked in the function, not by an authorizer.** This stack's HTTP
  API authorizer caches its answers for five minutes, which would let a revoked
  key keep working that long.
- **Scopes per area instead of one read/write level.** See below.

## Scopes

A key is granted per area: `assets:read`, `assets:write`, `operator:read`,
`operator:write`. With `<area>:write` a key gets every tool in that area. With
`<area>:read` it gets only the tools annotated `readOnlyHint`, and that annotation
is the single source of truth, as in content-tracking. A tool a key may not use
is never registered: it is absent from `tools/list`, and calling it is an
unknown-tool error. So an agent's upload key never sees operator tools, and an
operator's read key cannot upload.

## Tools

| Tool | Area | What it does |
|---|---|---|
| `whoami` | every key | The key's label, agent, tags, scopes and expiry. |
| `request_uploads` | `assets:write` | For up to 200 files (`path`, `sha256`, `bytes`), and optionally the art `issue` they are for: `stored` (already there), `upload` (a presigned PUT URL and the headers to send with it, valid 15 minutes), or `refused` with the reason. Each new blob is stamped with the key, the path and the issue. |
| `check_uploads` | `assets:read` | Whether the store holds each file's bytes. For checking before committing a lock. |
| `timing_overview` | `operator:read` | Each chapter's observed minutes per revision against the 30-minute budget and beside its planned and predicted minutes, split into story, mini-games and fights, with the sample size; every kind of mini-game, all fights and every kind of screen rolled up; current texts nobody has played yet. |
| `timing_findings` | `operator:read` | What is worth acting on, most pressing first, each with its evidence, sample and first thing to try ([session-timing.md, "Findings"](./session-timing.md#findings)). |
| `timing_chapter` | `operator:read` | One chapter in depth: each revision, its slowest scenes and where tables stalled, minutes by party size, its mini-games and fights (and those not yet played), where unfinished tables left, notes, findings. |
| `timing_activities` | `operator:read` | Mini-games and fights across chapters, per scene and rolled up; filter by chapter or kind of game. |
| `timing_trends` | `operator:read` | Sittings by week or day: begun, finished, completion rate, minutes, games, fights, stalls, party sizes. Before and after a release. |
| `timing_compare` | `operator:read` | One revision of a chapter against another: did the edit move its minutes, completion, scenes, games and fights. |
| `timing_campaign` | `operator:read` | A campaign's chapters in order: attempts, completion, setbacks, where tables left, observed against planned and predicted, and a rough reach by counts. |
| `timing_sittings` | `operator:read` | The evenings behind the figures, newest first, or the excluded ones. |
| `timing_exclude` | `operator:write` | Leave a sitting (and the attempt it belongs to) out of every figure, with a reason. |
| `timing_include` | `operator:write` | Undo an exclusion. |

Agents rarely call these by hand. `npm run assets:push` with
`KAD_ASSET_WRITER=mcp` calls `request_uploads` itself and uploads the bytes
([asset-store.md](./asset-store.md#credentials)).

### Why upload URLs and not uploads

A tool's arguments and results go into the model's context. A painting as
base64 is millions of characters, so the server never carries one. It signs a
URL, and the bytes go straight to S3. Each URL signs headers the uploader must
send unchanged:

| Header | What it enforces |
|---|---|
| `If-None-Match: *` | S3 refuses the write if the blob exists (412, which the CLI treats as done). The store's bucket policy refuses any blob write without it. |
| `x-amz-checksum-sha256` | S3 hashes what arrives and refuses a mismatch. A URL for one hash can never store other bytes. |
| `Content-Length` | The size asked for, capped at 100 MB. |
| `x-amz-meta-kad-*` | The provenance stamp: the key's label, agent and tags, the path, the issue, the time. |
| `Content-Type`, `Cache-Control` | What the store's CDN serves the blob with. SVG is refused (it can carry script, and the CDN serves any origin); SVGs stay in git. |

So an `assets:write` key lets its holder add correct blobs and nothing else. It
cannot overwrite, delete, read household data, or file bytes under a hash they
do not match.

### Operator tools

They register in `server.ts` under the `operator` area. One rule decides what
they may return: **whatever a tool returns goes into a model's context.** Tools
about the system itself need no review: deploy and stack state, alarms, the
asset store, which chapters run long in aggregate. Tools that return a
household's rows, names, characters or anything a child typed are a new flow of
family data to a model vendor. Those need the review in #525 (see
`tools/privacy/egress-guard.test.mjs`) before they merge.

### Timing

`tools/timing.ts`. The session-timing table holds a random run id, a chapter, a
seq, a server time and a timing note per mark: no household, player, name or
anything a child typed ([session-timing.md](./session-timing.md)). So the timing
tools are about the system in aggregate. The one free text they return is the
note an operator typed through the host controls, which that doc asks to keep
free of names.

A typical session with an `operator:read` key:

1. `timing_overview` and `timing_trends`: which chapters run long or short,
   how much of each is story, mini-games and fights, which kinds of screen are
   slow or stall, and whether that is moving week by week. `timing_campaign`
   for where in a campaign tables stop coming back.
2. `timing_findings`: the ranked reading list. `act` is a sample of 8 or more;
   `look` is preliminary.
3. `timing_chapter` or `timing_activities` for the scene behind a finding, then
   `npm run play:jump -- <chapter> <scene>` in the repo to see it, and an edit
   to the chapter's JSON (or to the screen, for a finding every chapter shares).
4. After the edit ships, the chapter has a new revision, and every tool reads
   it apart from the old text. `timing_compare` says whether it moved;
   `since` (ISO time) narrows any read tool to sittings begun after a deploy.

**The chapter index.** The function carries no content. The build writes it
`chapter-index.json` (`infra/chapter-index.mjs`): every chapter's current
revision, hashed by the server's own loader exactly as sittings are stamped,
its campaign and place in it, its planned minutes, `content:pacing`'s
uncalibrated prediction, and its games and fights. With it, `latest` is the
current text whenever that has been played, and `current_text` says so outright;
without it (an old build), `latest` is the most recently played revision and
`timing_campaign` is refused.

With `operator:write`, `timing_exclude` takes a sitting that was not a family's
evening out of every figure (and the export's), and `timing_include` puts it
back. Each is logged with the key's label.

Every read scans the timing table (or queries one chapter's partition when
given `chapter`), so the function's timeout is 29 seconds, just under the HTTP
API's.

Mint an operator key the usual way:

```bash
npm run mcp:keys -- create --stage prod --label "ops timing" --scope operator:read
```

## What it can reach

The function's role reads and touches the keys table, signs uploads under the
asset store's `sha256/` prefix, and reads the session-timing table (`Query`,
`Scan`). It may write to the timing table only rows whose key starts `OPS#`
(`dynamodb:LeadingKeys`), which is where exclusions live, so it can never write,
change or delete a mark. It cannot read the game's table, any SSM parameter,
AppSync or Cognito. `tools/mcp/template.test.ts` fails if its block in
`infra/template.yaml` starts naming any of them, or widens its timing access.

## Connecting

**`assets:push` from a cloud session.** On the environment's settings, add the
key as a network secret for the site's host (`kd.readysetcloud.io`, header
`Authorization`, `Bearer <key>`), and set the environment variables
`KAD_ASSET_WRITER=mcp` and `NODE_USE_ENV_PROXY=1`. The key never enters the
session; the sandbox's proxy adds it to requests for that host.

**Claude Code on a laptop**, as an MCP server the model can call:

```bash
claude mcp add --transport http kids-and-dragons https://kd.readysetcloud.io/api/mcp \
  --header "Authorization: Bearer $KAD_MCP_TOKEN"
```

**A quick check from a shell:**

```bash
curl -sS -X POST "$KAD_MCP_URL" \
  -H "Authorization: Bearer $KAD_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/call" -H "Mcp-Name: whoami" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami","arguments":{},"_meta":{
        "io.modelcontextprotocol/protocolVersion":"2026-07-28",
        "io.modelcontextprotocol/clientCapabilities":{}}}}'
```

Requests with an `Origin` header are refused with 403 unless its hostname is in
`MCP_ALLOWED_ORIGIN_HOSTS` (empty by default). Agents call from servers and
send no `Origin`.

## Why a plain Lambda

The same reasoning as Booked's. The 2026-07-28 revision is stateless, and every
tool here answers with one JSON body, so the endpoint is an ordinary
request/response Lambda. `@modelcontextprotocol/server` handles the protocol
through `createMcpHandler(...).fetch(Request)`, including `server/discover`,
header validation and 405 for `GET`/`DELETE`. The route is `ANY /api/mcp` on
the existing HTTP API, an explicit route that wins over the API function's
`/{proxy+}`, and CloudFront's `/api/*` behavior already forwards
`Authorization`. Revisit a streaming setup only if a tool ever needs to stream
progress.
