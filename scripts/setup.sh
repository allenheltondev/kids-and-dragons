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
# tools/art/verify.py and tools/art/sheet.py need exactly these two. The verifier
# prints the same pip line on ImportError; keep the two in step.
PY=$(command -v python3 || true)
if [ -z "$PY" ]; then
  warn "python3 not found — 'npm run art:verify' and 'npm run art:sheet' will not run"
elif "$PY" -c 'import PIL, numpy' >/dev/null 2>&1; then
  say "art dependencies already installed (pillow, numpy)"
else
  say "installing art dependencies (pillow, numpy)"
  # Debian-style images mark the system interpreter externally-managed; fall back
  # rather than failing the whole session over an art tool.
  "$PY" -m pip install --quiet --disable-pip-version-check pillow numpy \
    || "$PY" -m pip install --quiet --disable-pip-version-check --user pillow numpy \
    || "$PY" -m pip install --quiet --disable-pip-version-check --break-system-packages pillow numpy \
    || warn "could not install pillow/numpy — the art commands will explain what is missing"
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
