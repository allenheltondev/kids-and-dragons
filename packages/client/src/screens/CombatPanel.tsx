/**
 * CombatControls — PlayerView's half of a fight (spec §7.2, §11).
 *
 * The Pixi board on the WorldView is the spectacle; this is the *input*. A DOM
 * grid of buttons is the right tool for that: 44px-ish targets, accessible
 * names, and — the rule that shapes everything here — only legal taps exist.
 * Reachable tiles come from `legalMoves`, action cards from `legalActions`,
 * both the exact functions the server re-runs to validate (encounter.ts);
 * everything else is an inert cell or simply absent. Nothing is ever disabled:
 * a greyed-out button is a question an eight-year-old has to ask somebody.
 * The one dimmed moment is right after a tap: the cards stay where they were,
 * inert, under "Doing it…", until the board catches up (see `pending`).
 *
 * A tap *does* the thing. A gold square walks you there; a card with nothing
 * to aim does it; a card that needs aiming asks "who?" or "where?", and the
 * answer is the commit. There is no confirm bar: an attack used to be five
 * taps (card, target, Do it!, End turn, Do it!) and the last three were pure
 * ceremony, because §7.2's "move, then one action" leaves nothing to decide
 * after the action. The engine now ends a spent turn on its own
 * (`finishTurnIfSpent`), so End Turn appears only when a player is giving
 * something up — steps left after acting, or nothing worth doing.
 *
 * The one pause is for reading. Packed two or three to a row, a card has room
 * for its name and not for what it does, and a playtest found four nameless
 * cards hard to choose between. So a packed card's first tap puts its
 * sentence on a line over the cards, and Go! (or the same card again) does
 * it; an aimed card's who? step was already that pause, and says it too.
 *
 * What makes a single tap safe is what is *on* the surface being tapped: the
 * only figures listed are ones the ability can legally hit, a wrong gold
 * square costs a step or two, and a mis-aimed ability still lands on a
 * monster. The one real risk, a turn skipped by accident, is gone with the
 * button that caused it: Get Ready is the way to pass, and it does something.
 *
 * Renders inside PlayerPanel's prompt slot whenever `state.encounter` exists.
 * The board is always drawn, on every phone, on every turn: with every
 * figure's hearts in its corner it is the fight's whole shared state (a Party
 * Mode phone has no other view of it), and a turn spent looking at a blank
 * pane is a turn not spent planning the next one. On your turn its squares
 * become the taps; on anybody else's it is a map to think over. Above it,
 * what just happened, in one line: the newest swing with its sum and the
 * Guard it needed, because a d20 that nobody sees is not a d20. The running
 * log is the shared screen's (FightLog), so the phone keeps only that line.
 *
 * The board keeps its size for the whole turn. It takes whatever height the
 * pane has left, so anything around it that grew or shrank on a tap used to
 * resize the map under the finger aiming at it. So everything around it has a
 * seat that does not change: the title row, the log line, the legend, and the
 * dock under the board — one line for the hint or the question, the packed
 * cards' sentence line, and the cards below it, held at the tallest they
 * have been this turn.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, ReactElement, ReactNode, RefObject } from "react";
import type {
  AbilityCatalog,
  ClientIntent,
  Combatant,
  EncounterEvent,
  EncounterState,
  IntentPreview,
  ItemDef,
  LegalAction,
  Position,
} from "@kad/shared";
import {
  UNIVERSAL_ABILITIES,
  combatantById,
  combatTurnAway,
  currentActor,
  currentActorId,
  environmentView,
  legalActions,
  legalItemTargets,
  legalMoves,
  samePosition,
} from "@kad/shared";
import {
  useAbilities,
  useChapter,
  useItems,
  useMe,
  useParty,
  usePresentation,
  useRules,
  useRunState,
  useSend,
  useSharePreview,
} from "../store";
import { combatContext } from "../store/combat";
import { useEnsureChapter } from "./content";
import { Button } from "../ui/Button";
import { CharacterPortrait } from "./CharacterPortrait";
import { Icon } from "./icons";
import { BuffList, combatBuffRows } from "./BuffList";
import { PUFFED_HINT, PUFFED_WORDS } from "./buff-copy";
import { describeBeats, type Beat } from "./fight-log";
import { isNumbedHero } from "./combat-grid";
import {
  combatantIcon,
  combatantLabel,
  enemyPortraitUrl,
  gridCells,
  turnKey,
  type GridFeature,
  type GridOccupant,
} from "./combat-grid";
import {
  CAPTIVE_ICON,
  CLOCK_ICON,
  EXIT_ICON,
  clockLine,
  exitLine,
  hazardIcon,
  hazardLine,
  modifierIcon,
  modifierLine,
  objectiveIcon,
  objectiveLine,
  rescueLine,
  tileWords,
} from "./environment-copy";
import type { Facing } from "../world/board-math";
import { helpAttrs } from "../help/longpress";
import "./shared.css";
import "./CombatPanel.css";

/**
 * What has been tapped so far this turn. One machine rather than scattered
 * booleans, because the legal *next* taps depend entirely on where in the
 * select→(aim→)commit walk we are. Every state here is "still aiming": the
 * moment enough is picked, the intent is sent and the machine goes idle.
 */
type Selection =
  | { step: "idle" }
  /** An ability that needs figures picked — one, or up to `maxTargets`. */
  | { step: "target"; action: LegalAction; picked: readonly string[] }
  /** An ability that needs tiles picked — one, or exactly `tileCount`. */
  | { step: "tile"; action: LegalAction; picked: readonly Position[] }
  /** Pounce and friends: tile picked, now the figure reachable from it. */
  | { step: "tile-target"; action: LegalAction; tile: Position }
  /** A thrown consumable, waiting on a monster to land on. */
  | { step: "item-target"; itemId: string }
  /** The "Use an item" card, opened: the bag's usable items, in place. */
  | { step: "items" }
  /**
   * A packed card with nothing to aim, tapped once: its sentence is up over
   * the cards, and Go! (or the same card again) does it. Only when the cards
   * are packed two or three to a row; a card with room for its sentence
   * still does it on the tap.
   */
  | { step: "read"; action: LegalAction }
  /** The same, for a consumable that needs no aiming; `fromBag` keeps the opened bag up. */
  | { step: "read-item"; itemId: string; fromBag: boolean };

const IDLE: Selection = { step: "idle" };

/** More cards than this and the bag folds into one "Use an item" card. */
const MAX_LOOSE_CARDS = 6;

