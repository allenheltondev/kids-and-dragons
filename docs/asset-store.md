# The asset store

The game's art and audio live in S3, not in git. Git keeps `assets.lock.json`,
which says which bytes sit at which path in each commit. Tools, the dev server,
the site and the wiki still read the same paths (`assets/cast/pib/assembled.png`).
Only how the files reach the disk has changed.

| Piece | Where |
|---|---|
| The store: an S3 bucket, content-addressed, write-once, read through CloudFront | [`infra/asset-store.yaml`](../infra/asset-store.yaml), one stack, `kad-asset-store`, [deployed by the production deploy](#how-the-store-is-deployed) |
| What it manages: media under `assets/`, `art/`, `docs/` | [`assets.config.json`](../assets.config.json) |
| Which bytes belong at each path in this commit | `assets.lock.json` (written by the tools, never by hand) |
| The commands | [`tools/assets/`](../tools/assets/cli.ts), as `npm run assets:*` |
| The layout, shared by every reader and writer | [`packages/shared/src/asset-store.ts`](../packages/shared/src/asset-store.ts) |

## How it works

A file's bytes are stored once, under their hash: `sha256/ab/abcdef….png`. A
key names its bytes, so a blob is never overwritten (the bucket policy refuses
any write that is not conditional). CloudFront caches every blob for a year.
Two paths with the same picture share one blob.

The lock is the only part in git. It has one line per file, sorted:

```json
"assets/cast/pib/assembled.png": { "sha256": "9f2c…", "bytes": 812345 },
```

so a commit still names exactly the art it shipped with, a diff still says
which painting changed, and checking out an old commit (from after the cutover)
and pulling gives back that commit's art.

Reading needs no credentials. The store's URL (`storeUrl` in
`assets.config.json`, served by CloudFront) is public, as the art already is on the site and the wiki.
That is what lets CI, the wiki build, a deploy, a fresh clone and an agent's
session all run `npm run assets:pull` with nothing to set up. Writing needs AWS
credentials with the `kad-asset-writer` policy (see [Credentials](#credentials)).

What stays in git: everything that is not media (`assets/manifest.json`,
READMEs, briefs, prompts, SVGs), and the client's own bundled art under
`packages/client/` (Vite imports it at build time). Voice clips were never in git
and keep their own pipeline ([voice-narration-plan.md](./voice-narration-plan.md) §5).

## Every day

| You want to | Run |
|---|---|
| Get the art onto disk (a fresh clone, after `git pull`) | `npm run assets:pull` (everything) or `npm run assets:pull -- assets` (just the game's) |
| See what differs from the lock | `npm run assets:status` |
| Save new or changed art | `npm run assets:push`, then commit `assets.lock.json` with the change |
| Save generated output on purpose (a contact sheet under `art/review/`) | `npm run assets:push -- art/review/my-sheet` (name it; it is not picked up otherwise) |
| Record a deletion | delete the file, then `npm run assets:push -- --prune assets/cast/old-goblin` |
| Link to a picture (a PR, a review doc, a chat) | `npm run assets:url -- assets/cast/pib/assembled.png` |
| Find out where a painting came from | `npm run assets:provenance -- assets/cast/pib/assembled.png` ([Provenance](#provenance)) |
| Say which art issue a push is for | `npm run assets:push -- --issue 704 <folder>` (stamped on each new blob) |
| Check everything is consistent | `npm run assets:verify` |

`push` refuses to run before the cutover (no `assets.lock.json`): the art is still in git then, and
a push would write a lock naming only the new files, which every other tool would read as "migrated".

`pull` behaves the way `git checkout` does with your edits. It fetches what is
missing, updates what it put there itself when the lock moves on, and removes
what the lock dropped. It never overwrites a file you changed, or brings back
one you deleted, until you push it or run `pull --force`. It keeps a per-checkout
record in `.assets/` (gitignored) to tell these apart. Downloads go through one
cache per machine (`~/.cache/kad-assets`, or `KAD_ASSET_CACHE`), shared by every
clone and worktree.

`push` uploads only blobs the store does not already have, then writes the lock.
It writes the lock only after every upload succeeded, so a committed lock never
points at art nobody stored. It never infers a deletion from a missing file,
because a partial pull would look like one. Name the folder with `--prune`.

### For agents making images

The art tools are unchanged: `coat-clean`, `portraits`, `camp-paint`, a painting
saved by hand all write into `assets/` or `art/` as before. Then:

1. `npm run assets:push` (or `npm run assets:push -- <the folder you worked in>`).
2. Commit `assets.lock.json` with whatever uses the art (`assets/manifest.json`, a chapter).
3. Never `git add -f` a PNG, WebP or WebM under `assets/`, `art/` or `docs/`.
   `assets:verify` fails CI on one.

Drafts that are not ready stay in `staging/` (gitignored), as before. Push
happens once the art has passed `art:verify` and the human gate.

With neither an MCP key nor AWS credentials, `push` says so and changes nothing. Do not commit the
binaries instead. Leave the files on disk and say which paths need pushing.

### The dev server

`npm run dev` serves `/assets/*` from disk, as it always did. When a file is not
on disk (a fresh clone that has not pulled), it looks the path up in the lock,
fetches the blob into the machine cache once, and serves it from the same origin
([`packages/server/src/dev-assets.ts`](../packages/server/src/dev-assets.ts)). A
file on disk always wins, so art you just made shows before you push it.

### Merging

Two branches that each add a painting to one folder change neighboring lines of
the lock, and git's line merge calls that a conflict. A merge driver
([`tools/assets/merge-lock.ts`](../tools/assets/merge-lock.ts)) merges by path
instead. It stops only when both sides changed the same path differently.
`scripts/setup.sh` registers it, because git reads drivers only from local config.
GitHub's web merge button does not run custom drivers. If it reports a conflict
in the lock, merge locally.

## How each reader gets the art

| Reader | How |
|---|---|
| **The game, in production** | Unchanged URLs: `/assets/<path>` on the site's own domain, served by CloudFront from the site bucket. `deploy.sh` pulls `assets/`, refuses to continue unless it matches the lock exactly (`assets:verify --present assets`), then syncs it as before. The client did not change. |
| **The game, in dev** | Disk, then the store fallback above. |
| **CI** | [`.github/actions/pull-assets`](../.github/actions/pull-assets/action.yml) in each job that reads art, cached on the lock's hash. The checks job runs `assets:verify`. |
| **The wiki** | `wiki-deploy.yml` pulls `assets` and `art/reference` before Hugo, which mounts them and resizes from them. It also rebuilds when `assets.lock.json` changes. |
| **Agents' sessions** | `scripts/setup.sh` (the SessionStart hook) pulls `assets/`. |
| **Review docs on GitHub** | Once untracked, a relative image link in `docs/` shows only after a local pull. For a page meant to be read on GitHub, link `npm run assets:url` output instead. |

Every one of these is a no-op on a commit without a lock, so this all ships
before the cutover and changes nothing until then.

## Provenance

`npm run assets:provenance -- <path>` says where a painting came from, joined from three
places that each know part of it (#732):

| Source | What it knows | How durable |
|---|---|---|
| **git** | the commits that recorded these bytes at this path in the lock, and the PR each came in by | the durable record |
| **the prompt record** | the painting's entry in its `docs/*-prompts.json`: `issue`, `generator`, `uploadedBy`, `original`, the prompt | durable, written by the `art-creation` skill |
| **the store's stamp** | who *first* put these bytes in the store: the key's label, agent and tags (or `KAD_UPLOADED_BY` for an AWS write), the path, the issue, the time | written once at upload, can never change |

**The stamp is signed and public.** An upload URL signs the `x-amz-meta-kad-*` headers, so the
uploader can neither drop nor change them, and the store's CDN returns them with the blob to
anyone. A key's label, agent and tags are therefore plain words checked at mint (no spaces in
agents or tags, no emails, no secrets). An AWS-credentialed write is stamped with
`KAD_UPLOADED_BY` (default `operator`), never with the AWS identity, which would name the
account and the user.

A stamp is never shortened: it is written once and can never be repaired, so a value too long
for S3's 2 KB of object metadata refuses the upload instead (a 512-character path with a key's
full eight tags fits). Printable ASCII is stored as it is; anything else is percent-encoded.

The stamp names only the first uploader of some bytes, because a blob is written once; the
same bytes used again at another path, or by another key, show in git and not in the stamp.
Art stored before stamps existed has none.

**The generator's original** is kept, unchanged, under `art/source/originals/<issue>/` and
named in the prompt record's `original`. Fitting a painting to its contract re-encodes it,
which strips any content credentials (C2PA) the generator attached; the original keeps them.


Reading needs none. Writing goes one of two ways, chosen by `--writer` or
`KAD_ASSET_WRITER` (default `aws`):

- **`mcp`: an MCP key, no AWS credentials.** `push` asks the MCP server
  ([mcp-server.md](./mcp-server.md)) for a presigned upload URL per new blob and
  PUTs the bytes there. The URL can only add those exact bytes under their hash:
  S3 checks the checksum, and refuses to overwrite. This is the way for **cloud
  agent sessions**. Mint a key with `assets:write`
  (`npm run mcp:keys -- create --stage prod --label cloud-agent --scope assets:write`).
  Give it to the environment as a **network secret** for the site's host
  (`Authorization: Bearer <key>`), so the key never enters the session. Set the
  environment variables `KAD_ASSET_WRITER=mcp` and `NODE_USE_ENV_PROXY=1` (node's
  fetch then uses the sandbox proxy). `mcpUrl` in `assets.config.json` says
  where the server is. Outside a sandbox, `KAD_MCP_TOKEN` carries the key instead.
- **`aws`: AWS credentials with the `kad-asset-writer` policy** (a store stack
  output). It allows upload and look-up under `sha256/` and `history/` only, has
  no delete, and the bucket policy makes every blob write conditional. This is the
  way on **your laptop**: attach the policy to the IAM user or role your AWS
  profile uses, and `push` finds the bucket from the stack's outputs. The cutover
  (`migrate`, `archive-history`) needs this way, since history archives are not
  blobs and the MCP server stores blobs only.

GitHub Actions writes nothing today. If it ever needs to, an OIDC role with the
policy attached, as in [deploy.md](./deploy.md#turning-the-automated-deploys-on).

## How the store is deployed

Nobody stands the store up by hand. The production deploy creates it and keeps it up to
date: the last step of [`prod-deploy.yml`](../.github/workflows/prod-deploy.yml) runs
[`scripts/deploy-asset-store.sh`](../scripts/deploy-asset-store.sh), which deploys
`infra/asset-store.yaml` as `kad-asset-store`. A merge to `main` that changes the template
changes the store; a merge that does not is a no-op there.

**The address is declared, not discovered.** `storeUrl` in `assets.config.json` is what
every clone, CI job and deploy pulls from, so it has to be in the repo before the stack
exists. The script reads the host out of it (`assets.kd.readysetcloud.io`), passes it to the
stack as `StoreDomainName` with the hosted zone, and the stack issues the certificate and
the DNS records for it. After every deploy the script fails unless the stack's `StoreUrl`
output equals `storeUrl` and that URL answers the way a healthy store does: its root is a
403 (the CDN reached the bucket, which lists nothing). A 5xx, a 404 or no answer fails the
run. No stack output is copied into a file. To
move the store to another host, change `storeUrl` and merge.

Things the wiring is careful about (`tools/assets/store-deploy.test.ts` pins each):

- **It runs last, after the site is live.** A store that will not deploy fails the run, but
  never keeps a fix from reaching the families.
- **It never follows a rollback.** A dispatch that names an older ref ships that commit of
  the site only; the store step is skipped, so the store's template never goes backwards.
- **A failed first create cleans up after itself.** The bucket is
  `DeletionPolicy: RetainExceptOnCreate`: it survives the stack being deleted (once history
  is rewritten it holds the only copy of the art), but a first create that rolls back takes
  its empty bucket with it. The script deletes the rolled-back stack and creates again on
  the next run.
- **It stops rather than drop the budget.** No subscriber means no budget, so the only time
  it deploys without the alarm topic is when there is no production stack at all. If the
  read fails, or the production stack is there but has no `AlarmTopicArn` output, it fails
  before deploying.
- **Production only.** Staging lives in another AWS account and reads art from this store's
  public URL, so it has no store of its own. An upload through staging's MCP server has no
  bucket to land in.

From a laptop the script refuses unless `KAD_DEPLOY_ANYWAY=1`, as `deploy.sh prod` does. That
is for the evening the pipeline itself is broken.

Attach the stack's `WriterPolicyArn` output (`kad-asset-writer`) to whoever pushes with AWS
credentials ([Credentials](#credentials)).

### What the deploy role needs

The role the production deploy assumes must be able to create everything in the stack. On
top of what the site's stack already needs (CloudFormation, the bucket, the CDN, the
certificate and the DNS records), the store adds:

| Actions | On | For |
|---|---|---|
| `budgets:ModifyBudget`, `budgets:ViewBudget` | `arn:aws:budgets::<account>:budget/kad-asset-store` | the budget (#733) |
| `iam:CreatePolicy`, `iam:GetPolicy`, `iam:DeletePolicy`, `iam:CreatePolicyVersion`, `iam:DeletePolicyVersion`, `iam:GetPolicyVersion`, `iam:ListPolicyVersions` | `arn:aws:iam::<account>:policy/kad-asset-writer` | the writer policy, and nothing else in IAM |
| `s3:PutBucketTagging`, `s3:GetBucketTagging`, `s3:GetEncryptionConfiguration`, `s3:GetBucketOwnershipControls` | `arn:aws:s3:::kad-asset-store-<account>` | the tag the budget filters on, and reading the bucket's settings back |

The same statements are written out in [`infra/github-oidc.yaml`](../infra/github-oidc.yaml)
(`kad-deploy-asset-store`), which is the repo's record of what a deploy role holds. A role
that lacks one fails the store step with CloudFormation's refusal printed, and the next run
tries again from a clean slate.

### The budget

The stack makes a monthly AWS Budget, `kad-asset-store` (#733), on the bucket and the CDN,
against `MonthlyBudgetUsd` (default $10; the deploy passes `ASSET_STORE_BUDGET_USD` when set).
It alerts at 80% of actual spend, and when the month is forecast to pass the limit, to
`AlarmTopicArn` and/or `BudgetEmail`. The deploy script reads `AlarmTopicArn` from the
production stack's output of that name, so the alerts reach the same Slack channel as the
stack's alarms. With neither, no budget is made.

**The one step a deploy cannot do, once per account:** in the Billing console, under Cost
allocation tags, activate `kad:component`. The bucket and the CDN carry
`kad:component=asset-store`, and the budget filters on it. AWS only lists a tag for
activation after it has seen it on a bill, up to a day after the store's first deploy, so
no template or script can do it at create time. Until the tag is active the budget sees
nothing and never fires; nothing else depends on it. `tools/assets/deploy-guard.test.ts`
pins the tag on both.

**When it fires:** something is uploading or downloading far more than painting does.
- Uploads: `npm run mcp:keys -- list --stage prod` shows which key was used last. The store's
  stamps (`npm run assets:provenance`) and the MCP function's log lines name the key and agent.
  Revoke the key; it can only have added blobs, never replaced or deleted any.
- Downloads: CI pulls through the Actions cache, so a cache that keeps missing (a changed
  key, an evicted cache) shows as CDN transfer. Check the runs' "Pull assets" steps.

## The cutover

Do this from a **full** clone (not shallow; `archive-history` refuses one, since a partial archive would look complete), with every branch and tag fetched, and with write credentials. Each step is
safe to stop after and re-run.

1. **Archive history.** `npm run assets:archive-history` uploads every version of
   every managed file that history has ever held, plus a change log (commit,
   date, path, sha256; merge commits are diffed against their first parent, and every
   blob reachable from any ref is stored too, under each extension it was used with) to `history/<stamp>.json` in the store and `.assets/`
   locally. Keep the `.git/filter-repo/commit-map` the rewrite writes later. With
   the two, any old commit's art can be rebuilt after its blobs leave git.
2. **Migrate.** `npm run assets:migrate` uploads every media file git tracks and
   writes `assets.lock.json`. Commit the lock alone and push. The art is still in
   git, so nothing changes yet, but CI's `assets:verify` now proves every blob
   the lock names is in the store.
3. **Check from nothing.** In a scratch directory, delete every managed file from a
   fresh clone and let the store put them back:

   ```bash
   git clone --depth 1 git@github.com:allenheltondev/kids-and-dragons.git t && cd t
   git ls-files -z assets art docs | grep -ziE '\.(png|webp|jpe?g|gif|avif|webm|mp3|ogg|oga|wav|m4a|flac|mp4)$' | xargs -0 rm
   KAD_ASSET_CACHE=$(mktemp -d) npm run assets:pull
   git status --short    # empty: every file came back byte for byte from the public URL
   ```
4. **Untrack.** `npm run assets:migrate -- --untrack`. It re-checks that every
   tracked file is in the lock with the same bytes and fetchable from `storeUrl`.
   Then it removes them from the index (they stay on disk), adds the ignore block
   to `.gitignore`, and sets `"untracked": true`, which arms the guard against
   media in git. Commit and merge. Other clones lose the files on their next
   `git pull` and get them back with `npm run assets:pull`.

## Rewriting history

After the cutover is merged and a CI run and a deploy have gone green on it:

```bash
npm run -s assets:filter-args     # prints the exact command for the current rules, e.g.
# git filter-repo --invert-paths --path-regex '(?i)^(assets|art|docs)/.*\.(png|webp|…)$'

git clone --mirror git@github.com:allenheltondev/kids-and-dragons.git kad.git
cd kad.git
# GitHub's pull-request refs are read-only; pushing them back would fail the mirror push.
git for-each-ref --format='delete %(refname)' refs/pull | git update-ref --stdin
<paste the printed git filter-repo command>

# Inspect before anything leaves this machine: the media are gone, everything else is not.
git log --oneline -5 --all
git rev-list --objects --all | grep -ciE '\.(png|webp|webm)$'    # managed media left: expect 0
git count-objects -vH                                           # size-pack: the new size

# filter-repo removes the origin remote on purpose, so nothing is pushed by accident.
# Put it back only now, then push.
git remote add origin git@github.com:allenheltondev/kids-and-dragons.git
git push --force --mirror origin
```

The `grep` counts every managed extension in a real run; widen it to the full list
`assets:filter-args` printed if you want the exact check.

Things to know before you do it:

- **Every commit hash changes.** Everyone re-clones. Open pull requests need their
  branches rebased onto the new history (or recreated).
- **A stale clone can put the old history back.** Any clone, worktree or cloud
  session made before the rewrite still holds every old blob, and one ordinary
  `git push` of a branch based on the old history uploads all of it again. After
  the rewrite, delete old clones (and `.claude/worktrees/`) rather than pulling
  into them, close or recreate pull requests opened from the old history, and
  delete remote branches you do not mean to keep before the mirror push (a mirror
  push writes every ref the mirror has). If one does slip through, it shows as
  the repository growing back: `git count-objects -vH` on a fresh clone.
- **Commits from before the cutover have no art and no lock.** Do not deploy one
  (a production rollback to a ref before the cutover). Its own `deploy.sh` predates
  the guard and would sync an empty `assets/` with `--delete`. The
  production workflow's `pull-assets` step fails on such a ref because the action
  does not exist there, which stops it, but a laptop deploy would not stop.
- **GitHub keeps the old objects** reachable from `refs/pull/*` and in caches until
  GitHub Support runs a garbage collection on the repository. Ask them to, if
  the size of the repo on GitHub matters, not just of fresh clones.
- The old blobs remain recoverable from the store through the history archive (step 1).

## Failure modes, and what catches them

| What goes wrong | What catches it |
|---|---|
| A lock names a blob nobody uploaded | `assets:verify` in CI (store check); `pull` fails loudly on it |
| A painting is committed to git after the cutover | `assets:verify` in CI |
| The store serves bytes that do not hash to their name | `pull` and the dev server refuse them |
| A deploy runs with art missing or unpushed | `deploy.sh`: `assets:verify --present assets` before the `--delete` sync |
| Someone overwrites a blob | the bucket policy (conditional writes only); versioning keeps 90 days anyway |
| A partial pull is mistaken for deletions | `push` never prunes unless told where |
| Two branches add art to one folder | the merge driver |
| A hand edit leaves the lock unsorted or malformed | `assets:verify` (canonical form) |
