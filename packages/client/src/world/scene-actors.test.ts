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

  it("changes when the species or either palette choice does", () => {
    const cases = [
      makeCharacter({ species: "griffin" }),
      makeCharacter({ appearance: { palette: "ember", accent: "#7FD4C1" } }),
      makeCharacter({ appearance: { palette: "meadow", accent: "#E0C470" } }),
    ];
    for (const character of cases) {
      expect(visualKeyOf(makeMember({ character })), character.species).not.toBe(visualKeyOf(base));
    }
  });

  it("does not change for the things that change every patch", () => {
    /*
     * The other half of the rule, and the one a naive "rebuild when anything
     * differs" would get wrong: hp, down and connected arrive on nearly every
     * server patch, and rebuilding on them would tear the rig down and reload
     * it mid-fight — a figure that vanishes for a frame every time it is hit.
     * Level and name are here too: levelling only matters to the figure when
     * it crosses a tier, which `tier` already says.
     */
    const same = [
      makeMember({ down: true, hp: 0 }),
      makeMember({ connected: false }),
      makeMember({ character: makeCharacter({ level: 3, name: "Someone Else" }) }),
      makeMember({ character: makeCharacter({ hp: 2 } as never) }),
    ];
    for (const member of same) {
      expect(visualKeyOf(member)).toBe(visualKeyOf(base));
    }
  });

  it("distinguishes two characters that differ only in a palette slot", () => {
    // The key is compared against the actor's own previous key, never across
    // characters — but a key that collided here would be one that ignores a
    // field, so this is the cheap canary for that.
    const a = makeMember({ character: makeCharacter({ appearance: { palette: "tide", accent: "#111111" } }) });
    const b = makeMember({ character: makeCharacter({ appearance: { palette: "tide", accent: "#222222" } }) });
    expect(visualKeyOf(a)).not.toBe(visualKeyOf(b));
  });
});
