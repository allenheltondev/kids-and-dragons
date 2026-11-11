#!/usr/bin/env bash
#
# Creates the asset store, or brings it up to date (docs/asset-store.md).
#
#   ./scripts/deploy-asset-store.sh
#
# The production deploy runs this after the site has shipped
# (.github/workflows/prod-deploy.yml). Nobody stands the store up by hand: a
# merge to main is what creates it, and what changes it afterwards. There is
# one store for every stage, so this takes no environment.
#
# The store's address is declared, not discovered. `storeUrl` in
# assets.config.json is what every clone, CI job and deploy pulls from, so it
# has to be in the repo before the stack exists and cannot be a stack output
# someone copies back. This reads the host out of `storeUrl`, has the stack
# issue the certificate and the DNS records for it, and then fails unless
#
#   1. the stack says it serves at exactly that URL, and
#   2. that URL answers the way a healthy store does.
#
# Three things it is careful about:
#
#   - It runs after the site deploy, never before. A store that will not
#     deploy must not keep a fix from reaching the families; it fails the run,
#     which is loud enough.
#   - It never deploys an older template over a newer one. A rollback deploy
#     ships an old commit of the *site*; the workflow skips this step then.
#   - A first create that failed and rolled back leaves a stack that can only
#     be deleted. This deletes it and tries again, so one bad first run (a
#     missing permission on the deploy role, usually) needs no clean-up by
#     hand. The bucket is RetainExceptOnCreate, so the rollback took it too.
#
# Plain bash, aws and node, and no node_modules: the production deploy ships
# CI's build and never runs npm ci.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf "\n\033[1;36m==> %s\033[0m\n" "$1"; }
die() { echo "error: $1" >&2; exit 1; }

# From a laptop this changes the one copy of the art's home with whatever
# template the working tree holds. The pipeline is the way; this is the
# evening the pipeline itself is broken.
if [ -z "${CI:-}" ] && [ "${KAD_DEPLOY_ANYWAY:-}" != "1" ]; then
  echo "error: refusing to deploy the asset store from this checkout." >&2
  echo "       The production deploy creates and updates it when CI passes on main." >&2
  echo "       To deploy this checkout's template regardless, set KAD_DEPLOY_ANYWAY=1." >&2
  exit 1
fi

for tool in aws node curl; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed"
done

# One key of assets.config.json, or nothing when it is null or absent.
config() {
  node -e '
    const c = JSON.parse(require("fs").readFileSync("assets.config.json", "utf8"));
    const v = c[process.argv[1]];
    process.stdout.write(v === null || v === undefined ? "" : String(v));
  ' "$1"
}

STACK="$(config stack)"
REGION="$(config region)"
STORE_URL="$(config storeUrl)"
STACK="${STACK:-kad-asset-store}"
REGION="${REGION:-us-east-1}"
# The stack that owns the alarm topic the store's budget alerts to (#733).
ALARM_STACK="${KAD_ALARM_STACK:-kad-prod}"

[ -n "$STORE_URL" ] || die 'assets.config.json has no storeUrl. Declare the address the store serves at, e.g. "https://assets.example.org"; the stack is built to match it.'
case "$STORE_URL" in
  https://*) ;;
  *) die "storeUrl must be an https:// URL, not $STORE_URL" ;;
