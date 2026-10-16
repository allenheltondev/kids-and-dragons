# Kids & Dragons

Rules, items, campaigns and chapters are JSON under `content/`, validated by `schemas/` and
`tools/content/validate.mjs`. The TypeScript types in `packages/shared/src/types/` are the
contract; where a schema disagrees with them, the schema is wrong. `content/README.md` is the
authoring guide; read it before writing or editing a chapter.

## Commands

- `npm run typecheck` — tsc across shared, server, client and tools
- `npm test` — vitest (includes the `tools/**/*.test.mjs` suites)
- `npm run content:validate` — schemas and scene graphs; a malformed chapter must fail here, never at the table

## Writing or editing a chapter

- **Mark the scenes that carry the story.** A non-combat scene may set `priority`: `1` for a
  revelation the campaign turns on, `2` for a clue worth noticing; leave it off everywhere else.
  At most one p1 on any path through a chapter, and the fact goes in the narration itself.
  Priority scenes are drawn differently on the shared screen, never rewritten by the live
  narration layer, and every p1 visited is handed to the end-of-chapter recap. See
  [content/README.md, "Priority scenes"](content/README.md#priority-scenes); Gemfall's p1 per beat
  is in [docs/campaigns/gemfall-authoring.md](docs/campaigns/gemfall-authoring.md#priority-scenes).
  A reveal written as a check's branch narration cannot be marked, so give a big reveal its own
  scene.
- **Gemfall is pinned.** `packages/server/src/handlers/gemfall-compat.test.ts` hashes every
  Gemfall file. A deliberate content edit re-takes those hashes and says why in the commit; the
  gameplay digests below them must not move.
- Players are about eight: US spelling, no em dashes in Gemfall text, and every check branch
  narrates (`tools/content/gemfall-flow.test.mjs`, `spelling.test.mjs`).
