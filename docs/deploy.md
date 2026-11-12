# Deploying

One template ([`infra/template.yaml`](../infra/template.yaml)), one region.
Companion to [architecture.md §2](./architecture.md#2-aws-topology) and
[§7](./architecture.md#7-environments).

**Normally you do not deploy by hand at all:**

| When | What happens |
|---|---|
| You open or push to a pull request | the **Staging** environment → the `kad-staging` stack |
| CI completes green on `main` | the **Production** environment → the `kad-prod` stack |
| You need a redeploy without a commit | Actions → **Deploy (staging)** or **Deploy (production)** → Run workflow |
| You need to roll production back | **Deploy (production)** → Run workflow, with the `ref` input set to the known-good commit |

Two naming schemes meet here and are deliberately kept apart: the **GitHub
environment** (`Staging` / `Production`) is where the role ARN and any
protection rules live, and the **AWS stage** (`staging` / `prod`) names the
stack, the table, and `StageName` in the template. The workflow maps one to the
other in a single step.

Both run `scripts/deploy.sh`, which is also what you run from a laptop:

```bash
./scripts/deploy.sh prod         # prod
./scripts/deploy.sh staging      # staging
./scripts/deploy.sh dev          # a fourth stack, for driving by hand
```

The environment is always named: with no argument the script prints its usage
and stops. (It used to mean prod.) `npm run infra:deploy -- staging` is the same
thing through npm.

**Prod from a laptop is checked against main first.** Production normally
deploys itself, so a by-hand prod deploy is refused unless the working tree is
clean and `HEAD` is the tip of `origin`'s `main`, and `sam` then stops to show
the changeset before applying it. For the evening CI itself is what is broken,
or a rollback by hand to an older commit, `KAD_DEPLOY_ANYWAY=1` ships the
checkout regardless and prints what was wrong with it. The workflows are not
subject to any of this; `prod-deploy.yml` has its own guard.

It first pulls the game's art from the asset store and refuses to go on unless
`assets/` holds exactly what `assets.lock.json` names ([asset-store.md](./asset-store.md)),
since the art is synced with `--delete`. Then it runs the checks — typecheck, unit tests, `content:validate`, `art:verify`, `voice:verify`,
and `infra:lint` when `cfn-lint` is installed — then bundles
the Lambdas and builds the client, checks that every recorded voice clip the
manifests in `content/voice/manifest/` play is on the site
(`tools/voice/verify-site.ts`, even when the checks are skipped, since only the
deploy knows which site it is; a clip the site will not answer for stops the
deploy too, except on staging, which warns and goes on so a pull request can
deploy before its clips are in staging's bucket), deploys the stack, uploads the client and the art, invalidates
CloudFront, and prunes old bundle files — in that order. Everything that can
fail without touching AWS has failed before the stack changes, and the upload
comes after it, so a deploy that fails partway leaves the previous version
serving rather than a new API with an old client, or a new bundle talking to an
API that does not exist yet. (A stack's very first deploy has no site to ask
about voice clips until the stack exists, so that one deploy asks afterwards.)
It also exports `AWS_REGION=us-east-1` unless one is already set, so a
laptop with a different profile default still reads the stack that actually
exists.

**Bundle files are added, never swept.** Every file under `bundle/` has its hash
in its name, and the page a phone already has open keeps asking for the
previous build's lazy chunks until it reloads. So a deploy uploads the new
files beside the old ones, and afterwards deletes only files that this build
does not ship *and* that were uploaded more than 14 days ago
(`tools/deploy/stale-bundles.ts`). The prune is the last step and never fails a
deploy. Art and content are still synced whole.

The two automated paths trust CI differently, and the difference is deliberate.
**Staging runs in parallel with CI** on every pull request, so `deploy.sh` runs
the checks itself — a broken chapter fails the deploy, never the table.
**Production waits for CI**: `prod-deploy.yml` triggers on `workflow_run`, only
once the CI workflow for a `main` commit has completed *and passed*, and it
checks out the exact SHA CI tested rather than whatever `main` has moved on to.
A guard job refuses any run whose SHA is no longer the tip of `main` — CI runs
finish in their own order, not commit order, so without it an older commit's
green run could queue up behind a newer one's and put the older bytes live
*last*. When a run is skipped as stale, the newer commit's own CI run owns the
next deploy; if that run is red, prod deliberately stays where it is.
On that path the checks are skipped (`KAD_SKIP_CHECKS=1`), because CI just ran a
strictly larger set — e2e, `cfn-lint`, and the rig contract included — on the
same commit, and re-running the smaller set would buy minutes of nothing. What
production adds instead is a **strict art gate** (`art:verify:strict`, which
fails on *undelivered* art — noise on a PR where sets land over time, a real
regression in prod). Both workflows finish with the **smoke test** below, so a
deploy that succeeded into a site that cannot run a game is caught before the
family finds out. A **manual dispatch** of either workflow has no green CI run
to lean on, so it keeps the checks.

### The smoke test after every deploy

```bash
npm run deploy:smoke -- --site https://kd.readysetcloud.io
```

`tools/deploy/smoke.ts` asks the deployed site for what a phone opening the game
needs, reads nothing private and writes nothing:

- the page, and the script bundle it names;
- `GET /api/health?deep=1`: the API booted, holds chapters, and can read its table;
- `GET /api/config`: what the client needs before it can sign in or subscribe;
- a routed request refused in the API's own error shape, so a handler really ran;
- `/content/rules.json` on the site, at the same version the API loaded (the two
  ship in one deploy by different routes: the Lambda's package and the site bucket);
- `/assets/manifest.json`, the art's index.

It prints a line per check and exits 1 if any fails. It runs after the deploy, so
a failure rolls nothing back; it turns the run red. Run it by hand against either
site at any time.

`GET /api/health` itself (`packages/server/src/handlers/health.ts`) answers 200
only when the API can boot and holds chapters, and 503 with `failed: "boot"`,
`"content"` or `"store"` otherwise. The plain form never touches the table, so it
still answers when the table is what is broken; `?deep=1` adds one read of it.
The body names the part that failed and nothing else, because the endpoint is
public; the detail is in the function's log.

A rollback to a commit from before the smoke test (2026-11-11) gets the single
request of the home page those commits always had.

**Production does not rebuild either — it ships CI's artifact.** After its
build steps, `ci.yml` uploads `infra/.build/` and `packages/client/dist/` as an
artifact named `kad-build-<sha>` (kept 14 days). On the `workflow_run` path,
`prod-deploy.yml` downloads that artifact from the triggering run and calls
`deploy.sh` with `KAD_PREBUILT=1`, which skips both build steps, verifies that
every CodeUri directory and the client dist are present and non-empty *before*
`sam deploy` (a ship with no artifact fails there, never as empty CodeUris),
and syncs what it was given. So "it worked on staging, CI is green" is a claim
about the exact bytes production serves — not about a second `npm ci` +
esbuild resolution of the same commit. **Staging deliberately still builds its
own**: `deploy.yml` runs in parallel with CI on the pull request, so there is
no completed CI run to download from — that asymmetry is the price of staging
feedback that starts at PR-open rather than after a full CI pass. A manual
dispatch of the production workflow has no triggering run and no artifact, so
it falls back to `deploy.sh`'s normal build mode; `KAD_PREBUILT` is only ever
set by the workflow, and never by hand unless you have just put a real build
in both directories.

**Rolling production back** is therefore one click: **Deploy (production)** →
Run workflow, with the `ref` input pointing at the last good commit (empty
means the default branch). The dispatch checks out that ref, runs the full
checks, rebuilds, and ships — and it passes the stale-tip guard
unconditionally, because deploying something other than the tip of `main` is
the point of choosing a ref.

**Staging says what it is serving.** The staging stack is one shared, mutable
environment that every pull request updates in place — two open PRs overwrite
each other, and a reviewer cannot tell whose bytes are live from the stack
itself. So the staging workflow maintains a sticky PR comment — "🎭 Staging is
serving `<head-sha>` — <site-url>" — found again by a hidden marker and edited
in place rather than re-posted, so the answer lives on the PR that asks without
spamming its timeline. On a manual dispatch there is no PR and the step is
skipped.

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

Both roles carry the same **scoped policy** (`kad-deploy`, defined in the same
template) rather than the `PowerUserAccess` + `IAMFullAccess` pair they started
with. Every stack resource is name-prefixed `kad-` / `kad-site-`, and
CloudFormation prefixes every name it generates with the stack name, so the
policy is generous with actions but strict about reach: CloudFormation on
`kad-*` stacks (plus SAM's `aws-sam-cli-managed-default` artifact-bucket
stack), S3 on `kad-site-*` and the SAM bucket, IAM only on `role/kad-*` with an
explicit deny on the deploy roles themselves (so a PR-triggered staging job can
never widen its own permissions), and Lambda/DynamoDB/SSM/Scheduler/logs on
their `kad-*` names. CloudFront, Cognito, and AppSync get `Resource: "*"`
because their ARNs carry generated ids rather than names — there is nothing to
scope on. That matters most for **staging**, which is assumable from
repository-controlled code on every collaborator PR. If a deploy fails after a
policy change, the workflow's diagnose step prints the CloudFormation events;
an over-tight policy reads as `is not authorized to perform` in
`ResourceStatusReason`, naming the exact action and ARN to add.

**2. Set `AWS_DEPLOYMENT_ROLE_ARN`** on the `Staging` and `Production` environments.

Those names are load-bearing twice over, and both fail confusingly when they
drift. The workflows match on them exactly — a mismatch makes GitHub create a
*different* environment with no secret in it — and the OIDC `sub` claim carries
the name as configured, matched with `StringEquals`, so `Staging` and `staging`
are different principals.

**Required on Production: deployment branches set to `main` only**
(Settings → Environments → Production → Deployment branches and tags). A
`pull_request` run executes the workflow file from the PR's own head, so a
collaborator's PR could change `environment: Staging` to `Production` and the
OIDC `sub` would then match the production role's trust policy. The branch
rule is what refuses that job before it gets a token; nothing in the repo
can. A manual dispatch of prod-deploy.yml is separately held to commits
already on main by its guard job.

Worth adding on Production as well: a required reviewer. That turns "merged to
main" into "merged to main, and somebody pressed go", which is the version of
this you want on a Tuesday evening.

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
| **DynamoDB** `kad-<stage>` | Single table, GSI1, TTL on `ttl`. `DeletionPolicy: Retain`. |
| **SSM SecureString** `/kad/<stage>/token-signing-key` | Signs device, session, and viewer tokens. Not a stack resource — see below. |
| **SSM String** `/kad/<stage>/origin-secret` | Proves a request came through CloudFront. Made by `deploy.sh` — see below. |
| **SSM SecureString** `/kad/<stage>/push-vapid-keys` | The VAPID key pair "It's your turn" pushes are signed with (#466). Minted by the API on first use, like the signing key, and only while pushes are on — see below. |
| **Cognito** user pool | Optional sign-in. Essentials tier (passwordless needs it). `Retain`. |
| **AppSync Events** | `room/<code>/<runId>`. IAM publishes; the authorizer admits subscribers. |
| **HTTP API** + 5 Lambdas | `api`, `channel-authorizer`, `sweep`, `push-sender` (#466, invoked by `api` asynchronously), and the inline Cognito `PreSignUp` trigger. |
| **S3 + CloudFront** | SPA, art, content. OAC — the bucket is not public. Two CloudFront functions: the SPA router, and one that passes the viewer's address to `/api/*`. |

The table and the user pool are `Retain` on purpose: a family's characters are
not recreatable, and `sam delete` on the wrong stack should not be able to take
them. The signing key and the origin secret are not stack resources at all, so
they survive for a different reason — nothing in the stack owns them.

The flip side is that tearing a stack down properly means four things by
hand afterwards. To be clear about what actually happens day to day: **staging is
a single long-lived stack that every pull request updates in place** — no
automation creates or destroys it, so the commands below are for the rare manual
teardown, not part of any workflow:

```bash
aws dynamodb delete-table --table-name kad-staging
aws cognito-idp delete-user-pool --user-pool-id <from the stack outputs>
aws ssm delete-parameter --name /kad/staging/token-signing-key
aws ssm delete-parameter --name /kad/staging/origin-secret
aws ssm delete-parameter --name /kad/staging/push-vapid-keys   # only if pushes were ever on
```

Leaving the parameters behind is harmless and usually what you want: redeploy the
same stage and every paired phone still works. Delete the signing key and they
re-pair by QR, which takes about ten seconds and costs nothing else. Delete the
origin secret and the next `deploy.sh` makes a new one.

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

### The origin secret, and why it *is* a deploy step

A room code is the only thing between a stranger and a game, so the API counts
wrong codes per client and refuses a client that has asked for too many
(`handlers/code-guard.ts`, issue #267). That needs to know who the client is.
Behind CloudFront the API sees an edge's address, so a CloudFront function
writes the viewer's own into `x-kad-viewer`. But the HTTP API also answers on
its own `execute-api` address, where anyone can send any `x-kad-viewer` they
like, a fresh one per guess.

So CloudFront also adds `x-kad-origin`, a secret, to everything it forwards, and
the API believes `x-kad-viewer` only alongside it. A request without it is not
refused: it is counted against the connection's own address, which for a direct
caller is the caller.

This one is a `deploy.sh` step, which the signing key deliberately is not,
because CloudFront needs the value **at deploy time**. Nothing can mint it at
runtime first. The template reads it with a `{{resolve:ssm:…}}` reference, so a
bare `sam deploy` on a stage that never ran `deploy.sh` fails loudly on the
missing parameter rather than deploying something half-configured. It is a plain
`String`, not a `SecureString`: CloudFront does not accept `ssm-secure`
references, and the value only ever means "believe this request's viewer
address". It is never printed, because this repository's Actions logs are public.

### Turning on "It's your turn" pushes (#466)

Off by default, on every stage. To turn them on for one, set two variables on
that GitHub environment (Settings → Environments → Staging or Production →
Variables), or export them before a by-hand `deploy.sh`:

| Variable | Value |
|---|---|
| `KAD_PUSH` | `on`. Anything else, or unset, is off. |
| `KAD_PUSH_SUBJECT` | The VAPID subject: a `mailto:` or `https:` address the push services (Apple's, Google's, Mozilla's) can reach the operator at, e.g. `mailto:allen@example.com`. |

`deploy.sh` passes them to the stack as `PushNotifications` and `PushContact`
on every deploy, so a stage turns pushes off only when a deploy says so.

Pushes are sent by their own function, `PushSenderFunction`, never by the API:
after a step, the API invokes it with the step's job (`InvocationType: Event`,
so the API waits only for Lambda to queue it) and the sender does the reads and
the push-service calls. The API may invoke that one function
(`lambda:InvokeFunction` on its ARN, its name in `PUSH_SENDER_FUNCTION`); the
sender has the table and read-only access to the key pair. It keeps Lambda's
default two async retries and drops events older than 15 minutes. It reserves
no concurrency: async invocations queue, and a reservation would be refused
in an account at the new-account limit. There is no secret to type in: the first request that needs the key pair mints it
into `/kad/<stage>/push-vapid-keys` (a SecureString holding
`{"publicKey","privateKey"}`), with `Overwrite: false` exactly as the signing
key is, and the API's role may read and create that one parameter. With
`KAD_PUSH=on` and no subject, the API logs a warning and pushes stay off.

To bring keys of your own instead (say, to keep one pair across stages), put
the parameter before the first deploy with pushes on:

```bash
npx web-push generate-vapid-keys --json > /tmp/vapid.json
aws ssm put-parameter --name /kad/staging/push-vapid-keys --type SecureString \
  --value "$(cat /tmp/vapid.json)" && rm /tmp/vapid.json
```

Changing the pair later strands every phone's subscription: each one is
re-made the next time that phone opens Account. Deleting the parameter does the
same, and the next request mints a new one.

### Cost

Everything here is within, or a rounding error above, the always-free tier at
three-players-on-a-Tuesday scale. The one line item worth knowing about is
Cognito **Essentials**, which passwordless sign-in requires; its free tier is
10,000 monthly active users. CloudFront is `PriceClass_100`.

Staging roughly doubles that, which is to say it is still approximately nothing
— but it is a second CloudFront distribution, and a distribution takes several
minutes to create the first time. The first pull-request deploy is slow; the
rest are not.

The wrong-code budget adds a CloudFront function on every `/api/*` request
($0.10 a million), and one conditional DynamoDB write on each join, watch,
remove and state read by code from a phone not yet seated, with one more to
give it back when the code was real.

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

### Production's custom domain: `kd.readysetcloud.io`

Production serves on `kd.readysetcloud.io` (the same pattern as the fantasy
repo's `fantasy.readysetcloud.io`). The stack issues an ACM certificate for it,
validated by a DNS record CloudFormation writes into the Route 53 zone, adds it
to the distribution, and points A/AAAA aliases at the distribution. Staging and
dev stay on `*.cloudfront.net`.

The only manual step is the Production environment's **`HOSTED_ZONE_ID`**
variable: the id of the `readysetcloud.io` hosted zone. `prod-deploy.yml` stops
before deploying if it is missing, because `deploy.sh` passes `AppDomainName` and
`AppHostedZoneId` on every deploy and an empty zone id would remove the domain.
From a laptop: `APP_DOMAIN_NAME=kd.readysetcloud.io APP_HOSTED_ZONE_ID=Z... ./scripts/deploy.sh prod`.

The asset store is deployed the same way, by the same run. Once the site is live, the last
step of `prod-deploy.yml` runs `scripts/deploy-asset-store.sh`, which creates or updates the
`kad-asset-store` stack at the host `assets.config.json` names (`assets.kd.readysetcloud.io`)
in the same hosted zone. It is skipped on a rollback dispatch, so the store never follows the
site backwards. What the role needs for it, and what the script checks, is in
[asset-store.md](./asset-store.md#how-the-store-is-deployed).

Passkeys follow the domain. If any were registered against the CloudFront domain,
changing `WEBAUTHN_RP_ID` to `kd.readysetcloud.io` invalidates them (see above);
leave it alone until you have decided that is acceptable.

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
first auth factors"*. It is listed alongside `EMAIL_OTP`, and nothing uses it.
No screen has a password field, and sign-in is the emailed code.

**The API makes the account, not the browser.** Before it asks Cognito for a
code, the client calls `POST /api/auth/start` with the address. The API makes
sure a sign-in exists for it (`AdminCreateUser`, no invitation sent), gives it a
random password that is kept nowhere (`AdminSetUserPassword`), and answers 204
whether the address was new or not (`cognito-directory.ts`). It is budgeted per
client like wrong room codes (`SIGN_IN_START_LIMIT` in 15 minutes). A family
sees none of this: they type an address and a code arrives.

The browser used to make the account itself with Cognito's public `SignUp`,
sending 32 random bytes as the password and dropping them. `SignUp` takes
whatever password it is given, and the pool cannot tell that client from a
caller who keeps theirs.

**Public sign-up is still open on the pool, for now.** A browser holding last
week's bundle still calls `SignUp`, and turning it off (`AllowAdminCreateUserOnly`)
would fail that browser's sign-in until it reloads. It is switched off in a
change of its own, once old bundles have had time to go. Until then two things
cover a direct `SignUp`:

**Sign-up is auto-confirmed.** Otherwise a new user sits `UNCONFIRMED`
behind a second emailed code. A `PreSignUp` trigger (ten lines, inline in the
template) confirms them. That is not a shortcut past verifying the address — the
OTP *is* the verification, since nobody reaches a signed-in state without
reading a message sent to that inbox.

**And the pool replaces the password of every account made that way.** A
`PostConfirmation` trigger (inline in the template, beside `PreSignUp`) sets a
random password the moment an account is confirmed and signs out anything
already signed in to it. After that the only ways in are the emailed code and a
passkey. A family sees none of this.

- If the trigger fails, the account is still made, a browser on an older bundle
  carries on to the emailed code, and `kad-<stage>-sign-up-scrub-errors` fires. The function's log
  has a `sign_up_scrub_failed` line naming the pool, the account (by the id
  Cognito generated, not the address) and the step that failed. Reset that
  account's password by hand
  (`aws cognito-idp admin-set-user-password … --permanent` with a random value).
- Every account it does scrub leaves a `sign_up_scrubbed` line, so the trigger
  running at all can be read in the log. Both lines carry an account id and
  never a password; they are kept as long as any other Lambda log.
- It does not close the moment between Cognito confirming the account and the
  trigger running. Turning public sign-up off removes that, and with it the
  trigger's reason to exist.

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

### Alarms, and where they go

Every stack has one SNS topic, `kad-<stage>-alarms`, and six alarms that publish
to it. Each counts something that should be zero:

| Alarm | Fires when | What it means at the table |
|---|---|---|
| `kad-<stage>-api-errors` | the API Lambda crashes or times out, once | a tap got no answer |
| `kad-<stage>-api-5xx` | the API answers 5xx five times in five minutes | the game is probably unplayable (this is the one that catches content failing to load) |
| `kad-<stage>-api-throttles` | Lambda refuses to run the API, once | taps are being dropped |
| `kad-<stage>-channel-authorizer-errors` | the realtime authorizer fails, once | screens cannot join a room's channel |
| `kad-<stage>-sweep-errors` | the guest sweeper fails | the job that deletes households is broken; read its log before the next run |
| `kad-<stage>-log-sweep-errors` | the log sweeper fails | old logs are not being deleted |

They only see traffic that happened. Nothing probes the site, so a production
that is broken while nobody is playing stays quiet until somebody does.

**Sending them to Slack.** Production posts to a Slack channel through AWS's own
Slack integration (Amazon Q Developer in chat applications, formerly AWS
Chatbot). Three steps, once:

1. In that service's console, choose Slack as the chat client and authorize the
   workspace. The console then shows the **workspace id** (`T…`). Stop there:
   do not go on to configure a channel in the console. The stack makes its own
   configuration, `kad-<stage>-alarms`, and a second one for the same channel
   may be refused.
2. Pick the channel and copy its **channel id** (`C…`, the last part of the
   channel's link). For a private channel, invite the AWS app to it first.
3. Set `ALARM_SLACK_WORKSPACE_ID` and `ALARM_SLACK_CHANNEL_ID` as variables on
   the `Production` GitHub environment. The next production deploy subscribes
   the channel.

Staging sets neither, so its alarms exist and nobody is told. A green staging
deploy proves the template, not production's permissions: staging deploys with
its own role, and the Slack workspace is authorized only where production
lives, so the channel cannot be tried on staging first. The first production
deploy after the two variables are set is the Slack hookup's first real test.
Watch that one.

**The deploy role needs three more services for this:** `cloudwatch`, `sns` and
`chatbot`. The dedicated roles in `infra/github-oidc.yaml` carry them (redeploy
that stack). A shared role has to be given them **before** the first deploy that
includes the alarms, or CloudFormation is refused and the whole stack update
rolls back, which is how #440 left production a day behind. Each stage's role
needs them separately: staging's passing says nothing about production's.

**Where the logs are.** `/aws/lambda/kad-*`, JSON-formatted. The stack declares
no log groups and sets no retention: Lambda creates each group on the function's
first invocation, and retention is handled account-wide by a utility outside this
repo. Setting `RetentionInDays` here would mean every deploy quietly overwriting
whatever that utility had decided.

**Old logs are deleted by the log sweeper (#524).** `LogSweepFunction` runs on
`LogSweepSchedule` (04:00 UTC on the 1st of each month) and deletes every stream
in `/aws/lambda/<stack>-*` whose newest event is more than 30 days old, so a log
line lives at most about two months, which is what the privacy page says. It
deletes streams only and never sets a retention policy, so it does not fight the
account-wide utility. It logs one line: groups, streams deleted, failed, and
whether it stopped for time (it stops 30 seconds before its 15-minute timeout;
the next month carries on). Its schedule, `kad-log-sweep-<stage>`, needs the
deploy role from `infra/github-oidc.yaml` as of #524: **redeploy that stack before
the first deploy that adds it**, or CloudFormation is refused the schedule.

**What the sweeper says.** It runs once a day and logs a one-line summary per
run: scanned, deleted, spared, failed; then the retention sweep's kids deleted,
kept and failed, the kept households it emptied and deleted with their last kid,
and the grown-ups' sign-ins it deleted with them (#524). `spared` counts
households somebody claimed between the index query and the delete — not an
error, a save. Expect most days to read `scanned 0` and nothing else. A line
starting `[sweep] could not` is a failure worth reading: there are no alarms.

A run deletes at most 25 households, so a backlog past that drains the next day
rather than in one go. If you ever want it faster, `GuestSweepSchedule` is a
stack parameter — `rate(6 hours)` was the old default.

**A client connects but never updates.** That is the realtime path, not the API:
the snapshot arrives over HTTP and the patches do not. Check the
`kad-channel-authorizer` logs — a deny there means the token names a different
room, the room has expired, or the device was revoked. `sync/appsync-socket.ts`
logs `closed before subscribing` on the browser side for the same case.

**Somebody is told "Too many wrong codes".** That network asked for more codes
with no room behind them than `CODE_MISS_LIMIT` allows in 15 minutes
(`handlers/code-guard.ts`). It clears by itself when the window turns over;
the response's `Retry-After` says when. A phone or TV reconnecting to a room
it is already in is not affected: reading a room's state with a token for that
room is never counted or refused. Joining or watching from scratch is. The rows are `GUESS#<client>` / `WINDOW#<n>`, and deleting one forgives
that client at once.

**Somebody is told "Too many new games from here".** That network opened more
rooms in 15 minutes than the room-opening budget allows
(`handlers/code-guard.ts`, `admitRoomOpen`): `ROOM_OPEN_NEW_LIMIT` from devices
the game had never seen, or `ROOM_OPEN_KNOWN_LIMIT` from devices it had. Joining
a room, and playing in one, are not affected. It clears when the window turns
over, and the rows are the wrong-code budget's, under `open#new#<client>` and
`open#known#<client>`.

**Somebody got into a game who should not be there.** The TV, or the phone
that opened the room, showed them arriving, with a Remove button that stays
until the host dismisses it. After a refresh of the host's screen, or once
dismissed, the same thing by hand: append their playerId to
`removed` on the run's `RUN#<runId>` / `STATE` item and set their party member's
`connected` to `false`. Their joins, actions and channel subscriptions are
refused from then on. A room opened before #267 has no host and no button.

**A room is stuck.** Rooms expire on their own after six hours. `getRoom` filters
expired rooms at read time rather than waiting for the TTL sweep, so a stale code
reads as gone immediately even though the row may live for up to 48 hours more.

**A phone was lost.** Revoke its `DEVICE#<deviceId>` item. That kills the token
on the next request — verification is local, but every resolve still reads the
binding precisely so revocation is immediate. Characters are untouched; they
belong to the household.

**Somebody wants their anonymous characters back after seven days.** They are
gone, and that is the design. There is no backup to go to: point-in-time
recovery is off, because the only restore it offers is the *whole table* at
once, which trades one family's session for everyone else's — not a trade
anybody would actually make at the table.

The recoverable path is the one the game already offers, and it runs before the
loss rather than after it: sign in, and the household stops being a guest.

**Rolling back.** `sam deploy` produces a changeset per deploy; CloudFormation
rolls back a failed one on its own. For a deploy that *succeeded* into a bad
state, the first tool is the production workflow's `ref` input — Run workflow,
pick the last good commit, and it rebuilds and ships that (see the table at the
top). A bad *client* bundle is faster to fix that way than by reverting S3,
since `index.html` is served `no-cache` and the hashed bundle under `/bundle/*`
is immutable. Versioning is enabled on the site bucket, so the previous client
and assets remain recoverable object versions after a sync — but roll-forward
(or ref-rollback) stays the primary story; the versions are a safety net, not a
deploy path.


---

## Recorded narration (`voice/`)

Narration clips live in the same site bucket as the site, under their own top-level `voice/`
prefix, and are uploaded by `npm run voice:generate`, not by `deploy.sh`. They are named by a hash
of their sound, so they are immutable and cached for a year.

- `deploy.sh` syncs `--delete` only into `bundle/`, `assets/` and `content/`, and syncs the bucket
  root without `--delete`, so a deploy never removes a clip. `tools/voice/deploy-guard.test.ts` fails
  if that changes. Do not add a `--delete` sync of the root or of `voice/`.
- `/voice/*` is its own CloudFront behavior (`infra/template.yaml`), without the SPA router.
- The chapter manifests are in git under `content/voice/manifest/` and deploy with `content/`.
- Staging and production each have their own bucket. `voice:generate --stage staging,prod` renders
  once and uploads to both, so the same manifest works on either. Staging's deploy tolerates a clip
  missing from its bucket (it warns); prod's does not.
- Clips are never deleted by the tooling. Old ones cost almost nothing and an old manifest may still
  name them; remove a clip by hand only once no deployed manifest does.

See [voice-narration-plan.md](./voice-narration-plan.md#running-it-npm-run-voicegenerate).
