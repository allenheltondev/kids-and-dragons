/**
 * The safety validator — architecture §6.5.
 *
 * This is the file standing between a small fast model and a television in a
 * living room, so it is tested rule by rule rather than in aggregate. Each
 * describe block is one bullet of §6.5.
 */

import { describe, expect, it } from "vitest";
import type { Chapter, Scene } from "@kad/shared";
import {
  FLAVOR_MAX,
  FLAVOR_MIN,
  RECAP_MAX,
  sceneEntities,
  validateNarration,
  validateRecap,
} from "./validate.ts";

const CHAPTER: Chapter = {
  id: "bramblewood-01",
  campaignId: "the-hollow-crown",
  index: 1,
  title: "The Bramblewood",
  biome: "forest",
  estimatedMinutes: 30,
  xpAward: 100,
  entry: "scene_clearing",
  scenes: {},
  llmHints: {
    tone: "warm, playful, a little spooky but never scary",
    vocabulary: "age-8",
    forbidden: ["death", "blood", "permanent loss"],
    npcVoices: { pib: "a bramble sprite the size of a teapot" },
  },
};

const SCENE: Scene = {
  type: "story",
  narration: "A wall of thorns twice your height blocks the path through the hedge.",
  choices: [],
};

function check(candidate: string, scene: Scene = SCENE, chapter: Chapter = CHAPTER) {
  const authored = scene.type === "check" ? (scene.narration ?? scene.prompt) : (scene.narration ?? "");
  return validateNarration(candidate, { scene, chapter, authored });
}

/** A line that passes everything, to mutate one rule at a time away from. */
const GOOD = "The hedge creaks as you get close, in a way hedges are not supposed to creak. Pib pretends not to have noticed.";

describe("the shape of an answer", () => {
  it("accepts a good line", () => {
    const verdict = check(GOOD);
    expect(verdict.ok).toBe(true);
  });

  it("rejects nothing at all", () => {
    expect(check("").ok).toBe(false);
    expect(check("   \n  ").ok).toBe(false);
  });

  it("rejects a line too short to be worth replacing the authored one", () => {
    /*
     * The floor is not in §6.5, and it is here because "Okay!" and "..." are
     * what a small model actually returns when it has nothing to say. A cap
     * with no floor accepts all of them.
     */
    const verdict = check("The hedge.");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/too short/);
  });

  it("rejects a line over the flavour cap", () => {
    // §6.5's "≤ 240 characters for flavor". Padded with scene vocabulary so it
    // is the length that fails and not the on-topic rule.
    const verdict = check(`The hedge is ${"very ".repeat(60)}tall.`);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/too long/);
  });

  it("accepts a line exactly at the cap and rejects one character more", () => {
    // The boundary, because an off-by-one here is invisible: it would only ever
    // show up as the layer quietly working slightly less often.
    const pad = (length: number) => `The hedge creaks. ${"a".repeat(length - 18)}`;
    expect(check(pad(FLAVOR_MAX)).ok).toBe(true);
    expect(check(pad(FLAVOR_MAX + 1)).ok).toBe(false);
  });

  it("rejects JSON, fences and key-value leaks", () => {
    expect(check(`{"narration": "${GOOD}"}`).ok).toBe(false);
    expect(check(`\`\`\`\n${GOOD}\n\`\`\``).ok).toBe(false);
    expect(check(`"narration": ${GOOD}`).ok).toBe(false);
  });

  it("rejects a preamble", () => {
    for (const opener of ["Here is the narration:", "Sure! ", "Certainly. ", "I'm sorry, but "]) {
      const verdict = check(`${opener}${GOOD}`);
      expect(verdict.ok, opener).toBe(false);
    }
  });

  it("allows an apology inside the line, which is a thing a sprite does", () => {
    // The preamble screen is anchored to the opening on purpose: "sorry" is
    // perfectly good writing in the middle of a sentence, and a substring match
    // would have thrown away the chapter's own npcVoice for the wisp.
    const verdict = check("Pib says sorry to the hedge, then says sorry for saying sorry, and then stops talking.");
    expect(verdict.ok).toBe(true);
  });
});

