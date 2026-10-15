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
 * what just happened: every roll, hit and miss of the last beat, in words,
 * because a d20 that nobody sees is not a d20.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type {
  AbilityCatalog,
  ClientIntent,
  Combatant,
  DiceRoll,
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
  currentActor,
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
import { combatantIcon, combatantLabel, enemyPortraitUrl, gridCells, turnKey, type GridOccupant } from "./combat-grid";
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
  | { step: "items" };

const IDLE: Selection = { step: "idle" };

/** More cards than this and the bag folds into one "Use an item" card. */
const MAX_LOOSE_CARDS = 6;

/**
 * Cards to a row, by how many there are: one or two keep their sentence on a
 * row each; three or four go two to a row; five or more go three to a row,
 * icon over name. Every row a card list adds is a row the board gives up,
 * and a pane that scrolls is the one thing the turn screen must not do.
 */
export function cardColumns(count: number): 1 | 2 | 3 {
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  return 3;
}

/**
 * One line of "what just happened", already in words. Built when the beat
 * arrives rather than at render, because the names come from the encounter
 * as it stood *then* — the patch behind the beat may hand the clock on.
 */
export interface Beat {
  readonly key: string;
  /** A roll keeps its numbers, so it can be drawn as a die rather than a sentence. */
  readonly roll?: { readonly who: string; readonly roll: DiceRoll };
  readonly text: string;
  readonly tone: "good" | "bad" | "plain";
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
  /**
   * A commit is on its way, or has landed on the server and its patch has not
   * reached this phone yet (a combat beat holds the patch for up to a few
   * seconds, world/presentation.ts). Either way the board is no longer the one
   * the next tap would be made against, so the tappables step aside until the
   * turn key changes. A refused send clears it, so the turn is never stuck.
   */
  const [pending, setPending] = useState(false);
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
  }, [key]);

  const dispatch = useCallback(
    async (intent: ClientIntent) => {
      setPending(true);
      setSelection(IDLE);
      const ok = await send(intent);
      if (!ok) setPending(false);
    },
    [send],
  );

  // What the TV lights up while this phone is still aiming (§11's "what are
  // you about to do", shown to the table). Read off the same selection.
  useSharePreview(previewOf(selection));

  const beats = useBeats(encounter, me?.character.id ?? null);

  if (!encounter || !me) return null;

  const active = currentActor(encounter);
  const myTurn = active !== null && active.side === "party" && active.id === me.character.id;
  const deciding = myTurn && !pending;

  // The rules boundary, verbatim (see the header). The catalog rides the same
  // content fetch as the rules; until both land the cards simply wait.
  const actions =
    deciding && rules && abilities ? legalActions(encounter, combatContext(rules, abilities)) : [];
  const moves = deciding ? legalMoves(encounter) : [];

  // What the grid offers this render: move destinations, or the still-unpicked
  // tiles of the ability being aimed. Never both — one question at a time.
  const tappable: readonly (Position & { readonly cost?: number })[] =
    selection.step === "tile"
      ? selection.action.tiles.filter(
          (tile) => !selection.picked.some((p) => samePosition(p, tile)),
        )
      : selection.step === "idle"
        ? moves
        : [];
  const selectedTiles: readonly Position[] =
    selection.step === "tile"
      ? selection.picked
      : selection.step === "tile-target"
        ? [selection.tile]
        : [];

  const cells = gridCells(encounter, party, tappable, selectedTiles);

  // The consumables this turn could spend the action on (§7.2's fourth
  // universal action). Hidden, never disabled: gone once the action is spent,
  // and a card whose use the server would refuse — a thrown item with no
  // monster in range, a heal at full health, a bonus no better than the one
  // in place — never appears at all (useItemInCombat's exact refusals).
  const throwTargets = deciding ? legalItemTargets(encounter, me.character.id) : [];
  const myCombatant = combatantById(encounter, me.character.id);
  // One card per kind of item, however many of it are in the bag: two
  // Sunbloom Draughts are one choice, and a second card for the same thing
  // is a row the pane has to find room for.
  const usableItems: { itemId: string; def: ItemDef; count: number }[] = [];
  if (deciding && !encounter.actionTaken && myCombatant) {
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

  function tapAction(action: LegalAction): void {
    if (action.tiles.length > 0) {
      setSelection({ step: "tile", action, picked: [] });
      return;
    }
    if (action.needsTarget) {
      setSelection({ step: "target", action, picked: [] });
      return;
    }
    commitAction(action);
  }

  function tapItem(itemId: string, def: ItemDef): void {
    if (def.effect?.type === "damage") {
      setSelection({ step: "item-target", itemId });
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
    deciding &&
    selection.step === "idle" &&
    ((encounter.actionTaken && moves.length > 0) ||
      (!encounter.actionTaken && actions.length === 0 && usableItems.length === 0));

  const hint = !deciding
    ? null
    : selection.step !== "idle"
      ? null
      : encounter.actionTaken
        ? moves.length > 0
          ? `You can still walk ${encounter.stepsLeft} step${encounter.stepsLeft === 1 ? "" : "s"}, or end your turn.`
          : null
        : moves.length > 0
          ? "Walk on a gold square, or pick one thing."
          : "Pick one thing to do.";

  return (
    <div className="prompt combat">
      {myTurn ? (
        <h3 className="prompt__title combat__title">
          <Icon name="swords" />
          <span>Your turn, {me.character.name}!</span>
          {!encounter.actionTaken || moves.length > 0 ? (
            <span className="kad-chip combat__steps">
              <Icon name="steps" />
              {encounter.stepsLeft} step{encounter.stepsLeft === 1 ? "" : "s"}
            </span>
          ) : null}
        </h3>
      ) : (
        <p className="player__waiting" role="status">
          <Icon name="waiting" />
          <span>
            {active
              ? active.side === "party"
                ? `It's ${combatantLabel(active)}'s turn.`
                : `${combatantLabel(active)} is taking its turn…`
              : "The dust is settling…"}
          </span>
        </p>
      )}

      {/* What the last beat did, in words and numbers: every roll on the
          table, whoever threw it. The one place the d20 shows on a phone. */}
      {beats.length > 0 ? <BeatLog beats={beats} /> : null}

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
          ].join("");
          const figure = cell.occupant ? <CellFigure occupant={cell.occupant} /> : null;
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
                aria-label={`${aiming ? "Aim at" : "Move to"} column ${cell.x + 1}, row ${cell.y + 1}`}
                onClick={() => tapTile({ x: cell.x, y: cell.y })}
              >
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
              {figure}
            </span>
          );
        })}
      </div>
      </div>

      {/* What the board's marks mean, once, under the board. */}
      <ul className="combat__legend" aria-hidden="true">
        <li><span className="combat__key combat__key--you" />{myTurn ? "You" : "Whose turn"}</li>
        <li><span className="combat__key combat__key--friend" />Friend</li>
        <li><span className="combat__key combat__key--enemy" />Enemy</li>
        {moves.length > 0 ? <li><span className="combat__key combat__key--walk" />You can walk here</li> : null}
      </ul>

      {myTurn && active ? (
        <>
          {/*
            Under the board, one thing at a time, in the same spot: the cards,
            or the who/where question the tapped card asks. Swapping in place
            rather than stacking is what keeps the thumb where it was and the
            pane where it was — nothing new ever appears below the fold.
          */}
          {pending ? (
            <p className="combat__hint" role="status">
              <Icon name="waiting" />
              <span>Doing it…</span>
            </p>
          ) : null}

          {hint ? (
            <p className="combat__hint">
              <Icon name="forward" />
              <span>{hint}</span>
            </p>
          ) : null}

          {selection.step === "idle" && cardCount > 0 ? (
            <ul className="prompt__options combat__actions" data-columns={cardColumns(cardCount)}>
              {actions.map((action) => (
                <li key={action.abilityId}>
                  <button
                    type="button"
                    className="choice kad-tap kad-focusable"
                    onClick={() => tapAction(action)}
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
                    compact={cardColumns(cardCount) > 1}
                  />
                ))
              )}
            </ul>
          ) : null}

          {/* The bag, opened in place of the cards: same spot, same thumb. */}
          {selection.step === "items" ? (
            <div className="combat__aim">
              <AskRow icon="bag" onChange={() => setSelection(IDLE)}>
                Use an item: which one?
              </AskRow>
              <ul className="prompt__options combat__actions" data-columns={cardColumns(usableItems.length)}>
                {usableItems.map((item) => (
                  <ItemCard
                    key={`item-${item.itemId}`}
                    item={item}
                    onTap={tapItem}
                    compact={cardColumns(usableItems.length) > 1}
                  />
                ))}
              </ul>
            </div>
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

          {selection.step === "tile" ? (
            <div className="combat__aim">
              <AskRow icon={selection.action.icon} onChange={() => setSelection(IDLE)}>
                {selection.action.name}: tap a glowing tile.
                {(selection.action.tileCount ?? 1) > 1
                  ? ` (${selection.picked.length + 1} of ${selection.action.tileCount})`
                  : ""}
              </AskRow>
            </div>
          ) : null}

          {aimingWho !== null ? (
            <div className="combat__aim">
              <AskRow icon={aimingWho.icon} onChange={() => setSelection(IDLE)}>
                {aimingWho.name}: who?
                {selection.step === "target" && (selection.action.maxTargets ?? 1) > 1
                  ? ` (${selection.picked.length + 1} of ${Math.min(
                      selection.action.maxTargets ?? 1,
                      selection.action.targets.length,
                    )})`
                  : ""}
              </AskRow>
              <ul className="prompt__options combat__targets" data-columns={targetIds.length >= 3 ? 2 : 1}>
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
                        <span className="choice__label">{combatantLabel(target)}</span>
                        <HpBadge combatant={target} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {/* "Up to N": once one is picked, stopping early is allowed. */}
              {selection.step === "target" && selection.picked.length > 0 ? (
                <Button
                  variant="primary"
                  size="md"
                  icon={<Icon name="check" />}
                  onClick={() => commitAction(selection.action, selection.picked)}
                >
                  That's everyone. Go!
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * The question an aimed card asks, with its way back on the same row: a
 * Change button on a row of its own was a row the board had to give up.
 */
function AskRow({
  icon,
  onChange,
  children,
}: {
  icon: string;
  onChange: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="combat__ask-row">
      <p className="prompt__sub combat__ask">
        <Icon name={icon} />
        <span>{children}</span>
      </p>
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
}: {
  item: { itemId: string; def: ItemDef; count: number };
  onTap: (itemId: string, def: ItemDef) => void;
  /** Packed into columns: the name alone, since "Use" costs a wrapped line. */
  compact: boolean;
}): ReactElement {
  const name = `Use ${item.def.name}${item.count > 1 ? ` ×${item.count}` : ""}`;
  return (
    <li>
      <button
        type="button"
        className="choice kad-tap kad-focusable"
        aria-label={name}
        onClick={() => onTap(item.itemId, item.def)}
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
function CellFigure({ occupant }: { occupant: GridOccupant }): ReactElement {
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

  // A new fight starts with a clean slate; an ended one takes its log with it.
  const fightId = encounter?.startedAt ?? null;
  useEffect(() => {
    setLast(null);
  }, [fightId]);

  return useMemo(
    () => (last && encounter ? describeBeats(last.events, encounter, myId, last.seq) : []),
    [last, encounter, myId],
  );
}

/** Stat ids as a kid reads them off the sheet. */
const STAT_NAMES: Record<string, string> = {
  might: "Might",
  quick: "Quick",
  clever: "Clever",
  heart: "Heart",
};

/**
 * Beats → lines. Pure, so the wording can be asserted. "You" for the phone's
 * own hero; everyone else by name, with the ordinal that tells three wisps
 * apart. Walking is left out — it is the board's to show, and in words it
 * buries the hit under it.
 */
export function describeBeats(
  events: readonly EncounterEvent[],
  encounter: EncounterState,
  myId: string | null,
  seq: number,
): Beat[] {
  const name = (id: string): string => {
    if (id === myId) return "You";
    const c = combatantById(encounter, id);
    return c ? combatantLabel(c) : id;
  };
  const out: Beat[] = [];
  events.forEach((event, i) => {
    const key = `${seq}:${i}`;
    switch (event.type) {
      case "roll": {
        const who = name(event.roll.characterId);
        const hit = event.roll.result === "hit" || event.roll.result === "success";
        out.push({
          key,
          roll: { who, roll: event.roll },
          text: `${who} rolled ${rollWords(event.roll)}. ${hit ? "Hit!" : "Miss!"}`,
          tone: hit ? (event.roll.characterId === myId || isParty(encounter, event.roll.characterId) ? "good" : "bad") : "plain",
        });
        return;
      }
      case "damage": {
        const who = name(event.actorId);
        out.push({
          key,
          text: `${who} ${who === "You" ? "take" : "takes"} ${event.amount}. ${event.hp} left.`,
          tone: isParty(encounter, event.actorId) ? "bad" : "good",
        });
        return;
      }
      case "heal": {
        const who = name(event.actorId);
        out.push({ key, text: `${who} ${who === "You" ? "get" : "gets"} ${event.amount} back. ${event.hp} now.`, tone: "good" });
        return;
      }
      case "down": {
        const who = name(event.actorId);
        out.push({
          key,
          text: `${who} ${who === "You" ? "are" : "is"} knocked down!`,
          tone: isParty(encounter, event.actorId) ? "bad" : "good",
        });
        return;
      }
      case "revived": {
        const who = name(event.actorId);
        out.push({ key, text: `${who} ${who === "You" ? "are" : "is"} back up!`, tone: "good" });
        return;
      }
      case "shoved":
        out.push({ key, text: `${name(event.actorId)} ${name(event.actorId) === "You" ? "get" : "gets"} shoved.`, tone: "plain" });
        return;
      case "protected":
        out.push({ key, text: `${name(event.byId)} ${name(event.byId) === "You" ? "brace" : "braces"} for ${name(event.actorId)}.`, tone: "good" });
        return;
      case "bonus":
        out.push({ key, text: `${name(event.actorId)}: +${event.amount} on the next roll.`, tone: "good" });
        return;
      case "dazed":
        out.push({ key, text: `${name(event.actorId)} ${name(event.actorId) === "You" ? "are" : "is"} dazed.`, tone: "plain" });
        return;
      case "warded":
        out.push({ key, text: `${name(event.actorId)}: warded for ${event.amount}.`, tone: "good" });
        return;
      case "evaded":
        out.push({ key, text: `${name(event.actorId)} vanished from ${name(event.byId)}'s swing!`, tone: "plain" });
        return;
      case "rooted":
        out.push({ key, text: `${name(event.actorId)} ${name(event.actorId) === "You" ? "are" : "is"} rooted.`, tone: "plain" });
        return;
      case "encore":
        out.push({ key, text: `${name(event.actorId)} ${name(event.actorId) === "You" ? "get" : "gets"} another action!`, tone: "good" });
        return;
      case "moved":
      case "walled":
        return;
    }
  });
  return out;
}

function isParty(encounter: EncounterState, id: string): boolean {
  return combatantById(encounter, id)?.side === "party";
}

/** "14 + 3 Might = 17 against 11", the way the table would read it out. */
export function rollWords(roll: DiceRoll): string {
  const stat = roll.stat ? ` ${STAT_NAMES[roll.stat] ?? roll.stat}` : "";
  const mod = roll.mod === 0 ? "" : ` ${roll.mod < 0 ? "-" : "+"} ${Math.abs(roll.mod)}${stat}`;
  return `${roll.die}${mod} = ${roll.total} against ${roll.tn}`;
}

function BeatLog({ beats }: { beats: readonly Beat[] }): ReactElement {
  // The newest line is the one that matters; a long round scrolls to it.
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [beats]);
  return (
    <ol className="combat__log" aria-label="What just happened" ref={ref}>
      {beats.map((beat) => (
        <li key={beat.key} className={`combat__beat combat__beat--${beat.tone}`}>
          {beat.roll ? (
            <RollLine who={beat.roll.who} roll={beat.roll.roll} />
          ) : (
            <span>{beat.text}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * A roll drawn as its parts: the die big, the bonus and its stat beside it,
 * the total against the Guard it had to beat, and the verdict. The same sum
 * the dice card shows for a check (DiceOverlay), at a size a fight can afford.
 */
function RollLine({ who, roll }: { who: string; roll: DiceRoll }): ReactElement {
  const hit = roll.result === "hit" || roll.result === "success";
  const stat = roll.stat ? STAT_NAMES[roll.stat] ?? roll.stat : null;
  return (
    <span className="combat__roll">
      <span className="combat__roll-who">{who}</span>
      <span className="combat__roll-die" aria-label={`rolled ${roll.die}`}>
        <Icon name="d20" />
        {roll.die}
      </span>
      {roll.mod !== 0 ? (
        <span className="combat__roll-mod">
          {roll.mod < 0 ? "-" : "+"} {Math.abs(roll.mod)}
          {stat ? <span className="combat__roll-stat"> {stat}</span> : null}
        </span>
      ) : null}
      <span className="combat__roll-total">= {roll.total}</span>
      <span className="combat__roll-tn kad-muted">vs {roll.tn}</span>
      <span className={`combat__roll-verdict combat__roll-verdict--${hit ? "hit" : "miss"}`}>
        <Icon name={hit ? "check" : "close"} />
        {hit ? "Hit!" : "Miss"}
      </span>
    </span>
  );
}

/** The card's one-line explanation: the catalog's, then the built-in three's. */
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
  }
}
