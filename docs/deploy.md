# Deploying

One template ([`infra/template.yaml`](../infra/template.yaml)), one region, two
stacks. Companion to [architecture.md §2](./architecture.md#2-aws-topology) and
[§7](./architecture.md#7-environments).

```bash
./scripts/deploy.sh          # prod
./scripts/deploy.sh dev      # the dev stack
```

That is the whole thing. It runs the checks, bundles the Lambdas, deploys the
stack, uploads the client and the art, and invalidates CloudFront — in that
order, so a deploy that fails partway leaves the previous version serving rather
than a new bundle talking to an API that does not exist yet.

---

## What you need once

- **An AWS account** and credentials with permission to create the stack.
- **AWS SAM CLI** and the **AWS CLI**. `sam --version`, `aws sts get-caller-identity`.
- Nothing else. There is no `cdk bootstrap` step, and `sam deploy --resolve-s3`
  manages the artifact bucket, so there is no bucket to create by hand either.

`sam build` is deliberately **not** in the deploy path. The server is a
TypeScript workspace package that imports another one by name and its own modules
with explicit `.ts` extensions; SAM's built-in esbuild support handles neither
reliably from a monorepo root. [`infra/build.mjs`](../infra/build.mjs) does it in
about sixty lines and is also the only place that can put `content/` inside the
API bundle, which is load-bearing — see below.

---

## The stack

| Resource | Notes |
|---|---|
| **DynamoDB** `kad-<stage>` | Single table, GSI1, TTL on `ttl`, PITR on. `DeletionPolicy: Retain`. |
| **KMS** ECC_NIST_P256 | Signs device, session, and viewer tokens. `Retain`. |
| **Cognito** user pool | Optional sign-in. Essentials tier (passwordless needs it). `Retain`. |
| **AppSync Events** | `room/<code>`. IAM publishes; the authorizer admits subscribers. |
| **HTTP API** + 3 Lambdas | `api`, `channel-authorizer`, `sweep`. |
| **S3 + CloudFront** | SPA, art, content. OAC — the bucket is not public. |

The three stateful resources are `Retain` on purpose: a family's characters are
not recreatable, and `sam delete` on the wrong stack should not be able to take
them. The flip side is that tearing a stack down properly means deleting the
table, key, and user pool by hand afterwards.

### Cost

Everything here is within, or a rounding error above, the always-free tier at
three-players-on-a-Tuesday scale. The one line item worth knowing about is
Cognito **Essentials**, which passwordless sign-in requires; its free tier is
10,000 monthly active users. CloudFront is `PriceClass_100`.

---

## First deploy: passkeys are off, and that is expected

A passkey is bound to a **domain** for the life of the credential, and the domain
is the CloudFront one — which does not exist until the first deploy has created
the distribution. The user pool cannot default to it either: the pool would then
depend on CloudFront, which depends on the API, which depends on the pool, and
CloudFormation refuses the cycle.

So the first deploy comes up with **email-OTP sign-in only**, which works
completely. `deploy.sh` notices and prints the follow-up:

```bash
sam deploy --config-env prod \
  --parameter-overrides "WebAuthnRelyingPartyId=d111111abcdef8.cloudfront.net"
```

After that, sign-in offers "remember this device" and subsequent sign-ins are one
tap. Put a custom domain in front before you do this if you ever intend to have
one — moving the relying-party ID invalidates every passkey registered against
the old one.

### Verify on the first deploy

Cognito's passwordless sign-up flow is the one part of this stack that has not
been exercised end to end here. Check that `SignUp` for a new email is accepted
**without** a `Password` parameter against the deployed pool before wiring the
sign-in screen to it; if the pool insists on one, the fix is a `PreSignUp` Lambda
trigger auto-confirming the user, not a password field in the UI.

---

## Content ships inside the Lambda

`infra/build.mjs` copies `content/` into the API bundle, and `KAD_CONTENT_DIR`
points the loader at it. Chapters are already validated in CI, and a chapter the
server cannot read is a session that cannot start — putting that behind an S3
fetch would trade a build-time guarantee for a runtime failure at the table, for
nothing. The same files are *also* synced to S3, because the client fetches
narration and art references from `/content/*` directly.

A new chapter therefore needs a full `deploy.sh`, not just an `s3 sync`.

---

## Local development

Unchanged, and still the way nearly all development happens
([§7](./architecture.md#7-environments)):

```bash
npm run dev            # dev server on :8787, Vite on :5173
```

`MemoryRepository`, `LocalSseChannel`, and `DevIdentity` stand in for DynamoDB,
AppSync, and KMS. The dev identity is **unsigned** — a base64 envelope, not a
credential — and is never deployed.

To run the repository contract suite against a real DynamoDB rather than only the
in-memory store:

```bash
npm run ddb:local      # docker run amazon/dynamodb-local, port 8000
npm run test:ddb
```

CI does this on every push, so `DynamoRepository` is never merged unverified.
Without `KAD_DDB_ENDPOINT` those cases skip, which is what keeps `npm test` a
two-second command on a laptop.

---

## Operating it

**Where the logs are.** `/aws/lambda/kad-*`, JSON-formatted, 30-day retention.
The sweeper logs a one-line summary per run: scanned, deleted, failed.

**A room is stuck.** Rooms expire on their own after six hours. `getRoom` filters
expired rooms at read time rather than waiting for the TTL sweep, so a stale code
reads as gone immediately even though the row may live for up to 48 hours more.

**A phone was lost.** Revoke its `DEVICE#<deviceId>` item. That kills the token
on the next request — verification is local, but every resolve still reads the
binding precisely so revocation is immediate. Characters are untouched; they
belong to the household.

**Somebody wants their anonymous characters back after seven days.** They are
gone, and that is the design. PITR is on, so a restore to a point before the
sweep is technically possible — but it restores the *whole table*, which is
almost never the right trade.

**Rolling back.** `sam deploy` produces a changeset per deploy; CloudFormation
rolls back a failed one on its own. A bad *client* bundle is faster to fix by
redeploying than by reverting S3, since `index.html` is served `no-cache` and the
hashed bundle under `/bundle/*` is immutable.
