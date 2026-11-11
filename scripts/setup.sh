#!/usr/bin/env bash
#
# Kids & Dragons — one-command environment setup.
#
# Installs everything the checks in .github/workflows/ci.yml need, so a fresh
# machine (or a fresh Claude Code web session, via the SessionStart hook in
# .claude/settings.json) can run the tests, the content validator, and the art
# gate without anybody hunting for the right incantation.
#
#   ./scripts/setup.sh
#
# Idempotent: safe to run on every session start. Node deps go through
# `npm install`, which is a near no-op when node_modules is already warm;
# Python deps are skipped entirely when they already import.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarn\033[0m %s\n' "$*" >&2; }

# --- Node -------------------------------------------------------------------
# The workspaces (packages/shared, server, client) install from the root.
if [ -d node_modules ] && [ package-lock.json -ot node_modules ]; then
  say "node dependencies already installed"
else
  say "installing node dependencies"
  npm install --no-audit --no-fund
fi

# --- Python -----------------------------------------------------------------
# requirements-dev.txt is the one list — pillow and numpy for tools/art/, and
# cfn-lint for `npm run infra:lint`. The same file feeds every pip install in
# .github/workflows/, so a laptop and CI cannot drift apart.
PY=$(command -v python3 || true)
if [ -z "$PY" ]; then
  warn "python3 not found — 'npm run art:verify', 'npm run art:sheet', and 'npm run infra:lint' will not run"
elif "$PY" -c 'import PIL, numpy, cfnlint' >/dev/null 2>&1; then
  say "python dev dependencies already installed (pillow, numpy, cfn-lint)"
else
  say "installing python dev dependencies (requirements-dev.txt)"
  # Debian-style images mark the system interpreter externally-managed; fall back
  # rather than failing the whole session over dev tooling.
  "$PY" -m pip install --quiet --disable-pip-version-check -r requirements-dev.txt \
    || "$PY" -m pip install --quiet --disable-pip-version-check --user -r requirements-dev.txt \
    || "$PY" -m pip install --quiet --disable-pip-version-check --break-system-packages -r requirements-dev.txt \
    || warn "could not install requirements-dev.txt — the art commands will explain what is missing"
fi

# --- The asset store ----------------------------------------------------------
# docs/asset-store.md. The lock merges by path rather than by line, so two agents
# adding art to one folder never conflict. git reads merge drivers only from
# local config, never from the repo, so each clone registers it here.
if git rev-parse --git-dir >/dev/null 2>&1; then
  git config merge.kad-assets-lock.name "asset lock, merged by path (tools/assets/merge-lock.ts)"
  git config merge.kad-assets-lock.driver "node tools/assets/merge-lock.ts %O %A %B"
fi
# Once the art lives in the store, a fresh checkout has none of it. Pull the game's
# art (what the tests, the art gate and the dev server read); `npm run assets:pull`
# with no arguments also brings art/ and the docs' screenshots. Never fatal: the
# dev server fetches what is missing on demand. NODE_USE_ENV_PROXY lets node's
# fetch use HTTPS_PROXY where a sandbox requires one. KAD_SKIP_ASSET_PULL=1 skips it.
if [ -f assets.lock.json ] && [ "${KAD_SKIP_ASSET_PULL:-}" != "1" ]; then
  say "pulling the game's art from the asset store"
  NODE_USE_ENV_PROXY=1 node tools/assets/cli.ts pull assets \
    || warn "could not pull the art (npm run assets:pull); the tests and art:verify need it on disk"
fi

say "ready"
cat <<'EOF'
  npm run typecheck          tsc across shared, server, client
  npm test                   vitest
  npm run content:validate   schemas + scene graphs  (tools/content/validate.mjs)
  npm run art:verify         the art gate            (tools/art/verify.py)
  npm run art:sheet          contact sheets for review -> art/review/
  npm run assets:push        new or changed art/audio -> the S3 asset store (docs/asset-store.md)
  npm run dev                server + client
EOF
