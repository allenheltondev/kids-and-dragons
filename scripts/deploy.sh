#!/usr/bin/env bash
#
# One command to prod — roadmap Chapter 0.
#
#   ./scripts/deploy.sh              → the prod stack
#   ./scripts/deploy.sh staging      → the staging stack
#   ./scripts/deploy.sh dev          → a stack you drive by hand
#
# `.github/workflows/deploy.yml` calls this same script — staging on every pull
# request, prod on every push to main — so what runs from a laptop and what runs
# from CI are the same steps in the same order, and there is no deploy path that
# is only ever exercised by one of them.
#
# Order matters and is not arbitrary:
#
#   1. the checks, because a broken chapter must fail here and never at the table
#   2. the Lambda bundles, because the stack's CodeUri directories are their output
#   3. the stack, because the bucket and distribution it creates are where step 4 goes
#   4. the client, art, and content
#   5. an invalidation, because CloudFront is still holding the previous index.html
#
# Uploading the SPA *after* the stack means a deploy that fails at step 3 leaves
# the previous version serving, rather than a new bundle talking to an API that
# does not exist yet.
#
# KAD_PREBUILT=1 turns this into a ship-only run: steps 2 and 4's build halves
# are skipped and whatever is already in infra/.build/ and packages/client/dist/
# is deployed as-is. The prod workflow sets it after downloading CI's build
# artifact, so production ships the exact bytes CI tested. The ordering above
# still holds — both directories are *verified* up front, before sam deploy, so
# a ship with no artifact fails before it can push empty CodeUris at the stack.
# Never set it by hand unless you have just put a real build in both places.

set -euo pipefail

CONFIG_ENV="${1:-default}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The stack lives in us-east-1 (infra/samconfig.toml). CI exports AWS_REGION;
# a laptop may not, and without it `describe-stacks` silently reads the
# profile's default region and reports a stack that deployed fine as missing.
export AWS_REGION="${AWS_REGION:-us-east-1}"

for tool in sam aws node npm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool is not installed" >&2; exit 1; }
done

case "$CONFIG_ENV" in
  default|prod) STACK="kad-prod";    STAGE="prod" ;;
  staging)      STACK="kad-staging"; STAGE="staging" ;;
  dev)          STACK="kad-dev";     STAGE="dev" ;;
  *) echo "error: unknown environment '$CONFIG_ENV' (expected dev, staging or prod)" >&2; exit 1 ;;
esac

say() { printf "\n\033[1;36m==> %s\033[0m\n" "$1"; }

# ---------------------------------------------------------------------------

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
  npm run art:verify:rig
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
fi

say "Deploying the stack ($STACK)"

# Every parameter, every time.
#
# `sam deploy` does not carry previous values forward: a parameter left out of
# `--parameter-overrides` reverts to the template default. That is quiet and
# specific here — WebAuthnRelyingPartyId defaults to empty, and empty means
# `AllowedFirstAuthFactors` drops WEB_AUTHN, so an automated deploy would turn
# everybody's passkeys off and nothing would say so. Passing it explicitly on
# every deploy is what stops that.
# An array, not a word-split string: a value with a space becomes an error
# from sam rather than a silently malformed override.
PARAMS=("StageName=$STAGE")
if [ -n "${WEBAUTHN_RP_ID:-}" ]; then
  PARAMS+=("WebAuthnRelyingPartyId=$WEBAUTHN_RP_ID")
fi

sam deploy \
  --template-file infra/template.yaml \
  --config-file "$ROOT/infra/samconfig.toml" \
  --config-env "$CONFIG_ENV" \
  --parameter-overrides "${PARAMS[@]}" \
  --no-fail-on-empty-changeset \
  ${CI:+--no-confirm-changeset}

outputs() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK" \
    --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
    --output text
}

BUCKET="$(outputs SiteBucketName)"
DISTRIBUTION="$(outputs DistributionId)"
SITE_URL="$(outputs SiteUrl)"

if [ -z "$BUCKET" ] || [ "$BUCKET" = "None" ]; then
  echo "error: could not read SiteBucketName from stack $STACK" >&2
  exit 1
fi

if [ "${KAD_PREBUILT:-}" = "1" ]; then
  say "Building the client — skipped (KAD_PREBUILT=1: shipping the verified artifact)"
else
  say "Building the client"
  npm run build
fi

say "Uploading to $BUCKET"

# Hashed filenames, so they can be cached until the heat death of the universe.
aws s3 sync packages/client/dist/bundle "s3://$BUCKET/bundle" \
  --delete \
  --cache-control "public,max-age=31536000,immutable"

# Art and content are *not* hashed — they are versioned by the manifest and by
# git. Short cache plus the invalidation below, so a new chapter is live in
# seconds rather than whenever a phone decides to re-check.
aws s3 sync assets "s3://$BUCKET/assets" --delete --cache-control "public,max-age=300"
aws s3 sync content "s3://$BUCKET/content" --delete --cache-control "public,max-age=60"

# Everything else in the client build — index.html above all, which must never
# be cached or a deploy leaves phones on the previous bundle.
aws s3 sync packages/client/dist "s3://$BUCKET" \
  --exclude "bundle/*" \
  --cache-control "no-cache"

say "Invalidating CloudFront"
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION" \
  --paths "/*" \
  --query "Invalidation.Id" \
  --output text

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