/**
 * Cards to a row, by how many there are: one or two keep their sentence on a
 * row each; three or four go two to a row; five or more go three to a row,
 * icon over name. Every row a card list adds is a row the board gives up,
 * and a pane that scrolls is the one thing the turn screen must not do.
 *
 * Packed cards have no room for their sentence, so it moves to a line of its
 * own over the cards (`packed` below): a tap on a packed card reads it out
 * there first, and Go! (or the same card again) does it. Every sentence on
 * every card was tried and measured first; three rows of them pushed the
 * board to its floor and the last row off a 390px phone.
 */
export function cardColumns(count: number): 1 | 2 | 3 {
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  return 3;
}

/**
 * Drawn but unseen: the style for something that comes and goes inside a
 * seat that must not. `visibility` keeps its room and takes it out of the
 * tab order and the screen reader's reading, so nothing beside it moves.
 */
function seat(shown: boolean): CSSProperties | undefined {
  return shown ? undefined : { visibility: "hidden" };
}

/**
 * One turn, start to finish: which fight, whose turn, which round. Unlike
 * `turnKey` it does not change when a step or the action is spent, because
 * what hangs off it (the card columns, the dock's height) must hold still
 * across exactly those taps.
 */
function turnOf(encounter: EncounterState | null): string {
  if (!encounter) return "none";
  return [encounter.startedAt, currentActorId(encounter), encounter.round, encounter.turnIndex].join(":");
}

