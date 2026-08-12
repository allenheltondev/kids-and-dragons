/**
 * `visualKeyOf` — the rule that decides when a party member's figure has to be
 * rebuilt rather than updated in place.
 *
 * The rest of `scene.ts` needs a WebGL context and is exercised by running the
 * app; this is the piece with an opinion, extracted for the same reason
 * `storyFocusTiles` and `gridCells` are — the mapping is a rule, and a rule
 * should fail in CI rather than at the table.
 *
 * What it is guarding, concretely: an actor is *found* by `character.id` and
 * *built* from species, tier and palette. Update-in-place on an id match is
 * right for the things that change every patch (hp, who is down, who dropped
 * off wifi) and catastrophic for the things that change the body — the tier
 * swap is the emotional payload of the whole chapter (roadmap 5), and a figure
 * that kept its Fledgling rig through it would play the transformation
 * cutscene over a character that visibly never transformed.
 */

import { describe, expect, it } from "vitest";
import { visualKeyOf } from "./scene";
import { makeCharacter, makeMember } from "../testing/fixtures";

const base = makeMember();

describe("visualKeyOf", () => {
  it("changes when the tier does — the transformation has to reach the stage", () => {
    const grown = makeMember({ character: makeCharacter({ tier: "sworn", level: 4 }) });
    expect(visualKeyOf(grown)).not.toBe(visualKeyOf(base));
  });

  it("changes when the species does", () => {
    const swapped = makeMember({ character: makeCharacter({ species: "griffin" }) });
    expect(visualKeyOf(swapped)).not.toBe(visualKeyOf(base));
  });

  it("changes when the class selects a delivered rig variant", () => {
    const thornguard = makeMember({
      character: makeCharacter({
        species: "bigfoot",
        tier: "sworn",
        level: 4,
        class: "thornguard",
      }),
    });
    const duskrunner = makeMember({
      character: makeCharacter({
        species: "bigfoot",
        tier: "sworn",
        level: 4,
        class: "duskrunner",
      }),
    });
    expect(visualKeyOf(thornguard)).not.toBe(visualKeyOf(duskrunner));
  });

  it("does not change class when both combinations use the same base rig", () => {
    const thornguard = makeMember({ character: makeCharacter({ class: "thornguard" }) });
    const duskrunner = makeMember({ character: makeCharacter({ class: "duskrunner" }) });
    expect(visualKeyOf(thornguard)).toBe(visualKeyOf(duskrunner));
  });

  it("does NOT change for an appearance — nothing draws from one any more", () => {
    /*
     * The half that is easy to get wrong in the expensive direction. The
     * runtime recolour is gone (world/nameplate.ts): every rig wears the
     * colours it was authored in, and the palette and accent dress this
     * player's UI chrome instead. Folding them in here would throw a megabyte
     * of rig away and reload a byte-identical one because somebody tapped a
     * swatch.
     */
    const repainted = [
      makeCharacter({ appearance: { palette: "ember", accent: "#7FD4C1" } }),
      makeCharacter({ appearance: { palette: "meadow", accent: "#E0C470" } }),
    ];
    for (const character of repainted) {
      expect(visualKeyOf(makeMember({ character }))).toBe(visualKeyOf(base));
    }
  });

  it("does not change for the things that change every patch", () => {
    /*
     * The other half of the rule, and the one a naive "rebuild when anything
     * differs" would get wrong: hp, down and connected arrive on nearly every
     * server patch, and rebuilding on them would tear the rig down and reload
     * it mid-fight — a figure that vanishes for a frame every time it is hit.
     * Level and name are here too: levelling only matters to the figure when
     * it crosses a tier, which `tier` already says, and a rename rewrites the
     * nameplate in place (scene.ts `setLabel`) rather than reloading a rig.
     */
    const same = [
      makeMember({ down: true, hp: 0 }),
      makeMember({ connected: false }),
      makeMember({ character: makeCharacter({ level: 3, name: "Someone Else" }) }),
    ];
    for (const member of same) {
      expect(visualKeyOf(member)).toBe(visualKeyOf(base));
    }
  });
});
