#!/usr/bin/env bash
#
# One command to deploy a stack — roadmap Chapter 0.
#
#   ./scripts/deploy.sh prod         → the prod stack
#   ./scripts/deploy.sh staging      → the staging stack
#   ./scripts/deploy.sh dev          → a stack you drive by hand
#
# The environment is always named. No argument used to mean prod, so
# `npm run infra:deploy` from any checkout shipped whatever was in it to the
# families' stack.
#
# The workflows call this same script — `deploy.yml` for staging on every pull
# request, `prod-deploy.yml` for prod once CI passes on main — so what runs from
# a laptop and what runs from CI are the same steps in the same order, and
# there is no deploy path that is only ever exercised by one of them.
#
# Order matters and is not arbitrary:
#
#   0. the art and audio from the asset store, checked against assets.lock.json
#   1. the checks, because a broken chapter must fail here and never at the table
#   2. both builds (the Lambda bundles and the client), and the voice-clip
#      check, because anything that can fail without touching AWS should fail
#      before the stack changes
#   3. the stack, because the bucket and distribution it creates are where step 4 goes
#   4. the client, art, and content
#   5. an invalidation, because CloudFront is still holding the previous index.html
#   6. pruning bundle files no page can still be asking for
#
# Uploading the SPA *after* the stack means a deploy that fails at step 3 leaves
# the previous version serving, rather than a new bundle talking to an API that
# does not exist yet. Building it *before* the stack is the other half of that:
# the client used to be built after `sam deploy`, so a build that failed left a
# new API serving the old client.
#
# KAD_PREBUILT=1 turns this into a ship-only run: both builds in step 2 are
# skipped and whatever is already in infra/.build/ and packages/client/dist/
# is deployed as-is. The prod workflow sets it after downloading CI's build
# artifact, so production ships the exact bytes CI tested. The ordering above
# still holds — both directories are *verified* up front, before sam deploy, so
# a ship with no artifact fails before it can push empty CodeUris at the stack.
# Never set it by hand unless you have just put a real build in both places.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: ./scripts/deploy.sh <prod|staging|dev>

  prod      the families' stack (kad-prod)
  staging   the stack every pull request deploys to (kad-staging)
  dev       a stack you drive by hand (kad-dev)

The environment is required: there is no default.
EOF
}

# Before anything else, the tool checks included: a run that names no
# environment must say so, whatever is or is not installed.
if [ "$#" -lt 1 ]; then
  echo "error: no environment given" >&2
  usage
  exit 2
fi

CONFIG_ENV="$1"
case "$CONFIG_ENV" in
  prod)    STACK="kad-prod";    STAGE="prod" ;;
  staging) STACK="kad-staging"; STAGE="staging" ;;
  dev)     STACK="kad-dev";     STAGE="dev" ;;
  *)
    echo "error: unknown environment '$CONFIG_ENV'" >&2
    usage
    exit 2
    ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The stack lives in us-east-1 (infra/samconfig.toml). CI exports AWS_REGION;
# a laptop may not, and without it `describe-stacks` silently reads the
# profile's default region and reports a stack that deployed fine as missing.
export AWS_REGION="${AWS_REGION:-us-east-1}"

say() { printf "\n\033[1;36m==> %s\033[0m\n" "$1"; }

# Production from a laptop ships exactly what main is, or it says why not.
#
# CI needs none of this: prod-deploy.yml deploys a commit CI passed, refuses
# one that is no longer the tip of main, and its rollback path names its ref on
# purpose. A laptop has none of those, only a working tree that may hold a
# half-finished edit or sit on a branch. KAD_DEPLOY_ANYWAY=1 is for the evening
# CI itself is what is broken, or a rollback by hand to an older commit; it
# prints what it is about to ship instead of refusing.
if [ "$STAGE" = "prod" ] && [ -z "${CI:-}" ]; then
  problems=()
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    problems+=("the working tree has uncommitted changes")
  fi
  head_sha="$(git rev-parse HEAD 2>/dev/null || true)"
  main_sha="$(git ls-remote origin refs/heads/main 2>/dev/null | cut -f1 || true)"
  if [ -z "$head_sha" ] || [ -z "$main_sha" ]; then
    problems+=("could not compare HEAD with origin's main")
  elif [ "$head_sha" != "$main_sha" ]; then
    problems+=("HEAD (${head_sha:0:8}) is not the tip of origin's main (${main_sha:0:8})")
  fi
  if [ "${#problems[@]}" -gt 0 ]; then
    if [ "${KAD_DEPLOY_ANYWAY:-}" = "1" ]; then
      say "Deploying to prod anyway (KAD_DEPLOY_ANYWAY=1)"
      printf '  - %s\n' "${problems[@]}"
    else
      echo "error: refusing to deploy this checkout to prod:" >&2
      printf '  - %s\n' "${problems[@]}" >&2
      echo "       Production normally deploys itself when CI passes on main." >&2
      echo "       To ship this checkout regardless, set KAD_DEPLOY_ANYWAY=1." >&2
      exit 1
    fi
  fi
