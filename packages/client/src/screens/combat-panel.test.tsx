// @vitest-environment jsdom
/**
 * CombatControls — the select→(aim→)commit walk, driven through a real DOM.
 *
 * `screens.test.tsx` proves this panel *renders*. That is a low bar for a
 * state machine whose entire job is what happens between taps, and it is the
 * wrong bar for the two rules the panel exists to enforce: **a tap on a legal
 * thing does it, and nothing else is on screen to tap** (spec §7.2, §11). A
 * misfire here is a child's turn spent on the wrong tile, which is the most
 * upsetting failure the game has — so what each tap sends, and when, is the
 * whole subject.
 *
 * So these drive it the way a thumb does — click, look, click — and assert on
 * two things only: what is on screen, and what reached `send`. The store is
 * real (`useGameStore.setState`), the encounter is real (`beginEncounter`), and
 * the action cards come from `legalActions`, the same function the server
 * re-runs to validate. The only fixture is the ability catalog, which is local
 * so these tests stay about the panel rather than about `content/abilities.json`
 * — `screens.test.tsx` already guards the real catalog's shape.
 *
 * The other half of §7.2 — "illegal moves are not presented, so they can't be
 * attempted" — is asserted as an *absence*: nothing here is ever disabled, so
 * a button that should not exist has to genuinely not exist.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  beginEncounter,
  parseBoard,
  type AbilityCatalog,
  type ClientIntent,
  type EncounterSetup,
  type EncounterState,
  type EnemySpec,
  type ItemCatalog,
  type PartyMember,
  type ResolvedCharacter,
  type RulesContent,
} from "@kad/shared";
import { makeItems, makeRules } from "../../../shared/src/test-fixtures";
import { useGameStore } from "../store";
import { CombatControls, describeBeats, rollWords } from "./CombatPanel";

const RULES: RulesContent = makeRules();
const ITEMS: ItemCatalog = makeItems();

/**
 * Written for the *shapes* the panel walks, one ability per shape, because the
 * branches under test are "how many things must be picked and in what order":
 *
 *   strike       — a figure, one of them          (target: the tap commits)
 *   volley       — two different figures          (target → target commits)
 *   thorns       — two tiles                      (tile → tile commits)
 *   pounce       — a tile, then a figure from it  (tile → tile-target commits)
 *   shout        — nothing at all                 (the card commits)
 */
