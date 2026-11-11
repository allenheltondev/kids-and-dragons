---
name: art-creation
description: "Make, deliver or replace Kids & Dragons game art (cast, entities, scenes, story plates, camp pieces, key art, props, icons, frames) with the imagegen skill, from finding what is owed through review to the asset store. Use for any new or repainted image under assets/. Not for UI code, chapter writing, or audio."
---

# Art creation

The game finds art by path, checks it against a contract, and ships it from the S3 asset
store. A painting that looks right but sits at the wrong path, the wrong size or with a
background where alpha belongs is invisible or broken at the table. This skill is the
order of operations that keeps that from happening. It does not replace the docs; it says
which to read and when.

Generate with the **imagegen** skill. Everything else here (contracts, review, upload,
records) is this repository's.

## 1. Find the work and its contract

Run `npm run art:inventory`. It is the queue: every category, how much is delivered, and
under **Outstanding** the exact paths still owed. Its note under each category names the
contract doc to read.

- **Owed art is already declared.** The inventory derives what is owed *from*
  `assets/manifest.json`, so an owed path already has its manifest entry. Delivering the file
  is the whole job; do not edit the manifest for it.
- **New art is declared first.** A new cast member, plate or camp piece is added to the
  manifest (and to the content that uses it) *before* it is painted, following that
  category's doc. Then it shows as owed, and the rest of this skill delivers it.
- **The path comes from the contract, never from you.** Characters, figures, cast and
  entities follow the conventions in `packages/client/src/world/art-paths.ts`
  (`assets/cast/<id>/assembled.png`, `assets/entities/<id>/assembled.png`, …); everything
  else is the path the manifest names.

Read the contract before writing a prompt. The main ones:

| Kind | Contract |
|---|---|
| Characters, class figures, NPC and enemy cutouts | [docs/art-pipeline.md](../../../docs/art-pipeline.md): RGBA 1024 x 1024, feet at (512, 900) |
| Camp backdrops, pieces, tents, decorations | `assets/manifest.json` → `camp`, [docs/briefs/camp.md](../../../docs/briefs/camp.md) |
| Story plates (prologue, chapter, epilogue) | [docs/story-plates.md](../../../docs/story-plates.md): 1600 x 900 |
| Hero looks, coat masks, nameplate frames | [docs/hero-looks.md](../../../docs/hero-looks.md) |
| Anything else | the category's note in `art:inventory`, and [docs/asset-brief.md](../../../docs/asset-brief.md) |

## 2. Write the prompt, and keep it

Model the prompt on the existing records in `docs/*-prompts.json` for the same kind (for
example `docs/camp-art-prompts.json`, `docs/story-plates-prompts.json`,
`docs/campaign-key-art-prompts.json`). They carry the house style and the composition rules
that kind needs: where the ground line falls, what the top quarter may hold, what must be
transparent. Reuse their wording; the consistency is the point.

Record every painting you deliver in a prompts file for its kind, in the existing shape:

```json
{
  "issue": 123,
  "mode": "imagegen",
  "useCase": "illustration-story",
  "output": { "width": 1600, "height": 900, "format": "WebP", "opaque": true, "encoding": "RGB, Lanczos resize, WebP quality 90 method 6" },
  "paintings": [{ "id": "…", "path": "assets/…", "prompt": "Use case: illustration-story. …" }]
}
```

Append to the file for that kind when one exists; otherwise start `docs/<kind>-prompts.json`.
A repaint replaces its entry's prompt. Attach the reference images the prompt names (an
existing piece of the same set) when you generate.

## 3. Generate into staging, then fit the contract

- Generate into `staging/` (gitignored), never straight into `assets/`.
- Bring the result to the contract: exact canvas, format and encoding from the prompt
  record's `output`, true alpha where the contract says transparent (no baked white or
  checkerboard), the feet or ground line where the contract puts it. Pillow is installed
  (`requirements-dev.txt`). Use the repo's tools where one fits rather than a one-off:
  `art:coat-draft` / `art:coat-clean` for coat masks, `art:camp-paint` for camp pieces,
  `art:portraits` for derived page-sized portraits.
- Then place it at its contract path under `assets/`.

## 4. Check it: the machine gate, then a person

1. `npm run art:verify`. Format, transparency, ground placement and the shared checks. A
   failure is fixed, never waved through.
2. The tests that pin its kind: `npx vitest run tools/art` (camp, stage figures, story
   props, together art and others live there), and `npm test` before you finish.
3. **A person approves it.** Show each painting at the size it is seen in play, beside the
   neighbours it must match (`npm run art:sheet` builds contact sheets into `art/review/`;
   `npm run play:jump -- <chapter> <scene>` shows it on the TV and phones). Nothing goes to the
   store until the user has approved that painting. "The agent says it's finished" is not
   acceptance ([art-pipeline.md](../../../docs/art-pipeline.md)).

Wait for the approval. A rejected painting goes back to step 2 or 3 and costs nothing,
because it never left `staging/` or the working tree.

## 5. Store it and commit it

**Before the cutover** (no `assets.lock.json` at the repo root yet), art still lives in git:
commit the approved file with its prompts record, as before, and skip the store steps below.

Only approved art, only after the gates pass:

1. `npm run assets:push -- <the folder you worked in>` uploads the new bytes to the asset store
   and records them in `assets.lock.json` ([docs/asset-store.md](../../../docs/asset-store.md)).
   In a cloud session it goes through the MCP server: the environment sets
   `KAD_ASSET_WRITER=mcp` and holds an `assets:write` key, as a network secret for the site's
   host or as `KAD_MCP_TOKEN` ([docs/mcp-server.md](../../../docs/mcp-server.md)). With
   neither a key nor AWS credentials, `push` says so: stop, and tell the user which paths
   need pushing. Never commit the image instead.
2. `npm run art:inventory` no longer lists it as owed.
3. Commit together: `assets.lock.json`, the prompts record, and any manifest or content
   change the art belongs to. Never the image file itself; `assets:verify` fails CI on a
   committed PNG, WebP, JPEG, GIF or WebM under `assets/`, `art/` or `docs/`.
4. To show the painting in a PR: `npm run assets:url -- <path>` gives its public link.

## Replacing and retiring

- **A repaint** is the same steps at the same path. `push` records the new bytes; the old
  ones stay in the store, so the previous commit still shows the previous painting.
- **Retiring art**: remove it from the manifest and content first, delete the file, then
  `npm run assets:push -- --prune <its folder>` to drop it from the lock.

## Do not

- Pick a path, size or format the contract does not give.
- Push before a person has approved the painting.
- Leave drafts under `assets/`: anything there that is not in the lock fails the deploy check.
- Put names, text, logos or watermarks in a painting, or anything scary: the players are
  about eight (the house rules are in each prompt record; keep them).
