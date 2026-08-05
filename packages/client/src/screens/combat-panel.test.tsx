// @vitest-environment jsdom
/**
 * CombatControls — the select→(aim→)confirm walk, driven through a real DOM.
 *
 * `screens.test.tsx` proves this panel *renders*. That is a low bar for a
 * 600-line state machine whose entire job is what happens between taps, and it
 * is the wrong bar for the rule the panel exists to enforce: **nothing commits
 * until "Do it!"** (spec §11). A misfire here is a child's turn spent on the
 * wrong tile, which is the most upsetting failure the game has.
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
import { CombatControls } from "./CombatPanel";

const RULES: RulesContent = makeRules();
const ITEMS: ItemCatalog = makeItems();

/**
 * Written for the *shapes* the panel walks, one ability per shape, because the
 * branches under test are "how many things must be picked and in what order":
 *
 *   strike       — a figure, one of them          (target → confirm)
 *   volley       — two different figures          (target → target → confirm)
 *   thorns       — two tiles                      (tile → tile → confirm)
 *   pounce       — a tile, then a figure from it  (tile → tile-target → confirm)
 *   shout        — nothing at all                 (confirm)
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
    .getAllByRole("button")
    .map((b) => b.textContent?.trim() ?? "")
    .filter((t) => t.length > 0);
}

const card = (name: string) => screen.getByRole("button", { name });
const tile = (x: number, y: number) =>
  screen.getByRole("button", { name: new RegExp(`column ${x + 1}, row ${y + 1}$`) });
const doIt = () => screen.getByRole("button", { name: "Do it!" });
const changeButtons = () => screen.getAllByRole("button", { name: "Change" });

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
    expect(screen.queryByRole("button", { name: "End turn" })).toBeNull();
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
});

// ---------------------------------------------------------------------------
// The rule: nothing commits until "Do it!"
// ---------------------------------------------------------------------------

describe("select then confirm (spec §11)", () => {
  it("sends nothing when a tile is tapped — only the confirm commits", async () => {
    const user = userEvent.setup();
    const { sent } = mount();

    await user.click(tile(1, 1));
    expect(sent).toEqual([]);
    // The confirm bar names the tile in the same words the button did.
    expect(doIt()).toBeTruthy();
    expect(screen.getByText(/Move to column 2, row 2/)).toBeTruthy();

    await user.click(doIt());
    expect(sent).toEqual([{ type: "MOVE", to: { x: 1, y: 1 } }]);
  });

  it("sends nothing when an action card is tapped", async () => {
    const user = userEvent.setup();
    const { sent } = mount({ characters: [character({ actions: ["shout"] })] });

    await user.click(card("Shout"));
    expect(sent).toEqual([]);
    await user.click(doIt());
    expect(sent).toEqual([{ type: "COMBAT_ACTION", abilityId: "shout" }]);
  });

  it("confirms End turn rather than firing it, since it hands control away", async () => {
    /*
     * The one tap that looks like it should be immediate. It is not, and
     * deliberately: an accidental skipped turn is the most upsetting misfire
     * available, and it cannot be taken back.
     */
    const user = userEvent.setup();
    const { sent } = mount();

    await user.click(card("End turn"));
    expect(sent).toEqual([]);
    expect(screen.getByText("End the turn")).toBeTruthy();

    await user.click(doIt());
    expect(sent).toEqual([{ type: "END_TURN" }]);
  });

  it("takes a selection back with Change, sending nothing", async () => {
    const user = userEvent.setup();
    const { sent } = mount();

    await user.click(tile(1, 1));
    await user.click(screen.getByRole("button", { name: "Change" }));

    expect(sent).toEqual([]);
    expect(screen.queryByRole("button", { name: "Do it!" })).toBeNull();
    // And the cards are back, so the turn is not stuck.
    expect(screen.getByRole("button", { name: "End turn" })).toBeTruthy();
  });

  it("holds the commit open while it is in flight, then lets go", async () => {
    const user = userEvent.setup();
    let release = (): void => undefined;
    const send = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    mount();
    useGameStore.setState({ send });

    await user.click(tile(1, 1));
    await user.click(doIt());

    // Double-tapping "Do it!" must not send the move twice.
    const sending = screen.getByRole("button", { name: "Sending…" });
    expect(sending.hasAttribute("disabled")).toBe(true);
    await user.click(sending);
    expect(send).toHaveBeenCalledTimes(1);

    release();
  });
});

// ---------------------------------------------------------------------------
// The aim steps
// ---------------------------------------------------------------------------

