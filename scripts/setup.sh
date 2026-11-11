#!/usr/bin/env bash
#
# Kids & Dragons — one-command environment setup.
#
#   ./scripts/setup.sh       (or, anywhere, bash or not: npm run setup)
#
# The work is in scripts/setup.mjs, which runs wherever Node does. This file is the
# name Claude Code's SessionStart hook (.claude/settings.json) and older notes call.

set -euo pipefail

exec node "$(dirname "${BASH_SOURCE[0]}")/setup.mjs" "$@"
