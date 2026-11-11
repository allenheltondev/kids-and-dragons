# Kids & Dragons: instructions for agents

**Read [CLAUDE.md](CLAUDE.md) first.** It is this repository's instructions for every agent, not
only Claude: the commands, how content is validated, the house rules for writing chapters, and
how the art and audio are stored. Everything there applies to you. This file adds only what an
agent that is not Claude Code needs on top of it.

## Setting up

- Run `npm run setup` once per fresh checkout. It installs the Node and Python dependencies,
  registers the git merge driver for `assets.lock.json`, and, once the art lives in the asset
  store, pulls `assets/` onto disk. It needs only Node, so it runs the same in PowerShell, cmd
  and bash; `scripts/setup.sh` is the same thing for a shell that has bash.
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
   waits for the user's approval. Other art does not. After the cutover, CI fails the PR until
   the user labels it `art-approved`; never add that label yourself.
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

What to do when `assets:push` refuses depends on which refusal it is:

- **"The art is still in git"** means there is no `assets.lock.json` yet: the cutover has not
  happened. Nothing is wrong. Commit the approved image with its prompt record, as step 5 above
  says.
- **No key** (or no AWS credentials) after the cutover: stop. Leave the files on disk, and report
  which paths need storing. Do not commit the images instead; `assets:verify` fails CI on them.