fi

for tool in sam aws node npm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool is not installed" >&2; exit 1; }
done

# ---------------------------------------------------------------------------

# The art and audio (docs/asset-store.md). Once they live in the asset store, a
# checkout has assets.lock.json and no paintings, so they are pulled before
# anything reads them: the checks below, and the `--delete` sync of assets/ to
# the site. Plain node and a public URL, so ship mode needs neither
# node_modules nor any permission on the store. A commit from before the store
# has no lock and keeps its art in git; both commands say so and pass.
#
# The verify is what makes the sync safe: it refuses unless assets/ holds
# exactly the bytes the lock names. Without it, a pull that half-failed, or a
# laptop with an agent's unpushed paintings, would publish a site that matches
# no commit, and a sync with --delete would take the missing art off it.
say "Art and audio from the asset store"
node tools/assets/cli.ts pull assets
node tools/assets/cli.ts verify --no-store --present assets

# CI has already run every one of these on the same commit, and running them
# twice buys nothing but minutes. Never set this by hand — the whole point of
# the order in this file is that a broken chapter fails here and not at the
# table.
if [ "${KAD_SKIP_CHECKS:-}" = "1" ]; then
  say "Checks — skipped (already run by CI on this commit)"
else
  say "Checks"
  npm run typecheck
  npm test
  npm run content:validate
  npm run art:verify
  # The voice manifests against today's words (#545): a manifest whose clips still exist but
  # say text that has since changed passes the site check below, so it is caught here.
  npm run voice:verify
  # cfn-lint is a pip install, so a laptop may not have it. CI always does
  # (ci.yml), which keeps the stack linted on every path that gates a merge.
  if command -v cfn-lint >/dev/null 2>&1; then
    npm run infra:lint
  else
    say "infra:lint — skipped (cfn-lint not installed; CI runs it)"
  fi
fi

if [ "${KAD_PREBUILT:-}" = "1" ]; then
  say "Ship-only run (KAD_PREBUILT=1) — verifying the prebuilt artifact"
  # Fail loudly *before* sam deploy: an empty or missing directory here means
  # the artifact was never downloaded (or was uploaded without its dot-dirs),
  # and shipping it would mean empty CodeUris and a blank client. The three
  # subdirectories are the template's CodeUri values (infra/template.yaml).
  for dir in \
      infra/.build/api \
      infra/.build/channel-authorizer \
      infra/.build/sweep \
      infra/.build/mcp \
      packages/client/dist; do
    if [ ! -d "$dir" ] || [ -z "$(ls -A "$dir" 2>/dev/null)" ]; then
      echo "error: KAD_PREBUILT=1 but $dir is missing or empty." >&2
      echo "       Download the CI build artifact first, or unset KAD_PREBUILT to build here." >&2
      exit 1
    fi
  done
else
  say "Bundling Lambdas"
  node infra/build.mjs
  # Here and not after the stack: the build needs nothing the stack makes, and
  # one that fails after `sam deploy` leaves a new API serving the old client.
  say "Building the client"
  npm run build
fi

outputs() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK" \
    --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
    --output text
}

# Recorded narration (#545): every clip the manifests in content/ play must be
# on this site before those manifests go live, or a browser fetches a 404
# mid-sentence. Asked over HTTPS exactly as a browser asks, so it needs no AWS
# permission, and run with plain node because a ship-mode deploy has no
# node_modules. Not skipped with the checks: CI cannot know what this bucket
# holds. No manifests is the ordinary state and passes at once.
#
# Staging asks prod. Clips are rendered and uploaded to the prod bucket as part
# of writing narration (`voice:generate --stage prod`), and staging is where
# every pull request deploys, so a branch's manifests are checked against the
# bucket its clips are meant to be in: a manifest that names a clip prod does
# not have still stops the deploy, which is the mistake this guards. Staging's
# own bucket is not asked, so a staging page may fetch a /voice/ clip that only
# prod holds. prod and dev ask their own site, as before.
PROD_SITE_URL="${KAD_PROD_SITE_URL:-https://kd.readysetcloud.io}"
voice_clips_on_site() {
  local site="$SITE_URL"
  if [ "$STAGE" = "staging" ]; then
    site="$PROD_SITE_URL"
  fi
  say "Voice clips on $site"
  node tools/voice/verify-site.ts "$site"
}

