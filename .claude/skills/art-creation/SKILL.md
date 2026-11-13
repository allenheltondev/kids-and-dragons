---
name: art-creation
description: Make, deliver or replace Kids & Dragons game art under assets/ (cast, entities, scenes, story plates, camp pieces, key art, props, icons, frames), from the art issue to the S3 asset store. Use for any new or repainted image. Not for UI code, chapter writing, or audio.
---

# Art creation

Follow [.agents/skills/art-creation/SKILL.md](../../../.agents/skills/art-creation/SKILL.md).
It is the one copy of these steps, shared with Codex, which paints with the imagegen skill,
so the two of you cannot drift apart.

The one difference for you: Codex generates the art, not you. Do every step except
generating. Read the art issue and its contract, and write the prompt and its record for Codex
to run. When an image comes back, fit it to the contract, run the gates, get the
user's approval if it is character art, make the copies devices draw in its place
(`npm run art:small`), then push it and commit the lock, `assets.small.json` and the record.
