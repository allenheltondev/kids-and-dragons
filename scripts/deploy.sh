#!/usr/bin/env bash
#
# One command to prod — roadmap Chapter 0.
#
#   ./scripts/deploy.sh              → the prod stack
#   ./scripts/deploy.sh dev          → the dev stack
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

set -euo pipefail

CONFIG_ENV="${1:-default}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for tool in sam aws node npm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool is not installed" >&2; exit 1; }
done

case "$CONFIG_ENV" in
  default|prod) STACK="kad-prod" ;;
  dev)          STACK="kad-dev" ;;
  *) echo "error: unknown environment '$CONFIG_ENV' (expected 'dev' or 'prod')" >&2; exit 1 ;;
esac

say() { printf "\n\033[1;36m==> %s\033[0m\n" "$1"; }

# ---------------------------------------------------------------------------

say "Checks"
# The two cross-cutting rules only CI and this script enforce: content is
# validated before it can be deployed, and the art contract is mechanical.
npm run typecheck
npm test
npm run content:validate
npm run art:verify

say "Bundling Lambdas"
node infra/build.mjs

say "Deploying the stack ($STACK)"
sam deploy \
  --template-file infra/template.yaml \
  --config-file "$ROOT/infra/samconfig.toml" \
  --config-env "$CONFIG_ENV" \
  --no-fail-on-empty-changeset

outputs() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK" \
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

say "Building the client"
npm run build

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