# Asked before the stack changes whenever there is a site to ask: the clips
# live in the bucket, not in this deploy, so the answer is the same either
# side of `sam deploy`, and a missing clip should stop the deploy while the
# old API is still the one serving. A stack that does not exist yet has no
# site; its first deploy asks afterwards, below.
SITE_URL="$(outputs SiteUrl 2>/dev/null || true)"
VOICE_CHECKED=0
if [ -n "$SITE_URL" ] && [ "$SITE_URL" != "None" ]; then
  voice_clips_on_site
  VOICE_CHECKED=1
fi

# The secret CloudFront adds to every request it forwards to the API, so the
# API knows which viewer addresses to believe (infra/template.yaml,
# KAD_ORIGIN_SECRET). The template reads it with a dynamic reference, which
# fails the deploy if the parameter does not exist, so it is made here, once
# per stage, and never changed. Never printed: this repository's Actions logs
# are public. `--no-overwrite` makes two first deploys racing converge on one
# value; the loser's error is the expected one and is swallowed.
ORIGIN_SECRET_PARAM="/kad/$STAGE/origin-secret"
if ! aws ssm get-parameter --name "$ORIGIN_SECRET_PARAM" --region "$AWS_REGION" \
  --query Parameter.Version --output text >/dev/null 2>&1; then
  say "Creating $ORIGIN_SECRET_PARAM"
  if ! err="$(aws ssm put-parameter --name "$ORIGIN_SECRET_PARAM" --region "$AWS_REGION" \
    --type String --no-overwrite \
    --value "$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')" \
    2>&1 >/dev/null)"; then
    case "$err" in
      *ParameterAlreadyExists*) ;;
      *) echo "$err" >&2; exit 1 ;;
    esac
  fi
fi

say "Deploying the stack ($STACK)"

# Every parameter, every time.
#
# A parameter left out of `--parameter-overrides` does whichever quiet thing is
# worse for you: the template default on a fresh stack, the *previous stack
# value* on an update. Either way it is a state nobody wrote down anywhere.
# WebAuthnRelyingPartyId defaults to empty, and empty means
# `AllowedFirstAuthFactors` drops WEB_AUTHN, so a deploy that lost the variable
# could turn everybody's passkeys off and nothing would say so. Passing every
# parameter explicitly on every deploy is what stops that.
# An array, not a word-split string: a value with a space becomes an error
# from sam rather than a silently malformed override.
PARAMS=("StageName=$STAGE")
if [ -n "${WEBAUTHN_RP_ID:-}" ]; then
  PARAMS+=("WebAuthnRelyingPartyId=$WEBAUTHN_RP_ID")
fi
# The custom domain. Same rule: passed every deploy, empty meaning none, so a
# stack that once had a domain loses it only when a deploy says so on purpose
# rather than because a variable went missing. Unset is the cloudfront.net
# domain, which is what staging and dev want.
# An empty value has to be written as a quoted empty string (`Name=""`): sam
# rejects a bare `Name=` as "not a valid format".
PARAMS+=("AppDomainName=${APP_DOMAIN_NAME:-\"\"}" "AppHostedZoneId=${APP_HOSTED_ZONE_ID:-\"\"}")
# "It's your turn" pushes (#466). Same rule: passed every deploy, so a stack
# that had them on turns them off only when a deploy says so. Anything but
# `on` is off; the subject is the contact the push services see.
if [ "${KAD_PUSH:-}" = "on" ]; then PUSH_MODE=on; else PUSH_MODE=off; fi
PARAMS+=("PushNotifications=$PUSH_MODE" "PushContact=${KAD_PUSH_SUBJECT:-\"\"}")
# Family-session timing (#511): on by default and operator-only; `KAD_TIMING=off` records nothing.
if [ "${KAD_TIMING:-on}" = "off" ]; then TIMING_MODE=off; else TIMING_MODE=on; fi
PARAMS+=("SessionTiming=$TIMING_MODE")
# Where the alarms post (docs/deploy.md "Alarms, and where they go"). Same
# rule: passed every deploy, empty meaning nobody is subscribed, so a stack
# that posts to Slack stops only when a deploy says so on purpose.
PARAMS+=("AlarmSlackWorkspaceId=${ALARM_SLACK_WORKSPACE_ID:-\"\"}" "AlarmSlackChannelId=${ALARM_SLACK_CHANNEL_ID:-\"\"}")