const CATALOG: AbilityCatalog = {
  strike: {
    id: "strike",
    name: "Strike",
    icon: "swords",
    timing: "action",
    target: { kind: "enemy", range: 6 },
    effects: [{ effect: { type: "attack", damage: 2 } }],
  },
  volley: {
    id: "volley",
    name: "Volley",
    icon: "arrow",
    timing: "action",
    target: { kind: "enemy", range: 6, count: 2 },
    effects: [{ effect: { type: "attack", damage: 1 } }],
  },
  thorns: {
    id: "thorns",
    name: "Thorns",
    icon: "thorn",
    timing: "action",
    target: { kind: "tile", range: 6, tileCount: 2 },
    effects: [{ effect: { type: "growWall" }, to: "self" }],
  },
  pounce: {
    id: "pounce",
    name: "Pounce",
    icon: "arrow",
    timing: "action",
    target: {
      kind: "tile",
      range: 6,
      openTileOnly: true,
      affects: "enemy",
      followUp: { kind: "enemy", range: "adjacent" },
    },
    effects: [{ effect: { type: "moveSelf" } }, { effect: { type: "attack", damage: 2 } }],
  },
  shout: {
    id: "shout",
    name: "Shout",
    icon: "moon",
    timing: "action",
    target: { kind: "self" },
    effects: [{ effect: { type: "evade" }, to: "self" }],
  },
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function character(overrides: Partial<ResolvedCharacter> = {}): ResolvedCharacter {
  return {
    id: "c_hero",
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn",
    class: "thornguard",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 1,
    xp: 0,
    tier: "fledgling",
    // Quick 9 against a Quick-3 wisp so the hero reliably leads and every test
    // below can say "her turn" without pinning a die.
    stats: { might: 4, quick: 9, clever: 1, heart: 1 },
    unspentPoints: 0,
    spendableStats: ["might", "quick", "clever", "heart"],
    committedLevel: 1,
    maxHp: 10,
    steps: 4,
    guard: 12,
    attackStat: "might",
    actions: [],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: false,
    ...overrides,
  };
}

function wisp(overrides: Partial<EnemySpec> = {}): EnemySpec {
  return {
    id: "wisp",
    name: "Bramblewisp",
    count: 1,
    hp: 6,
    guard: 11,
    quick: 3,
    steps: 5,
    attack: 3,
    ...overrides,
  };
}

/** Five by five, all open. The hero at (1,2), one wisp beside her at (2,2). */
function encounterWith(overrides: Partial<EncounterSetup> = {}): EncounterState {
  const setup: EncounterSetup = {
    board: parseBoard([".....", ".....", ".....", ".....", "....."]),
    party: [{ character: character(), at: { x: 1, y: 2 } }],
    enemies: [{ spec: wisp(), at: { x: 2, y: 2 } }],
    ...overrides,
  };
  return beginEncounter(setup, { rules: RULES, abilities: CATALOG, rng: { next: () => 0.5 } });
}

function member(char: ResolvedCharacter): PartyMember {
  return {
    character: char,
    playerId: char.ownerPlayerId,
    hp: char.maxHp,
    down: false,
    connected: true,
    ready: true,
  };
}

interface MountOptions {
  encounter?: EncounterState;
  characters?: ResolvedCharacter[];
  /** Whose device this is. Defaults to the first character's owner. */
  playerId?: string;
  items?: ItemCatalog | null;
  abilities?: AbilityCatalog | null;
  rules?: RulesContent | null;
}

/**
 * Puts a real encounter in the real store and renders the panel over it.
 *
 * The characters are seated *in the encounter*, not only in the party list:
 * `legalActions` reads the combatant's abilities, which `beginEncounter` copies
 * off the character. Wiring only the store would leave every hero with the
 * three universal actions and silently make each ability test vacuous.
 */
function mount(options: MountOptions = {}) {
  const chars = options.characters ?? [character()];
  const encounter =
    options.encounter ??
    encounterWith({
      party: chars.map((c, i) => ({ character: c, at: { x: 1, y: i + 2 } })),
    });
  const sent: ClientIntent[] = [];
  const send = vi.fn(async (intent: ClientIntent) => {
    sent.push(intent);
    return true;
  });

  useGameStore.setState({
    session: {
      runId: "r_1",
      roomCode: "ABCD",
      playerId: options.playerId ?? chars[0]?.ownerPlayerId ?? "p_1",
      mode: "travel",
      sessionToken: "t",
    },
    state: {
      runId: "r_1",
      roomCode: "ABCD",
      mode: "travel",
      seq: 1,
      phase: "scene",
      campaignId: null,
      chapterId: "ch_1",
      sceneId: "s_1",
      sceneType: "encounter",
      narration: "",
      art: null,
      party: chars.map(member),
      prompt: null,
      lastRoll: null,
      flags: {},
      xpEarned: 0,
      updatedAt: "2026-07-04T18:00:00.000Z",
      encounter,
    },
    rules: options.rules === undefined ? RULES : options.rules,
    abilities: options.abilities === undefined ? CATALOG : options.abilities,
    items: options.items === undefined ? ITEMS : options.items,
    send,
  });

  const view = render(<CombatControls />);
  return { ...view, sent, send, encounter };
}

/** The action cards, by their visible label. */
function cardNames(): string[] {
  return screen
    .queryAllByRole("button")
    .map((b) => b.textContent?.trim() ?? "")
    .filter((t) => t.length > 0);
}

const card = (name: string) => screen.getByRole("button", { name });
const tile = (x: number, y: number) =>
  screen.getByRole("button", { name: new RegExp(`column ${x + 1}, row ${y + 1}$`) });
const changeButtons = () => screen.getAllByRole("button", { name: "Change" });
const END = "End my turn";

beforeEach(() => {
  useGameStore.setState({ send: async () => true });
});
afterEach(cleanup);

// ---------------------------------------------------------------------------
// Whose turn it is
// ---------------------------------------------------------------------------

describe("whose turn it is", () => {
  it("offers nothing on somebody else's turn, and says whose", () => {
    /*
     * A second hero with a *lower* Quick would still lead sometimes on a tied
     * die, so the wisp is given the clock directly: turnIndex points at it.
     */
    const encounter = encounterWith();
    const wispIndex = encounter.order.findIndex((id) => id.startsWith("wisp"));
    mount({ encounter: { ...encounter, turnIndex: wispIndex } });

    expect(screen.getByRole("status").textContent).toContain("Bramblewisp");
    // No board, no cards — the whole input half is absent, not disabled.
    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.queryByRole("button", { name: END })).toBeNull();
  });

  it("renders nothing at all once the fight is over", () => {
    // The panel lives in PlayerPanel's prompt slot and is mounted whenever the
    // run state is; "no encounter" has to mean an empty slot, not an empty box
    // with a heading in it.
    const { container } = mount();
    const current = useGameStore.getState().state!;
    act(() => {
      useGameStore.setState({ state: { ...current, encounter: null } });
    });
    expect(container.innerHTML).toBe("");
  });

  it("shows the party's HP even when it is not your turn", () => {
    // A Party Mode phone has no other view of the board, so this row is the
    // fight's one piece of shared state a controller has to carry.
    const encounter = encounterWith();
    const wispIndex = encounter.order.findIndex((id) => id.startsWith("wisp"));
    mount({ encounter: { ...encounter, turnIndex: wispIndex } });

    const party = screen.getByRole("list", { name: "The party" });
    expect(within(party).getByText("Sparklehoof")).toBeTruthy();
    expect(party.textContent).toContain("10/10");
  });

  it("shows every enemy's HP while waiting, with the ordinal that tells them apart", () => {
    // "How is the fight going" used to need the TV or a tap into a target
    // list. Now it is the second row of every phone.
    const base = encounterWith({
      enemies: [
        { spec: wisp(), at: { x: 2, y: 2 } },
        { spec: wisp(), at: { x: 2, y: 3 } },
      ],
    });
    const hurt = {
      ...base,
      combatants: base.combatants.map((c) => (c.id === "wisp#2" ? { ...c, hp: 2 } : c)),
    };
    const wispIndex = hurt.order.findIndex((id) => id.startsWith("wisp"));
    mount({ encounter: { ...hurt, turnIndex: wispIndex } });

    const enemies = screen.getByRole("list", { name: "The enemies" });
    const rows = within(enemies).getAllByRole("listitem").map((li) => li.textContent);
    expect(rows[0]).toContain("Bramblewisp 1");
    expect(rows[0]).toContain("6/6");
    expect(rows[1]).toContain("Bramblewisp 2");
    expect(rows[1]).toContain("2/6");
  });

  it("writes each enemy's HP on its square of the board", () => {
    const { container } = mount();
    const enemyCell = container.querySelector(".combat__cell--enemy")!;
    expect(enemyCell.querySelector(".combat__cell-hp")?.textContent).toBe("6");
  });
});

