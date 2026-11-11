# Kids & Dragons: instructions for agents

**Read [CLAUDE.md](CLAUDE.md) first.** It is this repository's instructions for every agent, not
only Claude: the commands, how content is validated, the house rules for writing chapters, and
how the art and audio are stored. Everything there applies to you. This file adds only what an
agent that is not Claude Code needs on top of it.

## Setting up

- Run `scripts/setup.sh` once per fresh checkout. It installs the Node and Python dependencies,
  registers the git merge driver for `assets.lock.json`, and, once the art lives in the asset
  store, pulls `assets/` onto disk.
- If your environment did not run it, nothing in `assets/` may be on disk. Before reading,
  checking or replacing any art, run `npm run assets:pull` (add `-- art` or `-- docs` when you need
  those). `art:inventory` and `art:verify` refuse to run on a tree that has not pulled.

## Making art

Art work is scoped in GitHub issues titled **`Art: …`** (or `Art brief: …`). Follow the
**art-creation** skill, [.agents/skills/art-creation/SKILL.md](.agents/skills/art-creation/SKILL.md),
from the issue to the asset store. In short:

1. Start from the art issue you were given. Read its Format, checklist, owner decisions and
   "Done when".
2. Generate with the imagegen skill into `staging/`. Keep the untouched original under
   `art/source/originals/<issue>/`.
3. Fit the image to its contract, then run `npm run art:verify` and the kind's tests.
4. **Character art** (`assets/characters/`, `assets/character-rigs/`, `assets/gear-portraits/`)
   waits for the user's approval. Other art does not.
5. Store it with `npm run assets:push -- --issue <n> <folder>`, then commit `assets.lock.json` and
   the prompt record, never the image files. **Before the cutover** (no `assets.lock.json` at the
   repo root yet), the art is still in git: commit the approved image with its prompt record, as
   the skill's step 5 says.

## Writing to the asset store from a sandbox

You upload through the project's MCP server, not with AWS credentials
([docs/mcp-server.md](docs/mcp-server.md)). The environment provides:

- `KAD_ASSET_WRITER=mcp`, so `assets:push` asks the MCP server for upload URLs;
- a key with `assets:write`, either as `KAD_MCP_TOKEN` or as a network secret the sandbox's proxy
  adds for `kd.readysetcloud.io`;
- `NODE_USE_ENV_PROXY=1` where the sandbox needs a proxy.

If `assets:push` says it has no key, or that the repository's art is still in git (before the
cutover), stop. Report which paths need storing, and leave the files on disk. Do not commit
images instead.