describe("aiming", () => {
  it("asks who, then confirms — and names the figure it will hit", async () => {
    const user = userEvent.setup();
    const { sent } = mount({ characters: [character({ actions: ["strike"] })] });

    await user.click(card("Strike"));
    expect(screen.getByText(/Strike — who\?/)).toBeTruthy();
    expect(sent).toEqual([]);

    // Enemy ids carry their placement ordinal, so "which one am I about to
    // hit" survives three identical wisps (combat-grid.ts `combatantLabel`).
    await user.click(screen.getByRole("button", { name: /Bramblewisp 1/ }));
    expect(screen.getByText("Strike — Bramblewisp 1")).toBeTruthy();

    await user.click(doIt());
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
    expect(screen.getByText(/Volley — who\? \(1 of 2\)/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Bramblewisp 1/ }));
    // The one already picked is gone from the list — the same figure twice is
    // not two targets, and the server would refuse it.
    expect(screen.getByText(/Volley — who\? \(2 of 2\)/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Bramblewisp 1/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: /Bramblewisp 2/ }));
    await user.click(doIt());

    // Several chosen things ride the *plural* field. One would ride `targetId`.
    expect(sent).toEqual([
      { type: "COMBAT_ACTION", abilityId: "volley", targetIds: ["wisp#1", "wisp#2"] },
    ]);
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

    await user.click(tile(0, 1));
    await user.click(doIt());
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
    expect(screen.getByText(/Pounce — who\?/)).toBeTruthy();

    // Exactly one victim is reachable from where it would land.
    const offered = screen.getAllByRole("button", { name: /Bramblewisp/ });
    expect(offered.map((b) => b.textContent)).toHaveLength(1);
    expect(offered[0]!.textContent).toContain("Bramblewisp 1");

    await user.click(offered[0]!);
    await user.click(doIt());

    expect(sent).toEqual([
      {
        type: "COMBAT_ACTION",
        abilityId: "pounce",
        targetId: "wisp#1",
        targetTile: { x: 3, y: 4 },
      },
    ]);
  });

  it("asks one question at a time — move tiles vanish while aiming or confirming", async () => {
    /*
     * The grid is the answer surface for whatever is being asked *right now*.
     * Leaving move destinations lit under a "who?" step or a confirm bar means
     * a tap meant for the question silently becomes a different selection —
     * and the child never sees which one she made until it commits.
     */
    const user = userEvent.setup();
    mount({ characters: [character({ actions: ["strike"] })] });
    const moveTiles = () => screen.queryAllByRole("button", { name: /^Move to column/ });
    expect(moveTiles().length).toBeGreaterThan(0);

    // Aiming at a figure.
    await user.click(card("Strike"));
    expect(moveTiles()).toEqual([]);

    // And with the confirm bar up.
    await user.click(screen.getByRole("button", { name: /Bramblewisp 1/ }));
    expect(screen.getByRole("button", { name: "Do it!" })).toBeTruthy();
    expect(moveTiles()).toEqual([]);
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
    /*
     * The rule from the module header. `disabled` appears in exactly one place
     * in this panel, on "Do it!" while a send is in flight, and that one is a
     * double-tap guard rather than an unavailable choice.
     */
    mount({ characters: [character({ actions: ["strike", "shout"] })] });
    const disabled = screen.getAllByRole("button").filter((b) => b.hasAttribute("disabled"));
    expect(disabled).toEqual([]);
  });

  it("stops offering tiles once the action and the steps are gone", () => {
    const base = encounterWith();
    mount({ encounter: { ...base, stepsLeft: 0, actionTaken: true } });

    expect(screen.queryAllByRole("button", { name: /^Move to column/ })).toEqual([]);
    expect(screen.getByText("Action spent")).toBeTruthy();
    // End turn is still there: the turn has to be endable.
    expect(screen.getByRole("button", { name: "End turn" })).toBeTruthy();
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
    expect(sent).toEqual([]);
    await user.click(doIt());
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
  it("drops a pending selection when the turn moves on", async () => {
    /*
     * The dangerous one. A confirm bar left standing across a turn change is a
     * tap that commits last turn's intent against this turn's board — the
     * server would refuse it, but only after the child watched it happen.
     */
    const user = userEvent.setup();
    mount();

    await user.click(tile(1, 1));
    expect(screen.getByRole("button", { name: "Do it!" })).toBeTruthy();

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

    expect(screen.queryByRole("button", { name: "Do it!" })).toBeNull();
    expect(screen.getByRole("button", { name: "End turn" })).toBeTruthy();
  });

  it("drops a pending selection when the clock hands on to somebody else", async () => {
    const user = userEvent.setup();
    mount({ characters: [character({ actions: ["strike"] })] });

    await user.click(card("Strike"));
    expect(screen.getByText(/Strike — who\?/)).toBeTruthy();

    const current = useGameStore.getState().state!;
    const wispIndex = current.encounter!.order.findIndex((id) => id.startsWith("wisp"));
    act(() => {
      useGameStore.setState({
        state: { ...current, encounter: { ...current.encounter!, turnIndex: wispIndex } },
      });
    });

    expect(screen.queryByRole("button", { name: "Do it!" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Bramblewisp");
  });
});