// ---------------------------------------------------------------------------
// The rule: a tap on a legal thing does it
// ---------------------------------------------------------------------------

describe("a tap does the thing (spec §11)", () => {
  it("walks on the tile tap — no confirm bar, nothing else appears", async () => {
    const user = userEvent.setup();
    const { sent } = mount();

    await user.click(tile(1, 1));
    expect(sent).toEqual([{ type: "MOVE", to: { x: 1, y: 1 } }]);
    expect(screen.queryByRole("button", { name: /do it/i })).toBeNull();
  });

  it("does a card with nothing to aim on the card tap", async () => {
    const user = userEvent.setup();
    const { sent } = mount({ characters: [character({ actions: ["shout"] })] });

    await user.click(card("Shout"));
    expect(sent).toEqual([{ type: "COMBAT_ACTION", abilityId: "shout" }]);
  });

  it("offers no End turn while there is a card to play — Get Ready is how you pass", () => {
    /*
     * The turn used to end with a button and a confirm, every turn. The engine
     * now ends a spent turn itself, and before the action is spent "end my
     * turn" is a strictly worse Get Ready (same skip, no +2) — so it is not a
     * choice on the list, and an accidental skipped turn is not a tap away.
     */
    mount();
    expect(screen.getByRole("button", { name: /^Get Ready/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: END })).toBeNull();
  });

  it("offers End turn, one tap, when steps are left after the action (Twin Step)", async () => {
    const user = userEvent.setup();
    const base = encounterWith();
    const { sent } = mount({ encounter: { ...base, actionTaken: true, moveAfterAction: true } });

    expect(screen.getAllByRole("button", { name: /^Move to column/ }).length).toBeGreaterThan(0);
    expect(screen.getByText(/You can still walk 4 steps, or end your turn/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: END }));
    expect(sent).toEqual([{ type: "END_TURN" }]);
  });

  it("offers End turn when there is nothing at all to do", async () => {
    // A catalog with no Get Ready and nobody in reach: the one turn with no
    // card has to stay endable.
    const user = userEvent.setup();
    const far = encounterWith({ enemies: [{ spec: wisp(), at: { x: 4, y: 4 } }] });
    const { sent } = mount({ encounter: far, abilities: { ...CATALOG, ready: { ...CATALOG.shout!, id: "ready", name: "Nothing", target: { kind: "enemy", range: "adjacent" } } } });
    expect(screen.queryByRole("button", { name: /^Get Ready/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: END }));
    expect(sent).toEqual([{ type: "END_TURN" }]);
  });

  it("steps the tappables aside while a commit is on its way, then clears on a refusal", async () => {
    const user = userEvent.setup();
    let release = (ok: boolean): void => void ok;
    const send = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    mount({ characters: [character({ actions: ["shout"] })] });
    useGameStore.setState({ send });

    await user.click(card("Shout"));
    expect(send).toHaveBeenCalledTimes(1);
    // Nothing to double-tap: the cards and the tiles are gone, not disabled,
    // and the phone says why.
    expect(screen.queryByRole("button", { name: "Shout" })).toBeNull();
    expect(screen.queryAllByRole("button", { name: /^Move to column/ })).toEqual([]);
    expect(screen.getByText("Doing it…")).toBeTruthy();

    // A refusal (a stale phone) hands the turn back rather than sticking.
    await act(async () => {
      release(false);
    });
    expect(screen.getByRole("button", { name: "Shout" })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The aim steps
// ---------------------------------------------------------------------------

describe("aiming", () => {
  it("asks who, and the answer is the commit", async () => {
    const user = userEvent.setup();
    const { sent } = mount({ characters: [character({ actions: ["strike"] })] });

    await user.click(card("Strike"));
    expect(screen.getByText(/Strike: who\?/)).toBeTruthy();
    expect(sent).toEqual([]);

    // Enemy ids carry their placement ordinal, so "which one am I about to
    // hit" survives three identical wisps (combat-grid.ts `combatantLabel`).
    // The target button also says how many hearts it has left.
    const target = screen.getByRole("button", { name: /Bramblewisp 1/ });
    expect(target.textContent).toContain("6/6");
    await user.click(target);
    expect(sent).toEqual([
      { type: "COMBAT_ACTION", abilityId: "strike", targetId: "wisp#1" },
    ]);
  });

  it("picks two different figures for a two-target ability, and counts them", async () => {
    const user = userEvent.setup();
    const archer = character({ actions: ["volley"] });
    const { sent } = mount({
      characters: [archer],
      encounter: encounterWith({
        party: [{ character: archer, at: { x: 1, y: 2 } }],
        enemies: [
          { spec: wisp(), at: { x: 2, y: 2 } },
          { spec: wisp(), at: { x: 2, y: 3 } },
        ],
      }),
    });

    await user.click(card("Volley"));
    expect(screen.getByText(/Volley: who\? \(1 of 2\)/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Bramblewisp 1/ }));
    // The one already picked is gone from the list — the same figure twice is
    // not two targets, and the server would refuse it.
    expect(screen.getByText(/Volley: who\? \(2 of 2\)/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Bramblewisp 1/ })).toBeNull();

    // The last pick is the commit.
    await user.click(screen.getByRole("button", { name: /Bramblewisp 2/ }));

    // Several chosen things ride the *plural* field. One would ride `targetId`.
    expect(sent).toEqual([
      { type: "COMBAT_ACTION", abilityId: "volley", targetIds: ["wisp#1", "wisp#2"] },
    ]);
  });

  it("lets an up-to-N ability stop early with Go, once one is picked", async () => {
    // "Up to": the server accepts fewer. With one wisp picked and another on
    // offer, Go sends the one — through the singular field, since it is one.
    const user = userEvent.setup();
    const archer = character({ actions: ["volley"] });
    const { sent } = mount({
      characters: [archer],
      encounter: encounterWith({
        party: [{ character: archer, at: { x: 1, y: 2 } }],
        enemies: [
          { spec: wisp(), at: { x: 2, y: 2 } },
          { spec: wisp(), at: { x: 2, y: 3 } },
        ],
      }),
    });

    await user.click(card("Volley"));
    expect(screen.queryByRole("button", { name: /Go!/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Bramblewisp 1/ }));
    await user.click(screen.getByRole("button", { name: /Go!/ }));
    expect(sent).toEqual([{ type: "COMBAT_ACTION", abilityId: "volley", targetId: "wisp#1" }]);
  });

  it("collects two tiles for a two-tile ability, keeping the first one lit", async () => {
    const user = userEvent.setup();
    const { sent, container } = mount({ characters: [character({ actions: ["thorns"] })] });

    await user.click(card("Thorns"));
    expect(screen.getByText(/tap a glowing tile\. \(1 of 2\)/)).toBeTruthy();

    await user.click(tile(0, 0));
    expect(screen.getByText(/tap a glowing tile\. \(2 of 2\)/)).toBeTruthy();
    expect(container.querySelectorAll(".combat__cell--selected")).toHaveLength(1);
    // The tile just taken is no longer offered — the same square twice is one
    // wall, not two, and the server refuses the action outright.
    expect(screen.queryByRole("button", { name: "Aim at column 1, row 1" })).toBeNull();

    // The second tile completes the wall, and sends it.
    await user.click(tile(0, 1));
    expect(sent).toEqual([
      {
        type: "COMBAT_ACTION",
        abilityId: "thorns",
        targetTiles: [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
        ],
      },
    ]);
  });

  it("pairs a tile with the figures reachable from it, never recombining them", async () => {
    /*
     * Pounce lands, then swings from where it landed. The pairing is the
     * server's list (`tileTargets`); building it on the phone from "tiles" ×
     * "targets" would offer a landing spot with a victim it cannot reach.
     */
    const user = userEvent.setup();
    const cat = character({ actions: ["pounce"] });
    const { sent } = mount({
      characters: [cat],
      encounter: encounterWith({
        party: [{ character: cat, at: { x: 0, y: 0 } }],
        // Two wisps, far apart on purpose: the landing tile below is adjacent
        // to the first and nowhere near the second. A phone that built its own
        // target list from `targets` would offer both.
        enemies: [
          { spec: wisp(), at: { x: 4, y: 4 } },
          { spec: wisp(), at: { x: 4, y: 0 } },
        ],
      }),
    });

    await user.click(card("Pounce"));
    await user.click(tile(3, 4));
    expect(screen.getByText(/Pounce: who\?/)).toBeTruthy();

    // Exactly one victim is reachable from where it would land.
    const offered = screen.getAllByRole("button", { name: /Bramblewisp/ });
    expect(offered.map((b) => b.textContent)).toHaveLength(1);
    expect(offered[0]!.textContent).toContain("Bramblewisp 1");

    await user.click(offered[0]!);

    expect(sent).toEqual([
      {
        type: "COMBAT_ACTION",
        abilityId: "pounce",
        targetId: "wisp#1",
        targetTile: { x: 3, y: 4 },
      },
    ]);
  });

  it("asks one question at a time — move tiles and cards vanish while aiming", async () => {
    /*
     * The grid is the answer surface for whatever is being asked *right now*.
     * Leaving move destinations lit under a "who?" step means a tap meant for
     * the question silently walks somewhere instead — and with no confirm,
     * walks for real.
     */
    const user = userEvent.setup();
    mount({ characters: [character({ actions: ["strike", "shout"] })] });
    const moveTiles = () => screen.queryAllByRole("button", { name: /^Move to column/ });
    expect(moveTiles().length).toBeGreaterThan(0);

    await user.click(card("Strike"));
    expect(moveTiles()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Shout" })).toBeNull();
  });

  it("abandons a half-aimed ability cleanly", async () => {
    const user = userEvent.setup();
    const { sent } = mount({ characters: [character({ actions: ["thorns"] })] });

    await user.click(card("Thorns"));
    await user.click(tile(0, 0));
    await user.click(changeButtons()[0]!);

    expect(sent).toEqual([]);
    expect(screen.getByRole("button", { name: "Thorns" })).toBeTruthy();
    // The abandoned tile is no longer lit.
    expect(document.querySelectorAll(".combat__cell--selected")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Only legal taps exist
// ---------------------------------------------------------------------------

describe("only legal taps exist (§7.2)", () => {
  it("never renders a disabled control — a greyed button is a question", async () => {
    // The rule from the module header. `disabled` appears nowhere in this
    // panel: a commit in flight hides the tappables rather than greying them.
    mount({ characters: [character({ actions: ["strike", "shout"] })] });
    const disabled = screen.getAllByRole("button").filter((b) => b.hasAttribute("disabled"));
    expect(disabled).toEqual([]);
  });

  it("offers nothing once the action and the steps are gone — the engine is ending the turn", () => {
    const base = encounterWith();
    mount({ encounter: { ...base, stepsLeft: 0, actionTaken: true } });

    expect(screen.queryAllByRole("button", { name: /^Move to column/ })).toEqual([]);
    expect(screen.queryByRole("button", { name: END })).toBeNull();
    expect(cardNames()).toEqual([]);
  });

  it("offers no action cards once the action is spent", () => {
    const base = encounterWith();
    mount({
      characters: [character({ actions: ["strike"] })],
      encounter: { ...base, actionTaken: true },
    });
    expect(cardNames()).not.toContain("Strike");
  });

  it("does not offer an ability the character does not have", () => {
    mount({ characters: [character({ actions: ["strike"] })] });
    const names = cardNames();
    expect(names).toContain("Strike");
    expect(names).not.toContain("Volley");
    expect(names).not.toContain("Pounce");
  });

  it("waits for the rules and the catalog rather than guessing", () => {
    // Both ride the same content fetch. Until they land there are no cards —
    // but the board and the party are still drawn, so the phone is not blank.
    mount({ characters: [character({ actions: ["strike"] })], abilities: null });
    expect(cardNames()).not.toContain("Strike");
    expect(screen.getByRole("grid")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Items in a fight (§7.2's fourth universal action)
// ---------------------------------------------------------------------------

describe("items in a fight", () => {
  const potion = { itemId: "sunbloom_draught", kind: "consumable" as const };

  it("offers a healing draught only when it would do something", async () => {
    const hurt = encounterWith();
    const wounded = {
      ...hurt,
      combatants: hurt.combatants.map((c) => (c.side === "party" ? { ...c, hp: 4 } : c)),
    };
    const user = userEvent.setup();
    const { sent } = mount({
      characters: [character({ inventory: [potion] })],
      encounter: wounded,
    });

    await user.click(screen.getByRole("button", { name: /Use Sunbloom Draught/ }));
    expect(sent).toEqual([{ type: "USE_ITEM", itemId: "sunbloom_draught" }]);
  });

  it("hides a heal at full health — a use that changes nothing must not be offered", () => {
    mount({ characters: [character({ inventory: [potion] })] });
    expect(cardNames().some((n) => n.includes("Sunbloom"))).toBe(false);
  });

  it("hides every item once the action is spent", () => {
    const base = encounterWith();
    const wounded = {
      ...base,
      actionTaken: true,
      combatants: base.combatants.map((c) => (c.side === "party" ? { ...c, hp: 4 } : c)),
    };
    mount({ characters: [character({ inventory: [potion] })], encounter: wounded });
    expect(cardNames().some((n) => n.includes("Sunbloom"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The turn boundary
// ---------------------------------------------------------------------------

describe("the turn boundary", () => {
  it("drops a half-aimed ability when the turn moves on", async () => {
    /*
     * The dangerous one. A "who?" step left standing across a turn change is
     * a tap that commits last turn's intent against this turn's board — the
     * server would refuse it, but only after the child watched it happen.
     */
    const user = userEvent.setup();
    mount({ characters: [character({ actions: ["strike"] })] });

    await user.click(card("Strike"));
    expect(screen.getByText(/Strike: who\?/)).toBeTruthy();

    // The same turn, one step spent: still a new question. Wrapped in `act` so
    // the store write and the effect it triggers land before the assertion —
    // a server patch arrives the same way, outside React's own event handling.
    const current = useGameStore.getState().state!;
    act(() => {
      useGameStore.setState({
        state: {
          ...current,
          encounter: { ...current.encounter!, stepsLeft: current.encounter!.stepsLeft - 1 },
        },
      });
    });

    expect(screen.queryByText(/Strike: who\?/)).toBeNull();
    expect(screen.getByRole("button", { name: "Strike" })).toBeTruthy();
  });

  it("lets go of a sent move once its patch lands", async () => {
    // The tappables step aside while the move is on its way; the patch that
    // spends the step is a new question, and they come back for it.
    const user = userEvent.setup();
    mount();
    await user.click(tile(1, 1));
    expect(screen.queryAllByRole("button", { name: /^Move to column/ })).toEqual([]);

    const current = useGameStore.getState().state!;
    act(() => {
      useGameStore.setState({
        state: {
          ...current,
          encounter: { ...current.encounter!, stepsLeft: current.encounter!.stepsLeft - 1 },
        },
      });
    });
    expect(screen.queryAllByRole("button", { name: /^Move to column/ }).length).toBeGreaterThan(0);
  });

  it("drops a pending selection when the clock hands on to somebody else", async () => {
    const user = userEvent.setup();
    mount({ characters: [character({ actions: ["strike"] })] });

    await user.click(card("Strike"));
    expect(screen.getByText(/Strike: who\?/)).toBeTruthy();

    const current = useGameStore.getState().state!;
    const wispIndex = current.encounter!.order.findIndex((id) => id.startsWith("wisp"));
    act(() => {
      useGameStore.setState({
        state: { ...current, encounter: { ...current.encounter!, turnIndex: wispIndex } },
      });
    });

    expect(screen.queryByText(/Strike: who\?/)).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Bramblewisp");
  });
});

// ---------------------------------------------------------------------------
// What just happened — the roll, shown
// ---------------------------------------------------------------------------

describe("what just happened", () => {
  const roll = (over: Partial<import("@kad/shared").DiceRoll> = {}): import("@kad/shared").DiceRoll => ({
    die: 14,
    mod: 3,
    total: 17,
    tn: 11,
    result: "hit",
    characterId: "c_hero",
    stat: "might",
    ...over,
  });

  it("reads a roll out the way the table would", () => {
    expect(rollWords(roll())).toBe("14 + 3 Might = 17 against 11");
    expect(rollWords(roll({ mod: 0, total: 14, stat: undefined }))).toBe("14 = 14 against 11");
    expect(rollWords(roll({ mod: -1, total: 13, stat: undefined }))).toBe("14 - 1 = 13 against 11");
  });

  it("names the viewer You, everyone else by name, and says who took what", () => {
    const encounter = encounterWith();
    const beats = describeBeats(
      [
        { type: "roll", roll: roll() },
        { type: "damage", actorId: "wisp#1", amount: 3, hp: 3 },
        { type: "roll", roll: roll({ characterId: "wisp#1", die: 4, mod: 3, total: 7, tn: 12, result: "miss", stat: undefined }) },
        { type: "moved", actorId: "wisp#1", to: { x: 0, y: 0 } },
        { type: "down", actorId: "c_hero" },
      ],
      encounter,
      "c_hero",
      7,
    );
    expect(beats.map((b) => b.text)).toEqual([
      "You rolled 14 + 3 Might = 17 against 11. Hit!",
      "Bramblewisp 1 takes 3. 3 left.",
      "Bramblewisp 1 rolled 4 + 3 = 7 against 12. Miss!",
      "You are knocked down!",
    ]);
    // Good news green, bad news red (shape and words carry it too: spec §11).
    expect(beats.map((b) => b.tone)).toEqual(["good", "good", "plain", "bad"]);
  });

  it("shows the last beat on the phone, and the d20 as its parts", () => {
    const encounter = encounterWith();
    const wispIndex = encounter.order.findIndex((id) => id.startsWith("wisp"));
    mount({ encounter: { ...encounter, turnIndex: wispIndex } });

    act(() => {
      useGameStore.setState({
        presentation: {
          seq: 9,
          presentation: {
            kind: "COMBAT_SEQUENCE",
            events: [
              { type: "roll", roll: roll({ characterId: "wisp#1", die: 16, mod: 3, total: 19, tn: 12, stat: undefined }) },
              { type: "damage", actorId: "c_hero", amount: 3, hp: 7 },
            ],
          },
        },
      });
    });

    const log = screen.getByRole("list", { name: "What just happened" });
    expect(log.textContent).toContain("Bramblewisp 1");
    expect(log.textContent).toContain("16");
    expect(log.textContent).toContain("+ 3");
    expect(log.textContent).toContain("= 19");
    expect(log.textContent).toContain("vs 12");
    expect(log.textContent).toContain("Hit!");
    expect(log.textContent).toContain("You take 3. 7 left.");
  });
});