describe("the chapter's forbidden list", () => {
  it("rejects a forbidden topic", () => {
    const verdict = check("The hedge is covered in blood and the thorns look like they have been there since somebody's death.");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/forbidden topic/);
  });

  it("catches an inflected form, because the entries are topics and not tokens", () => {
    // An author who forbids "blood" means "bloodied" too. Substring rather than
    // word-boundary matching is a deliberate choice, so it is pinned.
    const verdict = check("The hedge leaves you a bit bloodied but the thorns seem sorry about it.");
    expect(verdict.ok).toBe(false);
  });

  it("reads the list off the chapter, not a constant here", () => {
    // The whole point of `llmHints.forbidden` is that it is Allen's half of
    // chapter 7. A chapter that forbids something unusual has to be obeyed.
    const strict: Chapter = {
      ...CHAPTER,
      llmHints: { ...CHAPTER.llmHints!, forbidden: ["hedge"] },
    };
    expect(check(GOOD, SCENE, strict).ok).toBe(false);
  });

  it("still works for a chapter with no hints at all", () => {
    // `llmHints` is optional in the schema, and a chapter without it must get
    // the defaults rather than an unguarded layer.
    const bare: Chapter = { ...CHAPTER, llmHints: undefined };
    expect(check("The hedge is covered in blood, honestly quite a lot of it, which is unusual for a hedge.", SCENE, bare).ok).toBe(false);
  });
});

describe("instructions the game cannot carry out", () => {
  it("rejects a line that asks for something spoken", () => {
    /*
     * The rule that actually protects a child. She will say it out loud, the
     * game will not hear her, and the screen will have lied to her.
     */
    const verdict = check("The hedge leans in close. Say it out loud, it whispers, and the thorns will move for you.");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/impossible instruction/);
  });

  it("rejects a line that asks for typing, swiping or going back", () => {
    expect(check("Type the word 'hedge' and the thorns will part for you, says the sprite.").ok).toBe(false);
    expect(check("Swipe past the hedge quickly, before the thorns notice that you are there.").ok).toBe(false);
    expect(check("You should go back to the clearing and take the other road past the hedge instead.").ok).toBe(false);
  });

  it("allows choosing, because tapping a choice is the one thing the game does", () => {
    // `choose`/`pick`/`decide` are deliberately absent from the screen. They are
    // the most natural verbs in a choice-point scene, and screening them would
    // reject the layer's best lines.
    const verdict = check("The hedge waits while you choose, rustling a little, the way something waits when it already knows.");
    expect(verdict.ok).toBe(true);
  });
});

