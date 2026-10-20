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

say "ready"
cat <<'EOF'
  npm run typecheck          tsc across shared, server, client
  npm test                   vitest
  npm run content:validate   schemas + scene graphs  (tools/content/validate.mjs)
  npm run art:verify         the art gate            (tools/art/verify.py)
  npm run art:sheet          contact sheets for review -> art/review/
  npm run dev                server + client
EOF