# Whether sam stops to show the changeset. CI never does: nobody is there.
# Prod from a laptop always does, whatever samconfig says for `prod` (which
# is written for the workflow): a person is about to change the families'
# stack by hand and should see what changes. Otherwise samconfig decides.
CONFIRM=()
if [ -n "${CI:-}" ]; then
  CONFIRM=(--no-confirm-changeset)
elif [ "$STAGE" = "prod" ]; then
  CONFIRM=(--confirm-changeset)
fi

sam deploy \
  --template-file infra/template.yaml \
  --config-file "$ROOT/infra/samconfig.toml" \
  --config-env "$CONFIG_ENV" \
  --parameter-overrides "${PARAMS[@]}" \
  --no-fail-on-empty-changeset \
  ${CONFIRM[@]+"${CONFIRM[@]}"}

BUCKET="$(outputs SiteBucketName)"
DISTRIBUTION="$(outputs DistributionId)"
SITE_URL="$(outputs SiteUrl)"

if [ -z "$BUCKET" ] || [ "$BUCKET" = "None" ]; then
  echo "error: could not read SiteBucketName from stack $STACK" >&2
  exit 1
fi

# A first deploy: there was no site to ask until now.
if [ "$VOICE_CHECKED" = "0" ]; then
  voice_clips_on_site
fi

say "Uploading to $BUCKET"

# Hashed filenames, so they can be cached until the heat death of the universe.
#
# Added to, never synced with `--delete`: the previous build's files are still
# what the page being served right now names, and what a phone that has it open
# will ask for when it first shows a lazy screen. Deleting them here, before
# the new index.html is even up, was a window of 404s on every deploy. The
# prune after the invalidation removes only files no build has shipped for
# weeks (tools/deploy/stale-bundles.ts).
aws s3 sync packages/client/dist/bundle "s3://$BUCKET/bundle" \
  --cache-control "public,max-age=31536000,immutable"

# Art and content are *not* hashed — they are versioned by the manifest and by
# git. Short cache plus the invalidation below, so a new chapter is live in
# seconds rather than whenever a phone decides to re-check.
# assets/ was checked against assets.lock.json at the top of this script.
#
# That short age is the browser's (max-age). The edge keeps each file for a year
# (s-maxage): the invalidation below is what tells it a deploy changed something,
# so it has no reason to go back to S3 for every painting every five minutes,
# which is what made the first request for most pictures of an evening an edge
# miss. The service worker checks each file's fingerprint itself (sw.ts).
ASSETS_CACHE="public,max-age=300,s-maxage=31536000"
CONTENT_CACHE="public,max-age=60,s-maxage=31536000"
aws s3 sync assets "s3://$BUCKET/assets" --delete --cache-control "$ASSETS_CACHE"
aws s3 sync content "s3://$BUCKET/content" --delete --cache-control "$CONTENT_CACHE"

