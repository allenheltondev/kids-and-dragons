/**
 * A rift in plain view (#401, `SceneRift`) against the schema: the four
 * non-combat scene types take `"steady"`, `"open"` or `"collapse"`, and
 * nothing else; a fight refuses the field, because its board draws its own
 * ground. The tagged Riftlight drafts are checked by the real gate in
 * tools/content/continental-rift.test.ts.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (...parts) => JSON.parse(readFileSync(join(REPO, ...parts), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
for (const file of readdirSync(join(REPO, "schemas")).filter((f) => f.endsWith(".schema.json"))) {
  ajv.addSchema(read("schemas", file));
}
const chapterSchema = ajv.getSchema(read("schemas", "chapter.schema.json").$id);

const sandbox = () => read("packages", "shared", "src", "fixtures", "rift-skirmish.chapter.json");

function withRift(scene, rift) {
  const chapter = sandbox();
  chapter.scenes[scene] = { ...chapter.scenes[scene], rift };
  const ok = chapterSchema(chapter);
  return { ok, errors: (chapterSchema.errors ?? []).map((e) => `${e.instancePath} ${e.message}`) };
}

describe("a scene's rift", () => {
  it.each(["steady", "open", "collapse"])("a story scene takes %s", (rift) => {
    const { ok, errors } = withRift("scene_landing", rift);
    expect(ok, errors.join("\n")).toBe(true);
  });

  it("refuses anything else", () => {
    for (const rift of ["closed", "neutral", true, 1]) {
      expect(withRift("scene_landing", rift).ok, String(rift)).toBe(false);
    }
  });

  it("refuses it on a fight", () => {
    const { ok, errors } = withRift("fight_rift", "steady");
    expect(ok).toBe(false);
    expect(errors.join("\n")).toMatch(/fight_rift/);
  });
});
