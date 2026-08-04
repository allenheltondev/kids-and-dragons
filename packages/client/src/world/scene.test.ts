// @vitest-environment jsdom
/**
 * The story scene's actor lifecycle, and which stage it reports.
 *
 * `scene-actors.test.ts` covers `visualKeyOf` — the *rule* that decides when a
 * figure has to be rebuilt rather than updated. This covers `setParty` acting
 * on it, which is the half that has actually broken: "rebuild an actor when its
 * body changes, and release the bound view model" was a fix commit, and the
 * rule it fixed was already tested at the time.
 *
 * `createScene` takes an `Application`, which is what kept this file from
 * existing. It turns out to read exactly three things off one — `stage`,
 * `ticker`, `canvas` — so `fakeApp()` supplies those and the whole module runs
 * with no renderer. Driving the ticker by hand is the other half of the win:
 * the motion in here is `approach()`-based, so "has it settled" becomes a loop
 * rather than a wait.
 *
 * What this file does NOT claim to cover, so nobody reads the coverage number
 * as more than it is: nothing is rasterised, so glyph shape, texture loading
 * and the depth sort's visual result are still only checked by looking at the
 * running app. The behaviour here is tree structure, lifecycle and geometry.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { Container, Text } from "pixi.js";
import type { Application } from "pixi.js";
import { beginEncounter, parseBoard } from "@kad/shared";
import type { PartyMember, ResolvedCharacter } from "@kad/shared";
import { makeRules } from "../../../shared/src/test-fixtures";
import { fakeApp, installFakeCanvas2D, type FakeApp } from "../testing/fake-stage";
import { createScene, type PartyScene } from "./scene";
import type { BoardViewState } from "./board";

beforeAll(installFakeCanvas2D);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function character(overrides: Partial<ResolvedCharacter> = {}): ResolvedCharacter {
  return {
    id: "c_1",
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 1,
    xp: 0,
    tier: "fledgling",
    stats: { might: 2, quick: 9, clever: 3, heart: 5 },
    unspentPoints: 0,
    committedLevel: 1,
    maxHp: 10,
    steps: 4,
    guard: 11,
    attackStat: "heart",
    actions: [],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: false,
    ...overrides,
  };
}

function member(overrides: Partial<PartyMember> = {}): PartyMember {
  const char = overrides.character ?? character();
  return {
    character: char,
    playerId: char.ownerPlayerId,
    hp: char.maxHp,
    down: false,
    connected: true,
    ready: true,
    ...overrides,
  };
}

function scene(): { scene: PartyScene; app: FakeApp } {
  const app = fakeApp();
  const made = createScene(app as unknown as Application);
  made.resize(1600, 900);
  return { scene: made, app };
}

/** Every live `Text` on the stage, by what it says. */
function drawnLabels(app: FakeApp): string[] {
  const found: string[] = [];
  const walk = (node: Container): void => {
    if (node.destroyed) return;
    if (node instanceof Text) found.push(node.text);
    for (const child of node.children) walk(child as Container);
  };
  walk(app.stage);
  return found;
}

/**
 * The containers that hold a figure, identified by the label inside them.
 *
 * A rebuild is only observable as *identity*: the old container is destroyed
 * and a different object takes its place. Holding the object itself is what
 * makes "updated in place" and "rebuilt" different assertions rather than the
 * same one worded twice.
 */
function figureFor(app: FakeApp, name: string): Container | null {
  let found: Container | null = null;
  const walk = (node: Container): void => {
    if (node.destroyed || found) return;
    for (const child of node.children) {
      if (child instanceof Text && child.text === name) {
        found = node;
        return;
      }
    }
    for (const child of node.children) walk(child as Container);
  };
  walk(app.stage);
  return found;
}

