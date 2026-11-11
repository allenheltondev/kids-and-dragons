# The asset store

The game's art and audio live in S3, not in git. Git keeps `assets.lock.json`,
which says which bytes sit at which path in each commit. Tools, the dev server,
the site and the wiki still read the same paths (`assets/cast/pib/assembled.png`).
Only how the files reach the disk has changed.

| Piece | Where |
|---|---|
| The store: an S3 bucket, content-addressed, write-once, read through CloudFront | [`infra/asset-store.yaml`](../infra/asset-store.yaml), one stack, `kad-asset-store` |
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

Reading needs no credentials. The store's CloudFront URL (`storeUrl` in
`assets.config.json`) is public, as the art already is on the site and the wiki.
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
| Check everything is consistent | `npm run assets:verify` |

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

With no write credentials, `push` says so and changes nothing. Do not commit the
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

## Credentials

Writers need the `kad-asset-writer` managed policy (a stack output). It allows
upload and look-up under `sha256/` and `history/` only. It has no delete, and the
bucket policy makes every blob write conditional, so a writer cannot overwrite
anything either.

- **Your laptop, and agents running on it:** attach the policy to the IAM user or
  role your AWS profile uses. `push` finds the bucket from the stack's outputs.
- **Cloud agent sessions (claude.ai/code):** make an IAM user with only this
  policy (say `kad-asset-agent`), and give its access key to the environment in
  its settings as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, with
  `AWS_REGION=us-east-1` and `KAD_ASSET_BUCKET=<the BucketName output>` (which
  saves a CloudFormation call). Allow the hosts it talks to:
  `<bucket>.s3.us-east-1.amazonaws.com` and the CloudFront domain in `storeUrl`.
- **GitHub Actions:** an OIDC role with the policy attached, as in
  [deploy.md](./deploy.md#turning-the-automated-deploys-on). Nothing in CI writes today.
  Reads need no role.

## Standing the store up

```bash
aws cloudformation deploy \
  --template-file infra/asset-store.yaml \
  --stack-name kad-asset-store \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1

aws cloudformation describe-stacks --stack-name kad-asset-store --region us-east-1 \
  --query "Stacks[0].Outputs" --output table
```

Put `StoreUrl` in `assets.config.json` as `storeUrl` and commit it. Attach
`WriterPolicyArn` to whoever will push. The bucket is `DeletionPolicy: Retain`.
Once history is rewritten it holds the only copy of the art, so deleting the
stack leaves it in place.

## The cutover

Do this from a **full** clone (not shallow), with write credentials. Each step is
safe to stop after and re-run.

1. **Archive history.** `npm run assets:archive-history` uploads every version of
   every managed file that history has ever held, plus a change log (commit,
   date, path, sha256) to `history/<stamp>.json` in the store and `.assets/`
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
git push --force --mirror
```

Things to know before you do it:

- **Every commit hash changes.** Everyone re-clones. Open pull requests need their
  branches rebased onto the new history (or recreated).
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