esac
STORE_URL="${STORE_URL%/}"
DOMAIN="${STORE_URL#https://}"
case "$DOMAIN" in
  */*) die "storeUrl must be a bare host with no path: $STORE_URL" ;;
esac

# A host of our own needs the zone that holds it. A *.cloudfront.net host is
# the CDN's generated one (a fork with no domain): nothing to issue or point.
ZONE=""
case "$DOMAIN" in
  *.cloudfront.net) DOMAIN="" ;;
  *)
    ZONE="${APP_HOSTED_ZONE_ID:-}"
    [ -n "$ZONE" ] || die "storeUrl is $STORE_URL, so APP_HOSTED_ZONE_ID must name the Route 53 zone that holds it."
    ;;
esac

# Text of one describe-stacks query, "" when the stack does not exist, and a
# failed run for anything else. A throttle or a missing permission must not
# read as "no such stack": that would drop the budget's subscriber, and with
# it the budget, on the next line.
stack_field() {
  local stack="$1" query="$2" out
  if out="$(aws cloudformation describe-stacks --stack-name "$stack" --region "$REGION" \
        --query "$query" --output text 2>&1)"; then
    [ "$out" = "None" ] && out=""
    printf '%s' "$out"
  elif printf '%s' "$out" | grep -q "does not exist"; then
    printf ''
  else
    echo "error: could not read stack $stack: $out" >&2
    return 1
  fi
}

say "The asset store ($STACK) at $STORE_URL"

STATUS="$(stack_field "$STACK" "Stacks[0].StackStatus")"
if [ "$STATUS" = "ROLLBACK_COMPLETE" ]; then
  say "Its first create failed and rolled back; removing the empty stack to try again"
  aws cloudformation delete-stack --stack-name "$STACK" --region "$REGION"
  aws cloudformation wait stack-delete-complete --stack-name "$STACK" --region "$REGION"
  STATUS=""
fi
if [ -z "$STATUS" ]; then
  echo "  No stack yet: this run creates it (a certificate and a CDN take a few minutes)."
fi

# Where the budget alerts (#733). No subscriber means no budget, so "there is
# no topic" is only an answer when there is no production stack to have one
# (an account that has only ever had a store). A production stack that is
# there and names no topic is a broken read or a broken stack, and deploying
# on it would quietly delete the budget the store already has.
# Assigned on its own line, never inside the test: a read that fails must end
# the run (set -e), and inside `[ -z "$(...)" ]` it would read as "no stack".
ALARM_TOPIC=""
ALARM_STACK_STATUS="$(stack_field "$ALARM_STACK" "Stacks[0].StackStatus")"
if [ -z "$ALARM_STACK_STATUS" ]; then
  echo "  There is no $ALARM_STACK stack to alert, so the store gets no budget on this run."
else
  ALARM_TOPIC="$(stack_field "$ALARM_STACK" "Stacks[0].Outputs[?OutputKey=='AlarmTopicArn'].OutputValue | [0]")"
  [ -n "$ALARM_TOPIC" ] || die "$ALARM_STACK exists but has no AlarmTopicArn output. Deploying the store without it would remove the store's budget, so nothing was deployed."
fi

# Every parameter, every time: one this run did not name would keep whatever
# the last run gave it, and the repo would stop saying what the stack is.
PARAMS=(
  "StoreDomainName=$DOMAIN"
  "HostedZoneId=$ZONE"
  "AlarmTopicArn=$ALARM_TOPIC"
  "MonthlyBudgetUsd=${ASSET_STORE_BUDGET_USD:-10}"
)

if ! aws cloudformation deploy \
  --template-file infra/asset-store.yaml \
  --stack-name "$STACK" \
  --region "$REGION" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides "${PARAMS[@]}"; then
  echo "error: the asset store did not deploy. What CloudFormation refused:" >&2
  aws cloudformation describe-stack-events --stack-name "$STACK" --region "$REGION" \
    --query "StackEvents[?contains(ResourceStatus, 'FAILED')] | [:15].[LogicalResourceId, ResourceStatus, ResourceStatusReason]" \
    --output table >&2 || true
  echo "       A refused action usually means the deploy role lacks it (docs/asset-store.md, \"What the deploy role needs\")." >&2
  exit 1
fi

# The two halves of "declared, not discovered".
SERVES="$(stack_field "$STACK" "Stacks[0].Outputs[?OutputKey=='StoreUrl'].OutputValue | [0]")"
if [ "$SERVES" != "$STORE_URL" ]; then
  die "assets.config.json says the store is at $STORE_URL, but the stack serves at ${SERVES:-nothing}. Change storeUrl to match, or the stack's domain."
fi

# The root of a healthy store is a 403: the CDN reached the bucket, and the
# bucket lets it read blobs but list nothing. That one answer proves the name
# resolves, the certificate is good, the CDN is up and the bucket is there.
# Nothing else counts. A 5xx is the CDN or the bucket failing, a 404 is a
# bucket that is not there, and neither is a store anyone can pull from. (That
# every blob in the lock can be fetched is checked where the lock is read:
# `assets:verify` in CI, and the pull at the top of deploy.sh.)
#
# A brand-new record or distribution can take a minute, so it is asked again.
say "Asking $STORE_URL to answer"
answered=0
code="000"
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  code="$(curl -sS -o /dev/null -m 20 -w '%{http_code}' "$STORE_URL/" 2>/dev/null)" || code="000"
  case "$code" in
    200|403)
      echo "  It answers as a healthy store does (HTTP $code)."
      answered=1
      break
      ;;
  esac
  [ "$attempt" = "12" ] || sleep "${KAD_STORE_PROBE_WAIT:-10}"
done
if [ "$answered" != "1" ]; then
  if [ "$code" = "000" ]; then
    die "$STORE_URL does not answer. The stack deployed, but nothing can pull from the address the repo names."
  fi
  die "$STORE_URL answers HTTP $code, which is not a healthy store (its root is a 403). The stack deployed, but nothing can pull from the address the repo names."
fi

printf "\n\033[1;32m  The asset store is up to date at %s\033[0m\n\n" "$STORE_URL"
