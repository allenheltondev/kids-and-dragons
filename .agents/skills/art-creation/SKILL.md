---
name: art-creation
description: "Make, deliver or replace Kids & Dragons game art (cast, entities, scenes, story plates, camp pieces, key art, props, icons, frames) with the imagegen skill, from the art issue to the asset store. Use for any new or repainted image under assets/. Not for UI code, chapter writing, or audio."
---

# Art creation

The game finds art by path, checks it against a contract, and ships it from the S3 asset
store. A painting that looks right but sits at the wrong path, the wrong size or with a
background where alpha belongs is invisible or broken at the table. This skill is the
order of operations that keeps that from happening. It does not replace the docs; it says
which to read and when.

Codex generates the art, with the **imagegen** skill. Everything else here (contracts,
checks, review of character art, upload, records) is this repository's.

## 1. Start from the art issue

The work queue is GitHub issues. Every piece of art the game needs has an open issue titled
**`Art: …`** (or **`Art brief: …`** for a design still being settled), for example "Art:
finish the mini-games" or "Art: starter nameplate frames". Find the open ones with
`gh issue list --search "Art in:title" --state open`, or the session's GitHub tools. Work from
the issue you were given. Without one, ask which issue to take; do not pick work from
anywhere else.

An art issue says what to paint and how. Read all of it before generating anything:

- **Format.** Canvas, alpha or opaque, ground point, file type, style. Where it differs from
  the general contract below, the issue wins: it is the newer decision.
- **The checklist.** Each item names its subject and usually its id or path
  (`cast/snowhorn_kid`, `assets/scenes/gemfall/…`). Paint what is listed, nothing more.
- **Owner decisions.** Items marked as the owner's call (which friend gets a spotted coat,
  whether a tier gets its own aura) are settled with the user before painting. An agent does not
  decide them.
- **Done when.** What counts as finished: often the manifest entry, the chapter mapping, a
  re-measured paint box, not only the file. Those are part of the work. (Art in a Gemfall
  chapter no longer needs a hash re-taken: its pin ignores art, `npm run content:pin`.)

**New art needs an issue first.** If something needs painting and no issue covers it, write
one before painting, in the same shape: `Art: …` title, "Part of #…" where an epic applies,
**Format**, a checklist with ids or paths, **Done when**.

**The path comes from the issue and the contract, never from you.** Characters, figures, cast
and entities follow `packages/client/src/world/art-paths.ts` (`assets/cast/<id>/assembled.png`,
`assets/entities/<id>/assembled.png`, …); everything else is the path the issue or the manifest
names. If the issue and the code disagree on a path, ask; the game only finds the code's.

`npm run art:inventory` is a cross-check, not the queue. It lists art the manifest declares
that is not on disk. Use it to confirm an issue's paths and, at the end, that they are no
longer owed. Pull first (`npm run assets:pull`). On a checkout without the art it would report
everything as owed, so it (and `art:verify`) refuses to run until the lock's art is on disk.

Read the contract before writing a prompt. The main ones:

