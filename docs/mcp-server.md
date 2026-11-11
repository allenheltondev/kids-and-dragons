# MCP server

Kids & Dragons exposes a [Model Context Protocol](https://modelcontextprotocol.io)
server for agents and operators. Today it hands out upload URLs for the asset
store ([asset-store.md](./asset-store.md)); operator tools come next. It is built
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
| Mint | `npm run mcp:keys -- create --stage prod --label cloud-agent --scope assets:write [--days 90]` |
| List | `npm run mcp:keys -- list --stage prod` (label, scopes, expiry, last use; never the key) |
| Revoke | `npm run mcp:keys -- revoke --stage prod <id>`. The next request with it is refused. |

Run with your AWS credentials, against the stage's `kad-mcp-keys-<stage>` table.
Being able to write that table is what makes someone the operator. Unlike
content-tracking, there is no "mint a key" page: sign-in here is open to any
family, so being signed in proves nothing about being the operator. Nothing
reachable over the internet can mint a key, and a key cannot mint another.

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
| `whoami` | every key | The key's label, scopes and expiry. |
| `request_uploads` | `assets:write` | For up to 200 files (`path`, `sha256`, `bytes`): `stored` (already there), `upload` (a presigned PUT URL and the headers to send with it, valid 15 minutes), or `refused` with the reason. |
| `check_uploads` | `assets:read` | Whether the store holds each file's bytes. For checking before committing a lock. |

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
| `Content-Type`, `Cache-Control` | What the store's CDN serves the blob with. SVG is refused (it can carry script, and the CDN serves any origin); SVGs stay in git. |

So an `assets:write` key lets its holder add correct blobs and nothing else. It
cannot overwrite, delete, read household data, or file bytes under a hash they
do not match.

### Operator tools (next)

They register in `server.ts` under the `operator` area. One rule decides what
they may return: **whatever a tool returns goes into a model's context.** Tools
about the system itself need no review: deploy and stack state, alarms, the
asset store, which chapters run long in aggregate. Tools that return a
household's rows, names, characters or anything a child typed are a new flow of
family data to a model vendor. Those need the review in #525 (see
`tools/privacy/egress-guard.test.mjs`) before they merge.

## What it can reach

The function's role reads and touches the keys table, and signs uploads under
the asset store's `sha256/` prefix. It cannot read the game's table, the timing
table, any SSM parameter, AppSync or Cognito. `tools/mcp/template.test.ts` fails
if its block in `infra/template.yaml` starts naming any of them.

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
