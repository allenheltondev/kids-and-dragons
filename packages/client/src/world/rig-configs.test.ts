/**
 * The rig configs' palette slots, held to the manifest's own rule.
 *
 * `assets/manifest.json` → `paletteRule` says the accent "sits on the
 * signature part only", and the mane is the species identity. The rigs are
 * where that becomes real: a `tintSlots` entry per bound colour, which
 * rive-mcp turns into a data-binding view-model property the client drives by
 * name (world/rive-actor.ts).
 *
 * Two species cannot honour the accent half of the rule, for reasons that are
 * about the art rather than the code — and *that* is why this file exists. A
 * missing slot is invisible: `instance.color("accent")` on a rig without one
 * optional-chains away, the figure renders perfectly, and the only symptom is
 * a colour the player picked never appearing. Silent, cosmetic, and exactly
 * the kind of thing that rots. So the exceptions are named here, and any
 * *third* species losing a slot — a config edited, a rebuild that dropped one
 * — fails the build instead.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "../../../../assets/manifest.json";

interface RigConfig {
  $comment?: string;
  tintSlots?: { part: string; slot: string; bind: string }[];
  meshParts?: Record<string, unknown>;
}

const species = manifest.species as { id: string; signature: string; parts: string[] }[];

function configFor(id: string): RigConfig {
  const path = fileURLToPath(new URL(`../../../../art/rig/${id}.rig.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as RigConfig;
}

/**
 * The two documented exceptions, with the reason each one is real. Written as
 * data so the test below reads as the rule plus its exceptions rather than as
 * a list of species that happen to pass.
 */
const NO_ACCENT_SURFACE: Record<string, string> = {
  bigfoot: "its signature part is the mane, which already carries the mane colour",
  manticore: "its signature part is a bone-meshed tail, and a tint slot on a meshed part stays rigid",
};

describe("rig configs", () => {
  it("binds the mane on every species — the identity colour always reaches the figure", () => {
    for (const sp of species) {
      const slots = configFor(sp.id).tintSlots ?? [];
      expect(slots.map((s) => s.bind), sp.id).toContain("mane");
    }
  });

  it("binds the accent to the signature part, except where the art cannot carry one", () => {
    for (const sp of species) {
      const slots = configFor(sp.id).tintSlots ?? [];
      const accent = slots.find((s) => s.bind === "accent");

      if (sp.id in NO_ACCENT_SURFACE) {
        expect(accent, `${sp.id} is documented as having no accent surface`).toBeUndefined();
        continue;
      }
      // paletteRule: "Accent ... sits on the signature part only."
      expect(accent, `${sp.id} has no accent slot and is not a documented exception`).toBeDefined();
      expect(accent?.part, sp.id).toBe(sp.signature);
    }
  });

  it("says in the config itself why an exception is an exception", () => {
    // A future reader hits the config before they hit this test.
    for (const id of Object.keys(NO_ACCENT_SURFACE)) {
      expect(configFor(id).$comment ?? "", id).toContain("NO ACCENT SLOT");
    }
  });

  it("only tints parts the species actually has", () => {
    for (const sp of species) {
      for (const slot of configFor(sp.id).tintSlots ?? []) {
        expect(sp.parts, `${sp.id} tints "${slot.part}"`).toContain(slot.part);
      }
    }
  });

  it("never tints a meshed part — the overlay would not follow the deformation", () => {
    for (const sp of species) {
      const config = configFor(sp.id);
      const meshed = Object.keys(config.meshParts ?? {});
      for (const slot of config.tintSlots ?? []) {
        expect(meshed, `${sp.id} tints meshed part "${slot.part}"`).not.toContain(slot.part);
      }
    }
  });
});
