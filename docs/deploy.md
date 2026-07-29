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

Three steps, once. Until they are done the workflow runs and fails at the
credentials step, which is the correct failure — it cannot deploy to an account
that has not agreed to let it.

**1. Deploy the bootstrap stack by hand.** It grants the permission, so it
cannot be granted by the thing it grants:

```bash
aws cloudformation deploy \
  --template-file infra/github-oidc.yaml \
  --stack-name kad-github-oidc \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides GitHubOwner=<you> GitHubRepo=kids-and-dragons
```

If `token.actions.githubusercontent.com` already exists in the account — an
account may hold only one — add `CreateOidcProvider=false`.

**2. Create two GitHub environments**, named **`Staging`** and **`Production`**,
and set `AWS_DEPLOYMENT_ROLE_ARN` on each — `StagingRoleArn` on Staging,
`ProdRoleArn` on Production.

Those names are load-bearing in two places, and both fail confusingly if they
drift. `deploy.yml` matches on them exactly (a mismatch makes GitHub create a
*different* environment, with no secret in it), and the OIDC `sub` claim carries
the name as configured, matched with `StringEquals` in the trust policy — so
`Staging` and `staging` are different principals. If you rename an environment,
redeploy the bootstrap stack with the new
`StagingEnvironmentName` / `ProdEnvironmentName`.

**The two ARNs are not interchangeable.** Each role trusts exactly one
environment, so the same ARN in both leaves one of them failing with
*"Not authorized to perform sts:AssumeRoleWithWebIdentity"*. That message means
the trust boundary is working, not that it is misconfigured.

Worth adding on Production: a required reviewer. That turns "merged to main" into
"merged to main, and somebody pressed go", which is the version of this you want
on a Tuesday evening.

**3. Once the distribution exists**, set a repository variable
`WEBAUTHN_RP_ID` to its domain to enable passkeys — see below.

### When the deploy fails at the credentials step

Two different errors, two different causes, and they are easy to confuse
because both look like "AWS is broken" and neither is.

| Error | Means |
|---|---|
| `Could not load credentials from any providers` | The secret resolved to **empty** — `deploy.yml`'s `environment:` does not match a real environment, so GitHub used a fresh empty one. Check the spelling and the case. |
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` | The secret is fine and AWS **refused the token**. The role's trust policy names a different environment than the one the job ran in — usually a case difference, or the two ARNs swapped between environments. Redeploy the bootstrap stack, and check each environment holds *its own* role. |

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
| **KMS** ECC_NIST_P256 | Signs device, session, and viewer tokens. `Retain`. |
| **Cognito** user pool | Optional sign-in. Essentials tier (passwordless needs it). `Retain`. |
| **AppSync Events** | `room/<code>`. IAM publishes; the authorizer admits subscribers. |
| **HTTP API** + 3 Lambdas | `api`, `channel-authorizer`, `sweep`. |
| **S3 + CloudFront** | SPA, art, content. OAC — the bucket is not public. |

The three stateful resources are `Retain` on purpose: a family's characters are
not recreatable, and `sam delete` on the wrong stack should not be able to take
them. The flip side is that tearing a stack down properly means deleting the
table, key, and user pool by hand afterwards — **including on staging**, which
is now created and destroyed far more often than prod.

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