# `sync` sets that header only on what it uploads, and it uploads only what is
# missing or changed: every painting and chapter already in the bucket keeps
# the header it went up with. So when the header a prefix should have is not
# the one this bucket was last given, each object under it is copied onto
# itself with the new one (tools/deploy/cache-migration.ts). Once: the header
# is then written to a marker in the bucket, and a deploy that finds it there
# copies nothing. A different header later is a different marker, and migrates
# again. Never fatal: the site is already up, a failed copy leaves an object on
# its old header and the marker unwritten, and the next deploy tries again.
#
# A copy that replaces metadata keeps only what it names. `sync` gave these
# objects a Content-Type and a Cache-Control and nothing else, so each
# extension is copied with the Content-Type one of its objects has now.
migrate_cache_control() {
  local prefix="$1" wanted="$2"
  local marker=".deploy/cache-control/$prefix"
  local have
  have="$(aws s3 cp "s3://$BUCKET/$marker" - 2>/dev/null || true)"
  if [ "$have" = "$wanted" ]; then
    return 0
  fi
  say "Giving $prefix/ its new Cache-Control ($wanted)"
  local kinds
  if ! kinds="$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$prefix/" --output json \
        | node tools/deploy/cache-migration.ts)"; then
    echo "warning: could not list $prefix/; its objects keep their old Cache-Control until the next deploy" >&2
    return 0
  fi
  local failed=0 extension sample type
  while IFS=$'\t' read -r extension sample; do
    sample="${sample%$'\r'}"
    [ -n "$extension" ] && [ -n "$sample" ] || continue
    type="$(aws s3api head-object --bucket "$BUCKET" --key "$sample" --query ContentType --output text 2>/dev/null || true)"
    if [ -z "$type" ] || [ "$type" = "None" ]; then
      echo "warning: no Content-Type on $sample; .$extension files under $prefix/ keep their old Cache-Control" >&2
      failed=1
      continue
    fi
    if ! aws s3 cp "s3://$BUCKET/$prefix/" "s3://$BUCKET/$prefix/" --recursive \
          --exclude "*" --include "*.$extension" \
          --metadata-directive REPLACE --content-type "$type" --cache-control "$wanted" \
          --only-show-errors; then
      echo "warning: could not rewrite the .$extension files under $prefix/" >&2
      failed=1
    fi
  done <<< "$kinds"
  if [ "$failed" = "0" ]; then
    printf '%s' "$wanted" | aws s3 cp - "s3://$BUCKET/$marker" --content-type "text/plain" --cache-control "no-cache" >/dev/null \
      || echo "warning: could not write $marker; the next deploy will rewrite $prefix/ again" >&2
  fi
}
migrate_cache_control assets "$ASSETS_CACHE"
migrate_cache_control content "$CONTENT_CACHE"

# Everything else in the client build — index.html above all, which must never
# be cached or a deploy leaves phones on the previous bundle.
aws s3 sync packages/client/dist "s3://$BUCKET" \
  --exclude "bundle/*" \
  --exclude "manifest.webmanifest" \
  --cache-control "no-cache"

# The install manifest (epic #410), by itself: `s3 sync` guesses types from
# the extension, and an unknown one would go up as binary/octet-stream, which
# browsers decline to read as a manifest.
aws s3 cp packages/client/dist/manifest.webmanifest "s3://$BUCKET/manifest.webmanifest" \
  --content-type "application/manifest+json" \
  --cache-control "no-cache"

say "Invalidating CloudFront"
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION" \
  --paths "/*" \
  --query "Invalidation.Id" \
  --output text

# Last, and never fatal: the site is already live, and a file that outlives
# its welcome costs a fraction of a cent. Only keys under bundle/ that this
# build does not ship and that were uploaded more than two weeks ago.
say "Pruning old bundle files"
if stale="$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix bundle/ --output json \
      | node tools/deploy/stale-bundles.ts packages/client/dist/bundle)"; then
  pruned=0
  while IFS= read -r key; do
    key="${key%$'\r'}"
    [ -n "$key" ] || continue
    case "$key" in
      bundle/*) ;;
      *) echo "warning: not deleting $key (outside bundle/)" >&2; continue ;;
    esac
    if aws s3api delete-object --bucket "$BUCKET" --key "$key" >/dev/null; then
      pruned=$((pruned + 1))
    else
      echo "warning: could not delete $key" >&2
    fi
  done <<< "$stale"
  echo "  removed $pruned"
else
  echo "warning: could not work out which bundle files are stale; none removed" >&2
fi

printf "\n\033[1;32m  %s is live at %s\033[0m\n\n" "$STACK" "$SITE_URL"

# The chicken-and-egg from the template: passkeys are bound to a domain, and the
# domain does not exist until the first deploy has created the distribution.
if [ -z "$(aws cognito-idp describe-user-pool \
      --user-pool-id "$(outputs UserPoolId)" \
      --query 'UserPool.Policies.SignInPolicy.AllowedFirstAuthFactors[?@==`WEB_AUTHN`]' \
      --output text 2>/dev/null)" ]; then
  cat <<EOF
  Passkeys are off. Sign-in works today by emailed code; to add one-tap sign-in,
  deploy once more with the domain passkeys should be bound to:

    sam deploy --config-env $CONFIG_ENV \\
      --parameter-overrides "WebAuthnRelyingPartyId=${SITE_URL#https://}"

EOF
fi