| Kind | Contract |
|---|---|
| Characters, class figures, NPC and enemy cutouts | [docs/art-pipeline.md](../../../docs/art-pipeline.md): RGBA 1024 x 1024, feet at (512, 900) |
| Camp backdrops, pieces, tents, decorations | `assets/manifest.json` → `camp`, [docs/briefs/camp.md](../../../docs/briefs/camp.md) |
| Story plates (prologue, chapter, epilogue) | [docs/story-plates.md](../../../docs/story-plates.md): 1600 x 900 |
| Hero looks, coat masks, nameplate frames | [docs/hero-looks.md](../../../docs/hero-looks.md) |
| Anything else | the art issue's Format section, and [docs/asset-brief.md](../../../docs/asset-brief.md) |

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
  "paintings": [{
    "id": "…",
    "path": "assets/…",
    "issue": 123,
    "generator": "imagegen (<the model it reports>)",
    "uploadedBy": "codex cloud",
    "original": "art/source/originals/123/….png",
    "prompt": "Use case: illustration-story. …"
  }]
}
```

The per-painting `issue`, `generator` (the skill and the model it used), `uploadedBy` (the MCP
key's label) and `original` are its provenance in git (#732): `npm run assets:provenance --
<path>` reads them back beside the commit, the PR and the store's stamp.

Append to the file for that kind when one exists; otherwise start `docs/<kind>-prompts.json`.
A repaint replaces its entry's prompt. Attach the reference images the prompt names (an
existing piece of the same set) when you generate.

## 3. Generate into staging, then fit the contract

- Generate into `staging/` (gitignored), never straight into `assets/`.
- **Keep the untouched original.** Copy the generator's file, unchanged, to
  `art/source/originals/<issue>/<id>.<ext>` and name it in the record's `original`. It carries
  whatever content credentials (C2PA) the generator attached, which the fitting below strips,
  and it is the full-size source if the art is ever refitted. It is pushed to the store with the
  rest; nothing under `art/` ships to players.
- Bring the result to the contract: exact canvas, format and encoding from the prompt
  record's `output`, true alpha where the contract says transparent (no baked white or
  checkerboard), the feet or ground line where the contract puts it. Pillow is installed
  (`requirements-dev.txt`). Use the repo's tools where one fits rather than a one-off:
  `art:coat-draft` / `art:coat-clean` for coat masks, `art:camp-paint` for camp pieces,
  `art:portraits` for derived page-sized portraits.
- Then place it at its contract path under `assets/`.

## 4. Check it: the machine gate, and a person for character art

1. `npm run art:verify`. Format, transparency, ground placement and the shared checks. A
   failure is fixed, never waved through.
2. The tests that pin its kind: `npx vitest run tools/art` (camp, stage figures, story
   props, together art and others live there), and `npm test` before you finish.
3. **Character art: the user approves it.** Art that depicts a player's hero needs the
   user's approval before it is stored:

   - `assets/characters/` (species and tier illustrations)
   - `assets/character-rigs/` (class figures)
   - `assets/gear-portraits/`

   Show each at the size it is seen in play, beside the neighbours it must match
   (`npm run art:sheet` builds contact sheets into `art/review/`;
   `npm run play:jump -- <chapter> <scene>` shows it on the TV and phones), and wait for the
   user's approval of that painting. A rejected one goes back to step 2 or 3 and costs
   nothing, because it never left `staging/` or the working tree.

   CI holds the user to it too, after the cutover: the **character art** check fails a PR
   whose `assets.lock.json` adds or repaints a path in those folders, until the user adds the
   `art-approved` label. The check's summary links each painting in the store. Never add that
   label yourself; it is the user's word that they looked.

   **Everything else** (story cast, entities, scenes, plates, camp, key art, props, icons,
   frames) needs no review: it is ready once steps 1 and 2 pass. Still look at it yourself
   at play size against its neighbours, and redo anything that does not match the set.

## 5. Store it and commit it

**Before the cutover** (no `assets.lock.json` at the repo root yet), art still lives in git:
commit the file with its prompts record, as before, and skip the store steps below.

Only after the gates pass, and for character art only once the user has approved it:

1. `npm run assets:push -- --issue <the art issue> <the folder you worked in> art/source/originals/<the issue>`
   uploads the new bytes to the asset store, stamps each with the issue and the uploading key,
   and records them in `assets.lock.json` ([docs/asset-store.md](../../../docs/asset-store.md)).
   In a cloud session it goes through the MCP server: the environment sets
   `KAD_ASSET_WRITER=mcp` and holds an `assets:write` key, as a network secret for the site's
   host or as `KAD_MCP_TOKEN` ([docs/mcp-server.md](../../../docs/mcp-server.md)). With
   neither a key nor AWS credentials, `push` says so: stop, and tell the user which paths
   need pushing. Never commit the image instead.
2. Everything the issue's **Done when** asks for is in place (manifest entry, chapter
   mapping, re-measured box), and `npm run art:inventory` no longer lists the
   paths as owed.
3. Commit together: `assets.lock.json`, the prompts record, and any manifest or content
   change the art belongs to. Never the image file itself; `assets:verify` fails CI on a
   committed PNG, WebP, JPEG, GIF or WebM under `assets/`, `art/` or `docs/`.
4. To show the painting in a PR: `npm run assets:url -- <path>` gives its public link.
5. Open the PR as "Part of #<the art issue>", and tick the items it delivers in the issue's
   checklist. The issue closes when its last item is done; a phase can be its own PR.

## Replacing and retiring

- **A repaint** is the same steps at the same path. `push` records the new bytes; the old
  ones stay in the store, so the previous commit still shows the previous painting.
- **Retiring art**: remove it from the manifest and content first, delete the file, then
  `npm run assets:push -- --prune <its folder>` to drop it from the lock.

## Do not

- Pick a path, size or format the contract does not give.
- Push character art before the user has approved it.
- Leave drafts under `assets/`: anything there that is not in the lock fails the deploy check.
- Put names, text, logos or watermarks in a painting, or anything scary: the players are
  about eight (the house rules are in each prompt record; keep them).
