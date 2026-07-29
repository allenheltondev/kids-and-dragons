# Deploying

One template ([`infra/template.yaml`](../infra/template.yaml)), one region.
Companion to [architecture.md §2](./architecture.md#2-aws-topology) and
[§7](./architecture.md#7-environments).

**Normally you do not deploy by hand at all:**

| When | What happens |
|---|---|
| You open or push to a pull request | the **Staging** environment → the `kad-staging` stack |
| The pull request merges to `main` | the **Production** environment → the `kad-prod` stack |
| You need a redeploy without a commit | Actions → Deploy → Run workflow |

Two naming schemes meet here and are deliberately kept apart: the **GitHub
environment** (`Staging` / `Production`) is where the role ARN and any
protection rules live, and the **AWS stage** (`staging` / `prod`) names the
stack, the table, and `StageName` in the template. The workflow maps one to the
other in a single step.

Both run `scripts/deploy.sh`, which is also what you run from a laptop:

```bash
./scripts/deploy.sh              # prod
./scripts/deploy.sh staging      # staging
./scripts/deploy.sh dev          # a fourth stack, for driving by hand
```

It runs the checks, bundles the Lambdas, deploys the stack, uploads the client
and the art, and invalidates CloudFront — in that order, so a deploy that fails
partway leaves the previous version serving rather than a new bundle talking to
an API that does not exist yet.

The checks run **again** in the deploy workflow even though `ci.yml` ran them on
the same commit. The two workflows run in parallel and neither can gate the
other, so skipping would mean a push to `main` deploying to prod while its tests
are still going — and a red test arriving after the family is already playing
the build it failed on. Two minutes buys "nothing reaches a stack that did not
pass on that exact commit". (`KAD_SKIP_CHECKS=1` exists for re-running a deploy
by hand after a green run; it is not used by CI.)

---

## Turning the automated deploys on

The deploy workflows mirror `allenheltondev/content-tracking`: one workflow per
environment, the role ARN on a GitHub environment, OIDC for credentials, secret
named **`AWS_DEPLOYMENT_ROLE_ARN`**.

**1. Point a deploy role at this repository.** There are two ways, and if you
already deploy other repos from Actions the first is almost certainly right.

*Reuse the role you already have.* That is what `content-tracking` does — its
role lives in the account, not in the repo, and the repo only knows the ARN. An
OIDC role trusts specific `sub` claims, so it will refuse a repository it has
never heard of, however valid the token. Add these two to the existing role's
trust policy:

```
repo:allenheltondev/kids-and-dragons:environment:Staging
repo:allenheltondev/kids-and-dragons:environment:Production
```

If the policy uses `StringLike`, a single `repo:allenheltondev/kids-and-dragons:*`
covers both — at the cost of letting a pull-request deploy assume the same role
a production deploy uses.

*Or create dedicated roles.* [`infra/github-oidc.yaml`](../infra/github-oidc.yaml)
makes one role per environment, each trusting only its own:

```bash
aws cloudformation deploy \
  --template-file infra/github-oidc.yaml \
  --stack-name kad-github-oidc \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides GitHubOwner=<you> GitHubRepo=kids-and-dragons
```

Add `CreateOidcProvider=false` if `token.actions.githubusercontent.com` already
exists in the account — and an account may hold only one, so if you deploy
anything else from Actions, it does. Its two outputs are not interchangeable:
`StagingRoleArn` belongs to Staging and `ProdRoleArn` to Production.

**2. Set `AWS_DEPLOYMENT_ROLE_ARN`** on the `Staging` and `Production` environments.

Those names are load-bearing twice over, and both fail confusingly when they
drift. The workflows match on them exactly — a mismatch makes GitHub create a
*different* environment with no secret in it — and the OIDC `sub` claim carries
the name as configured, matched with `StringEquals`, so `Staging` and `staging`
are different principals.

Worth adding on Production: a required reviewer. That turns "merged to main"
into "merged to main, and somebody pressed go", which is the version of this you
want on a Tuesday evening.

**3. Once the distribution exists**, set a repository variable `WEBAUTHN_RP_ID`
to its domain to enable passkeys — see below.

### When the deploy fails at the credentials step

Two different errors, two different causes, and they are easy to confuse because
both look like "AWS is broken" and neither is.

| Error | Means |
|---|---|
| `Could not load credentials from any providers` | The secret resolved to **empty** — either the environment name does not match, or the secret is under a different name. Check both. |
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` | The secret is fine and AWS **refused the token**. The role's trust policy does not list this repository and environment — the usual cause is an ARN borrowed from another repo's role. |

Both were hit while building this, in that order. The second one is the trust
boundary doing its job; it is supposed to be unforgiving.

---

## What you need once, to deploy by hand

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
| **SSM SecureString** `/kad/<stage>/token-signing-key` | Signs device, session, and viewer tokens. Not a stack resource — see below. |
| **Cognito** user pool | Optional sign-in. Essentials tier (passwordless needs it). `Retain`. |
| **AppSync Events** | `room/<code>`. IAM publishes; the authorizer admits subscribers. |
| **HTTP API** + 4 Lambdas | `api`, `channel-authorizer`, `sweep`, and the inline Cognito `PreSignUp` trigger. |
| **S3 + CloudFront** | SPA, art, content. OAC — the bucket is not public. |

The table and the user pool are `Retain` on purpose: a family's characters are
not recreatable, and `sam delete` on the wrong stack should not be able to take
them. The signing key is not a stack resource at all, so it survives for a
different reason — nothing in the stack owns it.

The flip side of both is that tearing a stack down properly means three things by
hand afterwards — **including on staging**, which is now created and destroyed
far more often than prod:

```bash
aws dynamodb delete-table --table-name kad-staging
aws cognito-idp delete-user-pool --user-pool-id <from the stack outputs>
aws ssm delete-parameter --name /kad/staging/token-signing-key
```

Leaving the parameter behind is harmless and usually what you want: redeploy the
same stage and every paired phone still works. Delete it and they re-pair by QR,
which takes about ten seconds and costs nothing else.

### No KMS keys, on purpose

Nothing in this stack creates a KMS key. Everything encrypted uses an
Amazon-managed one — DynamoDB's AWS-owned default, SSE-S3 on the bucket, and
`aws/ssm` for the token signing key — all free, and none of them needing a key
policy of ours.

The Lambdas do carry a `kms:Decrypt` grant for the SecureString, scoped by
`kms:ViaService` to Parameter Store rather than by key ARN, because an
AWS-managed key's id is not knowable at template time. It is arguably redundant
— the managed key's own policy already admits account principals arriving
through SSM — but the failure it guards against is an `AccessDenied` on the first
token of a fresh stack, which names neither the key nor the parameter.

The one thing this rules out is asymmetric signing. Every `aws/*` managed key is
symmetric and encryption-only, so tokens are HS256 over a shared key rather
than ES256 over a private key that never leaves KMS. Architecture §4.5 has what
that trades away; the short version is that both the signer and the verifier are
Lambdas in this same stack, so a public half had nobody to serve.

### Where the signing key comes from

Not from CloudFormation, which cannot make one: `AWS::SSM::Parameter` supports
`String` and `StringList` and has never supported `SecureString`. The two usual
workarounds are a step in `deploy.sh` — which puts stack state outside the
template and quietly breaks the by-hand `sam deploy` path documented above — and
a custom resource, which is a fourth Lambda, a role, and a response protocol that
hangs the stack for an hour when you get it wrong.

So the API function mints it instead: 32 random bytes on the first token it ever
signs, written with `Overwrite: false` so that three phones opening a fresh stack
at once converge on one key rather than one key per container. The template still
owns the parameter's name and who may read it, which is the part worth reviewing.
The channel authorizer gets `ssm:GetParameter` and no `PutParameter` — it only
ever verifies tokens the API already issued, so it cannot legitimately be first,
and failing there is the correct answer.

If a *stack that was already deployed* is being upgraded past this change, every
device token issued by the old KMS key stops verifying — phones re-pair by
scanning the room QR, and nothing else is affected. Characters, households, and
sign-ins all live in the table and the pool.

### Cost

Everything here is within, or a rounding error above, the always-free tier at
three-players-on-a-Tuesday scale. The one line item worth knowing about is
Cognito **Essentials**, which passwordless sign-in requires; its free tier is
10,000 monthly active users. CloudFront is `PriceClass_100`.

Staging roughly doubles that, which is to say it is still approximately nothing
— but it is a second CloudFront distribution, and a distribution takes several
minutes to create the first time. The first pull-request deploy is slow; the
rest are not.

---

## First deploy: passkeys are off, and that is expected

A passkey is bound to a **domain** for the life of the credential, and the domain
is the CloudFront one — which does not exist until the first deploy has created
the distribution. The user pool cannot default to it either: the pool would then
depend on CloudFront, which depends on the API, which depends on the pool, and
CloudFormation refuses the cycle.

So the first deploy comes up with **email-OTP sign-in only**, which works
completely. `deploy.sh` notices and prints the follow-up. Set it as a repository
variable rather than passing it once:

```
Settings → Secrets and variables → Actions → Variables
WEBAUTHN_RP_ID = d111111abcdef8.cloudfront.net
```

After that, sign-in offers "remember this device" and subsequent sign-ins are one
tap. Put a custom domain in front before you do this if you ever intend to have
one — moving the relying-party ID invalidates every passkey registered against
the old one.

### Why it is a variable and not a one-off flag

`sam deploy` does **not** carry previous parameter values forward: anything left
out of `--parameter-overrides` reverts to the template default. Set the
relying-party ID once by hand and the next automated deploy would quietly revert
it to empty, `AllowedFirstAuthFactors` would drop `WEB_AUTHN`, and every
registered passkey would stop being offered — with nothing in the diff, the logs,
or CloudFormation's output to say so.

`deploy.sh` therefore passes every parameter on every deploy, and reads this one
from `WEBAUTHN_RP_ID`. Empty is a fine and complete state; it means email codes
only.

### There is a password in the pool, and nobody will ever see it

Two things Cognito insists on for a pool that is meant to be passwordless, both
found the first time this stack was deployed for real:

**`PASSWORD` must be an allowed first auth factor.** Leave it out and the pool
will not create at all — *"PASSWORD should be configured as one of the allowed
first auth factors"*. It is listed alongside `EMAIL_OTP`, and nothing uses it:
the client generates 32 random bytes for `SignUp`, sends them once, and drops
them. No screen has a password field, and sign-in is the emailed code.

**Sign-up needs auto-confirming.** Otherwise a new user sits `UNCONFIRMED`
behind a second emailed code, and the first sign-in of every new family fails.
A `PreSignUp` trigger (ten lines, inline in the template) confirms them. That is
not a shortcut past verifying the address — the OTP *is* the verification, since
nobody reaches a signed-in state without reading a message sent to that inbox.

The consequence worth knowing: password auth is technically enabled on the pool.
Using it would require guessing a discarded 32-byte secret, so it is not a way
in — but it is why `AllowedFirstAuthFactors` reads the way it does.

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
AppSync, and the signed tokens. The dev identity is **unsigned** — a base64
envelope, not a credential — and is never deployed.

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
The sweeper logs a one-line summary per run: scanned, deleted, spared, failed.
`spared` counts households somebody claimed between the index query and the
delete — not an error, a save.

**A client connects but never updates.** That is the realtime path, not the API:
the snapshot arrives over HTTP and the patches do not. Check the
`kad-channel-authorizer` logs — a deny there means the token names a different
room, the room has expired, or the device was revoked. `sync/appsync-socket.ts`
logs `closed before subscribing` on the browser side for the same case.

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