describe("being about this scene", () => {
  it("rejects a line that mentions nothing in the scene", () => {
    // §6.5's "must reference an entity present in the current scene" — the rule
    // against a line that has drifted into a different part of the chapter.
    const verdict = check("The ocean stretches out under a sky the colour of a peach, and somewhere a bell rings.");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/mentions nothing/);
  });

  it("is word overlap, and one incidental shared word defeats it", () => {
    /*
     * The limit, pinned rather than left to be discovered. The rule is a bag of
     * words drawn from the scene, so an off-topic line that happens to reuse
     * one of them passes — here `twice`, which is in the authored text only
     * because the thorns are twice your height.
     *
     * Written down because the header claims this is a coarse screen and not a
     * judgement, and a claim like that is worth a test that would fail if
     * somebody quietly started believing otherwise. It is acceptable for the
     * same reason the rest of the file is strict: the cost of a miss is one
     * slightly off line on a screen, not a wrong game state.
     */
    const verdict = check("The ocean stretches out under a sky the colour of a peach, and a bell rings twice.");
    expect(verdict.ok).toBe(true);
  });

  it("counts a creature in a fight", () => {
    const fight: Scene = {
      type: "encounter",
      map: "map_hollow",
      enemies: [{ id: "wisp", name: "Bramblewisp", count: 2, hp: 6, guard: 11, quick: 3, steps: 4, attack: 3 }],
      onVictory: { goto: "scene_after" },
      onDefeat: { goto: "scene_after" },
    };
    expect(check("The bramblewisp bobs sideways, delighted, having clearly practised that move in a mirror.", fight).ok).toBe(true);
  });

  it("counts an NPC the chapter gave a voice to", () => {
    // A scene whose authored text does not name Pib, so the only way to pass is
    // through `npcVoices` — which is the half of the entity set that comes from
    // the chapter rather than from the scene.
    const plain: Scene = { type: "story", narration: "Quiet, for now.", choices: [] };
    expect(check("Pib arrives at speed, carrying something enormous, and will not explain any part of it.", plain).ok).toBe(true);
  });

  it("does not let a stopword count as being on topic", () => {
    /*
     * The rule is only worth having if it can fail. Every line contains "you"
     * and "the"; if those counted, every line would be on topic and the check
     * would be decoration.
     */
    const entities = sceneEntities(SCENE, CHAPTER);
    expect(entities.has("your")).toBe(false);
    expect(entities.has("hedge")).toBe(true);
  });

  it("skips the rule for a scene that names nothing", () => {
    /*
     * A scene with no enemies, no voiced NPC and no authored text has no
     * vocabulary to be on topic about. Rejecting everything there would disable
     * the layer for exactly the scenes with the least authored text to fall
     * back on — the ones where it is worth the most.
     */
    const empty: Scene = { type: "story", narration: "", choices: [] };
    const bare: Chapter = { ...CHAPTER, llmHints: { tone: "t", vocabulary: "v", forbidden: ["x"] } };
    expect(sceneEntities(empty, bare).size).toBe(0);
    expect(check("The ocean stretches out under a sky the colour of a peach, and a bell rings twice.", empty, bare).ok).toBe(true);
  });
});

describe("echoing", () => {
  it("rejects a line identical to the authored one", () => {
    // Not wrong, just pointless — and shipping it would make the layer look
    // like it is working when it is repeating the author back at them.
    const verdict = check(SCENE.type === "story" ? SCENE.narration : "");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/identical/);
  });

  it("ignores case and surrounding space when deciding that", () => {
    const verdict = check("  A WALL OF THORNS TWICE YOUR HEIGHT BLOCKS THE PATH THROUGH THE HEDGE.  ");
    expect(verdict.ok).toBe(false);
  });
});

describe("the recap", () => {
  const RECAP =
    "You went into the Bramblewood looking for a way through a hedge, and came out with a sprite " +
    "who will not stop following you. Sparklehoof talked a very small door out of being embarrassed " +
    "about being knocked on. Windstep found an acorn and has not explained it to anybody yet.";

  it("accepts a good recap", () => {
    expect(validateRecap(RECAP, CHAPTER).ok).toBe(true);
  });

  it("uses the longer cap", () => {
    // §6.5 gives recaps 400 characters against flavour's 240 — a recap that had
    // to fit in a flavour line could not name three moments.
    expect(RECAP.length).toBeGreaterThan(FLAVOR_MAX);
    expect(validateRecap(RECAP, CHAPTER).ok).toBe(true);
    expect(validateRecap(`${"a".repeat(RECAP_MAX + 1)}`, CHAPTER).ok).toBe(false);
  });

  it("still screens forbidden topics and impossible instructions", () => {
    // The half of §6.5 that was ever about safety applies to every surface.
    expect(validateRecap(`${RECAP} There was blood.`, CHAPTER).ok).toBe(false);
    expect(validateRecap("You did well today. Type your name to save your progress for next time, and see you soon.", CHAPTER).ok).toBe(false);
  });

  it("does not apply the on-topic rule, because there is no current scene", () => {
    /*
     * The deliberate asymmetry with `validateNarration`. A recap is about the
     * session as a whole; requiring it to mention the last scene's vocabulary
     * would reject the correct recaps.
     */
    expect(validateRecap("Three people walked into a forest and came out friends with a door. That is the whole story, really.", CHAPTER).ok).toBe(true);
  });

  it("keeps a floor too", () => {
    expect(validateRecap("Good job!", CHAPTER).ok).toBe(false);
    expect(FLAVOR_MIN).toBeGreaterThan(0);
  });
});