function encounterView(): BoardViewState {
  const hero = character();
  const encounter = beginEncounter(
    {
      board: parseBoard(["....", "....", "....", "...."]),
      party: [{ character: hero, at: { x: 0, y: 0 } }],
      enemies: [
        {
          spec: { id: "wisp", name: "Bramblewisp", count: 1, hp: 6, guard: 11, quick: 3, steps: 5, attack: 3 },
          at: { x: 3, y: 3 },
        },
      ],
    },
    { rules: makeRules(), abilities: {}, rng: { next: () => 0.5 } },
  );
  return { encounter, biome: null, enemyArt: {}, party: [member({ character: hero })] };
}

// ---------------------------------------------------------------------------
// setParty
// ---------------------------------------------------------------------------

describe("setParty", () => {
  it("keeps the same figure when only what arrives on a patch changes", () => {
    /*
     * hp, down and connected land on nearly every server patch. Rebuilding on
     * them would tear the rig down and reload it mid-scene — a figure that
     * blinks out for a frame every time it is hit.
     */
    const { scene: s, app } = scene();
    s.setParty([member()]);
    const before = figureFor(app, "Sparklehoof");
    expect(before).toBeTruthy();

    s.setParty([member({ down: true, hp: 0, connected: false })]);

    expect(figureFor(app, "Sparklehoof")).toBe(before);
    expect(before!.destroyed).toBe(false);
  });

  it("rebuilds the figure when the body changes, and drops the old one", () => {
    /*
     * The emotional payload of the whole chapter (roadmap 5): a character who
     * levels into a new tier keeps her id and changes her body. An actor
     * rebuilt only on a new *id* would go on drawing the Fledgling rig for the
     * rest of the session, playing the transformation cutscene over a figure
     * that visibly never transformed.
     */
    const { scene: s, app } = scene();
    s.setParty([member()]);
    const before = figureFor(app, "Sparklehoof")!;

    s.setParty([member({ character: character({ tier: "sworn", level: 4 }) })]);

    const after = figureFor(app, "Sparklehoof");
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
    // The old tree is released rather than left parented and invisible.
    expect(before.destroyed).toBe(true);
    expect(drawnLabels(app).filter((t) => t === "Sparklehoof")).toHaveLength(1);
  });

  it("renames in place rather than rebuilding", () => {
    // A rename is a label edit — the same "write, don't rebuild" split the
    // board makes, and a megabyte of rig is the cost of getting it wrong.
    const { scene: s, app } = scene();
    s.setParty([member()]);
    const before = figureFor(app, "Sparklehoof")!;

    s.setParty([member({ character: character({ name: "Thistlemane" }) })]);

    expect(drawnLabels(app)).toContain("Thistlemane");
    expect(drawnLabels(app)).not.toContain("Sparklehoof");
    expect(figureFor(app, "Thistlemane")).toBe(before);
    expect(before.destroyed).toBe(false);
  });

  it("drops a member who leaves the party", () => {
    const a = character();
    const b = character({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle" });
    const { scene: s, app } = scene();
    s.setParty([member({ character: a }), member({ character: b })]);
    const gone = figureFor(app, "Thistle")!;

    s.setParty([member({ character: a })]);

    expect(gone.destroyed).toBe(true);
    expect(drawnLabels(app)).toEqual(["Sparklehoof"]);
  });

  it("takes a party of nobody without complaint", () => {
    // The lobby before anyone has built a character.
    const { scene: s, app } = scene();
    expect(() => s.setParty([])).not.toThrow();
    expect(drawnLabels(app)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Which stage is being reported
// ---------------------------------------------------------------------------

describe("nameplateBoxes", () => {
  it("reports the story lineup when there is no fight", () => {
    const { scene: s } = scene();
    s.setParty([member()]);

    const reading = s.nameplateBoxes();
    expect(reading.space).toBe("story");
    expect(reading.boxes.map((b) => b.text)).toEqual(["Sparklehoof"]);
  });

  it("reports the board once one is up, not the lineup behind it", () => {
    /*
     * The distinction this seam exists for. Two rounds of an e2e polled for
     * "three names are present", were satisfied by the story lineup that had
     * been on screen the whole time, and asserted board geometry against
     * lineup boxes — passing happily while the board bug sat right there. The
     * space is named so a caller has to say which stage it means.
     */
    const { scene: s } = scene();
    s.setParty([member()]);
    expect(s.nameplateBoxes().space).toBe("story");

    s.setEncounter(encounterView());
    expect(s.nameplateBoxes().space).toBe("board");

    // And back down again when the fight ends.
    s.setEncounter(null);
    expect(s.nameplateBoxes().space).toBe("story");
  });

  it("reports nothing while the names are switched off", () => {
    /*
     * Off for the lobby, where the player cards above the lineup already list
     * every name — the copy nobody needs is the one competing with the art.
     */
    const { scene: s } = scene();
    s.setParty([member()]);
    expect(s.nameplateBoxes().boxes).toHaveLength(1);

    s.setNameplatesVisible(false);
    expect(s.nameplateBoxes().boxes).toEqual([]);

    s.setNameplatesVisible(true);
    expect(s.nameplateBoxes().boxes).toHaveLength(1);
  });

  it("keeps the switch across a rebuild", () => {
    // A tier crossing builds a fresh label, which must not arrive visible on a
    // surface that turned names off.
    const { scene: s } = scene();
    s.setParty([member()]);
    s.setNameplatesVisible(false);

    s.setParty([member({ character: character({ tier: "sworn", level: 4 }) })]);

    expect(s.nameplateBoxes().boxes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("the scene's life", () => {
  it("runs on the host ticker rather than starting one of its own", () => {
    /*
     * PixiStage stops the shared ticker when the surface is hidden, and that
     * discipline only holds for free if nothing in here adds a second one.
     */
    const { scene: s, app } = scene();
    expect(app.ticker.count).toBe(1);

    s.setParty([member()]);
    expect(() => app.ticker.frame(16)).not.toThrow();
    expect(app.ticker.count).toBe(1);
  });

  it("takes its callback off the ticker when it is destroyed", () => {
    // A scene left on the ticker keeps drawing a stage nobody is looking at,
    // and holds its whole tree alive with it.
    const { scene: s, app } = scene();
    s.setParty([member()]);

    s.destroy();

    expect(app.ticker.count).toBe(0);
  });

  it("ignores everything after it is destroyed", () => {
    /*
     * The store does not know the surface is gone, so a late patch is normal.
     * "Does not throw" is the weaker half of this and on its own is close to
     * worthless — a `setParty` that quietly rebuilt the whole lineup onto a
     * torn-down stage would pass it. What is asserted is that nothing came
     * back: the tree stays empty and the figures are not re-parented.
     */
    const { scene: s, app } = scene();
    s.setParty([member()]);
    s.destroy();

    expect(() => s.setParty([member()])).not.toThrow();
    expect(() => s.setEncounter(encounterView())).not.toThrow();
    expect(() => s.setNameplatesVisible(false)).not.toThrow();
    expect(() => s.resize(800, 600)).not.toThrow();
    expect(() => s.destroy()).not.toThrow();

    expect(drawnLabels(app)).toEqual([]);
    expect(s.nameplateBoxes().boxes).toEqual([]);
    expect(app.ticker.count).toBe(0);
  });

  it("settles the figures without a real clock", () => {
    // The lineup animates into place with `approach`, so a test that asserts
    // a resting position has to run frames rather than wait for them.
    const { scene: s, app } = scene();
    s.setParty([member(), member({ character: character({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle" }) })]);

    for (let i = 0; i < 300; i++) app.ticker.frame(16);

    const boxes = s.nameplateBoxes().boxes;
    expect(boxes).toHaveLength(2);
    // Two figures, two distinct slots — not stacked on the same spot.
    expect(boxes[0]!.x).not.toBeCloseTo(boxes[1]!.x, 1);
  });
});