export function CombatControls(): ReactElement | null {
  const state = useRunState();
  const me = useMe();
  const party = useParty();
  const rules = useRules();
  const abilities = useAbilities();
  const items = useItems();
  const send = useSend();

  const [selection, setSelection] = useState<Selection>(IDLE);
  /*
   * The facing each figure was last drawn with, for this fight only. Ids
   * repeat from one fight to the next (heroes always, `wisp#1` often), so a
   * facing kept past the fight it was earned in would start the next one
   * turned for no reason; the TV board starts each fight fresh too.
   */
  const lastFacing = useRef<{ fight: number | null; facing: Record<string, Facing> }>({
    fight: null,
    facing: {},
  });
  /**
   * A commit is on its way, or has landed on the server and its patch has not
   * reached this phone yet (a combat beat holds the patch for up to a few
   * seconds, world/presentation.ts). Either way the board is no longer the one
   * the next tap would be made against, so nothing takes a tap until the turn
   * key changes: the gold squares go, and the cards stay where they are but
   * inert. Taking the cards away instead shrank the dock and grew the board on
   * every step, then put them back with their deal-in replayed. A refused
   * send clears it, so the turn is never stuck.
   */
  const [pending, setPending] = useState(false);
  /*
   * The same flag, readable the instant it is set. Two taps can land before
   * React re-renders — on Go!, on a card, on anything in the dock — and the
   * second one still runs the first render's handler, where `pending` is
   * false. This is what makes a commit go out once.
   */
  const sending = useRef(false);
  /*
   * Cards to a row, held for the turn. Stepping beside a monster adds Attack
   * and stepping away takes it off, which re-dealt every card into a new
   * shape mid-turn. The count only goes up within a turn: a card leaving
   * never re-deals the rest, and a card arriving adds a column at most once.
   */
  const columnsSeen = useRef<{ turn: string; columns: 1 | 2 | 3 }>({ turn: "", columns: 1 });
  const dockRef = useRef<HTMLDivElement>(null);
  // The grid draws each monster's portrait, which hangs off the chapter. A
  // Party Mode phone draws no board of its own, so nothing else fetched it.
  useEnsureChapter();

  const encounter = state?.encounter ?? null;
  // A new question always starts from a clean slate — a selection made against
  // last turn's board must never be committed against this one.
  const key = turnKey(encounter);
  useEffect(() => {
    setSelection(IDLE);
    setPending(false);
    sending.current = false;
  }, [key]);

  const dispatch = useCallback(
    async (intent: ClientIntent) => {
      if (sending.current) return;
      sending.current = true;
      setPending(true);
      setSelection(IDLE);
      const ok = await send(intent);
      if (!ok) {
        sending.current = false;
        setPending(false);
      }
    },
    [send],
  );

  // What the TV lights up while this phone is still aiming (§11's "what are
  // you about to do", shown to the table). Read off the same selection.
  useSharePreview(previewOf(selection));

  const beats = useBeats(encounter, me?.character.id ?? null);
  useTallestThisTurn(dockRef, turnOf(encounter));

  if (!encounter || !me) return null;

  const active = currentActor(encounter);
  const myTurn = active !== null && active.side === "party" && active.id === me.character.id;
  const deciding = myTurn && !pending;
  // A friend's turn, and their phone is gone (#258): anybody here can pass it.
  const standIn = !myTurn && state !== null && combatTurnAway(state);

  // The rules boundary, verbatim (see the header). The catalog rides the same
  // content fetch as the rules; until both land the cards simply wait. Read on
  // the whole turn, pending or not: while a tap is on its way the cards are
  // the ones it was made from, still on screen and inert (see `pending`).
  const actions =
    myTurn && rules && abilities ? legalActions(encounter, combatContext(rules, abilities)) : [];
  const moves = myTurn ? legalMoves(encounter) : [];
  // The gold squares, though, go the moment a tap is on its way.
  const walkTiles = deciding && selection.step === "idle" ? moves : [];

  // What the grid offers this render: move destinations, or the still-unpicked
  // tiles of the ability being aimed. Never both — one question at a time.
  const tappable: readonly (Position & { readonly cost?: number })[] =
    selection.step === "tile"
      ? selection.action.tiles.filter(
          (tile) => !selection.picked.some((p) => samePosition(p, tile)),
        )
      : walkTiles;
  const selectedTiles: readonly Position[] =
    selection.step === "tile"
      ? selection.picked
      : selection.step === "tile-target"
        ? [selection.tile]
        : [];

  // The facing each figure was last drawn with, so a figure straight above
  // or below its nearest foe keeps it, exactly as the TV board does.
  const fight = encounter.startedAt ?? null;
  if (lastFacing.current.fight !== fight) lastFacing.current = { fight, facing: {} };
  const cells = gridCells(encounter, party, tappable, selectedTiles, lastFacing.current.facing);
  for (const cell of cells) if (cell.occupant) lastFacing.current.facing[cell.occupant.id] = cell.occupant.facing;

  // The consumables this turn could spend the action on (§7.2's fourth
  // universal action). Hidden, never disabled: gone once the action is spent,
  // and a card whose use the server would refuse — a thrown item with no
  // monster in range, a heal at full health, a bonus no better than the one
  // in place — never appears at all (useItemInCombat's exact refusals).
  const throwTargets = myTurn ? legalItemTargets(encounter, me.character.id) : [];
  const myCombatant = combatantById(encounter, me.character.id);
  // One card per kind of item, however many of it are in the bag: two
  // Sunbloom Draughts are one choice, and a second card for the same thing
  // is a row the pane has to find room for.
  const usableItems: { itemId: string; def: ItemDef; count: number }[] = [];
  if (myTurn && !encounter.actionTaken && myCombatant) {
    for (const entry of me.character.inventory) {
      const def = items?.[entry.itemId];
      const effect = def?.effect;
      if (!def || entry.kind !== "consumable" || !effect) continue;
      if (effect.type === "damage" && throwTargets.length === 0) continue;
      if (effect.type === "heal" && myCombatant.hp >= myCombatant.maxHp) continue;
      if (effect.type === "rollBonus" && effect.amount <= myCombatant.rollBonus) continue;
      const seen = usableItems.find((u) => u.itemId === entry.itemId);
      if (seen) seen.count += 1;
      else usableItems.push({ itemId: entry.itemId, def, count: 1 });
    }
  }
  /*
   * How the cards are laid out, so they always fit under the board (see
   * the CSS: the board takes whatever height is left). Up to six cards show
   * as they are; past that the bag folds into one "Use an item" card that
   * opens in place, which caps a level-9 hero with a full bag at nine cards:
   * three rows of three.
   */
  const bagFolded = usableItems.length > 1 && actions.length + usableItems.length > MAX_LOOSE_CARDS;
  const cardCount = actions.length + (bagFolded ? 1 : usableItems.length);
  const thisTurn = turnOf(encounter);
  if (columnsSeen.current.turn !== thisTurn) columnsSeen.current = { turn: thisTurn, columns: 1 };
  const columns = Math.max(columnsSeen.current.columns, cardColumns(cardCount)) as 1 | 2 | 3;
  columnsSeen.current.columns = columns;
  /*
   * Cards packed two or three to a row have room for a name, not for what
   * the card does. A playtest found that hard ("when you have 4+ options it
   * hides the descriptions"), so packed cards get one shared line over them
   * that says the sentence of whichever card was tapped, and a tap on a
   * packed card reads it there first: an aimed card already asks who? or
   * where? before anything happens, and now says what it does beside the
   * question; a card with nothing to aim waits for Go!. Two lines, held for
   * the turn, which costs the board less than a sentence on every card.
   */
  const packed = columns > 1;
  const bagPacked = cardColumns(usableItems.length) > 1;

  function commitAction(
    action: LegalAction,
    targetIds: readonly string[] = [],
    tiles: readonly Position[] = [],
  ): void {
    // One chosen thing rides the singular field, several ride the plural —
    // the two wire shapes the engine reads in that order.
    void dispatch({
      type: "COMBAT_ACTION",
      abilityId: action.abilityId,
      ...(targetIds.length === 1 ? { targetId: targetIds[0] as string } : {}),
      ...(targetIds.length > 1 ? { targetIds: [...targetIds] } : {}),
      ...(tiles.length === 1 ? { targetTile: tiles[0] as Position } : {}),
      ...(tiles.length > 1 ? { targetTiles: [...tiles] } : {}),
    });
  }

  function commitItem(itemId: string, targetId?: string): void {
    void dispatch({ type: "USE_ITEM", itemId, ...(targetId ? { targetId } : {}) });
  }

  function tapTile(at: Position): void {
    if (selection.step === "tile") {
      const action = selection.action;
      // Pounce pairs the tile with a follow-up figure; the pairing is the
      // server's list, never recombined here (encounter.ts tileTargets).
      if (action.tileTargets) {
        setSelection({ step: "tile-target", action, tile: at });
        return;
      }
      // Bramble Wall wants two tiles: keep collecting until the card's count
      // is met, and the last one does it.
      const picked = [...selection.picked, at];
      if (picked.length >= (action.tileCount ?? 1)) {
        commitAction(action, [], picked);
      } else {
        setSelection({ step: "tile", action, picked });
      }
      return;
    }
    // A gold square walks you there. The step is cheap and the next square
    // is still a tap away, which is what makes this safe without a confirm.
    void dispatch({ type: "MOVE", to: at });
  }

  /** The packed card whose sentence is up (see `packed`). */
  function picked(action: LegalAction): boolean {
    return selection.step === "read" && selection.action.abilityId === action.abilityId;
  }

  function tapAction(action: LegalAction): void {
    if (action.tiles.length > 0) {
      setSelection({ step: "tile", action, picked: [] });
      return;
    }
    if (action.needsTarget) {
      setSelection({ step: "target", action, picked: [] });
      return;
    }
    // A packed card says what it does before it does it (see `packed`).
    if (packed && !picked(action)) {
      setSelection({ step: "read", action });
      return;
    }
    commitAction(action);
  }

  function tapItem(itemId: string, def: ItemDef): void {
    if (def.effect?.type === "damage") {
      setSelection({ step: "item-target", itemId });
      return;
    }
    // From the opened bag, the bag's own packing decides (it has its own count).
    const fromBag = selection.step === "items" || (selection.step === "read-item" && selection.fromBag);
    if ((fromBag ? bagPacked : packed) && !(selection.step === "read-item" && selection.itemId === itemId)) {
      setSelection({ step: "read-item", itemId, fromBag });
      return;
    }
    commitItem(itemId);
  }

  function tapTarget(targetId: string): void {
    if (selection.step === "target") {
      // Storm of Blades picks up to `maxTargets` different figures; everything
      // else goes on the first. "Up to": the server accepts fewer, so a Go
      // button offers to stop early, and running out of pickable figures
      // counts as done.
      const action = selection.action;
      const picked = [...selection.picked, targetId];
      const need = Math.min(action.maxTargets ?? 1, action.targets.length);
      if (picked.length >= need) {
        commitAction(action, picked);
      } else {
        setSelection({ step: "target", action, picked });
      }
      return;
    }
    if (selection.step === "tile-target") {
      commitAction(selection.action, [targetId], [selection.tile]);
      return;
    }
    if (selection.step === "item-target") {
      commitItem(selection.itemId, targetId);
    }
  }

  /** The figures pickable right now, already filtered by the server's list. */
  const targetIds: readonly string[] =
    selection.step === "target"
      ? selection.action.targets.filter((id) => !selection.picked.includes(id))
      : selection.step === "tile-target"
        ? (selection.action.tileTargets?.find((o) => samePosition(o.tile, selection.tile))
            ?.targets ?? [])
        : selection.step === "item-target"
          ? throwTargets
          : [];

  /** What the who-step is aiming — an ability, or a thrown item. */
  const aimingWho =
    selection.step === "target" || selection.step === "tile-target"
      ? { icon: selection.action.icon, name: selection.action.name }
      : selection.step === "item-target"
        ? {
            icon: items?.[selection.itemId]?.icon ?? "consumable",
            name: items?.[selection.itemId]?.name ?? "the item",
          }
        : null;

  const partyCombatants = encounter.combatants.filter((c) => c.side === "party");
  const enemyCombatants = encounter.combatants.filter((c) => c.side === "enemy");

  /*
   * When ending the turn is a real choice. After the action the engine ends
   * the turn itself unless Twin Step left steps to spend; before it, Get
   * Ready is the way to pass and it does something, so the button would be a
   * worse card on the same list. It stays as the way out of a turn with
   * nothing on it at all (no card, no item), which a catalog could produce.
   */
  const canEnd =
    myTurn &&
    (selection.step === "idle" || selection.step === "read" || selection.step === "read-item") &&
    ((encounter.actionTaken && moves.length > 0) ||
      (!encounter.actionTaken && actions.length === 0 && usableItems.length === 0));

  const hint = pending
    ? "Doing it…"
    : !deciding
      ? null
      : encounter.actionTaken
        ? moves.length > 0
          ? `You can still walk ${encounter.stepsLeft} step${encounter.stepsLeft === 1 ? "" : "s"}, or end your turn.`
          : null
        : moves.length > 0
          ? "Walk on a gold square, or pick one thing."
          : "Pick one thing to do.";

  const inBag = selection.step === "items" || (selection.step === "read-item" && selection.fromBag);

  /*
   * The packed cards' shared line: what the tapped card does, in the card's
   * own sentence; before any tap, how to read one. The bag, opened, packs
   * its items by their own count.
   */
  const reading: { text: string; quiet: boolean } | null = !(inBag ? bagPacked : packed) || encounter.actionTaken
    ? null
    : selection.step === "read" || selection.step === "target" || selection.step === "tile" || selection.step === "tile-target"
      ? { text: summaryOf(selection.action.abilityId, abilities) ?? selection.action.name, quiet: false }
      : selection.step === "read-item" || selection.step === "item-target"
        ? { text: items?.[selection.itemId] ? itemSummary(items[selection.itemId]!) : "", quiet: false }
        : { text: selection.step === "items" ? "Tap an item to see what it does." : "Tap a card to see what it does.", quiet: true };

  // How many figures the who-step offers in all, picked or not, so the list
  // keeps its columns while picks leave it.
  const targetPool =
    selection.step === "target" ? selection.action.targets.length : targetIds.length;

  return (
    <div className="prompt combat">
      {/* The title row and the waiting line swap at every turn, in a seat of
          the same height (CombatPanel.css), so neither moves the board. */}
      {myTurn ? (
        <h3 className="prompt__title combat__title">
          <Icon name="swords" />
          <span className="combat__line">Your turn, {me.character.name}!</span>
          {/* Steps left, kept on the row when there are none to spend; the
              "s" keeps its room at 1 step, so 2 → 1 does not shift a thing. */}
          <span className="kad-chip combat__steps" style={seat(!encounter.actionTaken || moves.length > 0)}>
            <Icon name="steps" />
            {/* One span: the chip is a flex row, and a bare "s" beside it was
                its own item, set off by the chip's gap as "step s". */}
            <span>
              {encounter.stepsLeft} step<span style={seat(encounter.stepsLeft !== 1)}>s</span>
            </span>
          </span>
        </h3>
      ) : (
        <p className="player__waiting combat__waiting" role="status">
          <Icon name="waiting" />
          <span className="combat__line">
            {active
              ? active.side === "party"
                ? standIn
                  ? `${combatantLabel(active)} stepped away.`
                  : `It's ${combatantLabel(active)}'s turn.`
                : `${combatantLabel(active)} is taking its turn…`
              : "The dust is settling…"}
          </span>
        </p>
      )}

      {/* Rift powers on this phone's hero (#200), graph campaigns only: what
          each adds and how long it lasts. A numbing sting (#227) shows here
          too, as Numbed. Absent in every fight with neither, so nothing here
          moves an ordered campaign's board. */}
      <BuffList rows={combatBuffRows(encounter.buffs, me.character.id)} title="Buffs" />

      {/* The place fighting back (#201): the rift clock, the way out, who
          needs saving, what burns. Absent in every fight without an
          environment, so nothing here moves an ordinary board. */}
      <EnvironmentStatus encounter={encounter} />

      {/* What the last beat did, in one line: the newest swing, its sum and
          the Guard it needed, or whatever else just happened. The running
          log with every roll drawn out is the TV's (FightLog); here it is a
          single line, so a phone gives its rows to the board. There from the
          fight's first moment. */}
      <LastBeat beats={beats} />

      {/*
        The board. Tappable cells are real <button>s; everything else is an
        inert <span> — hidden-not-disabled, per §7.2 — and on somebody else's
        turn every cell is inert. Cells are the one deliberate exception to
        the .kad-tap minimum: ten columns of a phone pane cannot give 3em
        each, and a step is the cheapest thing in the game to spend by
        mistake.
      */}
      {/* The board takes whatever height the pane has left once everything
          else has its rows (CombatPanel.css), so more cards make a smaller
          board rather than a pane that scrolls. */}
      <div className="combat__board">
      <div
        className="combat__grid"
        role="grid"
        aria-label="The battle grid"
        style={
          {
            gridTemplateColumns: `repeat(${encounter.board.width}, 1fr)`,
            "--cols": encounter.board.width,
            "--rows": encounter.board.height,
          } as CSSProperties
        }
      >
        {cells.map((cell) => {
          const cellKey = `${cell.x},${cell.y}`;
          const marks = [
            cell.blocked ? " combat__cell--blocked" : "",
            cell.selected ? " combat__cell--selected" : "",
            cell.occupant?.active ? " combat__cell--active" : "",
            cell.occupant ? ` combat__cell--${cell.occupant.side}` : "",
            cell.occupant?.down ? " combat__cell--down" : "",
            cell.occupant?.facing === "right" ? " combat__cell--faces-right" : "",
            cell.feature ? ` combat__cell--${cell.feature.kind}` : "",
            cell.feature && !cell.feature.active ? " combat__cell--quiet" : "",
          ].join("");
          const figure = cell.occupant ? (
            <CellFigure occupant={cell.occupant} numbed={isNumbedHero(encounter, me.character.id, cell.occupant.id)} />
          ) : null;
          // The environment's mark (#201): a glyph in the corner, its shape
          // the meaning — the captive fills the square, being somebody.
          const mark = cell.feature ? <FeatureMark feature={cell.feature} /> : null;
          if (cell.tappable) {
            const aiming = selection.step === "tile";
            return (
              <button
                key={cellKey}
                type="button"
                data-move-tile={aiming ? undefined : true}
                data-aim-tile={aiming ? true : undefined}
                data-x={cell.x}
                data-y={cell.y}
                className={`combat__cell combat__cell--tap${aiming ? " combat__cell--aim" : " combat__cell--walk"} kad-focusable${marks}`}
                aria-label={`${aiming ? "Aim at" : "Move to"} column ${cell.x + 1}, row ${cell.y + 1}${
                  cell.feature ? `: ${tileWords(cell.feature)}` : ""
                }`}
                onClick={() => tapTile({ x: cell.x, y: cell.y })}
              >
                {mark}
                {figure ??
                  (aiming ? (
                    <Icon name="spark" size="70%" />
                  ) : (
                    <span
                      className="combat__dot"
                      // Near squares get a big dot, the edge of the reach a
                      // small one (combat-grid.ts `nearness`).
                      style={{ "--nearness": cell.nearness ?? 1 } as CSSProperties}
                    />
                  ))}
              </button>
            );
          }
          return (
            <span key={cellKey} className={`combat__cell${marks}`} aria-hidden="true">
              {mark}
              {figure}
            </span>
          );
        })}
      </div>
      </div>

      {/*
        The board's squares are hidden from screen readers (a map of buttons
        and blanks is noise read aloud), and with them every figure's hearts.
        This list says it in words instead: everyone in the fight, their
        hearts, and who is knocked down, on every turn. Text only, no
        buttons, so it adds nothing to tap.
      */}
      <ul className="kad-sr-only" aria-label="Everyone in the fight">
        {encounter.combatants.map((c) => (
          <li key={c.id}>
            {c.id === me.character.id ? `You (${c.name})` : combatantLabel(c)}
            {c.side === "enemy" ? ", enemy" : ""}
            {c.down ? ": knocked down" : `: ${c.hp} of ${c.maxHp} hearts`}
            {c.puffed !== undefined ? `, ${PUFFED_WORDS.toLowerCase()} up: ${PUFFED_HINT.toLowerCase()}` : ""}
            {isNumbedHero(encounter, me.character.id, c.id) ? ", numbed: fewer steps for a while, then it wears off" : ""}
            {c.id === active?.id ? ", taking a turn" : ""}
          </li>
        ))}
      </ul>

      {/* What the board's marks mean, once, under the board. The same words
          on every turn, and the walking key keeps its place when there is
          nowhere to walk, so the legend never rewraps. */}
      <ul className="combat__legend" aria-hidden="true">
        <li><span className="combat__key combat__key--you" />Whose turn</li>
        <li><span className="combat__key combat__key--friend" />Friend</li>
        <li><span className="combat__key combat__key--enemy" />Enemy</li>
        {enemyCombatants.some((c) => c.puffed !== undefined && !c.down) ? (
          <li><Icon name="puffed" />{PUFFED_WORDS}: {PUFFED_HINT.toLowerCase()}</li>
        ) : null}
        <li style={seat(walkTiles.length > 0)}><span className="combat__key combat__key--walk" />You can walk here</li>
        {legendFeatures(cells).map((feature) => (
          <li key={`${feature.kind}:${feature.label}`}>
            <Icon name={feature.icon} />
            {tileWords({ ...feature, active: true })}
          </li>
        ))}
      </ul>

      {myTurn ? (
        /*
          The dock: everything under the board on your turn, in two seats
          that never trade places. The top one is one line — the hint, "Doing
          it…", or the question a tapped card asks — and the one under it
          holds the answers: the cards, the bag, the figures to pick. The dock
          keeps the tallest height it has had this turn (useTallestThisTurn),
          so a tap can swap what is in it but never resize the board above.
        */
        <div className="combat__dock" ref={dockRef}>
          <div className="combat__seat">
            {selection.step === "items" ? (
              <AskRow icon="bag" onChange={() => setSelection(IDLE)}>
                Use an item: which one?
              </AskRow>
            ) : selection.step === "read" ? (
              <AskRow
                icon={selection.action.icon}
                onChange={() => setSelection(IDLE)}
                go={{ shown: true, onGo: () => commitAction(selection.action), label: `Go! ${selection.action.name}` }}
              >
                {selection.action.name}
              </AskRow>
            ) : selection.step === "read-item" ? (
              <AskRow
                icon={items?.[selection.itemId]?.icon ?? "consumable"}
                onChange={() => setSelection(selection.fromBag ? { step: "items" } : IDLE)}
                go={{
                  shown: true,
                  onGo: () => commitItem(selection.itemId),
                  label: `Go! Use ${items?.[selection.itemId]?.name ?? "the item"}`,
                }}
              >
                {items?.[selection.itemId]?.name ?? "The item"}
              </AskRow>
            ) : selection.step === "tile" ? (
              <AskRow icon={selection.action.icon} onChange={() => setSelection(IDLE)}>
                {selection.action.name}: tap a glowing tile.
                {(selection.action.tileCount ?? 1) > 1
                  ? ` (${selection.picked.length + 1} of ${selection.action.tileCount})`
                  : ""}
              </AskRow>
            ) : aimingWho !== null ? (
              <AskRow
                icon={aimingWho.icon}
                onChange={() => setSelection(IDLE)}
                go={
                  // "Up to N": once one is picked, stopping early is allowed.
                  // Its seat is held from the first pick's question on.
                  selection.step === "target" && (selection.action.maxTargets ?? 1) > 1
                    ? {
                        shown: selection.picked.length > 0,
                        onGo: () => commitAction(selection.action, selection.picked),
                      }
                    : undefined
                }
              >
                {aimingWho.name}: who?
                {selection.step === "target" && (selection.action.maxTargets ?? 1) > 1
                  ? ` (${selection.picked.length + 1} of ${Math.min(
                      selection.action.maxTargets ?? 1,
                      selection.action.targets.length,
                    )})`
                  : ""}
              </AskRow>
            ) : (
              <p className="combat__hint" role="status">
                {hint ? (
                  <>
                    <Icon name={pending ? "waiting" : "forward"} />
                    <span className="combat__line">{hint}</span>
                  </>
                ) : null}
              </p>
            )}
          </div>

          {/* Inert while a tap is on its way: still there, so nothing moves,
              but no tap, focus or screen-reader stop lands on it. The capture
              guard is for a browser too old to know `inert`. */}
          <div
            className={`combat__answers${pending ? " combat__answers--pending" : ""}`}
            inert={pending}
            onClickCapture={pending ? swallowTap : undefined}
          >
            {/* The packed cards' sentence line (see `packed`): the tapped
                card's sentence, in a seat of two lines held for the turn. */}
            {reading !== null ? (
              <p
                className={`combat__reading${reading.quiet ? " combat__reading--quiet" : ""}`}
                role="status"
                aria-live="polite"
              >
                {reading.text}
              </p>
            ) : null}

            {(selection.step === "idle" || selection.step === "read" || (selection.step === "read-item" && !selection.fromBag)) &&
            cardCount > 0 ? (
              <ul className="prompt__options combat__actions" data-columns={columns}>
                {actions.map((action) => (
                  <li key={action.abilityId}>
                    <button
                      type="button"
                      className={`choice kad-tap kad-focusable${picked(action) ? " choice--picked" : ""}`}
                      aria-pressed={packed ? picked(action) : undefined}
                      onClick={() => tapAction(action)}
                      {...helpAttrs({ kind: "card", name: action.name, icon: action.icon, ...textOf(summaryOf(action.abilityId, abilities)) })}
                    >
                      <span className="choice__icon">
                        <Icon name={action.icon} size="1.8em" />
                      </span>
                      <span className="choice__text">
                        <span className="choice__label">{action.name}</span>
                        {summaryOf(action.abilityId, abilities) ? (
                          <span className="choice__sub">{summaryOf(action.abilityId, abilities)}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
                {bagFolded ? (
                  <li key="bag">
                    <button
                      type="button"
                      className="choice kad-tap kad-focusable"
                      onClick={() => setSelection({ step: "items" })}
                    >
                      <span className="choice__icon">
                        <Icon name="bag" size="1.8em" />
                      </span>
                      <span className="choice__text">
                        <span className="choice__label">Use an item</span>
                        <span className="choice__sub">Pick something from your bag.</span>
                      </span>
                    </button>
                  </li>
                ) : (
                  usableItems.map((item) => (
                    <ItemCard
                      key={`item-${item.itemId}`}
                      item={item}
                      onTap={tapItem}
                      compact={columns > 1}
                      picked={packed ? selection.step === "read-item" && selection.itemId === item.itemId : undefined}
                    />
                  ))
                )}
              </ul>
            ) : null}

            {/* The bag, opened in place of the cards: same spot, same thumb. */}
            {inBag ? (
              <ul className="prompt__options combat__actions" data-columns={cardColumns(usableItems.length)}>
                {usableItems.map((item) => (
                  <ItemCard
                    key={`item-${item.itemId}`}
                    item={item}
                    onTap={tapItem}
                    compact={bagPacked}
                    picked={bagPacked ? selection.step === "read-item" && selection.itemId === item.itemId : undefined}
                  />
                ))}
              </ul>
            ) : null}

            {aimingWho !== null ? (
              <ul className="prompt__options combat__targets" data-columns={targetPool >= 3 ? 2 : 1}>
                {targetIds.map((targetId) => {
                  const target = combatantById(encounter, targetId);
                  if (!target) return null;
                  return (
                    <li key={targetId}>
                      <button
                        type="button"
                        className="choice kad-tap kad-focusable"
                        onClick={() => tapTarget(targetId)}
                      >
                        <span className="choice__icon">
                          {target.side === "enemy" ? (
                            <EnemyFace combatantId={target.id} icon={combatantIcon(target, party)} large />
                          ) : (
                            <Icon name={combatantIcon(target, party)} size="1.8em" />
                          )}
                        </span>
                        <span className="choice__label">
                          {target.id === me.character.id
                            ? `${combatantLabel(target)} (you)`
                            : combatantLabel(target)}
                        </span>
                        <HpBadge combatant={target} />
                        {target.puffed !== undefined ? (
                          <span className="kad-chip kad-chip--warn combat__puffed">
                            <Icon name="puffed" />
                            <span>{PUFFED_WORDS}</span>
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {canEnd ? (
              <Button
                variant="secondary"
                size="md"
                block
                className="combat__end"
                icon={<Icon name="forward" />}
                onClick={() => void dispatch({ type: "END_TURN" })}
              >
                End my turn
              </Button>
            ) : null}
          </div>
        </div>
      ) : standIn && active ? (
        /*
          Somebody else's turn, with nobody holding the phone (#258). The
          engine lets anyone here pass it and nothing more, so a fight never
          waits on an empty chair. Their hero keeps its place on the board and
          in the order, and plays again the moment their phone is back.
        */
        <div className="combat__dock combat__standin">
          <p className="combat__hint" role="status">
            <Icon name="waiting" />
            <span className="combat__line">Their hero will wait right here.</span>
          </p>
          <Button
            variant="secondary"
            size="md"
            block
            className="combat__end"
            icon={<Icon name="forward" />}
            disabled={pending}
            onClick={() => void dispatch({ type: "END_TURN" })}
          >
            Pass {combatantLabel(active)}&rsquo;s turn
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Stops a tap before any button under it hears it (the pending guard). */
/**
 * The rift, in words (#201): one line per thing the environment is doing,
 * each with its glyph — the clock first, because it is the one that changes
 * every round. Nothing at all in a fight without an environment.
 */
function EnvironmentStatus({ encounter }: { encounter: EncounterState }): ReactElement | null {
  const view = environmentView(encounter);
  if (!view) return null;
  const lines: { key: string; icon: string; text: string; urgent?: boolean }[] = [];
  if (view.clock) {
    lines.push({
      key: "clock",
      icon: CLOCK_ICON,
      text: clockLine(view.clock),
      urgent: view.clock.expired || view.clock.roundsLeft <= 1,
    });
  }
  for (const exit of view.exits) lines.push({ key: `exit:${exit.id}`, icon: EXIT_ICON, text: exitLine(exit) });
  for (const modifier of view.modifiers) {
    lines.push({ key: `modifier:${modifier.id}`, icon: modifierIcon(modifier), text: modifierLine(modifier) });
  }
  view.captives.forEach((captive, i) => lines.push({ key: `rescue:${i}`, icon: CAPTIVE_ICON, text: rescueLine(captive) }));
  for (const objective of view.objectives) {
    lines.push({ key: `objective:${objective.id}`, icon: objectiveIcon(objective.kind), text: objectiveLine(objective) });
  }
  for (const hazard of view.hazards) {
    lines.push({ key: `hazard:${hazard.id}`, icon: hazardIcon(hazard.kind), text: hazardLine(hazard) });
  }
  return (
    <ul className="combat__env" aria-label="The rift" aria-live="polite">
      {lines.map((line) => (
        <li key={line.key} className={`combat__env-line${line.urgent ? " combat__env-line--urgent" : ""}`}>
          <Icon name={line.icon} />
          <span>{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** The environment's glyph on a square: the captive fills it, the rest sit in a corner. */
function FeatureMark({ feature }: { feature: GridFeature }): ReactElement {
  return (
    <span className={`combat__feature combat__feature--${feature.kind}`} aria-hidden="true">
      <Icon name={feature.icon} size="100%" />
    </span>
  );
}

/** One legend entry per kind of mark on the board, in board order. */
function legendFeatures(cells: readonly { feature?: GridFeature }[]): GridFeature[] {
  const seen = new Map<string, GridFeature>();
  for (const cell of cells) {
    const f = cell.feature;
    if (f && !seen.has(`${f.kind}:${f.label}`)) seen.set(`${f.kind}:${f.label}`, f);
  }
  return [...seen.values()];
}

function swallowTap(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Holds an element at the tallest it has been this turn. What the dock holds
 * changes with every tap — cards, a question and its figures, "Doing it…" —
 * and each was a different height, which the board, taking whatever is left,
 * paid for by changing size under the player's finger. Growing is allowed (a
 * bigger question has to fit); getting shorter waits for the next turn.
 */
function useTallestThisTurn(ref: RefObject<HTMLElement | null>, turn: string): void {
  const tallest = useRef<{ el: HTMLElement | null; turn: string; px: number }>({ el: null, turn, px: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (tallest.current.el !== el || tallest.current.turn !== turn) {
      tallest.current = { el, turn, px: 0 };
      el.style.minBlockSize = "";
    }
    const px = el.getBoundingClientRect().height;
    if (px > tallest.current.px) {
      tallest.current.px = px;
      el.style.minBlockSize = `${px}px`;
    }
  });
}

/**
 * The question an aimed card asks, with its way back on the same row: a
 * Change button on a row of its own was a row the board had to give up. An
 * up-to-N card's Go sits there too, its seat held until the first pick.
 */
function AskRow({
  icon,
  onChange,
  go,
  children,
}: {
  icon: string;
  onChange: () => void;
  /** `label` names the button for a screen reader; an up-to-N pick's is "That's everyone". */
  go?: { shown: boolean; onGo: () => void; label?: string } | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="combat__ask-row">
      <p className="prompt__sub combat__ask">
        <Icon name={icon} />
        <span className="combat__line">{children}</span>
      </p>
      {go ? (
        <Button
          variant="primary"
          size="md"
          icon={<Icon name="check" />}
          aria-label={go.label ?? "That's everyone. Go!"}
          style={seat(go.shown)}
          onClick={go.onGo}
        >
          Go!
        </Button>
      ) : null}
      <Button variant="ghost" size="md" icon={<Icon name="back" />} onClick={onChange}>
        Change
      </Button>
    </div>
  );
}

/** One kind of consumable as an action card, with how many are in the bag. */
function ItemCard({
  item,
  onTap,
  compact,
  picked,
}: {
  item: { itemId: string; def: ItemDef; count: number };
  onTap: (itemId: string, def: ItemDef) => void;
  /** Packed into columns: the name alone, since "Use" costs a wrapped line. */
  compact: boolean;
  /** Packed and tapped once: its sentence is up, and Go! uses it. Undefined when not packed. */
  picked?: boolean | undefined;
}): ReactElement {
  const name = `Use ${item.def.name}${item.count > 1 ? ` ×${item.count}` : ""}`;
  return (
    <li>
      <button
        type="button"
        className={`choice kad-tap kad-focusable${picked ? " choice--picked" : ""}`}
        aria-label={name}
        aria-pressed={picked}
        onClick={() => onTap(item.itemId, item.def)}
        {...helpAttrs({ kind: "item", name: item.def.name, icon: item.def.icon, ...textOf(item.def.text) })}
      >
        <span className="choice__icon">
          <Icon name={item.def.icon} size="1.8em" />
        </span>
        <span className="choice__text">
          <span className="choice__label">
            {compact ? item.def.name : `Use ${item.def.name}`}
            {item.count > 1 ? <span className="combat__count"> ×{item.count}</span> : null}
          </span>
          <span className="choice__sub">{itemSummary(item.def)}</span>
        </span>
      </button>
    </li>
  );
}

/** Hearts as a number: `hp/maxHp`, never a bar alone (spec §11). */
function HpBadge({ combatant }: { combatant: Combatant }): ReactElement {
  return (
    <span className={`combat__hp${combatant.down ? " combat__hp--down" : ""}`}>
      <Icon name="heart" />
      {combatant.hp}/{combatant.maxHp}
      {combatant.down ? <Icon name="down" label="Knocked down" /> : null}
    </span>
  );
}

/** A monster's square portrait, or its glyph when the art is unknown. */
function EnemyFace({
  combatantId,
  icon,
  large = false,
}: {
  combatantId: string;
  icon: string;
  large?: boolean;
}): ReactElement {
  const state = useRunState();
  const chapter = useChapter();
  const [broken, setBroken] = useState(false);
  const portrait = enemyPortraitUrl(chapter, state?.sceneId ?? null, combatantId);
  if (portrait && !broken) {
    return (
      <img
        className={`combat__enemy-art${large ? " combat__enemy-art--large" : ""}`}
        src={portrait}
        alt=""
        draggable={false}
        onError={() => setBroken(true)}
      />
    );
  }
  return <Icon name={icon} size={large ? "1.8em" : "1em"} />;
}

/**
 * What stands on a grid square, drawn to fill it: a hero's face, a monster's
 * portrait, a big glyph when there is no picture — and its hearts in the
 * corner, so "which one is nearly done" is read off the map, not looked up.
 */
function CellFigure({ occupant, numbed = false }: { occupant: GridOccupant; numbed?: boolean }): ReactElement {
  const state = useRunState();
  const party = useParty();
  const chapter = useChapter();
  const [broken, setBroken] = useState(false);
  const member = occupant.side === "party" ? party.find((m) => m.character.id === occupant.id) : undefined;
  const badge = occupant.down ? (
    <span className="combat__down-badge"><Icon name="down" size="100%" /></span>
  ) : (
    <span className="combat__cell-hp" aria-hidden="true">{occupant.hp}</span>
  );
  // Status marks in the square's top corner, glyphs by shape: a puffed enemy
  // (#227) to everyone, Numbed only on the stung player's own figure.
  const status =
    occupant.puffed && !occupant.down ? (
      <span className="combat__cell-status combat__cell-status--puffed" aria-hidden="true"><Icon name="puffed" size="100%" /></span>
    ) : numbed && !occupant.down ? (
      <span className="combat__cell-status combat__cell-status--numbed" aria-hidden="true"><Icon name="numbed" size="100%" /></span>
    ) : null;
  if (member) {
    return (
      <>
        <CharacterPortrait
          backdrop
          species={member.character.species}
          accent={member.character.appearance.accent}
          tier={member.character.tier}
          characterClass={member.character.class}
          className="combat__cell-face"
        />
        {badge}
        {status}
      </>
    );
  }
  const portrait = occupant.side === "enemy" ? enemyPortraitUrl(chapter, state?.sceneId ?? null, occupant.id) : null;
  return (
    <>
      {portrait && !broken ? (
        <img className="combat__cell-art" src={portrait} alt="" draggable={false} onError={() => setBroken(true)} />
      ) : (
        <Icon name={occupant.icon} size="72%" />
      )}
      {badge}
      {status}
    </>
  );
}

// ---------------------------------------------------------------------------
// What just happened
// ---------------------------------------------------------------------------

/**
 * The last combat beat as lines, kept until the next one. Listens to both
 * presentations that carry beats: the opening monster turns ride
 * ENCOUNTER_BEGAN, everything after rides COMBAT_SEQUENCE. The raw events are
 * kept and put into words at render, against whatever encounter the phone
 * holds then: a beat can arrive before its patch (the patch is held for the
 * beat's duration), and names are stable for the whole fight, so reading
 * them late is never wrong and reading them early could find nothing to read.
 */
function useBeats(encounter: EncounterState | null, myId: string | null): readonly Beat[] {
  const [last, setLast] = useState<{ seq: number; events: readonly EncounterEvent[] } | null>(null);

  const take = useCallback((events: readonly EncounterEvent[] | undefined, seq: number) => {
    if (!events || events.length === 0) return;
    setLast({ seq, events });
  }, []);

  usePresentation("COMBAT_SEQUENCE", (presentation, event) => take(presentation.events, event.seq));
  usePresentation("ENCOUNTER_BEGAN", (presentation, event) => take(presentation.events, event.seq));

  /*
   * A fight that ends takes its log with it, and so does one replaced by
   * another. A fight *arriving* does not clear anything: its opening monster
   * round rides ENCOUNTER_BEGAN, which the channel delivers before the patch
   * that puts the encounter in state, so by the time `startedAt` appears the
   * log already holds that round. Clearing on null → fight wiped it.
   */
  const fightId = encounter?.startedAt ?? null;
  const previousFight = useRef(fightId);
  useEffect(() => {
    if (previousFight.current !== null && previousFight.current !== fightId) setLast(null);
    previousFight.current = fightId;
  }, [fightId]);

  return useMemo(
    () => (last && encounter ? describeBeats(last.events, encounter, myId, last.seq) : []),
    [last, encounter, myId],
  );
}

/**
 * The newest line of the last beat, on one line of its own. The phone used to
 * keep a three-line log with every roll drawn as its parts, which was rows
 * the board gave up on every turn; the shared screen now carries that log for
 * the room (FightLog), and a phone keeps the one line its holder looks for: a
 * swing's sum, what it needed and how hard it landed, all in the line's words
 * (fight-log.ts). The whole beat stays readable to a screen reader.
 */
function LastBeat({ beats }: { beats: readonly Beat[] }): ReactElement {
  const last = beats.at(-1) ?? null;
  return (
    <div className="combat__log" aria-label="What just happened" role="group">
      <p
        key={last?.key ?? "quiet"}
        className={`combat__beat combat__line combat__beat--${last?.tone ?? "quiet"}`}
        aria-hidden="true"
      >
        {/* The box is up from the first moment of the fight; empty, it read as
            something broken. */}
        {last ? last.text : "The fight is on!"}
      </p>
      <ol className="kad-sr-only" aria-live="polite">
        {beats.map((beat) => (
          <li key={beat.key}>{beat.text}</li>
        ))}
      </ol>
    </div>
  );
}

/** The card's one-line explanation: the catalog's, then the built-in three's. */
/** `{ text }` when there are words to show, so a held thing without its own falls back to its kind's. */
function textOf(text: string | null | undefined): { text?: string } {
  return text ? { text } : {};
}

function summaryOf(abilityId: string, abilities: AbilityCatalog | null): string | null {
  return abilities?.[abilityId]?.summary ?? UNIVERSAL_ABILITIES[abilityId]?.summary ?? null;
}

/** What a consumable does, in the same voice as the ability cards. */
function itemSummary(def: ItemDef): string {
  const effect = def.effect;
  if (!effect) return "Use it now.";
  if (effect.type === "heal") return `Get ${effect.amount} hearts back.`;
  if (effect.type === "damage") return `Throw it at an enemy for ${effect.amount} damage.`;
  return `+${effect.amount} on your next roll.`;
}

/** The selection as the table should see it, or null when nothing is picked. */
export function previewOf(selection: Selection): IntentPreview | null {
  switch (selection.step) {
    case "idle":
      return null;
    case "target":
      return { kind: "action", abilityId: selection.action.abilityId, targetIds: [...selection.picked] };
    case "tile":
      return { kind: "action", abilityId: selection.action.abilityId, tiles: [...selection.picked] };
    case "tile-target":
      return { kind: "action", abilityId: selection.action.abilityId, tiles: [selection.tile] };
    case "item-target":
      return { kind: "item", itemId: selection.itemId };
    case "items":
      return null;
    // A packed card being read is the table's business too: it is what they
    // are about to do.
    case "read":
      return { kind: "action", abilityId: selection.action.abilityId };
    case "read-item":
      return { kind: "item", itemId: selection.itemId };
  }
}
