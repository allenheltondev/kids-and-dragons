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

# --- The Rive CLI (optional) -------------------------------------------------
# The rig builder and the rest/motion gates drive rive-mcp's CLI, built from a
# *private* repo at the commit pinned in art/rig/rive-mcp.pin.json — see
# tools/art/setup-rive.mjs. A fresh web session has no token for that repo and
# a laptop may have no network, and neither should cost anyone the rest of this
# script: everything above works without it, so this is the one step that warns
# instead of failing. RIVE_MCP_TOKEN (a read-only PAT) or KAD_RIVE_SRC (a
# checkout you already have) makes it succeed. Fast once done: a stat and a
# `git rev-parse`.
if [ -n "${KAD_SKIP_RIVE_SETUP:-}" ]; then
  say "skipping the Rive CLI (KAD_SKIP_RIVE_SETUP is set)"
elif node tools/art/setup-rive.mjs; then
  :
else
  warn "the Rive CLI is not set up — 'npm run art:rig:build', 'art:verify:rig:rest' and 'art:verify:rig:motion' need it. Set RIVE_MCP_TOKEN (or KAD_RIVE_SRC=/path/to/rive-mcp) and run 'npm run art:rig:setup'."
fi

say "ready"
cat <<'EOF'
  npm run typecheck          tsc across shared, server, client
  npm test                   vitest
  npm run content:validate   schemas + scene graphs  (tools/content/validate.mjs)
  npm run art:verify         the art gate            (tools/art/verify.py)
  npm run art:sheet          contact sheets for review -> art/review/
  npm run art:rig:setup      the Rive CLI at the pin -> .rive-mcp/  (tools/art/setup-rive.mjs)
  npm run art:rig:build      rebuild the rigs; --check proves the committed ones
  npm run dev                server + client
EOF
